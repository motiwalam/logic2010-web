/**
 * Port of LPTruthAnalysis.java (the Truth Tables module, module index 5), with the model
 * parts of TruthToolbar.java and the print pages (TruthResultsPage, TruthStatementsPage,
 * TruthProblemsPage).
 *
 * - Program-wide configuration (the module's message catalogue and its section of the
 *   options) is loaded once with loadTruthModule().
 * - TruthWorkspace holds a student's problem sets (the desktop's static exercises/problems).
 * - LPTruthAnalysis is one open problem (a desktop module window), a model a view drives and
 *   subscribes to (ChangeNotifier).
 *
 * Problem states (the problem list, submissions) are computed by getProblemState(record) as
 * on the desktop: with a fresh module whose options are those of a new, unnamed problem.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { findExtraProblems, readExercises, readWork, verifyDigest, writeProblems, type DigestCheck, type WorkFile, type WrittenWork } from '../../problems/LogicModule';
import { STATE_CODES } from '../../problems/ProblemEntry';
import { selectorMatches, stripNamePrefix } from '../../program/LogicProgram';
import { ErrorRef, Message, type MessageParams } from '../../program/Message';
import type { ModuleOptions } from '../../program/moduleOptions';
import { truModule } from '../../program/ModuleConstants';
import type { ProblemSelector } from '../../program/ProblemSelector';
import { loadModuleMessages, readModuleOptions } from '../../program/loadProgram';
import { expandEscapes, maggie, symbols, translateSymbols } from '../../program/symbols';
import type { UserInfo } from '../../program/UserInfo';
import { ArgumentParser } from '../../rules/ArgumentParser';
import { javaTrim } from '../../util/java';
import { ChangeNotifier } from './ChangeNotifier';
import type { ModuleMessage } from './ModuleUi';
import { validateUserProblem } from './ModuleDialogs';
import { assumeTautology, TruthProblemPanel } from './TruthProblemPanel';
import { TruthProblemSet } from './TruthProblemSet';
import { rowAssignmentString, checkRowComplete, checkRowError, checkRowValid } from './TruthTableGrid';

export { assumeTautology } from './TruthProblemPanel';

export const workFileName = 'truwork.txt';
export const moduleIndex = truModule;

// ---- program-wide configuration ----

let options: ModuleOptions | null = null;

/** Loads the module's message catalogue and options (TruthMessage.loadMessages, readOptions). */
export async function loadTruthModule(): Promise<void> {
  await loadModuleMessages(truModule);
  options = await readModuleOptions(truModule);
}

/** The module's options (null before loadTruthModule). */
export function getTruthOptions(): ModuleOptions | null {
  return options;
}

/** Replaces the options (tests). */
export function setTruthOptions(o: ModuleOptions | null): void {
  options = o;
}

/** One of the module's selector options (doAllRows, doSetUp, noCheck, ...). */
export function selector(name: string): ProblemSelector | null {
  return options == null ? null : options.selector(name);
}

/** A flag option (noUser, submitExam, printIncorrect). */
export function flag(name: string): boolean {
  return options != null && options.hasFlag(name);
}

/** TruthMessage.get: the module message with the id. */
export function truthMessage(id: string): Message {
  return Message.getModule(truModule, id);
}

const noError = (params: MessageParams | null) => new ErrorRef(null as unknown as string, params);

// ---- record helpers (static in LPTruthAnalysis) ----

export function hasWork(t: TaggedRecord): boolean {
  return t.indexOfAnyTag('@*#&') !== -1;
}

export function getWork(t: TaggedRecord): string {
  return t.formatFields('@*#&');
}

export function removeWork(t: TaggedRecord): string {
  return t.formatFields('$=%u!');
}

export function getProblemStatement(t: TaggedRecord): string | null {
  return t.valueAt(t.indexOfAnyTag('='));
}

/** LPTruthAnalysis.getProblemState(String): 0 no work, 1 incorrect, 2 correct. */
export function getProblemState(record: string): number {
  const t = new TaggedRecord(record);
  return !hasWork(t) ? 0 : new LPTruthAnalysis(null).getProblemState(t);
}

// ---- the student's problem sets ----

export interface StatementItem {
  name: string | null;
  /** The printed line (LogicProgram.expandEscapes of "\l<name>: <statement>"). */
  text: string;
}

export interface PrintItem {
  index: number;
  /** The state code shown in the status column ("C", "I", "N", ...; " " when checking is disabled). */
  status: string;
  /** "<name>: <statement>" in display symbols. */
  title: string;
  /** For full pages: the problem loaded for printing (its table and trees). */
  analysis: LPTruthAnalysis | null;
  /** "No Row Checked" or "Row Checked: TFT" (full pages). */
  rowChecked: string | null;
}

/** The desktop's static LPTruthAnalysis.exercises / problems / newProblem, per student. */
export class TruthWorkspace {
  exercises: TruthProblemSet = new TruthProblemSet();
  problems: TruthProblemSet = new TruthProblemSet();
  /** The record of an empty new problem (LPTruthAnalysis.newProblem). */
  newProblem: string | null = null;
  /** The digest check of the work read (the desktop refuses mismatched work, not003). */
  digestCheck: DigestCheck | null = null;
  /** Stores the problems (the desktop's saveProblems writes truwork.txt); false on failure. */
  persist: (ws: TruthWorkspace) => boolean | Promise<boolean> = () => true;

  /**
   * getExercises + getProblems + mergeExercises + restateProblems: the course problems and
   * the student's work (null: none yet, start from the course problems).
   */
  static async open(work: WorkFile | null, user: UserInfo | null = null): Promise<TruthWorkspace> {
    const ws = new TruthWorkspace();
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

  /** LPTruthAnalysis.saveProblems. */
  async saveProblems(): Promise<boolean> {
    return await this.persist(this);
  }

  /** The work file (readable format) with its digest for the user. */
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

  /** The problem's name as shown (without the exercise prefix). */
  trimTitle(name: string | null): string | null {
    if (name == null) return null;
    return this.isExercise(name) ? stripNamePrefix(name) : javaTrim(name);
  }

  getExerciseIndices(): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.problems.size(); j++) if (this.isExercise(TaggedRecord.nameOf(this.problems.getRecordAt(j)))) out.push(j);
    return out;
  }

  /** getStatements: the "Print List" page. */
  getStatements(indices: readonly number[]): StatementItem[] {
    return indices.map((i) => {
      const t = new TaggedRecord(this.problems.getEntryAt(i)!.name);
      const s = t.getName();
      return { name: s, text: expandEscapes('\\l' + s + ': ' + getProblemStatement(t)) };
    });
  }

  /** getResults: the "Print Results" page (status and statement of each problem). */
  getResults(indices: readonly number[]): PrintItem[] {
    return this.getPrintProblems(indices, true);
  }

  /**
   * getPrintProblems: the full print pages (status, statement, question, table, checked row,
   * and each row's inline trees). With printIncorrect only incorrect problems are printed.
   */
  getPrintProblems(indices: readonly number[], resultsOnly = false): PrintItem[] {
    const out: PrintItem[] = [];
    for (const index of indices) {
      const entry = this.problems.getEntryAt(index)!;
      const k = entry.state;
      const t = new TaggedRecord(entry.name);
      const s = t.getName();
      if (flag('printIncorrect') && k !== 1) continue;
      const statement = translateSymbols(getProblemStatement(t), maggie, symbols);
      const analysis = new LPTruthAnalysis(this, true);
      analysis.loadProblem(entry.name);
      const title = expandEscapes(this.trimTitle(s) + ': ' + statement);
      const item: PrintItem = { index, status: analysis.checkDisabled ? ' ' : STATE_CODES[k], title, analysis: null, rowChecked: null };
      if (!resultsOnly) {
        item.analysis = analysis;
        const row = analysis.problem.table.counterexampleRow;
        item.rowChecked = row === -1 ? 'No Row Checked' : 'Row Checked: ' + rowAssignmentString(row, analysis.problem.letterCount);
      }
      out.push(item);
    }
    return out;
  }
}

// ---- one open problem ----

/** The result of the Check button: the title-bar status, and the message to show (if any). */
export interface CheckResult {
  error: ErrorRef;
  status: string;
  message: ModuleMessage | null;
}

export class LPTruthAnalysis extends ChangeNotifier {
  /** The clock (ms) for the work time; replaceable in tests. */
  static now: () => number = () => Date.now();

  readonly problem: TruthProblemPanel;
  completeAllNodes = false;
  completeAllRows = false;
  completeAllWffs = false;
  completeSetup = false;
  assumeTautology = false;
  checkDisabled = false;
  treeErrorsDisabled = false;
  tableErrorsDisabled = false;
  setupErrorsDisabled = false;
  checkMessagesDisabled = false;
  /** An example (option eg): saving asks for a new name. */
  dontChange = false;
  errorCount = 0;
  workTime = 0;
  loadTime = 0;
  lastUserProblem: string | null = null;
  probOptions: Map<string, string> | null = null;
  /** The problem's index in the workspace's problems, or -1 (a new or user problem). */
  problemIndex = -1;
  /** The title bar's status text ("Correct", "Incorrect", "Incomplete" or ""). */
  status = '';
  /** The title bar's note (the exercise's `!` field, trimmed, escapes expanded; null: none). */
  note: string | null = null;

  /** workspace: the student's problems (null: a scratch module, as for problem states). */
  constructor(
    readonly workspace: TruthWorkspace | null,
    readonly forPrint = false,
  ) {
    super();
    this.problem = new TruthProblemPanel(this);
    this.newProblem();
  }

  // ---- loading and saving ----

  /** loadExerciseInfo: the options for the problem (by its name in the course exercises). */
  loadExerciseInfo(t: TaggedRecord): void {
    const ex = this.workspace == null ? null : this.workspace.exercises.getRecord(t.getName());
    t = new TaggedRecord(ex);
    this.probOptions = t.getKeyValues('%');
    this.dontChange = this.probOptions.has('eg');
    this.assumeTautology = this.probOptions.has('taut');
    const note = t.valueAt(t.indexOfTag('!'));
    this.note = note == null ? null : expandEscapes(javaTrim(note));
    const s = t.getName();
    const p = this.forPrint;
    this.completeAllNodes = selectorMatches(selector('doAllNodes'), s);
    this.completeAllRows = selectorMatches(selector('doAllRows'), s);
    this.completeAllWffs = selectorMatches(selector('doAllWffs'), s);
    this.completeSetup = selectorMatches(selector('doSetUp'), s);
    this.checkDisabled = selectorMatches(selector(p ? 'noPrintCheck' : 'noCheck'), s);
    this.treeErrorsDisabled = selectorMatches(selector(p ? 'noPrintTreeErr' : 'noTreeErr'), s);
    this.tableErrorsDisabled = selectorMatches(selector(p ? 'noPrintTableErr' : 'noTableErr'), s);
    this.setupErrorsDisabled = selectorMatches(selector(p ? 'noPrintSetupErr' : 'noSetupErr'), s);
    this.checkMessagesDisabled = selectorMatches(selector('noCheckMess'), s);
    this.tableErrorsDisabled = this.tableErrorsDisabled || this.checkDisabled;
    this.treeErrorsDisabled = this.treeErrorsDisabled || this.tableErrorsDisabled;
  }

  /** loadProblem: shows a problem record (null: an empty new problem). */
  loadProblem(record: string | null): void {
    const t = new TaggedRecord(record);
    this.loadExerciseInfo(t);
    this.problem.loadProblem(t);
    this.errorCount = t.getErrorCount();
    this.workTime = t.getTimestamp();
    this.loadTime = 0;
    this.updateWorkTime();
    this.problemIndex = -1;
    this.notifyChanged();
  }

  /** Loads the problem at the index of the workspace's problems (chooseProblem / selectNextProblem). */
  loadProblemAt(i: number): void {
    const ws = this.workspace!;
    this.loadProblem(ws.problems.getRecordAt(i));
    this.problemIndex = i;
    ws.problems.replaceProblem(this.saveProblem(), i);
    this.notifyChanged();
  }

  newProblem(): void {
    this.loadProblem(this.workspace == null ? null : this.workspace.newProblem);
    if (this.workspace != null && this.workspace.newProblem == null) this.workspace.newProblem = this.saveProblem();
  }

  updateWorkTime(): number {
    const i = Math.floor((LPTruthAnalysis.now() + 500) / 1000);
    if (this.loadTime !== 0) this.workTime += i - this.loadTime;
    this.loadTime = i;
    return this.workTime;
  }

  /** saveProblem: the problem's record with the work, error count and work time. */
  saveProblem(): string {
    let s = this.problem.getWorkRecord();
    if (this.errorCount !== 0) s += this.errorCount + '`e';
    if (this.updateWorkTime() !== 0) s += this.workTime + '`t';
    return TaggedRecord.toLine(s);
  }

  /** getChangedProblem: the record if it differs from the saved one (work time aside), else null. */
  getChangedProblem(): string | null {
    const s = this.saveProblem();
    const ws = this.workspace;
    const saved = this.problemIndex === -1 || ws == null ? (ws == null ? null : ws.newProblem) : ws.problems.getRecordAt(this.problemIndex);
    return TaggedRecord.stripTimestamp(s) === TaggedRecord.stripTimestamp(saved ?? '') ? null : s;
  }

  /**
   * loadUserProblem: a problem typed by the student (in maggie symbols); tableOnly ("Truth
   * Table Only") adds the taut option. Returns the error to show, or null.
   */
  loadUserProblem(s: string, tableOnly: boolean): ModuleMessage | null {
    const a = new ArgumentParser(s);
    const unparsed = a.getUnparsedText();
    if (unparsed != null) return { message: truthMessage('truerr009'), params: Message.params('expression', translateSymbols(unparsed, maggie, symbols)) };
    if (a.getErrorCode() !== 0) return { message: truthMessage('truerr010'), params: null };
    let line = TaggedRecord.toLine(TaggedRecord.formatField(ArgumentParser.normalizeDots(s), '='));
    if (tableOnly) line += 'taut`%';
    this.loadProblem(line);
    return null;
  }

  /**
   * TruthDialogs.createUserProblem: the "User Problem" dialog's text (display symbols) and its
   * "Truth Table Only" box (call after confirmSaveChanges). The message to show, or null when
   * the problem was loaded. (Loading clears lastUserProblem: only a rejected text is offered
   * again, as on the desktop.)
   */
  createUserProblem(text: string, tableOnly: boolean): ModuleMessage | null {
    if (!validateUserProblem(text)) return { message: Message.get('not093'), params: null };
    this.lastUserProblem = translateSymbols(text, symbols, maggie);
    return this.loadUserProblem(this.lastUserProblem, tableOnly);
  }

  /** The text the User Problem dialog starts with. */
  userProblemDefault(): string {
    return this.lastUserProblem == null ? '' : translateSymbols(this.lastUserProblem, maggie, symbols);
  }

  getProblemName(): string | null {
    return this.problem.problemName;
  }

  hasStatement(): boolean {
    return this.problem.statement != null && this.problem.statement !== '';
  }

  /** The title (trimmed problem name) as the title bar shows it. */
  getTitle(): string | null {
    const s = this.problem.problemName;
    if (s == null || javaTrim(s) === '') return null;
    return this.workspace == null ? javaTrim(s) : this.workspace.trimTitle(s);
  }

  setProblemTitle(s: string): void {
    this.problem.problemName = s;
    this.notifyChanged();
  }

  // ---- work ----

  hasWork(): boolean {
    const p = this.problem;
    if (this.completeSetup && p.setupPanel != null && p.setupPanel.hasSetupWork()) return true;
    if (p.answer !== -1) return true;
    if (p.table.counterexampleRow !== -1) return true;
    for (let j = 0; j < p.table.rowCount; j++) if (p.table.rowHasWork(j)) return true;
    return false;
  }

  /** Delete Work (TruthProblemPanel.clearWork). */
  clearWork(): void {
    this.problem.clearWork();
    this.notifyChanged();
  }

  /** A click on a table cell: selects it (or deselects it, committing its tree). */
  clickCell(row: number, col: number): void {
    this.problem.table.clickCell(row, col);
    this.notifyChanged();
  }

  /** Selects or deselects a cell (deselecting commits its tree to the cell). */
  setCellSelected(row: number, col: number, selected: boolean): void {
    this.problem.table.setSelected(row, col, selected);
    this.notifyChanged();
  }

  /** The cell editor's OK button: commits the selected cell's tree and deselects it. */
  commitSelectedCell(): void {
    const p = this.problem.table.selectedCell;
    if (p == null) return;
    const cell = this.problem.table.cells[p.row][p.col];
    cell.commitTreeValue();
    this.problem.table.setSelected(p.row, p.col, false);
    this.notifyChanged();
  }

  /**
   * The student sets a tree node's value (index -1 "?", 0 T, 1 F; node: its preorder index).
   * The tree is checked again; a node then shown wrong adds to the error count, once for each
   * of the desktop's two linked views of the tree (so by 2).
   */
  setNodeValue(row: number, col: number, node: number, index: number): void {
    const tree = this.problem.table.cells[row][col].valueTree;
    const n = tree.nodes()[node];
    if (n == null || n.locked) return;
    const before = n.getDisplayText();
    n.selectedIndex = index;
    if (n.getDisplayText() !== before) {
      tree.checkValues();
      if (n.errorShown && !this.problem.loading) this.errorCount += 2;
    }
    this.notifyChanged();
  }

  /** The yes/no answer (-1 none, 0 yes, 1 no). */
  setAnswer(i: number): void {
    this.problem.setAnswer(i);
    this.notifyChanged();
  }

  /** Checks or unchecks a row's counterexample box. */
  setCounterexample(row: number, checked: boolean): void {
    this.problem.table.setCounterexampleChecked(row, checked);
    this.notifyChanged();
  }

  /** Setup stage: the letters and row-count fields. */
  setSetupFields(letters: string, rows: string): void {
    const s = this.problem.setupPanel;
    if (s == null) return;
    s.lettersText = letters;
    s.rowCountText = rows;
    this.notifyChanged();
  }

  /** Setup stage: a T/F chooser (index -1, 0 T, 1 F). */
  setSetupChoice(row: number, letter: number, index: number): void {
    this.problem.setupPanel?.setChoice(row, letter, index);
    this.notifyChanged();
  }

  /** Setup stage OK button; returns the message to show (none when fine or messages are disabled). */
  pressSetupOk(): ModuleMessage | null {
    const s = this.problem.setupPanel;
    if (s == null) return null;
    const e = s.pressOk();
    this.notifyChanged();
    if (e == null || e.id == null || this.checkMessagesDisabled) return null;
    return { message: truthMessage(e.id), params: e.params };
  }

  // ---- checking ----

  /** checkFull: the verdict on the work; the error id is null when correct, and params hold the summary. */
  checkFull(): ErrorRef {
    const p = this.problem;
    const grid = p.table;
    const cells = grid.cells;
    const i = grid.counterexampleRow;
    const at = (r: number) => {
      if (r < 0 || r >= cells.length) throw new RangeError('ArrayIndexOutOfBoundsException: ' + r);
      return cells[r];
    };
    if (this.completeSetup) {
      if (p.setupPanel == null) return new ErrorRef('truerr013', Message.params('summary', 'Incomplete'));
      if (!p.setupDone) {
        const e = p.setupPanel.checkAssignments();
        if (e.id != null) return e;
        return new ErrorRef('truerr014', Message.params('summary', 'Incomplete'));
      }
    }
    for (let j = 0; j < grid.rowCount; j++) if (checkRowError(cells[j])) return new ErrorRef('truerr001', Message.params('summary', 'Incorrect'));
    if (!this.assumeTautology) {
      if (p.answer === 0) {
        if (i !== -1) return new ErrorRef('truerr004', Message.params('summary', 'Incorrect'));
      } else {
        if (p.answer !== 1) return new ErrorRef('truerr003', Message.params('summary', 'Incomplete'));
        if (i === -1) return new ErrorRef('truerr006', Message.params('summary', 'Incomplete'));
      }
    }
    if (this.assumeTautology || this.completeAllRows || p.answer === 0) {
      for (let k = 0; k < grid.rowCount; k++) {
        if (!checkRowComplete(cells[k]) && (this.completeAllWffs || !checkRowValid(cells[k]))) {
          return new ErrorRef('truerr002', Message.params('summary', 'Incomplete'));
        }
      }
    }
    if (this.assumeTautology) return noError(Message.params('summary', 'Correct'));
    if (p.answer === 0) {
      for (let l = 0; l < grid.rowCount; l++) if (!checkRowValid(cells[l])) return new ErrorRef('truerr005', Message.params('summary', 'Incorrect'));
      return noError(Message.params('summary', 'Correct'));
    }
    if (!this.completeAllWffs && checkRowValid(at(i))) return new ErrorRef('truerr008', Message.params('summary', 'Incorrect'));
    if (!this.completeAllRows && !checkRowComplete(at(i))) return new ErrorRef('truerr007', Message.params('summary', 'Incomplete'));
    return this.completeAllWffs && checkRowValid(at(i))
      ? new ErrorRef('truerr008', Message.params('summary', 'Incorrect'))
      : noError(Message.params('summary', 'Correct'));
  }

  check(): boolean {
    return this.checkFull().id == null;
  }

  /**
   * The Check button (checkProblem): sets the status to the summary and returns the message to
   * show (null when correct or check messages are disabled). With checking disabled it shows
   * "Feature Disabled" instead (see isCheckDisabled).
   */
  checkProblem(): CheckResult {
    const e = this.checkFull();
    if (e.params != null) this.status = e.params.get('summary') ?? '';
    this.notifyChanged();
    return {
      error: e,
      status: this.status,
      message: e.id != null && !this.checkMessagesDisabled ? { message: truthMessage(e.id), params: e.params } : null,
    };
  }

  /** getProblemState(TaggedRecord): 0 no work, 2 correct, 1 otherwise. */
  getProblemState(t: TaggedRecord): number {
    if (!hasWork(t)) return 0;
    this.problem.loadProblem(t);
    return this.check() ? 2 : 1;
  }
}
