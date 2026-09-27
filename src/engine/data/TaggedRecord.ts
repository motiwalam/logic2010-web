/**
 * Port of TaggedRecord.java: the one-line record format used by every problem, work,
 * option and message file inside the program.
 *
 * A line is a sequence of value`t pairs, where t is a one-character tag. A doubled
 * backquote is a literal backquote. A leading backquote escapes a line that would
 * otherwise start with '#' (a comment) or '`'.
 *
 * Tags with a fixed meaning across modules: $ name, o original name, e error count,
 * t timestamp, % key:value problem options (eg, hide), ! note.
 */
import { javaTrim, parseJavaInt, parseJavaLong } from '../util/java';
import type { ScrambledReader } from './Scrambler';

export class TaggedRecord {
  tags = '';
  values: string[] = [];
  private reader: ScrambledReader | null = null;
  private clearOnRead = false;
  private rawLine: string | null = null;

  /** A record parsed from a line (or an empty record). */
  constructor(line?: string | null) {
    if (line !== undefined) this.parse(line);
  }

  /**
   * TaggedRecord(reader, clearOnRead): a record that reads lines from reader. With
   * clearOnRead each readNext parses the next line into a fresh record; without it all
   * lines are read at once into one record (the fields accumulate).
   */
  static fromReader(reader: ScrambledReader, clearOnRead = false): TaggedRecord {
    const t = new TaggedRecord();
    t.open(reader, clearOnRead);
    if (!clearOnRead) while (t.readNext());
    return t;
  }

  /** Parses the next line that is not blank or a comment; false at the end. */
  readNext(): boolean {
    if (this.reader == null) return false;
    if (this.clearOnRead) {
      this.tags = '';
      this.values = [];
    }
    let s: string | null;
    do {
      if ((s = this.reader.readLine()) == null) return false;
    } while (TaggedRecord.isBlankOrComment(s));
    this.parse(s);
    return true;
  }

  close(): void {
    this.reader?.close();
  }

  clear(): void {
    this.tags = '';
    this.values = [];
    this.reader = null;
    this.rawLine = null;
  }

  open(reader: ScrambledReader, clearOnRead: boolean): void {
    this.clear();
    this.clearOnRead = clearOnRead;
    this.reader = reader;
  }

  /** Adds the fields of a line (a comment line adds none). */
  parse(s: string | null): void {
    this.rawLine = s;
    if (s == null || s === '' || s.charAt(0) === '#') return;
    let pending = '';
    if (s.charAt(0) === '`') s = s.substring(1);
    for (;;) {
      const i = s.indexOf('`');
      if (i === -1 || i === s.length - 1) return;
      const c = s.charAt(i + 1);
      const value = pending + s.substring(0, i);
      s = s.substring(i + 2);
      if (c === '`') {
        pending = value + c;
      } else {
        this.tags += c;
        this.values.push(value);
        pending = '';
      }
    }
  }

  tagAt(i: number): string {
    return this.tags.charAt(i);
  }

  indexOfTag(tag: string, from = 0): number {
    const j = this.tags.substring(from).indexOf(tag);
    return j === -1 ? -1 : j + from;
  }

  indexesOfTag(tag: string): number[] {
    const out: number[] = [];
    for (let i = 0; (i = this.indexOfTag(tag, i)) !== -1; i++) out.push(i);
    return out;
  }

  /** The first index at or after from whose tag is one of tags, or -1. */
  indexOfAnyTag(tags: string, from = 0): number {
    const rest = this.tags.substring(from);
    let j = -1;
    for (let l = 0; l < tags.length; l++) {
      const i1 = rest.indexOf(tags.charAt(l));
      if (i1 >= 0 && (j < 0 || i1 < j)) j = i1;
    }
    return j === -1 ? -1 : j + from;
  }

  indexesOfAnyTag(tags: string): number[] {
    const out: number[] = [];
    for (let i = 0; (i = this.indexOfAnyTag(tags, i)) !== -1; i++) out.push(i);
    return out;
  }

  getFieldCount(): number {
    return this.values.length;
  }

  /** The value at i; null for -1. */
  valueAt(i: number): string | null {
    return i === -1 ? null : this.values[i];
  }

  /** The fields with the given tags, formatted as in a line. */
  formatFields(tags: string): string {
    let s = '';
    for (const i of this.indexesOfAnyTag(tags)) s += TaggedRecord.formatField(this.valueAt(i), this.tagAt(i));
    return s;
  }

  intValueAt(i: number): number | null {
    return parseJavaInt(this.valueAt(i));
  }

  longValueAt(i: number): number | null {
    return parseJavaLong(this.valueAt(i));
  }

  getRawLine(): string | null {
    return this.rawLine;
  }

  removeField(i: number): void {
    this.tags = this.tags.substring(0, i) + this.tags.substring(i + 1);
    this.values.splice(i, 1);
  }

  /** Removes the fields at the indexes, one after another (as Java does: later indexes shift). */
  removeFields(indexes: number[] | null): void {
    for (const i of indexes ?? []) this.removeField(i);
  }

  setValueAt(value: string, i: number): void {
    this.values[i] = value;
  }

  insertField(tag: string, value: string, i: number): void {
    this.tags = this.tags.substring(0, i) + tag + this.tags.substring(i);
    this.values.splice(i, 0, value);
  }

  addField(tag: string, value: string): void {
    this.tags += tag;
    this.values.push(value);
  }

  static nameOf(line: string | null): string | null {
    return new TaggedRecord(line).getName();
  }

  getName(): string | null {
    return this.valueAt(this.indexOfTag('$'));
  }

  static withName(line: string | null, name: string): string {
    const t = new TaggedRecord(line);
    t.setName(name);
    return t.toString();
  }

  setName(name: string): void {
    const i = this.indexOfTag('$');
    if (i === -1) this.insertField('$', name, 0);
    else this.setValueAt(name, i);
  }

  getOriginalName(): string | null {
    return this.valueAt(this.indexOfTag('o'));
  }

  getErrorCount(): number {
    return this.intValueAt(this.indexOfTag('e')) ?? 0;
  }

  getTimestamp(): number {
    return this.longValueAt(this.indexOfTag('t')) ?? 0;
  }

  static stripTimestamp(line: string): string {
    return TaggedRecord.removeTags(line, 't');
  }

  static removeTags(line: string, tags: string): string {
    const t = new TaggedRecord(line);
    t.removeFields(t.indexesOfAnyTag(tags));
    return t.toString();
  }

  /** Whether the record's options (%) include eg: a worked example. */
  static isExample(line: string | null): boolean {
    if (line == null) return false;
    return new TaggedRecord(line).getKeyValues('%').has('eg');
  }

  static clearExampleFlag(line: string): string {
    const t = new TaggedRecord(line);
    const indexes = t.indexesOfTag('%');
    for (let i = indexes.length - 1; i >= 0; i--) {
      if (t.valueAt(indexes[i]) === 'eg') t.removeField(indexes[i]);
    }
    return t.toString();
  }

  static appendField(line: string, tag: string, value: string): string {
    const t = new TaggedRecord(line);
    t.addField(tag, value);
    return t.toString();
  }

  isHidden(): boolean {
    return this.indexesOfTag('%').some((i) => this.valueAt(i) === 'hide');
  }

  /** The key:value fields with the tag, keys in lower case (a later key replaces an earlier one). */
  getKeyValues(tag: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const i of this.indexesOfTag(tag)) {
      const s = this.values[i];
      const k = s.indexOf(':');
      out.set((k === -1 ? s : s.substring(0, k)).toLowerCase(), k === -1 ? '' : s.substring(k + 1));
    }
    return out;
  }

  static escapeBackquotes(s: string): string {
    return s.split('`').join('``');
  }

  static formatField(value: string | null, tag: string): string {
    return value == null ? '' : TaggedRecord.escapeBackquotes(value) + '`' + tag;
  }

  /** A formatted record as a line: newlines removed, a leading '#' or '`' escaped. */
  static toLine(s: string): string;
  static toLine(s: string | null): string | null;
  static toLine(s: string | null): string | null {
    const s1 = TaggedRecord.removeChar(s, '\n');
    if (s1 != null && s1.length !== 0) {
      const c = s1.charAt(0);
      if (c === '#' || c === '`') return '`' + s1;
    }
    return s1;
  }

  static removeChar(s: string | null, c: string): string | null {
    return s == null ? s : s.split(c).join('');
  }

  static isBlankOrComment(s: string): boolean {
    return javaTrim(s) === '' || s.charAt(0) === '#';
  }

  toString(): string {
    let s = '';
    for (let j = 0; j < this.tags.length; j++) s += TaggedRecord.formatField(this.values[j], this.tags.charAt(j));
    return TaggedRecord.toLine(s);
  }
}
