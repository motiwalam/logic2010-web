/**
 * The Stack view and the Applicable rules view at many cursor positions of the worked
 * examples and a student's work, against the desktop program.
 */
import { describe, expect, test } from 'vitest';
import { computeStack, textBeforeCursor } from '../../src/engine/modules/derivation/DerivationStackView';
import { computeRules } from '../../src/engine/modules/derivation/DerivationRulesView';
import { derivationFixture, loadDerivation, RecordingDialogs, windowModule } from './support';

interface View {
  name: string;
  n: number;
  caret: number;
  before: string;
  formulas: string[];
  origins: string[];
  error: string | null;
  closed: string | null;
  rules?: { error: string | null; closed: string | null; rows: [string, string, string | null, number, number, boolean, string | null, string][] };
}

for (const syntax of [1, 2] as const) {
  for (const student of [false, true]) {
    const name = `stack-${student ? 'student-' : ''}${syntax}.json`;
    describe(name, () => {
      test('stack and rules views match the desktop program', async () => {
        const fixture = derivationFixture<{ views: View[] }>(name);
        const ws = await loadDerivation(syntax, student);
        let current = '';
        let m = windowModule(ws, new RecordingDialogs());
        for (const v of fixture.views) {
          if (v.name !== current) {
            current = v.name;
            m = windowModule(ws, new RecordingDialogs());
            const i = ws.problems.indexOfName(v.name);
            m.loadProblem(ws.problems.getRecordAt(i));
            m.problemIndex = i;
          }
          const l = m.getLines().find((x) => x.getLineNumber() === v.n)!;
          const a = l.annotationEditor!.getText();
          const before = textBeforeCursor(a, v.caret);
          const snap = await computeStack(l, before);
          const actual: View = {
            name: v.name,
            n: v.n,
            caret: v.caret,
            before,
            formulas: snap.formulas.map(String),
            origins: snap.origins,
            error: snap.error,
            closed: snap.closed,
          };
          if (v.rules) {
            const r = await computeRules(l, before);
            actual.rules = {
              error: r.error,
              closed: r.closed,
              rows: r.rules.map((x) => [x.rule, x.result, x.lock, x.group, x.unknowns, x.matchesLine, x.command, x.details()]),
            };
          }
          expect(actual, `${v.name} line ${v.n} at ${v.caret}`).toEqual(v);
        }
      }, 600000);
    });
  }
}
