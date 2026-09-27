/**
 * Port of DeferredMatch.java: a pattern/instance match postponed until the pattern's letter
 * gets a value. (Java's contextTerms field is never assigned by the constructor, so re-running
 * a deferred match always starts with an empty context stack.)
 */
import type { BinderMap } from './BinderMap';
import type { Expression, SimpleTerm } from './Expression';
import { stringHash } from '../util/java';

export class DeferredMatch {
  readonly pattern: Expression;
  readonly instance: Expression | null;
  readonly binderMap: BinderMap;
  readonly contextTerms: SimpleTerm[] | null = null;

  constructor(pattern: Expression, instance: Expression | null, binderMap: BinderMap) {
    this.pattern = pattern;
    this.instance = instance;
    this.binderMap = binderMap;
  }

  equals(other: unknown): boolean {
    if (!(other instanceof DeferredMatch)) return false;
    return (
      this.pattern.isIdentical(other.pattern) &&
      (this.instance == null ? other.instance == null : this.instance.isIdentical(other.instance))
    );
  }

  hashCode(): number {
    return stringHash(this.toString());
  }

  toString(): string {
    return this.pattern + ':' + String(this.instance);
  }
}

/** Vector.contains with equals. */
export function containsMatch(list: readonly DeferredMatch[], match: DeferredMatch): boolean {
  return list.some((m) => match.equals(m));
}
