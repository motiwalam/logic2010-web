/**
 * Port of InterchangeJustification.java, LineRule.java and PremiseRule.java: a step of IE or
 * CIE (interchange of equivalents), justification type 4. The subformula at `path` of the
 * cited formula is replaced by an equivalent, using a biconditional (or one-premise) rule
 * form, a derivation line or a premise; for CIE under a condition (a line, a premise, or an
 * instance of a rule's conclusion).
 *
 * Encoded "<path>(<|>)<source>[?(<|>)<condition>]", the source being a RuleApplication body, a
 * line number or "#<premise>" (each with an optional ",inst;boundvars").
 */
import { BinderMap } from '../../formula/BinderMap';
import type { Expression } from '../../formula/Expression';
import { ExpressionPath } from '../../formula/ExpressionPath';
import { FormulaParseNode } from '../../formula/FormulaParseNode';
import { LetterReplacement } from '../../formula/LetterReplacement';
import type { SchematicLetter } from '../../formula/SchematicLetter';
import { SchemeInstantiation } from '../../formula/SchemeInstantiation';
import { Message } from '../../program/Message';
import { BoundVariableMap } from '../../rules/BoundVariableMap';
import { HighlightedText } from '../../rules/HighlightedText';
import { type Rule, SchematicRule } from '../../rules/Rule';
import { RuleInstance } from '../../rules/RuleInstance';
import { RuleProperties } from '../../rules/RuleProperties';
import { ruleTable } from '../../rules/RuleTable';
import { parseJavaInt } from '../../util/java';
import { DerivationBox } from './DerivationBox';
import type { DerivationLine } from './DerivationLine';
import type { DerivationLineChecker } from './DerivationLineChecker';
import { Justification } from './Justification';
import type { LPDerivation } from './LPDerivation';
import { RuleApplication } from './RuleApplication';

/** LineRule: a derivation line used as a rule (".: formula"). */
export class LineRule extends SchematicRule {
  line: DerivationLine;

  constructor(line: DerivationLine) {
    super('Line ' + line.getLineNumber());
    this.line = line;
    this.conclusion = line.formula;
  }

  /** new LineRule(module, n): throws (IllegalArgumentException) if there is no line n. */
  static find(module: LPDerivation, n: number): LineRule {
    const node = module.problem.findLine(n);
    if (node == null) throw new IllegalArgumentException('cannot find line ' + n);
    const rule = new LineRule(node instanceof DerivationBox ? node.showLine : node);
    rule.name = 'Line ' + n;
    return rule;
  }
}

/** PremiseRule: premise i (1-based) of the problem used as a rule. */
export class PremiseRule extends SchematicRule {
  premiseIndex: number;

  constructor(module: LPDerivation, i: number) {
    super('Premise ' + i);
    if (module.premises == null || i < 1 || i > module.premises.length) throw new IllegalArgumentException('no premise ' + i);
    this.premiseIndex = i - 1;
    this.conclusion = module.premises[i - 1];
  }
}

export class IllegalArgumentException extends Error {}

export class InterchangeJustification extends Justification {
  static readonly TYPE = 4;
  path: ExpressionPath | null = null;
  reversed = false;
  pathChosen = false;
  ruleApplication: RuleApplication | null = null;
  equivalenceLine: DerivationLine | null = null;
  equivalencePremise: number | null = null;
  instantiation: SchemeInstantiation | null = null;
  boundVariables: BoundVariableMap | null = null;
  conditionLine: DerivationLine | null = null;
  conditionPremise: number | null = null;
  conditionInstance: RuleInstance | null = null;
  conditionReversed = false;

  constructor() {
    super('IE');
  }

  static withRule(path: ExpressionPath, reversed: boolean, application: RuleApplication, conditionReversed = false, condition: SchematicRule | null = null): InterchangeJustification {
    const j = new InterchangeJustification();
    j.path = path;
    j.reversed = reversed;
    j.ruleApplication = application;
    j.setCondition(conditionReversed, condition);
    return j;
  }

  static withLine(
    path: ExpressionPath,
    reversed: boolean,
    line: DerivationLine,
    inst: SchemeInstantiation,
    map: BoundVariableMap,
    conditionReversed = false,
    condition: SchematicRule | null = null,
  ): InterchangeJustification {
    const j = new InterchangeJustification();
    j.path = path;
    j.reversed = reversed;
    j.equivalenceLine = line;
    j.instantiation = inst;
    j.boundVariables = map;
    j.setCondition(conditionReversed, condition);
    return j;
  }

  static withPremise(
    path: ExpressionPath,
    reversed: boolean,
    premise: number,
    inst: SchemeInstantiation,
    map: BoundVariableMap,
    conditionReversed = false,
    condition: SchematicRule | null = null,
  ): InterchangeJustification {
    const j = new InterchangeJustification();
    j.path = path;
    j.reversed = reversed;
    j.equivalencePremise = premise;
    j.instantiation = inst;
    j.boundVariables = map;
    j.setCondition(conditionReversed, condition);
    return j;
  }

  clone(): InterchangeJustification {
    const j = new InterchangeJustification();
    Object.assign(j, this);
    return j;
  }

  setCondition(conditionReversed: boolean, condition: SchematicRule | null): void {
    this.conditionReversed = conditionReversed;
    if (condition instanceof LineRule) {
      this.conditionLine = condition.line;
      this.conditionPremise = null;
      this.conditionInstance = null;
    } else if (condition instanceof PremiseRule) {
      this.conditionLine = null;
      this.conditionPremise = condition.premiseIndex;
      this.conditionInstance = null;
    } else if (condition instanceof RuleInstance) {
      this.conditionLine = null;
      this.conditionPremise = null;
      this.conditionInstance = condition;
    }
  }

  isUnconditional(): boolean {
    return this.conditionLine == null && this.conditionPremise == null && this.conditionInstance == null;
  }

  async reapply(checker: DerivationLineChecker): Promise<boolean> {
    const plain = this.isUnconditional();
    if (checker.ruleName !== (plain ? 'IE' : 'CIE')) return false;
    if (!(!checker.matchLine && !checker.finalStep ? checker.argumentCount >= 1 : checker.argumentCount === 1)) return false;
    if (checker.getStackFormula(-1)!.getSubexpression(this.path) == null) return false;
    if (this.ruleApplication != null) {
      if (!InterchangeJustification.isRuleUsable(checker, this.ruleApplication.form, plain)) return false;
      if (!InterchangeJustification.validateInnerRule(this.ruleApplication, checker, this.path!, this.getConditionRule(checker))) return false;
    } else if (this.equivalenceLine != null) {
      const module = checker.line.box.module;
      if (module.problem.findLine(this.equivalenceLine.getLineNumber()) !== this.equivalenceLine.getHeadNode()) return false;
      if (!checker.canUse(this.equivalenceLine)) return false;
      if (!InterchangeJustification.validateEquivalenceLine(this.equivalenceLine, checker, this.path!, plain)) return false;
    } else {
      if (this.equivalencePremise == null) return false;
      const i = this.equivalencePremise;
      const module = checker.line.box.module;
      if (module.premises == null || i < 0 || i >= module.premises.length) return false;
      if (!InterchangeJustification.validateEquivalencePremise(i, checker, this.path!, plain)) return false;
    }
    if (checker.getCitedNodeOutsideBox(-1) != null) checker.line.box.strategyConsistent = false;
    const source = await this.getSource(checker);
    if (!source!.isIdentical(checker.getStackFormula(-1))) return false;
    checker.result = await this.getResult(checker);
    if (checker.matchLine && !checker.checkResultMatchesLine(true)) return false;
    checker.popStack(1);
    return true;
  }

  static isConditionSubstitutionClean(checker: DerivationLineChecker, path: ExpressionPath, condition: SchematicRule | null): boolean {
    return (
      condition == null ||
      InterchangeJustification.replaceAt(checker.getStackFormula(-1)!, condition.conclusion!, path).findMislinkedVariables() == null
    );
  }

  static validateInnerRule(application: RuleApplication, checker: DerivationLineChecker, path: ExpressionPath, condition: SchematicRule | null): boolean {
    const form = application.getForm();
    const prop = condition == null ? 'notConditional' : 'notConditionalBC';
    const properties = ruleTable!.properties;
    if (properties != null && properties.hasProperty(form, prop)) {
      checker.reportError('dererr098', Message.params('inner rule name', form.name));
      return false;
    }
    if (!InterchangeJustification.isConditionSubstitutionClean(checker, path, condition)) {
      checker.reportError('dererr099', Message.params('condition name', condition!.name));
      return false;
    }
    return true;
  }

  static validateEquivalenceLine(line: DerivationLine, checker: DerivationLineChecker, path: ExpressionPath, plain: boolean): boolean {
    const e = plain ? RuleProperties.getEquivalence(line.formula, false) : RuleProperties.getConditionalEquivalence(line.formula);
    if (e == null) {
      checker.reportError('dererr086', Message.params('remote line number', line.getLineNumber() + ''));
      return false;
    }
    if (InterchangeJustification.replaceAt(checker.getStackFormula(-1)!, line.formula!, path).findMislinkedVariables() != null) {
      checker.reportError('dererr087', Message.params('remote line number', line.getLineNumber() + ''));
      return false;
    }
    return true;
  }

  static validateEquivalencePremise(i: number, checker: DerivationLineChecker, path: ExpressionPath, plain: boolean): boolean {
    const module = checker.line.box.module;
    const premise = module.premises![i];
    const e = plain ? RuleProperties.getEquivalence(premise, false) : RuleProperties.getConditionalEquivalence(premise);
    if (e == null) {
      checker.reportError('dererr088', Message.params('premise index', i + 1 + ''));
      return false;
    }
    if (InterchangeJustification.replaceAt(checker.getStackFormula(-1)!, premise!, path).findMislinkedVariables() != null) {
      checker.reportError('dererr089', Message.params('premise index', i + 1 + ''));
      return false;
    }
    return true;
  }

  /**
   * An instantiation mapping the letters of e to themselves. (Java loops with elementAt(0)
   * instead of elementAt(j): it maps only the first letter, as many times as there are letters.)
   */
  static identityInstantiation(e: Expression): SchemeInstantiation {
    const inst = new SchemeInstantiation();
    e.match(null, inst);
    const n = inst.pendingLetters.length;
    for (let j = 0; j < n; j++) {
      const letter = inst.pendingLetters[0];
      const x = letter.toExpression();
      inst.putReplacement(letter, new LetterReplacement(x, x));
    }
    return inst;
  }

  /** The display of the step (source .: result), for the choice of an application. */
  toHighlightedText(checker: DerivationLineChecker, conclusionOnlyIfUnrelated = true): HighlightedText {
    if (this.ruleApplication == null) {
      const source = this.createDisplay(this.getSourceSync(checker)!).toStyledText();
      const result = this.createDisplay(this.getResultSync(checker)!).toStyledText();
      if (conclusionOnlyIfUnrelated && !source.sharesHighlightLayer(result)) return result;
      source.append('.:');
      source.append(result);
      return source;
    }
    return this.toRuleApplication()!.createDisplay().toHighlightedText(conclusionOnlyIfUnrelated);
  }

  createDisplay(e: Expression): FormulaParseNode {
    const node = new FormulaParseNode(e, true, -1);
    node.addLetterRanges(this.instantiation!.pendingLetters);
    node.addTermRanges(this.boundVariables);
    return node;
  }

  encode(): string {
    return '4:' + this.toString();
  }

  override toString(): string {
    let s = '';
    if (this.path != null) s += this.path.toString();
    let t = s + (this.reversed ? '<' : '>');
    if (this.ruleApplication != null) {
      t += this.ruleApplication.toString();
    } else if (this.equivalenceLine != null) {
      t += this.equivalenceLine.getLineNumber();
      if (this.instantiation != null) t += ',' + this.instantiation.encode();
      if (this.boundVariables != null) t += ';' + this.boundVariables.encode();
    } else if (this.equivalencePremise != null) {
      t += '#' + this.equivalencePremise;
      if (this.instantiation != null) t += ',' + this.instantiation.encode();
      if (this.boundVariables != null) t += ';' + this.boundVariables.encode();
    }
    if (this.conditionLine != null) {
      t += (this.conditionReversed ? '?<' : '?>') + this.conditionLine.getLineNumber();
    } else if (this.conditionPremise != null) {
      t += (this.conditionReversed ? '?<' : '?>') + '#' + this.conditionPremise;
    } else if (this.conditionInstance != null) {
      t += (this.conditionReversed ? '?<' : '?>') + '#' + this.conditionInstance.encode();
    }
    return t;
  }

  static decodeInterchange(s: string, module: LPDerivation): InterchangeJustification | null {
    const i = s.indexOf(':');
    if (i === -1 || s.substring(0, i) !== '4') return null;
    return InterchangeJustification.decodeBody(s.substring(i + 1), module);
  }

  static decodeBody(s: string, module: LPDerivation): InterchangeJustification | null {
    let i = minNonNegative(s.indexOf('?>'), s.indexOf('?<'));
    let condition = i === -1 ? null : s.substring(i + 1);
    if (i !== -1) s = s.substring(0, i);
    i = minNonNegative(s.indexOf('>'), s.indexOf('<'));
    if (i === -1) return null;
    const j = new InterchangeJustification();
    j.path = i === 0 ? null : ExpressionPath.fromArray(ExpressionPath.parse(s.substring(0, i)));
    j.reversed = s.charAt(i) === '<';
    const s2 = s.substring(i + 1);
    const find = (name: string) => module.getRule(name);
    if ((j.ruleApplication = RuleApplication.decodeBody(s2, find)) == null && (j.equivalenceLine = InterchangeJustification.parseLineReference(s2, module)) == null) {
      j.equivalencePremise = InterchangeJustification.parsePremiseReference(s2, module);
    }
    if (j.equivalenceLine != null || j.equivalencePremise != null) {
      j.instantiation = InterchangeJustification.parseInstantiation(s2);
      j.boundVariables = InterchangeJustification.parseBoundVariables(s2);
    }
    if (condition != null) {
      j.conditionReversed = condition.charAt(0) === '<';
      condition = condition.substring(1);
      if ((j.conditionLine = InterchangeJustification.parseLineReference(condition, module)) == null && (j.conditionPremise = InterchangeJustification.parsePremiseReference(condition, module)) == null) {
        j.conditionInstance = InterchangeJustification.parseConditionInstance(condition, module);
      }
    }
    return j;
  }

  static parseLineReference(s: string, module: LPDerivation): DerivationLine | null {
    let i = s.indexOf(',');
    if (i !== -1 || (i = s.indexOf(';')) !== -1) s = s.substring(0, i);
    const n = parseJavaInt(s);
    if (n == null) return null;
    const node = module.problem.findLine(n);
    if (node == null) return null;
    return node instanceof DerivationBox ? node.showLine : node;
  }

  static parsePremiseReference(s: string, module: LPDerivation): number | null {
    if (module.premises == null) return null;
    let i = s.indexOf(',');
    if (i !== -1 || (i = s.indexOf(';')) !== -1) s = s.substring(0, i);
    if (!s.startsWith('#')) return null;
    const n = parseJavaInt(s.substring(1));
    if (n == null) return null;
    return n >= 0 && n < module.premises.length ? n : null;
  }

  static parseInstantiation(s: string): SchemeInstantiation | null {
    let i = s.indexOf(',');
    if (i === -1) return null;
    let s1 = s.substring(i + 1);
    if ((i = s1.indexOf(';')) !== -1) s1 = s1.substring(0, i);
    return SchemeInstantiation.decode(s1);
  }

  static parseBoundVariables(s: string): BoundVariableMap | null {
    const i = s.indexOf(';');
    return i === -1 ? null : BoundVariableMap.decode(s.substring(i + 1));
  }

  static parseConditionInstance(s: string, module: LPDerivation): RuleInstance | null {
    return !s.startsWith('#') ? null : RuleInstance.decode(s.substring(1), (name) => module.getRule(name));
  }

  /** A copy of e with the subexpression at path replaced by a copy of replacement. */
  static replaceAt(e: Expression, replacement: Expression, path: ExpressionPath): Expression {
    const copy = replacement.copy();
    if (path.depth === 0) return copy;
    e = e.copy();
    e.getSubexpressionAt(path.indexes, 0, path.depth - 1, null)!.children[path.indexes[path.depth - 1]] = copy;
    return e;
  }

  // ---- source and result ----

  /** The equivalence's side that is replaced (from) or replaces (to), instantiated; null if none. */
  private sideParts(checker: DerivationLineChecker, from: boolean): { pattern: Expression; instance: Expression; map: BoundVariableMap | null; binderMap: BinderMap; mustRename: boolean } | null {
    const plain = this.isUnconditional();
    const binderMap = new BinderMap();
    if (this.ruleApplication != null) {
      const form = this.ruleApplication.form;
      const pattern = plain
        ? from
          ? RuleProperties.getFromSide(form, this.reversed)
          : RuleProperties.getToSide(form, this.reversed)
        : from
          ? RuleProperties.getConditionalFromSide(form, this.conditionReversed, this.reversed)
          : RuleProperties.getConditionalToSide(form, this.conditionReversed, this.reversed);
      if (pattern == null) return null;
      const instance = pattern.instantiate(this.ruleApplication.instantiation, binderMap);
      return { pattern, instance, map: this.ruleApplication.boundVariables, binderMap, mustRename: true };
    }
    let e: Expression | null;
    if (this.equivalenceLine != null) e = this.equivalenceLine.formula;
    else if (this.equivalencePremise != null) e = checker.line.box.module.premises![this.equivalencePremise];
    else e = null;
    const side = from ? (this.reversed ? 1 : 0) : this.reversed ? 0 : 1;
    const pattern = plain
      ? RuleProperties.getEquivalenceSide(e, false, side)
      : RuleProperties.getConditionalEquivalencePart(e, this.conditionReversed ? 0 : 1, side);
    if (pattern == null) return null;
    const instance = pattern.instantiate(this.instantiation, binderMap);
    // the source ignores a failed renaming of a line's or premise's equivalence (as in Java)
    return { pattern, instance, map: this.boundVariables, binderMap, mustRename: !from };
  }

  /** getSource(checker, true): no dialogs (a display). */
  getSourceSync(checker: DerivationLineChecker): Expression | null {
    return this.sideSync(checker, true);
  }

  getResultSync(checker: DerivationLineChecker): Expression | null {
    return this.sideSync(checker, false);
  }

  private sideSync(checker: DerivationLineChecker, from: boolean): Expression | null {
    const p = this.sideParts(checker, from);
    if (p == null) return null;
    if (p.map != null) {
      const ok = p.map.renameBinders(p.pattern, p.instance, p.binderMap);
      if (!ok && p.mustRename) return null;
    }
    return InterchangeJustification.replaceAt(checker.getStackFormula(-1)!, p.instance, this.path!).linkVariables();
  }

  /** getSource(checker): renaming unnamed bound variables may ask the user. */
  async getSource(checker: DerivationLineChecker): Promise<Expression | null> {
    return this.side(checker, true);
  }

  async getResult(checker: DerivationLineChecker): Promise<Expression | null> {
    return this.side(checker, false);
  }

  private async side(checker: DerivationLineChecker, from: boolean): Promise<Expression | null> {
    const p = this.sideParts(checker, from);
    if (p == null) return null;
    if (p.map != null) {
      const ok = await checker.renameBinders(p.map, p.pattern, p.instance, p.binderMap);
      if (!ok && p.mustRename) return null;
    }
    return InterchangeJustification.replaceAt(checker.getStackFormula(-1)!, p.instance, this.path!).linkVariables();
  }

  getConditionRule(checker: DerivationLineChecker): SchematicRule | null {
    if (this.conditionLine != null) return new LineRule(this.conditionLine);
    if (this.conditionPremise != null) return new PremiseRule(checker.line.box.module, this.conditionPremise + 1);
    return this.conditionInstance != null ? this.conditionInstance : null;
  }

  /** Strips outer universals of the actual condition that the rule's condition lacks. */
  static alignConditionQuantifiers(inst: SchemeInstantiation, pattern: Expression, condition: Expression): Expression | null {
    inst = inst.clone();
    pattern.match(null, inst);
    const fresh = inst.assignFreshLetters(condition).pendingLetters;
    const instantiated = pattern.instantiate(inst);
    const i = InterchangeJustification.countLeadingUniversals(instantiated);
    let j = InterchangeJustification.countLeadingUniversals(condition);
    if (j < i) return null;
    if (j === i) return condition;
    const variables: Expression[] = [];
    do {
      variables.push(condition.getChild(0)!.copy());
      condition = condition.getChild(1)!;
    } while (--j > i);
    const replacements = new SchemeInstantiation();
    for (const v of variables) {
      for (const path of condition.findOccurrences(v)) {
        const sub = instantiated.getSubexpression(path);
        if (sub != null && !InterchangeJustification.mentionsAnyLetter(sub, fresh) && !replacements.addReplacement(v, sub)) return null;
      }
    }
    return condition.instantiate(replacements);
  }

  getEquivalenceRule(checker: DerivationLineChecker): SchematicRule | null {
    if (this.ruleApplication != null) return this.ruleApplication.getForm();
    if (this.equivalenceLine != null) return new LineRule(this.equivalenceLine);
    return this.equivalencePremise != null ? new PremiseRule(checker.line.box.module, this.equivalencePremise + 1) : null;
  }

  /** The step as a one-premise rule application (from side .: to side), for the displays. */
  toRuleApplication(): RuleApplication | null {
    if (this.ruleApplication == null) return null;
    const form = new SchematicRule(this.ruleApplication.form.name);
    const noPremises = this.ruleApplication.form.premises.length === 0;
    let e: Expression | null;
    if (this.isUnconditional()) {
      if (!noPremises) return this.ruleApplication;
      e = RuleProperties.getEquivalenceOrConditional(this.ruleApplication.form.conclusion);
    } else if (noPremises) {
      e = RuleProperties.getConditionalEquivalence(this.ruleApplication.form.conclusion);
      if (e != null) e = e.getChild(this.conditionReversed ? 0 : 1);
    } else {
      e = this.ruleApplication.form.conclusion;
    }
    if (e == null) return null;
    form.premises = [e.getChild(this.reversed ? 1 : 0)!];
    form.conclusion = e.getChild(this.reversed ? 0 : 1);
    return new RuleApplication(form, [0], this.ruleApplication.instantiation, this.ruleApplication.boundVariables);
  }

  /**
   * The ways the rule's forms (or the line or premise used as a rule) rewrite the
   * subformula at path of the top of the stack; null if no form is even applicable. Forms
   * that are not usable are left out of the result.
   */
  static findApplications(checker: DerivationLineChecker, path: ExpressionPath, rule: Rule, condition: SchematicRule | null): InterchangeJustification[] | null {
    const sub = checker.getStackFormula(-1)!.getSubexpression(path)!.copy();
    let target = checker.matchLine && !checker.interactive ? checker.lineFormula : null;
    if (target != null) target = target.getSubexpression(path)!.copy();
    const properties = ruleTable!.properties;
    const forms = rule.getForms(properties, condition == null ? 'notConditional' : 'notConditionalBC');
    const module = checker.line.box.module;
    const allowed = rule.getForms(module, checker.interactive ? 'manualOrDisabled' : 'disabled');
    const found: InterchangeJustification[] = [];
    const unusable: InterchangeJustification[] = [];
    for (const form of forms) {
      let out = found;
      if (allowed.indexOf(form) === -1) out = unusable;
      else if (!InterchangeJustification.isRuleUsable(checker, form, condition == null)) out = unusable;
      let left: Expression;
      let right: Expression;
      let bic: boolean;
      let order: number[];
      let eq: Expression | null;
      if (form.premises.length === 0) {
        eq = condition == null ? RuleProperties.getEquivalenceOrConditional(form.conclusion) : RuleProperties.getConditionalEquivalence(form.conclusion);
        left = eq!.getChild(0)!;
        right = eq!.getChild(1)!;
        bic = eq!.symbol === '<->';
        order = [];
      } else {
        eq = null;
        left = form.premises[0];
        right = form.conclusion!;
        bic = false;
        order = [0];
      }
      const I = InterchangeJustification;
      if (condition == null) {
        if (form instanceof LineRule) {
          if (eq != null && bic) {
            const line = form.line;
            let inst = I.identityInstantiation(form.conclusion!);
            let map = I.matchEquivalence(inst, left, right, sub, target);
            if (map != null) out.push(I.withLine(path, false, line, inst, map));
            inst = I.identityInstantiation(form.conclusion!);
            map = I.matchEquivalence(inst, right, left, sub, target);
            if (map != null) out.push(I.withLine(path, true, line, inst, map));
          }
        } else if (form instanceof PremiseRule) {
          if (eq != null && bic) {
            const premise = form.premiseIndex;
            let inst = I.identityInstantiation(form.conclusion!);
            let map = I.matchEquivalence(inst, left, right, sub, target);
            if (map != null) out.push(I.withPremise(path, false, premise, inst, map));
            inst = I.identityInstantiation(form.conclusion!);
            map = I.matchEquivalence(inst, right, left, sub, target);
            if (map != null) out.push(I.withPremise(path, true, premise, inst, map));
          }
        } else {
          let inst = new SchemeInstantiation();
          let map = I.matchEquivalence(inst, left, right, sub, target);
          if (map != null) out.push(I.withRule(path, false, new RuleApplication(form, order, inst, map)));
          if (bic) {
            inst = new SchemeInstantiation();
            map = I.matchEquivalence(inst, right, left, sub, target);
            if (map != null) out.push(I.withRule(path, true, new RuleApplication(form, order, inst, map)));
          }
        }
        continue;
      }
      const cond = condition.conclusion!;
      const tryPair = (make: (rev: boolean, condRev: boolean, inst: SchemeInstantiation, map: BoundVariableMap) => InterchangeJustification, fresh: () => SchemeInstantiation) => {
        if (right.symbol === '<->') {
          let inst = fresh();
          let map = I.matchConditionalEquivalence(inst, right.getChild(0)!, right.getChild(1)!, left, sub, target, cond);
          if (map != null) out.push(make(false, false, inst, map));
          inst = fresh();
          map = I.matchConditionalEquivalence(inst, right.getChild(1)!, right.getChild(0)!, left, sub, target, cond);
          if (map != null) out.push(make(true, false, inst, map));
        }
        if (bic && left.symbol === '<->') {
          let inst = fresh();
          let map = I.matchConditionalEquivalence(inst, left.getChild(0)!, left.getChild(1)!, right, sub, target, cond);
          if (map != null) out.push(make(false, true, inst, map));
          inst = fresh();
          map = I.matchConditionalEquivalence(inst, left.getChild(1)!, left.getChild(0)!, right, sub, target, cond);
          if (map != null) out.push(make(true, true, inst, map));
        }
      };
      if (form instanceof LineRule) {
        if (eq != null) {
          const line = form.line;
          tryPair((rev, condRev, inst, map) => I.withLine(path, rev, line, inst, map, condRev, condition), () => I.identityInstantiation(form.conclusion!));
        }
      } else if (form instanceof PremiseRule) {
        if (eq != null) {
          const premise = form.premiseIndex;
          tryPair((rev, condRev, inst, map) => I.withPremise(path, rev, premise, inst, map, condRev, condition), () => I.identityInstantiation(form.conclusion!));
        }
      } else {
        tryPair(
          (rev, condRev, inst, map) => I.withRule(path, rev, new RuleApplication(form, order, inst, map), condRev, condition),
          () => new SchemeInstantiation(),
        );
      }
    }
    return unusable.length === 0 && found.length === 0 ? null : found;
  }

  static matchEquivalence(inst: SchemeInstantiation, from: Expression, to: Expression, sub: Expression, target: Expression | null): BoundVariableMap | null {
    return InterchangeJustification.matchConditionalEquivalence(inst, from, to, null, sub, target, null);
  }

  static matchConditionalEquivalence(
    inst: SchemeInstantiation,
    from: Expression,
    to: Expression,
    conditionPattern: Expression | null,
    sub: Expression,
    target: Expression | null,
    condition: Expression | null,
  ): BoundVariableMap | null {
    let binderMap = new BinderMap();
    if (!from.match(sub, inst, binderMap)) return null;
    if (!to.match(target, inst, binderMap)) return null;
    if (condition != null) {
      condition = InterchangeJustification.alignConditionQuantifiers(inst, conditionPattern!, condition);
      if (condition == null) return null;
    }
    if (conditionPattern != null && !conditionPattern.match(condition, inst, binderMap)) return null;
    const map = new BoundVariableMap();
    if (!map.matchBinders(from, sub, binderMap)) return null;
    if (!map.matchBinders(to, target, binderMap)) return null;
    if (conditionPattern != null && !map.matchBinders(conditionPattern, condition, binderMap)) return null;
    binderMap = new BinderMap();
    const e6 = from.instantiate(inst, binderMap);
    const e7 = to.instantiate(inst, binderMap);
    const e8 = conditionPattern == null ? null : conditionPattern.instantiate(inst, binderMap);
    if (!map.renameBinders(from, e6, binderMap)) return null;
    if (!map.renameBinders(to, e7, binderMap)) return null;
    if (conditionPattern != null && !map.renameBinders(conditionPattern, e8!, binderMap)) return null;
    return map;
  }

  static mentionsAnyLetter(e: Expression, letters: readonly SchematicLetter[] | null): boolean {
    for (const letter of letters ?? []) if (e.findLetterOccurrences(letter).length !== 0) return true;
    return false;
  }

  static countLeadingUniversals(e: Expression): number {
    let i = 0;
    for (let x = e; x.symbol === '@'; x = x.getChild(1)!) i++;
    return i;
  }

  /**
   * Whether the form may be used for IE/CIE here: enabled (not manual when interactive),
   * proven, and for IE, a converse of it too (forms of a line or premise always; a line
   * only if it may be cited).
   */
  static isRuleUsable(checker: DerivationLineChecker, form: SchematicRule, plain: boolean): boolean {
    if (form instanceof PremiseRule) return true;
    if (form instanceof LineRule) return checker.canUse(form.line);
    const module = checker.line.box.module;
    const prop = checker.interactive ? 'manualOrDisabled' : 'disabled';
    if (module.hasProperty(form, prop)) return false;
    if (!form.isProven(module)) {
      module.proofMissing = true;
      return false;
    }
    if (!plain) return true;
    const converses = ruleTable!.properties.getConverses(form);
    for (const name of converses ?? []) {
      const rule = module.getRule(name);
      if (rule instanceof SchematicRule && !module.hasProperty(rule, prop)) {
        if (rule.isProven(module)) return true;
        module.proofMissing = true;
      }
    }
    return false;
  }
}

/** TaggedRecord.minNonNegative. */
function minNonNegative(a: number, b: number): number {
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

