// The derivation problem list: rows, headings, colours, search filter and counts.
import { readExercises, readWork } from '../../src/engine/problems/LogicModule';
import { ProblemCounts, ProblemListModel } from '../../src/engine/problems/ProblemList';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { ProblemSelector } from '../../src/engine/program/ProblemSelector';
import { repoData } from '../support/fsDataSource';
import { TestProblemSet } from '../support/coreModules';
import { coreFixture, coreFixtureText } from '../support/fixtures';
import { setJson } from '../support/setJson';

type Row = [number, string, string | null, number];
interface List {
  notes: (string | null)[];
  work: ReturnType<typeof setJson>;
  lists: {
    multiple: boolean; showHidden: boolean; excluding: boolean; rows: Row[]; selected: number; searchTexts: (string | null)[];
    filters: { query: string; rows: Row[]; selected: number; count: string }[];
  }[];
}
const f = coreFixture<List>('list.json');
// the desktop's colours: black, red, green, red, black by state; orange if restricted; blue headings
const BLUE = -16776961;
const byState = [-16777216, -4390912, -16734208, -4390912, -16777216];
const ORANGE = -29696;
const orange = [-16777216, ORANGE, ORANGE, ORANGE, -16777216];

function rowsOf(model: ProblemListModel, set: TestProblemSet): Row[] {
  return model.rows.map((r, i) =>
    r.kind === 'heading'
      ? [model.rowToProblem[i], r.text, null, BLUE]
      : [model.rowToProblem[i], r.text, r.hover, (r.restricted ? orange : byState)[set.getEntryAt(r.index)!.state]],
  );
}

beforeAll(() => loadProgram(repoData, { syntax: 1 }));

test('problem list and search', async () => {
  const ex = new TestProblemSet(0);
  await readExercises(ex, 'derwork.txt');
  const work = new TestProblemSet(0);
  await readWork(work, 'derwork.txt', { fileName: 'derivation.rec', text: coreFixtureText('student-derivation.rec') });
  work.exercises = ex;
  work.mergeExercises();
  for (let i = 0; i < work.size(); i++) {
    work.getEntryAt(i)!.state = i % 5;
    if (i % 97 === 5) work.getEntryAt(i)!.hidden = true;
  }
  expect(setJson(work)).toEqual(f.work);
  work.searchNotes = f.notes;
  const restrict = new ProblemSelector('{"Deriv 1.7",~"Deriv 2.1"}');
  const exclude = new ProblemSelector('{"Deriv 3.0","Deriv 3.1"}');
  for (const v of f.lists) {
    const model = new ProblemListModel(work, ex, { multiple: v.multiple, showHidden: v.showHidden, restrict, exclude: v.excluding ? exclude : null });
    expect(rowsOf(model, work)).toEqual(v.rows);
    expect(model.selectedRow).toBe(v.selected);
    expect(model.searchTexts).toEqual(v.searchTexts);
    const counts = new ProblemCounts(work, ex, model);
    for (const q of v.filters) {
      model.setFilter(q.query);
      expect(rowsOf(model, work), q.query).toEqual(q.rows);
      expect(model.selectedRow, q.query).toBe(q.selected);
      expect(counts.label(q.query)).toBe(q.count);
    }
  }
});
