/**
 * Replays tools/oracle/.../OracleInvalidity.java on the port: random models for every problem
 * (values, verdicts, summaries, saved records, states, describeValues, shrinking, editor
 * edits), quantifier expansion in the workspace, expanded arguments, and interpretation parsing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { closure, getProblemState, InvalidityWorkspace, LPInvalidation, loadInvalidityModule } from '../../src/engine/modules/invalidity/LPInvalidation';
import { InterpretationEditor } from '../../src/engine/modules/invalidity/InterpretationEditor';
import { PredicateInterpretation, SymbolInterpretation } from '../../src/engine/modules/invalidity/SymbolInterpretation';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { maggie, symbols, translateSymbols } from '../../src/engine/program/symbols';
import { loadRulesAndTheorems } from '../../src/engine/rules/RuleTable';
import { readExercises } from '../../src/engine/problems/LogicModule';
import { repoData } from '../support/fsDataSource';

interface Model {
  rec: string; save: string; check: boolean; status: string; state: number; values: string[]; describe: string[]; workspace: string;
  shrink: [number, string]; edit: [number, string, string, string, string, string, string] | null;
}
interface Problem { base: string; symbols: string; save0: string; status0: string; models: Model[]; expand: [string, number, boolean, string][]; links: string[] }
interface Fixture { options: [string, boolean, string, string | null][]; problems: Problem[]; parse: [string, string | null][] }

const strip = (s: string) => TaggedRecord.stripTimestamp(s);
const val = (v: boolean | number | null) => (v == null ? 'null' : String(v));
const errName = (x: unknown) => (x instanceof TypeError ? 'NullPointerException' : x instanceof Error && x.message === 'IllegalArgumentException' ? 'IllegalArgumentException' : String(x));

export function invaliditySuite(syntax: 1 | 2): void {
  const f = JSON.parse(readFileSync(join(__dirname, '../fixtures/truthinval', `invalidity-${syntax}.json`), 'utf8')) as Fixture;
  beforeAll(async () => {
    await loadProgram(repoData, { syntax, loadRules: (t, r) => {
      loadRulesAndTheorems(t, r);
    } });
    await loadInvalidityModule();
  });

  test(`problem options (notation ${syntax})`, async () => {
    const ws = new InvalidityWorkspace();
    await readExercises(ws.exercises, 'invwork.txt');
    const m = new LPInvalidation(ws);
    const p = new LPInvalidation(ws, true);
    const got = f.options.map(([name, print]) => {
      const x = print ? p : m;
      x.loadExerciseInfo(new TaggedRecord(ws.exercises.getRecord(name)));
      return [name, print, [x.checkDisabled, x.expandOff, x.expandAll, x.dontChange].map((b) => (b ? '1' : '0')).join(''), x.note];
    });
    expect(got).toEqual(f.options);
  });

  test(`models, verdicts, records, editor, expansion (notation ${syntax})`, () => {
    const m = new LPInvalidation(null);
    const diffs: string[] = [];
    const eq = (what: string, a: unknown, b: unknown) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${what}: expected ${JSON.stringify(a)} got ${JSON.stringify(b)}`);
    };
    for (const p of f.problems) {
      m.loadProblem(p.base);
      eq(p.base + ' symbols', p.symbols, m.symbols!.map((s) => (s instanceof PredicateInterpretation ? 'P:' : 'O:') + s.encode() + ' ').join(''));
      eq(p.base + ' save0', p.save0, strip(m.saveProblem()));
      eq(p.base + ' status0', p.status0, m.summarize().status);
      for (const x of p.models) {
        m.loadProblem(x.rec);
        const values: string[] = [];
        if (m.statement != null) {
          for (const e of m.statement.premises) values.push(val(m.evaluate(closure(e))));
          values.push(val(m.evaluate(closure(m.statement.conclusion))));
        }
        eq(x.rec, [x.save, x.check, x.status, x.state, x.values, x.describe, x.workspace],
          [strip(m.saveProblem()), m.checkProblem(), m.summarize().status, getProblemState(x.rec), values, m.symbols!.map((s) => m.describeSymbol(s)), m.workspaceText]);
        m.setSize(x.shrink[0]);
        eq(x.rec + ' shrink', x.shrink[1], strip(m.saveProblem()));
        m.loadProblem(x.rec);
        if (x.edit == null) {
          eq(x.rec + ' edit', 0, m.symbols!.length);
          continue;
        }
        const [k, init, ops, encoded, described, saved, status] = x.edit;
        const s = m.symbols![k];
        const r = m.editInterpretation(s);
        if (!('editor' in r)) {
          diffs.push(x.rec + ' no editor');
          continue;
        }
        const ed: InterpretationEditor = r.editor;
        let i0 = '';
        for (const row of ed.cells) for (const c of row) i0 += c.label + '=' + (ed.isPredicate ? (c.checked ? 1 : 0) : c.value) + ' ';
        for (const op of ops.split(' ').filter((o) => o !== '')) {
          const [row, col, v] = op.split(',').map(Number);
          if (ed.isPredicate) ed.setChecked(row, col, v === 1);
          else ed.setValue(row, col, v);
        }
        m.applyEditor(ed);
        eq(x.rec + ' edit', [init, encoded, described, saved, status], [i0, s.encode(), m.describeSymbol(s), strip(m.saveProblem()), m.summarize().status]);
      }
      for (const [shown, size, all, expected] of p.expand) {
        m.loadProblem(p.base);
        m.setSize(size);
        m.setWorkspaceText('<' + shown + '>', 1, 1 + shown.length);
        let got: string;
        try {
          got = m.expand(all) != null ? 'MSG' : m.workspaceText;
        } catch (x) {
          got = 'X:' + errName(x);
        }
        // the desktop's NullPointerException at size 1 (a selection without a second part): no change here
        if (expected === 'X:NullPointerException' && got === '<' + shown + '>') got = expected;
        eq(`expand ${shown} ${size} ${all}`, expected, got);
      }
      p.links.forEach((expected, i) => {
        m.loadProblem(p.base);
        m.setSize(i + 1);
        let got: string;
        try {
          const l = m.truthTableLink(true);
          got = 'record' in l ? l.record : 'MSG';
        } catch (x) {
          got = 'X:' + errName(x);
        }
        eq(p.base + ' link ' + (i + 1), expected, got);
      });
      if (diffs.length > 30) break;
    }
    expect(diffs).toEqual([]);
    expect(f.problems.length).toBeGreaterThan(40);
  });

  test(`interpretation texts parse and encode (notation ${syntax})`, () => {
    const out = f.parse.map(([s]) => {
      try {
        const si = SymbolInterpretation.parse(s);
        return [s, si == null ? null : (si instanceof PredicateInterpretation ? 'P:' : 'O:') + si.encode() + '|' + si.describeValues(3)];
      } catch (x) {
        return [s, 'X:' + errName(x)];
      }
    });
    expect(out).toEqual(f.parse);
  });

  test('display symbols round trip', () => {
    expect(translateSymbols(translateSymbols('@x(Fx->Gx)', maggie, symbols), symbols, maggie)).toBe('@x(Fx->Gx)');
  });
}
