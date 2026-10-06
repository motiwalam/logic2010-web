// "Incomplete only" in the problem list: completed problems and worked examples (even incorrect
// ones) go, except the open one, and so do headings with nothing left under them.
import { onlyIncomplete, type ProblemRow } from '../../src/ui/components/ProblemList';

const h = (text: string): ProblemRow => ({ kind: 'heading', text });
const p = (id: string, state: number, example = false): ProblemRow => ({ kind: 'problem', id, label: id, state, example });

const rows = [h('CHAPTER I'), h('Part A'), p('1', 2), p('2', 0), h('Part B'), p('3', 2), p('4', 2), h('CHAPTER II'), p('5', 1), p('5Err', 1, true), p('6', 3)];
const ids = (rs: ProblemRow[]) => rs.map((r) => (r.kind === 'heading' ? '#' + r.text : r.id));

test('completed problems, examples (even incorrect ones) and empty headings are hidden', () => {
  expect(ids(onlyIncomplete(rows))).toEqual(['#CHAPTER I', '#Part A', '2', '#CHAPTER II', '5', '6']);
});

test('the open problem stays', () => {
  expect(ids(onlyIncomplete(rows, '4'))).toEqual(['#CHAPTER I', '#Part A', '2', '#Part B', '4', '#CHAPTER II', '5', '6']);
});

test('everything completed leaves nothing', () => {
  expect(onlyIncomplete([h('A'), p('1', 2)])).toEqual([]);
});
