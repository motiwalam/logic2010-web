/**
 * A module's problems (course exercises, or the student's work). Port of ProblemSet.java.
 *
 * A ProblemSet is a list of ProblemEntry with a name index (upper-cased names). Each
 * module subclasses it and supplies the hooks (createEntry, getProblemStatement, hasWork,
 * getWork, removeWork, getModuleIndex, restateProblems; optionally getSearchNote).
 *
 * Problem sets are per-workspace objects (the desktop keeps them in the modules' static
 * fields): the set of the module's course exercises that mergeExercises and the problem list
 * use is the `exercises` field, set by the owner.
 */
import { TaggedRecord } from '../data/TaggedRecord';
import { stripNamePrefix } from '../program/LogicProgram';
import { moduleDigestVersKeys } from '../program/ModuleConstants';
import type { UserInfo } from '../program/UserInfo';
import { javaTrim } from '../util/java';
import { ProblemEntry, STATE_INCOMPLETE, STATE_UNCHECKED } from './ProblemEntry';

export abstract class ProblemSet {
  protected readonly entries: ProblemEntry[] = [];
  /** Entries by upper-cased, trimmed name. */
  readonly entriesByName = new Map<string, ProblemEntry>();
  /** The `#-` headings above each problem (course files only), by problem name. */
  headingsByName: Map<string, string[]> | null = null;
  /** The digest read from the file's last "#" line. */
  storedDigest: string | null = null;
  changed = false;
  /** Whether the set was read from the student's work file (whose digest must match). */
  readFromPlainFile = false;
  skipArgumentCheck = false;
  plainColors = false;
  /** The module's course exercises (LPxxx.exercises), for mergeExercises and the problem list. */
  exercises: ProblemSet | null = null;
  /**
   * Records of a work file that the web program leaves out (excludedProblems.ts), each with
   * the name of the problem it followed (null: at the start). They count in the file's
   * digest and are written back where they were (allRecords).
   */
  excludedRecords: { record: string; after: string | null }[] = [];

  abstract getProblemStatement(record: TaggedRecord): string | null;
  abstract hasWork(record: TaggedRecord): boolean;
  abstract getWork(record: TaggedRecord): string | null;
  abstract removeWork(record: TaggedRecord): string | null;
  /** A new entry for a record line (unchecked: see ProblemEntry). */
  abstract createEntry(record: string, unchecked: boolean): ProblemEntry;
  abstract getModuleIndex(): number;
  /**
   * Recomputes the states of the unchecked and incomplete problems (the desktop's
   * ProblemRestateTask); see restateEntries.
   */
  abstract restateProblems(): Promise<void>;

  /** Extra text the problem list searches and shows on hover, e.g. what the problem proves. */
  getSearchNote(_record: TaggedRecord): string | null {
    return null;
  }

  /** Called after the problem at index i was removed (the desktop renumbers open windows). */
  protected problemRemoved(_i: number): void {}

  // ---- the list ----

  size(): number {
    return this.entries.length;
  }

  elementAt(i: number): ProblemEntry {
    return this.entries[i];
  }

  indexOf(entry: ProblemEntry): number {
    return this.entries.indexOf(entry);
  }

  elements(): readonly ProblemEntry[] {
    return this.entries;
  }

  insertElementAt(entry: ProblemEntry, i: number): void {
    if (i < 0 || i > this.entries.length) throw new RangeError('ArrayIndexOutOfBoundsException: ' + i);
    this.entries.splice(i, 0, entry);
  }

  addElement(entry: ProblemEntry): void {
    this.entries.push(entry);
  }

  setElementAt(entry: ProblemEntry, i: number): void {
    this.entries[i] = entry;
  }

  removeElementAt(i: number): void {
    this.entries.splice(i, 1);
  }

  // ---- ProblemSet ----

  /**
   * The index at which a local problem is inserted to keep the set sorted by name (without
   * prefix, upper case); -1 for a duplicate name.
   */
  findInsertIndex(name: string | null): number {
    if (name == null) return -1;
    const key = stripNamePrefix(name).toUpperCase();
    for (let j = 0; j < this.entries.length; j++) {
      const other = stripNamePrefix(TaggedRecord.nameOf(this.entries[j].name) ?? 'null').toUpperCase();
      if (key === other) return -1;
      if (key < other) return j;
    }
    return this.entries.length;
  }

  indexOfName(name: string | null): number {
    if (name == null) return -1;
    const key = stripNamePrefix(name).toUpperCase();
    for (let j = 0; j < this.entries.length; j++) {
      const other = stripNamePrefix(TaggedRecord.nameOf(this.entries[j].name));
      if (other != null && key === other.toUpperCase()) return j;
    }
    return -1;
  }

  getStatement(record: string): string | null {
    return this.getProblemStatement(new TaggedRecord(record));
  }

  hasWorkRecord(record: string): boolean {
    return this.hasWork(new TaggedRecord(record));
  }

  static isExample(record: TaggedRecord): boolean {
    return record.getKeyValues('%').has('eg');
  }

  /**
   * Registers an entry by name. If another entry already had the name, that one is renamed
   * name-1 (name-2, ...) in its place; returns its index, or -1.
   */
  registerEntry(entry: ProblemEntry, unchecked: boolean): number {
    let name = TaggedRecord.nameOf(entry.name);
    if (name == null) return -1;
    const key = javaTrim(name).toUpperCase();
    const previous = this.entriesByName.get(key);
    this.entriesByName.set(key, entry);
    const i = previous === undefined ? -1 : this.indexOf(previous);
    if (i !== -1) {
      let j = 1;
      while (this.getEntry(name + '-' + j) != null) j++;
      name = name + '-' + j;
      const renamed = this.createEntry(TaggedRecord.withName(previous!.name, name), unchecked);
      this.entriesByName.set(javaTrim(name).toUpperCase(), renamed);
      this.setElementAt(renamed, i);
    }
    return i;
  }

  getEntry(name: string | null): ProblemEntry | null {
    return name == null ? null : this.entriesByName.get(javaTrim(name).toUpperCase()) ?? null;
  }

  /**
   * Merges the module's exercises into this set (the work): adds exercises that are missing
   * and replaces those whose statement changed and that have no work (or are examples).
   * Returns whether anything changed.
   */
  mergeExercises(): boolean {
    const exercises = this.getExercises();
    const n = exercises == null ? 0 : exercises.size();
    let at = 0;
    this.changed = false;
    for (let k = 0; k < n; k++) {
      const l = this.mergeExercise(exercises!.getRecordAt(k)!, at);
      if (l !== -1) at = l + 1;
    }
    return this.changed;
  }

  mergeExercise(record: string, at: number): number {
    const exercise = new TaggedRecord(record);
    const name = exercise.getName();
    const statement = this.getProblemStatement(exercise);
    if (name == null || statement == null) return -1;
    const entry = this.getEntry(name);
    let j = entry == null ? -1 : this.indexOf(entry);
    if (j === -1) {
      j = at - 1;
    } else {
      const work = new TaggedRecord(entry!.name);
      if (statement === this.getProblemStatement(work)) return j;
      if (!this.hasWork(work) || ProblemSet.isExample(work)) this.removeProblem(j--);
    }
    this.changed = true;
    const added = this.createEntry(record, true);
    this.registerEntry(added, true);
    this.insertElementAt(added, j + 1);
    return j + 1;
  }

  /**
   * Adds a problem read from a file, with the headings above it. sorted (local problems):
   * insert in name order, rejecting duplicates; otherwise append. Returns the index or -1.
   */
  addProblem(line: string, headings: string[] | null, sorted: boolean): number {
    return this.addProblemRecord(new TaggedRecord(line), headings, sorted);
  }

  addProblemRecord(record: TaggedRecord, headings: string[] | null, sorted: boolean): number {
    const name = record.getName();
    const line = record.getRawLine();
    if (name == null) {
      console.log('problem without title: ' + line);
      return -1;
    }
    const i = sorted ? this.findInsertIndex(name) : this.size();
    if (i === -1) {
      console.log('local problem with duplicate name: ' + name);
      return -1;
    }
    if (this.headingsByName != null && headings != null) this.headingsByName.set(name, headings);
    const entry = this.createEntry(line!, true);
    entry.hidden = record.isHidden();
    this.registerEntry(entry, true);
    if (sorted) this.insertElementAt(entry, i);
    else this.addElement(entry);
    return i;
  }

  replaceProblem(record: string, i: number): number {
    if (TaggedRecord.nameOf(record) == null) return -1;
    const old = this.entries[i];
    if (old != null) this.entriesByName.delete(javaTrim(TaggedRecord.nameOf(old.name) ?? 'null').toUpperCase());
    const entry = this.createEntry(record, false);
    this.registerEntry(entry, false);
    this.setElementAt(entry, i);
    return i;
  }

  removeProblem(i: number): void {
    const name = TaggedRecord.nameOf(this.getRecordAt(i));
    if (name != null) this.entriesByName.delete(javaTrim(name).toUpperCase());
    this.removeElementAt(i);
    this.problemRemoved(i);
  }

  /** The digest of the records for the user (with the user's digest version for this module). */
  computeDigest(user: UserInfo): string {
    return user.computeDigest(this.allRecords(), user.get(this.getDigestVersKey()));
  }

  /** The record lines in order (ProblemRecordEnumeration). */
  records(): string[] {
    return this.entries.map((e) => e.name);
  }

  /** Keeps aside a record that is left out of the set (see excludedRecords). */
  excludeRecord(record: string): void {
    const last = this.entries.length === 0 ? null : TaggedRecord.nameOf(this.entries[this.entries.length - 1].name);
    this.excludedRecords.push({ record, after: last });
  }

  /**
   * The records as saved: records() with the excluded ones back after the problem they
   * followed (at the end if it is gone). Without excluded records, records().
   */
  allRecords(): string[] {
    if (this.excludedRecords.length === 0) return this.records();
    const byAnchor = new Map<string | null, string[]>();
    for (const { record, after } of this.excludedRecords) {
      const key = after == null ? null : javaTrim(after).toUpperCase();
      byAnchor.set(key, [...(byAnchor.get(key) ?? []), record]);
    }
    const out = [...(byAnchor.get(null) ?? [])];
    byAnchor.delete(null);
    for (const e of this.entries) {
      out.push(e.name);
      const name = TaggedRecord.nameOf(e.name);
      const key = name == null ? undefined : javaTrim(name).toUpperCase();
      if (key !== undefined && byAnchor.has(key)) {
        out.push(...byAnchor.get(key)!);
        byAnchor.delete(key);
      }
    }
    for (const rest of byAnchor.values()) out.push(...rest);
    return out;
  }

  getRecordAt(i: number): string | null {
    return this.getEntryAt(i)?.name ?? null;
  }

  getEntryAt(i: number): ProblemEntry | null {
    return i >= 0 && i < this.entries.length ? this.entries[i] : null;
  }

  getRecord(name: string | null): string | null {
    if (name == null) return null;
    return this.getEntry(name)?.name ?? null;
  }

  getExercises(): ProblemSet | null {
    return this.exercises;
  }

  getDigestVersKey(): string {
    return moduleDigestVersKeys[this.getModuleIndex()];
  }

  /** ProblemSet.lookupName: the name of the set's problem with that name (its own spelling), or null. */
  static lookupName(set: ProblemSet | null, name: string | null): string | null {
    const record = set == null ? null : set.getRecord(name);
    return record == null ? null : TaggedRecord.nameOf(record);
  }

  /**
   * The desktop's ProblemRestateTask, run to completion: recomputes the state of each
   * problem that is unchecked or incomplete with getState, and when any changed, makes
   * another pass. (The desktop runs one problem per event-loop turn.) With `update`
   * instead of a state function, the callback sets entry.state itself (the symbolizer's
   * evaluateWork).
   */
  async restateEntries(
    getState: (record: TaggedRecord, entry: ProblemEntry) => number | void | Promise<number | void>,
  ): Promise<void> {
    const count = this.size();
    const record = new TaggedRecord();
    let changed = false;
    for (let index = 0; ; index++) {
      if (index === count) {
        if (!changed) return;
        index = 0;
        changed = false;
      }
      const entry = this.getEntryAt(index);
      if (entry != null && (entry.state === STATE_INCOMPLETE || entry.state === STATE_UNCHECKED)) {
        const before = entry.state;
        record.clear();
        record.parse(entry.name);
        const state = await getState(record, entry);
        if (typeof state === 'number') entry.state = state;
        if (entry.state !== before) changed = true;
      }
    }
  }
}
