/**
 * The Recognition module ("Recognizing Rules"): students name the rule that licenses an
 * argument, or "None". Port of LPRecognition.java (and the non-dialog parts of
 * RecognitionDialogs.java, RecognitionButtonPanel.java, RecognitionEntryPane.java and the
 * print jobs RecognitionListPrintJob / RecognitionResultsPrintJob / RecognitionProblemsPage).
 *
 * - RecognitionModule holds what the desktop keeps in LPRecognition's static fields: course
 *   exercises (with the answer keys), the student's problems, the options (including the
 *   rules each problem accepts, `activate-rules`) and the empty problem's record.
 * - LPRecognition is one open problem (a desktop Recognizing Rules window).
 */
import * as DataFiles from '../../data/DataFiles';
import { TaggedRecord } from '../../data/TaggedRecord';
import type { WorkFile, WrittenWork } from '../../problems/LogicModule';
import { findExtraProblems, readExercises, readWork, verifyDigest, writeProblems } from '../../problems/LogicModule';
import { ProblemEntry, STATE_CODES, STATE_CORRECT, STATE_INCORRECT, STATE_NO_WORK } from '../../problems/ProblemEntry';
import { IntervalSet } from '../../program/IntervalSet';
import { loadModuleMessages, readModuleOptions } from '../../program/loadProgram';
import { selectorMatches, stripNamePrefix } from '../../program/LogicProgram';
import { Message, type MessageParams } from '../../program/Message';
import { recModule } from '../../program/ModuleConstants';
import type { ModuleOptions } from '../../program/moduleOptions';
import { ProblemSelector } from '../../program/ProblemSelector';
import { expandEscapes, maggie, symbols, translateSymbols } from '../../program/symbols';
import type { UserInfo } from '../../program/UserInfo';
import { ArgumentParser } from '../../rules/ArgumentParser';
import { Rule } from '../../rules/Rule';
import { RuleCrossReference } from '../../rules/RuleCrossReference';
import { getRule, getTheorem } from '../../rules/RuleTable';
import { javaTrim } from '../../util/java';
import { ChangeNotifier } from '../parsing/ChangeNotifier';
import { askProblemName, type Clock, type ModuleDialogs, validateUserProblem, WorkTimer } from '../parsing/moduleSupport';
import { type RecognitionPanelHost, RecognitionProblemPanel, type RecognitionVerdict } from './RecognitionProblemPanel';
import { RecognitionProblemSet } from './RecognitionProblemSet';
import { getProblemStatement, hasWork, removeWork, workFileName } from './recognitionRecords';

/** LPRecognition's option fields (the `recognition` section of options.rec), after logNeeds. */
export class RecognitionOptions {
  noErrMess: ProblemSelector | null;
  noPrintErr: ProblemSelector | null;
  noCheck: ProblemSelector | null;
  noPrintCheck: ProblemSelector | null;
  noPrint: ProblemSelector | null;
  monoProbs: ProblemSelector | null;
  logPrint: ProblemSelector | null;
  logSubmit: ProblemSelector | null;
  needPrint: ProblemSelector | null;
  needSubmit: ProblemSelector | null;
  addToDB: ProblemSelector | null;
  updateDB: ProblemSelector | null;
  noUser: boolean;
  submitExam: boolean;
  printIncorrect: boolean;
  /** The `a` (activate-rules) fields: which rules each problem accepts. */
  activeRuleXRefs: RuleCrossReference[];

  constructor(o: ModuleOptions | null) {
    const sel = (name: string) => o?.selector(name) ?? null;
    this.noErrMess = sel('noErrMess');
    this.noPrintErr = sel('noPrintErr');
    this.noCheck = sel('noCheck');
    this.noPrintCheck = sel('noPrintCheck');
    this.noPrint = sel('noPrint');
    this.monoProbs = sel('monoProbs');
    this.logPrint = sel('logPrint');
    this.logSubmit = sel('logSubmit');
    this.needPrint = sel('needPrint');
    this.needSubmit = sel('needSubmit');
    this.addToDB = sel('addToDB');
    this.updateDB = sel('updateDB');
    this.noUser = o?.hasFlag('noUser') ?? false;
    this.submitExam = o?.hasFlag('submitExam') ?? false;
    this.printIncorrect = o?.hasFlag('printIncorrect') ?? false;
    this.activeRuleXRefs = (o?.fields ?? []).filter((f) => f.tag === 'a').map((f) => new RuleCrossReference(f.value, null, true).withPrefix(f.prefix));
    if (this.needPrint != null && !this.needPrint.isEmpty()) (this.logPrint ??= new ProblemSelector()).union(this.needPrint);
    if (this.needSubmit != null && !this.needSubmit.isEmpty()) (this.logSubmit ??= new ProblemSelector()).union(this.needSubmit);
  }

  static async read(): Promise<RecognitionOptions> {
    return new RecognitionOptions(await readModuleOptions(recModule));
  }
}

/** A problem of a printout (RecognitionProblemsPage), as data. */
export interface RecognitionPrintItem {
  index: number;
  name: string | null;
  /** "name: argument" in display symbols. */
  text: string;
  /** The state letter (N, I, C, I, U), or " " where checking is disabled (Print List and Print Results). */
  stateCode?: string;
  /** Print List only: "Answer: ..." when there is an answer and checking is not disabled. */
  answer?: string;
}

export interface RecognitionModuleInit {
  work: WorkFile | null;
  user: UserInfo;
  persist?: (work: WrittenWork) => boolean | void;
  clock?: Clock;
}

export interface RecognitionLoadResult {
  module: RecognitionModule | null;
  /** A global message id for a failure (not001, not003). */
  error: string | null;
}

export class RecognitionModule extends ChangeNotifier {
  newProblem = '';

  private constructor(
    readonly exercises: RecognitionProblemSet,
    readonly problems: RecognitionProblemSet,
    readonly options: RecognitionOptions,
    readonly user: UserInfo,
    readonly persist: ((work: WrittenWork) => boolean | void) | null,
    readonly clock: Clock,
  ) {
    super();
    problems.checker = (record) => this.getProblemState(record);
    this.newProblem = new LPRecognition(this).saveProblem();
  }

  /** LPRecognition.getExercises + getProblems + the startup's mergeExercises and restateProblems. */
  static async load(init: RecognitionModuleInit): Promise<RecognitionLoadResult> {
    await loadModuleMessages(recModule);
    const options = await RecognitionOptions.read();
    const exercises = new RecognitionProblemSet();
    if (!(await readExercises(exercises, workFileName))) return { module: null, error: 'not001' };
    const problems = new RecognitionProblemSet();
    if (!(await readWork(problems, workFileName, init.work))) return { module: null, error: 'not001' };
    if (!verifyDigest(problems, init.user).ok) return { module: null, error: 'not003' };
    problems.exercises = exercises;
    const module = new RecognitionModule(exercises, problems, options, init.user, init.persist ?? null, init.clock ?? Date.now);
    problems.savedWork = await findExtraProblems(workFileName, problems);
    ProblemEntry.markExtraProblems(exercises, problems.savedWork);
    let save = init.work != null && !DataFiles.isReadableFormat(init.work.fileName);
    if (problems.mergeExercises()) save = true;
    if (save) module.saveProblems();
    await problems.restateProblems();
    return { module, error: null };
  }

  /** A new open problem, showing the empty problem. */
  open(forPrint = false): LPRecognition {
    return new LPRecognition(this, forPrint);
  }

  /** LPRecognition.getProblemState: checks the answer of a work record. */
  getProblemState(record: TaggedRecord | string): number {
    const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
    if (!hasWork(t)) return STATE_NO_WORK;
    const w = new LPRecognition(this);
    w.loadRecord(t);
    return w.checkProblem() ? STATE_CORRECT : STATE_INCORRECT;
  }

  saveProblems(): boolean {
    const ok = this.persist == null ? true : this.persist(writeProblems(this.problems, workFileName, this.user)) !== false;
    this.notifyChanged();
    return ok;
  }

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

  trimTitle(s: string | null): string | null {
    if (s == null) return null;
    return this.isExercise(s) ? stripNamePrefix(s) : javaTrim(s);
  }

  getExerciseIndices(): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.problems.size(); j++) if (this.isExercise(TaggedRecord.nameOf(this.problems.getRecordAt(j)))) out.push(j);
    return out;
  }

  /** Print List (getPrintProblems(..., false)) and Print Results (getResults): see RecognitionPrintItem. */
  getPrintProblems(indices: readonly number[], results = false): RecognitionPrintItem[] {
    const out: RecognitionPrintItem[] = [];
    for (const index of indices) {
      const entry = this.problems.getEntryAt(index)!;
      const k = entry.state;
      const t = new TaggedRecord(entry.name);
      const name = t.getName();
      if (!this.options.printIncorrect || k === STATE_INCORRECT) {
        const statement = translateSymbols(getProblemStatement(t), maggie, symbols);
        const answer = t.valueAt(t.indexOfTag('*'));
        const w = new LPRecognition(this, true);
        w.loadProblem(entry.name);
        const item: RecognitionPrintItem = {
          index,
          name,
          text: expandEscapes('\\l' + this.trimTitle(name) + ': ' + statement),
          stateCode: w.checkDisabled ? ' ' : STATE_CODES[k],
        };
        if (!results && !w.checkDisabled && answer != null) item.answer = 'Answer: ' + answer;
        out.push(item);
      }
    }
    return out;
  }

  getResults(indices: readonly number[]): RecognitionPrintItem[] {
    return this.getPrintProblems(indices, true);
  }

  /** LPRecognition.getStatements. */
  getStatements(indices: readonly number[]): RecognitionPrintItem[] {
    return indices.map((index) => {
      const t = new TaggedRecord(this.problems.getEntryAt(index)!.name);
      const name = t.getName();
      return { index, name, text: expandEscapes('\\l' + name + ': ' + getProblemStatement(t)) };
    });
  }

  /** The Delete Problems dialog's "Delete Work" (not091 confirmed). */
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

  /** The Delete Problems dialog's "Delete Problems" (not090 confirmed): problems that are not exercises. */
  deleteProblems(indices: readonly number[]): void {
    for (let k = indices.length - 1; k >= 0; k--) {
      const entry = this.problems.getEntryAt(indices[k]);
      if (entry != null && !this.isExercise(new TaggedRecord(entry.name).getName())) this.problems.removeProblem(indices[k]);
    }
    this.saveProblems();
  }
}

/** The result of the Check button. */
export type RecognitionCheckResult =
  | ({ disabled: false } & RecognitionVerdict)
  /** Checking is disabled: the desktop says "Feature Disabled: Checking is disabled for this problem." */
  | { disabled: true };

/** A message to show (a user problem that cannot be used). */
export interface RecognitionMessageRef {
  /** The module's (recerr001, recerr002) or the global catalogue's (not093) id. */
  id: string;
  message: Message;
  params: MessageParams | null;
}

/** One open problem: an LPRecognition window with its RecognitionProblemPanel. */
export class LPRecognition extends ChangeNotifier implements RecognitionPanelHost {
  readonly problem: RecognitionProblemPanel;
  problemIndex = -1;
  dontChange = false;
  errorMessagesDisabled = false;
  checkDisabled = false;
  errorCount = 0;
  lastUserProblem: string | null = null;
  probOptions: Map<string, string> | null = null;
  /** The names of the rules the problem accepts, and the theorems (activeRange). */
  activeRules: string[] | null = null;
  activeRange: IntervalSet | null = null;
  // the title panel
  title: string | null = null;
  statementText = '';
  status = '';
  private readonly timer: WorkTimer;

  constructor(
    readonly module: RecognitionModule,
    readonly forPrint = false,
  ) {
    super();
    this.timer = new WorkTimer(module.clock);
    this.problem = new RecognitionProblemPanel(this);
    this.newProblem();
  }

  get workTime(): number {
    return this.timer.workTime;
  }

  /** LPRecognition.reset. */
  reset(): void {
    this.errorMessagesDisabled = false;
    this.checkDisabled = false;
    this.problemIndex = -1;
    this.errorCount = 0;
    this.timer.workTime = 0;
    this.timer.loadTime = 0;
    this.lastUserProblem = null;
    this.probOptions = null;
    this.activeRules = null;
    this.activeRange = null;
    this.status = '';
    this.problem.clearAnswer();
  }

  loadExerciseInfo(record: TaggedRecord): void {
    const exercise = new TaggedRecord(this.module.exercises.getRecord(record.getName()));
    let s = exercise.getName();
    const original = exercise.valueAt(exercise.indexOfTag('o'));
    if (original != null) s = original;
    this.probOptions = exercise.getKeyValues('%');
    this.dontChange = this.probOptions.has('eg');
    const o = this.module.options;
    this.errorMessagesDisabled = selectorMatches(this.forPrint ? o.noPrintErr : o.noErrMess, s);
    this.checkDisabled = selectorMatches(this.forPrint ? o.noPrintCheck : o.noCheck, s);
    this.activeRules = [];
    this.activeRange = new IntervalSet();
    for (const x of o.activeRuleXRefs) x.applyTo(s, this.activeRules, this.activeRange);
  }

  /** LPRecognition.loadProblem(TaggedRecord), without notifying. */
  loadRecord(record: TaggedRecord): void {
    this.reset();
    this.loadExerciseInfo(record);
    this.problem.loadProblem(record);
    this.errorCount = record.getErrorCount();
    this.timer.workTime = record.getTimestamp();
    this.timer.loadTime = 0;
    this.timer.update();
    this.problemIndex = -1;
  }

  /** Shows a problem record (work line); null: the empty problem. */
  loadProblem(line: string | null): void {
    this.loadRecord(new TaggedRecord(line));
    this.notifyChanged();
  }

  newProblem(): void {
    this.loadProblem(this.module.newProblem);
  }

  getExerciseRecord(name: string | null): string | null {
    return this.module.exercises.getRecord(name);
  }

  /** The rule the problem accepts: whether any of its forms is active (by name, or a theorem in range). */
  ruleActive(rule: Rule): boolean {
    for (const form of rule.getAllForms()) {
      if (this.activeRules!.includes(form.name)) return true;
      const theorem = form.sourceTheorem;
      if (theorem != null && this.activeRange!.contains(theorem.number)) return true;
    }
    return false;
  }

  /** LPRecognition.activeRules(): all the active rules and theorems as one rule (for "None"). */
  activeRulesRule(): Rule {
    const rule = new Rule('activeRules');
    for (const name of this.activeRules!) rule.addComponent(getRule(name));
    for (const n of this.activeRange!.elements()) rule.addComponent(getTheorem(n));
    return rule;
  }

  /**
   * LPRecognition.loadUserProblem: an argument "P . Q .: R" (Maggie-talk). Returns the message
   * to show if it cannot be used (recerr001: a part is not a formula; recerr002: no conclusion).
   */
  loadUserProblem(s: string): RecognitionMessageRef | null {
    const parser = new ArgumentParser(s);
    const unparsed = parser.getUnparsedText();
    if (unparsed != null) {
      const params = Message.params('expression', translateSymbols(unparsed, maggie, symbols));
      return { id: 'recerr001', message: Message.getModule(recModule, 'recerr001'), params };
    }
    if (!parser.conclusionOnly && parser.getErrorCode() === 0) {
      this.loadProblem(TaggedRecord.toLine(TaggedRecord.formatField(ArgumentParser.normalizeDots(s), '=')));
      return null;
    }
    return { id: 'recerr002', message: Message.getModule(recModule, 'recerr002'), params: null };
  }

  /**
   * The "User Problem" dialog's OK (RecognitionDialogs.enterUserProblem): text in display
   * symbols. (As on the desktop, loading the problem resets lastUserProblem, so the dialog
   * never starts with the previous argument.)
   */
  createUserProblem(text: string): RecognitionMessageRef | null {
    const error = validateUserProblem(text);
    if (error != null) return { id: error, message: Message.get(error), params: null };
    this.lastUserProblem = translateSymbols(text, symbols, maggie);
    return this.loadUserProblem(this.lastUserProblem);
  }

  getUserProblemText(): string {
    return this.lastUserProblem == null ? '' : translateSymbols(this.lastUserProblem, maggie, symbols);
  }

  selectProblem(i: number): void {
    const record = this.module.problems.getRecordAt(i);
    if (record == null) return;
    this.loadProblem(record);
    this.problemIndex = i;
    this.module.problems.replaceProblem(this.saveProblem(), i);
    this.notifyChanged();
    this.module.notifyChanged();
  }

  /** Returns false when there is no next problem (the desktop then shows the list). */
  selectNextProblem(): boolean {
    const i = this.problemIndex + 1;
    if (i === 0 || this.module.problems.getRecordAt(i) == null) return false;
    this.selectProblem(i);
    return true;
  }

  // ---- the student's actions ----

  /** The rule field's text changes. */
  setRuleText(text: string): void {
    this.problem.ruleText = text;
    this.notifyChanged();
  }

  /** LPRecognition.checkProblem: checks the answer; the status shows Correct or Incorrect. */
  checkProblem(): boolean {
    return this.checkVerdict().correct;
  }

  private checkVerdict(): RecognitionVerdict {
    const verdict = this.problem.checkAnswerVerdict();
    this.status = verdict.correct ? 'Correct' : 'Incorrect';
    return verdict;
  }

  /** The Check button or Enter in the rule field. */
  check(): RecognitionCheckResult {
    if (this.checkDisabled) return { disabled: true };
    const verdict = this.checkVerdict();
    this.notifyChanged();
    return { disabled: false, ...verdict };
  }

  removeWork(): void {
    this.status = '';
    this.problem.clearAnswer();
    this.notifyChanged();
  }

  // ---- saving ----

  saveProblem(): string {
    let s = this.problem.getWorkRecord();
    if (this.errorCount !== 0) s += this.errorCount + '`e';
    if (this.timer.update() !== 0) s += this.timer.workTime + '`t';
    return TaggedRecord.toLine(s);
  }

  getChangedProblem(): string | null {
    const s = this.saveProblem();
    const saved = this.problemIndex === -1 ? this.module.newProblem : this.module.problems.getRecordAt(this.problemIndex);
    return TaggedRecord.stripTimestamp(s) === TaggedRecord.stripTimestamp(saved ?? '') ? null : s;
  }

  /** LPRecognition.setProblemTitle. */
  setProblemTitle(s: string | null): void {
    if (s != null && javaTrim(s) === '') s = null;
    this.problem.problemName = s;
    this.title = this.module.trimTitle(s);
  }

  async save(ui: ModuleDialogs): Promise<boolean> {
    return this.saveRenamed(this.saveProblem(), ui);
  }

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

  /** Which delete question the desktop asks (by the answer last read): work or problem, problem only, or none. */
  getDeleteChoice(): 'workOrProblem' | 'problem' | 'none' {
    if (this.problem.answer != null) return 'workOrProblem';
    const st = this.problem.statement;
    return this.problemIndex !== -1 || (st != null && st !== '') ? 'problem' : 'none';
  }

  /**
   * "Delete the work on this problem?" OK (RecognitionDialogs.confirmRemoveWork, or with
   * fromDeleteDialog the Delete button's choice, confirmDelete, which leaves the status), then
   * saveDeletedWork. As on the desktop, the problem is reloaded afterwards, which detaches it
   * from the list (problemIndex -1).
   */
  deleteWork(fromDeleteDialog = false): void {
    if (fromDeleteDialog) this.problem.clearAnswer();
    else {
      this.status = '';
      this.problem.clearAnswer();
    }
    this.saveDeletedWork();
    this.notifyChanged();
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

  /** "Delete this problem?" OK. */
  deleteProblem(): void {
    if (this.problemIndex !== -1) {
      this.module.problems.removeProblem(this.problemIndex);
      this.module.saveProblems();
    }
    this.newProblem();
  }
}
