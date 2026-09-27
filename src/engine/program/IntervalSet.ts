/**
 * A set of integers as a sorted list of boundaries. Port of IntervalSet.java and
 * IntRangeEnumeration.java.
 *
 * Crossing a boundary toggles membership; `inverted` says whether the set starts "inside".
 * So {3,5} is [3,5) = {3,4}, and ~{3} is everything below 3.
 *
 * `boundaries` may be passed to translateSymbols (symbols.ts) as the positions to shift, as
 * LogicProgram.translateSymbols(s, from, to, IntervalSet) does.
 */

/** ExpressionPath.parse: the integers in "{1,2,3}" (null if malformed). */
function parsePath(s: string): number[] | null {
  const i = s.indexOf('{');
  const j = s.indexOf('}');
  if (i === -1 || j === -1 || j < i) return null;
  const inner = s.substring(i + 1, j).trim();
  if (inner === '') return [];
  const out: number[] = [];
  for (const part of inner.split(',')) {
    const t = part.trim();
    if (!/^[+-]?[0-9]+$/.test(t)) return null;
    const n = Number(t);
    if (n < -2147483648 || n > 2147483647) return null;
    out.push(n);
  }
  return out;
}

export class IntervalSet {
  inverted = false;
  boundaries: number[] = [];
  private cursor = 0;

  /** An empty set, or one parsed from text such as "~{1,4}". */
  constructor(text?: string) {
    if (text === undefined) return;
    this.inverted = text.indexOf('~') !== -1;
    for (const b of parsePath(text) ?? []) this.toggleBoundary(b);
  }

  get count(): number {
    return this.boundaries.length;
  }

  static singleton(i: number): IntervalSet {
    return new IntervalSet().toggleBoundary(i).toggleBoundary(i + 1);
  }

  /** [start, start + length); empty unless length > 0. */
  static range(start: number, length: number): IntervalSet {
    const set = new IntervalSet();
    if (length > 0) set.toggleBoundary(start).toggleBoundary(start + length);
    return set;
  }

  static atLeast(i: number): IntervalSet {
    return new IntervalSet().toggleBoundary(i);
  }

  static greaterThan(i: number): IntervalSet {
    return new IntervalSet().toggleBoundary(i + 1);
  }

  copy(): IntervalSet {
    const c = new IntervalSet();
    c.inverted = this.inverted;
    c.boundaries = this.boundaries.slice();
    return c;
  }

  union(other: IntervalSet): IntervalSet {
    return this.complement().intersect(other.copy().complement()).complement();
  }

  subtract(other: IntervalSet): IntervalSet {
    return this.intersect(other.copy().complement());
  }

  intersect(other: IntervalSet): IntervalSet {
    if (other.boundaries.length === 0) return other.inverted ? this : this.clear();
    const result = new IntervalSet();
    let a = this.copy();
    let b = other.copy();
    for (; a.cursor < a.boundaries.length; a.advance()) {
      let i = a.boundaries[a.cursor];
      const j = b.boundaries[b.cursor];
      if (i > j || (i === j && !a.inverted && b.inverted)) {
        const t = a;
        a = b;
        b = t;
        i = j;
      }
      if (b.inverted) result.toggleBoundary(i);
    }
    if (a.inverted) {
      for (let k = b.cursor; k < b.boundaries.length; k++) result.toggleBoundary(b.boundaries[k]);
    }
    this.inverted = this.inverted && other.inverted;
    this.boundaries = result.boundaries.slice();
    return this;
  }

  private advance(): void {
    this.cursor++;
    this.inverted = !this.inverted;
  }

  clear(): IntervalSet {
    this.inverted = false;
    this.cursor = 0;
    this.boundaries = [];
    return this;
  }

  complement(): IntervalSet {
    this.inverted = !this.inverted;
    return this;
  }

  shift(n: number): IntervalSet {
    for (let j = 0; j < this.boundaries.length; j++) this.boundaries[j] = (this.boundaries[j] + n) | 0;
    return this;
  }

  equals(other: unknown): boolean {
    return (
      other instanceof IntervalSet &&
      this.inverted === other.inverted &&
      this.boundaries.length === other.boundaries.length &&
      this.boundaries.every((b, i) => b === other.boundaries[i])
    );
  }

  hashCode(): number {
    let h = this.inverted ? 1 : 0;
    for (const b of this.boundaries) h = (Math.imul(h, 40503) + b) | 0;
    return h;
  }

  isEmpty(): boolean {
    return this.boundaries.length === 0 && !this.inverted;
  }

  contains(i: number): boolean {
    return !IntervalSet.singleton(i).intersect(this).isEmpty();
  }

  /** The characters of s at the positions in the set. */
  selectChars(s: string | null): string | null {
    if (s == null) return null;
    const set = IntervalSet.range(0, s.length).intersect(this);
    let out = '';
    for (let b = 0; b < set.count - 1; b += 2) out += s.substring(set.boundaries[b], set.boundaries[b + 1]);
    return out;
  }

  toString(): string {
    return (this.inverted ? '~' : '') + '{' + this.boundaries.join(',') + '}';
  }

  /** The members in increasing order (IntRangeEnumeration; an inverted set's first range is skipped). */
  *elements(): IterableIterator<number> {
    let rangeIndex = this.inverted ? 1 : 0;
    let current = rangeIndex < this.count ? this.boundaries[rangeIndex] : 0;
    while (rangeIndex + 1 < this.count && current < this.boundaries[rangeIndex + 1]) {
      yield current;
      if (++current >= this.boundaries[rangeIndex + 1]) {
        rangeIndex += 2;
        current = rangeIndex < this.count ? this.boundaries[rangeIndex] : 0;
      }
    }
  }

  toggleBoundary(i: number): IntervalSet {
    for (let j = this.boundaries.length; j >= 0; j--) {
      if (j === 0 || this.boundaries[j - 1] < i) {
        this.boundaries.splice(j, 0, i);
        break;
      }
      if (this.boundaries[j - 1] === i) {
        this.boundaries.splice(j - 1, 1);
        break;
      }
    }
    return this;
  }

  toggleBoundaries(values: readonly number[]): IntervalSet {
    for (const v of values) this.toggleBoundary(v);
    return this;
  }
}
