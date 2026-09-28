/**
 * The Recognition module against tools/oracle/.../OracleRecognition.java: every exercise x
 * every answer (rule names, None, empty, garbage, theorem names, key and near-miss names),
 * checked in an LPRecognition window (result, verdict, comment, status, work record and its
 * state), the active rules of each problem, and user problems.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { RecognitionModule } from '../../src/engine/modules/recognition/LPRecognition';
import { UserInfo } from '../../src/engine/program/UserInfo';
import { ArgumentParser } from '../../src/engine/rules/ArgumentParser';
import { javaTrim } from '../../src/engine/util/java';
import { loadEngine } from '../formula/formulaOracle';

type Result = [string, boolean, string, number, string, 1 | string, number];

interface Fixture {
  checks: { record: string; activeRules: string; activeRange: string; checkDisabled: boolean; results: Result[] }[];
  user: [string, string, string][];
  comments: string[];
}

export function recognitionSuite(syntax: 1 | 2): void {
  const f = JSON.parse(readFileSync(join(__dirname, '../fixtures/recognition', `recognition-${syntax}.json`), 'utf8')) as Fixture;
  let module: RecognitionModule;
  beforeAll(async () => {
    await loadEngine(syntax);
    const r = await RecognitionModule.load({ work: null, user: UserInfo.localUser(), clock: () => 1_000_000 });
    expect(r.error).toBeNull();
    module = r.module!;
  });

  test(`answers are checked as the desktop program does (notation ${syntax})`, () => {
    const w = module.open();
    const mismatches: unknown[] = [];
    for (const c of f.checks) {
      w.loadProblem(c.record);
      const active = [`[${w.activeRules!.join(', ')}]`, w.activeRange!.toString(), w.checkDisabled];
      if (JSON.stringify(active) !== JSON.stringify([c.activeRules, c.activeRange, c.checkDisabled])) mismatches.push({ record: c.record, active });
      const t = new TaggedRecord(c.record);
      for (const e of c.results) {
        const a = e[0];
        w.loadProblem(c.record);
        w.setRuleText(a);
        const ok = w.checkProblem();
        const work = TaggedRecord.stripTimestamp(w.saveProblem());
        const trimmed = javaTrim(a);
        const expected = TaggedRecord.toLine(
          TaggedRecord.formatField(t.getName(), '$') + TaggedRecord.formatField(t.valueAt(t.indexOfAnyTag('=')), '=') + TaggedRecord.formatField(trimmed === '' ? null : trimmed, '*'),
        );
        const actual: Result = [a, ok, w.problem.verdict, f.comments.indexOf(w.problem.comment), javaTrim(w.status), work === expected ? 1 : work, module.getProblemState(work)];
        if (JSON.stringify(actual) !== JSON.stringify(e)) {
          mismatches.push({ record: c.record, actual, expected: e, comment: w.problem.comment, expectedComment: f.comments[e[3]] });
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  test(`user problems are read as the desktop program does (notation ${syntax})`, () => {
    const w = module.open();
    const mismatches: unknown[] = [];
    for (const [s, expected, dots] of f.user) {
      const error = w.loadUserProblem(s);
      const actual = error != null ? 'dialog' : w.saveProblem().replace(/[0-9]+`t$/, '');
      if (actual !== expected || ArgumentParser.normalizeDots(s) !== dots) mismatches.push({ s, actual, expected, dots: ArgumentParser.normalizeDots(s) });
      if (error != null && !['recerr001', 'recerr002'].includes(error.id)) mismatches.push({ s, id: error.id });
    }
    expect(mismatches).toEqual([]);
  });
}
