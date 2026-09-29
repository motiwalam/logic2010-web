/**
 * Port of the computation of DerivationRulesView.java (the Applicable button): the rules that
 * apply to the stack of the justification at the cursor, and what each would produce. It runs
 * the steps before the cursor as the stack view does, then tries every rule on the stack there
 * as the next step, without dialogs; nothing in the derivation changes.
 *
 * A result the program would ask the user to complete shows the missing parts as unknowns:
 * ?P, ?Q for formulas, ?F(..) for formulas with the arguments shown, ?t, ?u for terms, ?f(..)
 * for terms built around the arguments shown, and ?x, ?y for variables. Rules the problem does
 * not allow are listed too, with the reason (lock).
 */
import { BinderMap } from '../../formula/BinderMap';
import { AtomicFormula, type Expression, OperationTerm, SimpleTerm } from '../../formula/Expression';
import { toWords } from '../../data/QuantifierWords';
import { OperationLetter, PredicateLetter, SchematicLetter } from '../../formula/SchematicLetter';
import { SchemeInstantiation } from '../../formula/SchemeInstantiation';
import { translateSymbols } from '../../program/symbols';
import { BoundVariableMap } from '../../rules/BoundVariableMap';
import { PermutationIterator } from '../../rules/PermutationIterator';
import { type Rule, SchematicRule } from '../../rules/Rule';
import { ruleTable } from '../../rules/RuleTable';
import { javaTrim } from '../../util/java';
import { isDigit, isJavaLetter, isJavaLetterOrDigit } from './chars';
import { ASS_STR } from './DerivationConstants';
import type { DerivationLine } from './DerivationLine';
import { DerivationLineChecker } from './DerivationLineChecker';
import { computeStack, type StackSnapshot, textBeforeCursor } from './DerivationStackView';
import type { LPDerivation } from './LPDerivation';
import type { RuleApplication } from './RuleApplication';
import { RuleApplication as RuleApplicationClass } from './RuleApplication';

export const BOX_RULES = ['CD', 'ID', 'DD', 'UD', 'BD'];

/** A rule that applies at the cursor, with one of its results. */
export class Applicable {
  rule: string;
  /** The result as a formula (maggie symbols, with unknowns); or a description (formula false). */
  result: string;
  formula = true;
  /** The result, when it is a formula with no unknowns. */
  value: Expression | null = null;
  unknowns: number;
  /** Why the problem does not allow it, or null. */
  lock: string | null = null;
  /** 0 closes the box, 1 uses the stack, 2 pushes a formula, 3 rearranges the stack. */
  group = 1;
  order = 0;
  form: string | null = null;
  /** The compound rules that include the form. */
  families: string[] | null = null;
  /** The stack formulas it uses (display symbols, with their origins). */
  uses: string[] = [];
  /** What to type (the rule name, or RULE[formula]). */
  command: string | null = null;
  notes: string[] = [];
  /** Whether the result is the line's formula. */
  matchesLine = false;

  constructor(rule: string, result: string, unknowns: number) {
    this.rule = rule;
    this.result = result;
    this.unknowns = unknowns;
  }

  rank(): number {
    return (this.lock == null ? 0 : 8) + (this.unknowns === 0 ? 0 : 4) + (this.group === 3 ? 3 : this.group);
  }

  signature(): string {
    return this.rule + '\u0001' + this.result + '\u0001' + this.lock + '\u0001' + this.matchesLine + '\u0001' + this.details();
  }

  /** The hover text (HTML), as the desktop shows it. */
  details(): string {
    let b = '<b>' + escape(this.rule) + '</b>';
    if (this.families != null && this.families.length !== 0) {
      b += ' &nbsp;<i>(part of ' + this.families.map(escape).join(', ') + ')</i>';
    }
    if (this.form != null) b += '<br>Rule: ' + escape(this.form);
    this.uses.forEach((u, j) => (b += (j === 0 ? '<br>Uses: ' : '<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;') + escape(u)));
    if (this.formula) b += '<br>Gives: ' + formulaHtml(this.result, false);
    else if (this.result !== '') b += '<br>' + escape(this.result.substring(0, 1).toUpperCase() + this.result.substring(1));
    if (this.matchesLine) b += '<br><font color="#007800">This is the line\'s formula.</font>';
    if (this.command != null) {
      b += '<br>Type: <b>' + escape(this.command) + '</b>';
      if (this.unknowns > 0 && this.command.indexOf('[') !== -1) b += ' (with the unknowns filled in), or ' + escape(this.rule) + ' to be asked';
    }
    for (const n of this.notes) b += '<br><font color="#606060">' + escape(n) + '</font>';
    if (this.lock != null) b += '<br><font color="#a00000">Not allowed here: ' + escape(this.lock) + '</font>';
    return b;
  }
}

export class RulesResult {
  rules: Applicable[] = [];
  error: string | null = null;
  closed: string | null = null;
}

/** What the rules view shows, in its sections. */
export interface RulesViewData {
  line: DerivationLine | null;
  heading: string;
  /** Notes in the order shown (the error, the box closed, "No rule applies ..."). */
  notes: string[];
  /** Allowed rules, best first. */
  available: Applicable[];
  /** "Not allowed here". */
  locked: Applicable[];
  /** "Stack operations". */
  stackOperations: Applicable[];
  result: RulesResult | null;
}

export function escape(s: string): string {
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}

/** A formula in the display symbols as HTML, with its unknowns (?P, ?t, ...) colored. */
export function formulaHtml(s: string, locked: boolean): string {
  const s1 = escape(translateSymbols(s));
  let out = '';
  let i = 0;
  while (i < s1.length) {
    const j = markLength(s1, i);
    if (j === 0) {
      out += s1.charAt(i);
      i++;
    } else {
      out += (locked ? '<i>' : '<font color="#005ac8"><i>') + s1.substring(i, i + j) + (locked ? '</i>' : '</i></font>');
      i += j;
    }
  }
  return out;
}

/** The length of the unknown (?P, ?t2, ...) at i in s, or 0. */
export function markLength(s: string, i: number): number {
  if (i + 1 < s.length && s.charAt(i) === '?' && isJavaLetter(s.charAt(i + 1))) {
    let j = i + 2;
    while (j < s.length && isDigit(s.charAt(j))) j++;
    return j - i;
  }
  return 0;
}

/** Formula text with unknowns as typed: with quantifier words, "@?x Fx" being "forall ?x Fx". */
export function typedText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const j = '@!'.indexOf(s.charAt(i));
    if (j !== -1 && markLength(s, i + 1) !== 0) out += ['forall', 'exists'][j] + ' ';
    else out += s.charAt(i);
  }
  return toWords(out);
}

/** Separates an unknown from a letter after it ("G?xb" is shown "G?x b"). */
export function spaceMarks(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const j = markLength(s, i);
    if (j === 0) {
      out += s.charAt(i);
      i++;
    } else {
      out += s.substring(i, i + j);
      i += j;
      if (i < s.length && (isJavaLetterOrDigit(s.charAt(i)) || '?@!~'.indexOf(s.charAt(i)) !== -1)) out += ' ';
    }
  }
  return out;
}

/** The rules that apply after the steps text of the line's justification. */
export async function computeRules(line: DerivationLine, text: string): Promise<RulesResult> {
  const result = new RulesResult();
  const snapshot = await computeStack(line, text, (checker, snap) => collect(checker, snap, text, result.rules));
  result.error = snapshot.error;
  result.closed = snapshot.closed;
  sortApplicable(result.rules);
  return result;
}

/** Allowed rules before the others, and those with no unknowns first; otherwise in the order found. */
export function sortApplicable(list: Applicable[]): void {
  for (let i = 1; i < list.length; i++) {
    const a = list[i];
    let j = i;
    while (j > 0 && list[j - 1].rank() > a.rank()) {
      list[j] = list[j - 1];
      j--;
    }
    list[j] = a;
  }
}

async function collect(checker: DerivationLineChecker, snapshot: StackSnapshot, s: string, out: Applicable[]): Promise<void> {
  const line = checker.line;
  const module = line.box.module;
  const i = checker.getStackSize();
  checker.argumentCount = i;
  checker.matchLine = false;
  checker.finalStep = false;
  checker.assertion = null;
  checker.target = null;
  checker.premiseMatches = [];
  checker.fullMatches = [];
  const described: string[] = [];
  for (let j = 0; j < i; j++) {
    const origin = snapshot.origins[j];
    described.push(translateSymbols(snapshot.formulas[j].toString()) + (origin === '' ? '' : ' (' + origin + ')'));
  }
  await addBoxRules(checker, s, i, described, out);
  addSchematicRules(checker, i, described, out);
  if (i > 0) {
    const names = ['IE', 'CIE'];
    for (let k = 0; k < names.length; k++) {
      const a = new Applicable(names[k], '?P', 1);
      a.lock = ruleLockByName(module, names[k]);
      a.form =
        k === 0
          ? 'replaces a part of the top formula by an equivalent (a biconditional theorem, rule or line)'
          : 'replaces a part of the top formula by an equivalent, under a condition';
      a.uses.push(described[described.length - 1]);
      a.notes.push('The program asks for the part to replace and the equivalence to use.');
      a.command = names[k];
      out.push(a);
    }
  }
  addPremises(checker, out);
  if (javaTrim(s) === '') addAssumptions(checker, out);
  if (i >= 1) {
    const top = checker.getStackFormula(-1)!;
    const dup = new Applicable('DUP', top.toString(), 0);
    dup.group = 3;
    dup.form = 'pushes another copy of the top formula';
    dup.uses.push(described[described.length - 1]);
    out.push(dup);
    const drop = new Applicable('DROP', i === 1 ? '(empty stack)' : '', 0);
    drop.group = 3;
    drop.formula = false;
    drop.result = 'removes ' + translateSymbols(top.toString());
    drop.form = 'removes the top formula';
    drop.uses.push(described[described.length - 1]);
    out.push(drop);
  }
  if (i >= 2) {
    const swap = new Applicable('SWAP', checker.getStackFormula(-2)!.toString(), 0);
    swap.group = 3;
    swap.form = 'exchanges the top two formulas; the result shown is the new top';
    swap.uses.push(described[i - 2]);
    swap.uses.push(described[described.length - 1]);
    out.push(swap);
  }
  const lineFormula = line.getFormula();
  out.forEach((a, l) => {
    a.order = l;
    if (a.group === 1 || a.group === 2) {
      a.matchesLine = lineFormula != null && a.unknowns === 0 && a.value != null && a.value.isIdentical(lineFormula);
      if (a.uses.length < i && a.group === 1) {
        const left = i - a.uses.length;
        a.notes.push('Leaves ' + left + ' formula' + (left === 1 ? '' : 's') + ' under the result; as the last step of the line, a rule must use the whole stack.');
      }
    }
  });
}

/** CD, ID, DD, UD and BD, where one of them can close the box with this line. */
async function addBoxRules(checker: DerivationLineChecker, s: string, i: number, described: string[], out: Applicable[]): Promise<void> {
  const line = checker.line;
  if (i === 0 || !line.isLastInBox()) return;
  const box = line.box;
  for (const rule of BOX_RULES) {
    const snapshot = await computeStack(line, s + ' ' + rule);
    if (snapshot.error != null || rule !== snapshot.closed) continue;
    const a = new Applicable(rule, '', 0);
    a.group = 0;
    a.formula = false;
    const show = box.getFormula();
    a.result = 'closes the box: Show ' + (show == null ? '' : translateSymbols(show.toString()));
    a.value = show;
    a.form = boxRuleForm(rule);
    const k = rule === 'ID' ? 2 : 1;
    for (let l = i - k; l < i; l++) a.uses.push(described[l]);
    a.lock = ruleLockByName(box.module, rule);
    const t = box.assumptionType;
    if (a.lock == null && rule !== 'UD' && t >= 0 && t < ASS_STR.length) {
      if (box.module.checkDerivationRule(rule + '/' + ASS_STR[t], false) != null) a.lock = 'may not close a box opened ' + assumptionName(t) + ' in this problem';
    }
    if (i > k) a.notes.push('The stack must hold exactly ' + k + ' formula' + (k === 1 ? '' : 's') + ' when the box is closed.');
    a.command = rule;
    out.push(a);
  }
}

export function boxRuleForm(s: string): string {
  if (s === 'CD') return 'the consequent of the Show line closes a conditional derivation';
  if (s === 'ID') return 'a formula and its negation close an indirect derivation';
  if (s === 'DD') return "the Show line's formula closes a direct derivation";
  return s === 'UD' ? 'the instance closes a universal derivation' : 'the other side closes a biconditional derivation';
}

export function assumptionName(i: number): string {
  return ['without an assumption', 'by ASS ID', 'by ASS CD', 'by ASS BD'][i];
}

/** Every rule form of the rules list and the user's rules whose premises match the top of the stack. */
function addSchematicRules(checker: DerivationLineChecker, i: number, described: string[], out: Applicable[]): void {
  const module = checker.line.box.module;
  const families = new Map<string, string[]>();
  const forms = allForms(module, families);
  for (const form of forms) {
    const k = form.premises.length;
    if (k > i || form.conclusion == null) continue;
    const matches = matchForm(checker, form);
    checker.pruneDegenerateMatches(matches);
    const found: Applicable[] = [];
    const results: string[] = [];
    for (const application of matches) {
      for (const inst of checker.occurrenceChoices(application)) {
        const a = describe(checker, application, inst);
        if (a != null && !results.includes(a.result)) {
          results.push(a.result);
          for (let j1 = 0; j1 < k; j1++) a.uses.push(described[i - k + j1]);
          found.push(a);
        }
      }
    }
    const lock = ruleLock(module, form);
    const fam = families.get(form.name) ?? null;
    for (const a of found) {
      a.group = k === 0 ? 2 : 1;
      a.lock = lock;
      a.families = fam;
      a.command = found.length === 1 && a.unknowns === 0 ? form.name : form.name + '[' + typedText(a.result) + ']';
      out.push(a);
    }
  }
}

/** The rule forms in the order of the rules list (then the user's rules), each once; families of each. */
function allForms(module: LPDerivation, families: Map<string, string[]>): SchematicRule[] {
  const forms = new Map<string, SchematicRule>();
  for (const table of [ruleTable, module.workspace.userRules]) {
    if (table == null) continue;
    for (const name of table.ruleNames) {
      const rule = table.getRule(name);
      if (rule == null) continue;
      for (const form of rule.getAllForms()) {
        if (!forms.has(form.name)) forms.set(form.name, form);
        if (!(rule instanceof SchematicRule)) {
          let list = families.get(form.name);
          if (list == null) families.set(form.name, (list = []));
          if (!list.includes(rule.name)) list.push(rule.name);
        }
      }
    }
  }
  return [...forms.values()];
}

/** The ways the premises of form match the top of the stack, in any order, as the next step. */
function matchForm(checker: DerivationLineChecker, form: SchematicRule): RuleApplication[] {
  const out: RuleApplication[] = [];
  const n = form.premises.length;
  const conclusionInst = new SchemeInstantiation();
  form.conclusion!.match(null, conclusionInst);
  const perms = new PermutationIterator(n);
  do {
    const order = perms.current();
    const inst = new SchemeInstantiation();
    let ok = true;
    for (let j = 0; j < n && ok; j++) {
      const single = new SchemeInstantiation();
      ok = form.premises[order[j]].match(checker.getStackFormula(j - n), single) && inst.mergeFrom(single);
    }
    const map = new BoundVariableMap();
    if (ok && inst.hasNoDeferredMatches()) ok = checker.premisesMatch(form, order, inst, map);
    if (ok && inst.mergeFrom(conclusionInst)) out.push(new RuleApplicationClass(form, order, inst, map));
  } while (perms.next());
  return out;
}

/** What the form gives with inst: the conclusion with the open letters as unknowns; null if it cannot be formed. */
function describe(checker: DerivationLineChecker, application: RuleApplication, inst: SchemeInstantiation): Applicable | null {
  const form = application.form;
  let map = new BoundVariableMap();
  if (!inst.hasNoDeferredMatches() || !checker.premisesMatch(form, application.premiseOrder, inst, map)) {
    map = application.boundVariables.clone();
  }
  const e = form.conclusion!.copy();
  const marks: [SchematicLetter, string][] = [];
  const counts = [0, 0, 0, 0, 0];
  const notes: string[] = [];
  mark(e, inst, marks, counts, notes);
  const binderMap = new BinderMap();
  const e1 = e.instantiate(inst.clone(), binderMap);
  if (!map.renameBinders(e, e1, binderMap)) return null;
  let s = e1.toString();
  let i = 0;
  while (s.indexOf(SchematicLetter.placeholder(i)) !== -1) {
    const name = '?' + markName(4, counts[4]++);
    s = s.split(SchematicLetter.placeholder(i)).join(name);
    notes.push(name + ': a variable you choose (the program asks for it)');
    i++;
  }
  s = spaceMarks(s);
  const a = new Applicable(form.name, s, marks.length + i);
  a.value = a.unknowns === 0 ? e1 : null;
  a.form = translateSymbols(form.format(', ', ' ∴ '));
  a.notes.push(...notes);
  if (form.name === 'EI' && a.unknowns > 0) a.notes.push('EI: the variable must not occur earlier in the derivation.');
  return a;
}

/** Renames the letters of e (a copy of a conclusion) that inst leaves open to unknowns. */
function mark(e: Expression, inst: SchemeInstantiation, marks: [SchematicLetter, string][], counts: number[], notes: string[]): void {
  let letter: SchematicLetter | null = null;
  if (e instanceof AtomicFormula || e instanceof OperationTerm || (e instanceof SimpleTerm && !e.hasBinder())) letter = e.getSchematicLetter();
  if (letter != null && inst.getReplacement(letter) == null) {
    let s = marks.find(([l]) => l.equals(letter))?.[1];
    if (s == null) {
      const kind = letter instanceof PredicateLetter ? (letter.getArity() === 0 ? 0 : 1) : letter instanceof OperationLetter ? (letter.getArity() === 0 ? 2 : 3) : 4;
      s = '?' + markName(kind, counts[kind]++);
      marks.push([letter, s]);
      const what = [
        ': a formula you choose',
        '(..): a formula you choose, with the arguments shown in it',
        ': a term you choose',
        '(..): a term you choose, with the arguments shown in it',
        ': a variable you choose',
      ];
      notes.push(s + what[kind] + ' (the program asks for it)');
    }
    e.symbol = s;
  }
  for (let j = 0; j < e.childCount; j++) mark(e.getChild(j)!, inst, marks, counts, notes);
}

/** The n-th name for an unknown of the kind: formula, formula with arguments, term, term with arguments, variable. */
export function markName(kind: number, n: number): string {
  const s = ['PQRSTUVW', 'FGHJK', 'tuvw', 'fgh', 'xyzw'][kind];
  return n < s.length ? s.substring(n, n + 1) : s.substring(0, 1) + (n - s.length + 2);
}

/** Why the problem does not allow the rule here, or null. */
export function ruleLock(module: LPDerivation, rule: Rule): string | null {
  if (module.hasProperty(rule, 'disabled')) return module.isWeaklyDisabled(rule) ? 'disabled: this problem is its own proof' : 'disabled for this problem';
  if (module.commandMode && module.hasProperty(rule, 'manual')) return 'not in command mode: type the line\'s formula yourself';
  if (!rule.isProven(module)) {
    const proofs = rule instanceof SchematicRule ? rule.getProofProblems(module) : null;
    const s = (proofs ?? []).join(' or ');
    return s === '' ? 'derived rule, not yet proved' : 'derived rule: prove ' + s + ' first';
  }
  return null;
}

export function ruleLockByName(module: LPDerivation, name: string): string | null {
  const rule = module.getRule(name);
  return rule == null ? null : ruleLock(module, rule);
}

/** PR1, PR2, ...: each premise of the problem can be pushed. */
function addPremises(checker: DerivationLineChecker, out: Applicable[]): void {
  const module = checker.line.box.module;
  const premises = module.premises;
  const n = premises == null ? 0 : premises.length;
  if (n === 0 || !module.problem.showLine.syntaxOk) return;
  for (let j = 0; j < n; j++) {
    const a = new Applicable(n === 1 ? 'PR' : 'PR' + (j + 1), String(premises![j]), 0);
    a.group = 2;
    a.value = premises![j];
    a.form = 'pushes premise ' + (j + 1) + ' of the argument';
    a.command = a.rule;
    out.push(a);
  }
}

/** ASS CD, ASS ID, ASS BDL and ASS BDR, on the first line of a box before any step. */
function addAssumptions(checker: DerivationLineChecker, out: Applicable[]): void {
  const line = checker.line;
  const show = line.box.getFormula();
  if (line.getIndexInBox() !== 1 || line.box.showLine === line || show == null) return;
  const module = line.box.module;
  const s = show.getSymbol();
  if (s === '->') out.push(assumption(module, 'ASS CD', show.getChild(0)!, 2, 'assumes the antecedent of the Show line', false));
  if (s === '~') {
    out.push(assumption(module, 'ASS ID', show.getChild(0)!, 1, 'assumes the unnegated Show line', true));
    out.push(assumption(module, 'ASS ID', show.negate(), 1, 'assumes the negation of the Show line', true));
  } else {
    out.push(assumption(module, 'ASS ID', show.negate(), 1, 'assumes the negation of the Show line', false));
  }
  if (s === '<->') {
    out.push(assumption(module, 'ASS BDL', show.getChild(0)!, 3, 'assumes the left side of the Show line', false));
    out.push(assumption(module, 'ASS BDR', show.getChild(1)!, 3, 'assumes the right side of the Show line', false));
  }
}

function assumption(module: LPDerivation, name: string, e: Expression, kind: number, form: string, asserted: boolean): Applicable {
  const a = new Applicable(name, e.toString(), 0);
  a.group = 2;
  a.value = e;
  a.form = form;
  a.command = asserted ? name + '[' + typedText(e.toString()) + ']' : name;
  const closers = kind === 3 ? ['BD'] : ['CD', 'ID', 'DD'];
  let ok = false;
  for (let j = 0; j < closers.length && !ok; j++) ok = module.checkDerivationRule(closers[j] + '/' + ASS_STR[kind], false) == null;
  if (!ok) a.lock = 'no rule may close a box opened ' + assumptionName(kind) + ' in this problem';
  return a;
}

/** The rules view at the cursor (see stackViewData for line, text and caret). */
export async function rulesViewData(line: DerivationLine | null, text: string | null = null, caret: number | null = null): Promise<RulesViewData> {
  if (line == null || line.annotationEditor == null) {
    return {
      line: null,
      heading: 'Put the cursor in a justification to see the rules that apply there.',
      notes: [],
      available: [],
      locked: [],
      stackOperations: [],
      result: null,
    };
  }
  const s = text ?? line.annotationEditor.getText();
  const before = textBeforeCursor(s, caret ?? s.length);
  const result = await computeRules(line, before);
  const shown = javaTrim(before) === '' ? '(no steps yet)' : javaTrim(before);
  const data: RulesViewData = { line, heading: 'Line ' + line.getLineNumber() + ', after: ' + shown, notes: [], available: [], locked: [], stackOperations: [], result };
  if (result.error != null) {
    data.notes.push('The steps before the cursor do not apply: ' + result.error);
  } else if (result.closed != null) {
    data.notes.push(result.closed + ' closes the box; no rule can follow it.');
  } else {
    for (const a of result.rules) (a.group === 3 ? data.stackOperations : a.lock == null ? data.available : data.locked).push(a);
    if (data.available.length === 0) data.notes.push(data.locked.length === 0 ? 'No rule applies to the stack here.' : 'No rule this problem allows applies here.');
  }
  return data;
}

export const UNKNOWNS_NOTE =
  'Unknowns are parts the program would ask for: ?P a formula, ?t a term, ?x a variable. Hover over a rule for details. Theorems (Tn) are not listed.';

/**
 * Web-only (not in the desktop's rules view): the theorems a line may use as its next step,
 * each as a row that pushes its formula (the letters it leaves open shown as unknowns; typing
 * Tn asks for them). A theorem is listed only if the checker would accept it here: not
 * disabled (nor manual, in command mode) for the problem, and proven (its proof problems
 * solved in the workspace), as ruleLock decides for the rules.
 */
export function availableTheorems(line: DerivationLine): Applicable[] {
  const module = line.box.module;
  const theorems = ruleTable?.theorems;
  if (theorems == null) return [];
  const checker = new DerivationLineChecker(line, false, '');
  const out: Applicable[] = [];
  for (const n of theorems.numbers()) {
    const theorem = theorems.getTheorem(n);
    if (theorem == null || theorem.conclusion == null) continue;
    if (ruleLock(module, theorem) != null) continue;
    const inst = new SchemeInstantiation();
    theorem.conclusion.match(null, inst);
    const a = describe(checker, new RuleApplicationClass(theorem, [], inst, new BoundVariableMap()), inst);
    if (a == null) continue;
    a.rule = theorem.name;
    a.group = 2;
    a.command = theorem.name;
    a.form = 'Theorem ' + n + ': ' + translateSymbols(theorem.conclusion.toString());
    a.notes = a.unknowns > 0 ? ['Typed as ' + theorem.name + ', the program asks for the unknowns.'] : [];
    const lineFormula = line.getFormula();
    a.matchesLine = lineFormula != null && a.unknowns === 0 && a.value != null && a.value.isIdentical(lineFormula);
    out.push(a);
  }
  return out;
}
