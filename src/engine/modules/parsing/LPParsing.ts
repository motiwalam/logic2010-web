/**
 * The Parsing module: students decide whether a string is a formula in official notation, in
 * informal notation, or not well formed, and take formulas apart by clicking main connectives.
 * Port of LPParsing.java (and the non-dialog parts of ParsingDialogs.java, ParsingToolbar.java,
 * ParsingStatementsPage.java and ParsingResultsPage.java).
 *
 * - ParsingModule holds what the desktop keeps in LPParsing's static fields: the course
 *   exercises, the student's problems (work), the options and the empty problem's record.
 *   It belongs to a workspace (one per student whose work is shown).
 * - LPParsing is one open problem (a desktop Parsing window): the ParsingProblemPanel
 *   (notation choice and parse tree), the title panel texts and the error count and time.
 *
 * Both notify their subscribers of every change (ChangeNotifier).
 */
import type { WorkFile, WrittenWork } from '../../problems/LogicModule';
import { findExtraProblems, readExercises, readWork, verifyDigest, writeProblems } from '../../problems/LogicModule';
import { ProblemEntry, STATE_CODES, STATE_INCORRECT } from '../../problems/ProblemEntry';
import { TaggedRecord } from '../../data/TaggedRecord';
import * as DataFiles from '../../data/DataFiles';
import { loadModuleMessages, readModuleOptions } from '../../program/loadProgram';
import { selectorMatches, stripNamePrefix } from '../../program/LogicProgram';
import { Message } from '../../program/Message';
import { parModule } from '../../program/ModuleConstants';
import type { ModuleOptions } from '../../program/moduleOptions';
import { ProblemSelector } from '../../program/ProblemSelector';
import { expandEscapes, maggie, symbols, translateSymbols } from '../../program/symbols';
import type { UserInfo } from '../../program/UserInfo';
import { javaTrim } from '../../util/java';
import { ChangeNotifier } from './ChangeNotifier';
import { askProblemName, type Clock, type ModuleDialogs, validateUserProblem, WorkTimer } from './moduleSupport';
import type { ParseTreeNode } from './ParseTree';
import { type ParsingCheckResult, type ParsingClickResult, ParsingProblemPanel } from './ParsingProblemPanel';
import { ParsingProblemSet } from './ParsingProblemSet';
import { getProblemStatement, removeWork, workFileName } from './parsingRecords';

/** LPParsing's option fields (the `parsing` section of options.rec), after logNeeds. */
export class ParsingOptions {
  autoCheck: ProblemSelector | null;
  addToDB: ProblemSelector | null;
  updateDB: ProblemSelector | null;
  noPrint: ProblemSelector | null;
  noCheck: ProblemSelector | null;
  noPrintCheck: ProblemSelector | null;
  monoProbs: ProblemSelector | null;
  logPrint: ProblemSelector | null;
  logSubmit: ProblemSelector | null;
  needPrint: ProblemSelector | null;
  needSubmit: ProblemSelector | null;
  mainOnly: ProblemSelector | null;
  noUser: boolean;
  submitExam: boolean;
  printIncorrect: boolean;

  constructor(o: ModuleOptions | null) {
    const sel = (name: string) => o?.selector(name) ?? null;
    this.autoCheck = sel('autoCheck');
    this.addToDB = sel('addToDB');
    this.updateDB = sel('updateDB');
    this.noPrint = sel('noPrint');
    this.noCheck = sel('noCheck');
    this.noPrintCheck = sel('noPrintCheck');
    this.monoProbs = sel('monoProbs');
    this.logPrint = sel('logPrint');
    this.logSubmit = sel('logSubmit');
    this.needPrint = sel('needPrint');
    this.needSubmit = sel('needSubmit');
    this.mainOnly = sel('mainOnly');
    this.noUser = o?.hasFlag('noUser') ?? false;
    this.submitExam = o?.hasFlag('submitExam') ?? false;
    this.printIncorrect = o?.hasFlag('printIncorrect') ?? false;
    this.logNeeds();
  }

  /** LPParsing.logNeeds: problems that must be printed or submitted are logged. */
  private logNeeds(): void {
    if (this.needPrint != null && !this.needPrint.isEmpty()) (this.logPrint ??= new ProblemSelector()).union(this.needPrint);
    if (this.needSubmit != null && !this.needSubmit.isEmpty()) (this.logSubmit ??= new ProblemSelector()).union(this.needSubmit);
  }

  static async read(): Promise<ParsingOptions> {
    return new ParsingOptions(await readModuleOptions(parModule));
  }
}

/** A problem of a printout (ParsingStatementsPage / ParsingResultsPage), as data. */
export interface ParsingPrintItem {
  index: number;
  name: string | null;
  /** "name: statement" in display symbols (LogicProgram.expandEscapes("\l" + name + ": " + statement)). */
  text: string;
  /** Results only: the state letter (N, I, C, I, U). */
  stateCode?: string;
}

export interface ParsingModuleInit {
  /** The student's work file (null: none yet; the course problems are the start). */
  work: WorkFile | null;
  user: UserInfo;
  /** Saves the work file (called by saveProblems); return false if it could not be saved. */
  persist?: (work: WrittenWork) => boolean | void;
  clock?: Clock;
}

/** The result of ParsingModule.load. */
export interface ParsingLoadResult {
  module: ParsingModule | null;
  /** A global message id for a failure (not001, not002, not003), as the desktop's file errors. */
  error: string | null;
}

export class ParsingModule extends ChangeNotifier {
  /** LPParsing.newProblem: the record of the empty problem (what "unchanged" is compared with). */
  newProblem = '';
  readonly clock: Clock;

  private constructor(
    readonly exercises: ParsingProblemSet,
    readonly problems: ParsingProblemSet,
    readonly options: ParsingOptions,
    readonly user: UserInfo,
    readonly persist: ((work: WrittenWork) => boolean | void) | null,
    clock: Clock,
  ) {
    super();
    this.clock = clock;
    this.newProblem = new LPParsing(this).saveProblem();
  }

  /**
   * LPParsing.getExercises + getProblems + the startup's mergeExercises and restateProblems.
   * Loads the module's messages, options, the course exercises, and the student's work
   * (verifying its digest). If merging changed the work, it is saved.
   */
  static async load(init: ParsingModuleInit): Promise<ParsingLoadResult> {
    await loadModuleMessages(parModule);
    const options = await ParsingOptions.read();
    const exercises = new ParsingProblemSet();
    if (!(await readExercises(exercises, workFileName))) return { module: null, error: 'not001' };
    const problems = new ParsingProblemSet();
    if (!(await readWork(problems, workFileName, init.work))) return { module: null, error: 'not001' };
    if (!verifyDigest(problems, init.user).ok) return { module: null, error: 'not003' };
    problems.exercises = exercises;
    const module = new ParsingModule(exercises, problems, options, init.user, init.persist ?? null, init.clock ?? Date.now);
    problems.newProblemNames = await findExtraProblems(workFileName, problems);
    ProblemEntry.markExtraProblems(exercises, problems.newProblemNames);
    let save = init.work != null && !DataFiles.isReadableFormat(init.work.fileName);
    if (problems.mergeExercises()) save = true;
    if (save) module.saveProblems();
    await problems.restateProblems();
    return { module, error: null };
  }

  /** A new open problem (a Parsing window), showing the empty problem. */
  open(): LPParsing {
    return new LPParsing(this);
  }

  /** LPParsing.saveProblems: writes the work file; false if it could not be saved (not004). */
  saveProblems(): boolean {
    const ok = this.persist == null ? true : this.persist(writeProblems(this.problems, workFileName, this.user)) !== false;
    this.notifyChanged();
    return ok;
  }

  /** The work file's text as it would be saved. */
  writeWork(): WrittenWork {
    return writeProblems(this.problems, workFileName, this.user);
  }

  getExerciseTitle(s: string | null): string | null {
    const r = this.exercises.getRecord(s);
    return r == null ? null : TaggedRecord.nameOf(r);
  }

  isExercise(s: string | null): boolean {
    return s != null && this.exercises.getRecord(s) != null;
  }

  isExample(s: string | null): boolean {
    return s != null && TaggedRecord.isExample(this.exercises.getRecord(s));
  }

  /** LPParsing.trimTitle: an exercise's name without its prefix. */
  trimTitle(s: string | null): string | null {
    if (s == null) return null;
    return this.isExercise(s) ? stripNamePrefix(s) : javaTrim(s);
  }

  /** LPParsing.getExerciseIndices: the problems that are course exercises. */
  getExerciseIndices(): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.problems.size(); j++) if (this.isExercise(TaggedRecord.nameOf(this.problems.getRecordAt(j)))) out.push(j);
    return out;
  }

  /** Print List (LPParsing.getStatements). */
  getStatements(indices: readonly number[]): ParsingPrintItem[] {
    return indices.map((index) => {
      const t = new TaggedRecord(this.problems.getEntryAt(index)!.name);
      const name = t.getName();
      return { index, name, text: expandEscapes('\\l' + name + ': ' + getProblemStatement(t)) };
    });
  }

  /**
   * Print Results (LPParsing.getResults): with the printIncorrect option only incorrect
   * problems are listed. (The desktop also logs printed problems selected by logPrint in
   * pardata.txt; the web version keeps no submission log.)
   */
  getResults(indices: readonly number[]): ParsingPrintItem[] {
    const out: ParsingPrintItem[] = [];
    for (const index of indices) {
      const entry = this.problems.getEntryAt(index)!;
      const t = new TaggedRecord(entry.name);
      const name = t.getName();
      if (!this.options.printIncorrect || entry.state === STATE_INCORRECT) {
        out.push({ index, name, text: expandEscapes('\\l' + name + ': ' + getProblemStatement(t)), stateCode: STATE_CODES[entry.state] });
      }
    }
    return out;
  }

  /**
   * The Delete Problems dialog's "Delete Work" (not091 confirmed): removes the work of the
   * problems (not of examples); open problems showing them are reloaded by the caller.
   */
  deleteWorkOf(indices: readonly number[]): void {
    for (let k = indices.length - 1; k >= 0; k--) {
      const entry = this.problems.getEntryAt(indices[k]);
      if (entry == null) continue;
      const t = new TaggedRecord(entry.name);
      if (!this.isExample(t.getName())) {
        entry.name = removeWork(t);
        entry.state = 0;
      }
    }
    this.saveProblems();
  }

  /** The Delete Problems dialog's "Delete Problems" (not090 confirmed): removes problems that are not exercises. */
  deleteProblems(indices: readonly number[]): void {
    for (let k = indices.length - 1; k >= 0; k--) {
      const entry = this.problems.getEntryAt(indices[k]);
      if (entry != null && !this.isExercise(new TaggedRecord(entry.name).getName())) this.problems.removeProblem(indices[k]);
    }
    this.saveProblems();
  }
}

/** One open problem: an LPParsing window with its ParsingProblemPanel. */
export class LPParsing extends ChangeNotifier {
  readonly problem: ParsingProblemPanel;
  /** Index of the problem in module.problems, or -1 (a new or user problem). */
  problemIndex = -1;
  /** For printing: the noPrintCheck selector applies instead of noCheck. */
  forPrint = false;
  checkNow = false;
  checkDisabled = false;
  dontChange = false;
  /** Main-connective-only mode (the mainOnly option, or a record with a `*` selection). */
  noDescent = false;
  probOptions: Map<string, string> | null = null;
  errorCount = 0;
  lastUserProblem: string | null = null;
  // the title panel
  title: string | null = null;
  statementText = '';
  note: string | null = null;
  status = '';
  private readonly timer: WorkTimer;

  constructor(readonly module: ParsingModule) {
    super();
    this.timer = new WorkTimer(module.clock);
    this.problem = new ParsingProblemPanel(this);
    this.loadProblem(module.newProblem);
  }

  get workTime(): number {
    return this.timer.workTime;
  }

  get loadTime(): number {
    return this.timer.loadTime;
  }

  set loadTime(t: number) {
    this.timer.loadTime = t;
  }

  trimTitle(name: string | null): string | null {
    return this.module.trimTitle(name);
  }

  // ---- loading ----

  loadExerciseInfo(record: TaggedRecord): void {
    const exercise = new TaggedRecord(this.module.exercises.getRecord(record.getName()));
    this.probOptions = exercise.getKeyValues('%');
    this.dontChange = this.probOptions.has('eg');
    this.note = exercise.valueAt(exercise.indexOfTag('!'));
    const s = exercise.getName();
    const o = this.module.options;
    this.checkNow = selectorMatches(o.autoCheck, s);
    this.checkDisabled = selectorMatches(this.forPrint ? o.noPrintCheck : o.noCheck, s);
    this.noDescent = selectorMatches(o.mainOnly, s);
    this.checkNow = this.checkNow && !this.checkDisabled;
  }

  /** Shows a problem record (work line); null: the empty problem. */
  loadProblem(line: string | null): void {
    const record = new TaggedRecord(line);
    this.loadExerciseInfo(record);
    this.problem.loadRecord(record);
    this.errorCount = record.getErrorCount();
    this.timer.workTime = record.getTimestamp();
    this.timer.update();
    this.problemIndex = -1;
    this.notifyChanged();
  }

  newProblem(): void {
    this.loadProblem(this.module.newProblem);
  }

  /** LPParsing.loadUserProblem: a formula (Maggie-talk) as a new problem. */
  loadUserProblem(s: string): void {
    this.loadProblem(TaggedRecord.toLine(TaggedRecord.formatField(s, '=')));
  }

  /**
   * The "User Problem" dialog's OK (ParsingDialogs.createUserProblem): text in display symbols.
   * Returns the global message id to show (not093: more than one line), or null.
   * (The desktop first asks to save changes: see getChangedProblem.)
   */
  createUserProblem(text: string): string | null {
    const error = validateUserProblem(text);
    if (error != null) return error;
    this.lastUserProblem = translateSymbols(text, symbols, maggie);
    this.loadUserProblem(this.lastUserProblem);
    return null;
  }

  /** The initial text of the "User Problem" dialog (the last user problem, in display symbols). */
  getUserProblemText(): string {
    return this.lastUserProblem == null ? '' : translateSymbols(this.lastUserProblem, maggie, symbols);
  }

  /** Selects problem i of the list (ParsingDialogs.selectProblem after the list's OK). */
  selectProblem(i: number): void {
    const record = this.module.problems.getRecordAt(i);
    if (record == null) return;
    this.loadProblem(record);
    this.problemIndex = i;
    this.module.problems.replaceProblem(this.saveProblem(), i);
    this.notifyChanged();
    this.module.notifyChanged();
  }

  /**
   * ParsingDialogs.selectNextProblem: the problem after this one. Returns false when there is
   * none (a new problem, or the last one): the desktop then shows the problem list.
   */
  selectNextProblem(): boolean {
    const i = this.problemIndex + 1;
    if (i === 0 || this.module.problems.getRecordAt(i) == null) return false;
    this.selectProblem(i);
    return true;
  }

  // ---- the student's actions ----

  /** A notation radio button (0 official, 1 informal, 2 not well formed). */
  selectNotation(i: number): void {
    this.problem.selectNotation(i);
    this.notifyChanged();
  }

  /** A click on character i of a node's displayed text. */
  click(node: ParseTreeNode, i: number): ParsingClickResult {
    const result = this.problem.click(node, i);
    this.notifyChanged();
    return result;
  }

  /** The Check button (LPParsing.check): the status shows the summary unless checking is disabled. */
  check(): ParsingCheckResult {
    const result = this.problem.checkProblem();
    if (!this.checkDisabled) this.status = result.summary;
    this.notifyChanged();
    return result;
  }

  /** LPParsing.removeWork: clears the notation and the tree. */
  removeWork(): void {
    this.problem.resetWork();
    this.notifyChanged();
  }

  // ---- saving ----

  /** LPParsing.saveProblem: the work record, with the error count and time. */
  saveProblem(): string {
    let s = this.problem.getWorkRecord();
    if (this.errorCount !== 0) s += this.errorCount + '`e';
    if (this.timer.update() !== 0) s += this.timer.workTime + '`t';
    return TaggedRecord.toLine(s);
  }

  /** LPParsing.getChangedProblem: the record if it differs from the saved one (ignoring time), else null. */
  getChangedProblem(): string | null {
    const s = this.saveProblem();
    const saved = this.problemIndex === -1 ? this.module.newProblem : this.module.problems.getRecordAt(this.problemIndex);
    return TaggedRecord.stripTimestamp(s) === TaggedRecord.stripTimestamp(saved ?? '') ? null : s;
  }

  setProblemTitle(s: string | null): void {
    if (s != null && (s = javaTrim(s)) !== '') {
      this.problem.problemName = s;
      this.title = this.trimTitle(s);
    } else {
      this.problem.problemName = null;
      this.title = null;
    }
  }

  /**
   * Save (LPParsing.saveRenamed / saveProblems(String)): a problem not in the list is added
   * under a name the user gives; a listed one is replaced. Examples (%eg) are saved as a copy
   * under a new name. Returns false if cancelled or not saved.
   */
  async save(ui: ModuleDialogs): Promise<boolean> {
    return this.saveRenamed(this.saveProblem(), ui);
  }

  /** "Do you wish to save the current problem?" Yes (ParsingDialogs.confirmSaveChanges). */
  async saveChanges(record: string, ui: ModuleDialogs): Promise<boolean> {
    return this.dontChange ? this.saveRenamed(record, ui) : this.saveProblems(record, false, ui);
  }

  async saveRenamed(s: string | null, ui: ModuleDialogs): Promise<boolean> {
    if (s == null) return true;
    const name = this.problem.problemName;
    const index = this.problemIndex;
    this.problemIndex = -1;
    if (!(await this.saveProblems(s, true, ui))) {
      this.problemIndex = index;
      this.setProblemTitle(name);
      this.notifyChanged();
      return false;
    }
    return true;
  }

  async saveProblems(s: string | null, rename: boolean, ui: ModuleDialogs): Promise<boolean> {
    if (s == null) return true;
    const problems = this.module.problems;
    let old: string | null = null;
    if (this.problemIndex === -1) {
      const name = await askProblemName(ui, problems, rename ? this.problem.problemName : null);
      if (name == null) return false;
      this.setProblemTitle(name);
      const entry = problems.createEntry(TaggedRecord.withName(s, name), false);
      this.problemIndex = problems.registerEntry(entry, false);
      this.problemIndex = this.problemIndex === -1 ? problems.size() : this.problemIndex + 1;
      problems.insertElementAt(entry, this.problemIndex);
    } else {
      old = problems.getRecordAt(this.problemIndex);
      problems.replaceProblem(s, this.problemIndex);
    }
    if (!this.module.saveProblems()) {
      if (old == null) {
        problems.removeProblem(this.problemIndex);
        this.problemIndex = -1;
      } else {
        problems.replaceProblem(old, this.problemIndex);
      }
      this.notifyChanged();
      return false;
    }
    this.notifyChanged();
    return true;
  }

  /**
   * "Delete the work on this problem?" OK (ParsingDialogs.deleteWork + saveDeletedWork).
   * As on the desktop, the problem is reloaded afterwards, which detaches it from the list
   * (problemIndex -1).
   */
  deleteWork(): void {
    this.removeWork();
    this.saveDeletedWork();
  }

  private saveDeletedWork(): void {
    if (this.problemIndex === -1) return;
    const entry = this.module.problems.getEntryAt(this.problemIndex);
    if (entry != null && !this.module.isExample(new TaggedRecord(entry.name).getName())) {
      entry.name = removeWork(new TaggedRecord(entry.name));
      entry.state = 0;
      this.loadProblem(entry.name);
      this.module.saveProblems();
    }
  }

  /**
   * "Delete this problem?" OK (ParsingDialogs.deleteProblemOrWork): removes the problem from
   * the list (if it is in it) and shows the empty problem.
   */
  deleteProblem(): void {
    if (this.problemIndex !== -1) {
      this.module.problems.removeProblem(this.problemIndex);
      this.module.saveProblems();
    }
    this.newProblem();
  }

  /** Which delete question the desktop asks: work or problem (a notation is chosen), problem only, or none. */
  getDeleteChoice(): 'workOrProblem' | 'problem' | 'none' {
    if (this.problem.notationIndex !== -1) return 'workOrProblem';
    const st = this.problem.statement;
    return this.problemIndex !== -1 || (st != null && st !== '') ? 'problem' : 'none';
  }

  /** A module message (parerr...), e.g. to explain a check result. */
  static message(id: string): Message {
    return Message.getModule(parModule, id);
  }
}
