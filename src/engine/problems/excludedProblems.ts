/**
 * Problems the web program leaves out: the Practice Blue Book Exam problems.
 *
 * DELIBERATE DEVIATION from the desktop program (see NOTES.md). The course files hold, in
 * each chapter, a group of "Blue Book mode" problems (the N.7xx problems: derivation 48,
 * symbolization 23, truth tables 9, invalidity 5 per notation) that practise a paper exam;
 * they are not meant to be done on a computer and duplicate other problems. The web app
 * leaves them out of every problem list; the data files are unchanged.
 *
 * The rule: a problem is excluded when its note field (`!`, "note:") contains
 * BLUE_BOOK_NOTE. It is applied by LogicModule.readProblems, which reads both the course
 * problem files and the student's work files, so imported or saved desktop work does not
 * bring them back as extra problems. Their "## The following problems are in Blue Book
 * mode." headings are dropped with them (other headings before them, such as a chapter title,
 * move to the next problem). An excluded record found in a work file is kept aside in its
 * ProblemSet (excludedRecords) so that the file's digest still verifies and saving keeps the
 * student's work on it.
 *
 * The exclusion is off by default, so the engine behaves exactly as the desktop (the
 * differential tests against the Java oracle run that way); the web app turns it on
 * (src/ui/engine/engine.ts).
 */
import { TaggedRecord } from '../data/TaggedRecord';

export const BLUE_BOOK_NOTE = 'This is a Practice Blue Book Exam problem';

let excluding = false;

/** Turns the exclusion of the Blue Book problems on or off (program-wide). */
export function setExcludeBlueBookProblems(on: boolean): void {
  excluding = on;
}

export function isExcludingBlueBookProblems(): boolean {
  return excluding;
}

/** Whether a record is a Practice Blue Book Exam problem (regardless of the setting). */
export function isBlueBookProblem(record: string | TaggedRecord): boolean {
  const t = typeof record === 'string' ? new TaggedRecord(record) : record;
  return t.indexesOfTag('!').some((i) => t.values[i].includes(BLUE_BOOK_NOTE));
}

/** Whether the program leaves this problem record out (the setting is on and it is a Blue Book problem). */
export function isExcludedProblem(record: string | TaggedRecord): boolean {
  return excluding && isBlueBookProblem(record);
}

/**
 * The headings pending before an excluded problem, less its Blue Book group: from the last
 * blank heading before the first heading that mentions "Blue Book" to the end. What remains
 * (e.g. a chapter title) goes to the next problem.
 */
export function withoutBlueBookHeadings(headings: string[] | null): string[] | null {
  if (headings == null) return null;
  const k = headings.findIndex((h) => h.includes('Blue Book'));
  if (k === -1) return headings;
  let start = k;
  while (start > 0 && headings[start - 1].trim() === '') start--;
  return start === 0 ? null : headings.slice(0, start);
}
