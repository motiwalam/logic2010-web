/**
 * Port of TheoremTable.java: the theorems T<n> by number, the set of theorem numbers, and the
 * headings ("#-" comment lines, stored under the next theorem's number). Read from the lines
 * of the theorems file as DataFiles gives them (the legacy one-line format: number, blanks,
 * formula; "#-" headings).
 */
import { TaggedRecord } from '../data/TaggedRecord';
import { IntervalSet } from '../program/IntervalSet';
import { parseJavaInt } from '../util/java';
import { Theorem } from './Rule';

/** Character.isWhitespace. */
export function isJavaWhitespace(c: string): boolean {
  const n = c.charCodeAt(0);
  if ((n >= 9 && n <= 13) || (n >= 28 && n <= 32)) return true;
  if (n === 0xa0 || n === 0x2007 || n === 0x202f) return false;
  return /\s/.test(c) && n > 127;
}

/** The first blank-delimited word of s and the rest after it (as RuleTable/TheoremTable split lines). */
export function splitNameLine(s: string): [string, string] {
  let j = 0;
  while (j < s.length && isJavaWhitespace(s.charAt(j))) j++;
  let k = j;
  while (k < s.length && !isJavaWhitespace(s.charAt(k))) k++;
  return [s.substring(j, k), s.substring(k)];
}

export class TheoremTable {
  readonly theorems = new Map<number, Theorem>();
  theoremNumbers = new IntervalSet();
  readonly headings = new Map<number, string[]>();
  /** What Java prints on standard output while reading (bad lines). */
  readonly problems: string[] = [];

  addTheoremLine(s: string, headings: string[] | null): void {
    const [word, rest] = splitNameLine(s);
    const n = parseJavaInt(word);
    if (n == null) {
      this.report('Bad theorem number format: ' + word);
      return;
    }
    const theorem = new Theorem(n, rest);
    const error = theorem.getError();
    if (error != null) {
      this.report('error in theorem T' + n + ': ' + error);
      return;
    }
    if (headings != null) this.headings.set(n, headings);
    this.theoremNumbers.union(IntervalSet.singleton(n));
    this.theorems.set(n, theorem);
  }

  private report(message: string): void {
    this.problems.push(message);
    console.log(message);
  }

  /** Reads the lines of the theorems file (legacy format, unscrambled). */
  static read(lines: readonly string[] | null): TheoremTable | null {
    if (lines == null) return null;
    const table = new TheoremTable();
    let headings: string[] | null = null;
    for (const s of lines) {
      if (TaggedRecord.isBlankOrComment(s)) {
        if (s.indexOf('#-') === 0) (headings ??= []).push(s.substring(2));
      } else {
        table.addTheoremLine(s, headings);
        headings = null;
      }
    }
    return table;
  }

  getTheorem(n: number | null): Theorem | null {
    return n == null ? null : (this.theorems.get(n) ?? null);
  }

  /** The theorem numbers in increasing order. */
  numbers(): number[] {
    return [...this.theorems.keys()].sort((a, b) => a - b);
  }

  get size(): number {
    return this.theorems.size;
  }
}
