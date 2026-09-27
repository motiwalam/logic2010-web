import type { ProblemSet } from '../../src/engine/problems/ProblemSet';
import { TestProblemSet } from './coreModules';

export interface SetJson {
  entries: [string | null, boolean, number, boolean][];
  headings: Record<string, string[]> | null;
  storedDigest: string | null;
}

export function setJson(set: ProblemSet): SetJson {
  let headings: Record<string, string[]> | null = null;
  if (set.headingsByName != null) headings = Object.fromEntries([...set.headingsByName].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    entries: set.elements().map((e) => [TestProblemSet.nameOfEntry(e.name), e.hidden, e.state, e.extraProblem]),
    headings,
    storedDigest: set.storedDigest,
  };
}

