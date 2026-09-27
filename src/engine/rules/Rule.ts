/**
 * Port of Rule.java, SchematicRule.java and Theorem.java (one module: Rule.fromTheorem
 * creates SchematicRules, which extend Rule).
 *
 * A Rule is named; a compound rule (DN = DNE.DNI) has components, a leaf is a SchematicRule
 * (premises .: conclusion). A Theorem T<n> is a SchematicRule with no premises. Rules derived
 * from theorems (RT<n>...) remember their sourceTheorem, to which property and proof queries
 * are delegated.
 */
import { type Expression } from '../formula/Expression';
import { javaTrim, parseJavaInt } from '../util/java';
import { ArgumentParser } from './ArgumentParser';
import type { RulePropertySource } from './RulePropertySource';

/** What Rule's list constructor needs from the rule table (RuleTable.findRule). */
export interface RuleFinder {
  findRule(name: string): Rule | null;
}

export class Rule {
  name: string;
  components: Rule[] | null;
  sourceTheorem: Theorem | null = null;
  error: string | null = null;

  constructor(name: string, components: Rule[] | null = []) {
    this.name = name;
    this.components = components;
  }

  /** A compound rule from a "."-separated list of rule names (resolved with table.findRule). */
  static fromList(name: string, list: string, table: RuleFinder): Rule {
    const rule = new Rule(name);
    while (list !== '') {
      const i = list.indexOf('.');
      let part: string;
      if (i === -1) {
        part = javaTrim(list);
        list = '';
      } else {
        part = javaTrim(list.substring(0, i));
        list = list.substring(i + 1);
      }
      const component = table.findRule(part);
      if (component == null) {
        const n = Rule.parseTheoremNumber(part);
        rule.error = n == null ? 'could not find rule ' + part : 'could not find theorem number ' + n;
      } else {
        rule.components!.push(component);
      }
    }
    return rule;
  }

  /** "T<n>" (any case, n not starting with 0) -> n, else null. */
  static parseTheoremNumber(s: string): number | null {
    const u = s.toUpperCase();
    if (u.length >= 2 && u.substring(0, 1) === 'T' && '123456789'.indexOf(u.substring(1, 2)) !== -1) {
      return parseJavaInt(u.substring(1));
    }
    return null;
  }

  /** "RT<n><suffix>" -> n, else null. */
  static parseTheoremRuleNumber(s: string): number | null {
    const u = s.toUpperCase();
    const n = u.length;
    if (n >= 3 && u.substring(0, 2) === 'RT' && '123456789'.indexOf(u.charAt(2)) !== -1) {
      let i = 3;
      while (i < n && '0123456789'.indexOf(u.charAt(i)) !== -1) i++;
      return parseJavaInt(u.substring(2, i));
    }
    return null;
  }

  findComponent(name: string): Rule | null {
    if (this.name === name) return this;
    for (let j = 0; j < this.getComponentCount(); j++) {
      const found = this.getComponent(j)!.findComponent(name);
      if (found != null) return found;
    }
    return null;
  }

  getRuleName(): string {
    return this.name;
  }

  addComponent(rule: Rule | null): void {
    if (this.components != null && rule != null) this.components.push(rule);
  }

  getComponentCount(): number {
    return this.components == null ? 0 : this.components.length;
  }

  getComponent(i: number): Rule | null {
    return this.components == null ? null : this.components[i];
  }

  /**
   * Whether the rule has the property: its source theorem or itself has it, or (any = true)
   * some component has it, or (any = false) all components have it.
   */
  testProperty(source: RulePropertySource, prop: string, any: boolean): boolean {
    if (this.sourceTheorem != null && this.sourceTheorem.testProperty(source, prop, any)) return true;
    if (source.hasProperty(this, prop)) return true;
    const n = this.getComponentCount();
    if (n === 0) return false;
    for (let j = 0; j < n; j++) {
      if (this.components![j].testProperty(source, prop, any) === any) return any;
    }
    return !any;
  }

  isProven(source: RulePropertySource): boolean {
    for (let j = 0; j < this.getComponentCount(); j++) {
      if (!this.components![j].isProven(source)) return false;
    }
    return true;
  }

  isAnyFormProven(source: RulePropertySource): boolean {
    for (let j = 0; j < this.getComponentCount(); j++) {
      if (this.components![j].isAnyFormProven(source)) return true;
    }
    return false;
  }

  collectForms(forms: SchematicRule[], source: RulePropertySource | null, prop: string | null): void {
    if (source == null || !source.hasProperty(this, prop!)) {
      for (let j = 0; j < this.getComponentCount(); j++) this.getComponent(j)!.collectForms(forms, source, prop);
    }
  }

  /** The leaf forms, without those that have prop (all forms if source is null). */
  getForms(source: RulePropertySource | null, prop: string | null): SchematicRule[] {
    const forms: SchematicRule[] = [];
    this.collectForms(forms, source, prop);
    return forms;
  }

  getAllForms(): SchematicRule[] {
    return this.getForms(null, null);
  }

  includes(rule: Rule): boolean {
    if (this.name === rule.name) return true;
    for (let j = 0; j < this.getComponentCount(); j++) {
      const c = this.components![j];
      if (c != null && c.includes(rule)) return true;
    }
    return false;
  }

  isMutuallyIncludedWithAny(rule: Rule, rules: readonly Rule[] | null): boolean {
    for (const r of rules ?? []) {
      if (rule.includes(r) && r.includes(this)) return true;
    }
    return false;
  }

  /**
   * The RT<n> rule of a theorem: for A->B, "A .: B" (with the conjuncts of A as premises,
   * and a compound RT<n>L / RT<n>LF if A has several); for A<->B, RT<n>L, RT<n>LF, RT<n>R,
   * RT<n>RF; otherwise ".: formula".
   */
  static fromTheorem(theorem: Theorem | null): Rule | null {
    if (theorem == null) return null;
    const s = 'RT' + theorem.number;
    const f = theorem.conclusion!;
    let forms: Rule[];
    if (f.symbol === '<->') {
      const left = f.getChild(0)!;
      const right = f.getChild(1)!;
      forms = [];
      forms.push(Rule.attachTheorem(new SchematicRule(s + 'L', [left], right), theorem));
      let conjuncts = Rule.splitConjuncts(left);
      if (conjuncts.length > 1) forms.push(Rule.attachTheorem(new SchematicRule(s + 'LF', conjuncts, right), theorem));
      forms.push(Rule.attachTheorem(new SchematicRule(s + 'R', [right], left), theorem));
      conjuncts = Rule.splitConjuncts(right);
      if (conjuncts.length > 1) forms.push(Rule.attachTheorem(new SchematicRule(s + 'RF', conjuncts, left), theorem));
    } else {
      if (f.symbol !== '->') return Rule.attachTheorem(new SchematicRule(s, null, f), theorem);
      const antecedent = f.getChild(0)!;
      const consequent = f.getChild(1)!;
      const conjuncts = Rule.splitConjuncts(antecedent);
      if (conjuncts.length <= 1) return Rule.attachTheorem(new SchematicRule(s, conjuncts, consequent), theorem);
      forms = [
        Rule.attachTheorem(new SchematicRule(s + 'L', [antecedent], consequent), theorem),
        Rule.attachTheorem(new SchematicRule(s + 'LF', conjuncts, consequent), theorem),
      ];
    }
    return Rule.attachTheorem(new Rule(s, forms), theorem);
  }

  static attachTheorem<R extends Rule>(rule: R, theorem: Theorem): R {
    rule.sourceTheorem = theorem;
    return rule;
  }

  static splitConjuncts(e: Expression): Expression[] {
    const found: Expression[] = [];
    Rule.collectConjuncts(e, found);
    return found;
  }

  static collectConjuncts(e: Expression, found: Expression[]): void {
    if (e.symbol === '&') {
      Rule.collectConjuncts(e.getChild(0)!, found);
      Rule.collectConjuncts(e.getChild(1)!, found);
    } else {
      found.push(e);
    }
  }

  getError(): string | null {
    return this.error;
  }

  toString(): string {
    return this.format('.', '.:');
  }

  format(separator: string, _therefore: string): string {
    let s = '';
    for (let j = 0; j < this.getComponentCount(); j++) s += (j > 0 ? separator : '') + this.getComponent(j)!.name;
    return s;
  }
}

export class SchematicRule extends Rule {
  premises: Expression[] = [];
  conclusion: Expression | null = null;

  /** A form with the given premises and conclusion, or parsed from "P.Q.:R". */
  constructor(name: string, premises?: Expression[] | null | string, conclusion?: Expression | null) {
    super(name, null);
    if (typeof premises === 'string') {
      this.parseForm(premises);
      return;
    }
    if (premises != null) this.premises = premises;
    if (conclusion !== undefined) this.conclusion = conclusion;
  }

  parseForm(s: string): void {
    const parser = new ArgumentParser(s);
    this.premises = parser.premises as Expression[];
    this.conclusion = parser.conclusion;
    const unparsed = parser.getUnparsedText();
    if (unparsed != null) {
      this.error = 'parse error: ' + unparsed;
    } else {
      const code = parser.getErrorCode();
      if (code !== 0) this.error = ArgumentParser.ERROR_MESSAGES[code];
    }
  }

  getPremises(): Expression[] {
    return this.premises;
  }

  getConclusion(): Expression | null {
    return this.conclusion;
  }

  copyRule(): SchematicRule {
    return new SchematicRule(
      this.name,
      this.premises.map((p) => p.copy()),
      this.conclusion!.copy(),
    );
  }

  /**
   * Proven: not tied to proof problems, or a weakAss rule, or one of its proof problems
   * (other than the excluded current problem) is solved.
   */
  override isProven(source: RulePropertySource): boolean {
    const proofs = this.getProofProblems(source);
    if (proofs == null || this.testProperty(source, 'weakAss', false)) return true;
    const excluded = source.excludedProof();
    for (const p of proofs) {
      if ((excluded == null || excluded !== p) && source.checkProof(p)) return true;
    }
    return false;
  }

  override isAnyFormProven(source: RulePropertySource): boolean {
    return this.isProven(source);
  }

  getProofProblems(source: RulePropertySource): string[] | null {
    return this.sourceTheorem != null ? this.sourceTheorem.getProofProblems(source) : source.getProofs(this);
  }

  override collectForms(forms: SchematicRule[], source: RulePropertySource | null, prop: string | null): void {
    if (source == null || !source.hasProperty(this, prop!)) forms.push(this);
  }

  indexByName(forms: readonly SchematicRule[] | null): number {
    for (let j = 0; j < (forms == null ? 0 : forms.length); j++) {
      if (this.name === forms![j].name) return j;
    }
    return -1;
  }

  formatInOrder(order: readonly number[]): string {
    let s = '';
    const n = Math.min(this.premises.length, order.length);
    for (let j = 0; j < n; j++) s += (j > 0 ? '.' : '') + this.premises[order[j]];
    return s + '.:' + this.conclusion;
  }

  override format(separator: string, therefore: string): string {
    let s = '';
    for (let i = 0; i < this.premises.length; i++) s += (i > 0 ? separator : '') + this.premises[i];
    return s + therefore + this.conclusion;
  }
}

export class Theorem extends SchematicRule {
  number: number;

  /** Theorem n with the formula (text: parsed as ".:" + text). */
  constructor(n: number, formula: string | Expression) {
    if (typeof formula === 'string') super('T' + n, '.:' + formula);
    else super('T' + n, null, formula);
    this.number = n;
  }

  getNumber(): number {
    return this.number;
  }

  getFormula(): Expression | null {
    return this.conclusion;
  }

  override testProperty(source: RulePropertySource, prop: string, _any: boolean): boolean {
    return source.hasTheoremProperty(this.number, prop);
  }

  override getProofProblems(source: RulePropertySource): string[] | null {
    return source.getTheoremProofs(this.number);
  }

  override toString(): string {
    return this.format('', '');
  }

  override format(_separator: string, therefore: string): string {
    return therefore + this.conclusion!.toString();
  }
}
