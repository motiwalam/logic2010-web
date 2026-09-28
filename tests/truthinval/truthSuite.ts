/**
 * Replays tools/oracle/.../OracleTruth.java on the port: generated work records checked with
 * option settings, cell and tree states, tree edits and commits, and setup-stage sequences.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { getProblemState, LPTruthAnalysis, loadTruthModule, TruthWorkspace } from '../../src/engine/modules/truth/LPTruthAnalysis';
import type { TruthValueTree } from '../../src/engine/modules/truth/TruthValueTree';
import type { ErrorRef } from '../../src/engine/program/Message';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { loadRulesAndTheorems } from '../../src/engine/rules/RuleTable';
import { readExercises } from '../../src/engine/problems/LogicModule';
import { repoData } from '../support/fsDataSource';

interface Combo { flags: number; check: string; work: string; hasWork: boolean; showing: boolean; cells?: string }
interface Case { rec: string; state: number; combos: Combo[]; edits: [number, number, number, number, boolean, number, string, string][]; after: string }
type SetupStep = ['L', string, string, string, number, string] | ['A', string, string, string, string, boolean];
interface SetupCase { name: string; statement: string; steps: SetupStep[]; final: string }
interface Fixture { options: [string, boolean, string, string | null][]; cases: Case[]; setup: SetupCase[] }

export function truthFixture(syntax: number): Fixture {
  return JSON.parse(readFileSync(join(__dirname, '../fixtures/truthinval', `truth-${syntax}.json`), 'utf8')) as Fixture;
}

const n = (v: string | null | undefined) => (v == null ? 'null' : v);

export function checkString(m: LPTruthAnalysis): string {
  try {
    const e = m.checkFull();
    return n(e.id) + '/' + (e.params == null ? 'null' : n(e.params.get('summary')));
  } catch (x) {
    if (x instanceof RangeError) return 'X:ArrayIndexOutOfBoundsException';
    throw x;
  }
}

function snapshot(m: LPTruthAnalysis): string {
  let b = '';
  const g = m.problem.table;
  for (let i = 0; i < g.rowCount; i++) {
    for (const cell of g.cells[i]) {
      b += cell.text + (cell.isWrong ? '-' : '+') + cell.getCode() + '|' + cell.getTreeCode() + '|';
      for (const t of cell.valueTree.nodes()) b += (t.errorShown ? 'e' : '.') + (t.correct ? 'c' : 'x') + (t.locked ? 'L' : 'u');
      b += ';';
    }
    b += '\n';
  }
  return b;
}

function setFlags(m: LPTruthAnalysis, f: number): void {
  m.completeAllRows = (f & 1) !== 0;
  m.completeAllWffs = (f & 2) !== 0;
  m.completeSetup = (f & 4) !== 0;
  m.completeAllNodes = (f & 8) !== 0;
  m.treeErrorsDisabled = (f & 16) !== 0;
  m.checkMessagesDisabled = true;
  m.errorCount = 0;
}

function idOf(e: ErrorRef | null, full: boolean): string {
  const p = e!.params;
  let s = n(e!.id) + '/' + n(p?.get('summary'));
  if (full) s += '/' + n(p?.get('sentence')) + '/' + n(p?.get('unparsed'));
  return s;
}

export function truthSuite(syntax: 1 | 2): void {
  const f = truthFixture(syntax);
  beforeAll(async () => {
    await loadProgram(repoData, { syntax, loadRules: (t, r) => {
      loadRulesAndTheorems(t, r);
    } });
    await loadTruthModule();
  });

  test(`problem options (notation ${syntax})`, async () => {
    const ws = new TruthWorkspace();
    await readExercises(ws.exercises, 'truwork.txt');
    const m = new LPTruthAnalysis(ws);
    const p = new LPTruthAnalysis(ws, true);
    const got = f.options.map(([name, print]) => {
      const x = print ? p : m;
      x.loadExerciseInfo(new TaggedRecord(ws.exercises.getRecord(name)));
      const bits = [x.completeAllNodes, x.completeAllRows, x.completeAllWffs, x.completeSetup, x.checkDisabled, x.treeErrorsDisabled,
        x.tableErrorsDisabled, x.setupErrorsDisabled, x.checkMessagesDisabled, x.dontChange, x.assumeTautology].map((b) => (b ? '1' : '0')).join('');
      return [name, print, bits, x.note];
    });
    expect(got).toEqual(f.options);
  });

  test(`work records: states, checks with options, cells, edits (notation ${syntax})`, () => {
    const m = new LPTruthAnalysis(null);
    const diffs: string[] = [];
    const eq = (what: string, a: unknown, b: unknown) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${what}: expected ${JSON.stringify(a)} got ${JSON.stringify(b)}`);
    };
    for (const c of f.cases) {
      eq(c.rec + ' state', c.state, getProblemState(c.rec));
      for (const k of c.combos) {
        setFlags(m, k.flags);
        m.problem.loadProblem(new TaggedRecord(c.rec));
        const w = c.rec + ' flags ' + k.flags;
        eq(w + ' check', k.check, checkString(m));
        eq(w + ' work', k.work, m.problem.getWorkRecord());
        eq(w + ' hasWork', k.hasWork, m.hasWork());
        eq(w + ' showing', k.showing, m.problem.showingTable);
        if (k.cells !== undefined) eq(w + ' cells', k.cells, snapshot(m));
      }
      for (const [row, col, node, value, commit, errors, code, treeCode] of c.edits) {
        m.setNodeValue(row, col, node, value);
        const cell = m.problem.table.cells[row][col];
        if (commit) cell.commitTreeValue();
        eq(c.rec + ' edit', [errors, code, treeCode], [m.errorCount, cell.getCode(), cell.getTreeCode()]);
      }
      eq(c.rec + ' after', c.after, checkString(m) + '#' + m.problem.getWorkRecord());
      if (diffs.length > 30) break;
    }
    expect(diffs).toEqual([]);
    expect(f.cases.length).toBeGreaterThan(500);
  });

  test(`setup stage sequences (notation ${syntax})`, () => {
    const m = new LPTruthAnalysis(null);
    const diffs: string[] = [];
    const eq = (what: string, a: unknown, b: unknown) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${what}: expected ${JSON.stringify(a)} got ${JSON.stringify(b)}`);
    };
    for (const c of f.setup) {
      setFlags(m, 4);
      m.problem.loadProblem(new TaggedRecord(TaggedRecord.formatField(c.name, '$') + TaggedRecord.formatField(c.statement, '=')));
      const sp = m.problem.setupPanel!;
      for (const step of c.steps) {
        if (step[0] === 'L') {
          sp.lettersText = step[1];
          sp.rowCountText = step[2];
          const e = sp.pressOk();
          eq(c.name + ' letters ' + step[1], [step[3], step[4], step[5]], [idOf(e, true), m.problem.setupStage, m.problem.getWorkRecord()]);
        } else {
          let k = 0;
          for (let i = 0; i < sp.rowCount; i++) for (let j = 0; j < sp.letterCount; j++) sp.setChoice(i, j, Number(step[1].charAt(k++)) - 1);
          const e = sp.pressOk();
          eq(c.name + ' assignments', [step[2], step[3], step[4], step[5]], [idOf(e, false), m.problem.getWorkRecord(), checkString(m), m.problem.setupDone]);
        }
      }
      eq(c.name + ' final', c.final, checkString(m) + '#' + m.problem.getWorkRecord() + '#' + getProblemState(m.saveProblem()));
    }
    expect(diffs).toEqual([]);
  });
}
