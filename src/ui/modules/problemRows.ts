// Adapters from the engine's problem list model (ProblemListModel, ProblemCounts: the
// desktop's list rows, search and counts) to the ProblemList component.

import { TaggedRecord } from '../../engine/data/TaggedRecord';
import { ProblemCounts, ProblemListModel } from '../../engine/problems/ProblemList';
import type { ProblemSet } from '../../engine/problems/ProblemSet';
import type { ProblemRow } from '../components/ProblemList';

/** The name (as in URLs and openProblem) of the set's problem at index. */
export function problemName(set: ProblemSet, index: number): string {
  return TaggedRecord.nameOf(set.getRecordAt(index)) ?? String(index);
}

function toRows(model: ProblemListModel, rows: ProblemListModel['rows'], set: ProblemSet, counts: ProblemCounts | null): ProblemRow[] {
  return rows.map((r) =>
    r.kind === 'heading'
      ? { kind: 'heading', text: r.text }
      : {
          kind: 'problem',
          id: problemName(set, r.index),
          label: r.text,
          hover: r.hover,
          state: r.state,
          restricted: r.restricted,
          counted: counts ? counts.counted[r.index] : true,
        },
  );
}

/**
 * Rows, search filter and count line for a ProblemList, from the engine's model:
 *   const list = listFromModel(new ProblemListModel(set, set.exercises, {...}), set);
 *   <ProblemList rows={list.rows} filter={list.filter} countLabel={list.countLabel} ... />
 * The filter is the desktop's (ProblemListView.setFilter: every word, whole names like T2).
 */
export function listFromModel(model: ProblemListModel, set: ProblemSet) {
  const counts = new ProblemCounts(set, set.exercises, model);
  const rows = toRows(model, model.allRows, set, counts);
  return {
    rows,
    filter: (query: string): ProblemRow[] => {
      model.setFilter(query);
      return toRows(model, model.rows, set, counts);
    },
    countLabel: (query: string): string => {
      model.setFilter(query);
      return counts.label(query);
    },
  };
}
