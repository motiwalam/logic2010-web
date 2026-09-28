/**
 * Differential tests of the Symbolization engine against tools/oracle OracleSymbolization:
 * every problem with answers, each answer and mutations of it as student work (check
 * status, error buttons and messages, closest answer, the error dialog's Up/Text/Symb,
 * evaluateWork, hints, direct entry, connective changes), scheme parsing and the restate
 * of the exercises and the work.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { UserInfo } from '../../src/engine/program/UserInfo';
import { loadRulesAndTheorems } from '../../src/engine/rules/RuleTable';
import { javaTrim, stringHash } from '../../src/engine/util/java';
import {
  getProblemState,
  LPSymbolizer,
  NodeMessage,
  parseScheme,
  encodeScheme,
  type SymbolizationError,
  SymbolizationModule,
  type SymbolizationNode,
  type SymbolizationProblemSet,
  type SymbolizationEntry,
} from '../../src/engine/modules/symbolization';
import { maggie, symbols, translateSymbols } from '../../src/engine/program/symbols';
import { repoData } from '../support/fsDataSource';

interface ErrorJson {
  path: string;
  known: boolean;
  answer: string;
  tb: string;
  ab: string;
  id: string;
  hash: number;
  text?: string;
}
interface Case {
  problem: string;
  index: number;
  answer: number;
  mutation: string;
  work: string;
  formula: string;
  record: string;
  status: string;
  errorCount: number;
  countAnswers: number;
  closest: string | null;
  matching: number | null;
  errors: ErrorJson[];
  actions?: { up: ({ path: string; hash: number } | 'beep')[]; text: string; symbException: string | null; symb: string };
  evaluated: string;
  state: number;
  answerIndex: number;
  hints?: ({ kind: 'none' } | { kind: 'hint'; hash: number } | { kind: 'error'; count: number; errors: ErrorJson[] })[];
  direct?: { formula: string; exception: string | null; record: string }[];
  edits?: { path: string; kind: number; exception: string | null; next: string | null; record: string }[];
}
interface Fixture {
  exerciseStates: [string, number, number][];
  problemStates: [string, number, number][];
  schemes: { scheme: string; rows: [string, string][]; encoded: string }[];
  cases: Case[];
}

function fixture(syntax: number): Fixture {
  const path = join(__dirname, '../fixtures/symbolization', `symbolization-${syntax}.json.gz`);
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as Fixture;
}

function states(set: SymbolizationProblemSet): [string, number, number][] {
  return set.elements().map((e) => [TaggedRecord.nameOf(e.name)!, e.state, (e as SymbolizationEntry).answerIndex]);
}

function pathOf(n: SymbolizationNode): string {
  return n.path().join('');
}

function errorsJson(root: SymbolizationNode, withText: boolean): ErrorJson[] {
  const out: ErrorJson[] = [];
  for (const n of root.preorder()) {
    const panel = n.getConnectivePanel();
    if (panel == null) continue;
    for (const b of panel.buttons) {
      const m = b.buildMessage();
      const e: ErrorJson = {
        path: pathOf(n),
        known: panel.errorButton === b,
        answer: pathOf(b.answer),
        tb: b.targetBinders.join(','),
        ab: b.answerBinders.join(','),
        id: m.id,
        hash: stringHash(m.text),
      };
      if (withText) e.text = m.text;
      out.push(e);
    }
  }
  return out;
}

export function symbolizationSuite(syntax: 1 | 2): void {
  const fx = fixture(syntax);
  let m: SymbolizationModule;
  let lp: LPSymbolizer;
  let notices = 0;

  beforeAll(async () => {
    await loadProgram(repoData, { syntax, loadRules: (t, r) => void loadRulesAndTheorems(t, r) });
    m = await SymbolizationModule.load({ work: null, userKey: null, user: UserInfo.localUser() });
    lp = new LPSymbolizer(m, { now: () => 0 });
    lp.onNotice = () => notices++;
    m.onNotice = () => notices++;
  });

  function loadCase(c: Case, work: string | null): void {
    lp.loadProblem(m.problems!.getRecordAt(c.index));
    lp.problemIndex = c.index;
    if (work != null) lp.problem.loadRecord(new TaggedRecord(work), false, false);
  }

  test(`exercise and work states match after the restate (notation ${syntax})`, () => {
    expect(states(m.exercises!)).toEqual(fx.exerciseStates);
    expect(states(m.problems!)).toEqual(fx.problemStates);
  });

  test(`schemes parse and encode as on the desktop (notation ${syntax})`, () => {
    for (const s of fx.schemes) {
      const rows = parseScheme(s.scheme);
      expect(rows.map((r) => [r.symbol, r.english])).toEqual(s.rows);
      expect(encodeScheme(rows)).toBe(s.encoded);
    }
    expect(fx.schemes.length).toBeGreaterThan(100);
  });

  test(`checks, errors, hints, actions, evaluateWork, direct entry and edits match (notation ${syntax})`, () => {
    const diffs: string[] = [];
    const cmp = (c: Case, what: string, actual: unknown, expected: unknown): void => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        diffs.push(`${c.problem} #${c.answer} ${c.mutation} ${what}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
      }
    };
    for (const c of fx.cases) {
      if (diffs.length > 30) break;
      loadCase(c, c.work);
      const e0 = lp.errorCount;
      lp.checkProblem();
      const closest = lp.problem.findClosestAnswer();
      cmp(c, 'formula', lp.problem.toString(), c.formula);
      cmp(c, 'record', lp.problem.toRecord(true), c.record);
      cmp(c, 'status', javaTrim(lp.status ?? ''), c.status);
      cmp(c, 'errorCount', lp.errorCount - e0, c.errorCount);
      cmp(c, 'countAnswers', lp.problem.countAnswers(), c.countAnswers);
      cmp(c, 'closest', closest == null ? null : closest.toRecord(true), c.closest);
      cmp(c, 'matching', closest == null ? null : lp.problem.countMatchingNodes(closest), c.matching);
      cmp(c, 'errors', errorsJson(lp.problem, c.errors.some((e) => e.text !== undefined)), c.errors);

      if (c.actions) {
        const eb: SymbolizationError | undefined = lp.problem.preorder().find((n) => n.panel?.errorButton != null)?.panel!.errorButton ?? undefined;
        if (eb == null) {
          diffs.push(`${c.problem} ${c.mutation}: no error button for actions`);
        } else {
          const up: ({ path: string; hash: number } | 'beep')[] = [];
          const msg = eb.buildMessage();
          for (let i = 0; i < 10; i++) {
            const before = msg.target;
            msg.perform('up');
            if (msg.target === before) {
              up.push('beep');
              break;
            }
            up.push({ path: pathOf(msg.target), hash: stringHash(msg.text) });
          }
          cmp(c, 'up', up, c.actions.up);
          eb.buildMessage().perform('text');
          cmp(c, 'text', eb.target.text, c.actions.text);
          const n0 = notices;
          let asked = false;
          const sm: NodeMessage = eb.buildMessage();
          sm.perform('symb', () => {
            asked = true;
            return null;
          });
          // (headless, askForSymbol fails first with IllegalComponentStateException, a message with HeadlessException)
          cmp(c, 'symbException', asked ? 'IllegalComponentStateException' : notices !== n0 ? 'HeadlessException' : null, c.actions.symbException);
          cmp(c, 'symb', lp.problem.toRecord(true), c.actions.symb);
        }
      }

      loadCase(c, c.work);
      const full = lp.problem.toRecord(true);
      cmp(c, 'evaluated', full, c.evaluated);
      const entry = getProblemState(full, m.problems!, null);
      cmp(c, 'state', [entry.state, entry.answerIndex], [c.state, c.answerIndex]);

      if (c.hints) {
        loadCase(c, c.work);
        const paths = lp.problem.preorder().map(pathOf);
        const hints: unknown[] = [];
        for (const p of paths) {
          loadCase(c, c.work);
          const node = lp.problem.nodeAt(p.split('').map(Number))!;
          const before = lp.errorCount;
          const r = lp.showHint(node);
          if (r.kind === 'hint') hints.push({ kind: 'hint', hash: stringHash(r.message.text) });
          else if (lp.problem.findClosestAnswer() == null) hints.push({ kind: 'none' });
          else hints.push({ kind: 'error', count: lp.errorCount - before, errors: errorsJson(lp.problem, false) });
        }
        cmp(c, 'hints', hints, c.hints);
      }

      for (const d of c.direct ?? []) {
        loadCase(c, null);
        lp.directEntryDisabled = false;
        const n0 = notices;
        // (on the desktop the parse error's dialog is modal and the rest of the direct entry
        // follows; the oracle's headless dialog throws instead, ending it there)
        if (d.exception != null) lp.problem.buildFromText(translateSymbols(d.formula, symbols, maggie));
        else lp.enterDirectSymbolization(d.formula);
        cmp(c, 'direct ' + d.formula, [notices !== n0 ? 'HeadlessException' : null, lp.problem.toRecord(true)], [d.exception, d.record]);
      }

      if (c.edits) {
        const got: unknown[] = [];
        for (const e of c.edits) {
          loadCase(c, c.work);
          const n = lp.problem.nodeAt(e.path.split('').map(Number))!;
          let asked = false;
          const next = n.setConnective(e.kind, e.kind === 11 ? 'Fx' : null, false, () => {
            asked = true;
            return null;
          });
          got.push({
            path: e.path,
            kind: e.kind,
            exception: asked ? 'HeadlessException' : null,
            next: asked || next == null ? null : pathOf(next),
            record: lp.problem.toRecord(true),
          });
        }
        cmp(c, 'edits', got, c.edits);
      }
    }
    expect(diffs).toEqual([]);
    expect(fx.cases.length).toBeGreaterThan(1000);
  });
}
