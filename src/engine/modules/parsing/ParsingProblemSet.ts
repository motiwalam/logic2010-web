/**
 * The Parsing module's problems. Port of ParsingProblemSet.java and ParsingProblemEntry.java.
 */
import type { TaggedRecord } from '../../data/TaggedRecord';
import { ProblemEntry, type ProblemNameSet } from '../../problems/ProblemEntry';
import { ProblemSet } from '../../problems/ProblemSet';
import { parModule } from '../../program/ModuleConstants';
import { getProblemState, getProblemState_static, getProblemStatement, getWork, hasWork, removeWork } from './parsingRecords';

export class ParsingProblemEntry extends ProblemEntry {
  constructor(record: string, unchecked: boolean, listed: ProblemNameSet | null) {
    super(record, unchecked, listed);
  }

  computeState(record: string): number {
    return getProblemState(record);
  }
}

export class ParsingProblemSet extends ProblemSet {
  /** ParsingProblemEntry.newProblemNames: the problems not in the course files (set by the module). */
  newProblemNames: ProblemNameSet | null = null;

  constructor() {
    super();
    this.skipArgumentCheck = true;
  }

  createEntry(record: string, unchecked: boolean): ProblemEntry {
    return new ParsingProblemEntry(record, unchecked, this.newProblemNames);
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
    return parModule;
  }

  async restateProblems(): Promise<void> {
    await this.restateEntries((record) => getProblemState_static(record));
  }
}
