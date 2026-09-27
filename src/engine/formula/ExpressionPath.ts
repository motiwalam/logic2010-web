/**
 * Port of ExpressionPath.java: the address of a subexpression, as the list of child indexes
 * from the root. Its text form is "{0,1,1}".
 */
import { javaTrim, parseJavaInt } from '../util/java';

export class ExpressionPath {
  depth: number;
  indexes: number[];

  constructor(indexes?: readonly number[]) {
    if (indexes) {
      this.depth = indexes.length;
      this.indexes = indexes.slice();
    } else {
      this.depth = 0;
      this.indexes = [];
    }
  }

  static fromArray(indexes: readonly number[] | null): ExpressionPath | null {
    return indexes == null ? null : new ExpressionPath(indexes);
  }

  clone(): ExpressionPath {
    return new ExpressionPath(this.indexes.slice(0, this.depth));
  }

  append(indexes: readonly number[], from = 0, count = indexes.length - from): void {
    for (let k = 0; k < count; k++) this.indexes[this.depth + k] = indexes[from + k];
    this.depth += count;
  }

  push(i: number): void {
    this.indexes[this.depth] = i;
    this.depth++;
  }

  indexOf(i: number): number {
    for (let j = 0; j < this.depth; j++) {
      if (this.indexes[j] === i) return j;
    }
    return -1;
  }

  commonPrefixLength(other: ExpressionPath | null): number {
    if (other == null) return 0;
    const n = Math.min(this.depth, other.depth);
    for (let j = 0; j < n; j++) {
      if (this.indexes[j] !== other.indexes[j]) return j;
    }
    return n;
  }

  toArray(): number[] {
    return this.indexes.slice(0, this.depth);
  }

  toString(): string {
    return ExpressionPath.format(this.indexes, 0, this.depth);
  }

  static format(indexes: readonly number[], from = 0, count = indexes.length): string {
    let s = '{';
    for (let k = 0; k < count; k++) s += (k === 0 ? '' : ',') + indexes[from + k];
    return s + '}';
  }

  /** "{1,2}" -> [1, 2]; null if there are no braces or a number does not parse. */
  static parse(s: string): number[] | null {
    const i = s.indexOf('{');
    const j = s.indexOf('}');
    if (i === -1 || j === -1 || j < i) return null;
    let rest = javaTrim(s.substring(i + 1, j));
    const parts: string[] = [];
    while (rest !== '') {
      const k = rest.indexOf(',');
      if (k === -1) {
        parts.push(rest);
        rest = '';
      } else {
        parts.push(javaTrim(rest.substring(0, k)));
        rest = javaTrim(rest.substring(k + 1));
      }
    }
    const result: number[] = [];
    for (const p of parts) {
      const n = parseJavaInt(p);
      if (n == null) return null;
      result.push(n);
    }
    return result;
  }

  equals(other: unknown): boolean {
    if (!(other instanceof ExpressionPath) || other.depth !== this.depth) return false;
    for (let i = 0; i < this.depth; i++) {
      if (other.indexes[i] !== this.indexes[i]) return false;
    }
    return true;
  }

  hashCode(): number {
    let h = this.depth;
    for (let j = 0; j < this.depth; j++) h = (Math.imul(h, 40503) + this.indexes[j]) | 0;
    return h;
  }
}
