/**
 * The module-wide state of the Symbolization module: the static parts of LPSymbolizer.java
 * (exercises, answer table, user key, the student's problems, options, the start-up and
 * saving), kept per workspace.
 *
 * Start-up (LPSymbolizer.startup): SymbolizationModule.load reads the messages, the answer
 * table, the options and the course exercises (and restates them), then the user key and
 * the work (checking its digest), merges the exercises into the work and restates it.
 * Saving produces the two work files (symbolization.rec with its digest, and
 * symbolization-answers.rec, the answers of the student's own problems) and hands them to
 * `persist`.
 */
import * as DataFiles from '../../data/DataFiles';
import type { ScrambledReader } from '../../data/Scrambler';
import { TaggedRecord } from '../../data/TaggedRecord';
import { findExtraProblems, readExercises, readWork, verifyDigest, writeProblems, type DigestCheck, type WorkFile } from '../../problems/LogicModule';
import { ProblemEntry, type ProblemNameSet } from '../../problems/ProblemEntry';
import { openDataFile, openLocalFile, options as programOptions, selectorMatches, stripNamePrefix } from '../../program/LogicProgram';
import { loadModuleMessages, readModuleOptions } from '../../program/loadProgram';
import type { ModuleOptions } from '../../program/moduleOptions';
import { ProblemSelector } from '../../program/ProblemSelector';
import type { UserInfo } from '../../program/UserInfo';
import { JavaHashtable, javaTrim } from '../../util/java';
import { symModule } from '../../program/ModuleConstants';
import { lookupAnswers, type SymbolizationNotice } from './SymbolizationNode';
import { SymbolizationProblemSet, type SymbolizationSetOwner } from './SymbolizationProblemSet';

export const WORK_KEY = 'symwork.txt';
export const USER_KEY_KEY = 'keywork.txt';
export const ANSWERS_KEY = 'symAnswers';

/** A saved file: its readable name and text. */
export interface SavedFile {
  fileName: string;
  text: string;
}

export class SymbolizationLoadError extends Error {
  constructor(
    /** The message id the desktop shows (not001..not003 of the general catalogue). */
    readonly messageId: string,
    message: string,
  ) {
    super(message);
  }
}

/** LPSymbolizer.readAnswers: answer lines by their (trimmed) name. */
export function readAnswers(reader: ScrambledReader | null, table: { set?(k: string, v: string): unknown; put?(k: string, v: string): unknown }): boolean {
  if (reader == null) return false;
  let s: string | null;
  while ((s = reader.readLine()) != null) {
    if (TaggedRecord.isBlankOrComment(s)) continue;
    let name = TaggedRecord.nameOf(s);
    if (name != null && (name = javaTrim(name)) !== '') {
      if (table.put) table.put(name, s);
      else table.set!(name, s);
    }
  }
  reader.close();
  return true;
}

export interface LoadOptions {
  /** The student's work file (null: none yet; the course problems are the work). */
  work: WorkFile | null;
  /** The user key work file (symbolization-answers.rec), if any. */
  userKey: WorkFile | null;
  /** The student (for the work file's digest). */
  user: UserInfo;
  /** Accept work whose digest does not match (the desktop's instructor "indigestion" access). */
  acceptBadDigest?: boolean;
}

export class SymbolizationModule implements SymbolizationSetOwner {
  exercises: SymbolizationProblemSet | null = null;
  problems: SymbolizationProblemSet | null = null;
  answers: Map<string, string> | null = null;
  userKey: JavaHashtable<string, string> | null = null;
  knownNames: ProblemNameSet | null = null;
  options: ModuleOptions | null = null;
  user: UserInfo | null = null;
  digest: DigestCheck | null = null;
  /** The record of a new, empty problem (LPSymbolizer.newProblem). */
  newProblem: string | null = null;
  lastUserProblem = '';
  lastUserScheme = '';
  /** Receives the saved work files. */
  persist: (files: SavedFile[]) => void = () => {};
  /** Receives messages of nodes that belong to no open problem. */
  onNotice: (notice: SymbolizationNotice) => void = () => {};

  notify(notice: SymbolizationNotice): void {
    this.onNotice(notice);
  }

  // ---- options ----

  selector(name: string): ProblemSelector | null {
    return this.options?.selector(name) ?? null;
  }

  get noUser(): boolean {
    return this.options?.hasFlag('noUser') ?? false;
  }

  get submitExam(): boolean {
    return this.options?.hasFlag('submitExam') ?? false;
  }

  get printIncorrect(): boolean {
    return this.options?.hasFlag('printIncorrect') ?? false;
  }

  /** logPrint / logSubmit, with needPrint / needSubmit added (logNeeds). */
  private logNeeds(): void {
    const opts = this.options!;
    for (const [need, log] of [
      ['needPrint', 'logPrint'],
      ['needSubmit', 'logSubmit'],
    ]) {
      const n = opts.selector(need);
      if (n != null && !n.isEmpty()) {
        let l = opts.selector(log);
        if (l == null) opts.selectors.set(log, (l = new ProblemSelector()));
        l.union(n);
      }
    }
  }

  // ---- start-up ----

  static async load(opts: LoadOptions): Promise<SymbolizationModule> {
    const m = new SymbolizationModule();
    await m.getExercises();
    await m.getProblems(opts);
    return m;
  }

  /** LPSymbolizer.getExercises (and the restate of the exercises). */
  async getExercises(): Promise<void> {
    await loadModuleMessages(symModule);
    if (!(await this.getAnswers())) throw new SymbolizationLoadError('not002', 'the symbolization answer file');
    this.options = await readModuleOptions(symModule);
    this.logNeeds();
    const set = new SymbolizationProblemSet(this, false);
    set.answerGroups = new Map();
    if (!(await readExercises(set, WORK_KEY))) throw new SymbolizationLoadError('not001', 'the Symbolization exercise file');
    this.exercises = set;
    await set.restateProblems();
  }

  async getAnswers(): Promise<boolean> {
    const answers = new Map<string, string>();
    if (!programOptions.noCoreProblems) {
      const reader = await openDataFile(ANSWERS_KEY);
      if (reader == null || !readAnswers(reader, answers)) return false;
    }
    const local = await openLocalFile(ANSWERS_KEY);
    if (local != null && !readAnswers(local, answers)) return false;
    this.answers = answers;
    return true;
  }

  /** LPSymbolizer.getProblems (getUserKey, readWork, the digest check), mergeExercises and the restate. */
  async getProblems(opts: LoadOptions): Promise<void> {
    this.user = opts.user;
    this.userKey = new JavaHashtable<string, string>();
    if (opts.userKey != null) {
      readAnswers(DataFiles.openWorkText(opts.userKey.fileName, opts.userKey.text, USER_KEY_KEY), this.userKey);
    }
    const set = new SymbolizationProblemSet(this, true);
    set.exercises = this.exercises;
    if (!(await readWork(set, WORK_KEY, opts.work))) throw new SymbolizationLoadError('not001', WORK_KEY);
    this.digest = verifyDigest(set, opts.user);
    if (!this.digest.ok && !opts.acceptBadDigest) throw new SymbolizationLoadError('not003', WORK_KEY);
    this.problems = set;
    this.knownNames = await findExtraProblems(WORK_KEY, set);
    if (this.exercises != null) ProblemEntry.markExtraProblems(this.exercises, this.knownNames);
    if (set.mergeExercises()) this.saveProblems();
    await set.restateProblems();
  }

  // ---- saving ----

  /** The user key as its work file (LPSymbolizer.writeUserKey). */
  userKeyFile(): SavedFile {
    const records = DataFiles.canonicalRecords([...(this.userKey?.values() ?? [])], 'symbolization-answers');
    return { fileName: DataFiles.workFileName(USER_KEY_KEY)!, text: DataFiles.writeWork(USER_KEY_KEY, records, null) };
  }

  writeUserKey(): boolean {
    if (this.userKey == null) return true;
    this.persist([this.userKeyFile()]);
    return true;
  }

  /** The work file (with its digest for the user). */
  workFile(): SavedFile {
    const written = writeProblems(this.problems!, WORK_KEY, this.user!);
    return { fileName: written.fileName, text: written.text };
  }

  /** LPSymbolizer.saveProblems(): writes the work and the user key. */
  saveProblems(): boolean {
    if (this.problems == null || this.user == null) return false;
    const files = [this.workFile()];
    if (this.userKey != null) files.push(this.userKeyFile());
    this.persist(files);
    return true;
  }

  // ---- problems ----

  getExerciseTitle(s: string | null): string | null {
    const record = this.exercises == null ? null : this.exercises.getRecord(s);
    return record == null ? null : TaggedRecord.nameOf(record);
  }

  isExercise(s: string | null): boolean {
    return this.exercises != null && s != null && this.exercises.getRecord(s) != null;
  }

  isExample(s: string | null): boolean {
    return this.exercises != null && s != null && TaggedRecord.isExample(this.exercises.getRecord(s));
  }

  equivalentCounts(s: string | null): boolean {
    return selectorMatches(this.selector('equCounts'), this.getExerciseTitle(s));
  }

  trimTitle(s: string | null): string | null {
    if (s == null) return null;
    return this.isExercise(s) ? stripNamePrefix(s) : javaTrim(s);
  }

  /** LPSymbolizer.getProblemAnswers: the answer records of a problem (following o to the original). */
  getProblemAnswers(s: string | null): string[] | null {
    const title = this.getExerciseTitle(s);
    let t: TaggedRecord;
    let user: boolean;
    if (title == null) {
      const r = this.problems?.getRecord(s) ?? null;
      if (r == null) return null;
      t = new TaggedRecord(r);
      user = true;
      const original = t.getOriginalName();
      if (original != null) return this.getProblemAnswers(original);
    } else {
      const r = this.exercises!.getRecord(title);
      if (r == null) return null;
      t = new TaggedRecord(r);
      user = false;
    }
    return lookupAnswers(this, t.valueAt(t.indexOfTag('@')), user);
  }

  /** LPSymbolizer.getProblemScheme: a problem's scheme (following o to the original). */
  getProblemScheme(s: string | null): string | null {
    const title = this.getExerciseTitle(s);
    let t: TaggedRecord;
    if (title == null) {
      const r = this.problems?.getRecord(s) ?? null;
      if (r == null) return null;
      t = new TaggedRecord(r);
      const original = t.getOriginalName();
      if (original != null) return this.getProblemScheme(original);
    } else {
      const r = this.exercises!.getRecord(title);
      if (r == null) return null;
      t = new TaggedRecord(r);
    }
    return t.valueAt(t.indexOfTag('='));
  }

  /** "Delete Work" of the multi-problem delete: removes the work of the problems (not examples). */
  deleteWorkOf(indexes: readonly number[]): void {
    const problems = this.problems!;
    for (let k = indexes.length; --k >= 0; ) {
      const entry = problems.getEntryAt(indexes[k]);
      if (entry == null) continue;
      const t = new TaggedRecord(entry.name);
      if (!this.isExample(t.getName())) {
        entry.name = problems.removeWork(t);
        entry.state = 0;
      }
    }
    this.saveProblems();
  }

  /** "Delete Problems" of the multi-problem delete: removes the problems that are not exercises. */
  deleteProblemsAt(indexes: readonly number[]): void {
    const problems = this.problems!;
    for (let k = indexes.length; --k >= 0; ) {
      const entry = problems.getEntryAt(indexes[k]);
      if (entry == null) continue;
      if (!this.isExercise(new TaggedRecord(entry.name).getName())) problems.removeProblem(indexes[k]);
    }
    this.saveProblems();
  }
}
