/**
 * Port of LetterReplacement.java: a schematic letter pattern such as F({1} {2}) and the
 * expression replacing it (in which {1}, {2} stand for the letter's arguments), or the error
 * that made the replacement invalid.
 */
import type { Expression } from './Expression';
import type { ErrorRef } from './messages';
import { SchemeInstantiation } from './SchemeInstantiation';

export class LetterReplacement {
  pattern!: Expression;
  replacement!: Expression;
  error: ErrorRef | null = null;

  constructor(pattern: Expression, replacement: Expression);
  constructor(error: ErrorRef);
  constructor(a: Expression | ErrorRef, b?: Expression) {
    if (b === undefined) {
      this.error = a as ErrorRef;
      return;
    }
    const pattern = a as Expression;
    if ((this.error = SchemeInstantiation.validateReplacement(pattern, b)) == null) {
      this.pattern = pattern;
      this.replacement = b.copy();
      this.replacement.linkArgumentPlaceholders(pattern);
    }
  }

  sameReplacementAs(other: LetterReplacement): boolean {
    if (this.error != null || other.error != null) return false;
    return this.pattern.symbol === other.pattern.symbol && this.pattern.childCount === other.pattern.childCount
      ? this.replacement.isAlphaEquivalent(other.replacement, null)
      : false;
  }

  toString(): string {
    return (this.pattern ?? 'null') + ':' + (this.replacement ?? 'null');
  }
}
