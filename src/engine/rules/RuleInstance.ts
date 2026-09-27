/**
 * Port of RuleInstance.java: the closed instance of a rule form's conclusion (the universal
 * closure of the instantiated conclusion); a CIE condition. Encoded "RULE,instantiation".
 */
import { SchemeInstantiation } from '../formula/SchemeInstantiation';
import { type Rule, SchematicRule } from './Rule';
import { getRule } from './RuleTable';

export class RuleInstance extends SchematicRule {
  baseRule: SchematicRule;
  instantiation: SchemeInstantiation | null;

  constructor(base: SchematicRule, inst: SchemeInstantiation | null) {
    super('Instance of ' + base.name);
    this.baseRule = base;
    this.instantiation = inst;
    if (base.conclusion != null) {
      this.conclusion = base.conclusion.instantiate(inst).universalClosure();
    }
  }

  encode(): string {
    return this.baseRule.name + ',' + this.instantiation!.encode();
  }

  /** find: LPDerivation.getRule (the program's rules and the user's rules). */
  static decode(s: string, find: (name: string) => Rule | null = getRule): RuleInstance | null {
    const i = s.indexOf(',');
    const rule = find(i === -1 ? s : s.substring(0, i));
    const inst = i === -1 ? null : SchemeInstantiation.decode(s.substring(i + 1));
    return rule instanceof SchematicRule ? new RuleInstance(rule, inst) : null;
  }
}
