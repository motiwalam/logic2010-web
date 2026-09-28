/**
 * An open symbolization problem: the per-window part of LPSymbolizer.java, with the
 * headless parts of SymbolizationDialogs.java, SymbolizationToolbar.java and
 * SymbolizationTextPane.java (the actions the buttons, keys and dialogs trigger).
 *
 * The session owns the tree (`problem`, whose root carries the problem's metadata) and
 * the problem's state (status line, error and hint counts, time worked, options). Every
 * change is announced to subscribers (subscribe / version), so a UI can re-render with
 * useSyncExternalStore. Messages the desktop shows in dialogs arrive through `onNotice`.
 * Questions the desktop asks (a symbol, a problem name) go through `ui`.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { BinderMap } from '../../formula/BinderMap';
import { selectorMatches } from '../../program/LogicProgram';
import { Message } from '../../program/Message';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import { javaTrim } from '../../util/java';
import { ErrorMarker, HintCollector } from './MatchListeners';
import { SchemeEditor, parseScheme, type SchemeRow } from './SchemeEditor';
import { connOutTypes } from './SymbolizationConstants';
import type { NodeMessage, SymbolizationError } from './SymbolizationError';
import type { SymbolizationModule } from './SymbolizationModule';
import { SymbolizationNode, type SymbolizationHost, type SymbolizationNotice } from './SymbolizationNode';
import { getProblemState, SymbolizationEntry } from './SymbolizationProblemSet';
import { getHintCount, removeWork as removeWorkOf } from './SymbolizationRecords';
import { collapseWhitespace } from './SymbolizationText';

/** The questions the engine asks the user. */
export interface SymbolizationUi {
  /** askForSymbol: "Bound Variable:" or "Atomic Expression:" for the node; null cancels. */
  askForSymbol(prompt: string, node: SymbolizationNode): Promise<string | null>;
  /** askProblemName ("Please supply a name for this problem"), prefilled; null cancels. */
  askProblemName(initial: string): Promise<string | null>;
}

/** What a hint request produced (SymbolizationNode.showHint). */
export type HintResult =
  | { kind: 'hint'; message: NodeMessage }
  /** No hint for the node: an error button was put on the nearest mismatching ancestor. */
  | { kind: 'error'; error: SymbolizationError }
  /** Nothing (no answer, or no mismatching ancestor). */
  | { kind: 'none' };

export class LPSymbolizer implements SymbolizationHost {
  readonly data: SymbolizationModule;
  readonly forPrint: boolean;
  ui: SymbolizationUi | null;
  problem: SymbolizationNode;
  problemIndex = -1;
  errorCount = 0;
  hintCount = 0;
  workTime = 0;
  loadTime = 0;
  lastDirect = '';
  dontChange = false;
  directEntryDisabled = false;
  errorMessagesDisabled = false;
  hintsDisabled = false;
  checkDisabled = false;
  chapter: number | null = null;
  probOptions: Map<string, string> | null = null;
  /** The title panel: title (trimmed name), statement, status line, note. */
  title: string | null = null;
  statementText = '';
  status: string | null = null;
  note: string | null = null;
  /** The scheme shown beside the tree. */
  schemeRows: SchemeRow[] = [];
  /** The clock (milliseconds), for the time worked. */
  now: () => number = () => Date.now();
  onNotice: (notice: SymbolizationNotice) => void = () => {};
  private readonly listeners = new Set<() => void>();
  private versionCount = 0;
  private batch = 0;

  constructor(data: SymbolizationModule, opts: { forPrint?: boolean; ui?: SymbolizationUi | null; now?: () => number } = {}) {
    this.data = data;
    this.forPrint = opts.forPrint ?? false;
    this.ui = opts.ui ?? null;
    if (opts.now) this.now = opts.now;
    this.problem = new SymbolizationNode(this);
    if (!this.forPrint) {
      if (data.newProblem == null) {
        this.loadProblem(null);
        data.newProblem = this.saveProblem();
      } else {
        this.newProblem();
      }
    }
  }

  // ---- change notification ----

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Increases with every change (for useSyncExternalStore). */
  get version(): number {
    return this.versionCount;
  }

  treeChanged(): void {
    this.versionCount++;
    if (this.batch === 0) for (const l of this.listeners) l();
  }

  /** Runs f and announces its changes once. */
  update<T>(f: () => T): T {
    this.batch++;
    try {
      return f();
    } finally {
      this.batch--;
      this.treeChanged();
    }
  }

  notify(notice: SymbolizationNotice): void {
    this.onNotice(notice);
  }

  private message(id: string, params: Map<string, string> | null = null, global = false): void {
    this.notify({ kind: 'message', message: global ? Message.get(id) : Message.getModule(4, id), params });
  }

  private featureDisabled(text: string): void {
    this.notify({ kind: 'text', title: 'Feature Disabled', text });
  }

  /** The formula built so far (the pane above the tree). */
  get symbolization(): string {
    return this.problem.toString();
  }

  // ---- loading ----

  newProblem(): void {
    this.loadProblem(this.data.newProblem);
  }

  loadExerciseInfo(record: TaggedRecord): void {
    const exercises = this.data.exercises;
    const t = new TaggedRecord(exercises == null ? null : exercises.getRecord(record.getName()));
    const s = t.getName();
    this.probOptions = t.getKeyValues('%');
    this.dontChange = this.probOptions.has('eg');
    const sel = (name: string): boolean => selectorMatches(this.data.selector(name), s);
    this.directEntryDisabled = sel('noDirect');
    this.errorMessagesDisabled = sel(this.forPrint ? 'noPrintErr' : 'noErrMess');
    this.hintsDisabled = sel('noHints');
    this.checkDisabled = sel(this.forPrint ? 'noPrintCheck' : 'noCheck');
    this.chapter = null;
    for (let c = 1; c <= 5; c++) {
      if (sel('chap' + c)) {
        this.chapter = c;
        break;
      }
    }
  }

  /** loadProblem(record): shows a problem record (a null record: a new, empty problem). */
  loadProblem(record: string | TaggedRecord | null): void {
    const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
    this.update(() => {
      this.lastDirect = '';
      this.problemIndex = -1;
      this.loadExerciseInfo(t);
      this.problem.loadRecord(t);
      this.statementText = this.problem.statement == null ? '' : this.problem.statement;
      this.errorCount = t.getErrorCount();
      this.hintCount = getHintCount(t);
      this.workTime = t.getTimestamp();
      this.loadTime = 0;
      this.status = this.problem.countAnswers() === 0 ? 'Answer Not Available' : null;
      this.setProblemTitle(this.problem.problemName);
      this.schemeRows = parseScheme(this.problem.scheme);
      this.note = t.valueAt(t.indexOfTag('!'));
      this.updateWorkTime();
    });
  }

  setProblemTitle(s: string | null): void {
    if (s != null && (s = javaTrim(s)) !== '') {
      this.problem.problemName = s;
      this.title = this.data.trimTitle(s);
    } else {
      this.problem.problemName = null;
      this.title = null;
    }
    this.treeChanged();
  }

  updateWorkTime(): number {
    const i = Math.trunc((this.now() + 500) / 1000);
    if (this.loadTime !== 0) this.workTime += i - this.loadTime;
    this.loadTime = i;
    return this.workTime;
  }

  loadUserProblem(s: string): void {
    this.loadProblem(TaggedRecord.toLine(TaggedRecord.formatField(s, '-')));
  }

  /** removeWork(): back to the unanalysed statement. */
  removeWork(): void {
    this.update(() => {
      this.problem.setConnective(0, null, false);
      this.problem.setEnglishText(this.problem.statement);
    });
  }

  // ---- saving ----

  /** saveProblem: the problem as a record line (with error and hint counts and time worked). */
  saveProblem(): string {
    let s = this.problem.toRecord(true);
    if (this.errorCount !== 0) s += this.errorCount + '`e';
    if (this.hintCount !== 0) s += this.hintCount + '`h';
    if (this.updateWorkTime() !== 0) s += this.workTime + '`t';
    return TaggedRecord.toLine(s);
  }

  /** The problem's record if it differs from the saved one (apart from the time), else null. */
  getChangedProblem(): string | null {
    const s = this.saveProblem();
    const s1 = this.problemIndex === -1 ? this.data.newProblem : this.data.problems!.getRecordAt(this.problemIndex);
    return TaggedRecord.stripTimestamp(s) === TaggedRecord.stripTimestamp(s1 ?? '') ? null : s;
  }

  /** LPSymbolizer.saveProblems(int): re-evaluates the problem's entry and writes the files. */
  saveProblemsAt(i: number): boolean {
    if (i !== -1) {
      const entry = this.data.problems!.getEntryAt(i) as SymbolizationEntry;
      getProblemState(entry.name, this.data.problems!, entry);
    }
    return this.data.saveProblems();
  }

  /** saveProblems(String): saves the record (as a renamed copy for a worked example). */
  async saveProblems(s: string | null): Promise<boolean> {
    return this.dontChange ? this.saveRenamed(s) : this.saveProblemsAs(s, false);
  }

  /** The Save button: saves the problem, if changed (else re-evaluates and writes it). */
  async save(): Promise<boolean> {
    const s = this.getChangedProblem();
    if (s == null) return this.saveProblemsAt(this.problemIndex);
    return this.saveProblems(s);
  }

  /** Right-click on Save: saves under a new name. */
  async saveAs(): Promise<boolean> {
    return this.saveRenamed(this.saveProblem());
  }

  async saveRenamed(s: string | null): Promise<boolean> {
    if (s == null) return true;
    const name = this.problem.problemName;
    const original = this.problem.originalName;
    const index = this.problemIndex;
    if (original == null) {
      this.problem.originalName = name;
      s = this.saveProblem();
    }
    this.problemIndex = -1;
    if (!(await this.saveProblemsAs(s, true))) {
      this.problemIndex = index;
      this.problem.originalName = original;
      this.setProblemTitle(name);
      return false;
    }
    return true;
  }

  async saveProblemsAs(s: string | null, renamed: boolean): Promise<boolean> {
    if (s == null) return true;
    const problems = this.data.problems!;
    let old: string | null = null;
    if (this.problemIndex === -1) {
      const name = await this.askProblemName(renamed ? this.problem.problemName : null);
      if (name == null) return false;
      this.setProblemTitle(name);
      const entry = new SymbolizationEntry(TaggedRecord.withName(s, name), problems, false);
      const i = problems.registerEntry(entry, false);
      this.problemIndex = i === -1 ? problems.size() : i + 1;
      problems.insertElementAt(entry, this.problemIndex);
    } else {
      old = problems.getRecordAt(this.problemIndex);
      problems.replaceProblem(s, this.problemIndex);
    }
    if (!this.saveProblemsAt(this.problemIndex)) {
      if (old == null) {
        problems.removeProblem(this.problemIndex);
        this.problemIndex = -1;
      } else {
        problems.replaceProblem(old, this.problemIndex);
      }
      return false;
    }
    this.treeChanged();
    return true;
  }

  /** SymbolizationDialogs.askProblemName, with its checks (not006, not007). */
  async askProblemName(initial: string | null): Promise<string | null> {
    if (this.ui == null) return null;
    let s = await this.ui.askProblemName(initial ?? 'User');
    if (s == null) return null;
    if ((s = javaTrim(s)) === '') {
      this.message('not006', null, true);
      return null;
    }
    if (this.data.problems!.getRecord(s) != null) {
      this.message('not007', Message.params('problem name', s), true);
      return null;
    }
    return s;
  }

  // ---- choosing problems ----

  /** Opens problem i of the work (after the caller confirmed saving changes). */
  selectProblem(i: number, eraseWork = false): boolean {
    const problems = this.data.problems!;
    const record = problems.getRecordAt(i);
    if (record == null) return false;
    this.loadProblem(record);
    this.problemIndex = i;
    problems.replaceProblem(this.saveProblem(), i);
    if (eraseWork) this.removeWork();
    this.treeChanged();
    return true;
  }

  /** Select Next: opens the next problem; false when there is none (the desktop then shows the list). */
  selectNextProblem(eraseWork = false): boolean {
    const i = this.problemIndex + 1;
    if (i === 0 || this.data.problems!.getRecordAt(i) == null) return false;
    return this.selectProblem(i, eraseWork);
  }

  // ---- editing the tree ----

  /**
   * The keyboard's applyConnective: refuses (beeps: returns 'beep') a kind whose type does
   * not fit the node's slot; otherwise sets it, asking for a symbol if needed. Returns the
   * node to focus next (or null).
   */
  async applyConnective(node: SymbolizationNode, kind: number): Promise<SymbolizationNode | null | 'beep'> {
    const parent = node.getParentNode();
    const j = parent == null ? -1 : parent.indexOfChildNode(node);
    const k = parent == null ? 2 : parent.argTypes[j];
    const l = connOutTypes[kind];
    if (k !== 2 && l !== 2 && l !== k) return 'beep';
    return this.setConnective(node, kind, null);
  }

  /** setConnective with the user answering the desktop's symbol question through ui. */
  async setConnective(node: SymbolizationNode, kind: number, label: string | null, showErrors = true): Promise<SymbolizationNode | null> {
    const answer = await this.askIfNeeded(node, kind, label);
    return node.setConnective(kind, label, showErrors, () => answer);
  }

  async askIfNeeded(node: SymbolizationNode, kind: number, label: string | null): Promise<string | null> {
    const prompt = node.symbolPrompt(kind, label);
    return prompt == null || this.ui == null ? null : this.ui.askForSymbol(prompt, node);
  }

  // ---- checking ----

  /** The Check button (with its "Feature Disabled" message). Returns the status. */
  check(): string | null {
    if (this.checkDisabled) {
      this.featureDisabled('Checking is disabled for this problem.');
      return this.status;
    }
    this.checkProblem();
    return this.status;
  }

  checkProblem(): void {
    this.update(() => {
      const p = this.problem;
      p.clearErrors();
      if (p.countAnswers() === 0) return;
      let i: number;
      if (p.isIncomplete()) {
        this.status = 'Incomplete';
      } else if ((i = p.findMatchingAnswer()) !== -1) {
        const j = p.findDuplicateSolution(i, this.data.problems);
        this.status = j !== -1 ? 'Duplicate of\n' + SymbolizationNode.getAnswerSetName(j, p.answerGroup) : 'Correct';
      } else if ((i = p.findEquivalentAnswer()) !== -1) {
        const k = p.findDuplicateSolution(i, this.data.problems);
        if (k !== -1) this.status = 'Duplicate of\n' + SymbolizationNode.getAnswerSetName(k, p.answerGroup);
        else this.status = this.data.equivalentCounts(p.problemName) ? 'Correct Equivalent' : 'Equivalent, but Incorrect';
      } else {
        const closest = p.findClosestAnswer();
        const marker = new ErrorMarker();
        p.matchTree(closest!, marker);
        this.status = marker.quantifierUnrestricted ? 'Incorrect: Quantifier Unrestricted' : 'Incorrect';
      }
    });
  }

  /** The error buttons of the tree, by node (pre-order). */
  errors(): { node: SymbolizationNode; errors: SymbolizationError[] }[] {
    return this.problem
      .preorder()
      .filter((n) => (n.panel?.buttons.length ?? 0) > 0)
      .map((n) => ({ node: n, errors: [...n.panel!.buttons] }));
  }

  /**
   * Clicking an error button: its message (null when hints are disabled: a "Feature
   * Disabled" message is shown instead).
   */
  openError(error: SymbolizationError): NodeMessage | null {
    if (this.hintsDisabled) {
      this.featureDisabled('Hints are disabled for this problem.');
      return null;
    }
    return error.buildMessage();
  }

  /** Whether hints are offered (Ctrl+Shift+? beeps otherwise; the menu leaves Hint out). */
  canHint(): boolean {
    return !this.hintsDisabled;
  }

  /** showHint (Ctrl+Shift+? or the menu's Hint) for a node. */
  showHint(node: SymbolizationNode): HintResult {
    return this.update((): HintResult => {
      const root = this.problem;
      const closest = root.findClosestAnswer();
      if (closest == null) return { kind: 'none' };
      root.clearErrors();
      const collector = new HintCollector(node);
      root.matchTree(closest, [], [], collector);
      const hint = collector.getHint();
      if (hint != null) {
        const message = hint.buildMessage();
        this.hintCount++;
        return { kind: 'hint', message };
      }
      const errors = collector.getErrors();
      let found: SymbolizationError | null = null;
      let n: SymbolizationNode | null = node;
      while (found == null && (n = n.getParentNode()) != null) {
        for (const e of errors) {
          if (e.target === n) {
            found = e;
            break;
          }
        }
      }
      if (found != null) {
        const panel = found.target.getConnectivePanel();
        if (panel != null) {
          panel.addButton(found, false);
          this.errorCount++;
          return { kind: 'error', error: found };
        }
      }
      return { kind: 'none' };
    });
  }

  // ---- direct entry ----

  /** The text the Direct dialog starts with (the last direct entry, in display symbols). */
  directEntryText(): string {
    return translateSymbols(this.lastDirect, maggie, symbols);
  }

  /** Whether direct entry is available (else shows "Feature Disabled"). */
  canEnterDirectly(): boolean {
    if (this.directEntryDisabled) {
      this.featureDisabled('Direct entry is disabled for this problem.');
      return false;
    }
    return true;
  }

  /** enterDirectSymbolization's OK: builds the tree from the typed formula (display symbols). */
  enterDirectSymbolization(typed: string): void {
    if (!this.canEnterDirectly()) return;
    this.update(() => {
      this.lastDirect = translateSymbols(typed, symbols, maggie);
      this.problem.buildFromText(this.lastDirect);
      if (this.checkDisabled || this.errorMessagesDisabled) return;
      const closest = this.problem.findClosestAnswer();
      if (closest == null) return;
      const e = closest.toExpression();
      const e1 = this.problem.toExpression();
      if (e1 == null || e == null || e1.isAlphaEquivalent(e, new BinderMap())) this.problem.copyTextFrom(this.problem.findClosestAnswer());
    });
  }

  // ---- deleting ----

  /**
   * What the Delete button offers: for an exercise, deleting the work (if any); for another
   * problem, the work and/or the problem. confirm: whether the desktop asks before a lone
   * choice.
   */
  deleteChoices(): { choices: ('work' | 'problem')[]; confirm: boolean } {
    if (this.data.isExercise(this.problem.problemName)) {
      return this.problem.isModified() ? { choices: ['work'], confirm: true } : { choices: [], confirm: false };
    }
    if (this.problem.isModified()) return { choices: ['work', 'problem'], confirm: true };
    const confirm = this.problemIndex !== -1 || this.problem.getEnglishText() !== collapseWhitespace('');
    return { choices: ['problem'], confirm };
  }

  /** Delete the work on this problem (and save that). */
  deleteWork(): void {
    this.update(() => {
      if (this.data.isExercise(this.problem.problemName)) this.removeWork();
      else this.problem.setConnective(0, null, false);
      this.saveDeletedWork();
    });
  }

  /** Delete this (non-exercise) problem. */
  deleteProblem(): void {
    this.update(() => {
      if (this.problemIndex !== -1) {
        this.data.problems!.removeProblem(this.problemIndex);
        this.data.saveProblems();
      }
      this.newProblem();
    });
  }

  saveDeletedWork(): void {
    if (this.problemIndex === -1) return;
    const entry = this.data.problems!.getEntryAt(this.problemIndex);
    if (entry != null && !this.data.isExample(new TaggedRecord(entry.name).getName())) {
      entry.name = removeWorkOf(new TaggedRecord(entry.name));
      entry.state = 0;
      // (loadProblem also forgets the problem's index, as on the desktop)
      this.loadProblem(entry.name);
      this.data.saveProblems();
    }
  }

  // ---- user problems, statement and scheme ----

  /** LogicModule.validateUserProblem: one line only (else not093). */
  validateUserProblem(s: string): boolean {
    if (!s.includes('\r') && !s.includes('\n')) return true;
    this.message('not093', null, true);
    return false;
  }

  /** The User dialog's initial text. */
  userProblemText(): string {
    return this.data.lastUserProblem;
  }

  /** The User dialog's OK: a new problem with the English; then the scheme dialog (createScheme). */
  createUserProblem(s: string): boolean {
    if (!this.validateUserProblem(s)) return false;
    this.data.lastUserProblem = s;
    this.loadUserProblem(s);
    return true;
  }

  /** The Create Scheme dialog's editor (the last user scheme, or one empty row). */
  createScheme(): SchemeEditor {
    const last = this.data.lastUserScheme;
    return new SchemeEditor(last != null && last.indexOf(':') !== -1 ? last : ':');
  }

  /** The scheme dialog's OK. */
  acceptScheme(editor: SchemeEditor): void {
    this.update(() => {
      this.data.lastUserScheme = editor.getScheme();
      this.schemeRows = parseScheme(this.data.lastUserScheme);
      this.problem.scheme = this.data.lastUserScheme;
    });
  }

  /** The scheme dialog's Browse: the scheme of problem i of the list (null if none). */
  schemeOfProblem(i: number): string | null {
    return this.data.getProblemScheme(TaggedRecord.nameOf(this.data.problems!.getRecordAt(i)));
  }

  /** Whether the problem's statement, scheme and answers may be edited (else SymNot012). */
  private canEditProblem(): boolean {
    if ((this.problem.userAnswerKey || this.problem.originalName != null) && !this.dontChange) {
      if (this.problem.originalName != null) this.copyAnswersToUserKey();
      return true;
    }
    this.message('SymNot012');
    return false;
  }

  /** Edit > Statement: the statement to edit, or null (not allowed). */
  editStatement(): string | null {
    return this.canEditProblem() ? this.problem.statement ?? '' : null;
  }

  editStatementDone(s: string): boolean {
    if (!this.validateUserProblem(s)) return false;
    this.update(() => {
      this.data.lastUserProblem = s;
      this.problem.statement = s;
      this.statementText = s;
      this.problem.setEnglishText(s);
    });
    return true;
  }

  /** Edit > Scheme: the Edit Scheme dialog's editor, or null (not allowed). */
  editScheme(): SchemeEditor | null {
    if (!this.canEditProblem()) return null;
    const s = this.problem.scheme ?? ':';
    return new SchemeEditor(s.indexOf(':') === -1 ? ':' : s);
  }

  // ---- answers of user problems ----

  addUserAnswer(record: string): void {
    const p = this.problem;
    const userKey = this.data.userKey!;
    let i = 1;
    let key: string;
    while (userKey.get((key = p.problemName + '-' + i)) != null) i++;
    const s2 = TaggedRecord.withName(record, key);
    userKey.put(key, s2);
    const escaped = DelimitedTokenizer.escape(key, '\\.')!;
    p.answerKeys = p.answerKeys != null && p.answerKeys !== '' ? p.answerKeys + '.' + escaped : escaped;
    (p.answers ??= []).push(s2);
  }

  /** copyAnswersToUserKey: detaches a copied problem from its original, taking its answers along. */
  copyAnswersToUserKey(): void {
    const p = this.problem;
    if (p.originalName == null || p.answers == null) return;
    const records = [...p.answers];
    p.answers = null;
    p.answerKeys = null;
    for (const r of records) this.addUserAnswer(r);
    p.originalName = null;
    p.userAnswerKey = true;
    this.data.writeUserKey();
    const s = this.getChangedProblem();
    if (s == null) this.saveProblemsAt(this.problemIndex);
    else void this.saveProblems(s);
  }

  /** Edit > Answers: the Answer Manager, or null (not allowed: SymNot005). */
  openAnswerManager(): AnswerManager | null {
    if (!this.problem.userAnswerKey) {
      this.message('SymNot005');
      return null;
    }
    if (this.problem.originalName != null && !this.dontChange) this.copyAnswersToUserKey();
    let spec: string;
    if (!this.problem.userAnswerKey || this.dontChange) spec = 'Use:load.OK:ok;0';
    else if (this.problem.isIncomplete()) spec = 'Add:warn.Use:load.Delete:delete.Replace:warn.Help:help.OK:ok;1';
    else spec = 'Add:add.Use:load.Delete:delete.Replace:replace.Help:help.OK:ok;1';
    return new AnswerManager(this, spec);
  }
}

/**
 * The Answer Manager (showAnswerManager / AnswerManagerHandler): the list of the problem's
 * answers and the actions on it.
 */
export class AnswerManager {
  /** The formula of each answer. */
  items: string[] = [];

  constructor(
    readonly session: LPSymbolizer,
    /** The buttons: "Label:action..." (actions add, load, delete, replace, warn, help, ok). */
    readonly buttonSpec: string,
  ) {
    const n = new SymbolizationNode(null, session.data);
    for (const r of session.problem.answers ?? []) {
      n.loadRecord(new TaggedRecord(r));
      this.items.push(n.toString());
    }
  }

  /**
   * An action: 'warn' and 'help' show SymNot006 / SymNot007; 'load' needs one selected
   * answer. Returns whether the dialog closes.
   */
  async perform(action: string, selected: number[]): Promise<boolean> {
    const s = this.session;
    switch (action.toLowerCase()) {
      case 'ok':
        return true;
      case 'add':
        return this.add();
      case 'load': {
        if (selected.length !== 1) return false;
        s.update(() => s.problem.loadRecord(new TaggedRecord(s.problem.answers![selected[0]]), false, false));
        return true;
      }
      case 'delete':
        this.deleteSelected(selected);
        return false;
      case 'replace':
        this.deleteSelected(selected);
        return this.add();
      case 'warn':
        s.notify({ kind: 'message', message: Message.getModule(4, 'symnot006'), params: null });
        return false;
      case 'help':
        s.notify({ kind: 'message', message: Message.getModule(4, 'symnot007'), params: null });
        return false;
      default:
        return false;
    }
  }

  private async add(): Promise<boolean> {
    const s = this.session;
    const p = s.problem;
    if (!(p.problemName != null || ((await s.saveProblems(s.saveProblem())) && p.problemName != null))) return false;
    const userKey = s.data.userKey!;
    let i = 1;
    let key: string;
    while (userKey.get((key = p.problemName + '-' + i)) != null) i++;
    const name = p.problemName;
    const flag = p.userAnswerKey;
    p.problemName = key;
    p.userAnswerKey = false;
    const s2 = p.toRecord(true);
    p.problemName = name;
    p.userAnswerKey = flag;
    userKey.put(key, s2);
    const escaped = DelimitedTokenizer.escape(key, '\\.')!;
    p.answerKeys = p.answerKeys != null && p.answerKeys !== '' ? p.answerKeys + '.' + escaped : escaped;
    (p.answers ??= []).push(s2);
    this.items.push(p.toString());
    this.saveChanges();
    return false;
  }

  private deleteSelected(selected: number[]): void {
    const s = this.session;
    const p = s.problem;
    for (let j = selected.length - 1; j >= 0; j--) {
      this.items.splice(selected[j], 1);
      p.answers!.splice(selected[j], 1);
    }
    const d = new DelimitedTokenizer('\\.');
    d.setInput(p.answerKeys);
    let k = 0;
    let l = 0;
    let keys: string | null = null;
    let key: string | null;
    while ((key = d.nextToken()) != null) {
      if (key === '') continue;
      if (l < selected.length && k === selected[l]) {
        s.data.userKey!.remove(key);
        l++;
      } else {
        // (the remaining keys are joined without re-escaping, as on the desktop)
        keys = keys == null ? key : keys + '.' + key;
      }
      k++;
    }
    p.answerKeys = keys;
    this.saveChanges();
  }

  private saveChanges(): void {
    const s = this.session;
    s.data.writeUserKey();
    const changed = s.getChangedProblem();
    if (changed == null) s.saveProblemsAt(s.problemIndex);
    else void s.saveProblems(changed);
    s.update(() => {
      s.status = s.problem.countAnswers() === 0 ? 'Answer Not Available' : null;
    });
  }
}
