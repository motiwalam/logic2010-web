// Recognizing uploaded work files: which module's work a file holds (from its name, its
// header comment or its fields), and converting the older one-line-per-record format
// (derwork.txt, ...) to the readable .rec format the workspace stores.

import * as DataFiles from '../engine/data/DataFiles';
import { TaggedRecord } from '../engine/data/TaggedRecord';
import { UserInfo } from '../engine/program/UserInfo';
import { WORK_FILES, type WorkFileInfo } from './paths';

export interface DetectedFile {
  info: WorkFileInfo;
  /** 'readable': .rec "field: value" records; 'legacy': tagged one-line records. */
  format: 'readable' | 'legacy';
  /** How the module was recognized. */
  by: 'name' | 'header' | 'fields';
}

/** Name fragments of each work file (checked in this order: the answers file before symbolization). */
const NAME_HINTS: readonly [string, readonly string[]][] = [
  ['symbolization-answers.rec', ['symbolization-answers', 'symbolization_answers', 'keywork', 'answer-keys', 'answers']],
  ['derivation.rec', ['derivation', 'derwork', 'deriv']],
  ['invalidity.rec', ['invalidity', 'invwork', 'inval']],
  ['parsing.rec', ['parsing', 'parwork']],
  ['recognition.rec', ['recognition', 'recwork', 'recog']],
  ['symbolization.rec', ['symbolization', 'symwork', 'symb']],
  ['truth-tables.rec', ['truth-tables', 'truth_tables', 'truth tables', 'truthtables', 'truwork', 'truth']],
];

/** Fields that only one kind of work file has. */
const FIELD_HINTS: readonly [string, readonly string[]][] = [
  ['symbolization-answers.rec', ['answer-key']],
  ['derivation.rec', ['show', 'line', 'reason', 'end-box', 'proves', 'collapsed-show', 'cached-justification']],
  ['invalidity.rec', ['universe-size', 'interpretation']],
  ['parsing.rec', ['formula', 'notation', 'expansion', 'main-connective-answer']],
  ['recognition.rec', ['correct-rules', 'near-miss-rules']],
  ['symbolization.rec', ['english', 'node', 'scheme', 'answer-keys', 'answer-group', 'hints']],
  ['truth-tables.rec', ['row', 'counterexample-row', 'setup']],
  // weaker hints, for files without work yet
  ['recognition.rec', ['comment']],
  ['truth-tables.rec', ['statement']],
  ['invalidity.rec', ['argument']],
];

/** Tags of the older format that only one module uses. */
const LEGACY_TAG_HINTS: readonly [string, string][] = [
  ['derivation.rec', '<>'],
  ['parsing.rec', '[]'],
  ['recognition.rec', '~'],
];

function byFile(file: string): WorkFileInfo {
  return WORK_FILES.find((w) => w.file === file)!;
}

function baseName(name: string): string {
  return name.substring(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).toLowerCase();
}

/** Whether the text is in the older tagged format (records like "value`$ ... value`t"). */
export function isLegacyText(text: string): boolean {
  let tagged = 0;
  let fields = 0;
  for (const line of text.split(/\r\n|\r|\n/).slice(0, 200)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (/^\s*[A-Za-z][A-Za-z0-9-]*:/.test(line) && !/`./.test(line.split(':')[0])) fields++;
    if (/[^`]`[^`\s]/.test(line) || /`\$/.test(line)) tagged++;
  }
  return tagged > fields;
}

/** Which module's work the file holds, or null if it cannot tell. */
export function detectWorkFile(fileName: string, text: string): DetectedFile | null {
  const name = baseName(fileName);
  const legacy = name.endsWith('.txt') ? true : name.endsWith('.rec') ? false : isLegacyText(text);
  const format = legacy ? 'legacy' : 'readable';

  // 1. the header comment the program writes ("# Derivation work, saved by the program.")
  const first = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  for (const w of WORK_FILES) {
    if (first.startsWith('# ' + w.title + ',')) return { info: w, format, by: 'header' };
  }
  // 2. the file name
  for (const [file, hints] of NAME_HINTS) {
    if (hints.some((h) => name.includes(h))) return { info: byFile(file), format, by: 'name' };
  }
  // 3. the fields
  if (!legacy) {
    const names = new Set<string>();
    for (const line of text.split(/\r\n|\r|\n/)) {
      const m = /^\s*([a-z][a-z-]*):/.exec(line);
      if (m) names.add(m[1]);
    }
    for (const [file, hints] of FIELD_HINTS) {
      if (hints.some((h) => names.has(h))) return { info: byFile(file), format, by: 'fields' };
    }
  } else {
    const tags = new Set<string>();
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (line.startsWith('#') || line.trim() === '') continue;
      const t = new TaggedRecord(line);
      for (let i = 0; i < t.getFieldCount(); i++) tags.add(t.tagAt(i));
    }
    for (const [file, hint] of LEGACY_TAG_HINTS) {
      if ([...hint].some((c) => tags.has(c))) return { info: byFile(file), format, by: 'fields' };
    }
  }
  return null;
}

export interface ConvertedWork {
  text: string;
  /** False when the file's digest did not match its records (the module will refuse it, as the desktop does). */
  digestOk: boolean;
}

/**
 * The file as a readable .rec text. A legacy file is converted the way the desktop converts
 * it on first opening: its records are rewritten in the readable format with a new digest
 * (for the local user), provided its own digest was valid; otherwise the old digest is kept.
 */
export function toReadableWork(detected: DetectedFile, fileName: string, text: string): ConvertedWork {
  if (detected.format === 'readable') return { text, digestOk: true };
  const internal = detected.info.internal;
  const legacyName = baseName(fileName).endsWith('.txt') ? baseName(fileName) : internal;
  const reader = DataFiles.openWorkText(legacyName, text, internal);
  const records: string[] = [];
  let stored: string | null = null;
  for (const line of reader.readAll()) {
    if (TaggedRecord.isBlankOrComment(line)) {
      if (line.startsWith('#') && !line.startsWith('#-')) stored = line.substring(1).trim();
    } else records.push(line);
  }
  const user = UserInfo.localUser();
  const digestOk = stored != null && (user.computeDigest(records, '1') === stored || user.computeDigest(records, null) === stored);
  const schema = DataFiles.schemaForKey(internal);
  const canonical = DataFiles.canonicalRecords(records, schema);
  const digest = digestOk ? user.computeDigest(canonical, '1') : stored;
  return { text: DataFiles.writeWork(internal, canonical, digest), digestOk };
}
