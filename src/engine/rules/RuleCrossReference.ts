/**
 * Port of RuleCrossReference.java, RuleLister.java, DefaultRuleListResolver.java and
 * LogicProgram.listRules: a list of rules and theorems ("MP.DN.T2.{3,5}") that applies to the
 * problems a selector names ("rules:selector"; no selector: all problems).
 */
import { IntervalSet } from '../program/IntervalSet';
import { ProblemSelector } from '../program/ProblemSelector';
import { javaTrim } from '../util/java';
import { Rule } from './Rule';
import { getRule } from './RuleTable';

/** RuleLister: resolves a "."-separated rule list into rule names and theorem numbers. */
export interface RuleLister {
  listRules(list: string, names: string[], theorems: IntervalSet, forms: boolean): void;
}

/**
 * LogicProgram.listRules: each item is a theorem set ("{1,3}", "~{5}"), a theorem T<n>, or a
 * rule (its name, or with `forms` the names of all its forms). Unknown rules are reported on
 * standard output.
 */
export function listRules(list: string, names: string[], theorems: IntervalSet, forms: boolean): void {
  let rest = javaTrim(list);
  while (rest !== '') {
    const i = rest.indexOf('.');
    let item: string;
    if (i === -1) {
      item = rest;
      rest = '';
    } else {
      item = javaTrim(rest.substring(0, i));
      rest = javaTrim(rest.substring(i + 1));
    }
    if ('~{'.indexOf(item.charAt(0)) !== -1) {
      theorems.union(new IntervalSet(item));
      continue;
    }
    const n = Rule.parseTheoremNumber(item);
    if (n != null) {
      theorems.union(IntervalSet.singleton(n));
      continue;
    }
    const rule = getRule(item);
    if (rule == null) {
      console.log('unknown rule: ' + item);
    } else if (forms) {
      for (const form of rule.getAllForms()) if (!names.includes(form.name)) names.push(form.name);
    } else if (!names.includes(rule.name)) {
      names.push(rule.name);
    }
  }
}

/** DefaultRuleListResolver: the program's rule table. */
export const defaultRuleListResolver: RuleLister = { listRules };

export class RuleCrossReference {
  ruleNames: string[] | null = null;
  theoremNumbers: IntervalSet | null = null;
  selector: ProblemSelector | null = null;

  constructor(spec?: string, lister: RuleLister | null = null, forms = false) {
    if (spec === undefined) return;
    const i = spec.indexOf(':');
    const resolver = lister ?? defaultRuleListResolver;
    this.ruleNames = [];
    this.theoremNumbers = new IntervalSet();
    if (i === -1) {
      resolver.listRules(spec, this.ruleNames, this.theoremNumbers, forms);
      this.selector = new ProblemSelector().complement();
    } else {
      resolver.listRules(spec.substring(0, i), this.ruleNames, this.theoremNumbers, forms);
      this.selector = new ProblemSelector(spec.substring(i + 1));
    }
  }

  withPrefix(prefix: string): this {
    this.selector!.addPrefix(prefix);
    return this;
  }

  /** Adds the rules and theorems if the selector names the problem (null: a user problem). */
  applyTo(problem: string | null, names: string[], theorems: IntervalSet): void {
    if (this.selector != null && (problem == null ? this.selector.hasFlag('u') : this.selector.contains(problem))) {
      for (const n of this.ruleNames!) if (!names.includes(n)) names.push(n);
      theorems.union(this.theoremNumbers!);
    }
  }
}
