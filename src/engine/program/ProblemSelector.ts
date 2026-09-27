/**
 * A set of problem names, used by the options (e.g. noCheck:{"1.7",~"1.72"}).
 * Port of ProblemSelector.java and SelectorBoundary.java.
 *
 * The text before '{' is a set of flag characters (u covers user problems), optionally
 * with '~' to complement the set. Inside the braces is a comma-separated list of quoted
 * boundary names; a '~' in front of a name makes it an "after" boundary instead of a
 * "before" boundary.
 *
 * The set is stored like an interval set over strings: a sorted list of boundaries, each
 * sitting just before or just after a name, and a `complemented` bit saying whether the set
 * starts "inside". Crossing a boundary toggles membership. single(name) is therefore the
 * boundaries (name, before) and (name, after). Names compare as Java strings (UTF-16 units).
 */
import { DelimitedTokenizer } from '../util/DelimitedTokenizer';
import { stringHash } from '../util/java';

export class SelectorBoundary {
  constructor(
    public name: string,
    public before: boolean,
  ) {}

  compareBoundary(other: SelectorBoundary): number {
    if (this.name !== other.name) return this.name < other.name ? -1 : 1;
    if (this.before === other.before) return 0;
    return this.before ? -1 : 1;
  }

  toString(): string {
    return (this.before ? '' : '~') + '"' + DelimitedTokenizer.escape(this.name, '\\"') + '"';
  }

  equals(other: unknown): boolean {
    return other instanceof SelectorBoundary && this.before === other.before && this.name === other.name;
  }
}

export class ProblemSelector {
  complemented = false;
  boundaries: SelectorBoundary[] = [];
  flagChars = '';
  private cursor = 0;

  /** An empty selector, or one parsed from option text such as `u{"1.7",~"1.72"}`. */
  constructor(text?: string) {
    if (text === undefined) return;
    const i = text.indexOf('{');
    if (i === -1) return;
    this.flagChars = text.substring(0, i);
    this.complemented = this.flagChars.indexOf('~') !== -1;
    this.flagChars = combineChars(this.flagChars, '~', true);
    const tokenizer = new DelimitedTokenizer('\\"');
    tokenizer.setInput(text.substring(i + 1));
    const parsed = new ProblemSelector();
    for (;;) {
      let s = tokenizer.nextToken();
      // (Java: a null token here would throw; the input ends with the escape delimiter first)
      if (tokenizer.getDelimiter() === '\\' || s == null || s.indexOf('}') !== -1) break;
      const before = s.indexOf('~') === -1;
      s = tokenizer.nextToken();
      if (tokenizer.getDelimiter() === '\\' || s == null) break;
      parsed.toggleBoundary(s, before);
    }
    this.boundaries = parsed.boundaries.slice();
  }

  get boundaryCount(): number {
    return this.boundaries.length;
  }

  static single(name: string): ProblemSelector {
    return new ProblemSelector().toggleBoundary(name, true).toggleBoundary(name, false);
  }

  static startingAt(name: string): ProblemSelector {
    return new ProblemSelector().toggleBoundary(name, true);
  }

  static after(name: string): ProblemSelector {
    return new ProblemSelector().toggleBoundary(name, false);
  }

  /** A copy; deep copies the boundary list (Java's copy(false) shares it, which is not observable here). */
  copy(): ProblemSelector {
    const c = new ProblemSelector();
    c.complemented = this.complemented;
    c.flagChars = this.flagChars;
    c.boundaries = this.boundaries.slice();
    return c;
  }

  /** this ∪ other, in place (returns this). */
  union(other: ProblemSelector): ProblemSelector {
    return this.complement().intersect(other.copy().complement()).complement();
  }

  /** this − other, in place. */
  subtract(other: ProblemSelector): ProblemSelector {
    return this.intersect(other.copy().complement());
  }

  /** this ∩ other, in place. */
  intersect(other: ProblemSelector): ProblemSelector {
    if (other.complemented) {
      this.flagChars = this.complemented
        ? combineChars(this.flagChars + other.flagChars, '', true)
        : combineChars(this.flagChars, other.flagChars, true);
    } else {
      this.flagChars = this.complemented
        ? combineChars(other.flagChars, this.flagChars, true)
        : combineChars(this.flagChars, other.flagChars, false);
    }
    if (other.boundaries.length === 0) return other.complemented ? this : this.reset(false);
    const result = new ProblemSelector();
    let a = this.copy();
    let b = other.copy();
    for (; a.cursor < a.boundaries.length; a.advanceCursor()) {
      let boundary = a.boundaries[a.cursor];
      const boundary1 = b.boundaries[b.cursor];
      const i = boundary.compareBoundary(boundary1);
      if (i > 0 || (i === 0 && !a.complemented && b.complemented)) {
        const t = a;
        a = b;
        b = t;
        boundary = boundary1;
      }
      if (b.complemented) result.toggleBoundary(boundary);
    }
    if (a.complemented) {
      for (let j = b.cursor; j < b.boundaries.length; j++) result.toggleBoundary(b.boundaries[j]);
    }
    this.complemented = this.complemented && other.complemented;
    this.boundaries = result.boundaries.slice();
    return this;
  }

  private advanceCursor(): void {
    this.cursor++;
    this.complemented = !this.complemented;
  }

  clear(): ProblemSelector {
    return this.reset(true);
  }

  private reset(clearFlags: boolean): ProblemSelector {
    this.complemented = false;
    this.cursor = 0;
    this.boundaries = [];
    if (clearFlags) this.flagChars = '';
    return this;
  }

  complement(): ProblemSelector {
    this.complemented = !this.complemented;
    return this;
  }

  equals(other: unknown): boolean {
    if (!(other instanceof ProblemSelector)) return false;
    if (this.complemented !== other.complemented || this.boundaries.length !== other.boundaries.length) return false;
    if (this.flagChars.length !== other.flagChars.length) return false;
    if (combineChars(this.flagChars, other.flagChars, true).length !== 0) return false;
    return this.boundaries.every((b, i) => b.equals(other.boundaries[i]));
  }

  hashCode(): number {
    let h = this.complemented ? 1 : 0;
    for (const b of this.boundaries) h = (Math.imul(h, 40503) + (b.before ? 1 : 0) + stringHash(b.name)) | 0;
    return h;
  }

  isEmpty(): boolean {
    return this.boundaries.length === 0 && !this.complemented && this.flagChars.length === 0;
  }

  /** Puts prefix in front of every boundary name (the options' prefix:, e.g. "Deriv "). */
  addPrefix(prefix: string | null): ProblemSelector {
    if (prefix != null && prefix !== '') for (const b of this.boundaries) b.name = prefix + b.name;
    return this;
  }

  contains(name: string | null): boolean {
    return name == null ? false : !ProblemSelector.single(name).intersect(this).isEmpty();
  }

  hasFlag(c: string): boolean {
    return this.flagChars.indexOf(c) === -1 ? this.complemented : !this.complemented;
  }

  toString(): string {
    return (this.complemented ? '~' : '') + this.flagChars + '{' + this.boundaries.map(String).join(',') + '}';
  }

  toggleBoundary(name: string, before: boolean): ProblemSelector;
  toggleBoundary(boundary: SelectorBoundary | null): ProblemSelector;
  toggleBoundary(a: string | SelectorBoundary | null, before?: boolean): ProblemSelector {
    const boundary = typeof a === 'string' ? new SelectorBoundary(a, before!) : a;
    if (boundary == null) return this;
    for (let i = this.boundaries.length; i >= 0; i--) {
      let j = 0;
      if (i === 0 || (j = this.boundaries[i - 1].compareBoundary(boundary)) < 0) {
        this.boundaries.splice(i, 0, boundary);
        break;
      }
      if (j === 0) {
        // Java copies the elements from i down over i-1: the boundary equal to the new one goes
        this.boundaries.splice(i - 1, 1);
        break;
      }
    }
    return this;
  }
}

/**
 * ProblemSelector.combineChars: the distinct characters of s that are not in t (keep) or
 * that are in t (!keep). With !keep and an empty t, "".
 */
export function combineChars(s: string, t: string, keep: boolean): string {
  let out = '';
  if (keep || t.length !== 0) {
    for (const c of s) {
      if (out.indexOf(c) === -1 && (t.indexOf(c) === -1 ? keep : !keep)) out += c;
    }
  }
  return out;
}
