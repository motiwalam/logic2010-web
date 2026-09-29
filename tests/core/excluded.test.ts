// The web program leaves out the Practice Blue Book Exam problems (excludedProblems.ts).
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { isBlueBookProblem, setExcludeBlueBookProblems } from '../../src/engine/problems/excludedProblems';
import { readExercises, readWork, verifyDigest, writeProblems } from '../../src/engine/problems/LogicModule';
import { ProblemCounts, ProblemListModel } from '../../src/engine/problems/ProblemList';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { moduleWorks } from '../../src/engine/program/ModuleConstants';
import { UserInfo } from '../../src/engine/program/UserInfo';
import derivationModule from '../../src/ui/modules/derivation/index';
import truthModule from '../../src/ui/modules/truth/index';
import { repoData } from '../support/fsDataSource';
import { TestProblemSet } from '../support/coreModules';

const BLUE_BOOK_COUNTS = [48, 5, 0, 0, 23, 9];

async function exercises(i: number): Promise<TestProblemSet> {
  const set = new TestProblemSet(i);
  await readExercises(set, moduleWorks[i]);
  return set;
}

function names(set: TestProblemSet): string[] {
  return set.records().map((r) => TaggedRecord.nameOf(r)!);
}

afterEach(() => setExcludeBlueBookProblems(false));

describe.each([1, 2] as const)('notation %i', (syntax) => {
  beforeAll(() => loadProgram(repoData, { syntax }));

  test.each([0, 1, 2, 3, 4, 5])('module %i: no Blue Book problems or headings', async (i) => {
    const all = await exercises(i);
    const blue = all.records().filter((r) => isBlueBookProblem(r));
    expect(blue.length).toBe(BLUE_BOOK_COUNTS[i]);
    for (const r of blue) expect(TaggedRecord.nameOf(r)).toMatch(/ \d\.7\d\d$/);
    setExcludeBlueBookProblems(true);
    const set = await exercises(i);
    expect(names(set)).toEqual(names(all).filter((n) => !/ \d\.7\d\d$/.test(n)));
    expect(set.records().some((r) => isBlueBookProblem(r))).toBe(false);
    // headings: the Blue Book ones are gone, every other heading is still there, in order
    const headings = (s: TestProblemSet) => [...s.records()].flatMap((r) => s.headingsByName!.get(TaggedRecord.nameOf(r)!) ?? []);
    const blueHeadings = (s: TestProblemSet) => headings(s).filter((h) => h.includes('Blue Book'));
    expect(blueHeadings(set)).toEqual([]);
    const allHeadings = [...all.records()].flatMap((r) => all.headingsByName!.get(TaggedRecord.nameOf(r)!) ?? []);
    const kept = headings(set);
    expect(kept.filter((h) => h.trim() !== '')).toEqual(allHeadings.filter((h) => h.trim() !== '' && !h.includes('Blue Book')));
    // the list and its counts
    const work = new TestProblemSet(i);
    await readWork(work, moduleWorks[i], null);
    work.exercises = set;
    expect(work.size()).toBe(set.size());
    const model = new ProblemListModel(work, set, {});
    expect(model.allRows.some((r) => r.kind === 'heading' && r.text.includes('Blue Book'))).toBe(false);
    expect(model.allRows.some((r) => r.kind === 'problem' && / \d\.7\d\d/.test(r.text))).toBe(false);
    const counted = new ProblemCounts(work, set, model).count(model.allRowToProblem)[1];
    const allWork = new TestProblemSet(i);
    setExcludeBlueBookProblems(false);
    await readWork(allWork, moduleWorks[i], null);
    allWork.exercises = all;
    const allModel = new ProblemListModel(allWork, all, {});
    expect(new ProblemCounts(allWork, all, allModel).count(allModel.allRowToProblem)[1] - counted).toBe(BLUE_BOOK_COUNTS[i]);
  });

  test('the chapter heading before a Blue Book group moves to the next problem', async () => {
    setExcludeBlueBookProblems(true);
    const set = await exercises(5);
    const h = set.headingsByName!.get('TruTb 3.801')!;
    expect(h.join('\n')).toMatch(/CHAPTER III[\s\S]*Computer Exam mode/);
  });

  test('work with Blue Book problems loads without them, verifies and saves them back', async () => {
    const user = UserInfo.localUser();
    const work = new TestProblemSet(0);
    await readWork(work, 'derwork.txt', null);
    const i = work.indexOfName('Deriv 1.701');
    const r = new TaggedRecord(work.getRecordAt(i));
    r.addField('<', 'P');
    r.addField('>', 'ASS CD');
    work.replaceProblem(r.toString(), i);
    const saved = writeProblems(work, 'derwork.txt', user).text;
    expect(saved).toContain('problem: Deriv 1.701');

    setExcludeBlueBookProblems(true);
    const back = new TestProblemSet(0);
    await readWork(back, 'derwork.txt', { fileName: 'derivation.rec', text: saved });
    expect(back.records().some((x) => isBlueBookProblem(x))).toBe(false);
    expect(back.getEntry('Deriv 1.701')).toBeNull();
    expect(back.excludedRecords.length).toBe(48);
    expect(verifyDigest(back, user).ok).toBe(true);
    // saving keeps the student's Blue Book work where it was
    expect(writeProblems(back, 'derwork.txt', user).text).toBe(saved);
  });

  test('summarize totals leave them out', async () => {
    // the course problems saved as work
    const text = async (i: number) => {
      const set = new TestProblemSet(i);
      await readWork(set, moduleWorks[i], null);
      return writeProblems(set, moduleWorks[i], UserInfo.localUser()).text;
    };
    const der = await text(0);
    const tru = await text(5);
    const off = [(await derivationModule.summarize!(der, { notation: syntax })).total, (await truthModule.summarize!(tru, { notation: syntax })).total];
    setExcludeBlueBookProblems(true);
    const on = [(await derivationModule.summarize!(der, { notation: syntax })).total, (await truthModule.summarize!(tru, { notation: syntax })).total];
    expect([off[0]! - on[0]!, off[1]! - on[1]!]).toEqual([48, 9]);
  });
});
