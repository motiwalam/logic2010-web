/**
 * Port of DerivationQueryHandler.java: the actions of the derivation's dialog buttons (the
 * message catalogue's `b` fields and the query dialogs): re-check a line (query), replace its
 * formula by what the rule gives (replace), explain (err033/err103), undo a placeholder, and
 * validate the answers of the rule queries (xxxQueryOK), showing a message and keeping the
 * dialog open when an answer is not acceptable.
 */
import { BinderMap } from '../../formula/BinderMap';
import { type Expression, Formula, type Mislink, SimpleTerm, Term } from '../../formula/Expression';
import { chooseFormula, instanceSchemeQuery } from './DerivationDialogs';
import { DerivationLineChecker as Checker } from './DerivationLineChecker';
import { FormulaParseException, parseFormula } from '../../formula/parseFormula';
import { FormulaParseNode } from '../../formula/FormulaParseNode';
import { SchemeInstantiation } from '../../formula/SchemeInstantiation';
import { DialogHandler } from '../../program/DialogHandler';
import { ErrorRef, Message, type MessageParams } from '../../program/Message';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { BoundVariableMap, binderVariable } from '../../rules/BoundVariableMap';
import { Rule, SchematicRule } from '../../rules/Rule';
import { RuleInstance } from '../../rules/RuleInstance';
import { javaTrim, parseJavaInt } from '../../util/java';
import type { DerivationLine } from './DerivationLine';
import type { DerivationLineChecker } from './DerivationLineChecker';
import { IllegalArgumentException, InterchangeJustification, LineRule, PremiseRule } from './InterchangeJustification';
import type { Justification } from './Justification';
import type { ChoiceHandler, DialogField, QueryDialog } from './QueryDialog';
import { RuleApplication } from './RuleApplication';
import type { TermOccurrenceSelector } from './TermOccurrenceSelector';

function op(pair: Mislink, params: MessageParams, withVar: boolean): void {
  const e = pair[0]!;
  Message.putParam(params, 'op phrase', '\\l' + e.symbol + e.getChild(0)!.symbol + '\\l');
  Message.putParam(params, 'op wfe', '\\l' + String(e) + '\\l');
  if (withVar) Message.putParam(params, 'op var', '\\l' + pair[1].symbol + '\\l');
}

export class DerivationQueryHandler extends DialogHandler implements ChoiceHandler {
  line: DerivationLine;
  properties: Map<string, unknown> | null = null;

  constructor(line: DerivationLine, spec: string | null) {
    super(spec);
    this.line = line;
  }

  setProperty(name: string, value: unknown): void {
    if (value == null) return;
    if (this.properties == null) this.properties = new Map();
    this.properties.set(name, value);
  }

  setProperties(props: Map<string, unknown>): void {
    for (const [k, v] of props) this.setProperty(k, v);
  }

  getProperty<T>(name: string): T | null {
    return this.properties == null ? null : ((this.properties.get(name) as T | undefined) ?? null);
  }

  getSelectedAction(dialog: QueryDialog): string | null {
    const label = dialog.getSelectedLabel();
    return label == null ? null : this.actionFor(label);
  }

  private showMessage(id: string, params: MessageParams | null = null, checker: DerivationLineChecker | null = null): Promise<void> {
    return this.line.box.module.showDialogMessage(id, params, null, checker, checker == null ? null : checker.line);
  }

  async handleChoice(dialog: QueryDialog): Promise<boolean> {
    const s = this.getSelectedAction(dialog);
    if (s == null) return true;
    const action = s.toLowerCase();
    return this.perform(action);
  }

  /** Runs an action (as its button would); true when the dialog may close. */
  async perform(action: string): Promise<boolean> {
    const module = this.line.box.module;
    switch (action) {
      case 'query': {
        const editor = module.focus;
        if (editor != null && editor === editor.line.annotationEditor) editor.line.resolveRelativeReferences();
        module.abort(false);
        module.resetVarNames();
        this.line.justifications = null;
        await this.line.checkLine(false);
        return true;
      }
      case 'replace': {
        const sum = this.getProperty<Expression>('sum');
        const caches = this.getProperty<(Justification | null)[]>('caches');
        this.line.clearMessage(3);
        this.line.setFormulaText(sum!.toString());
        this.line.formula = sum;
        this.line.syntaxOk = true;
        this.line.justifications = caches;
        return true;
      }
      case 'err033': {
        const checker = this.getProperty<DerivationLineChecker>('just');
        if (checker != null && checker.consumedFormulas != null) {
          let s2 = '';
          checker.consumedFormulas.forEach((f, j) => (s2 += (j === 0 ? '' : '\\n') + String(f)));
          const params = Message.params('rule form premises', '\\l' + s2 + '\\l', 'rule form conclusion', '\\l' + String(checker.result) + '\\l');
          this.line.showMessageAt('dererr033', checker, 3, params);
        }
        const handler = this.line.messageButton.handler;
        if (handler != null) {
          // Java: a NullPointerException here when there is no checker
          handler.setProperty('sum', checker!.result);
          handler.setProperty('caches', this.line.justifications);
        }
        return true;
      }
      case 'err103': {
        const checker = this.getProperty<DerivationLineChecker>('just');
        if (checker != null && checker.consumedFormulas != null) {
          let s1 = '';
          checker.consumedFormulas.forEach((f, j) => (s1 += (j === 0 ? '' : '\\n') + String(f)));
          this.line.showMessageAt('dererr103', checker, 3, Message.params('rule form premises', '\\l' + s1 + '\\l'));
        }
        return true;
      }
      case 'undo': {
        const selector = this.getProperty<TermOccurrenceSelector>('undo');
        if (selector != null && !selector.undo()) await this.showMessage('dernot012');
        return false;
      }
      case 'dummyvarqueryok':
        return this.dummyVarQueryOK();
      case 'existentialvarqueryok':
        return this.termQueryOK(false);
      case 'universaltermqueryok':
        return this.termQueryOK(true);
      case 'leibniz12termqueryok':
        return this.leibniz12TermQueryOK();
      case 'leibniz34termqueryok':
        return this.leibniz34TermQueryOK();
      case 'eulertermqueryok':
        return this.eulerTermQueryOK();
      case 'interchangeformulaqueryok':
        return this.interchangeFormulaQueryOK();
      case 'interchangerulequeryok': {
        const checker = this.getProperty<DerivationLineChecker>('just')!;
        const edit = this.getProperty<DialogField>('edit')!;
        const rule = await this.parseRuleReference(checker, edit, new ErrorRef('dernot057'));
        if (rule == null) return false;
        this.setProperty('rule', rule);
        return true;
      }
      case 'cierulequeryok':
        return this.cieRuleQueryOK();
      default:
        return true;
    }
  }

  private async dummyVarQueryOK(): Promise<boolean> {
    const checker = this.getProperty<DerivationLineChecker>('just')!;
    const application = this.getProperty<RuleApplication>('inst')!;
    const edit = this.getProperty<DialogField>('edit')!;
    const map = new BoundVariableMap();
    const s7 = translateSymbols(edit.getText(), symbols, maggie);
    const conclusion = application.getForm().conclusion!;
    if (!map.assign(binderVariable(conclusion.getBinders(), 0), s7)) {
      await this.showMessage('dernot017', Message.params('gen var', '\\l' + s7 + '\\l'));
      return false;
    }
    const term = application.getForm().premises[0].getChild(0)!.instantiate(application.getInstantiation());
    const wff = checker.getStackFormula(-1)!.copy();
    const binderMap = new BinderMap();
    const gen = conclusion.instantiate(application.getInstantiation(), binderMap);
    if (!map.renameBinders(conclusion, gen, binderMap)) {
      const clashes = map.clashes;
      const params = Message.params(
        'inst wff', '\\l' + String(wff) + '\\l',
        'inst term', '\\l' + String(term) + '\\l',
        'gen var', '\\l' + String(gen.getChild(0)) + '\\l',
        'gen wff', '\\l' + String(gen.getChild(1)) + '\\l',
        'gen all', '\\l' + String(gen) + '\\l',
      );
      let binder: Expression | null = null;
      if (clashes != null && clashes.length !== 0) {
        const pair = clashes[0];
        binder = (pair[1] as SimpleTerm).getBinder();
        op(pair, params, false);
      }
      await this.showMessage(binder != null ? 'dernot018' : 'dernot029', params);
      return false;
    }
    return true;
  }

  /** existentialVarQueryOK / universalTermQueryOK. */
  private async termQueryOK(universal: boolean): Promise<boolean> {
    const checker = this.getProperty<DerivationLineChecker>('just')!;
    const application = this.getProperty<RuleApplication>('inst')!;
    const edit = this.getProperty<DialogField>('edit')!;
    const inst = new SchemeInstantiation(application.getInstantiation());
    const s = translateSymbols(edit.getText(), symbols, maggie);
    const top = checker.getStackFormula(-1)!;
    const params = Message.params(
      universal ? 'inst term' : 'inst var', '\\l' + s + '\\l',
      'gen var', '\\l' + String(top.getChild(0)) + '\\l',
      'gen wff', '\\l' + String(top.getChild(1)) + '\\l',
      'gen all', '\\l' + String(top) + '\\l',
    );
    let e: Expression | null;
    try {
      e = parseFormula(s, true, false);
    } catch (err) {
      if (!(err instanceof FormulaParseException)) throw err;
      await this.showMessage(universal ? 'dernot019' : 'dernot022', params);
      return false;
    }
    if (e == null) return false;
    if (universal ? !(e instanceof Term) : !(e instanceof SimpleTerm)) {
      await this.showMessage(universal ? 'dernot020' : 'dernot023', params);
      return false;
    }
    if (!inst.addReplacement(inst.pendingLetters[0].toString(), s)) {
      await this.showMessage(inst.errorId!, inst.errorParams);
      return false;
    }
    if (!checker.verifyApplication(application, inst)) {
      const clashes = checker.clashes;
      checker.clashes = null;
      const p = Message.putParam(params, 'inst wff', '\\l' + String(application.getForm().conclusion!.instantiate(inst)) + '\\l');
      if (clashes != null && clashes.length !== 0) op(clashes[0], p, false);
      await this.showMessage(universal ? 'dernot021' : 'dernot024', p, checker);
      return false;
    }
    return true;
  }

  private async leibniz12TermQueryOK(): Promise<boolean> {
    const checker = this.getProperty<DerivationLineChecker>('just')!;
    const application = this.getProperty<RuleApplication>('inst')!;
    const selector = this.getProperty<TermOccurrenceSelector>('edit')!;
    const params = Message.mergeParams(selector.extraParams, null) ?? new Map<string, string>();
    const inst = new SchemeInstantiation(application.getInstantiation());
    const s10 = translateSymbols(selector.getText(), symbols, maggie);
    inst.addReplacement(inst.pendingLetters[0].toString(), s10);
    const e = application.form.conclusion!.instantiate(inst);
    Message.putParam(params, 'sub wff', '\\l' + String(e) + '\\l');
    const mislinked = e.findMislinkedVariables();
    if (mislinked != null) {
      op(mislinked[0], params, true);
      await this.showMessage('dernot034', params, checker);
      return false;
    }
    return true;
  }

  private async leibniz34TermQueryOK(): Promise<boolean> {
    const checker = this.getProperty<DerivationLineChecker>('just')!;
    const application = this.getProperty<RuleApplication>('inst')!;
    const selector = this.getProperty<TermOccurrenceSelector>('edit')!;
    const params = Message.mergeParams(selector.extraParams, null) ?? new Map<string, string>();
    const letter = selector.ruleLetter!;
    const inst = new SchemeInstantiation(application.getInstantiation());
    const s11 = translateSymbols(selector.getText(), symbols, maggie);
    inst.addReplacement(letter.toString(), s11);
    const k = application.form.premises[application.premiseOrder[0]].symbol === '~' ? 0 : 1;
    const premiseB = application.form.premises[application.premiseOrder[k]];
    const wffB = checker.getStackFormula(k - 2)!;
    const subWff = premiseB.instantiate(inst);
    const termB = premiseB.getChild(0)!.getChild(0)!.instantiate(inst);
    const premiseA = application.form.premises[application.premiseOrder[1 - k]];
    const wffA = premiseA.instantiate(inst);
    const termA = premiseA.getChild(0)!.instantiate(inst);
    Message.putParam(params, 'term A', '\\l' + String(termA) + '\\l');
    Message.putParam(params, 'wff A', '\\l' + String(wffA) + '\\l');
    Message.putParam(params, 'term B', '\\l' + String(termB) + '\\l');
    Message.putParam(params, 'wff B', '\\l' + String(wffB) + '\\l');
    Message.putParam(params, 'sub wff', '\\l' + String(subWff) + '\\l');
    Message.putParam(params, 'rule premise A', '\\l' + String(premiseA) + '\\l');
    Message.putParam(params, 'rule premise B', '\\l' + String(premiseB) + '\\l');
    const mislinked = subWff.findMislinkedVariables();
    if (mislinked != null) {
      op(mislinked[0], params, true);
      await this.showMessage('dernot040', params, checker);
      return false;
    }
    if (!wffB.isIdentical(subWff)) {
      await this.showMessage('dernot041', params, checker);
      return false;
    }
    return true;
  }

  private async eulerTermQueryOK(): Promise<boolean> {
    const checker = this.getProperty<DerivationLineChecker>('just')!;
    const application = this.getProperty<RuleApplication>('inst')!;
    const selector = this.getProperty<TermOccurrenceSelector>('edit')!;
    const inst = new SchemeInstantiation(application.getInstantiation());
    const letter = inst.pendingLetters[0];
    const s9 = translateSymbols(selector.getText(), symbols, maggie);
    inst.addReplacement(letter.toString(), s9);
    const right = application.form.conclusion!.getChild(1)!;
    const top = checker.getStackFormula(-1)!;
    const lineFormula = checker.lineFormula!;
    const term3 = right.instantiate(inst);
    const params = Message.params(
      'left premise term', '\\l' + String(top.getChild(0)) + '\\l',
      'left conclusion term', '\\l' + String(lineFormula.getChild(0)) + '\\l',
      'right premise term', '\\l' + String(top.getChild(1)) + '\\l',
      'right conclusion term', '\\l' + String(lineFormula.getChild(1)) + '\\l',
    );
    Message.putParam(params, 'scheme conclusion term', '\\l' + String(term3) + '\\l');
    const mislinked = term3.findMislinkedVariables();
    if (mislinked != null) {
      op(mislinked[0], params, true);
      await this.showMessage('dernot046', params, checker);
      return false;
    }
    return true;
  }

  private async interchangeFormulaQueryOK(): Promise<boolean> {
    const edit = this.getProperty<DialogField>('edit')!;
    const s3 = edit.getText();
    const range = [edit.selectionStart, edit.selectionEnd];
    const s4 = translateSymbols(s3, symbols, maggie, range);
    const s8 = edit.getSelectedText();
    const params: MessageParams = new Map();
    Message.putParam(params, 'full text', s3);
    Message.putParam(params, 'selection', s8);
    if (s8 == null || s8.length === 0) {
      await this.showMessage('dernot013');
      return false;
    }
    let e: Expression | null;
    try {
      e = parseFormula(translateSymbols(s8, symbols, maggie), true, false);
    } catch (err) {
      if (!(err instanceof FormulaParseException)) throw err;
      await this.showMessage('dernot054', params);
      return false;
    }
    if (!(e instanceof Formula)) {
      await this.showMessage('dernot055', params);
      return false;
    }
    const node = new FormulaParseNode(s4);
    if (!e.isIdentical(node.findNodeContaining(range[0], range[1]).expression)) {
      Message.putParam(params, 'full expression', translateSymbols(node.expression!.formatMinimal(1), maggie, symbols));
      await this.showMessage('dernot056', params);
      return false;
    }
    return true;
  }

  private async cieRuleQueryOK(): Promise<boolean> {
    const checker = this.getProperty<DerivationLineChecker>('just')!;
    const ruleEdit = this.getProperty<DialogField>('ruleEdit')!;
    const condEdit = this.getProperty<DialogField>('condEdit')!;
    const rule = await this.parseRuleReference(checker, ruleEdit, new ErrorRef('dernot057'));
    if (rule == null) return false;
    let condition: Rule | null = await this.parseRuleReference(checker, condEdit, new ErrorRef('dernot059'));
    if (condition == null) return false;
    if (!(condition instanceof LineRule) && !(condition instanceof PremiseRule)) {
      if (!(condition instanceof SchematicRule)) {
        const conclusions: Expression[] = [];
        const forms = condition.getAllForms();
        let i = 0;
        for (const form of forms.slice()) {
          if (form.premises.length === 0 && InterchangeJustification.isRuleUsable(checker, form, false)) {
            conclusions.push(form.conclusion!);
            forms[i++] = form;
          }
        }
        if (i === 0) {
          await this.showMessage('dernot060', Message.params('condition', condition.name));
          return false;
        }
        i = await chooseFormula(checker.line, conclusions, 'Please choose a form of ' + condition.name);
        if (i === -1) return false;
        condition = forms[i];
      }
      const application = new RuleApplication(condition as SchematicRule, [], new SchemeInstantiation(), new BoundVariableMap());
      application.form.conclusion!.match(null, application.instantiation);
      if (!(await instanceSchemeQuery(checker, application))) return false;
      condition = new RuleInstance(application.form, application.instantiation);
    }
    this.setProperty('rule', rule);
    this.setProperty('condition', condition);
    return true;
  }

  /** A rule name, a line number or PR<n> (PR: all premises) typed in a dialog field. */
  async parseRuleReference(checker: DerivationLineChecker, edit: DialogField, error: ErrorRef): Promise<Rule | null> {
    const s = javaTrim(edit.getText());
    if (s.length === 0) {
      await this.showMessage(error.id, error.params);
      return null;
    }
    const n = parseJavaInt(s);
    if (n != null) {
      try {
        return LineRule.find(checker.line.box.module, n);
      } catch (e) {
        if (!(e instanceof IllegalArgumentException)) throw e;
        await this.showMessage('dererr003', Message.params('remote line number', s));
        return null;
      }
    }
    let i = Checker.parsePremiseNumber(s.toUpperCase());
    if (i !== -1) {
      const module = checker.line.box.module;
      try {
        const premises = module.premises;
        if (premises == null || premises.length === 0) {
          await this.showMessage('dererr029');
          return null;
        }
        if (i === 0) {
          const all: Rule[] = [];
          for (i = 1; i <= premises.length; i++) all.push(new PremiseRule(module, i));
          return new Rule('all premises', all);
        }
        return new PremiseRule(module, i);
      } catch (e) {
        if (!(e instanceof IllegalArgumentException)) throw e;
        await this.showMessage('dererr030', Message.params('premise index', i + ''));
        return null;
      }
    }
    const rule = checker.line.box.module.getRule(s);
    if (rule == null) {
      await this.showMessage('dernot058', Message.params('rule name', s));
      return null;
    }
    return rule;
  }
}

