/**
 * DerivationProblemSet: the search notes ("proves ...") against the desktop program (the core
 * list fixture), the rule-proof index, the user rules, and the problem operations.
 */
import { expect, test } from 'vitest';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { coreFixture } from '../support/fixtures';
import { STATE_NO_WORK } from '../../src/engine/problems/ProblemEntry';
import * as ops from '../../src/engine/modules/derivation/problemOperations';
import { ErrorRef } from '../../src/engine/program/Message';
import { loadDerivation, RecordingDialogs, windowModule } from './support';

test('search notes match the desktop program', async () => {
  const ws = await loadDerivation(1, true);
  const notes = coreFixture<{ notes: (string | null)[] }>('list.json').notes;
  const actual = ws.problems.elements().map((e) => ws.problems.getSearchNote(new TaggedRecord(e.name)));
  expect(actual).toEqual(notes);
});

test('problem operations', async () => {
  const ws = await loadDerivation(1, false);
  const m = windowModule(ws, new RecordingDialogs());
  // a user problem, saved under a name
  expect(await ops.enterUserProblem(m, 'P . P→Q ∴ Q')).toBe(true);
  expect(ops.saveNeedsName(m)).toBe(true);
  expect(ops.validateProblemName(m, '  ')).toBeInstanceOf(ErrorRef);
  expect(ops.validateProblemName(m, 'Deriv 1.001EG1')).toBeInstanceOf(ErrorRef);
  expect(await ops.save(m, 'UR MP2')).toBe(true);
  const i = ws.problems.indexOfName('UR MP2');
  expect(i).toBeGreaterThanOrEqual(0);
  expect(ws.userRules!.getRule('UR MP2')).not.toBeNull();
  // an exercise: open, delete its work
  const j = ws.problems.indexOfName('Deriv 1.001EG1');
  await ops.openProblem(m, j);
  expect(ops.deleteKind(m)).toBe('work');
  expect(ops.nextProblemIndex(m)).toBe(j + 1);
  // an example's work is only removed from the window
  expect(ops.deleteWork(m)).toBe(false);
  expect(m.problem.getContentCount()).toBe(1);
  const k = ws.problems.indexOfName('Deriv 1.001');
  await ops.openProblem(m, k);
  expect(ops.deleteWork(m)).toBe(true);
  expect(ws.problems.getEntryAt(k)!.state).toBe(STATE_NO_WORK);
  // deleting a user problem
  await ops.openProblem(m, ws.problems.indexOfName('UR MP2'));
  expect(ops.deleteKind(m)).toBe('problem');
  expect(ops.deleteProblem(m)).toBe(true);
  expect(ws.problems.indexOfName('UR MP2')).toBe(-1);
  // line breaks are refused (not093)
  const d = new RecordingDialogs();
  m.dialogs = d;
  expect(await ops.enterUserProblem(m, 'P\nQ')).toBe(false);
  expect(d.log[0].title).toBe('Not093');
});

test('inference rules list and keypad', async () => {
  const { inferenceRules } = await import('../../src/engine/modules/derivation/inferenceRules');
  const { keypadFor } = await import('../../src/engine/modules/derivation/keypad');
  const ws = await loadDerivation(1, false);
  const all = inferenceRules(ws, null);
  const m = windowModule(ws, new RecordingDialogs());
  await ops.openProblem(m, ws.problems.indexOfName('Deriv 1.001EG1'));
  const available = inferenceRules(ws, m);
  const names = all.items.filter((x) => x.type === 'rule').map((x) => (x.type === 'rule' ? x.name : ''));
  expect(names).toContain('MP');
  expect(names).toContain('T1');
  const mp = available.items.find((x) => x.type === 'rule' && x.name === 'MP');
  expect(mp && mp.type === 'rule' && mp.ticked).toBe(true);
  expect(keypadFor(m.getLines().find((l) => l.annotationEditor != null)!.annotationEditor!).length).toBe(4);
});
