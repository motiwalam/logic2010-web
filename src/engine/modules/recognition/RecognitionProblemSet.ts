/**
 * The Recognition module's problems. Port of RecognitionProblemSet.java and
 * RecognitionProblemEntry.java.
 *
 * A problem's state comes from checking its answer (LPRecognition.getProblemState), which
 * needs the course exercises (the answer key) and the active rules: the set's `checker`,
 * which the module sets.
 */
import type { TaggedRecord } from '../../data/TaggedRecord';
import { ProblemEntry, type ProblemNameSet, STATE_UNCHECKED } from '../../problems/ProblemEntry';
import { ProblemSet } from '../../problems/ProblemSet';
import { recModule } from '../../program/ModuleConstants';
import { getProblemStatement, getWork, hasWork, removeWork } from './recognitionRecords';

/** Computes the state of a record (LPRecognition.getProblemState). */
export type RecognitionStateChecker = (record: TaggedRecord | string) => number;

export abstract class RecognitionProblemEntry extends ProblemEntry {}

export class RecognitionProblemSet extends ProblemSet {
  /** RecognitionProblemEntry.savedWork: the problems not in the course files (set by the module). */
  savedWork: ProblemNameSet | null = null;
  checker: RecognitionStateChecker | null = null;
  private readonly Entry: new (record: string, unchecked: boolean, listed: ProblemNameSet | null) => RecognitionProblemEntry;

  constructor() {
    super();
    // the entry's state is computed in ProblemEntry's constructor, so the checker is reached
    // through the set, not through a field of the entry
    const set = this;
    this.Entry = class extends RecognitionProblemEntry {
      computeState(record: string): number {
        return set.checker == null ? STATE_UNCHECKED : set.checker(record);
      }
    };
  }

  createEntry(record: string, unchecked: boolean): ProblemEntry {
    return new this.Entry(record, unchecked, this.savedWork);
  }

  hasWork(record: TaggedRecord): boolean {
    return hasWork(record);
  }

  getWork(record: TaggedRecord): string | null {
    return getWork(record);
  }

  removeWork(record: TaggedRecord): string | null {
    return removeWork(record);
  }

  getProblemStatement(record: TaggedRecord): string | null {
    return getProblemStatement(record);
  }

  getModuleIndex(): number {
    return recModule;
  }

  async restateProblems(): Promise<void> {
    const checker = this.checker;
    if (checker == null) return;
    await this.restateEntries((record) => checker(record));
  }
}
