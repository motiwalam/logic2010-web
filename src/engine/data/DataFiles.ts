/**
 * Port of DataFiles.java: reads the program's data files (problems, answers, rules,
 * theorems, messages, options, tips, links and version info) and writes the student's work.
 *
 * The data files are plain text in three readable formats (see data/README.md):
 *
 *   *.rec   record files: "field: value" lines; records are separated by blank lines
 *           (or "## heading" lines); "# comment" lines are ignored
 *   *.list  rule/theorem lists: "NAME  BODY" lines, plus headings and comments
 *   *.conf  "key: value" settings (version.conf, links.conf)
 *
 * Internally the program works with "tagged record" lines, where every field is written
 * as value`t with a one-character tag t (see TaggedRecord). This module translates the
 * readable files into that line form, so the rest of the program is unchanged: open()
 * returns a reader that yields exactly the lines the program expects.
 *
 * The older scrambled files (spirit.txt, ghost.txt, ghoul.txt, ...) are still understood.
 *
 * Deviation: the desktop program uses the newer of a readable file and its legacy
 * counterpart when both exist. A DataSource has no modification times, so here the file
 * asked for is used when it exists, and its counterpart otherwise (chooseWorkText likewise
 * prefers the readable work file).
 */
import { javaTrim } from '../util/java';
import type { DataSource } from './DataSource';
import { toSymbols, toWords } from './QuantifierWords';
import { ScrambledReader } from './Scrambler';
import { TaggedRecord } from './TaggedRecord';

export const VERSION_FILE = 'version.conf';
export const LINKS_FILE = 'links.conf';

/** Legacy file name and its readable replacement, relative to the same directory. */
export const FILE_ALIASES: readonly (readonly [string, string])[] = [
  ['spirit.txt', 'version.conf'],
  ['ghost.txt', 'links.conf'],
  ['wraith.txt', 'options.rec'],
  ['imp.txt', 'derivation-tips.rec'],
  ['spectre.txt', 'messages/general.rec'],
  ['zombie.txt', 'messages/derivation.rec'],
  ['tomb.txt', 'messages/invalidity.rec'],
  ['shade.txt', 'messages/parsing.rec'],
  ['demon.txt', 'messages/symbolization.rec'],
  ['crypt.txt', 'messages/truth-tables.rec'],
  ['troll.txt', 'messages/recognition.rec'],
  ['ghoul.txt', 'derivation-problems.rec'],
  ['werewolf.txt', 'invalidity-problems.rec'],
  ['vampire.txt', 'parsing-problems.rec'],
  ['devil.txt', 'symbolization-problems.rec'],
  ['mummy.txt', 'symbolization-answers.rec'],
  ['warlock.txt', 'truth-table-problems.rec'],
  ['goblin.txt', 'recognition-problems.rec'],
  ['banshee.txt', 'rules.list'],
  ['fiend.txt', 'theorems.list'],
];

/**
 * The student's work files: the program's internal name (the name the files had in the
 * older format), the readable file that replaces it, and its title.
 */
export const WORK_FILES: readonly (readonly [string, string, string])[] = [
  ['derwork.txt', 'derivation.rec', 'Derivation work'],
  ['invwork.txt', 'invalidity.rec', 'Invalidity work'],
  ['parwork.txt', 'parsing.rec', 'Parsing work'],
  ['recwork.txt', 'recognition.rec', 'Rule-recognition work'],
  ['symwork.txt', 'symbolization.rec', 'Symbolization work'],
  ['truwork.txt', 'truth-tables.rec', 'Truth-table work'],
  ['keywork.txt', 'symbolization-answers.rec', 'Answer keys for your own symbolization problems'],
];

/** Last line of a work file: the digest the program checks the records against. */
export const DIGEST_COMMENT = '# digest:';

/** Readable link names used in links.conf, and the program's internal link keys. */
export const LINK_ALIASES: readonly (readonly [string, string])[] = [
  ['derivation-problems', 'derwork.txt'],
  ['invalidity-problems', 'invwork.txt'],
  ['parsing-problems', 'parwork.txt'],
  ['symbolization-problems', 'symwork.txt'],
  ['truth-table-problems', 'truwork.txt'],
  ['recognition-problems', 'recwork.txt'],
  ['symbolization-answers', 'symAnswers'],
  ['derivation-messages', 'derMessages'],
  ['invalidity-messages', 'invMessages'],
  ['parsing-messages', 'parMessages'],
  ['symbolization-messages', 'symMessages'],
  ['truth-table-messages', 'truMessages'],
  ['recognition-messages', 'recMessages'],
  ['derivation-tips', 'tips'],
];

/** Which record schema the data behind each internal link key uses. */
export const KEY_SCHEMAS: readonly (readonly [string, string])[] = [
  ['derwork.txt', 'derivation-problems'],
  ['invwork.txt', 'invalidity-problems'],
  ['parwork.txt', 'parsing-problems'],
  ['symwork.txt', 'symbolization-problems'],
  ['truwork.txt', 'truth-table-problems'],
  ['recwork.txt', 'recognition-problems'],
  ['keywork.txt', 'symbolization-answers'],
  ['symAnswers', 'symbolization-answers'],
  ['messages', 'messages'],
  ['derMessages', 'messages'],
  ['invMessages', 'messages'],
  ['parMessages', 'messages'],
  ['symMessages', 'messages'],
  ['truMessages', 'messages'],
  ['recMessages', 'messages'],
  ['options', 'options'],
  ['tips', 'tips'],
];

// Field names of each record schema: "<tag> <name> [<more accepted names>]".
// The first name is the one written; every listed name is accepted.
const COMMON_PROBLEM_FIELDS = ['$ problem', '% options', '! note', 'C common-name', 'o original-name', 'e errors', 't seconds'];
const SCHEMAS: readonly (readonly [string, readonly string[]])[] = [
  ['derivation-problems', [
    '- statement show', '+ collapsed-show', '< line', '> reason', '# cancel', '= end-box',
    ': cached-justification', 's command', 'm message', '? flag', 'p proves']],
  ['invalidity-problems', ['? argument', '# universe-size', '= interpretation', '& workspace']],
  ['parsing-problems', ['= formula', '[ notation', '] expansion', '* main-connective-answer']],
  ['symbolization-problems', ['- english', '+ node', '= scheme', '@ answer-keys', 'g answer-group', 'h hints']],
  ['symbolization-answers', ['$ answer-key', '- english', '+ node', 'e errors', 't seconds']],
  ['truth-table-problems', ['= statement', '@ row', '* answer', '# counterexample-row', '& setup']],
  ['recognition-problems', ['= argument', '* answer', '@ correct-rules', '~ near-miss-rules', '& comment']],
  ['messages', [
    's sort', 'n id', 'e error', 'E error-revised', 'i info', 'I info-revised', 'x text',
    'd description', 'p programmer-note', 'b buttons']],
  ['tips', ['$ text', '+ entry', '- expanded-entry', '= end']],
  ['options', ['$ section', '+ set', '- unset', '? option']],
  ['options/logic', [
    'u login', 'f font-size', 'c backup-count', 'b backup-name', 'r restore-name',
    'p instance-port', 'o option-o']],
  ['options/derivation', [
    'd disable', 'D disable-all-forms', 'm manual', 'M manual-all-forms', 'a assume-weakly', 'A assume']],
  ['options/recognition', ['a activate-rules']],
];

/**
 * The fields that hold formulas, by schema: their quantifiers may be written as words
 * ("forall x", "exists x"; see QuantifierWords). A symbolization node holds a formula
 * part before its first ':' and English after it; only the formula part is converted.
 */
const FORMULA_FIELDS: readonly (readonly [string, string])[] = [
  ['derivation-problems', '-+<'],
  ['invalidity-problems', '?'],
  ['parsing-problems', '='],
  ['recognition-problems', '='],
  ['truth-table-problems', '='],
  ['symbolization-problems', '+'],
  ['symbolization-answers', '+'],
];

const schemaTagToName = new Map<string, string>(); // "schema\0tag" -> name
const schemaNameToTag = new Map<string, string>(); // "schema\0name" -> tag

function defineFields(schema: string, fields: readonly string[]): void {
  for (const field of fields) {
    const parts = field.split(' ');
    const tag = parts[0].charAt(0);
    schemaTagToName.set(schema + '\u0000' + tag, parts[1]);
    for (let j = 1; j < parts.length; j++) schemaNameToTag.set(schema + '\u0000' + parts[j], tag);
  }
}

for (const [schema, fields] of SCHEMAS) {
  if (schema.endsWith('-problems')) defineFields(schema, COMMON_PROBLEM_FIELDS);
  defineFields(schema, fields);
}

/** Receives the warnings about data file lines (the desktop prints them on standard error). */
export let warningHandler: (message: string) => void = (message) => console.warn(message);

export function setWarningHandler(handler: (message: string) => void): void {
  warningHandler = handler;
}

function warn(fileName: string, lineNo: number, message: string): void {
  warningHandler('data file ' + fileName + ':' + lineNo + ': ' + message);
}

export function isFormulaField(schema: string | null, tag: string): boolean {
  for (const [s, tags] of FORMULA_FIELDS) {
    if (s === schema) return tags.indexOf(tag) !== -1;
  }
  return false;
}

/** A field's value with its quantifiers as words (toWords) or as the program's @ and ! symbols. */
export function convertQuantifiers(schema: string | null, tag: string, value: string, words: boolean): string {
  if (!isFormulaField(schema, tag)) return value;
  if (schema!.startsWith('symbolization')) {
    const i = value.indexOf(':');
    let s = i === -1 ? value : value.substring(0, i);
    s = words ? toWords(s) : toSymbols(s);
    return i === -1 ? s : s + value.substring(i);
  }
  return words ? toWords(value) : toSymbols(value);
}

export function schemaForKey(key: string | null): string | null {
  if (key == null) return null;
  for (const [k, schema] of KEY_SCHEMAS) {
    if (k.toLowerCase() === key.toLowerCase()) return schema;
  }
  return null;
}

/** The program's internal link key for a key found in links.conf. */
export function internalLinkKey(key: string): string {
  for (const [name, internal] of LINK_ALIASES) {
    if (name.toLowerCase() === key.toLowerCase()) return internal;
  }
  return key;
}

/** The legacy or readable counterpart of a path (same directory), or null. */
export function counterpartPath(path: string): string | null {
  for (const alias of FILE_ALIASES) {
    for (let j = 0; j < 2; j++) {
      const name = alias[j];
      if (path === name || path.endsWith('/' + name)) {
        return path.substring(0, path.length - name.length) + alias[1 - j];
      }
    }
  }
  return null;
}

export function isReadableFormat(path: string): boolean {
  const name = path.substring(path.lastIndexOf('/') + 1);
  return name.endsWith('.rec') || name.endsWith('.list') || name.endsWith('.conf');
}

/**
 * DataFiles.choose + read: the text of the file at path, or of its legacy/readable
 * counterpart; null if neither exists.
 */
export async function readChosen(source: DataSource, path: string): Promise<{ path: string; text: string } | null> {
  const text = await source.readText(path);
  if (text != null) return { path, text };
  const other = counterpartPath(path);
  if (other != null) {
    const otherText = await source.readText(other);
    if (otherText != null) return { path: other, text: otherText };
  }
  return null;
}

/** The tagged-record text of a file's contents (readable formats are converted). */
export function toTaggedText(path: string, text: string, key: string | null): string | null {
  if (!isReadableFormat(path)) return null;
  const lines = splitFileLines(text);
  if (path.endsWith('.rec')) return recordsToTaggedLines(lines, schemaForKey(key), path);
  if (path.endsWith('.list')) return listToLines(lines);
  return confToLines(lines);
}

/**
 * DataFiles.open on a file's contents: a reader of tagged-record lines. key is the
 * internal link key (it selects the record schema); a legacy file is unscrambled with
 * scrambleKey.
 */
export function openText(path: string, text: string, key: string | null, scrambleKey: string | null): ScrambledReader {
  const tagged = toTaggedText(path, text, key);
  return tagged == null ? new ScrambledReader(text, scrambleKey) : new ScrambledReader(tagged, null);
}

/** DataFiles.open: reads the file (or its counterpart) and opens it; null if neither exists. */
export async function open(
  source: DataSource,
  path: string,
  key: string | null,
  scrambleKey: string | null,
): Promise<ScrambledReader | null> {
  const chosen = await readChosen(source, path);
  return chosen == null ? null : openText(chosen.path, chosen.text, key, scrambleKey);
}

/** The lines of a file as BufferedReader.readLine returns them. */
export function splitFileLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** "## text" -> "#-text", "# text" -> "#text": headings and comments as the program writes them. */
export function commentLine(line: string): string {
  if (line.startsWith('##')) return '#-' + stripOneSpace(line.substring(2));
  return '#' + stripOneSpace(line.substring(1));
}

function stripOneSpace(s: string): string {
  return s.startsWith(' ') ? s.substring(1) : s;
}

/** Converts a .rec file to tagged-record lines, one line per record. */
export function recordsToTaggedLines(lines: readonly string[], schema: string | null, fileName: string): string {
  let out = '';
  let record: string | null = null;
  let section: string | null = null;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const trimmed = javaTrim(line);
    if (trimmed === '' || line.startsWith('##')) {
      // blank lines and headings end a record
      if (record != null) {
        out += endRecord(record);
        record = null;
      }
      if (line.startsWith('#')) out += commentLine(line) + '\n';
    } else if (line.startsWith(DIGEST_COMMENT)) {
      // the program reads the digest from the last "#" line of a work file
      out += '# ' + javaTrim(line.substring(DIGEST_COMMENT.length)) + '\n';
    } else if (line.startsWith('#')) {
      out += commentLine(line) + '\n';
    } else {
      const colon = trimmed.indexOf(':');
      if (colon <= 0) {
        warn(fileName, n + 1, 'expected "field: value"');
      } else {
        const name = javaTrim(trimmed.substring(0, colon));
        const value = parseValue(javaTrim(trimmed.substring(colon + 1)), fileName, n + 1);
        if (record == null) {
          record = '';
          section = null;
        }
        if (schema === 'options' && name === 'section') section = javaTrim(value).toLowerCase();
        const tag = tagFor(schema, section, name);
        if (tag == null) {
          warn(fileName, n + 1, 'unknown field "' + name + '"');
        } else {
          record += escapeValue(convertQuantifiers(schema, tag, value, false)) + '`' + tag;
        }
      }
    }
  }
  if (record != null) out += endRecord(record);
  return out;
}

/**
 * A record's line. A line starting with a backquote loses that character when parsed, and
 * one starting with '#' is a comment: protect both with a leading backquote.
 */
function endRecord(record: string): string {
  const c = record.charAt(0);
  return (record.length > 0 && (c === '`' || c === '#') ? '`' : '') + record + '\n';
}

/** The tag of a field name in a schema (and options section), or null. */
export function tagFor(schema: string | null, section: string | null, name: string): string | null {
  if (name.startsWith('tag-')) {
    const t = name.substring(4);
    if (t === 'space') return ' ';
    if (t === 'colon') return ':';
    return t.length === 1 ? t : null;
  }
  if (schema == null) return null;
  let tag: string | undefined;
  if (section != null) tag = schemaNameToTag.get(schema + '/' + section + '\u0000' + name);
  if (tag === undefined) tag = schemaNameToTag.get(schema + '\u0000' + name);
  return tag ?? null;
}

/** A value is either raw text, or a JSON-style "quoted string" (used when it has surrounding blanks). */
export function parseValue(s: string, fileName: string, lineNo: number): string {
  if (!s.startsWith('"')) return s;
  if (s.length < 2 || !s.endsWith('"')) {
    warn(fileName, lineNo, 'unterminated quoted value');
    return s;
  }
  let out = '';
  for (let i = 1; i < s.length - 1; i++) {
    const c = s.charAt(i);
    if (c === '\\' && i + 1 < s.length - 1) {
      const e = s.charAt(++i);
      switch (e) {
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u':
          if (i + 4 <= s.length - 2) {
            const hex = s.substring(i + 1, i + 5);
            // Integer.parseInt(hex, 16) throws on anything else
            if (!/^[+-]?[0-9a-fA-F]+$/.test(hex)) throw new Error('NumberFormatException: For input string: "' + hex + '"');
            out += String.fromCharCode(parseInt(hex, 16) & 0xffff);
            i += 4;
          }
          break;
        default: out += e;
      }
    } else {
      out += c;
    }
  }
  return out;
}

export function escapeValue(value: string): string {
  return value.split('`').join('``');
}

/** Character.isWhitespace. */
function isJavaWhitespace(c: string): boolean {
  const code = c.charCodeAt(0);
  if ((code >= 9 && code <= 13) || (code >= 0x1c && code <= 0x20)) return true;
  if (code < 0x80 || code === 0xa0 || code === 0x2007 || code === 0x202f) return false;
  return /[\p{Zs}\p{Zl}\p{Zp}]/u.test(c);
}

/** Rule and theorem lists: "NAME  BODY" lines become "NAME\tBODY". */
export function listToLines(lines: readonly string[]): string {
  let out = '';
  for (const line of lines) {
    if (line.startsWith('#')) {
      out += commentLine(line) + '\n';
    } else if (javaTrim(line) !== '') {
      const trimmed = javaTrim(line);
      let i = 0;
      while (i < trimmed.length && !isJavaWhitespace(trimmed.charAt(i))) i++;
      out += trimmed.substring(0, i) + '\t' + toSymbols(javaTrim(trimmed.substring(i))) + '\n';
    }
  }
  return out;
}

/** "key: value" settings; readable link names are translated to the internal keys. */
export function confToLines(lines: readonly string[]): string {
  let out = '';
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (line.startsWith('#') || colon === -1) out += line + '\n';
    else out += internalLinkKey(javaTrim(line.substring(0, colon))) + ':' + line.substring(colon + 1) + '\n';
  }
  return out;
}

/** The readable name of a work file, given its internal name; null if it is not a work file. */
export function workFileName(internalName: string): string | null {
  for (const [internal, name] of WORK_FILES) {
    if (internal.toLowerCase() === internalName.toLowerCase()) return name;
  }
  return null;
}

/**
 * DataFiles.openWork on a work file's contents: a PlainRecordReader of its tagged-record
 * lines. fileName says which format it is in (e.g. "derivation.rec" or "derwork.txt").
 */
export function openWorkText(fileName: string, text: string, internalName: string): ScrambledReader {
  if (!isReadableFormat(fileName)) return new ScrambledReader(text, null, true);
  return new ScrambledReader(recordsToTaggedLines(splitFileLines(text), schemaForKey(internalName), fileName), null, true);
}

/**
 * DataFiles.legacyWorkBytes: a work file in the older format (the format of server
 * backups). Lines end with lineSeparator (the desktop uses the platform's).
 */
export function legacyWorkText(fileName: string, text: string, internalName: string, lineSeparator = '\n'): string {
  if (!isReadableFormat(fileName)) return text;
  const lines = splitFileLines(text);
  let digest: string | null = null;
  let out = '';
  const records = recordsToTaggedLines(lines, schemaForKey(internalName), fileName).split('\n');
  for (const line of lines) {
    if (line.startsWith(DIGEST_COMMENT)) digest = javaTrim(line.substring(DIGEST_COMMENT.length));
  }
  for (const r of records) {
    if (r !== '' && !r.startsWith('#')) out += r + lineSeparator;
  }
  if (digest != null) out += '# ' + digest + lineSeparator;
  return out;
}

/**
 * The records to save, each exactly as it will read back from its readable form. The
 * digest is computed over these, so it matches the records the program reads next time.
 * Records without fields are left out (there is nothing to write for them).
 */
export function canonicalRecords(records: readonly string[], schema: string | null = null): string[] {
  const out: string[] = [];
  for (const r of records) {
    const t = new TaggedRecord(r);
    if (t.getFieldCount() === 0) continue;
    let fields = '';
    for (let j = 0; j < t.getFieldCount(); j++) {
      let value = t.values[j];
      if (schema != null) {
        value = convertQuantifiers(schema, t.tagAt(j), convertQuantifiers(schema, t.tagAt(j), value, true), false);
      }
      fields += escapeValue(value) + '`' + t.tagAt(j);
    }
    const line = endRecord(fields);
    out.push(line.substring(0, line.length - 1));
  }
  return out;
}

/**
 * DataFiles.writeWork: a work file's text in the readable format: records (from
 * canonicalRecords) as "field: value" blocks, then the digest, if any. The file is named
 * workFileName(internalName).
 */
export function writeWork(internalName: string, records: readonly string[], digest: string | null): string {
  const name = workFileName(internalName);
  const schema = schemaForKey(internalName);
  let title = name;
  for (const [, n, t] of WORK_FILES) if (n === name) title = t;
  let out = '';
  out += '# ' + title + ', saved by the program.\n';
  out += "# Format: see data/README.md; the fields are those of the course's " + schema + '.rec.\n';
  if (digest != null) out += '# The digest on the last line must match the records, or the program refuses the file.\n';
  for (const r of records) {
    out += '\n';
    out += writeRecord(new TaggedRecord(r), schema);
  }
  if (digest != null) out += '\n' + DIGEST_COMMENT + ' ' + digest + '\n';
  return out;
}

/**
 * One record as "field: value" lines. In a derivation, the lines of each Show line's box
 * are indented under it (indentation is ignored when the file is read).
 */
export function writeRecord(t: TaggedRecord, schema: string | null): string {
  const derivation = schema === 'derivation-problems';
  let firstShow = true;
  let depth = 0;
  let lineDepth = 0;
  let out = '';
  for (let i = 0; i < t.getFieldCount(); i++) {
    const tag = t.tagAt(i);
    let name = schemaTagToName.get(schema + '\u0000' + tag);
    if (name === undefined) name = tag === ' ' ? 'tag-space' : tag === ':' ? 'tag-colon' : 'tag-' + tag;
    let indent = 0;
    if (derivation) {
      if (tag === '-' || tag === '+' || tag === '<') {
        lineDepth = depth;
        if (tag !== '<') depth++;
      } else if (tag === '#' || tag === '=') {
        depth = Math.max(depth - 1, 0);
        lineDepth = depth;
      }
      if (tag === '-') {
        name = firstShow ? 'statement' : 'show';
        firstShow = false;
      }
      // the problem's own fields stay at the left; a line's fields go with the line
      indent = '-+<#=>:sm?'.indexOf(tag) !== -1 ? lineDepth : 0;
    }
    out += '  '.repeat(indent);
    out += name + ':' + formatValue(convertQuantifiers(schema, tag, t.values[i], true)) + '\n';
  }
  return out;
}

/** " value", or " \"quoted\"" when the value's blanks or characters would not survive as raw text. */
export function formatValue(v: string): string {
  if (v === '') return '';
  let quote = v !== javaTrim(v) || v.startsWith('"');
  for (let i = 0; i < v.length && !quote; i++) quote = v.charCodeAt(i) < 32;
  if (!quote) return ' ' + v;
  let out = ' "';
  for (let i = 0; i < v.length; i++) {
    const c = v.charAt(i);
    if (c === '"' || c === '\\') out += '\\' + c;
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c.charCodeAt(0) < 32) out += '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
    else out += c;
  }
  return out + '"';
}
