/**
 * Check (serial mode) of every problem with work, against the desktop program: the worked
 * examples of the course files (a fresh student's work) and a real student's work, in both
 * notations. Compares each line's message, the state, the title status, the error count, the
 * dialogs, the saved messages and the re-encoded work; and the states the restate computes.
 */
import { describe, expect, test } from 'vitest';
import { hasWork } from '../../src/engine/modules/derivation/DerivationProblemSet';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { derivationFixture, encode, loadDerivation, RecordingDialogs, treeRecord, windowModule, type DialogRecord, type LineRecord } from './support';

interface CheckFixture {
  states: [string, number][];
  checks: {
    name: string;
    record: string;
    loaded: string;
    ok: boolean;
    state: number;
    status: string;
    errors: number;
    error: string | null;
    lines: LineRecord[];
    dialogs: DialogRecord[];
    messages: string;
    saved: string;
  }[];
}

for (const syntax of [1, 2] as const) {
  for (const student of [false, true]) {
    const name = `check-${student ? 'student-' : ''}${syntax}.json`;
    describe(name, () => {
      test('states and checks match the desktop program', async () => {
        const fixture = derivationFixture<CheckFixture>(name);
        const ws = await loadDerivation(syntax, student);
        const states = ws.problems.elements().map((e) => [TaggedRecord.nameOf(e.name), e.state]);
        expect(states).toEqual(fixture.states);
        const dialogs = new RecordingDialogs();
        for (const c of fixture.checks) {
          const i = ws.problems.indexOfName(c.name);
          const record = ws.problems.getRecordAt(i)!;
          expect(hasWork(new TaggedRecord(record))).toBe(true);
          const m = windowModule(ws, dialogs);
          m.loadProblem(record);
          m.problemIndex = i;
          const loaded = encode(m);
          dialogs.reset();
          const ok = await m.checkProblem();
          const actual = {
            name: c.name,
            record,
            loaded,
            ok,
            state: ok ? 2 : m.proofMissing ? 3 : 1,
            status: m.titleState.status,
            errors: m.errorCount,
            error: null,
            lines: treeRecord(m),
            dialogs: dialogs.log,
            messages: m.saveMessages(),
            saved: encode(m),
          };
          expect(actual).toEqual(c);
        }
      }, 120000);
    });
  }
}
