// readExercises / readWork / mergeExercises / findExtraProblems for every module, both notations.
import { findExtraProblems, readExercises, readProblems, readWork } from '../../src/engine/problems/LogicModule';
import { ScrambledReader } from '../../src/engine/data/Scrambler';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { moduleWorks } from '../../src/engine/program/ModuleConstants';
import { repoData } from '../support/fsDataSource';
import { overlay, TestProblemSet } from '../support/coreModules';
import { coreFixture } from '../support/fixtures';
import { setJson, type SetJson } from '../support/setJson';

describe.each([1, 2] as const)('notation %i', (syntax) => {
  const f = coreFixture<{
    modules: { key: string; exercises: SetJson; fresh: SetJson; derived: string; merged: SetJson; changed: boolean; extra: string[]; onlyLocal: SetJson }[];
  }>(`problems-${syntax}.json`);
  beforeAll(() => loadProgram(repoData, { syntax }));

  test.each([0, 1, 2, 3, 4, 5])('module %i', async (i) => {
    const m = f.modules[i];
    const key = moduleWorks[i];
    expect(m.key).toBe(key);
    const ex = new TestProblemSet(i);
    expect(await readExercises(ex, key)).toBe(true);
    expect(setJson(ex)).toEqual(m.exercises);
    const fresh = new TestProblemSet(i);
    expect(await readWork(fresh, key, null)).toBe(true);
    expect(setJson(fresh)).toEqual(m.fresh);
    const work = new TestProblemSet(i);
    readProblems(new ScrambledReader(m.derived, null, true), work, false, false);
    work.exercises = ex;
    expect(work.mergeExercises()).toBe(m.changed);
    const extra = await findExtraProblems(key, work);
    expect(setJson(work)).toEqual(m.merged);
    expect([...extra].sort()).toEqual(m.extra);
    const onlyLocal = new TestProblemSet(i);
    await readExercises(onlyLocal, key, { noCore: true });
    expect(setJson(onlyLocal)).toEqual(m.onlyLocal);
  });
});

describe.each([1, 2] as const)('local problem files, notation %i', (syntax) => {
  const f = coreFixture<{ modules: { key: string; file: string; text: string; exercises: SetJson; onlyLocal: SetJson; fresh: SetJson; extra: string[] }[] }>(
    `local-${syntax}.json`,
  );
  const files = Object.fromEntries(f.modules.map((m) => [m.file, m.text]));
  beforeAll(() => loadProgram(overlay(repoData, files), { syntax }));

  test.each([0, 1, 2, 3, 4, 5])('module %i', async (i) => {
    const m = f.modules[i];
    const ex = new TestProblemSet(i);
    await readExercises(ex, m.key);
    expect(setJson(ex)).toEqual(m.exercises);
    const onlyLocal = new TestProblemSet(i);
    await readExercises(onlyLocal, m.key, { noCore: true });
    expect(setJson(onlyLocal)).toEqual(m.onlyLocal);
    const fresh = new TestProblemSet(i);
    await readWork(fresh, m.key, null);
    const extra = await findExtraProblems(m.key, fresh);
    expect(setJson(fresh)).toEqual(m.fresh);
    expect([...extra].sort()).toEqual(m.extra);
  });
});
