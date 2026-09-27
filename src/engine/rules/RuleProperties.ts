/**
 * Port of RuleProperties.java: the structural properties of rule forms (notConditional,
 * notConditionalBC, biconditional, hasConverse), the equivalence helpers used by IE / CIE,
 * and the table of converse forms (DNE <-> DNI, ...), filled as rules are loaded.
 */
import type { Expression } from '../formula/Expression';
import { BinderMap } from '../formula/BinderMap';
import { SchemeInstantiation } from '../formula/SchemeInstantiation';
import { BoundVariableMap } from './BoundVariableMap';
import { type Rule, SchematicRule } from './Rule';
import type { RulePropertySource } from './RulePropertySource';
import { getTheorem } from './RuleTable';
import type { TheoremTable } from './TheoremTable';
import { IntervalSet } from '../program/IntervalSet';

export class RuleProperties implements RulePropertySource {
  /** Form name -> names of its converse forms (duplicates possible, as in Java). */
  readonly converses = new Map<string, string[]>();

  hasProperty(rule: Rule, prop: string): boolean {
    switch (prop) {
      case 'notConditional': {
        if (!(rule instanceof SchematicRule)) return false;
        if (rule.conclusion == null) return true;
        const n = rule.premises.length;
        return n === 0 ? RuleProperties.getEquivalenceOrConditional(rule.conclusion) == null : n !== 1;
      }
      case 'notConditionalBC': {
        if (!(rule instanceof SchematicRule)) return false;
        if (rule.conclusion == null) return true;
        const n = rule.premises.length;
        if (n === 0) return RuleProperties.getConditionalEquivalence(rule.conclusion) == null;
        return n === 1 ? rule.conclusion.symbol !== '<->' : true;
      }
      case 'biconditional':
        if (!(rule instanceof SchematicRule)) return false;
        return rule.premises != null && rule.premises.length !== 0
          ? false
          : RuleProperties.getEquivalence(rule.conclusion, false) != null;
      case 'hasConverse':
        return rule instanceof SchematicRule ? this.getConverses(rule) != null : false;
      default:
        throw new Error('unknown property: ' + prop);
    }
  }

  static getEquivalenceOrConditional(e: Expression | null): Expression | null {
    return RuleProperties.getEquivalence(e, true);
  }

  /** The <-> under leading universal quantifiers (a copy if there are any); with allowConditional, a top-level -> too. */
  static getEquivalence(e: Expression | null, allowConditional: boolean): Expression | null {
    if (e == null) return null;
    if (e.symbol === '->') return allowConditional ? e : null;
    let quantified = false;
    while (e!.symbol !== '<->') {
      if (e!.symbol !== '@') return null;
      quantified = true;
      e = e!.getChild(1);
    }
    return quantified ? e!.copy() : e;
  }

  static getEquivalenceSide(e: Expression | null, a: number | boolean, b?: number): Expression | null {
    const eq = typeof a === 'number' ? RuleProperties.getEquivalence(e, true) : RuleProperties.getEquivalence(e, a);
    return eq == null ? null : eq.getChild(typeof a === 'number' ? a : b!);
  }

  /** C -> (A <-> B), possibly under @x, or a biconditional one of whose sides is a biconditional. */
  static getConditionalEquivalence(e: Expression | null): Expression | null {
    if (e == null) return null;
    let quantified = false;
    while (e!.symbol !== '->') {
      if (e!.symbol === '<->') {
        if (e!.getChild(0)!.symbol !== '<->' && e!.getChild(1)!.symbol !== '<->') return null;
        return quantified ? e!.copy() : e;
      }
      if (e!.symbol !== '@') return null;
      quantified = true;
      e = e!.getChild(1);
    }
    if (e!.getChild(1)!.symbol !== '<->') return null;
    return quantified ? e!.copy() : e;
  }

  static getConditionalEquivalencePart(e: Expression | null, i: number, j: number): Expression | null {
    const c = RuleProperties.getConditionalEquivalence(e);
    return c == null ? null : c.getChild(i)!.getChild(j);
  }

  hasTheoremProperty(n: number, prop: string): boolean {
    const theorem = getTheorem(n);
    return theorem == null ? true : this.hasProperty(theorem, prop);
  }

  getConverses(rule: SchematicRule): string[] | null {
    if (rule.sourceTheorem != null && RuleProperties.getEquivalence(rule.sourceTheorem.conclusion, false) != null) {
      return [rule.sourceTheorem.name];
    }
    if (this.hasProperty(rule, 'biconditional')) return [rule.name];
    return this.converses.get(rule.name) ?? null;
  }

  registerConverses(rule: Rule): void {
    const forms = rule.getForms(this, 'notConditional');
    const n = forms.length;
    for (let j = 0; j < n; j++) {
      const form = forms[j];
      if (this.hasProperty(form, 'biconditional')) continue;
      const from = RuleProperties.getFromSide(form, false);
      const to = RuleProperties.getToSide(form, false);
      for (let k = 0; k < n; k++) {
        const other = forms[k];
        const bic = this.hasProperty(other, 'biconditional');
        if (k >= j || bic) {
          const from2 = RuleProperties.getFromSide(other, false);
          const to2 = RuleProperties.getToSide(other, false);
          if (this.isConversePair(from2, to2, from, to) || (bic && this.isConversePair(to2, from2, from, to))) {
            this.addConverse(form, other);
          }
        }
      }
    }
  }

  isConversePair(a: Expression | null, b: Expression | null, c: Expression | null, d: Expression | null): boolean {
    const inst = new SchemeInstantiation();
    const binders = new BinderMap();
    const map = new BoundVariableMap();
    if (!a!.match(d, inst, binders)) return false;
    if (!b!.match(c, inst, binders)) return false;
    if (!map.matchBinders(a!, d, binders)) return false;
    if (!map.matchBinders(b!, c, binders)) return false;
    return inst.hasNoDeferredMatches();
  }

  addConverse(form: SchematicRule, other: SchematicRule): void {
    let list = this.converses.get(form.name);
    if (list == null) this.converses.set(form.name, (list = []));
    // Java: an empty `if (!contains)` block, then an unconditional add (duplicates possible)
    list.push(other.name);
    if (!this.hasProperty(other, 'biconditional')) {
      let back = this.converses.get(other.name);
      if (back == null) this.converses.set(other.name, (back = []));
      if (!back.includes(form.name)) back.push(form.name);
    }
  }

  /** The rules (of table's rule list) with a converse. */
  getRulesWithConverse(table: { ruleNames: string[]; getRule(name: string): Rule | null }): string[] {
    return table.ruleNames.filter((s) => table.getRule(s)!.testProperty(this, 'hasConverse', true));
  }

  /** The theorems with a converse. */
  getTheoremsWithConverse(theorems: TheoremTable): IntervalSet {
    const set = new IntervalSet();
    for (const n of theorems.numbers()) {
      const theorem = theorems.getTheorem(n)!;
      if (theorem.testProperty(this, 'hasConverse', true)) set.union(IntervalSet.singleton(theorem.number));
    }
    return set;
  }

  static getFromSide(rule: SchematicRule, reversed: boolean): Expression | null {
    return rule.premises.length === 0
      ? RuleProperties.getEquivalenceSide(rule.conclusion, reversed ? 1 : 0)
      : rule.premises[0];
  }

  static getConditionalFromSide(rule: SchematicRule, conditionFirst: boolean, reversed: boolean): Expression | null {
    return rule.premises.length === 0
      ? RuleProperties.getConditionalEquivalencePart(rule.conclusion, conditionFirst ? 0 : 1, reversed ? 1 : 0)
      : rule.conclusion!.getChild(reversed ? 1 : 0);
  }

  static getToSide(rule: SchematicRule, reversed: boolean): Expression | null {
    return rule.premises.length === 0 ? RuleProperties.getEquivalenceSide(rule.conclusion, reversed ? 0 : 1) : rule.conclusion;
  }

  static getConditionalToSide(rule: SchematicRule, conditionFirst: boolean, reversed: boolean): Expression | null {
    return rule.premises.length === 0
      ? RuleProperties.getConditionalEquivalencePart(rule.conclusion, conditionFirst ? 0 : 1, reversed ? 0 : 1)
      : rule.conclusion!.getChild(reversed ? 0 : 1);
  }

  getProofs(_rule: SchematicRule): string[] | null {
    return null;
  }

  getTheoremProofs(_n: number): string[] | null {
    return null;
  }

  excludedProof(): string | null {
    return null;
  }

  checkProof(_problem: string): boolean {
    return true;
  }
}
