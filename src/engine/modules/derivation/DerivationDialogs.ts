/**
 * Port of the rule queries of DerivationDialogs.java (and of the naming of bound variables in
 * BoundVariableMap.renameBinders): each builds its dialog as data (QueryDialog), fills it from
 * the answers typed after the rule name ("UI/a") when it can, avoids it in serial mode (Check)
 * as the desktop does, and otherwise has the UI show it (LPDerivation.dialogs). All the
 * validation is here and in DerivationQueryHandler; the UI only collects the input.
 *
 * The problem-level dialogs (choosing, saving, deleting problems) are operations of
 * LPDerivation and DerivationWorkspace; the UI asks the questions itself.
 */
import type { Expression, Term } from '../../formula/Expression';
import { ExpressionPath } from '../../formula/ExpressionPath';
import { FormulaParseNode } from '../../formula/FormulaParseNode';
import { PredicateLetter, type SchematicLetter } from '../../formula/SchematicLetter';
import type { SchemeInstantiation } from '../../formula/SchemeInstantiation';
import type { IntervalSet } from '../../program/IntervalSet';
import { Message, type MessageParams } from '../../program/Message';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { type BinderNaming, type BoundVariableMap, binderVariable } from '../../rules/BoundVariableMap';
import { HighlightedText } from '../../rules/HighlightedText';
import type { Rule, SchematicRule } from '../../rules/Rule';
import type { DerivationLine } from './DerivationLine';
import type { DerivationLineChecker } from './DerivationLineChecker';
import { formatDerivationMessage, getDerivationMessage, getDerivationText } from './DerivationMessage';
import { DerivationQueryHandler } from './DerivationQueryHandler';
import { InterchangeJustification } from './InterchangeJustification';
import type { Justification } from './Justification';
import { type DialogBlock, DialogField, QueryDialog } from './QueryDialog';
import { RuleApplication } from './RuleApplication';
import { SchemeSubstitutionPanel } from './SchemeSubstitutionPanel';
import { TermOccurrenceSelector } from './TermOccurrenceSelector';

export { DialogField, HeadlessDialogs, QueryDialog } from './QueryDialog';
export type { DerivationDialogs, DialogBlock, DialogKind } from './QueryDialog';

const OK_CANCEL = ['OK', 'Cancel'];

function text(s: string): DialogBlock {
  return { type: 'text', text: s };
}

function formula(s: string, highlight: HighlightedText | null = null): DialogBlock {
  return { type: 'formula', text: s, highlight };
}

function lineDialog(kind: QueryDialog['kind'], line: DerivationLine, blocks: DialogBlock[], buttons: string[] = OK_CANCEL): QueryDialog {
  const d = new QueryDialog(kind, 'Line ' + line.getLineNumber(), blocks, buttons, 0);
  d.lineNumber = line.getLineNumber();
  return d;
}

async function show(line: DerivationLine, dialog: QueryDialog): Promise<void> {
  await line.box.module.showDialog(dialog);
}

/** A message window about a line or a checker (DerivationDialogs.showMessage). */
export function showMessage(
  line: DerivationLine | null,
  id: string,
  params: MessageParams | null = null,
  props: Map<string, unknown> | null = null,
  checker: DerivationLineChecker | null = null,
): Promise<void> {
  return line!.box.module.showDialogMessage(id, params, props, checker, line);
}

/** chooseFormula: a choice among formulas; -1 if cancelled (always in serial mode). */
export async function chooseFormula(line: DerivationLine, choices: readonly Expression[], prompt: string): Promise<number> {
  if (line.box.module.serialMode) return -1;
  const d = lineDialog('chooseFormula', line, [
    text(prompt),
    { type: 'choices', options: choices.map((e) => ({ text: translateSymbols(e.toString()), highlight: null, enabled: true })) },
  ]);
  d.choice = 0;
  line.focusEditor(true);
  await show(line, d);
  return d.selectedButton === 0 && d.choice >= 0 && d.choice < choices.length ? d.choice : -1;
}

/**
 * chooseRuleInstance: which of several applications (with different results); the only one
 * if they all look the same; -1 if cancelled (always in serial mode).
 */
export async function chooseRuleInstance(checker: DerivationLineChecker, list: readonly (RuleApplication | InterchangeJustification)[]): Promise<number> {
  const j = list.length;
  if (j === 1) return 0;
  if (j === 0) return -1;
  const displays: (HighlightedText | null)[] = [];
  let k = 0;
  for (const item of list) {
    let h: HighlightedText | null = null;
    if (item instanceof RuleApplication) h = item.createDisplay().toHighlightedText();
    else h = item.toHighlightedText(checker);
    if (h != null && !displays.some((x) => x != null && x.equals(h))) {
      displays.push(h);
      k++;
    } else {
      displays.push(null);
    }
  }
  if (k === 1) return 0;
  if (checker.line.box.module.serialMode) return -1;
  const blocks: DialogBlock[] = [];
  const l = checker.maxPremises;
  const params = Message.params('n', l + '');
  if (l > 0) {
    blocks.push(text(formatDerivationMessage(getDerivationText('derdlg003'), params, checker)));
    for (let i1 = 0; i1 < l; i1++) blocks.push(formula(String(checker.getStackFormula(i1 - l))));
  }
  const matching = checker.matchLine && checker.lineFormula != null;
  if (matching) {
    blocks.push(text(formatDerivationMessage(getDerivationText(l > 0 ? 'derdlg004' : 'derdlg005'), params, checker)));
    blocks.push(formula(checker.lineFormula!.toString()));
    blocks.push(text(formatDerivationMessage(getDerivationText('derdlg006'), params, checker)));
  } else {
    blocks.push(text(formatDerivationMessage(getDerivationText('derdlg017'), params, checker)));
  }
  const options: { text: string; highlight: HighlightedText | null; enabled: boolean }[] = [];
  let first = -1;
  for (let j1 = 0; j1 < j; j1++) {
    const h = displays[j1];
    const item = list[j1];
    if (h == null) {
      options.push({ text: '', highlight: null, enabled: false });
    } else if (matching) {
      if (item instanceof RuleApplication) {
        options.push({ text: translateSymbols(item.getForm().formatInOrder(item.premiseOrder)), highlight: null, enabled: true });
      } else {
        options.push({ text: translateSymbols(item.getEquivalenceRule(checker)!.toString()), highlight: null, enabled: true });
      }
      if (first === -1) first = j1;
    } else {
      options.push({ text: h.text ?? '', highlight: h, enabled: true });
      if (first === -1) first = j1;
    }
  }
  blocks.push({ type: 'choices', options });
  const d = lineDialog('chooseRuleInstance', checker.line, blocks);
  d.choice = first;
  checker.line.focusEditor(true);
  await show(checker.line, d);
  if (d.selectedButton !== 0) return -1;
  return d.choice >= 0 && d.choice < j && options[d.choice].enabled ? d.choice : -1;
}

/** chooseSideToShow: SHOW ANT / NEGCONS of a biconditional: which side (preset L or R). */
export async function chooseSideToShow(checker: DerivationLineChecker, e: Expression, negate: boolean): Promise<Expression | null> {
  const sides: Expression[] = [];
  for (let i = 0; i < 2; i++) {
    sides[i] = e.getChild(i)!.copy();
    if (negate) sides[i] = sides[i].negate();
  }
  const d = new QueryDialog(
    'chooseSideToShow',
    'Choose a Formula',
    [text('Please choose a formula to show'), { type: 'choices', options: sides.map((s) => ({ text: translateSymbols(s.toString(), maggie, symbols), highlight: null, enabled: true })) }],
    OK_CANCEL,
  );
  d.lineNumber = checker.line.getLineNumber();
  d.choice = 0;
  const hidden = new DialogField('');
  if (await d.fillFieldsAndChoose(checker.presetAnswers, [hidden], 0)) {
    const s = hidden.getText().toLowerCase();
    if (s === 'l') return sides[0];
    if (s === 'r') return sides[1];
  }
  const module = checker.line.box.module;
  if (module.serialMode) {
    checker.reportError('dererr064');
    module.complete = false;
    return null;
  }
  d.selectedButton = -1;
  await show(checker.line, d);
  if (d.selectedButton === 0 && (d.choice === 0 || d.choice === 1)) return sides[d.choice];
  return null;
}

/** instanceSchemeQuery: the values of the letters the premises leave open (IE: of the equivalence). */
export async function instanceSchemeQuery(checker: DerivationLineChecker, justification: Justification): Promise<boolean> {
  const module = checker.line.box.module;
  if (module.serialMode && checker.presetAnswers == null) {
    checker.reportError('dererr064');
    module.complete = false;
    return false;
  }
  let application: RuleApplication;
  let path: ExpressionPath;
  let interchange = false;
  if (justification instanceof InterchangeJustification) {
    application = justification.toRuleApplication()!;
    path = justification.path!;
    interchange = true;
  } else if (justification instanceof RuleApplication) {
    application = justification;
    path = new ExpressionPath();
  } else {
    throw new Error('instanceSchemeQuery expects LPRuleInstance or LPInterchangeInstance');
  }
  const matching = checker.matchLine && checker.lineFormula != null;
  const blocks: DialogBlock[] = [];
  const inst = application.instantiation;
  const form = application.form;
  const i = form.premises.length;
  const params = Message.params('n', i + '');
  if (interchange) Message.putParam(params, 'rule name', form.name);
  if (i > 0) {
    blocks.push(text(formatDerivationMessage(getDerivationText('derdlg003'), params, checker)));
    for (let j = 0; j < i; j++) blocks.push(formula(String(checker.getStackFormula(j - i)!.getSubexpression(path))));
  }
  let panel: SchemeSubstitutionPanel;
  let displayApplication: RuleApplication | null = null;
  if (matching) {
    blocks.push(text(formatDerivationMessage(getDerivationText(i > 0 ? 'derdlg004' : 'derdlg005'), params, checker)));
    blocks.push(formula(String(checker.lineFormula!.getSubexpression(path))));
    blocks.push(text(formatDerivationMessage(getDerivationText('derdlg007'), params, checker)));
    blocks.push(formula(form.formatInOrder(application.premiseOrder)));
    panel = new SchemeSubstitutionPanel(inst);
  } else {
    const display = application.createDisplay();
    displayApplication = display.application as RuleApplication;
    blocks.push(text(formatDerivationMessage(getDerivationText('derdlg019'), params, checker)));
    blocks.push(formula(display.toHighlightedText().text ?? '', display.toHighlightedText()));
    panel = new SchemeSubstitutionPanel(display.displayInstantiation, true);
  }
  blocks.push({ type: 'substitution', rows: panel.rows });
  const d = lineDialog('instanceSchemeQuery', checker.line, blocks);
  checker.line.focusEditor(true);
  if (!(await d.fillFieldsAndChoose(checker.presetAnswers, panel.getPendingFields(), 0))) {
    if (module.serialMode) {
      checker.reportError('dererr064');
      module.complete = false;
      return false;
    }
    d.selectedButton = -1;
    await show(checker.line, d);
  }
  if (d.selectedButton !== 0) {
    checker.reportError('dererr028');
    module.abort(true);
    return false;
  }
  const read = panel.readInstantiation();
  if (read == null) {
    checker.reportError(panel.errorId!, panel.errorParams);
    return false;
  }
  if (matching) {
    if (!inst.mergeFrom(read)) {
      checker.reportError(inst.errorId!, inst.errorParams);
      return false;
    }
  } else {
    while (inst.pendingLetters.length !== 0) {
      const x = inst.pendingLetters[0].toExpression();
      const value = x.instantiate(displayApplication!.instantiation).instantiate(read);
      if (!inst.addReplacement(x, value)) {
        checker.reportError(inst.errorId!, inst.errorParams);
        return false;
      }
    }
  }
  return true;
}

function refuse(checker: DerivationLineChecker): false {
  const module = checker.line.box.module;
  module.complete = false;
  checker.reportError('dererr064');
  return false;
}

/** generalizationTermQuery (EG): the occurrences of the term to generalize. */
export async function generalizationTermQuery(checker: DerivationLineChecker, application: RuleApplication): Promise<boolean> {
  if (checker.line.box.module.serialMode) return refuse(checker);
  const inst = application.instantiation;
  const selector = new TermOccurrenceSelector('generalization', checker.getStackFormula(-1)!, messageShower(checker.line));
  if (!(await termSelectionQuery('generalizationTermQuery', checker, application, 'derdlg008', null, selector, null))) return false;
  const s = translateSymbols(selector.getText(), symbols, maggie);
  if (!inst.addReplacement(inst.pendingLetters[0].toString(), s)) {
    checker.reportError(inst.errorId!, inst.errorParams);
    return false;
  }
  return true;
}

/** The single text field queries: UI term, EI variable, EG dummy variable. */
async function textFieldQuery(
  kind: 'universalTermQuery' | 'existentialVarQuery' | 'dummyVarQuery',
  checker: DerivationLineChecker,
  application: RuleApplication,
  prompt: string,
  params: MessageParams | null,
  action: string,
): Promise<DialogField | null> {
  const module = checker.line.box.module;
  if (module.serialMode && checker.presetAnswers == null) {
    refuse(checker);
    return null;
  }
  const field = new DialogField('');
  const d = lineDialog(kind, checker.line, [text(formatDerivationMessage(getDerivationText(prompt), params, checker)), { type: 'field', field, label: null }]);
  checker.line.focusEditor(true);
  const handler = new DerivationQueryHandler(checker.line, 'OK:' + action + '.Cancel');
  handler.setProperty('just', checker);
  handler.setProperty('inst', application);
  handler.setProperty('edit', field);
  d.addHandler(handler);
  if (!(await d.fillFieldsAndChoose(checker.presetAnswers, [field], 0))) {
    if (module.serialMode) {
      refuse(checker);
      return null;
    }
    d.selectedButton = -1;
    await show(checker.line, d);
  }
  if (d.selectedButton !== 0) {
    checker.reportError('dererr028');
    module.abort(true);
    return null;
  }
  return field;
}

export async function existentialVarQuery(checker: DerivationLineChecker, application: RuleApplication): Promise<boolean> {
  const params = Message.params('gen var', '\\l' + String(checker.stack[0].getChild(0)) + '\\l');
  const field = await textFieldQuery('existentialVarQuery', checker, application, 'derdlg009', params, 'existentialVarQueryOK');
  if (field == null) return false;
  const inst = application.instantiation;
  if (!inst.addReplacement(inst.pendingLetters[0].toString(), translateSymbols(field.getText(), symbols, maggie))) {
    checker.reportError(inst.errorId!, inst.errorParams);
    return false;
  }
  return true;
}

export async function universalTermQuery(checker: DerivationLineChecker, application: RuleApplication): Promise<boolean> {
  const params = Message.params('gen var', '\\l' + String(checker.stack[0].getChild(0)) + '\\l');
  const field = await textFieldQuery('universalTermQuery', checker, application, 'derdlg010', params, 'universalTermQueryOK');
  if (field == null) return false;
  const inst = application.instantiation;
  if (!inst.addReplacement(inst.pendingLetters[0].toString(), translateSymbols(field.getText(), symbols, maggie))) {
    checker.reportError(inst.errorId!, inst.errorParams);
    return false;
  }
  return true;
}

export async function dummyVarQuery(checker: DerivationLineChecker, application: RuleApplication, map: BoundVariableMap): Promise<boolean> {
  const field = await textFieldQuery('dummyVarQuery', checker, application, 'derdlg011', null, 'dummyVarQueryOK');
  if (field == null) return false;
  const s = translateSymbols(field.getText(), symbols, maggie);
  const conclusion = application.getForm().conclusion!;
  if (!map.assign(binderVariable(conclusion.getBinders(), 0), s)) {
    checker.reportError('dererr060', Message.params('variable name', '\\l' + s + '\\l'));
    return false;
  }
  return true;
}

/** termSelectionQuery: the occurrences dialog of EG, LL1/2, LL3/4 and EL (never in serial mode). */
async function termSelectionQuery(
  kind: 'generalizationTermQuery' | 'leibniz12TermQuery' | 'leibniz34TermQuery' | 'eulerTermQuery',
  checker: DerivationLineChecker,
  application: RuleApplication,
  prompt: string,
  params: MessageParams | null,
  selector: TermOccurrenceSelector,
  presetTerms: (Term | null)[] | null,
): Promise<boolean> {
  const module = checker.line.box.module;
  if (module.serialMode) return refuse(checker);
  const message = getDerivationMessage(prompt);
  const blocks: DialogBlock[] = [text(formatDerivationMessage(message.text, params, checker)), { type: 'selector', selector }];
  if (presetTerms != null) {
    presetTerms.forEach((term, k) => {
      if (term != null) {
        selector.setPlaceholderValue(k, term.toString());
        selector.selectedTerms[k] = term;
        selector.selectionCounts[k]++;
      }
    });
  }
  const handler = new DerivationQueryHandler(checker.line, message.buttons);
  handler.setProperty('undo', selector);
  handler.setProperty('just', checker);
  handler.setProperty('inst', application);
  handler.setProperty('edit', selector);
  const d = lineDialog(kind, checker.line, blocks, handler.labels.slice());
  checker.line.focusEditor(true);
  d.addHandler(handler);
  await show(checker.line, d);
  if (d.selectedButton !== 0) {
    checker.reportError('dererr028');
    module.abort(true);
    return false;
  }
  return true;
}

function messageShower(line: DerivationLine): (id: string, params: MessageParams | null) => Promise<void> {
  return (id, params) => line.box.module.showDialogMessage(id, params, null, null, null);
}

export async function leibniz12TermQuery(checker: DerivationLineChecker, application: RuleApplication): Promise<boolean> {
  if (checker.line.box.module.serialMode) return refuse(checker);
  const form = application.form;
  const order = application.premiseOrder;
  const i = form.premises[order[0]].symbol === '=' ? 0 : 1;
  const identity = checker.getStackFormula(i - 2)!;
  const wffA = checker.getStackFormula(-i - 1)!;
  const ruleTerm = form.premises[order[1 - i]].getChild(0)!.symbol;
  const otherTerm = form.conclusion!.getChild(0)!.symbol;
  const j = form.premises[order[i]].getChild(0)!.symbol === ruleTerm ? 0 : 1;
  const term = identity.getChild(j) as Term;
  const inst = application.instantiation;
  const params = Message.params(
    'rule term', ruleTerm,
    'other term', otherTerm,
    'term A', '\\l' + String(term) + '\\l',
    'term B', '\\l' + String(identity.getChild(1 - j)) + '\\l',
    'wff A', '\\l' + String(wffA) + '\\l',
  );
  const selector = new TermOccurrenceSelector('leibniz12', wffA, messageShower(checker.line), params);
  if (!(await termSelectionQuery('leibniz12TermQuery', checker, application, 'derdlg012', params, selector, [term]))) return false;
  const s = translateSymbols(selector.getText(), symbols, maggie);
  if (!inst.addReplacement(inst.pendingLetters[0].toString(), s)) {
    checker.reportError(inst.errorId!, inst.errorParams);
    return false;
  }
  return true;
}

export async function leibniz34TermQuery(checker: DerivationLineChecker, application: RuleApplication): Promise<boolean> {
  if (checker.line.box.module.serialMode) return refuse(checker);
  const form = application.form;
  const order = application.premiseOrder;
  const i = form.premises[order[0]].symbol === '~' ? 0 : 1;
  const e = checker.getStackFormula(-i - 1)!;
  const ruleTerm = form.premises[order[1 - i]].getChild(0)!.symbol;
  const otherTerm = form.premises[order[i]].getChild(0)!.symbol;
  const inst = application.instantiation;
  const params = Message.params('rule term', ruleTerm, 'other term', otherTerm);
  let letter: SchematicLetter | null = null;
  for (const l of inst.pendingLetters) {
    if (l instanceof PredicateLetter) {
      letter = l;
      break;
    }
  }
  const selector = new TermOccurrenceSelector('leibniz34', e, messageShower(checker.line), params);
  selector.ruleLetter = letter;
  if (!(await termSelectionQuery('leibniz34TermQuery', checker, application, 'derdlg013', params, selector, null))) return false;
  const s = translateSymbols(selector.getText(), symbols, maggie);
  if (!inst.addReplacement(letter!.toString(), s)) {
    checker.reportError(inst.errorId!, inst.errorParams);
    return false;
  }
  return true;
}

export async function eulerTermQuery(checker: DerivationLineChecker, application: RuleApplication): Promise<boolean> {
  if (checker.line.box.module.serialMode) return refuse(checker);
  const inst = application.instantiation;
  const top = checker.getStackFormula(-1)!;
  const term = top.getChild(0) as Term;
  const lineLeft = checker.lineFormula!.getChild(0) as Term;
  const params = Message.params(
    'left premise term', '\\l' + String(term) + '\\l',
    'left conclusion term', '\\l' + String(lineLeft) + '\\l',
    'right premise term', '\\l' + String(top.getChild(1)) + '\\l',
    'right conclusion term', '\\l' + String(checker.lineFormula!.getChild(1)) + '\\l',
  );
  const selector = new TermOccurrenceSelector('euler', lineLeft, messageShower(checker.line), params);
  if (!(await termSelectionQuery('eulerTermQuery', checker, application, 'derdlg015', params, selector, [term]))) return false;
  const letter = inst.pendingLetters[0];
  const s = translateSymbols(selector.getText(), symbols, maggie);
  if (!inst.addReplacement(letter.toString(), s)) {
    checker.reportError(inst.errorId!, inst.errorParams);
    return false;
  }
  return true;
}

/**
 * interchangeFormulaQuery (IE/CIE): which part of the cited formula to replace. The result
 * wanted (an asserted one, or the line's formula on the last step) shows it without asking.
 */
export async function interchangeFormulaQuery(checker: DerivationLineChecker, ij: InterchangeJustification): Promise<boolean> {
  if (checker.target != null && !ij.pathChosen) {
    ij.path = checker.target.getDifferencePath(checker.getStackFormula(-1));
    if ((ij.pathChosen = ij.path != null)) return true;
  } else {
    ij.pathChosen = false;
  }
  const module = checker.line.box.module;
  if (module.serialMode) return refuse(checker);
  const message = getDerivationMessage('derdlg020');
  const top = checker.getStackFormula(-1)!;
  const shown = module.config.officialIE ? top.formatFull(1) : top.formatMinimal(1);
  const field = new DialogField(translateSymbols(shown, maggie, symbols), false);
  field.select(0, 0);
  const handler = new DerivationQueryHandler(checker.line, message.buttons);
  handler.setProperty('just', checker);
  handler.setProperty('edit', field);
  const d = lineDialog('interchangeFormulaQuery', checker.line, [text(formatDerivationMessage(message.text, null, checker)), { type: 'field', field, label: null }], handler.labels.slice());
  d.addHandler(handler);
  await show(checker.line, d);
  if (d.selectedButton !== 0) {
    checker.reportError('dererr028');
    module.abort(true);
    return false;
  }
  const range = [field.selectionStart, field.selectionEnd];
  const s1 = translateSymbols(field.getText(), symbols, maggie, range);
  ij.path = new FormulaParseNode(s1).findNodeContaining(range[0], range[1]).getPath();
  return true;
}

/** interchangeRuleQuery (IE): the equivalence (rule, theorem, line or premise) to use. */
export async function interchangeRuleQuery(checker: DerivationLineChecker, ij: InterchangeJustification): Promise<boolean> {
  const module = checker.line.box.module;
  if (module.serialMode && checker.presetAnswers == null) return refuse(checker);
  const message = getDerivationMessage('derdlg021');
  const field = new DialogField('');
  const handler = new DerivationQueryHandler(checker.line, message.buttons);
  handler.setProperty('just', checker);
  handler.setProperty('edit', field);
  const d = lineDialog('interchangeRuleQuery', checker.line, [text(formatDerivationMessage(message.text, null, checker)), { type: 'field', field, label: null }], handler.labels.slice());
  d.addHandler(handler);
  if (!(await d.fillFieldsAndChoose(checker.presetAnswers, [field], 0))) {
    if (module.serialMode) return refuse(checker);
    d.selectedButton = -1;
    await show(checker.line, d);
  }
  if (d.selectedButton !== 0) {
    checker.reportError('dererr028');
    module.abort(true);
    return false;
  }
  return applyInterchangeRule(checker, ij, handler.getProperty<Rule>('rule')!, null);
}

/** applyInterchangeRule: the applications of the rule at the chosen part (a shallower part if none). */
export async function applyInterchangeRule(checker: DerivationLineChecker, ij: InterchangeJustification, rule: Rule, condition: SchematicRule | null): Promise<boolean> {
  const I = InterchangeJustification;
  let unclean = !I.isConditionSubstitutionClean(checker, ij.path!, condition);
  let found = I.findApplications(checker, ij.path!, rule, condition);
  let none = found == null;
  let i = !unclean && !none ? found!.length : 0;
  if (i === 0) {
    if (ij.pathChosen) {
      while (ij.path!.depth > 0) {
        ij.path!.depth--;
        unclean = !I.isConditionSubstitutionClean(checker, ij.path!, condition);
        found = I.findApplications(checker, ij.path!, rule, condition);
        if (!unclean && found != null) {
          none = false;
          i = found.length;
        } else {
          i = 0;
        }
        if (i !== 0) break;
      }
    }
    if (i === 0) {
      const params = new Map<string, string>();
      Message.putParam(params, 'inner rule', rule.name);
      Message.putParam(params, 'inner exp', '\\l' + String(checker.getStackFormula(-1)!.getSubexpression(ij.path)) + '\\l');
      if (condition != null) Message.putParam(params, 'condition name', condition.name);
      const id = unclean ? 'dererr099' : none ? (condition == null ? 'dererr085' : 'dererr095') : condition == null ? 'dererr096' : 'dererr097';
      checker.reportError(id, params);
      return false;
    }
  }
  const j = checker.lineFormula == null ? await chooseRuleInstance(checker, found!) : 0;
  if (j === -1) {
    checker.refuseOrAbort();
    return false;
  }
  const chosen = found![j];
  if (chosen.ruleApplication != null) {
    if (!(await instanceSchemeQuery(checker, chosen))) return false;
    if ((await chosen.getResult(checker)) == null) return false;
  }
  ij.reversed = chosen.reversed;
  ij.ruleApplication = chosen.ruleApplication;
  ij.equivalenceLine = chosen.equivalenceLine;
  ij.equivalencePremise = chosen.equivalencePremise;
  ij.instantiation = chosen.instantiation;
  ij.boundVariables = chosen.boundVariables;
  ij.conditionLine = chosen.conditionLine;
  ij.conditionPremise = chosen.conditionPremise;
  ij.conditionInstance = chosen.conditionInstance;
  ij.conditionReversed = chosen.conditionReversed;
  return true;
}

/** cieRuleQuery (CIE): the conditional equivalence and the condition. */
export async function cieRuleQuery(checker: DerivationLineChecker, ij: InterchangeJustification): Promise<boolean> {
  const module = checker.line.box.module;
  if (module.serialMode && checker.presetAnswers == null) return refuse(checker);
  const message = getDerivationMessage('derdlg022');
  const message1 = getDerivationMessage('derdlg023');
  const ruleField = new DialogField('');
  const condField = new DialogField('');
  const handler = new DerivationQueryHandler(checker.line, message.buttons);
  handler.setProperty('just', checker);
  handler.setProperty('ruleEdit', ruleField);
  handler.setProperty('condEdit', condField);
  const d = lineDialog(
    'cieRuleQuery',
    checker.line,
    [
      text(formatDerivationMessage(message.text, null, checker)),
      { type: 'field', field: ruleField, label: null },
      text(formatDerivationMessage(message1.text, null, checker)),
      { type: 'field', field: condField, label: null },
    ],
    handler.labels.slice(),
  );
  d.addHandler(handler);
  if (!(await d.fillFieldsAndChoose(checker.presetAnswers, [ruleField, condField], 0))) {
    if (module.serialMode) return refuse(checker);
    d.selectedButton = -1;
    await show(checker.line, d);
  }
  if (d.selectedButton !== 0) {
    checker.reportError('dererr028');
    module.abort(true);
    return false;
  }
  return applyInterchangeRule(checker, ij, handler.getProperty<Rule>('rule')!, handler.getProperty<SchematicRule>('condition'));
}

/**
 * The naming of fresh bound variables (BoundVariableMap.renameBinders with a checker): the
 * user chooses a symbol for each bound variable the rule does not name.
 */
export function binderNaming(checker: DerivationLineChecker): BinderNaming {
  const line = checker.line;
  const module = line.box.module;
  return {
    refuseDialog(): boolean {
      if (module.serialMode && checker.presetAnswers == null) {
        checker.reportError('dererr064');
        module.complete = false;
        return true;
      }
      return false;
    },
    async askNames(expressionText: string, highlights: IntervalSet[], pending: SchemeInstantiation): Promise<SchemeInstantiation | null> {
      const n = pending.pendingLetters.length;
      const s1 = n === 1 ? '' : 's';
      const s2 = n === 1 ? 'a ' : '';
      const panel = new SchemeSubstitutionPanel(pending, true);
      const d = lineDialog('renameBinders', line, [
        text('Given the expression'),
        formula(expressionText, new HighlightedText(expressionText, highlights)),
        text('please choose ' + s2 + 'symbol' + s1 + ' for'),
        text('the following bound variable' + s1),
        { type: 'substitution', rows: panel.rows },
      ]);
      line.focusEditor(true);
      if (!(await d.fillFieldsAndChoose(checker.presetAnswers, panel.getPendingFields(), 0))) {
        if (module.serialMode) {
          checker.reportError('dererr064');
          module.complete = false;
          return null;
        }
        d.selectedButton = -1;
        await show(line, d);
      }
      if (d.selectedButton !== 1 && d.selectedButton !== -1) {
        const read = panel.readInstantiation();
        if (read == null) {
          line.showMessage(panel.errorId!, panel.errorParams);
          return null;
        }
        return read;
      }
      line.showMessage('dererr028');
      module.abort(true);
      return null;
    },
    showError(id: string, params: MessageParams | null): void {
      line.showMessageAt(id, checker, module.phase, params);
    },
  };
}
