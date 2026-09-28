/**
 * Port of LPDerivation.java without the Swing parts: one derivation being worked on (the
 * desktop's module window). It holds the tree (problem: the root DerivationBox), the problem's
 * options (command mode, queued mode, the rules it disables ...), the argument (premises,
 * conclusion), the check's state (phase, serialMode, complete, proofMissing, aborted,
 * varNames, errorCount), and the editor focus. It answers the rule property queries of the
 * rules engine (RulePropertySource: disabled, manual, weakAss, assumed; proofs).
 *
 * The UI subscribes to changes (subscribe) and drives it through the lines' editors and the
 * operations here; the dialogs it opens go to `dialogs`.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import type { Expression } from '../../formula/Expression';
import { STATE_CORRECT, STATE_INCOMPLETE, STATE_INCORRECT } from '../../problems/ProblemEntry';
import { IntervalSet } from '../../program/IntervalSet';
import { selectorMatches, stripNamePrefix } from '../../program/LogicProgram';
import { ErrorRef, Message, type MessageParams } from '../../program/Message';
import { maggie, rob, symbols, translateSymbols } from '../../program/symbols';
import { ArgumentParser } from '../../rules/ArgumentParser';
import { type Rule, SchematicRule } from '../../rules/Rule';
import type { RulePropertySource } from '../../rules/RulePropertySource';
import type { RuleTable } from '../../rules/RuleTable';
import type { TheoremTable } from '../../rules/TheoremTable';
import { javaTrim, parseJavaInt, parseJavaLong } from '../../util/java';
import { COMP_CHECK } from './DerivationConstants';
import { DerivationBox } from './DerivationBox';
import type { DerivationLine } from './DerivationLine';
import { DerivationLineChecker } from './DerivationLineChecker';
import type { DerivationLineEditor } from './DerivationLineEditor';
import { formatDerivationMessage, getDerivationMessage } from './DerivationMessage';
import { hasWork, UserRule } from './DerivationProblemSet';
import { DerivationQueryHandler } from './DerivationQueryHandler';
import type { DerivationWorkspace } from './DerivationWorkspace';
import { decodeJustification } from './JustificationCodec';
import { type DerivationDialogs, HeadlessDialogs, QueryDialog } from './QueryDialog';

export interface LPDerivationOptions {
  /** The UI's dialogs (default: none, every dialog is closed at once). */
  dialogs?: DerivationDialogs;
  /** Whether the module has a window (the desktop's frame != null): the rule queries only open in one. */
  hasFrame?: boolean;
  /** Whether message parameters are substituted (the desktop does so in a window). */
  doSubs?: boolean;
  /** A module for printing (noPrintCheck / noPrintErr instead of noCheck / noErrMess). */
  forPrint?: boolean;
}

/** What the title panel shows. */
export interface TitleState {
  /** The problem's name as shown (trimmed), or null. */
  title: string | null;
  /** The argument in display symbols. */
  statement: string | null;
  /** The exercise's note (its ! field). */
  note: string | null;
  /** "Correct", "Incorrect", "Incomplete" or "" after a check. */
  status: string | null;
}

export class LPDerivation implements RulePropertySource {
  readonly workspace: DerivationWorkspace;
  dialogs: DerivationDialogs;
  hasFrame: boolean;
  doSubs: boolean;
  forPrint: boolean;
  problem!: DerivationBox;
  focus: DerivationLineEditor | null = null;
  lastFocus: DerivationLineEditor | null = null;
  /** The editor whose focus the last operation requested (moved by flushFocus). */
  pendingFocus: DerivationLineEditor | null = null;
  focusLostPending = false;
  commandMode = true;
  queuedMode = true;
  dontChange = false;
  chapter: number | null = null;
  serialMode = false;
  checkDisabled = false;
  errorMessagesDisabled = false;
  mixedModeDisabled = false;
  requestAid = false;
  complete = false;
  proofMissing = false;
  disabledRules: string[] | null = null;
  manualRules: string[] | null = null;
  weakAssRules: string[] | null = null;
  assumedRules: string[] | null = null;
  disabledRange: IntervalSet | null = null;
  manualRange: IntervalSet | null = null;
  weakAssRange: IntervalSet | null = null;
  assumedRange: IntervalSet | null = null;
  premises: (Expression | null)[] | null = null;
  conclusion: Expression | null = null;
  problemTitle: string | null = null;
  lastUserProblem: string | null = null;
  phase = 0;
  errorCount = 0;
  workTime = 0;
  loadTime = 0;
  private abortedFlag = false;
  doShowLog = false;
  varNames: string[] | null = null;
  probOptions: Map<string, string> | null = null;
  problemIndex = -1;
  readonly titleState: TitleState = { title: null, statement: null, note: null, status: null };
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(workspace: DerivationWorkspace, opts: LPDerivationOptions = {}) {
    this.workspace = workspace;
    this.dialogs = opts.dialogs ?? new HeadlessDialogs();
    this.hasFrame = opts.hasFrame ?? true;
    this.doSubs = opts.doSubs ?? this.hasFrame;
    this.forPrint = opts.forPrint ?? false;
    this.problem = new DerivationBox(this, null);
    this.newProblem();
    this.resetVarNames();
  }

  get config() {
    return this.workspace.config;
  }

  // ---- change notification ----

  /** Calls listener after every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A number that grows with every change (for useSyncExternalStore). */
  getVersion(): number {
    return this.version;
  }

  changed(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  /** Runs an operation of the UI: then moves the focus as requested and notifies. */
  async run<T>(op: () => T | Promise<T>): Promise<T> {
    try {
      return await op();
    } finally {
      this.flushFocus();
      this.changed();
    }
  }

  // ---- focus ----

  /** An editor asks for the focus (moved when the operation ends: flushFocus). */
  requestFocus(editor: DerivationLineEditor): void {
    this.pendingFocus = editor;
  }

  /** The editor is removed from the derivation: it loses the focus. */
  forgetFocusOf(editor: DerivationLineEditor | null): void {
    if (editor != null && this.focus === editor) this.focusLostPending = true;
    if (editor != null && this.pendingFocus === editor) this.pendingFocus = null;
  }

  forgetFocus(line: DerivationLine): void {
    this.forgetFocusOf(line.formulaEditor);
    this.forgetFocusOf(line.annotationEditor);
  }

  /** Moves the focus to the requested editor (focusLost on the old one, focusGained on the new). */
  flushFocus(): void {
    const target = this.pendingFocus;
    this.pendingFocus = null;
    if (target != null && target !== this.focus && this.isAttached(target)) {
      if (this.focus != null) this.focus.focusLost();
      target.focusGained();
    } else if (this.focusLostPending && this.focus != null) {
      this.focus.focusLost();
    }
    this.focusLostPending = false;
  }

  /** The UI focuses an editor (a click), or none. */
  setFocus(editor: DerivationLineEditor | null): void {
    if (editor === this.focus) return;
    if (this.focus != null) this.focus.focusLost();
    if (editor != null) editor.focusGained();
    this.changed();
  }

  /** Whether the editor is still one of a line in the derivation. */
  isAttached(editor: DerivationLineEditor): boolean {
    const line = editor.line;
    if (line.formulaEditor !== editor && line.annotationEditor !== editor) return false;
    let node: DerivationLine | DerivationBox = line.box.showLine === line ? line.box : line;
    for (let box = node instanceof DerivationBox ? node.parentBox : line.box; ; box = box.parentBox) {
      if (box == null) return node === this.problem;
      if (box.indexOfNode(node) === -1) return false;
      node = box;
    }
  }

  // ---- dialogs ----

  showDialog(dialog: QueryDialog): Promise<void> {
    return this.dialogs.show(dialog);
  }

  /** The message window of a message (DerivationDialogs.showMessage). */
  messageDialog(
    id: string,
    params: MessageParams | null,
    props: Map<string, unknown> | null,
    checker: DerivationLineChecker | null,
    line: DerivationLine | null,
  ): QueryDialog {
    const message = getDerivationMessage(id);
    const text = formatDerivationMessage(message.text, params, checker, line ?? (checker == null ? null : checker.line));
    let buttons = ['OK'];
    let defaultButton = 0;
    let handler: DerivationQueryHandler | null = null;
    if (message.buttons != null) {
      handler = new DerivationQueryHandler(line!, message.buttons);
      if (props != null) handler.setProperties(props);
      buttons = handler.labels.slice();
      defaultButton = handler.defaultIndex;
    }
    const d = new QueryDialog('message', message.id, [{ type: 'text', text }], buttons, defaultButton);
    d.messageId = message.id;
    d.isError = message.isError;
    if (line != null) d.lineNumber = line.getLineNumber();
    d.addHandler(handler);
    return d;
  }

  showDialogMessage(
    id: string,
    params: MessageParams | null,
    props: Map<string, unknown> | null,
    checker: DerivationLineChecker | null,
    line: DerivationLine | null = checker == null ? null : checker.line,
  ): Promise<void> {
    return this.showDialog(this.messageDialog(id, params, props, checker, line));
  }

  /** A message window with a text of its own (MessageDialog.showMessage(title, text)). */
  showPlainMessage(title: string, text: string): Promise<void> {
    return this.showDialog(new QueryDialog('message', title, [{ type: 'text', text }], ['OK']));
  }

  createChecker(line: DerivationLine, interactive: boolean): DerivationLineChecker {
    return new DerivationLineChecker(line, interactive);
  }

  isRestating(): boolean {
    return this.workspace.restating;
  }

  setPhase(i: number): number {
    const j = this.phase;
    this.phase = i;
    return j;
  }

  abort(flag: boolean): void {
    this.abortedFlag = flag;
  }

  aborted(): boolean {
    return this.abortedFlag;
  }

  // ---- the problem ----

  newProblem(): void {
    if (this.workspace.newProblem == null) {
      this.loadProblem(null);
      this.workspace.newProblem = this.saveProblem();
    }
    this.loadProblem(this.workspace.newProblem);
  }

  reset(): void {
    if (this.focus != null) this.focus.line.suppressEditorFocusLoss();
    this.titleState.title = null;
    this.titleState.statement = null;
    this.titleState.note = null;
    this.titleState.status = null;
    this.problem = new DerivationBox(this, null);
    this.lastUserProblem = null;
    this.focus = null;
    this.lastFocus = null;
    this.pendingFocus = null;
    this.focusLostPending = false;
    this.commandMode = true;
    this.queuedMode = true;
    this.chapter = null;
    this.serialMode = false;
    this.proofMissing = false;
    this.disabledRules = null;
    this.manualRules = null;
    this.disabledRange = null;
    this.manualRange = null;
    this.premises = null;
    this.conclusion = null;
    this.problemIndex = -1;
    this.problemTitle = null;
    this.probOptions = null;
    this.phase = 0;
    this.errorCount = 0;
    this.workTime = 0;
    this.loadTime = 0;
    this.abortedFlag = false;
    this.doShowLog = false;
    this.resetVarNames();
  }

  resetVarNames(): void {
    this.varNames = null;
    this.problem.resetVariables();
  }

  /** The problem's record if it differs from the saved one (ignoring the work time), else null. */
  getChangedProblem(): string | null {
    const s = this.saveProblem();
    const saved = this.problemIndex === -1 ? this.workspace.newProblem : this.workspace.problems.getRecordAt(this.problemIndex);
    return TaggedRecord.stripTimestamp(s) === TaggedRecord.stripTimestamp(saved ?? '') ? null : s;
  }

  /** LPDerivation.saveProblem: the derivation as a work record. */
  saveProblem(): string {
    if (this.focus != null && this.focus === this.focus.line.annotationEditor) this.focus.line.resolveRelativeReferences();
    let s = this.saveTitle() + this.problem.encodeWork();
    if (this.errorCount !== 0) s += this.errorCount + '`e';
    if (this.updateWorkTime() !== 0) s += this.workTime + '`t';
    return TaggedRecord.toLine(s);
  }

  /** The error messages of the lines, as `m` fields (sent with a submission). */
  saveMessages(): string {
    return this.problem.encodeMessages();
  }

  saveTitle(): string {
    return TaggedRecord.formatField(this.problemTitle, '$');
  }

  trimTitle(s: string | null): string | null {
    if (s == null) return null;
    return this.workspace.isExercise(s) ? stripNamePrefix(s) : javaTrim(s);
  }

  /** LPDerivation.loadProblem: rebuilds the derivation from a work record. */
  loadProblem(record: TaggedRecord | string | null): void {
    const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
    this.reset();
    let i = 0;
    let box: DerivationBox | null = this.problem;
    let line: DerivationLine | null = null;
    this.loadExerciseInfo(t);
    const n = t.getFieldCount();
    for (let k = 0; k < n; k++) {
      const c = t.tagAt(k);
      const s = t.valueAt(k)!;
      if ((c === '-' || c === '+') && box != null) {
        if (line == null) {
          this.titleState.statement = translateSymbols(s, maggie, symbols);
        } else {
          i++;
          box = box.insertBox(-1);
          if (c === '+') box.setExpanded(false);
        }
        line = box.showLine;
        line.setLineNumber(i);
        line.setFormulaText(s);
        line.parseFormula();
      } else if (c === '<' && box != null) {
        i++;
        line = box.insertLine(-1);
        line.setLineNumber(i);
        line.setFormulaText(s);
        line.parseFormula();
      } else if (c === '>' && box != null) {
        line!.setAnnotationText(translateSymbols(s, rob, symbols));
        line!.parseReferences(false);
      } else if (c === '#' && box != null) {
        i++;
        line = box.insertLine(-1);
        line.setLineNumber(i);
        line.setAnnotationText(translateSymbols(s, rob, symbols));
        line.parseReferences(false);
        line.setCanceledOnLoad();
        box = box.parentBox;
      } else if (c === '=' && box != null) {
        box = box.parentBox;
      } else if (c === ':' && box != null) {
        if (line!.justifications == null) line!.justifications = [];
        line!.justifications.push(decodeJustification(s, this));
      } else if (c === '$') {
        this.setProblemTitle(s);
      } else if (c === 's') {
        if (line!.commandLog != null) line!.commandLog.text = translateSymbols(s, rob, symbols);
      } else if (c === 'e') {
        this.errorCount = parseJavaInt(s) ?? 0;
      } else if (c === 't') {
        this.workTime = parseJavaLong(s) ?? 0;
      } else if (c === 'm' && !this.isRestating()) {
        const i1 = s.indexOf(':');
        if (i1 !== -1) {
          const l = parseJavaInt(javaTrim(s.substring(0, i1)));
          if (l != null && l >= 0) {
            const node = l === 0 ? this.problem : this.problem.findLine(l);
            if (node != null) node.setMessageText(s.substring(i1 + 1), true);
          }
        }
      }
    }
    this.updateWorkTime();
  }

  /** Adds the seconds since the last update to the work time. */
  updateWorkTime(): number {
    const i = Math.trunc((this.workspace.clock() + 500) / 1000);
    if (this.loadTime !== 0) this.workTime += i - this.loadTime;
    this.loadTime = i;
    return this.workTime;
  }

  /**
   * loadUserProblem: a problem the user typed ("P . Q .: R"); errors are shown (dererr082
   * unparsable, dererr083 no premises or no conclusion). Returns whether it was loaded.
   */
  async loadUserProblem(s: string): Promise<boolean> {
    const parser = new ArgumentParser(s, true);
    const unparsed = parser.getUnparsedText();
    if (unparsed != null) {
      await this.showMessageWindow('dererr082', Message.params('expression', translateSymbols(unparsed, maggie, symbols)));
      return false;
    }
    if (!parser.conclusionOnly && parser.getErrorCode() === 0) {
      this.loadProblem(TaggedRecord.toLine(TaggedRecord.formatField(ArgumentParser.normalizeDots(s), '-') + TaggedRecord.formatField('', '=')));
      return true;
    }
    await this.showMessageWindow('dererr083', null);
    return false;
  }

  /** MessageDialog.showMessage(DerivationMessage.get(id), params): substitutes only the given params. */
  showMessageWindow(id: string, params: MessageParams | null): Promise<void> {
    const message = getDerivationMessage(id);
    const text = params == null ? message.text : Message.substitute(message.text, params);
    const d = new QueryDialog('message', message.id, [{ type: 'text', text }], ['OK']);
    d.messageId = message.id;
    d.isError = message.isError;
    return this.showDialog(d);
  }

  setProblemTitle(s: string | null): void {
    if (s != null && (s = javaTrim(s)) !== '') {
      this.problemTitle = s;
      const shown = this.trimTitle(this.problemTitle);
      this.problem.showLine.showLabel = shown + ': ';
      this.titleState.title = shown;
    } else {
      this.problemTitle = null;
      this.problem.showLine.showLabel = 'Problem: ';
      this.titleState.title = null;
    }
  }

  // ---- rules ----

  /** Whether the problem allows a box rule (null) or why not (dererr041 disabled, 040 manual, 016 unproven). */
  checkDerivationRule(name: string, interactive: boolean): ErrorRef | null {
    const rule = this.config.derivationRules.getRule(name);
    if (rule == null) return null;
    if (this.hasProperty(rule, 'disabled')) return new ErrorRef('dererr041');
    if (interactive && this.hasProperty(rule, 'manual')) return new ErrorRef('dererr040');
    return rule.isProven(this) ? null : new ErrorRef('dererr016');
  }

  getRule(name: string): Rule | null {
    return this.workspace.getRule(name);
  }

  /** The rules of the table the problem allows (enabled, some form proven). */
  enabledRules(table: RuleTable): string[] {
    return table.ruleNames.filter((s) => {
      const rule = table.getRule(s)!;
      return !rule.testProperty(this, 'disabled', false) && rule.isAnyFormProven(this);
    });
  }

  enabledTheorems(table: TheoremTable): IntervalSet {
    const set = new IntervalSet();
    for (const n of table.numbers()) {
      const theorem = table.getTheorem(n)!;
      if (!theorem.testProperty(this, 'disabled', false) && theorem.isAnyFormProven(this)) set.union(IntervalSet.singleton(theorem.number));
    }
    return set;
  }

  hasProperty(rule: Rule, prop: string): boolean {
    const s1 = rule instanceof UserRule ? 'UR' : rule.name;
    switch (prop) {
      case 'disabled':
        return (this.disabledRules != null && this.disabledRules.includes(s1)) || this.isWeaklyDisabled(rule);
      case 'manual':
        return this.manualRules != null && this.manualRules.includes(s1);
      case 'manualOrDisabled':
        return (this.manualRules != null && this.manualRules.includes(s1)) || this.hasProperty(rule, 'disabled');
      case 'weakAss':
        return this.weakAssRules != null && this.weakAssRules.includes(s1);
      case 'assumed':
        return this.assumedRules != null && this.assumedRules.includes(s1);
      default:
        throw new Error('IllegalArgumentException: unknown property: ' + prop);
    }
  }

  hasTheoremProperty(n: number, prop: string): boolean {
    switch (prop) {
      case 'disabled':
        return (this.disabledRange != null && this.disabledRange.contains(n)) || this.isWeaklyDisabledTheorem(n);
      case 'manual':
        return this.manualRange != null && this.manualRange.contains(n);
      case 'manualOrDisabled':
        return (this.manualRange != null && this.manualRange.contains(n)) || this.hasTheoremProperty(n, 'disabled');
      case 'weakAss':
        return this.weakAssRange != null && this.weakAssRange.contains(n);
      case 'assumed':
        return this.assumedRange != null && this.assumedRange.contains(n);
      default:
        throw new Error('IllegalArgumentException: unknown property: ' + prop);
    }
  }

  getProofs(rule: SchematicRule): string[] | null {
    if (rule instanceof UserRule) return rule.getSourceProblems();
    const index = this.config.exercises.ruleProofIndex;
    return index != null && !rule.testProperty(this, 'assumed', false) ? (index.forms.get(rule.name) ?? null) : null;
  }

  getTheoremProofs(n: number): string[] | null {
    const index = this.config.exercises.ruleProofIndex;
    return index != null && !this.hasTheoremProperty(n, 'assumed') ? (index.theorems.get(n) ?? null) : null;
  }

  /** A weakAss rule is disabled in the problems that prove it. */
  isWeaklyDisabled(rule: Rule): boolean {
    if (this.problemTitle != null && this.hasProperty(rule, 'weakAss')) {
      const proofs = rule instanceof SchematicRule ? this.getProofs(rule) : null;
      return proofs != null && proofs.includes(this.problemTitle);
    }
    return false;
  }

  isWeaklyDisabledTheorem(n: number): boolean {
    let proofs: string[] | null;
    return this.problemTitle != null && this.hasTheoremProperty(n, 'weakAss') && (proofs = this.getTheoremProofs(n)) != null
      ? proofs.includes(this.problemTitle)
      : false;
  }

  excludedProof(): string | null {
    return this.problemTitle;
  }

  checkProof(problem: string): boolean {
    const entry = this.workspace.problems.getEntry(problem);
    return entry != null && entry.state === STATE_CORRECT;
  }

  // ---- the problem's options ----

  /** loadExerciseInfo: the options of the exercise of the record's name. */
  loadExerciseInfo(record: TaggedRecord): void {
    const config = this.config;
    const t = new TaggedRecord(config.exercises.getRecord(record.getName()));
    const s = t.getName();
    this.probOptions = t.getKeyValues('%');
    this.dontChange = this.probOptions.has('eg');
    this.titleState.note = t.valueAt(t.indexOfTag('!'));
    const matches = (name: Parameters<typeof config.selector>[0]) => selectorMatches(config.selector(name), s);
    this.commandMode = !matches('noCommand');
    this.queuedMode = !matches('noQueue');
    this.checkDisabled = matches(this.forPrint ? 'noPrintCheck' : 'noCheck');
    this.errorMessagesDisabled = matches(this.forPrint ? 'noPrintErr' : 'noErrMess');
    this.mixedModeDisabled = matches('noMixedMode');
    this.doShowLog = matches('logShowCmd');
    this.chapter = matches('chap1') ? 1 : matches('chap2') ? 2 : null;
    this.disabledRules = [];
    this.manualRules = [];
    this.weakAssRules = [];
    this.assumedRules = [];
    this.disabledRange = new IntervalSet();
    this.manualRange = new IntervalSet();
    this.weakAssRange = new IntervalSet();
    this.assumedRange = new IntervalSet();
    for (const x of config.disabledRuleXRefs) x.applyTo(s, this.disabledRules, this.disabledRange);
    for (const x of config.manualRuleXRefs) x.applyTo(s, this.manualRules, this.manualRange);
    for (const x of config.weakAssRuleXRefs) x.applyTo(s, this.weakAssRules, this.weakAssRange);
    for (const x of config.assumedRuleXRefs) x.applyTo(s, this.assumedRules, this.assumedRange);
  }

  // ---- checking ----

  /** getProblemState: the state Check gives the record's work. */
  async getProblemState(record: TaggedRecord): Promise<number> {
    if (!hasWork(record)) return 0;
    this.loadProblem(record);
    if (await this.checkProblem()) return STATE_CORRECT;
    return this.proofMissing ? STATE_INCOMPLETE : STATE_INCORRECT;
  }

  /**
   * checkProblem (the Check button): checks every line in serial mode (no dialogs unless
   * answers are typed after the rule names) and the structure; the result goes on the
   * problem line (derinf005 correct, dererr057 incorrect, dererr058 incomplete, dererr056
   * aborted) and in the title.
   */
  async checkProblem(): Promise<boolean> {
    this.complete = true;
    this.abortedFlag = false;
    this.resetVarNames();
    this.serialMode = true;
    this.proofMissing = false;
    try {
      if (this.focus != null && this.focus === this.focus.line.annotationEditor) this.focus.line.resolveRelativeReferences();
      const syntax = this.problem.checkSyntax();
      const verified = await this.problem.verify();
      if (syntax && verified) {
        this.problem.showMessageInPhase('derinf005', COMP_CHECK);
        this.titleState.status = 'Correct';
        return true;
      }
      this.problem.showMessageInPhase(this.abortedFlag ? 'dererr056' : this.complete ? 'dererr057' : 'dererr058', COMP_CHECK);
      this.titleState.status = this.abortedFlag ? '' : this.complete ? 'Incorrect' : 'Incomplete';
      return false;
    } finally {
      this.serialMode = false;
    }
  }

  /** The Check button: Check unless the problem disables checking. */
  async check(): Promise<boolean> {
    if (this.checkDisabled) {
      await this.showPlainMessage('Feature Disabled', 'Checking is disabled for this problem.');
      return false;
    }
    return this.checkProblem();
  }

  /** parseProblem: the problem line's argument (dererr059 if it does not parse). */
  parseProblem(): void {
    const parser = new ArgumentParser(this.problem.getFormulaText(true), true);
    this.conclusion = parser.conclusion;
    this.premises = parser.premises;
    const unparsed = parser.getUnparsedText();
    this.problem.clearMessage();
    if (unparsed != null) {
      this.problem.showMessage('dererr059', Message.params('parser error', unparsed));
      this.problem.showLine.syntaxOk = false;
    } else {
      this.problem.showLine.syntaxOk = true;
    }
  }

  isPremise(e: Expression | null): boolean {
    if (e == null) return false;
    for (const p of this.premises!) if (e.isIdentical(p)) return true;
    return false;
  }

  getPremises(): (Expression | null)[] | null {
    return this.premises;
  }

  isConclusion(e: Expression | null): boolean {
    return e == null ? false : e.isIdentical(this.conclusion);
  }

  getMaxDepth(visibleOnly: boolean): number {
    return this.problem == null ? -1 : this.problem.getMaxBoxDepth(visibleOnly);
  }

  // ---- the lines, for the UI ----

  /** Every line in display order (visibleOnly: not inside collapsed boxes). */
  getLines(visibleOnly = false): DerivationLine[] {
    const out: DerivationLine[] = [this.problem.showLine];
    walkBody(this.problem, out, visibleOnly);
    return out;
  }
}

function walkBody(box: DerivationBox, out: DerivationLine[], visibleOnly: boolean): void {
  const nodes = box.getNodes();
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    if (node instanceof DerivationBox) {
      out.push(node.showLine);
      if (!visibleOnly || node.isExpanded()) walkBody(node, out, visibleOnly);
    } else {
      out.push(node);
    }
  }
}
