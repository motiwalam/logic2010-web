/**
 * Port of DerivationLineChecker.java: checks a line's justification, a small stack program.
 * Cited line numbers push their formulas; each rule pops its premises and pushes its result
 * for the next step ("2 pr1 MP 2 pr2 MP ID"). A formula in brackets after a rule name
 * ("MP[Q]") asserts the step's result; DUP, DROP and SWAP rearrange the stack.
 *
 * readNextStep reads the cited lines and the next rule name; checkStep applies the rule
 * (applyStep dispatches: box rules, assumptions, premises, SHOW commands, IE/CIE, and named
 * rules and theorems through matchRule). Steps whose choices the user made in dialogs are
 * cached in the line's justifications and replayed without asking.
 *
 * In preview mode (the stack and rules views) the first error is recorded instead of shown
 * and nothing is cached.
 */
import { BinderMap } from '../../formula/BinderMap';
import { ConnectiveFormula, type Expression, Formula, type Mislink, QuantifiedFormula, SimpleTerm, Term } from '../../formula/Expression';
import type { ExpressionPath } from '../../formula/ExpressionPath';
import { FormulaParseException, parseFormula } from '../../formula/parseFormula';
import { PredicateLetter, SchematicLetter, type SchematicLetter as Letter } from '../../formula/SchematicLetter';
import { SchemeInstantiation } from '../../formula/SchemeInstantiation';
import { ErrorRef, Message, type MessageParams, type MessageParamSource } from '../../program/Message';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import type { BinderNaming, BoundVariableMap } from '../../rules/BoundVariableMap';
import { BoundVariableMap as BoundVariableMapClass } from '../../rules/BoundVariableMap';
import { PermutationIterator } from '../../rules/PermutationIterator';
import { type Rule, type SchematicRule, Theorem } from '../../rules/Rule';
import { getRule as getProgramRule, getTheorem } from '../../rules/RuleTable';
import { javaTrim, parseJavaInt } from '../../util/java';
import { isDigit, isJavaLetter, isJavaWhitespace } from './chars';
import { ASS_STR, BD_ASS } from './DerivationConstants';
import { DerivationBox } from './DerivationBox';
import * as Dialogs from './DerivationDialogs';
import type { DerivationLine } from './DerivationLine';
import { formatDerivationMessage, getDerivationText } from './DerivationMessage';
import type { DerivationNode } from './DerivationNode';
import { BiconditionalAssumptionJustification, IndirectAssumptionJustification, type Justification, PremiseJustification } from './Justification';
import { InterchangeJustification } from './InterchangeJustification';
import type { LPDerivation } from './LPDerivation';
import { RuleApplication } from './RuleApplication';

const BOX_RULES = ['CD', 'ID', 'DD', 'UD', 'BD'];

export class DerivationLineChecker implements MessageParamSource {
  line: DerivationLine;
  citedNodes: (DerivationNode | null)[] = [];
  stack: Expression[] = [];
  argumentCount = 0;
  ruleName: string | null = null;
  remaining: string | null = null;
  lineFormula: Expression | null = null;
  result: Expression | null = null;
  stepIndex = -1;
  matchLine = false;
  finalStep = false;
  interactive: boolean;
  reusedCache = false;
  cachedError: ErrorRef | null = null;
  hasPremiseMatch = false;
  hasFullMatch = false;
  premiseMatches: RuleApplication[] | null = null;
  fullMatches: RuleApplication[] | null = null;
  consumedFormulas: Expression[] | null = null;
  presetAnswers: string[] | null = null;
  assertion: Expression | null = null;
  target: Expression | null = null;
  preview = false;
  previewError: ErrorRef | null = null;
  allForms: SchematicRule[] | null = null;
  enabledForms: SchematicRule[] | null = null;
  automaticForms: SchematicRule[] | null = null;
  minPremises = -1;
  maxPremises = -1;
  clashes: Mislink[] | null = null;
  static readonly MAX_CHOICES = 12;
  static readonly MAX_OCCURRENCES = 3;

  /** A checker of the line's justification; with previewText, a preview of that text. */
  constructor(line: DerivationLine, interactive: boolean, previewText?: string) {
    this.line = line;
    this.interactive = interactive;
    this.reset();
    if (previewText !== undefined) {
      this.preview = true;
      this.remaining = previewText;
    }
  }

  get module(): LPDerivation {
    return this.line.box.module;
  }

  reset(): void {
    this.citedNodes = [];
    this.stack = [];
    this.argumentCount = 0;
    this.ruleName = null;
    this.remaining = this.line.getAnnotationText(true);
    this.lineFormula = this.line.getFormula();
    this.result = null;
    this.stepIndex = -1;
    this.matchLine = false;
    this.finalStep = false;
    this.reusedCache = false;
    this.cachedError = null;
    this.premiseMatches = null;
    this.hasPremiseMatch = false;
    this.fullMatches = null;
    this.hasFullMatch = false;
    this.consumedFormulas = null;
    this.presetAnswers = null;
    this.assertion = null;
    this.target = null;
    this.allForms = null;
    this.enabledForms = null;
    this.automaticForms = null;
    this.clashes = null;
    this.computePremiseRange();
  }

  computePremiseRange(): void {
    this.minPremises = -1;
    this.maxPremises = -1;
    if (this.automaticForms == null) return;
    for (const form of this.automaticForms) {
      const k = form.premises.length;
      if (k <= this.argumentCount && ((!this.matchLine && !this.finalStep) || k === this.argumentCount)) {
        if (k > this.maxPremises) this.maxPremises = k;
        if (this.minPremises === -1 || k < this.minPremises) this.minPremises = k;
      }
    }
  }

  /**
   * Reads the cited lines up to the next rule name (and its asserted result); false on an
   * error. At the end of the text the rule name is null.
   */
  readNextStep(): boolean {
    this.ruleName = null;
    this.assertion = null;
    if (this.remaining == null) return true;
    let c0 = '\u0000';
    let digitsOnly = true;
    let wellFormed = true;
    let afterAss = false;
    let afterShow = false;
    if (this.result != null) {
      this.citedNodes.push(null);
      this.stack.push(this.result);
    }
    const root = this.line.box.module.problem;
    while (wellFormed && digitsOnly) {
      let k = 0;
      const l = this.remaining.length;
      for (; k < l; k++) {
        c0 = this.remaining.charAt(k);
        if (isDigit(c0)) break;
        if (DerivationLineChecker.isNameChar(c0)) {
          digitsOnly = false;
          break;
        }
        if (c0 === '[' || c0 === ']') {
          this.reportError('dererr112', Message.params('assertion', this.remaining.substring(k)));
          return false;
        }
      }
      if (k >= l) {
        if (afterAss) {
          this.reportError('dererr001');
          return false;
        }
        if (afterShow) {
          this.reportError('dererr018');
          return false;
        }
        if (this.stack.length !== 0) {
          this.reportError('dererr002');
          return false;
        }
        return true;
      }
      const i = k++;
      for (; k < l; k++) {
        c0 = this.remaining.charAt(k);
        if (DerivationLineChecker.isNameChar(c0)) {
          if (digitsOnly) wellFormed = false;
        } else if (!isDigit(c0)) {
          break;
        }
      }
      const j = k++;
      if (wellFormed && digitsOnly) {
        if (afterAss) {
          this.reportError('dererr001');
          return false;
        }
        if (afterShow) {
          this.reportError('dererr018');
          return false;
        }
        const digits = this.remaining.substring(i, j);
        const n = parseIntOrNull(digits);
        const node = n == null ? null : root.findLine(n);
        if (node == null) {
          this.reportError('dererr003', Message.params('remote line number', digits));
          return false;
        }
        if (!this.canUse(node)) return false;
        const e = node.getFormula();
        if (e == null) {
          const id = javaTrim(node.getFormulaText(true)!) === '' ? 'dererr004' : 'dererr005';
          this.reportError(id, Message.params('remote line number', digits));
          return false;
        }
        this.citedNodes.push(node);
        this.stack.push(e);
        this.remaining = this.remaining.substring(j);
      } else {
        this.ruleName = this.remaining.substring(i, j);
        this.remaining = this.remaining.substring(j);
        if (wellFormed) {
          this.ruleName = this.normalizeRuleName(this.ruleName);
          if (afterAss) {
            this.ruleName = 'ASS ' + this.ruleName;
          } else if (afterShow) {
            this.ruleName = 'SHOW ' + this.ruleName;
          } else if (this.ruleName === 'ASS') {
            afterAss = true;
            digitsOnly = true;
            continue;
          } else if (this.ruleName === 'SHOW') {
            afterShow = true;
            digitsOnly = true;
            continue;
          }
        } else {
          this.reportError('dererr006');
        }
        return wellFormed && this.readAssertion();
      }
    }
    return false;
  }

  /** Whether another step follows (then the text is advanced to it). */
  skipToNextStep(): boolean {
    const s = this.remaining!;
    for (let j = 0; j < s.length; j++) {
      const c = s.charAt(j);
      if (isDigit(c) || DerivationLineChecker.isNameChar(c)) {
        this.remaining = s.substring(j);
        return true;
      }
    }
    return false;
  }

  /** The operand of SHOW UNNEG etc.: a line's formula, a premise (asking which for PR), an ErrorRef, or null. */
  async readSourceFormula(): Promise<Expression | ErrorRef | null> {
    const n = this.readLineNumber();
    if (n != null) {
      const node = this.line.box.module.problem.findLine(n);
      if (node == null) return new ErrorRef('dererr003', Message.params('remote line number', n.toString()));
      if (!this.canUse(node)) return new ErrorRef(null as unknown as string);
      const e = node.getFormula();
      if (e == null) {
        const id = javaTrim(node.getFormulaText(true)!) === '' ? 'dererr004' : 'dererr005';
        return new ErrorRef(id, Message.params('remote line number', n.toString()));
      }
      return e;
    }
    let i = this.readPremiseNumber();
    if (i === -1) return null;
    const premises = this.line.box.module.premises;
    if (premises == null || premises.length === 0) return new ErrorRef('dererr029');
    if (i > premises.length) return new ErrorRef('dererr030', Message.params('premise index', i + ''));
    if (i === 0) {
      if (premises.length > 1) {
        i = (await Dialogs.chooseFormula(this.line, premises as Expression[], formatDerivationMessage(getDerivationText('derdlg002'), null, this))) + 1;
        if (i === 0) return new ErrorRef(null as unknown as string);
      } else {
        i = 1;
      }
    }
    return premises[i - 1];
  }

  /** Whether the line may cite node; in preview the error is recorded instead of shown. */
  canUse(node: DerivationNode): boolean {
    if (!this.preview) return this.line.canUse(node);
    const error = this.line.usageError(node);
    if (error != null) this.reportError(error.id, error.params);
    return error == null;
  }

  readLineNumber(): number | null {
    const s = this.remaining!;
    let k = 0;
    const l = s.length;
    let c0 = '\u0000';
    for (; k < l; k++) {
      c0 = s.charAt(k);
      if (isDigit(c0)) break;
      if (DerivationLineChecker.isNameChar(c0)) return null;
    }
    if (k >= l) return null;
    const i = k++;
    for (; k < l; k++) {
      c0 = s.charAt(k);
      if (!isDigit(c0)) break;
    }
    if (DerivationLineChecker.isNameChar(c0)) return null;
    const j = k++;
    const n = parseJavaInt(s.substring(i, j));
    if (n != null) this.remaining = s.substring(j);
    return n;
  }

  readPremiseNumber(): number {
    const s = this.remaining!;
    let k = 0;
    const l = s.length;
    for (; k < l; k++) {
      const c = s.charAt(k);
      if (isDigit(c)) return -1;
      if (DerivationLineChecker.isNameChar(c)) break;
    }
    if (k >= l) return -1;
    const i = k++;
    for (; k < l; k++) {
      const c = s.charAt(k);
      if (!isDigit(c) && !DerivationLineChecker.isNameChar(c)) break;
    }
    const j = k++;
    const n = DerivationLineChecker.parsePremiseNumber(s.substring(i, j).toUpperCase());
    if (n !== -1) this.remaining = s.substring(j);
    return n;
  }

  static isNameChar(c: string): boolean {
    return !isJavaLetter(c) && c.charCodeAt(0) < 256 ? '~!@#$%^&*(){}_+-=<>|/'.indexOf(c) !== -1 : true;
  }

  /** Upper-cases a rule name; what follows a '/' becomes preset answers ("UI/a"). */
  normalizeRuleName(s: string | null): string | null {
    if (s == null) return null;
    let i = s.indexOf('/');
    if (i !== -1) {
      if (this.presetAnswers == null) this.presetAnswers = [];
      let rest = s.substring(i + 1);
      s = s.substring(0, i);
      while ((i = rest.indexOf('/')) !== -1) {
        this.presetAnswers.push(rest.substring(0, i));
        rest = rest.substring(i + 1);
      }
      this.presetAnswers.push(rest);
    }
    return s.toUpperCase();
  }

  cacheJustification(j: Justification | null): void {
    if (this.preview) return;
    this.line.justifications![this.stepIndex] = j;
  }

  private fail(): false {
    this.line.justifications = null;
    this.line.box.strategyConsistent = false;
    return false;
  }

  static containsWildcard(e: Expression): boolean {
    if (e.symbol.startsWith('?')) return true;
    for (let j = 0; j < e.getChildCount(); j++) if (DerivationLineChecker.containsWildcard(e.getChild(j)!)) return true;
    return false;
  }

  /**
   * Whether e matches a Show formula with wildcards: ? any formula, ?PNX prenex, ?NOV
   * quantifiers only outside, ?DNF / ?CNF normal forms.
   */
  static matchesPattern(e: Expression, pattern: Expression): boolean {
    if (!pattern.symbol.startsWith('?')) {
      if (e.symbol !== pattern.symbol) return false;
      const n = e.getChildCount();
      if (pattern.getChildCount() !== n) return false;
      for (let j = 0; j < n; j++) if (!DerivationLineChecker.matchesPattern(e.getChild(j)!, pattern.getChild(j)!)) return false;
      return true;
    }
    if (!(e instanceof Formula)) return false;
    if (e.findMislinkedVariables() != null) return false;
    if (pattern.symbol === '?PNX') return DerivationLineChecker.isPrenex(e);
    if (pattern.symbol === '?NOV') return DerivationLineChecker.hasOnlyOuterQuantifiers(e);
    if (pattern.symbol === '?DNF') return DerivationLineChecker.isNormalForm(e, true);
    return pattern.symbol === '?CNF' ? DerivationLineChecker.isNormalForm(e, false) : pattern.symbol === '?';
  }

  static isPrenex(e: Expression): boolean {
    return e instanceof QuantifiedFormula ? DerivationLineChecker.isPrenex(e.getChild(1)!) : DerivationLineChecker.isQuantifierFree(e);
  }

  static hasOnlyOuterQuantifiers(e: Expression): boolean {
    if (e instanceof QuantifiedFormula) return DerivationLineChecker.isQuantifierFree(e.getChild(1)!);
    for (let j = 0; j < e.getChildCount(); j++) if (!DerivationLineChecker.hasOnlyOuterQuantifiers(e.getChild(j)!)) return false;
    return true;
  }

  static isQuantifierFree(e: Expression): boolean {
    if (e instanceof QuantifiedFormula) return false;
    for (let j = 0; j < e.getChildCount(); j++) if (!DerivationLineChecker.isQuantifierFree(e.getChild(j)!)) return false;
    return true;
  }

  static isNormalForm(e: Expression, disjunctive: boolean): boolean {
    if (e instanceof QuantifiedFormula) return DerivationLineChecker.isNormalForm(e.getChild(1)!, disjunctive);
    const s = e.symbol;
    if (s === '->' || s === '<->') return false;
    for (let j = 0; j < e.getChildCount(); j++) {
      const c = e.getChild(j)!;
      const s1 = c.symbol;
      if (s === '~') {
        if (s1 === '~' || s1 === '&' || s1 === '|') return false;
      } else if (disjunctive) {
        if (s === '&' && s1 === '|') return false;
      } else if (s === '|' && s1 === '&') {
        return false;
      }
      if (!DerivationLineChecker.isNormalForm(c, disjunctive)) return false;
    }
    return true;
  }

  /**
   * Checks one step. matchLine: the last step, whose result must be the line's formula;
   * finalStep: the last step checked without requiring that (the result is compared later).
   * A formula in brackets after the rule name ("MP[Q]") is the result the step must have: it
   * selects among the rule's possible results as the line's formula does on the last step,
   * and the step fails if the rule cannot produce it.
   */
  async checkStep(matchLine: boolean, finalStep = false): Promise<boolean> {
    this.target = this.assertion != null ? this.assertion : matchLine ? this.lineFormula : null;
    if (this.assertion != null && matchLine && this.lineFormula != null && !this.assertion.isIdentical(this.lineFormula)) {
      this.reportError('dererr111');
      return this.fail();
    }
    if (!(await this.applyStep(matchLine, finalStep))) return false;
    if (this.assertion != null && !this.assertionHolds()) {
      this.reportError('dererr110');
      return this.fail();
    }
    return true;
  }

  /** Whether the step just applied produced the asserted formula. */
  assertionHolds(): boolean {
    const name = this.ruleName!;
    if (DerivationLineChecker.isStackOperation(name)) {
      const e = this.getStackFormula(-1);
      return e != null && e.isIdentical(this.assertion);
    }
    if (BOX_RULES.includes(name)) {
      const e = this.line.box.getFormula();
      return e != null && e.isIdentical(this.assertion);
    }
    return this.result != null && this.result.isIdentical(this.assertion);
  }

  static isStackOperation(s: string): boolean {
    return s === 'DUP' || s === 'DROP' || s === 'SWAP';
  }

  /** Reads "[formula]" right after a rule name (blanks may come between); brackets nest. */
  readAssertion(): boolean {
    const s = this.remaining!;
    let i = 0;
    const j = s.length;
    while (i < j && isJavaWhitespace(s.charAt(i))) i++;
    if (i < j && s.charAt(i) === ']') {
      this.reportError('dererr112', Message.params('assertion', s.substring(i)));
      return false;
    }
    if (i >= j || s.charAt(i) !== '[') return true;
    let k = i;
    let depth = 0;
    for (; k < j; k++) {
      const c = s.charAt(k);
      if (c === '[') depth++;
      else if (c === ']' && --depth === 0) break;
    }
    if (k >= j) {
      this.reportError('dererr112', Message.params('assertion', s.substring(i)));
      return false;
    }
    const text = s.substring(i + 1, k);
    try {
      this.assertion = parseFormula(translateSymbols(text, symbols, maggie));
    } catch (e) {
      if (!(e instanceof FormulaParseException)) throw e;
      this.assertion = null;
    }
    if (this.assertion == null) {
      this.reportError('dererr112', Message.params('assertion', s.substring(i, k + 1)));
      return false;
    }
    this.remaining = s.substring(k + 1);
    return true;
  }

  private async applyStep(matchLine: boolean, finalStep: boolean): Promise<boolean> {
    const module = this.line.box.module;
    const box = this.line.box;
    this.argumentCount = this.getStackSize();
    this.matchLine = matchLine;
    this.finalStep = finalStep;
    this.premiseMatches = null;
    this.hasPremiseMatch = false;
    this.fullMatches = null;
    this.hasFullMatch = false;
    this.allForms = null;
    this.enabledForms = null;
    this.automaticForms = null;
    this.computePremiseRange();
    this.stepIndex++;
    if (this.line.justifications == null) this.line.justifications = [];
    const cache = this.line.justifications;
    const d = this.stepIndex + 1 - cache.length;
    if (d > 0 || ((matchLine || finalStep) && d < 0)) setSize(cache, this.stepIndex + 1);
    const name = this.ruleName!;
    let error = module.checkDerivationRule(name, this.interactive);
    if (error != null) {
      this.reportError(error.getId());
      return this.fail();
    }
    if (DerivationLineChecker.isStackOperation(name)) {
      if (matchLine || finalStep) {
        this.reportError('dererr114');
        return this.fail();
      }
    } else if (!BOX_RULES.includes(name)) {
      if ((matchLine || finalStep) && box.cancelLine === this.line) {
        this.reportError('dererr009');
        return this.fail();
      }
    } else {
      if (!matchLine && !finalStep) {
        this.reportError('dererr007');
        return this.fail();
      }
      const last = this.line.isLastInBox();
      this.line.readyToCancel = last && box.cancelLine !== this.line;
      if (!last) {
        this.reportError('dererr008');
        return this.fail();
      }
    }
    box.strategyConsistent =
      box.strategyConsistent && (name === 'IE' || name === 'CIE' || name === 'BD' || name.startsWith('ASS '));
    const cached = this.line.justifications![this.stepIndex];
    if (cached != null) {
      const stack = this.stack.slice();
      const cited = this.citedNodes.slice();
      const result = this.result;
      if (await cached.reapply(this)) {
        if (this.assertion == null || this.assertionHolds()) {
          this.reusedCache = true;
          return true;
        }
        this.stack = stack;
        this.citedNodes = cited;
        this.result = result;
        this.consumedFormulas = null;
        this.cachedError = null;
      }
      if (this.cachedError != null) {
        this.reportError(this.cachedError.id, this.cachedError.params);
        return this.fail();
      }
      this.cacheJustification(null);
    }
    if (DerivationLineChecker.isStackOperation(name)) return this.applyStackOperation();
    if (name === 'CD') {
      if (this.argumentCount !== 1) {
        this.reportError('dererr010', Message.params('n', '1'));
        return this.fail();
      }
      const show = box.getFormula();
      const top = this.getStackFormula(-1)!;
      if (show == null) {
        this.reportError(javaTrim(box.getFormulaText(true)!) === '' ? 'dererr011' : 'dererr012');
        return this.fail();
      }
      if (show.getSymbol() !== '->') {
        this.reportError('dererr013');
        return this.fail();
      }
      if (!DerivationLineChecker.matchesPattern(top, show.getChild(1)!)) {
        this.reportError('dererr014');
        return this.fail();
      }
      const outside = this.getCitedNodeOutsideBox(-1);
      if (outside != null) {
        this.reportError('dererr015', Message.params('remote line number', outside.getLineNumber() + ''));
        return this.fail();
      }
      if (box.cancelLine === this.line && module.serialMode && !this.preview) {
        const t = box.assumptionType;
        if ((module.mixedModeDisabled && t !== 2) || (t !== 0 && t !== 1 && t !== 2)) {
          this.reportError('dererr101');
          return this.fail();
        }
        if ((error = module.checkDerivationRule('CD/' + ASS_STR[t], this.interactive)) != null) {
          this.reportError(error.id);
          return this.fail();
        }
        box.showLine.showMessageInPhase(t === 2 ? 'derinf001' : 'derinf002', 4);
      }
      this.popStack(1);
      return true;
    }
    if (name === 'ID') {
      if (this.argumentCount !== 2) {
        this.reportError('dererr010', Message.params('n', '2'));
        return this.fail();
      }
      const a = this.getStackFormula(-2)!;
      const b = this.getStackFormula(-1)!;
      if (!a.isNegationOf(b) && !b.isNegationOf(a)) {
        this.reportError('dererr017');
        return this.fail();
      }
      let outside = this.getCitedNodeOutsideBox(-2);
      if (outside == null) outside = this.getCitedNodeOutsideBox(-1);
      if (outside != null) {
        this.reportError('dererr015', Message.params('remote line number', outside.getLineNumber() + ''));
        return this.fail();
      }
      if (box.cancelLine === this.line && module.serialMode && !this.preview) {
        const t = box.assumptionType;
        if ((module.mixedModeDisabled && t !== 1) || (t !== 0 && t !== 1 && t !== 2)) {
          this.reportError('dererr101');
          return this.fail();
        }
        if ((error = module.checkDerivationRule('ID/' + ASS_STR[t], this.interactive)) != null) {
          this.reportError(error.id);
          return this.fail();
        }
        box.showLine.showMessage(t === 1 ? 'derinf001' : 'derinf002');
      }
      this.popStack(2);
      return true;
    }
    if (name === 'DD') {
      if (this.argumentCount !== 1) {
        this.reportError('dererr010', Message.params('n', '1'));
        return this.fail();
      }
      const show = box.getFormula();
      const top = this.getStackFormula(-1)!;
      if (show == null) {
        this.reportError(javaTrim(box.getFormulaText(true)!) === '' ? 'dererr011' : 'dererr012');
        return this.fail();
      }
      if (!DerivationLineChecker.matchesPattern(top, show)) {
        this.reportError('dererr019');
        return this.fail();
      }
      const outside = this.getCitedNodeOutsideBox(-1);
      if (outside != null) {
        this.reportError('dererr015', Message.params('remote line number', outside.getLineNumber() + ''));
        return this.fail();
      }
      if (box.cancelLine === this.line && module.serialMode && !this.preview) {
        const t = box.assumptionType;
        if ((module.mixedModeDisabled && t !== 0) || (t !== 0 && t !== 1 && t !== 2)) {
          this.reportError('dererr101');
          return this.fail();
        }
        if ((error = module.checkDerivationRule('DD/' + ASS_STR[t], this.interactive)) != null) {
          this.reportError(error.id);
          return this.fail();
        }
        box.showLine.showMessage(t === 0 ? 'derinf001' : 'derinf002');
      }
      this.popStack(1);
      return true;
    }
    if (name === 'UD') {
      if (this.argumentCount !== 1) {
        this.reportError('dererr010', Message.params('n', '1'));
        return this.fail();
      }
      const show = box.getFormula();
      const top = this.getStackFormula(-1)!;
      if (show == null) {
        this.reportError(javaTrim(box.getFormulaText(true)!) === '' ? 'dererr011' : 'dererr012');
        return this.fail();
      }
      if (show.getSymbol() !== '@') {
        this.reportError('dererr021');
        return this.fail();
      }
      if (!DerivationLineChecker.matchesPattern(top, show.getChild(1)!)) {
        this.reportError('dererr022');
        return this.fail();
      }
      const outside = this.getCitedNodeOutsideBox(-1);
      if (outside != null) {
        this.reportError('dererr015', Message.params('remote line number', outside.getLineNumber() + ''));
        return this.fail();
      }
      const v = show.getChild(0)!.symbol;
      if (this.isVariableUsedInOuterBoxes(v)) {
        this.reportError('dererr023', Message.params('variable name', '\\l' + v + '\\l'));
        return this.fail();
      }
      this.popStack(1);
      return true;
    }
    if (name === 'BD') {
      if (this.argumentCount !== 1) {
        this.reportError('dererr010', Message.params('n', '1'));
        return this.fail();
      }
      const show = box.getFormula();
      if (show == null) {
        this.reportError(javaTrim(box.getFormulaText(true)!) === '' ? 'dererr011' : 'dererr012');
        return this.fail();
      }
      if (show.getSymbol() !== '<->') {
        this.reportError('dererr081');
        return this.fail();
      }
      const top = this.getStackFormula(-1)!;
      const side = box.assumedSide;
      const mp = DerivationLineChecker.matchesPattern;
      if (side === -1) {
        if (!mp(top, show.getChild(0)!) && !mp(top, show.getChild(1)!)) {
          this.reportError('dererr102');
          return this.fail();
        }
      } else {
        const other = side === 2 ? box.getNode(1).getFormula() : show.getChild(side);
        if ((!mp(top, show.getChild(0)!) || !mp(other!, show.getChild(1)!)) && (!mp(other!, show.getChild(0)!) || !mp(top, show.getChild(1)!))) {
          this.reportError('dererr090');
          return this.fail();
        }
      }
      if (module.serialMode && !box.strategyConsistent && !this.preview) {
        this.reportError('dererr091');
        return this.fail();
      }
      const outside = this.getCitedNodeOutsideBox(-1);
      if (outside != null) {
        this.reportError('dererr015', Message.params('remote line number', outside.getLineNumber() + ''));
        return this.fail();
      }
      if (box.cancelLine === this.line && module.serialMode && !this.preview) {
        const t = box.assumptionType;
        if (t !== 3) {
          this.reportError('dererr101');
          return this.fail();
        }
        if ((error = module.checkDerivationRule('BD/' + ASS_STR[t], this.interactive)) != null) {
          this.reportError(error.id);
          return this.fail();
        }
        box.showLine.showMessageInPhase(t === 3 ? 'derinf001' : 'derinf002', 4);
      }
      this.popStack(1);
      return true;
    }
    if (name === 'ASS CD') {
      if (!this.checkAssumptionPlace()) return this.fail();
      const show = box.getFormula();
      if (show == null) {
        this.reportError(javaTrim(box.getFormulaText(true)!) === '' ? 'dererr011' : 'dererr012');
        return this.fail();
      }
      if (show.getSymbol() !== '->') {
        this.reportError('dererr013');
        return this.fail();
      }
      box.assumptionType = 2;
      this.result = show.getChild(0);
      if (matchLine && !this.checkResultMatchesLine()) return this.fail();
      this.popStack(0);
      return true;
    }
    if (name === 'ASS ID') {
      if (!this.checkAssumptionPlace()) return this.fail();
      const show = box.getFormula();
      if (show == null) {
        this.reportError(javaTrim(box.getFormulaText(true)!) === '' ? 'dererr011' : 'dererr012');
        return this.fail();
      }
      if (this.target != null) {
        if (!show.isNegationOf(this.target) && !this.target.isNegationOf(show)) {
          this.reportError(this.assertion != null ? 'dererr110' : 'dererr027');
          return this.fail();
        }
        this.result = this.target;
      } else if (show.getSymbol() === '~') {
        const choices = [show.getChild(0)!, show.negate()];
        const i = await Dialogs.chooseFormula(this.line, choices, formatDerivationMessage(getDerivationText('derdlg001'), null, this));
        if (i === -1) {
          this.refuseOrAbort();
          return this.fail();
        }
        this.result = choices[i];
        this.cacheJustification(new IndirectAssumptionJustification(i === 1));
      } else {
        this.result = show.negate();
      }
      box.assumptionType = 1;
      if (matchLine && !this.checkResultMatchesLine()) return this.fail();
      this.popStack(0);
      return true;
    }
    const bd = BD_ASS.indexOf(name);
    if (bd !== -1) {
      if (!this.checkAssumptionPlace()) return this.fail();
      const show = box.getFormula();
      if (show == null) {
        this.reportError(javaTrim(box.getFormulaText(true)!) === '' ? 'dererr011' : 'dererr012');
        return this.fail();
      }
      if (show.getSymbol() !== '<->') {
        this.reportError('dererr081');
        return this.fail();
      }
      if (this.target != null) {
        if ((bd === 1 || !show.getChild(0)!.isIdentical(this.target)) && (bd === 0 || !show.getChild(1)!.isIdentical(this.target))) {
          if (this.assertion != null) this.reportError('dererr110');
          else this.reportError('dererr092', Message.params('side', ['the left', 'the right', 'either'][bd]));
          return this.fail();
        }
        this.result = this.target;
        // an asserted side is recorded as that side; the line's own formula as before
        box.assumedSide = this.assertion == null ? bd : show.getChild(0)!.isIdentical(this.target) && bd !== 1 ? 0 : 1;
      } else if (bd < 2) {
        if (DerivationLineChecker.containsWildcard((this.result = show.getChild(bd)!))) {
          this.reportError('dererr093');
          return this.fail();
        }
        box.assumedSide = bd;
      } else {
        const sides = [show.getChild(0)!, show.getChild(1)!];
        let l2: number;
        const w0 = DerivationLineChecker.containsWildcard(sides[0]);
        const w1 = DerivationLineChecker.containsWildcard(sides[1]);
        if (sides[0].isIdentical(sides[1])) l2 = 0;
        else if (w1 && !w0) l2 = 0;
        else if (w0 && !w1) l2 = 1;
        else {
          if (w0 && w1) {
            this.reportError('dererr093');
            return this.fail();
          }
          l2 = await Dialogs.chooseFormula(this.line, sides, formatDerivationMessage(getDerivationText('derdlg001'), null, this));
        }
        if (l2 === -1) {
          this.refuseOrAbort();
          return this.fail();
        }
        this.result = sides[l2];
        this.cacheJustification(new BiconditionalAssumptionJustification(l2 === 1));
        box.assumedSide = l2;
      }
      box.assumptionType = 3;
      if (matchLine && !this.checkResultMatchesLine()) return this.fail();
      this.popStack(0);
      return true;
    }
    if (name.startsWith('SHOW CONC') && 'SHOW CONCLUSION'.startsWith(name)) {
      if (!this.checkShowVariant(true)) return this.fail();
      if (module.conclusion == null) {
        this.reportError('dererr053');
        return this.fail();
      }
      this.result = module.conclusion.copy();
      return this.finishShowVariant();
    }
    if (name.startsWith('SHOW CONS') && 'SHOW CONSEQUENT'.startsWith(name)) {
      if (!this.checkShowVariant(false)) return this.fail();
      const show = box.getFormula();
      if (show == null || show.symbol !== '->') {
        this.reportError('dererr077', Message.params('an', 'a', 'expected form', 'conditional'));
        return this.fail();
      }
      this.result = show.getChild(1)!.copy();
      return this.finishShowVariant();
    }
    if (name.startsWith('SHOW CORR') && 'SHOW CORRCOND'.startsWith(name)) {
      if (!this.checkShowVariant(false)) return this.fail();
      const show = box.getFormula();
      if (show == null || show.symbol !== '|') {
        this.reportError('dererr077', Message.params('an', 'a', 'expected form', 'disjunction'));
        return this.fail();
      }
      const r = new ConnectiveFormula('->');
      r.addChild(show.getChild(0)!.negate());
      r.addChild(show.getChild(1)!.copy());
      this.result = r;
      return this.finishShowVariant();
    }
    if (name.startsWith('SHOW CONJ') && 'SHOW CONJUNCT'.startsWith(name)) {
      if (!this.checkShowVariant(false)) return this.fail();
      const show = box.getFormula();
      if (show == null || show.symbol !== '&') {
        this.reportError('dererr077', Message.params('an', 'a', 'expected form', 'conjunction'));
        return this.fail();
      }
      const choices = [show.getChild(0)!.copy(), show.getChild(1)!.copy()];
      const k = await Dialogs.chooseFormula(this.line, choices, 'Please choose a conjunct:');
      if (k === -1) return this.fail();
      this.result = choices[k];
      return this.finishShowVariant();
    }
    if (name.startsWith('SHOW COND') && 'SHOW CONDITIONAL'.startsWith(name)) {
      if (!this.checkShowVariant(false)) return this.fail();
      const show = box.getFormula();
      if (show == null || show.symbol !== '<->') {
        this.reportError('dererr077', Message.params('an', 'a', 'expected form', 'biconditional'));
        return this.fail();
      }
      const a = new ConnectiveFormula('->');
      a.addChild(show.getChild(0)!.copy());
      a.addChild(show.getChild(1)!.copy());
      const b = new ConnectiveFormula('->');
      b.addChild(show.getChild(1)!.copy());
      b.addChild(show.getChild(0)!.copy());
      const choices = [a, b];
      const k = await Dialogs.chooseFormula(this.line, choices, 'Please choose a conditional:');
      if (k === -1) return this.fail();
      this.result = choices[k];
      return this.finishShowVariant();
    }
    if (name.startsWith('SHOW INST') && 'SHOW INSTANCE'.startsWith(name)) {
      if (!this.checkShowVariant(false)) return this.fail();
      const show = box.getFormula();
      if (show == null || show.symbol !== '@') {
        this.reportError('dererr077', Message.params('an', 'a', 'expected form', 'universal generalization'));
        return this.fail();
      }
      this.result = show.getChild(1)!.copy();
      return this.finishShowVariant();
    }
    const sourceVariant = (prefix: string, full: string) => name.startsWith(prefix) && full.startsWith(name);
    if (sourceVariant('SHOW UNNEG', 'SHOW UNNEGATION')) {
      const source = await this.readSourceFormula();
      this.matchLine = !this.skipToNextStep();
      if (!this.checkShowVariant(false)) return this.fail();
      const e = this.sourceOrFail(source, 'negation');
      if (e == null) return this.fail();
      if (e.symbol !== '~') {
        this.reportError('dererr080', Message.params('remote line', '\\l' + String(e) + '\\l', 'an', 'a', 'expected form', 'negation'));
        return this.fail();
      }
      this.result = e.getChild(0)!.copy();
      return this.finishShowVariant();
    }
    if (sourceVariant('SHOW ANT', 'SHOW ANTECEDENT') || sourceVariant('SHOW NEGCONS', 'SHOW NEGCONSEQUENT')) {
      const negated = name.startsWith('SHOW NEGCONS');
      const source = await this.readSourceFormula();
      this.matchLine = !this.skipToNextStep();
      if (!this.checkShowVariant(false)) return this.fail();
      const e = this.sourceOrFail(source, '(bi)conditional');
      if (e == null) return this.fail();
      if (e.symbol === '->') {
        this.result = negated ? e.getChild(1)!.copy().negate() : e.getChild(0)!.copy();
      } else {
        if (e.symbol !== '<->') {
          this.reportError('dererr080', Message.params('remote line', '\\l' + String(e) + '\\l', 'an', 'a', 'expected form', '(bi)conditional'));
          return this.fail();
        }
        if ((this.result = await Dialogs.chooseSideToShow(this, e, negated)) == null) return this.fail();
      }
      return this.finishShowVariant();
    }
    if (sourceVariant('SHOW NEGDISJ', 'SHOW NEGDISJUNCT')) {
      const source = await this.readSourceFormula();
      this.matchLine = !this.skipToNextStep();
      if (!this.checkShowVariant(false)) return this.fail();
      const e = this.sourceOrFail(source, 'disjunction');
      if (e == null) return this.fail();
      if (e.symbol !== '|') {
        this.reportError('dererr080', Message.params('remote line', '\\l' + String(e) + '\\l', 'an', 'a', 'expected form', 'disjunction'));
        return this.fail();
      }
      const choices = [e.getChild(0)!.copy().negate(), e.getChild(1)!.copy().negate()];
      const k = await Dialogs.chooseFormula(this.line, choices, 'Please choose the negation of a disjunct:');
      if (k === -1) return this.fail();
      this.result = choices[k];
      return this.finishShowVariant();
    }
    let i = DerivationLineChecker.parsePremiseNumber(name);
    if (i !== -1) {
      const premises = module.premises;
      const l = premises == null ? 0 : premises.length;
      if (l === 0 || !module.problem.showLine.syntaxOk) {
        this.reportError('dererr029');
        return this.fail();
      }
      if (i > l) {
        this.reportError('dererr030', Message.params('premise index', i + ''));
        return this.fail();
      }
      if ((matchLine || finalStep) && this.argumentCount !== 0) {
        this.reportError('dererr024', Message.params('n', this.argumentCount + ''));
        return this.fail();
      }
      if (this.target != null) {
        if (i === 0) {
          if (!module.isPremise(this.target)) {
            this.reportError(this.assertion != null ? 'dererr110' : 'dererr031');
            return this.fail();
          }
        } else if (!this.target.isIdentical(premises![i - 1])) {
          if (this.assertion != null) this.reportError('dererr110');
          else this.reportError('dererr032', Message.params('premise index', i + '', 'indexed premise', '\\l' + String(premises![i - 1]) + '\\l'));
          return this.fail();
        }
        this.result = this.target;
        this.popStack(0);
        return true;
      }
      if (i === 0) {
        if (l > 1) {
          i = (await Dialogs.chooseFormula(this.line, premises as Expression[], formatDerivationMessage(getDerivationText('derdlg002'), null, this))) + 1;
          if (i === 0) {
            this.refuseOrAbort();
            return this.fail();
          }
          this.cacheJustification(new PremiseJustification(i - 1));
        } else {
          i = 1;
        }
      }
      this.result = premises![i - 1];
      if (matchLine && !this.checkResultMatchesLine()) return this.fail();
      this.popStack(0);
      return true;
    }
    if (name === 'IE' || name === 'CIE') {
      if (!(!matchLine && !finalStep ? this.argumentCount >= 1 : this.argumentCount === 1)) {
        this.reportError('dererr084', Message.params('n', '1'));
        return this.fail();
      }
      const ij = new InterchangeJustification();
      if (!(await Dialogs.interchangeFormulaQuery(this, ij))) return this.fail();
      if (!(await (name === 'IE' ? Dialogs.interchangeRuleQuery(this, ij) : Dialogs.cieRuleQuery(this, ij)))) return this.fail();
      if (!(await ij.reapply(this))) {
        const params = Message.params('inner rule', ij.getEquivalenceRule(this)!.name, 'inner exp', '\\l' + String(this.getStackFormula(-1)!.getSubexpression(ij.path)) + '\\l');
        this.reportError(name === 'IE' ? 'dererr085' : 'dererr095', params);
        return this.fail();
      }
      this.cacheJustification(ij);
      return true;
    }
    const inst = await this.matchNamedRule();
    if (inst == null || !this.checkInstantiationRestrictions(inst)) return this.fail();
    return matchLine && !this.checkResultMatchesLine() ? this.fail() : true;
  }

  /** The common checks of ASS CD, ASS ID and ASS BD(L/R): no cited lines, first line of the box. */
  private checkAssumptionPlace(): boolean {
    if (this.argumentCount !== 0) {
      this.reportError('dererr024', Message.params('n', this.argumentCount + ''));
      return false;
    }
    if (this.line.getIndexInBox() !== 1) {
      this.reportError('dererr025');
      return false;
    }
    if (this.result != null) {
      this.reportError('dererr026');
      return false;
    }
    return true;
  }

  /** A cancelled choice: in serial mode dererr064 and incomplete, otherwise dererr028 and abort. */
  refuseOrAbort(): void {
    const module = this.line.box.module;
    if (module.serialMode) {
      module.complete = false;
      this.reportError('dererr064');
    } else {
      this.reportError('dererr028');
      module.abort(true);
    }
  }

  private sourceOrFail(source: Expression | ErrorRef | null, form: string): Expression | null {
    if (source == null) {
      this.reportError('dererr079', Message.params('an', 'a', 'expected form', form));
      return null;
    }
    if (source instanceof ErrorRef) {
      if (source.id != null) this.reportError(source.id, source.params);
      return null;
    }
    return source;
  }

  /**
   * Whether the result is the line's formula; an empty line is filled in (interactive
   * command mode). quiet: no message on a mismatch.
   */
  checkResultMatchesLine(quiet = false): boolean {
    const s = this.line.getFormulaText(false);
    if (s == null) return true;
    const module = this.line.box.module;
    if (s === '' && module.commandMode && this.interactive) {
      this.line.clearMessage(1);
      this.line.setFormulaText(this.result!.toString());
      this.line.parseFormula();
    } else if (this.lineFormula == null || !this.lineFormula.isIdentical(this.result)) {
      if (!quiet) {
        this.reportError(this.reusedCache ? 'dererr064' : this.hasFullMatch ? (module.commandMode ? 'dererr033' : 'dererr103') : 'dererr100');
        this.putMessageObject('sum', this.result);
      }
      return false;
    }
    return true;
  }

  checkShowVariant(conclusion: boolean): boolean {
    if (this.result != null) {
      this.reportError('dererr020');
      return false;
    }
    if (this.argumentCount !== 0) {
      this.reportError('dererr024', Message.params('n', this.argumentCount + ''));
      return false;
    }
    if (!this.matchLine && !this.finalStep) {
      this.reportError('dererr020');
      return false;
    }
    if (!this.interactive) {
      this.reportError('dererr074');
      return false;
    }
    if ((this.line.box.parentBox == null) !== conclusion) {
      this.reportError(conclusion ? 'dererr075' : 'dererr076');
      return false;
    }
    return true;
  }

  /** The line becomes a Show line of the result; its command log records the command. */
  finishShowVariant(): boolean {
    const s = this.line.getAnnotationText(true);
    this.line.makeShowLine();
    if (this.line.commandLog != null) this.line.commandLog.text = '"' + s + '"';
    if (this.interactive && !this.checkResultMatchesLine(true)) return this.fail();
    this.popStack(0);
    return true;
  }

  /** EI: the instance must be a variable not used before in the derivation (dererr034). */
  checkInstantiationRestrictions(inst: SchemeInstantiation, quiet = false): boolean {
    if (this.ruleName === 'EI') {
      const rule = getProgramRule('EI') as SchematicRule;
      const e = rule.getConclusion()!.getChild(0)!.instantiate(inst);
      const names = this.line.box.module.varNames;
      if (!(e instanceof SimpleTerm)) {
        if (!quiet) this.reportError('dererr100');
        return false;
      }
      if (names != null && names.includes(e.symbol)) {
        if (!quiet) this.reportError('dererr034', Message.params('variable name', '\\l' + String(e) + '\\l'));
        this.cachedError = new ErrorRef('dererr034', Message.params('variable name', '\\l' + String(e) + '\\l'));
        return false;
      }
    }
    return true;
  }

  isVariableUsedInOuterBoxes(s: string): boolean {
    let box: DerivationBox | null = this.line.box;
    if (box.showLine === this.line) box = box.parentBox;
    if (box != null) box = box.parentBox;
    for (; box != null; box = box.parentBox) {
      if (box.boxVariables != null && box.boxVariables.includes(s)) return true;
    }
    return false;
  }

  /** The cited node at i if it is not directly in the line's box. */
  getCitedNodeOutsideBox(i: number): DerivationNode | null {
    const node = this.getCitedNode(i);
    if (node == null) return null;
    return node.getEnclosingBox() === this.line.box ? null : node;
  }

  async matchNamedRule(): Promise<SchemeInstantiation | null> {
    const n = Theorem.parseTheoremNumber(this.ruleName!);
    if (n == null) {
      const rule = this.line.box.module.getRule(this.ruleName!);
      if (rule == null) {
        this.reportError('dererr035');
        return null;
      }
      return this.matchRule(rule);
    }
    const theorem = getTheorem(n);
    if (theorem == null) {
      this.reportError('dererr036', Message.params('theorem number', n + ''));
      return null;
    }
    if ((this.matchLine || this.finalStep) && this.argumentCount !== 0) {
      this.reportError('dererr024', Message.params('n', this.argumentCount + ''));
      return null;
    }
    return this.matchRule(theorem);
  }

  /**
   * Matches the rule's forms against the top of the stack (in every order of the premises)
   * and applies the one match that is allowed (asking which if several give different
   * results, and asking for what the premises leave open).
   */
  async matchRule(rule: Rule | null): Promise<SchemeInstantiation | null> {
    if (rule == null) return null;
    let anyForm = false;
    let disabled = false;
    let manual = false;
    let unproven = false;
    const usable: RuleApplication[] = [];
    this.premiseMatches = [];
    this.hasPremiseMatch = false;
    this.fullMatches = [];
    this.hasFullMatch = false;
    const module = this.line.box.module;
    this.allForms = rule.getAllForms();
    this.enabledForms = rule.getForms(module, 'disabled');
    this.automaticForms = this.interactive ? rule.getForms(module, 'manualOrDisabled') : this.enabledForms;
    this.computePremiseRange();
    for (const form of this.allForms) {
      const j = form.premises.length;
      if (!(!this.matchLine && !this.finalStep ? j <= this.argumentCount : j === this.argumentCount)) continue;
      anyForm = true;
      const targetInst = new SchemeInstantiation();
      const conclusionInst = new SchemeInstantiation();
      form.conclusion!.match(null, conclusionInst);
      const targetMatches = this.target != null ? form.conclusion!.match(this.target, targetInst) : targetInst.mergeFrom(conclusionInst);
      const perms = new PermutationIterator(j);
      do {
        const order = perms.current();
        const insts: SchemeInstantiation[] = [];
        let k = 0;
        for (let l = 0; l < j; l++) {
          insts[l] = new SchemeInstantiation();
          if (form.premises[order[l]].match(this.getStackFormula(l - j), insts[l])) k++;
        }
        if (k !== j) continue;
        let deferred = false;
        const merged = new SchemeInstantiation();
        let ok = true;
        for (let i1 = 0; i1 < j && ok; i1++) if (!merged.mergeFrom(insts[i1])) ok = false;
        if (!ok) continue;
        const map = new BoundVariableMapClass();
        if (merged.hasNoDeferredMatches()) {
          for (let j1 = 0; j1 < j && ok; j1++) if (!map.matches(form.premises[order[j1]], this.getStackFormula(j1 - j), merged)) ok = false;
          if (!ok) continue;
        } else {
          deferred = true;
        }
        const application = new RuleApplication(form, order, merged, map);
        this.premiseMatches.push(application);
        this.hasPremiseMatch = true;
        if (merged.mergeFrom(conclusionInst) && merged.hasNoDeferredMatches() && map.coversBinders(form.conclusion!)) {
          this.fullMatches.push(application);
          this.hasFullMatch = true;
        }
        if (!targetMatches) {
          if (!deferred) application.failureKind = 1;
          continue;
        }
        if (!merged.mergeFrom(targetInst)) {
          if (!deferred) application.failureKind = 2;
          continue;
        }
        if (merged.hasNoDeferredMatches()) {
          if (deferred) {
            let premisesOk = true;
            for (let k1 = 0; k1 < j && premisesOk; k1++) if (!map.matches(form.premises[order[k1]], this.getStackFormula(k1 - j), merged)) premisesOk = false;
            if (!premisesOk) continue;
          }
          const binderMap = new BinderMap();
          const e = form.conclusion!.instantiate(merged, binderMap);
          const corr = binderMap.getBinderCorrespondence(form.conclusion!, e);
          if (!map.matchBinders(form.conclusion!, this.target, corr)) {
            application.failureKind = 3;
            continue;
          }
          if (!map.renameBinders(form.conclusion!, e, corr)) {
            application.failureKind = 4;
            application.failureDetail = e.findMislinkedVariables();
            continue;
          }
          if (this.target != null && !e.isIdentical(this.target)) {
            application.failureKind = 5;
            continue;
          }
        }
        if (form.indexByName(this.enabledForms) === -1) disabled = true;
        else if (this.interactive && form.indexByName(this.automaticForms) === -1) manual = true;
        else if (!form.isProven(module)) unproven = true;
        else usable.push(application);
      } while (perms.next());
    }
    this.pruneDegenerateMatches(usable);
    if (!anyForm) {
      if (!this.matchLine && !this.finalStep && this.argumentCount !== 0) this.reportError('dererr038', Message.params('n', this.argumentCount + ''));
      else this.reportError('dererr039', Message.params('n', this.argumentCount + ''));
      return null;
    }
    if (usable.length === 0) {
      if (unproven) module.proofMissing = true;
      if (disabled) this.reportError('dererr041');
      else if (manual) this.reportError('dererr040');
      else if (unproven) this.reportError('dererr016');
      else if (this.reusedCache) this.reportError('dererr064');
      else if (this.assertion != null && this.hasFullMatch) this.reportError('dererr110');
      else if (this.hasFullMatch && this.fullMatches.length === 1) {
        if (this.matchLine && this.lineFormula != null) {
          const e = this.fullMatches[0].getConclusion();
          if (module.commandMode) {
            this.reportError('dererr033', Message.params('rule form conclusion', '\\l' + String(e) + '\\l'));
            this.putMessageObject('sum', e);
          } else {
            this.reportError('dererr103');
          }
        } else {
          const application = this.fullMatches[0];
          if (application.failureKind === 4) {
            const pair = (application.failureDetail as Mislink[])[0];
            this.reportError(
              'dererr074',
              Message.params(
                'rule form conclusion',
                '\\l' + String(application.getConclusion()) + '\\l',
                'misbinder',
                '\\l' + pair[0]!.symbol + '\\l',
                'misbound',
                '\\l' + String(pair[1]) + '\\l',
              ),
            );
          } else {
            this.reportError('dererr100');
          }
        }
      } else if (this.hasPremiseMatch) this.reportError('dererr100');
      else if (this.minPremises === this.maxPremises) this.reportError('dererr042');
      else this.reportError('dererr063');
      return null;
    }
    let chosen = this.assertion != null ? this.chooseAssertedInstance(usable) : -1;
    if (chosen === -1) chosen = await Dialogs.chooseRuleInstance(this, usable);
    if (chosen === -1) {
      this.refuseOrAbort();
      return null;
    }
    const application = usable[chosen];
    this.premiseMatches = [application];
    this.fullMatches = [application];
    const form = application.getForm();
    const n = form.premises.length;
    const inst = application.getInstantiation();
    if (inst.hasNoDeferredMatches()) {
      const binderMap = new BinderMap();
      this.result = form.conclusion!.instantiate(inst, binderMap);
      const map = application.getBoundVariables();
      const cache = usable.length > 1 || !map.coversBinders(form.conclusion!);
      if (!(await this.renameBinders(map, form.conclusion!, this.result, binderMap))) return null;
      if (cache) this.cacheJustification(application);
      this.popStack(n);
      return inst;
    }
    if (!module.hasFrame) return null;
    const formName = application.form.name.toUpperCase();
    if (this.ruleName === 'EG') {
      if (!(await Dialogs.generalizationTermQuery(this, application))) return null;
    } else if (this.ruleName === 'EI') {
      if (!(await Dialogs.existentialVarQuery(this, application))) return null;
    } else if (this.ruleName === 'UI') {
      if (!(await Dialogs.universalTermQuery(this, application))) return null;
    } else if (formName === 'LL1' || formName === 'LL2') {
      if (!(await Dialogs.leibniz12TermQuery(this, application))) return null;
    } else if (formName === 'LL3' || formName === 'LL4') {
      if (!(await Dialogs.leibniz34TermQuery(this, application))) return null;
    } else if (this.finalStep && this.lineFormula != null && this.ruleName === 'EL') {
      if (!(await Dialogs.eulerTermQuery(this, application))) return null;
    } else if (!(await Dialogs.instanceSchemeQuery(this, application))) {
      return null;
    }
    const binderMap = new BinderMap();
    const e = form.conclusion!.instantiate(inst, binderMap);
    const corr = binderMap.getBinderCorrespondence(form.conclusion!, e);
    const order = application.getPremiseOrder();
    const map = application.getBoundVariables();
    let ok = true;
    for (let j2 = 0; j2 < n; j2++) {
      if (!map.matches(form.premises[order[j2]], this.getStackFormula(j2 - n), inst)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      ok =
        (this.target == null || map.matchBinders(form.conclusion!, this.target, corr)) &&
        map.renameBinders(form.conclusion!, e, corr) &&
        (this.target == null || e.isIdentical(this.target));
    }
    if (!ok) {
      const term = map.clashes != null ? map.clashes[0][1] : null;
      this.reportError('dererr043', Message.params('inst term', '\\l' + String(term) + '\\l'));
      return null;
    }
    if (this.ruleName === 'EG' && !(await Dialogs.dummyVarQuery(this, application, map))) return null;
    if (!(await this.renameBinders(map, form.conclusion!, e, corr))) return null;
    this.result = e;
    this.cacheJustification(new RuleApplication(form, order, inst, map));
    this.popStack(n);
    return inst;
  }

  /**
   * With an asserted result, the applications left all give that result (they differ only
   * in which cited formula fills which premise): take the first one that is fully
   * determined, or else one that the result completes (the occurrences LL1 and LL2
   * replace). Returns -1 if there is none, so that the program asks as usual.
   */
  chooseAssertedInstance(applications: RuleApplication[]): number {
    for (let i = 0; i < applications.length; i++) if (applications[i].getInstantiation().hasNoDeferredMatches()) return i;
    for (let j = 0; j < applications.length; j++) {
      const application = applications[j];
      for (const inst of this.occurrenceChoices(application)) {
        const map = new BoundVariableMapClass();
        if (inst.hasNoDeferredMatches() && this.premisesMatch(application.form, application.premiseOrder, inst, map)) {
          const completed = new RuleApplication(application.form, application.premiseOrder, inst, map);
          const e = completed.getConclusion();
          if (e.findMislinkedVariables() == null && e.isIdentical(this.assertion)) {
            applications[j] = completed;
            return j;
          }
        }
      }
    }
    return -1;
  }

  /** Whether the premises of form, in the order, are the top of the stack under inst. */
  premisesMatch(form: SchematicRule, order: readonly number[], inst: SchemeInstantiation, map: BoundVariableMap): boolean {
    const n = order.length;
    for (let j = 0; j < n; j++) if (!map.matches(form.premises[order[j]], this.getStackFormula(j - n), inst)) return false;
    return true;
  }

  /**
   * The ways to complete an application when the program would ask which occurrences of a
   * term a letter of the conclusion stands for (EG, LL1, LL2): one instantiation for each
   * choice, if there are few; otherwise, or if there is no such choice, just its own.
   */
  occurrenceChoices(application: RuleApplication): SchemeInstantiation[] {
    let choices: SchemeInstantiation[] | null = [];
    const inst = application.instantiation;
    const conclusionLetters = application.form.conclusion!.getSchematicLetters();
    let letter: Letter | null = null;
    let match: import('../../formula/DeferredMatch').DeferredMatch | null = null;
    for (let i = 0; i < inst.pendingLetters.length && letter == null; i++) {
      const candidate = inst.pendingLetters[i];
      const matches = candidate.getDeferredMatches(false);
      if (candidate instanceof PredicateLetter && candidate.getArity() === 1 && matches != null && containsLetter(conclusionLetters, candidate)) {
        // the choices come from the first match with a formula; adding each choice checks the others
        for (let i2 = 0; i2 < matches.length && match == null; i2++) {
          if (matches[i2].instance != null) {
            letter = candidate;
            match = matches[i2];
          }
        }
      }
    }
    if (letter != null && match != null) {
      const argument = match.pattern.getChild(0)!;
      const argumentLetter = argument.getSchematicLetter();
      const terms: Expression[] = [];
      const open = argumentLetter != null && inst.getReplacement(argumentLetter) == null;
      if (open) DerivationLineChecker.collectTerms(match.instance!, terms);
      else terms.push(argument.instantiate(inst));
      for (let j = 0; j < terms.length && choices != null; j++) {
        const term = terms[j];
        const occurrences = match.instance!.findOccurrences(term);
        const k = occurrences.length;
        if (k === 0 || k > DerivationLineChecker.MAX_OCCURRENCES) {
          choices = null;
        } else {
          for (let l = 1; l < 1 << k && choices != null; l++) {
            const placeholder = new SimpleTerm(SchematicLetter.placeholder(0));
            let replaced = match.instance!;
            for (let i1 = 0; i1 < k; i1++) {
              if ((l & (1 << i1)) !== 0) replaced = InterchangeJustification.replaceAt(replaced, placeholder, occurrences[i1]);
            }
            const pattern = match.pattern.copy();
            pattern.children[0] = placeholder;
            const choice = inst.clone();
            if (
              replaced.findMislinkedVariables() == null &&
              (!open || choice.addReplacement(argument, term)) &&
              choice.addReplacement(pattern, replaced) &&
              this.premisesMatch(application.form, application.premiseOrder, choice, new BoundVariableMapClass())
            ) {
              choices.push(choice);
              if (choices.length > DerivationLineChecker.MAX_CHOICES) choices = null;
            }
          }
        }
      }
    } else {
      choices = null;
    }
    if (choices == null || choices.length === 0) choices = [inst];
    return choices;
  }

  /** The terms in e (each once) that could be generalized: no bound variables in them. */
  static collectTerms(e: Expression, found: Expression[]): void {
    if (e instanceof Term && !DerivationLineChecker.hasBoundVariable(e)) {
      if (!found.some((f) => f.isIdentical(e))) found.push(e);
    }
    for (let j = 0; j < e.childCount; j++) DerivationLineChecker.collectTerms(e.getChild(j)!, found);
  }

  static hasBoundVariable(e: Expression): boolean {
    if (e instanceof SimpleTerm && e.hasBinder()) return true;
    for (let i = 0; i < e.childCount; i++) if (DerivationLineChecker.hasBoundVariable(e.getChild(i)!)) return true;
    return false;
  }

  /**
   * DUP pushes another copy of the top formula, DROP removes it, SWAP exchanges the top two.
   * Each formula keeps the line it was cited from; they produce no result of their own.
   */
  applyStackOperation(): boolean {
    const name = this.ruleName!;
    const i = name === 'SWAP' ? 2 : 1;
    if (this.argumentCount < i) {
      this.reportError('dererr113', Message.params('n', i + '', 's', i === 1 ? '' : 's'));
      return this.fail();
    }
    const j = this.stack.length;
    if (name === 'DUP') {
      this.stack.push(this.stack[j - 1]);
      this.citedNodes.push(this.citedNodes[j - 1]);
    } else if (name === 'DROP') {
      this.stack.length = j - 1;
      this.citedNodes.length = j - 1;
    } else {
      [this.stack[j - 1], this.stack[j - 2]] = [this.stack[j - 2], this.stack[j - 1]];
      [this.citedNodes[j - 1], this.citedNodes[j - 2]] = [this.citedNodes[j - 2], this.citedNodes[j - 1]];
    }
    this.result = null;
    return true;
  }

  /** Whether application with inst gives the cited formulas (and the target); records clashes. */
  verifyApplication(application: RuleApplication, inst: SchemeInstantiation): boolean {
    const form = application.getForm();
    const n = form.premises.length;
    const premises: Expression[] = [];
    const corrs: number[][][] = [];
    for (let j = 0; j < n; j++) {
      const binderMap = new BinderMap();
      premises[j] = form.premises[j].instantiate(inst, binderMap);
      corrs[j] = binderMap.getBinderCorrespondence(form.premises[j], premises[j]);
    }
    const binderMap = new BinderMap();
    const e = form.conclusion!.instantiate(inst, binderMap);
    const corr = binderMap.getBinderCorrespondence(form.conclusion!, e);
    const order = application.getPremiseOrder();
    const map = application.getBoundVariables();
    let ok = true;
    for (let k = 0; k < n; k++) {
      ok = false;
      const p = order[k];
      if (
        !map.matchBinders(form.premises[p], this.getStackFormula(k - n), corrs[p]) ||
        !map.renameBinders(form.premises[p], premises[p], corrs[p]) ||
        !premises[p].isIdentical(this.getStackFormula(k - n))
      ) {
        break;
      }
      ok = true;
    }
    if (ok) {
      ok =
        (this.target == null || map.matchBinders(form.conclusion!, this.target, corr)) &&
        map.renameBinders(form.conclusion!, e, corr) &&
        (this.target == null || e.isIdentical(this.target));
    }
    this.clashes = map.clashes;
    return ok;
  }

  /** Removes matches of LL1-LL4 and AV3 that are only formally valid. */
  pruneDegenerateMatches(matches: RuleApplication[]): boolean {
    let n = matches.length;
    for (let j = 0; j < n; j++) {
      const application = matches[j];
      const formName = application.form.name.toUpperCase();
      const pending = application.instantiation.pendingLetters;
      if (formName === 'LL1' || formName === 'LL2') {
        if (pending.length === 0) continue;
        const deferred = pending[0].getDeferredMatches(false);
        if (deferred == null) continue;
        const match = deferred[0];
        const argument = match.pattern.getChild(0)!;
        const occurrences = match.instance!.findOccurrences(argument.instantiate(application.instantiation));
        const k = occurrences.length;
        if (k === 0) {
          this.removeMatch(matches, application);
          n--;
          j--;
        } else if (k === 1) {
          const placeholder = new SimpleTerm(SchematicLetter.placeholder(0));
          const replaced = InterchangeJustification.replaceAt(match.instance!, placeholder, occurrences[0]);
          const pattern = match.pattern.copy();
          pattern.children[0] = placeholder;
          if (replaced.findMislinkedVariables() != null || !application.instantiation.addReplacement(pattern, replaced)) {
            this.removeMatch(matches, application);
            n--;
            j--;
          }
        }
      } else if (formName === 'LL3' || formName === 'LL4') {
        if (pending.length === 0) continue;
        const deferred = pending[0].getDeferredMatches(false);
        if (deferred == null) continue;
        if (deferred.length === 1) {
          this.removeMatch(matches, application);
          n--;
          j--;
          continue;
        }
        const m1 = deferred[0];
        const m2 = deferred[1];
        const differences = m1.instance!.findDifferences(m2.instance);
        const k1 = differences.length;
        let path: ExpressionPath | null = k1 === 0 ? null : differences[0];
        let depth = path == null ? 0 : path.depth;
        if (depth === 0) {
          this.removeMatch(matches, application);
          n--;
          j--;
          continue;
        }
        const e1 = m1.instance!.getSubexpression(path);
        const e2 = m2.instance!.getSubexpression(path);
        let same = true;
        for (let l = 1; l < k1; l++) {
          path = differences[l];
          if (!e1!.isIdentical(m1.instance!.getSubexpression(path))) same = false;
          else if (!e2!.isIdentical(m2.instance!.getSubexpression(path))) same = false;
          if (!same) break;
          if (path.depth < depth) depth = path.depth;
        }
        if (!same) {
          this.removeMatch(matches, application);
          n--;
          j--;
        } else if (depth === 1) {
          const placeholder = new SimpleTerm(SchematicLetter.placeholder(0));
          let replaced = m1.instance!.copy();
          const pattern = m1.pattern.copy();
          pattern.children[0] = placeholder;
          for (let i2 = 0; i2 < k1; i2++) replaced = InterchangeJustification.replaceAt(replaced, placeholder, differences[i2]);
          if (replaced.findMislinkedVariables() != null || !application.instantiation.addReplacement(pattern, replaced)) {
            this.removeMatch(matches, application);
            n--;
            j--;
          }
        }
      } else if (formName === 'AV3') {
        if (pending.length === 0) continue;
        const deferred = pending[0].getDeferredMatches(false);
        if (deferred == null) continue;
        for (const match of deferred) {
          if (match.instance != null && match.instance.findSymbolOccurrences('%').length === 0) {
            this.removeMatch(matches, application);
            n--;
            j--;
            break;
          }
        }
      }
    }
    return true;
  }

  private removeMatch(matches: RuleApplication[], application: RuleApplication): void {
    removeElement(matches, application);
    removeElement(this.fullMatches!, application);
    if (this.fullMatches!.length === 0) this.hasFullMatch = false;
    removeElement(this.premiseMatches!, application);
    if (this.premiseMatches!.length === 0) this.hasPremiseMatch = false;
  }

  getParamValue(s: string): string | null {
    if (s === 'rule name') return this.ruleName;
    if (s === 'asserted') return this.assertion == null ? '' : '\\l' + String(this.assertion) + '\\l';
    if (s === 'stack') {
      let out = '\\l';
      for (let j = 0; j < this.argumentCount; j++) {
        if (j !== 0) out += '\\n';
        out += String(this.getStackFormula(-j));
      }
      return out + '\\l';
    }
    if (s.length >= 5 && s.substring(0, 5) === 'stack') {
      const i = parseJavaInt(javaTrim(s.substring(5))) ?? 0;
      if (i > 0 && i <= this.argumentCount) return '\\l' + String(this.getStackFormula(-i)) + '\\l';
    }
    if (s === 'assumption') {
      const side = this.line.box.assumedSide;
      if (side === -1) return null;
      return side === 2
        ? '\\l' + this.line.box.getNode(1).getFormulaText(true) + '\\l'
        : '\\l' + String(this.line.box.getFormula()!.getChild(side)) + '\\l';
    }
    if (s === 'rule forms' && this.automaticForms != null) {
      let out = '\\l';
      let first = true;
      for (const form of this.automaticForms) {
        if (form.premises.length >= this.minPremises && form.premises.length <= this.maxPremises) {
          if (!first) out += '\\n';
          out += form.format(' . ', ' .: ');
          first = false;
        }
      }
      return out + '\\l';
    }
    if (s === 'rule forms premises' && this.automaticForms != null) {
      let out = '\\l';
      for (let l = 0; l < this.maxPremises; l++) {
        if (l !== 0) out += '\\n';
        out += String(this.getStackFormula(-l));
      }
      return out + '\\l';
    }
    const matchList = () => (this.hasFullMatch ? this.fullMatches : this.hasPremiseMatch ? this.premiseMatches : null);
    if (s === 'rule form') {
      const list = matchList();
      if (list != null && list.length > 0) return '\\l' + list[0].getForm().format(' . ', ' .: ') + '\\l';
    }
    if (s === 'rule form premises') {
      const list = matchList();
      if (list != null && list.length > 0) {
        const k = list[0].getPremiseCount();
        let out = '\\l';
        for (let j = 0; j < k; j++) out += (j === 0 ? '' : '\\n') + String(this.getStackFormula(j - k));
        return out + '\\l';
      }
    }
    if (s === 'rule form conclusion') return '\\l' + String(this.result) + '\\l';
    if (s.length >= 4 && s.substring(0, 4) === 'rfsp') {
      const one = this.maxPremises === 1;
      const t = javaTrim(s.substring(4));
      if (t === 's') return one ? '' : 's';
      if (t === 'es') return one ? 'es' : '';
      if (t === 'those') return one ? 'that' : 'those';
    }
    if (s.length >= 3 && s.substring(0, 3) === 'rfp') {
      let one = false;
      const list = matchList();
      if (list != null && list.length > 0) one = list[0].getPremiseCount() === 1;
      const t = javaTrim(s.substring(3));
      if (t === 's') return one ? '' : 's';
      if (t === 'es') return one ? 'es' : '';
      if (t === 'those') return one ? 'that' : 'those';
      if (t === 'are') return one ? 'is' : 'are';
    }
    if (s.length >= 2 && s.substring(0, 2) === 'rf') {
      const one = this.automaticForms != null && this.automaticForms.length === 1;
      if (javaTrim(s.substring(2)) === 's') return one ? '' : 's';
    }
    return null;
  }

  reportError(id: string, params: MessageParams | null = null): void {
    if (this.preview) {
      if (this.previewError == null) this.previewError = new ErrorRef(id, params);
    } else {
      this.line.showMessageAt(id, this, this.line.box.module.phase, params);
    }
  }

  putMessageObject(name: string, value: unknown): void {
    if (!this.preview) this.line.setMessageButtonParam(name, value);
  }

  clearMessage(phase?: number): void {
    this.line.clearMessage(phase);
  }

  getStackSize(): number {
    return this.stack.length;
  }

  getCitedNode(i: number): DerivationNode | null {
    const n = this.citedNodes.length;
    if (i < 0) i += n;
    return i >= 0 && i < n ? this.citedNodes[i] : null;
  }

  getStackFormula(i: number): Expression | null {
    const n = this.stack.length;
    if (i < 0) i += n;
    return i >= 0 && i < n ? this.stack[i] : null;
  }

  getBoundVariableNames(i: number): string[] | null {
    const e = this.getStackFormula(i);
    return e == null ? null : e.getBoundVariableNames();
  }

  getLineBoundVariableNames(): string[] | null {
    return this.lineFormula == null ? null : this.lineFormula.getBoundVariableNames();
  }

  /** Removes the i formulas the step used (on the final step, remembering them). */
  popStack(i: number): void {
    const n = this.stack.length;
    let k = n - i;
    if (k < 0) k = 0;
    if (this.finalStep) this.consumedFormulas = this.stack.slice(k, n);
    this.citedNodes.length = k;
    this.stack.length = k;
  }

  getRuleName(): string | null {
    return this.ruleName;
  }

  /** "PR" gives 0, "PR<n>" gives n, anything else -1. */
  static parsePremiseNumber(s: string): number {
    if (s === 'PR') return 0;
    if (s.length < 2 || s.substring(0, 2) !== 'PR') return -1;
    if (s.length > 2 && '-0'.indexOf(s.substring(2, 3)) !== -1) return -1;
    return parseIntOrNull(s.substring(2)) ?? -1;
  }

  // ---- bound variable naming (BoundVariableMap.renameBinders with a checker) ----

  /** renameBinders(pattern, instance, binders, this): may ask for names of fresh bound variables. */
  renameBinders(map: BoundVariableMap, pattern: Expression, instance: Expression, binderMap: BinderMap | number[][]): Promise<boolean> {
    return map.renameBindersAsync(pattern, instance, binderMap, this.binderNaming());
  }

  binderNaming(): BinderNaming {
    return Dialogs.binderNaming(this);
  }
}

/** Integer.parseInt: null where Java throws NumberFormatException (Unicode digits allowed). */
export function parseIntOrNull(s: string): number | null {
  let t = '';
  for (const c of s) {
    if (c === '-' || c === '+') t += c;
    else if (isDigit(c)) t += digitValue(c);
    else return null;
  }
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 2147483647 || n < -2147483648 ? null : n;
}

function digitValue(c: string): string {
  const code = c.codePointAt(0)!;
  if (code >= 48 && code <= 57) return c;
  // Unicode decimal digits come in runs of ten, each starting at a zero
  let zero = code;
  while (zero > 0 && isDigit(String.fromCodePoint(zero - 1))) zero--;
  return String((code - zero) % 10);
}

function containsLetter(letters: readonly Letter[], letter: Letter): boolean {
  return letters.some((l) => l.equals(letter));
}

function removeElement<T>(list: T[], e: T): void {
  const i = list.indexOf(e);
  if (i !== -1) list.splice(i, 1);
}

/** Vector.setSize: grows with nulls or truncates. */
function setSize<T>(list: (T | null)[], n: number): void {
  if (list.length > n) list.length = n;
  else while (list.length < n) list.push(null);
}

