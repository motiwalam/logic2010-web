/**
 * A problem in a ProblemSet: its record line and state. Port of ProblemEntry.java.
 *
 * `name` holds the whole record line (the desktop's naming); the problem's name is
 * TaggedRecord.nameOf(name). The state is what the list colours and submissions report.
 */
import { TaggedRecord } from '../data/TaggedRecord';
import { javaTrim } from '../util/java';
import type { ProblemSet } from './ProblemSet';

export const STATE_NO_WORK = 0;
export const STATE_INCORRECT = 1;
export const STATE_CORRECT = 2;
export const STATE_INCOMPLETE = 3;
export const STATE_UNCHECKED = 4;
/** The letter each state reports as a submission's evaluation. */
export const STATE_CODES = ['N', 'I', 'C', 'I', 'U'] as const;

/** Upper-case problem names (ProblemEntry's Hashtables of names). */
export type ProblemNameSet = Set<string>;

export abstract class ProblemEntry {
  name: string;
  state: number;
  hidden = false;
  extraProblem: boolean;

  /**
   * unchecked: start in STATE_UNCHECKED (the module's restate pass computes the state later);
   * otherwise computeState(record) gives it. listed: the names isListed tests (the module's
   * workProblemNames, for extraProblem).
   *
   * Note: computeState runs inside this constructor, before a subclass's own field
   * initializers, as in Java; it must not depend on them.
   */
  constructor(record: string, unchecked: boolean, listed: ProblemNameSet | null) {
    this.name = record;
    this.state = unchecked ? STATE_UNCHECKED : this.computeState(record);
    this.extraProblem = ProblemEntry.isListed(record, listed);
  }

  abstract computeState(record: string): number;

  /** ProblemEntry.readProblemNames: adds the names of the records the lines hold. */
  static readProblemNames(lines: Iterable<string>, names: ProblemNameSet | null = null): ProblemNameSet {
    const out = names ?? new Set<string>();
    for (const s of lines) {
      let name: string | null;
      if (!TaggedRecord.isBlankOrComment(s) && (name = TaggedRecord.nameOf(s)) != null) out.add(javaTrim(name).toUpperCase());
    }
    return out;
  }

  /**
   * ProblemEntry.findExtraProblems(set, names): the names of the set's problems that are not
   * in names (the course problem files); marks those entries extraProblem (except DEMO...).
   */
  static findExtraProblems(set: ProblemSet, names: ProblemNameSet | null): ProblemNameSet {
    const extra = new Set<string>();
    for (let j = 0; j < set.size(); j++) {
      const entry = set.getEntryAt(j);
      if (entry == null || entry.name == null) continue;
      const s = javaTrim(TaggedRecord.nameOf(entry.name) ?? 'null').toUpperCase();
      if (names == null || !names.has(s)) extra.add(s);
      entry.extraProblem = ProblemEntry.isListed(entry.name, extra);
    }
    return extra;
  }

  static markExtraProblems(set: ProblemSet, names: ProblemNameSet | null): void {
    for (let j = 0; j < set.size(); j++) {
      const entry = set.getEntryAt(j);
      if (entry != null && entry.name != null) entry.extraProblem = ProblemEntry.isListed(entry.name, names);
    }
  }

  /** Whether the record's name is in names (never for names starting with DEMO). */
  static isListed(record: string, names: ProblemNameSet | null): boolean {
    const name = TaggedRecord.nameOf(record);
    if (name == null) return false;
    const s = javaTrim(name).toUpperCase();
    if (s.startsWith('DEMO')) return false;
    return names == null ? false : names.has(s);
  }
}
