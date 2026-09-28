/**
 * Port of LPInvalidation.java (the Invalidity module, module index 1), with the model parts
 * of InvalidityProblemPanel.java, SymbolInterpretationRow.java, InvalidityToolbar.java and the
 * print pages.
 *
 * The student shows a first-order argument invalid by giving a finite universe {0 .. size-1}
 * and interpretations of its predicates and operations under which every premise is true
 * and the conclusion false (checkProblem, via the model checker evaluate).
 *
 * - Program-wide configuration (messages, options): loadInvalidityModule().
 * - InvalidityWorkspace: a student's problem sets (the desktop's static exercises/problems).
 * - LPInvalidation: one open problem, a model a view drives and subscribes to.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { DescriptionTerm, type Expression, QuantifiedFormula } from '../../formula/Expression';
import { FormulaParseException, parseFormula } from '../../formula/parseFormula';
import { VariableScope } from '../../formula/VariableScope';
import { findExtraProblems, readExercises, readWork, verifyDigest, writeProblems, type DigestCheck, type WorkFile, type WrittenWork } from '../../problems/LogicModule';
import { STATE_CODES } from '../../problems/ProblemEntry';
import { selectorMatches, stripNamePrefix } from '../../program/LogicProgram';
import { Message } from '../../program/Message';
import type { ModuleOptions } from '../../program/moduleOptions';
import { invModule } from '../../program/ModuleConstants';
import type { ProblemSelector } from '../../program/ProblemSelector';
import { loadModuleMessages, readModuleOptions } from '../../program/loadProgram';
import { defaultVariable, encodedSymbols, expandEscapes, maggie, symbols, translateSymbols, variableLetter } from '../../program/symbols';
import type { UserInfo } from '../../program/UserInfo';
import { ArgumentParser } from '../../rules/ArgumentParser';
import { Base64Codec } from '../../util/Base64Codec';
import { javaTrim } from '../../util/java';
import { Utf8Codec } from '../../util/Utf8Codec';
import { ChangeNotifier } from '../truth/ChangeNotifier';
import type { ModuleMessage } from '../truth/ModuleUi';
import { validateUserProblem } from '../truth/ModuleDialogs';
import { InterpretationEditor } from './InterpretationEditor';
import { InvalidityProblemSet } from './InvalidityProblemSet';
import { SymbolCollector } from './SymbolCollector';
import { type InterpretationValue, SymbolInterpretation } from './SymbolInterpretation';

export const workFileName = 'invwork.txt';
export const moduleIndex = invModule;
/** The largest universe the size chooser offers. */
export const MAX_UNIVERSE_SIZE = 16;

// ---- program-wide configuration ----

let options: ModuleOptions | null = null;

/** Loads the module's message catalogue and options (InvalidityMessage.loadMessages, readOptions). */
export async function loadInvalidityModule(): Promise<void> {
  await loadModuleMessages(invModule);
  options = await readModuleOptions(invModule);
}

export function getInvalidityOptions(): ModuleOptions | null {
  return options;
}

export function setInvalidityOptions(o: ModuleOptions | null): void {
  options = o;
}

export function selector(name: string): ProblemSelector | null {
  return options == null ? null : options.selector(name);
}

export function flag(name: string): boolean {
  return options != null && options.hasFlag(name);
}

/** InvalidityMessage.get. */
export function invalidityMessage(id: string): Message {
  return Message.getModule(invModule, id);
}

// ---- record helpers ----

export function getProblemStatement(t: TaggedRecord): string | null {
  return t.valueAt(t.indexOfTag('?'));
}

export function hasWork(t: TaggedRecord): boolean {
  return t.indexOfTag('#') !== -1 || t.indexOfTag('&') !== -1;
}

export function getWork(t: TaggedRecord): string {
  return t.formatFields('#=&');
}

export function removeWork(t: TaggedRecord): string {
  return t.formatFields('$?%u!');
}

/** LPInvalidation.getProblemState(String): 0 no work, 1 incorrect, 2 correct. */
export function getProblemState(record: string): number {
  return new LPInvalidation(null).getProblemState(new TaggedRecord(record));
}

/** parseSymbolList: the `=` field's interpretations (entries that do not parse are left out). */
export function parseSymbolList(s: string | null): SymbolInterpretation[] | null {
  if (s == null) return null;
  const out: SymbolInterpretation[] = [];
  let rest: string | null = s;
  while (rest != null) {
    const i = rest.indexOf('.');
    let sym: SymbolInterpretation | null;
    if (i === -1) {
      sym = SymbolInterpretation.parse(rest);
      rest = null;
    } else {
      sym = SymbolInterpretation.parse(rest.substring(0, i));
      rest = rest.substring(i + 1);
    }
    if (sym != null) out.push(sym);
  }
  return out;
}

/** The workspace text of a record's `&` field (Base64 of UTF-8; symbols from the encoded set), or null. */
export function decodeWorkspace(s: string | null): string | null {
  if (s == null) return null;
  try {
    return translateSymbols(new Utf8Codec(new Base64Codec(s).getBytes()).toString(), encodedSymbols, symbols);
  } catch {
    return null;
  }
}

/** The `&` field for a workspace text ("" for an empty text). */
export function encodeWorkspace(text: string): string {
  return new Base64Codec(new Utf8Codec(text).encode()).toString();
}

function parse(s: string | null): Expression | null {
  try {
    return parseFormula(s);
  } catch (e) {
    if (e instanceof FormulaParseException) return null;
    throw e;
  }
}

// ---- the student's problem sets ----

export interface InvalidityStatementItem {
  name: string | null;
  text: string;
}

export interface InvalidityPrintItem {
  index: number;
  status: string;
  /** "<name>: <argument>" (expandEscapes of "\l..."). */
  title: string;
  /** Full pages: the problem loaded for printing. */
  analysis: LPInvalidation | null;
}

export class InvalidityWorkspace {
  exercises = new InvalidityProblemSet();
  problems = new InvalidityProblemSet();
  newProblem: string | null = null;
  digestCheck: DigestCheck | null = null;
  persist: (ws: InvalidityWorkspace) => boolean | Promise<boolean> = () => true;

  static async open(work: WorkFile | null, user: UserInfo | null = null): Promise<InvalidityWorkspace> {
    const ws = new InvalidityWorkspace();
    await readExercises(ws.exercises, workFileName);
    await readWork(ws.problems, workFileName, work);
    ws.problems.exercises = ws.exercises;
    if (user != null) ws.digestCheck = verifyDigest(ws.problems, user);
    const names = await findExtraProblems(workFileName, ws.problems);
    ws.problems.workProblemNames = names;
    ws.exercises.workProblemNames = names;
    for (const e of ws.exercises.elements()) e.extraProblem = false;
    if (ws.problems.mergeExercises()) await ws.saveProblems();
    await ws.problems.restateProblems();
    return ws;
  }

  async saveProblems(): Promise<boolean> {
    return await this.persist(this);
  }

  writeWork(user: UserInfo): WrittenWork {
    return writeProblems(this.problems, workFileName, user);
  }

  getExerciseTitle(name: string | null): string | null {
    const s = this.exercises.getRecord(name);
    return s == null ? null : TaggedRecord.nameOf(s);
  }

  isExercise(name: string | null): boolean {
    return name != null && this.exercises.getRecord(name) != null;
  }

  isExample(name: string | null): boolean {
    return name != null && TaggedRecord.isExample(this.exercises.getRecord(name));
  }

  trimTitle(name: string | null): string | null {
    if (name == null) return null;
    return this.isExercise(name) ? stripNamePrefix(name) : javaTrim(name);
  }

  getExerciseIndices(): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.problems.size(); j++) if (this.isExercise(TaggedRecord.nameOf(this.problems.getRecordAt(j)))) out.push(j);
    return out;
  }

  getStatements(indices: readonly number[]): InvalidityStatementItem[] {
    return indices.map((i) => {
      const t = new TaggedRecord(this.problems.getEntryAt(i)!.name);
      const s = t.getName();
      return { name: s, text: expandEscapes('\\l' + s + ': ' + getProblemStatement(t)) };
    });
  }

  /** getResults: with printIncorrect only the incorrect problems. */
  getResults(indices: readonly number[]): InvalidityPrintItem[] {
    return this.print(indices, (k) => !flag('printIncorrect') || k === 1, false);
  }

  /** getPrintProblems: every problem (the desktop's printIncorrect test there lets all through). */
  getPrintProblems(indices: readonly number[]): InvalidityPrintItem[] {
    return this.print(indices, (k) => !flag('printIncorrect') || k === 1 || k !== 2, true);
  }

  private print(indices: readonly number[], include: (state: number) => boolean, full: boolean): InvalidityPrintItem[] {
    const out: InvalidityPrintItem[] = [];
    for (const index of indices) {
      const entry = this.problems.getEntryAt(index)!;
      const k = entry.state;
      const t = new TaggedRecord(entry.name);
      if (!include(k)) continue;
      const analysis = new LPInvalidation(this, true);
      analysis.loadProblem(entry.name);
      out.push({
        index,
        status: analysis.checkDisabled ? ' ' : STATE_CODES[k],
        title: expandEscapes('\\l' + this.trimTitle(t.getName()) + ': ' + getProblemStatement(t)),
        analysis: full ? analysis : null,
      });
    }
    return out;
  }
}

// ---- one open problem ----

export interface EvaluationSummary {
  /** The verdict: every premise true and the conclusion false. */
  correct: boolean;
  /** The status as computed ("Correct", "T.F.:T", "Universe is empty", ...). */
  raw: string;
  /** The title-bar status (in display symbols, trimmed). */
  status: string;
}

export class LPInvalidation extends ChangeNotifier {
  static now: () => number = () => Date.now();

  checkDisabled = false;
  dontChange = false;
  expandOff = false;
  expandAll = false;
  errorCount = 0;
  workTime = 0;
  loadTime = 0;
  title: string | null = null;
  unparsed: string | null = null;
  lastUserProblem: string | null = null;
  statement: ArgumentParser | null = null;
  probOptions: Map<string, string> | null = null;
  /** The interpretations of the argument's symbols: predicates, then operations. */
  symbols: SymbolInterpretation[] | null = null;
  size = 0;
  /** The value of a description with no unique witness. */
  nonidentical = 0;
  problemIndex = -1;
  status = '';
  note: string | null = null;
  /** The workspace field's text (display symbols) and selection. */
  workspaceText = '';
  selectionStart = 0;
  selectionEnd = 0;

  constructor(
    readonly workspace: InvalidityWorkspace | null,
    readonly forPrint = false,
  ) {
    super();
    this.reset();
    this.newProblem();
  }

  reset(): void {
    this.problemIndex = -1;
    this.workspaceText = '';
    this.selectionStart = this.selectionEnd = 0;
    this.errorCount = 0;
    this.workTime = 0;
    this.loadTime = 0;
    this.title = null;
    this.unparsed = null;
    this.statement = null;
    this.lastUserProblem = null;
    this.symbols = null;
    this.probOptions = null;
    this.size = 0;
    this.nonidentical = 0;
    this.expandOff = false;
    this.expandAll = false;
  }

  // ---- loading and saving ----

  loadExerciseInfo(t: TaggedRecord): void {
    const ex = this.workspace == null ? null : this.workspace.exercises.getRecord(t.getName());
    t = new TaggedRecord(ex);
    const s = t.getName();
    this.probOptions = t.getKeyValues('%');
    this.dontChange = this.probOptions.has('eg');
    const note = t.valueAt(t.indexOfTag('!'));
    this.note = note == null ? null : expandEscapes(javaTrim(note));
    this.checkDisabled = selectorMatches(selector(this.forPrint ? 'noPrintCheck' : 'noCheck'), s);
    this.expandOff = selectorMatches(selector('noExpand'), s);
    this.expandAll = selectorMatches(selector('fullExpand'), s);
  }

  loadProblem(record: string | TaggedRecord | null): void {
    const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
    this.reset();
    this.loadExerciseInfo(t);
    this.title = t.getName();
    this.unparsed = t.valueAt(t.indexOfTag('?'));
    this.statement = ArgumentParser.parse(this.unparsed);
    const size = t.intValueAt(t.indexOfTag('#'));
    this.symbols = parseSymbolList(t.valueAt(t.indexOfTag('=')));
    this.applySize(size ?? 0);
    this.refresh();
    const w = decodeWorkspace(t.valueAt(t.indexOfTag('&')));
    if (w != null) this.setWorkspaceText(w);
    this.errorCount = t.intValueAt(t.indexOfTag('e')) ?? 0;
    this.workTime = t.getTimestamp();
    this.updateWorkTime();
    this.notifyChanged();
  }

  loadProblemAt(i: number): void {
    const ws = this.workspace!;
    this.loadProblem(ws.problems.getRecordAt(i));
    this.problemIndex = i;
    ws.problems.replaceProblem(this.saveProblem(), i);
    this.notifyChanged();
  }

  newProblem(): void {
    this.loadProblem(this.workspace == null ? null : this.workspace.newProblem);
  }

  updateWorkTime(): number {
    const i = Math.floor((LPInvalidation.now() + 500) / 1000);
    if (this.loadTime !== 0) this.workTime += i - this.loadTime;
    this.loadTime = i;
    return this.workTime;
  }

  saveProblem(): string {
    let s = TaggedRecord.formatField(this.title, '$') + TaggedRecord.formatField(this.unparsed, '?');
    if (this.size !== 0) s += this.size + '`#';
    const n = this.symbols == null ? 0 : this.symbols.length;
    let list: string | null = n === 0 ? null : '';
    for (let j = 0; j < n; j++) list += (j === 0 ? '' : '.') + this.symbols![j].encode();
    s += TaggedRecord.formatField(list, '=');
    if (this.errorCount !== 0) s += this.errorCount + '`e';
    if (this.updateWorkTime() !== 0) s += this.workTime + '`t';
    const w = encodeWorkspace(this.workspaceText);
    if (w !== '') s += TaggedRecord.formatField(w, '&');
    return TaggedRecord.toLine(s);
  }

  getChangedProblem(): string | null {
    const s = this.saveProblem();
    const ws = this.workspace;
    const saved = this.problemIndex === -1 || ws == null ? (ws == null ? null : ws.newProblem) : ws.problems.getRecordAt(this.problemIndex);
    return TaggedRecord.stripTimestamp(s) === TaggedRecord.stripTimestamp(saved ?? '') ? null : s;
  }

  /** loadUserProblem: an argument typed by the student (maggie symbols); the error to show, or null. */
  loadUserProblem(s: string): ModuleMessage | null {
    const a = new ArgumentParser(s);
    const unparsed = a.getUnparsedText();
    if (unparsed != null) return { message: invalidityMessage('inverr001'), params: Message.params('expression', unparsed) };
    if (!a.conclusionOnly && a.getErrorCode() === 0) {
      this.loadProblem(TaggedRecord.toLine(TaggedRecord.formatField(ArgumentParser.normalizeDots(s), '?')));
      return null;
    }
    return { message: invalidityMessage('inverr002'), params: null };
  }

  /** InvalidityDialogs.createUserProblem (after confirmSaveChanges): the message to show, or null. */
  createUserProblem(text: string): ModuleMessage | null {
    if (!validateUserProblem(text)) return { message: Message.get('not093'), params: null };
    this.lastUserProblem = translateSymbols(text, symbols, maggie);
    return this.loadUserProblem(this.lastUserProblem);
  }

  userProblemDefault(): string {
    return this.lastUserProblem == null ? '' : translateSymbols(this.lastUserProblem, maggie, symbols);
  }

  getProblemName(): string | null {
    return this.title;
  }

  hasStatement(): boolean {
    return this.statement != null;
  }

  /** Delete Work (removeWork). */
  clearWork(): void {
    this.removeWork();
  }

  setProblemTitle(s: string): void {
    this.title = s;
    this.notifyChanged();
  }

  getTitle(): string | null {
    return this.workspace == null ? (this.title == null ? null : javaTrim(this.title)) : this.workspace.trimTitle(this.title);
  }

  /** The argument as the title bar shows it (display symbols). */
  getDisplayStatement(): string {
    return this.unparsed == null ? '' : javaTrim(translateSymbols(this.unparsed, maggie, symbols));
  }

  /** The "Universe: {0, 1, ...}" label. */
  getUniverseLabel(): string {
    let s = 'Universe: {';
    for (let i = 0; i < this.size; i++) s += (i === 0 ? '' : ', ') + i;
    return s + '}';
  }

  // ---- interpretations ----

  /** InvalidityProblemPanel.refresh: the symbol list from the argument, keeping the interpretations. */
  refresh(): void {
    this.status = '';
    this.symbols = this.getSymbolList().getAllSymbols();
  }

  getSymbolList(): SymbolCollector {
    const c = new SymbolCollector();
    if (this.statement == null) return c;
    for (const p of this.statement.premises) c.collect(p);
    c.collect(this.statement.conclusion);
    c.mergeInterpretations(this.symbols);
    return c;
  }

  getSymbol(name: string, arity: number): SymbolInterpretation | null {
    return this.symbols?.find((s) => s.name === name && s.arity === arity) ?? null;
  }

  private applySize(i: number): void {
    this.size = i;
    for (const s of this.symbols ?? []) s.restrictToUniverse(i);
    this.refresh();
  }

  /** setSize: the universe's size (the chooser; interpretations are cut down to it). */
  setSize(i: number): void {
    this.applySize(i);
    this.notifyChanged();
  }

  /** The size chooser changed (InvalidityProblemPanel.choiceChanged: index = size - 1). */
  chooseSize(size: number): void {
    if (size !== this.size) this.setSize(size);
  }

  /** The text next to a symbol's button. */
  describeSymbol(s: SymbolInterpretation): string {
    return s.describeValues(this.size);
  }

  /**
   * A symbol's button: the editor for it, or the "Empty Universe" message when the size is
   * not set (then null).
   */
  editInterpretation(s: SymbolInterpretation): { editor: InterpretationEditor } | { title: string; text: string } {
    if (this.size === 0) return { title: 'Empty Universe', text: 'The Universe needs to have\nat least one element.' };
    return { editor: new InterpretationEditor(s, this.size) };
  }

  /** The editor's OK. */
  applyEditor(editor: InterpretationEditor): void {
    editor.applyToSymbol();
    this.notifyChanged();
  }

  /** removeWork (Delete Work): no universe, no interpretations. */
  removeWork(): void {
    this.size = 0;
    for (const s of this.symbols ?? []) s.clearValues();
    this.refresh();
    this.notifyChanged();
  }

  hasWork(): boolean {
    return this.size !== 0;
  }

  // ---- the model checker ----

  /** checkProblem: every premise's closure true and the conclusion's false. */
  checkProblem(): boolean {
    if (this.size === 0 || this.statement == null) return false;
    for (const p of this.statement.premises) {
      if (this.evaluate(closure(p)) !== true) return false;
    }
    return this.evaluate(closure(this.statement.conclusion)) === false;
  }

  /** The Check button's summary (the desktop's evaluate()): "Correct", or e.g. "T.F.:T" (N: undefined). */
  summarize(): EvaluationSummary {
    let raw: string;
    let correct = false;
    if (this.size === 0) raw = 'Universe is empty';
    else if (this.statement == null) raw = 'nothing to disprove';
    else if ((correct = this.checkProblem())) raw = 'Correct';
    else {
      const tf = (v: InterpretationValue) => (typeof v === 'boolean' ? (v ? 'T' : 'F') : 'N');
      raw = this.statement.premises.map((p) => tf(this.evaluate(closure(p)))).join('.');
      raw += '.:' + tf(this.evaluate(closure(this.statement.conclusion)));
    }
    return { correct, raw, status: javaTrim(translateSymbols(raw + ' ', maggie, symbols)) };
  }

  /**
   * The Check button: sets the status. With checking disabled the desktop shows the message
   * "Feature Disabled" / "Checking is disabled for this problem." instead (disabled: true).
   */
  check(): EvaluationSummary & { disabled: boolean } {
    if (this.checkDisabled) return { correct: false, raw: '', status: this.status, disabled: true };
    const r = this.summarize();
    this.status = r.status;
    this.notifyChanged();
    return { ...r, disabled: false };
  }

  /**
   * evaluate: the value of an expression in the model: a truth value, an element, or null
   * (undefined: an uninterpreted symbol, a wrong kind of value, ...).
   */
  evaluate(e: Expression | null, scope: VariableScope<number> = new VariableScope<number>()): InterpretationValue {
    if (e == null) return null;
    const n = e.getChildCount();
    const s = e.getSymbol();
    const bound = scope.getShadowed(s, 0);
    if (bound != null) return bound;
    for (const sym of this.symbols!) {
      if (sym.name === s && sym.arity === n) {
        const args: number[] | null = n === 0 ? null : [];
        for (let l = 0; l < n; l++) {
          const v = this.evaluate(e.getChild(l), scope);
          if (typeof v !== 'number') return null;
          args![l] = v;
        }
        return sym.getValue(args);
      }
    }
    if (s === '@' || s === '!' || s === '%') {
      if (n < 2) return null;
      const x = e.getChild(0)!.symbol;
      let count = 0;
      let witness = 0;
      for (let k = 0; k < this.size; k++) {
        scope.push(x, k);
        const v = this.evaluate(e.getChild(1), scope);
        scope.pop(x);
        if (typeof v !== 'boolean') return null;
        if (s === '@' && !v) return false;
        if (s === '!' && v) return true;
        if (s === '%' && v && ++count === 1) witness = k;
      }
      if (s === '@') return true;
      if (s === '!') return false;
      return count === 1 ? witness : this.nonidentical;
    }
    const a = n > 0 ? this.evaluate(e.getChild(0), scope) : null;
    const b = n > 1 ? this.evaluate(e.getChild(1), scope) : null;
    const bools = typeof a === 'boolean' && typeof b === 'boolean';
    switch (s) {
      case '~':
        return typeof a === 'boolean' ? !a : null;
      case '->':
        return bools ? !a || (b as boolean) : null;
      case '<->':
        return bools ? a === b : null;
      case '&':
        return bools ? (a as boolean) && (b as boolean) : null;
      case '|':
        return bools ? (a as boolean) || (b as boolean) : null;
      case '=':
        return typeof a === 'number' && typeof b === 'number' ? a === b : null;
      default:
        return null;
    }
  }

  // ---- the workspace field ----

  /** The field's text changed (with the selection). */
  setWorkspaceText(text: string, selectionStart = text.length, selectionEnd = selectionStart): void {
    this.workspaceText = text;
    this.select(selectionStart, selectionEnd);
  }

  select(start: number, end: number): void {
    const n = this.workspaceText.length;
    this.selectionStart = Math.max(0, Math.min(start, n));
    this.selectionEnd = Math.max(this.selectionStart, Math.min(end, n));
    this.notifyChanged();
  }

  /** JTextComponent.getSelectedText: null when nothing is selected. */
  getSelectedText(): string | null {
    return this.selectionStart === this.selectionEnd ? null : this.workspaceText.substring(this.selectionStart, this.selectionEnd);
  }

  private replaceSelection(s: string): void {
    const t = this.workspaceText;
    const at = this.selectionStart + s.length;
    this.workspaceText = t.substring(0, this.selectionStart) + s + t.substring(this.selectionEnd);
    this.selectionStart = this.selectionEnd = at;
  }

  /**
   * The Expand button: replaces the selected quantified formula (display symbols) by its
   * expansion over the universe with the names <prefix>0, <prefix>1, ... (prefix: the first
   * variable letter); all: every quantifier in it (the right click, with the fullExpand
   * option). Returns the message to show, or null.
   */
  expand(all: boolean, prefix: string = variableLetter(0)): ModuleMessage | null {
    if (this.size === 0) return { message: invalidityMessage('invnot002'), params: null };
    const s2 = translateSymbols(this.getSelectedText(), symbols, maggie);
    let e = parse(s2);
    if (e == null) return { message: invalidityMessage('inverr001'), params: Message.params('expression', s2) };
    let parens = true;
    if (this.size === 1) {
      const body = e.getChild(1);
      // the desktop fails (NullPointerException) when the selection has no second part; nothing changes
      if (body == null) return null;
      parens = !(body instanceof QuantifiedFormula) && !(body instanceof DescriptionTerm) && body.getChildCount() > 1;
    }
    if (!all && !(e instanceof QuantifiedFormula)) return { message: invalidityMessage('inverr003'), params: Message.params('expression', s2) };
    e = e.expandQuantifiers(this.size, prefix, all);
    let s3 = translateSymbols(e.toString(), maggie, symbols);
    if (parens) s3 = '(' + s3 + ')';
    this.replaceSelection(s3);
    this.notifyChanged();
    return null;
  }

  /** The Expand button's actions: left click, right click; invnot004 when expansion is off. */
  expandAction(rightClick: boolean): ModuleMessage | null {
    if (this.expandOff) return { message: invalidityMessage('invnot004'), params: null };
    return this.expand(rightClick && this.expandAll);
  }

  /** The Copy button: the argument (as shown) replaces the selection, and is selected. */
  copyStatement(): void {
    let i = this.selectionStart;
    let j = this.selectionEnd;
    if (i >= j) i = j = this.selectionEnd;
    const s = this.workspaceText;
    const st = this.getDisplayStatement();
    this.workspaceText = s.substring(0, i) + st + s.substring(j);
    this.selectionStart = i;
    this.selectionEnd = i + st.length;
    this.notifyChanged();
  }

  // ---- links to the other modules ----

  /**
   * The Derivation button (openDerivation): the derivation record ("<argument>`-`="), or
   * invnot001 when there is no problem. finiteUniverse adds the premise that the universe is
   * {a0, ...} (the desktop's toolbar passes false).
   */
  derivationLink(finiteUniverse = false): { record: string } | ModuleMessage {
    if ((finiteUniverse && this.size === 0) || this.statement == null) return { message: invalidityMessage('invnot001'), params: null };
    let s = '';
    if (finiteUniverse) {
      const x = defaultVariable(0);
      const a = variableLetter(0);
      if (this.size === 1) s = '@' + x + x + '=' + a + '0';
      else {
        let t = '@' + x + '(' + x + '=' + a + '0';
        for (let i = 1; i < this.size; i++) t += '|' + x + '=' + a + i;
        s = t + ')';
      }
    }
    this.statement.premiseTexts.forEach((p, k) => (s += (k === 0 && !finiteUniverse ? '' : ' . ') + p));
    s += ' .: ' + this.statement.conclusionText + '`-`=';
    return { record: s };
  }

  /**
   * The Truth Table button (openTruthAnalysis): the truth-table record ("<statement>`="). The
   * desktop's toolbar sends the workspace selection (expanded = false); expanded: the argument
   * with every quantifier expanded over the universe (invnot003 without a problem and size).
   */
  truthTableLink(expanded = false): { record: string } | ModuleMessage {
    const a = variableLetter(0);
    if (!expanded) return { record: translateSymbols(this.getSelectedText(), symbols, maggie) + '`=' };
    if (this.size === 0 || this.statement == null) return { message: invalidityMessage('invnot003'), params: null };
    let s = '';
    this.statement.premises.forEach((p, i) => (s += (i !== 0 ? ' . ' : '') + p!.expandQuantifiers(this.size, a)));
    s += ' .: ' + this.statement.conclusion!.expandQuantifiers(this.size, a) + '`=';
    return { record: s };
  }

  // ---- states ----

  getProblemState(t: TaggedRecord): number {
    if (!hasWork(t)) return 0;
    this.loadProblem(t);
    return this.checkProblem() ? 2 : 1;
  }
}

/** closure: the universal closure. */
export function closure(e: Expression | null): Expression | null {
  return e == null ? null : e.universalClosure();
}
