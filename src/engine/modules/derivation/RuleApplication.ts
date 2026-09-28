/**
 * Port of RuleApplication.java: a rule form applied to formulas of the stack (premise i of
 * the form is stack formula premiseOrder[i]), with its instantiation and bound-variable map.
 * Justification type 1, encoded "NAME{i,j,..}<instantiation>,<boundvars>".
 */
import { BinderMap } from '../../formula/BinderMap';
import type { Expression } from '../../formula/Expression';
import { ExpressionPath } from '../../formula/ExpressionPath';
import { SchemeInstantiation } from '../../formula/SchemeInstantiation';
import { BoundVariableMap } from '../../rules/BoundVariableMap';
import { type Rule, SchematicRule } from '../../rules/Rule';
import { RuleApplicationDisplay } from '../../rules/RuleApplicationDisplay';
import type { DerivationLineChecker } from './DerivationLineChecker';
import { Justification } from './Justification';

export type RuleFinder = (name: string) => Rule | null;

export class RuleApplication extends Justification {
  static readonly TYPE = 1;
  form: SchematicRule;
  premiseOrder: number[];
  instantiation: SchemeInstantiation;
  boundVariables: BoundVariableMap;
  failureKind = 0;
  failureDetail: unknown = null;

  constructor(form: SchematicRule, premiseOrder: number[], instantiation: SchemeInstantiation, boundVariables: BoundVariableMap) {
    super(form.name);
    this.form = form;
    this.premiseOrder = premiseOrder;
    this.instantiation = instantiation;
    this.boundVariables = boundVariables;
  }

  clone(): RuleApplication {
    const copy = new RuleApplication(
      this.form,
      this.premiseOrder == null ? this.premiseOrder : this.premiseOrder.slice(),
      this.instantiation == null ? this.instantiation : this.instantiation.clone(),
      this.boundVariables == null ? this.boundVariables : this.boundVariables.clone(),
    );
    copy.label = this.label;
    return copy;
  }

  getForm(): SchematicRule {
    return this.form;
  }

  getPremiseOrder(): number[] {
    return this.premiseOrder;
  }

  getInstantiation(): SchemeInstantiation {
    return this.instantiation;
  }

  getBoundVariables(): BoundVariableMap {
    return this.boundVariables;
  }

  getPremiseCount(): number {
    return this.form.premises.length;
  }

  /** The i-th premise (in stack order) instantiated, its binders renamed. */
  getPremise(i: number): Expression {
    const binderMap = new BinderMap();
    const pattern = this.form.premises[this.premiseOrder[i]];
    const e = pattern.instantiate(this.instantiation, binderMap);
    this.boundVariables.renameBinders(pattern, e, binderMap);
    return e;
  }

  getConclusion(): Expression {
    const binderMap = new BinderMap();
    const e = this.form.conclusion!.instantiate(this.instantiation, binderMap);
    this.boundVariables.renameBinders(this.form.conclusion!, e, binderMap);
    return e;
  }

  isFullyInstantiated(e: Expression): boolean {
    return e.isFullyInstantiated(this.instantiation) && this.boundVariables.coversBinders(e);
  }

  async reapply(checker: DerivationLineChecker): Promise<boolean> {
    const rule = checker.module.getRule(checker.ruleName!);
    if (rule == null || !rule.includes(this.form)) return false;
    const i = this.form.premises.length;
    if (!(!checker.matchLine && !checker.finalStep ? i <= checker.argumentCount : i === checker.argumentCount)) return false;
    for (let j = 0; j < i; j++) {
      const e = this.getPremise(j);
      if (e.findMislinkedVariables() != null || !e.isIdentical(checker.getStackFormula(j - i))) return false;
    }
    const forms = rule.getForms(checker.module, checker.interactive ? 'manualOrDisabled' : 'disabled');
    if (this.form.indexByName(forms) === -1) return false;
    if ((checker.result = this.getConclusion()).findMislinkedVariables() != null) return false;
    if (!checker.checkInstantiationRestrictions(this.instantiation, true)) return false;
    if (checker.matchLine && !checker.checkResultMatchesLine(true)) return false;
    checker.popStack(i);
    return true;
  }

  encode(): string {
    return '1:' + this.toString();
  }

  override toString(): string {
    return this.label + ExpressionPath.format(this.premiseOrder) + this.instantiation.encode() + ',' + this.boundVariables.encode();
  }

  static decode(s: string, find: RuleFinder): RuleApplication | null {
    const i = s.indexOf(':');
    if (i === -1 || s.substring(0, i) !== '1') return null;
    return RuleApplication.decodeBody(s.substring(i + 1), find);
  }

  static decodeBody(s: string, find: RuleFinder): RuleApplication | null {
    let i = s.indexOf('{');
    if (i === -1) return null;
    const rule = find(s.substring(0, i));
    if (!(rule instanceof SchematicRule)) return null;
    const s1 = s.substring(i);
    if ((i = s1.indexOf('}')) === -1) return null;
    const order = ExpressionPath.parse(s1.substring(0, i + 1));
    if (order == null) return null;
    s = s1.substring(i + 1);
    if ((i = s.indexOf(',')) === -1) return null;
    const inst = SchemeInstantiation.decode(s.substring(0, i));
    if (inst == null) return null;
    return new RuleApplication(rule, order, inst, BoundVariableMap.decode(s.substring(i + 1)));
  }

  createDisplay(): RuleApplicationDisplay {
    return new RuleApplicationDisplay(this);
  }
}
