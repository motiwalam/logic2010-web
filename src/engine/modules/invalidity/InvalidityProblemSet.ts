/**
 * Port of InvalidityProblemSet.java and InvalidityProblemEntry.java: the Invalidity problems (course
 * exercises or the student's work, `invwork.txt`).
 */
import type { TaggedRecord } from '../../data/TaggedRecord';
import { ProblemEntry, type ProblemNameSet } from '../../problems/ProblemEntry';
import { ProblemSet } from '../../problems/ProblemSet';
import { invModule } from '../../program/ModuleConstants';
import { getProblemState, getProblemStatement, getWork, hasWork, removeWork } from './LPInvalidation';

export class InvalidityProblemEntry extends ProblemEntry {
  constructor(record: string, unchecked: boolean, workProblemNames: ProblemNameSet | null = null) {
    super(record, unchecked, workProblemNames);
  }

  computeState(record: string): number {
    return getProblemState(record);
  }
}

export class InvalidityProblemSet extends ProblemSet {
  /** InvalidityProblemEntry.workProblemNames: the problems that are not in the course files. */
  workProblemNames: ProblemNameSet | null = null;

  getProblemStatement(t: TaggedRecord): string | null {
    return getProblemStatement(t);
  }

  hasWork(t: TaggedRecord): boolean {
    return hasWork(t);
  }

  getWork(t: TaggedRecord): string {
    return getWork(t);
  }

  removeWork(t: TaggedRecord): string {
    return removeWork(t);
  }

  createEntry(record: string, unchecked: boolean): ProblemEntry {
    return new InvalidityProblemEntry(record, unchecked, this.workProblemNames);
  }

  getModuleIndex(): number {
    return invModule;
  }

  async restateProblems(): Promise<void> {
    await this.restateEntries((t, entry) => (hasWork(t) ? getProblemState(entry.name) : 0));
  }
}
