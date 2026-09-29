/** The theorems of the Applicable panel (a web-only addition to the desktop's rules view). */
import { expect, test } from 'vitest';
import { availableTheorems, ruleLock } from '../../src/engine/modules/derivation/DerivationRulesView';
import { STATE_CORRECT } from '../../src/engine/problems/ProblemEntry';
import { ruleTable } from '../../src/engine/rules/RuleTable';
import { loadDerivation, RecordingDialogs, windowModule } from './support';

test('the theorems the checker accepts here, as rows that push their formula', async () => {
  const ws = await loadDerivation(1, false);
  const m = windowModule(ws, new RecordingDialogs());
  const theorems = ruleTable!.theorems!;
  const listed = (name: string) => {
    m.loadProblem(ws.problems.getRecord(name));
    m.problem.insertLine(-1);
    return availableTheorems(m.getLines()[1]);
  };
  // in the problem that proves T1: T1 never; T2 only once its proof problem is solved
  let own = listed('Deriv 1.101 T1');
  expect(own.map((a) => a.rule)).not.toContain('T1');
  expect(own.map((a) => a.rule)).not.toContain('T2');
  ws.problems.getEntry('Deriv 1.102 T2')!.state = STATE_CORRECT;
  own = listed('Deriv 1.101 T1');
  expect(own.map((a) => a.rule)).toContain('T2');
  expect(own.map((a) => a.rule)).not.toContain('T1');
  // elsewhere it is, with its formula (letters as unknowns) and how it is typed
  ws.problems.getEntry('Deriv 1.101 T1')!.state = STATE_CORRECT;
  const rows = listed('Deriv 1.002');
  const t1 = rows.find((a) => a.rule === 'T1')!;
  expect(t1.command).toBe('T1');
  expect(t1.group).toBe(2);
  expect(t1.unknowns).toBeGreaterThan(0);
  expect(t1.result).toMatch(/\?P/);
  expect(t1.form).toMatch(/^Theorem 1: /);
  // exactly the unlocked theorems, in order
  const expected = theorems.numbers().filter((n) => ruleLock(m, theorems.getTheorem(n)!) == null).map((n) => 'T' + n);
  expect(rows.map((a) => a.rule)).toEqual(expected);
});
