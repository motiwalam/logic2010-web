/**
 * The Parsing module against tools/oracle/.../OracleParsing.java: parse trees (notation code,
 * structure, each node's text and operator ranges) of every exercise and every corpus text,
 * and replays of simulated work (notation choices, clicks, checks) under several options,
 * compared with the desktop window's state after every step.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { FormulaParseNode } from '../../src/engine/formula/FormulaParseNode';
import { LPParsing, ParsingModule } from '../../src/engine/modules/parsing/LPParsing';
import type { ParseTreeNode } from '../../src/engine/modules/parsing/ParseTree';
import { getProblemState } from '../../src/engine/modules/parsing/parsingRecords';
import { ProblemSelector } from '../../src/engine/program/ProblemSelector';
import { UserInfo } from '../../src/engine/program/UserInfo';
import { javaTrim } from '../../src/engine/util/java';
import { loadEngine } from '../formula/formulaOracle';

interface TreeCase {
  s: string;
  code?: string;
  struct?: string;
  nodes?: [string, string][];
  error?: string;
}

type Action = ['load'] | ['notation', number] | ['check', string | null, string] | ['removeWork'] | ['click', number[], number] | ['reload', string];

interface WorkCase {
  scenario: string;
  record: string;
  steps: { a: Action; s: Record<string, unknown> }[];
  state: number;
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, '../fixtures/parsing', name), 'utf8')) as T;
}

function treeRecord(module: ParsingModule, s: string): TreeCase {
  try {
    const f = new FormulaParseNode(s);
    const code = f.getNotationCode();
    const struct = f.getStructureString();
    const w = module.open();
    w.loadProblem(TaggedRecord.toLine(TaggedRecord.formatField(s, '=')));
    const nodes: [string, string][] = [];
    for (const n of w.problem.tree.root.walk()) nodes.push([n.text, n.getOperatorRanges().toString()]);
    return { s, code, struct, nodes };
  } catch (e) {
    return { s, error: e instanceof TypeError ? 'NullPointerException' : String(e) };
  }
}

function snapshot(w: LPParsing): Record<string, unknown> {
  const p = w.problem;
  const t = p.tree;
  const r = t.root.selectedRange;
  return {
    notation: p.notationIndex,
    result: p.resultText,
    statusLabel: t.statusLabel,
    visible: t.visible,
    status: javaTrim(w.status),
    errors: w.errorCount,
    unexpanded: t.unexpandedCount,
    complete: t.isComplete(),
    noDescent: w.noDescent,
    checkNow: w.checkNow,
    selected: r == null ? null : '[' + r.join(', ') + ']',
    selectionCorrect: t.root.selectionCorrect,
    work: p.getWorkRecord(),
  };
}

function nodeAt(w: LPParsing, path: number[]): ParseTreeNode {
  let node = w.problem.tree.root;
  for (const k of path) node = node.getChildNode(k)!;
  return node;
}

export function parsingSuite(syntax: 1 | 2): void {
  let module: ParsingModule;
  beforeAll(async () => {
    await loadEngine(syntax);
    const r = await ParsingModule.load({ work: null, user: UserInfo.localUser(), clock: () => 1_000_000 });
    expect(r.error).toBeNull();
    module = r.module!;
  });

  test(`parse trees match the desktop program (notation ${syntax})`, () => {
    const cases = fixture<TreeCase[]>(`trees-${syntax}.json`);
    const mismatches: unknown[] = [];
    for (const c of cases) {
      const actual = treeRecord(module, c.s);
      if (JSON.stringify(actual) !== JSON.stringify(c)) mismatches.push({ expected: c, actual });
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  test(`simulated work matches the desktop program (notation ${syntax})`, () => {
    const cases = fixture<WorkCase[]>(`work-${syntax}.json`);
    const base = module.options;
    const saved = { autoCheck: base.autoCheck, mainOnly: base.mainOnly, noCheck: base.noCheck };
    const mismatches: unknown[] = [];
    for (const c of cases) {
      Object.assign(base, saved);
      const all = new ProblemSelector('~{}');
      if (c.scenario.includes('autoCheck')) base.autoCheck = all;
      if (c.scenario.includes('mainOnly')) base.mainOnly = all;
      if (c.scenario === 'noCheck') base.noCheck = all;
      let w = module.open();
      c.steps.forEach((step, k) => {
        const a = step.a;
        let extra: unknown = null;
        switch (a[0]) {
          case 'load':
            w.loadProblem(c.record);
            break;
          case 'notation':
            w.selectNotation(a[1]);
            break;
          case 'check': {
            const r = w.check();
            extra = [r.id, r.summary];
            if (r.id !== a[1] || r.summary !== a[2]) mismatches.push({ record: c.record, scenario: c.scenario, k, check: [a, extra] });
            break;
          }
          case 'removeWork':
            w.removeWork();
            break;
          case 'click':
            w.click(nodeAt(w, a[1]), a[2]);
            break;
          case 'reload': {
            const saved = TaggedRecord.stripTimestamp(w.saveProblem());
            if (saved !== a[1]) mismatches.push({ record: c.record, scenario: c.scenario, k, saved, expected: a[1] });
            w = module.open();
            w.loadProblem(a[1]);
            if (getProblemState(a[1]) !== c.state) mismatches.push({ record: c.record, k, state: getProblemState(a[1]), expected: c.state });
            break;
          }
        }
        const s = snapshot(w);
        if (JSON.stringify(s) !== JSON.stringify(step.s)) mismatches.push({ record: c.record, scenario: c.scenario, k, action: a, actual: s, expected: step.s });
      });
    }
    Object.assign(base, saved);
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
}
