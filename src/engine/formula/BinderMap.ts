/**
 * Port of BinderMap.java and BinderKey.java: records which binder (quantifier or description)
 * of one tree corresponds to which binder of another. A key is (context, binder, context
 * terms): the context is the letter node whose replacement is being expanded (null at the top
 * level), and the context terms the stack of argument placeholders being expanded.
 *
 * Keys compare by object identity, as in Java. Java's BinderKey.hashCode uses identity hash
 * codes, so the Hashtable's iteration order (seen only by getBinderCorrespondence, where it
 * does not change the outcome) is arbitrary there; here it is insertion order.
 */
import type { Expression, SimpleTerm } from './Expression';

export class BinderKey {
  readonly context: Expression | null;
  readonly binder: Expression;
  readonly contextTerms: SimpleTerm[] | null;

  constructor(context: Expression | null, binder: Expression, contextTerms: readonly SimpleTerm[] | null) {
    this.context = context;
    this.binder = binder;
    this.contextTerms = BinderKey.toArray(contextTerms);
  }

  static toArray(terms: readonly SimpleTerm[] | null): SimpleTerm[] | null {
    return terms == null || terms.length === 0 ? null : terms.slice();
  }

  static toVector(terms: readonly SimpleTerm[] | null): SimpleTerm[] {
    return terms == null ? [] : terms.slice();
  }

  /** A string that is equal for equal keys. */
  get id(): string {
    let s = (this.context == null ? '-' : this.context.id) + ':' + this.binder.id;
    if (this.contextTerms) for (const t of this.contextTerms) s += ',' + t.id;
    return s;
  }
}

export class BinderMap {
  private readonly table = new Map<string, { key: BinderKey; value: Expression }>();

  get(key: BinderKey): Expression | null {
    return this.table.get(key.id)?.value ?? null;
  }

  put(key: BinderKey, value: Expression): Expression | null {
    const id = key.id;
    const old = this.table.get(id);
    if (old) {
      const previous = old.value;
      old.value = value;
      return previous;
    }
    this.table.set(id, { key, value });
    return null;
  }

  keys(): BinderKey[] {
    return [...this.table.values()].map((e) => e.key);
  }

  /**
   * The counterpart of binder in context with the given context terms; if there is none,
   * the counterpart with fewer context terms (dropping the innermost first).
   */
  getCounterpart(binder: Expression): Expression | null;
  getCounterpart(context: Expression | null, binder: Expression, contextTerms: readonly SimpleTerm[] | null): Expression | null;
  getCounterpart(
    a: Expression | null,
    b?: Expression,
    contextTerms?: readonly SimpleTerm[] | null,
  ): Expression | null {
    if (b === undefined) return this.getCounterpart(null, a!, null);
    const terms = contextTerms == null ? null : contextTerms.slice();
    let n = terms == null ? 0 : terms.length;
    for (;;) {
      const counterpart = this.get(new BinderKey(a, b, terms));
      if (counterpart != null || n === 0) return counterpart;
      terms!.length = --n;
    }
  }

  putCounterpart(binder: Expression, counterpart: Expression): Expression | null;
  putCounterpart(
    context: Expression | null,
    binder: Expression,
    contextTerms: readonly SimpleTerm[] | null,
    counterpart: Expression,
  ): Expression | null;
  putCounterpart(
    a: Expression | null,
    b: Expression,
    contextTerms?: readonly SimpleTerm[] | null,
    counterpart?: Expression,
  ): Expression | null {
    if (counterpart === undefined) return this.put(new BinderKey(null, a!, null), b);
    return this.put(new BinderKey(a, b, contextTerms ?? null), counterpart);
  }

  /**
   * For each binder of `pattern` (in binder order), the indexes among the binders of
   * `instance` of its top-level counterparts.
   */
  getBinderCorrespondence(pattern: Expression, instance: Expression): number[][] {
    const binders = pattern.getBinders();
    const instanceBinders = instance.getBinders();
    const counterparts: Expression[][] = binders.map(() => []);
    for (const { key, value } of this.table.values()) {
      let k: number;
      if (key.context == null && (k = binders.indexOf(key.binder)) !== -1 && value != null) {
        counterparts[k].push(value);
      }
    }
    return counterparts.map((list) => list.map((e) => instanceBinders.indexOf(e)));
  }
}
