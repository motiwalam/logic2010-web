/**
 * Port of PermutationIterator.java: enumerates every permutation of 0..n-1 (by prefix
 * reversals driven by a counter per position), starting with the identity.
 */
import { ExpressionPath } from '../formula/ExpressionPath';

export class PermutationIterator {
  size: number;
  counters: number[] | null;
  permutation: number[];

  constructor(n: number | readonly number[] | null) {
    if (typeof n === 'number') {
      this.size = n;
      this.counters = n === 0 ? null : new Array<number>(n - 1).fill(0);
      this.permutation = new Array<number>(n).fill(0);
      this.reset();
    } else {
      if (n == null) {
        this.size = 0;
        this.counters = null;
      } else {
        this.size = n.length + 1;
        this.counters = new Array<number>(this.size - 1).fill(0);
      }
      this.permutation = new Array<number>(this.size).fill(0);
      this.setCounters(n);
    }
  }

  current(): number[] {
    return this.permutation.slice(0, this.size);
  }

  next(): boolean {
    let i: number;
    for (i = 0; i < this.size - 1 && ++this.counters![i] > i + 1; i++) this.counters![i] = 0;
    if (i < this.size - 1) {
      this.reversePrefix(i + 2);
      return true;
    }
    this.reversePrefix(this.size);
    return false;
  }

  previous(): boolean {
    let i: number;
    for (i = 0; i < this.size - 1 && --this.counters![i] < 0; i++) this.counters![i] = i + 1;
    if (i < this.size - 1) {
      this.reversePrefix(i + 2);
      return true;
    }
    this.reversePrefix(this.size);
    return false;
  }

  getCounters(): number[] | null {
    return this.counters == null ? null : this.counters.slice(0, this.size - 1);
  }

  setCounters(values: readonly number[] | null): void {
    this.reset();
    if (values == null) return;
    for (let i = Math.min(values.length - 1, this.size - 2); i >= 0; i--) {
      let j = values[i] % (i + 2);
      if (j < 0) j += i + 2;
      this.rotatePrefix(i + 2, j);
      this.counters![i] = j;
    }
  }

  reset(): void {
    for (let i = 0; i < this.size - 1; i++) {
      this.permutation[i] = i;
      this.counters![i] = 0;
    }
    if (this.size > 0) this.permutation[this.size - 1] = this.size - 1;
  }

  toString(): string {
    return ExpressionPath.format(this.permutation);
  }

  reversePrefix(n: number): void {
    for (let k = 0; k < n - 1 - k; k++) {
      const t = this.permutation[k];
      this.permutation[k] = this.permutation[n - 1 - k];
      this.permutation[n - 1 - k] = t;
    }
  }

  rotatePrefix(n: number, j: number): void {
    if (j > n - j) this.rotatePrefix(n, j - n);
    else if (j < -n - j) this.rotatePrefix(n, j + n);
    else if (j > 0) {
      const moved = this.permutation.slice(n - j, n);
      const rest = this.permutation.slice(0, n - j);
      this.permutation.splice(0, n, ...moved, ...rest);
    } else if (j < 0) {
      const moved = this.permutation.slice(0, -j);
      const rest = this.permutation.slice(-j, n);
      this.permutation.splice(0, n, ...rest, ...moved);
    }
  }
}
