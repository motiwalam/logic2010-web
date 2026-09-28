/**
 * A student's derivation work: the desktop's static LPDerivation state that belongs to the
 * user rather than to the program (problems, the user rules, the names of the extra problems)
 * and the work-file operations of LPDerivation (getProblems, readWork, saveProblems,
 * restateProblems through DerivationProblemSet, getProblemState).
 *
 * Several workspaces can exist at once (your own work and someone else's, read-only).
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { findExtraProblems, readWork, verifyDigest, writeProblems, type DigestCheck, type WorkFile, type WrittenWork } from '../../problems/LogicModule';
import { ProblemEntry, STATE_NO_WORK, type ProblemNameSet } from '../../problems/ProblemEntry';
import type { UserInfo } from '../../program/UserInfo';
import type { Rule } from '../../rules/Rule';
import { RuleTable } from '../../rules/RuleTable';
import type { DerivationConfig } from './DerivationConfig';
import { DerivationProblemSet, hasWork, UserRule } from './DerivationProblemSet';
import { LPDerivation } from './LPDerivation';
import { HeadlessDialogs } from './QueryDialog';

export const WORK_KEY = 'derwork.txt';

export class DerivationWorkspace {
  readonly config: DerivationConfig;
  problems: DerivationProblemSet;
  userRules: RuleTable | null = null;
  workProblemNames: ProblemNameSet | null = null;
  /** While problem states are recomputed (LPDerivation.restating): lines show no messages. */
  restating = false;
  /** The record of an empty derivation (LPDerivation.newProblem). */
  newProblem: string | null = null;
  /** The clock for work times (seconds are counted from it): Date.now by default. */
  clock: () => number = () => Date.now();
  /** Whether the work was changed and should be saved (e.g. new exercises merged in). */
  needsSave = false;
  /** The digest check of the work file that was read. */
  digestCheck: DigestCheck | null = null;

  constructor(config: DerivationConfig) {
    this.config = config;
    this.problems = new DerivationProblemSet(config, this);
    this.problems.exercises = config.exercises;
  }

  /**
   * LPDerivation.getProblems and the start-up: reads the work (or the course problems when
   * there is none), checks its digest (for user), builds the user rules, marks the extra
   * problems, merges new exercises and computes the problem states.
   */
  static async open(config: DerivationConfig, work: WorkFile | null, user: UserInfo | null = null, restate = true): Promise<DerivationWorkspace> {
    const ws = new DerivationWorkspace(config);
    await readWork(ws.problems, WORK_KEY, work);
    if (user != null) ws.digestCheck = verifyDigest(ws.problems, user);
    ws.rebuildUserRules();
    ws.workProblemNames = await findExtraProblems(WORK_KEY, ws.problems);
    ProblemEntry.markExtraProblems(config.exercises, ws.workProblemNames);
    if (ws.problems.mergeExercises()) ws.needsSave = true;
    if (restate) await ws.restateProblems();
    return ws;
  }

  /** LPDerivation.getRule: the program's rules, the box rules, then the user's rules. */
  getRule(name: string): Rule | null {
    return this.config.getRule(name) ?? this.userRules?.getRule(name) ?? null;
  }

  /** DerivationProblemSet.rebuildUserRules: a rule for each problem named UR... that parses. */
  rebuildUserRules(): void {
    this.userRules = new RuleTable(null);
    for (let j = 0; j < this.problems.size(); j++) {
      const name = new TaggedRecord(this.problems.getRecordAt(j)).getName();
      if (name != null && name.toUpperCase().startsWith('UR')) {
        const rule = new UserRule(this.problems, name);
        if (rule.error == null) this.userRules.addRule(rule);
      }
    }
  }

  /** A module without a window (LPDerivation(false)): no dialogs, no message substitution. */
  createHiddenModule(): LPDerivation {
    return new LPDerivation(this, { dialogs: new HeadlessDialogs(), hasFrame: false, doSubs: false });
  }

  /** LPDerivation.getProblemState(String): 0 without work, else the result of Check. */
  async computeState(record: string, module: LPDerivation | null = null): Promise<number> {
    const t = new TaggedRecord(record);
    if (!hasWork(t)) return STATE_NO_WORK;
    return (module ?? this.createHiddenModule()).getProblemState(t);
  }

  /** Computes an entry's state (what the desktop does when it creates an entry). */
  async updateState(entry: ProblemEntry): Promise<void> {
    entry.state = await this.computeState(entry.name);
  }

  /**
   * DerivationProblemSet.restateProblems: replays every unchecked or incomplete problem in a
   * hidden module (with restating set) until no state changes.
   */
  async restateProblems(): Promise<void> {
    this.restating = true;
    try {
      const module = this.createHiddenModule();
      await this.problems.restateEntries((record) => module.getProblemState(record));
    } finally {
      this.restating = false;
    }
  }

  /** LPDerivation.saveProblems: the work file's text (and digest) for the user. */
  write(user: UserInfo): WrittenWork {
    return writeProblems(this.problems, WORK_KEY, user);
  }

  isExercise(name: string | null): boolean {
    return name != null && this.config.exercises.getRecord(name) != null;
  }

  isExample(name: string | null): boolean {
    return name != null && TaggedRecord.isExample(this.config.exercises.getRecord(name));
  }

  getExerciseTitle(name: string | null): string | null {
    const record = this.config.exercises.getRecord(name);
    return record == null ? null : TaggedRecord.nameOf(record);
  }
}
