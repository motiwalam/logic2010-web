// Writing work files (byte-identical with the desktop, digests included) and verifying digests.
import * as DataFiles from '../../src/engine/data/DataFiles';
import { ScrambledReader } from '../../src/engine/data/Scrambler';
import { readExercises, readProblems, readWork, verifyDigest, writeProblems } from '../../src/engine/problems/LogicModule';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { moduleWorks } from '../../src/engine/program/ModuleConstants';
import { UserInfo } from '../../src/engine/program/UserInfo';
import { repoData } from '../support/fsDataSource';
import { TestProblemSet } from '../support/coreModules';
import { coreFixture } from '../support/fixtures';
import { setJson } from '../support/setJson';

interface Work {
  modules: { key: string; exercisesFile: string; workFile: string; readBack: ReturnType<typeof setJson>; computed: string; legacy: string; userDigestVers: string }[];
  student: {
    original: string; stored: string; computed: string; rewritten: string; names: ReturnType<typeof setJson>;
    editedStored: string; editedComputed: string; nullVersion: string;
  };
}
const problems = (s: number) => coreFixture<{ modules: { derived: string }[] }>(`problems-${s}.json`);

describe.each([1, 2] as const)('notation %i', (syntax) => {
  const f = coreFixture<Work>(`work-${syntax}.json`);
  beforeAll(() => loadProgram(repoData, { syntax }));

  test.each([0, 1, 2, 3, 4, 5])('module %i', async (i) => {
    const m = f.modules[i];
    const key = moduleWorks[i];
    const user = UserInfo.localUser();
    const ex = new TestProblemSet(i);
    await readExercises(ex, key);
    const written = writeProblems(ex, key, user);
    expect(written.fileName).toBe(DataFiles.workFileName(key));
    expect(written.text).toBe(m.exercisesFile);
    expect(user.get(ex.getDigestVersKey())).toBe(m.userDigestVers);
    const work = new TestProblemSet(i);
    readProblems(new ScrambledReader(problems(syntax).modules[i].derived, null, true), work, false, false);
    const w2 = writeProblems(work, key, user);
    expect(w2.text).toBe(m.workFile);
    const back = new TestProblemSet(i);
    await readWork(back, key, { fileName: w2.fileName, text: w2.text });
    expect(setJson(back)).toEqual(m.readBack);
    expect(verifyDigest(back, user)).toEqual({ ok: true, stored: m.computed, computed: m.computed });
    expect(DataFiles.legacyWorkText(w2.fileName, w2.text, key)).toBe(m.legacy);
  });

  test('student work: digest, rewrite, hand edit', async () => {
    const s = f.student;
    const user = UserInfo.localUser();
    const set = new TestProblemSet(0);
    await readWork(set, 'derwork.txt', { fileName: 'derivation.rec', text: s.original });
    expect(setJson(set)).toEqual(s.names);
    expect(verifyDigest(set, user)).toEqual({ ok: true, stored: s.stored, computed: s.computed });
    expect(writeProblems(set, 'derwork.txt', user).text).toBe(s.rewritten);
    expect(s.rewritten).toBe(s.original);
    expect(user.computeDigest(set.records(), null)).toBe(s.nullVersion);
    const edited = new TestProblemSet(0);
    await readWork(edited, 'derwork.txt', { fileName: 'derivation.rec', text: s.original.replace('seconds: 8', 'seconds: 9') });
    expect(verifyDigest(edited, user)).toEqual({ ok: false, stored: s.editedStored, computed: s.editedComputed });
    // the same work in the older one-line format reads the same and passes the check
    const legacy = new TestProblemSet(0);
    await readWork(legacy, 'derwork.txt', { fileName: 'derwork.txt', text: DataFiles.legacyWorkText('derivation.rec', s.original, 'derwork.txt') });
    expect(setJson(legacy).entries).toEqual(s.names.entries);
    expect(verifyDigest(legacy, user).ok).toBe(true);
  });
});
