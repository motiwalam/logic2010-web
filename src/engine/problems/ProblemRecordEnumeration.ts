/**
 * Port of ProblemRecordEnumeration.java: a snapshot of a problem set's record lines (the
 * input of the work digest and of the desktop's submit-log checks).
 */
import { TaggedRecord } from '../data/TaggedRecord';
import type { ProblemSet } from './ProblemSet';

export class ProblemRecordEnumeration implements Iterable<string> {
  records: string[];
  private position = 0;

  /** The records of a set, or a single record line. */
  constructor(source: ProblemSet | string | null) {
    this.records = source == null ? [] : typeof source === 'string' ? [source] : source.records();
  }

  /** Keeps only the records whose problems are in set (none if set is null). */
  retainExisting(set: ProblemSet | null): void {
    this.records = set == null ? [] : this.records.filter((r) => set.getRecord(TaggedRecord.nameOf(r)) != null);
  }

  hasMoreElements(): boolean {
    return this.position < this.records.length;
  }

  nextElement(): string | null {
    return this.position < this.records.length ? this.records[this.position++] : null;
  }

  reset(): void {
    this.position = 0;
  }

  [Symbol.iterator](): Iterator<string> {
    return this.records[Symbol.iterator]();
  }
}
