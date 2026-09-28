/**
 * Ports of SymbolizationProblemSet.java and SymbolizationEntry.java: the module's problem
 * set (course exercises, or the student's work) and its entries, whose state comes from
 * SymbolizationNode.evaluateWork and which remember the answer set they matched.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { ProblemEntry, type ProblemNameSet } from '../../problems/ProblemEntry';
import { ProblemSet } from '../../problems/ProblemSet';
import { symModule } from '../../program/ModuleConstants';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import { javaTrim } from '../../util/java';
import type { AnswerSet } from './AnswerSet';
import { lookupAnswers, type SymbolizationData, SymbolizationNode } from './SymbolizationNode';
import * as records from './SymbolizationRecords';

/** What the set needs from the module (LPSymbolizer's statics). */
export interface SymbolizationSetOwner extends SymbolizationData {
  /** SymbolizationEntry.knownNames: the extra (non-course) problems of the work. */
  knownNames: ProblemNameSet | null;
  getExerciseTitle(name: string | null): string | null;
}

export class SymbolizationEntry extends ProblemEntry {
  answerIndex = -1;

  /** unchecked: leave the state unchecked (a restate pass computes it); otherwise evaluate now. */
  constructor(record: string, set: SymbolizationProblemSet, unchecked: boolean) {
    super(record, true, set.owner.knownNames);
    if (!unchecked) getProblemState(record, set, this);
  }

  resetState(): void {
    this.state = 0;
    this.answerIndex = -1;
  }

  computeState(): number {
    return 0;
  }
}

/** LPSymbolizer.getProblemState: the entry's state for its record. */
export function getProblemState(record: string, set: SymbolizationProblemSet, entry: SymbolizationEntry | null): SymbolizationEntry {
  const e = entry ?? new SymbolizationEntry(record, set, true);
  if (!records.hasWork(record)) e.resetState();
  else new SymbolizationNode(null, set.owner).evaluateWork(new TaggedRecord(record), set, e);
  return e;
}

export class SymbolizationProblemSet extends ProblemSet {
  /** Answer groups (g tag) by group key: course exercises only. */
  answerGroups: Map<string, AnswerSet[]> | null = null;

  /** useUserKey: the answers of the problems are in the user key (the work) or the answer table. */
  constructor(
    readonly owner: SymbolizationSetOwner,
    readonly useUserKey: boolean,
  ) {
    super();
    this.skipArgumentCheck = true;
  }

  override addProblemRecord(record: TaggedRecord, headings: string[] | null, sorted: boolean): number {
    const i = super.addProblemRecord(record, headings, sorted);
    if (i !== -1 && this.answerGroups != null) {
      const g = record.valueAt(record.indexOfTag('g'));
      if (g != null) {
        const key = javaTrim(g);
        let group = this.answerGroups.get(key);
        if (group == null) this.answerGroups.set(key, (group = []));
        group.push({ problemName: record.getName(), answers: lookupAnswers(this.owner, record.valueAt(record.indexOfTag('@')), this.useUserKey) });
      }
    }
    return i;
  }

  /** Removes a problem; a user problem's answers leave the user key too. */
  override removeProblem(i: number): void {
    const t = new TaggedRecord(this.getRecordAt(i));
    if (t.getOriginalName() == null && this.owner.getExerciseTitle(t.getName()) == null) {
      const keys = t.valueAt(t.indexOfTag('@'));
      if (keys != null) {
        const d = new DelimitedTokenizer('\\.');
        d.setInput(keys);
        let key: string | null;
        while ((key = d.nextToken()) != null) if (key !== '') this.owner.userKey?.remove(key);
      }
    }
    super.removeProblem(i);
  }

  createEntry(record: string, unchecked: boolean): ProblemEntry {
    return new SymbolizationEntry(record, this, unchecked);
  }

  hasWork(t: TaggedRecord): boolean {
    return records.hasWork(t);
  }

  getWork(t: TaggedRecord): string {
    return records.getWork(t);
  }

  removeWork(t: TaggedRecord): string {
    return records.removeWork(t);
  }

  getProblemStatement(t: TaggedRecord): string | null {
    return records.getProblemStatement(t);
  }

  getModuleIndex(): number {
    return symModule;
  }

  /** The desktop's restate pass: evaluateWork on each unchecked or incomplete problem. */
  async restateProblems(): Promise<void> {
    const checker = new SymbolizationNode(null, this.owner);
    await this.restateEntries((record, entry) => {
      checker.evaluateWork(record, this, entry as SymbolizationEntry);
    });
  }
}
