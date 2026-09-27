/**
 * The program-wide configuration of the desktop's LogicProgram (non-formula, non-UI parts):
 * core info, the links table, the `logic` options and their flags, server credentials, the
 * data-file openers, and small helpers. Port of parts of LogicProgram.java,
 * ServerConnection.readDatabaseLinks (the directories) and Credentials.java.
 *
 * This is program-wide state, set up once by loadProgram (loadProgram.ts). The notation and
 * symbol tables are in symbols.ts.
 *
 * Paths: the desktop's links hold absolute paths after rebasing the directory aliases
 * (progDir/, linkDir/, ruleDir/). Here they are paths relative to the data directory of the
 * DataSource: linkDir/ is removed, ruleDir/ becomes syntax1/ or syntax2/, and progDir/ is kept
 * as "progDir/" (the program's own directory has no counterpart on the web).
 */
import * as DataFiles from '../data/DataFiles';
import type { DataSource } from '../data/DataSource';
import { DEFAULT_KEY, ScrambledReader, unscramble } from '../data/Scrambler';
import { TaggedRecord } from '../data/TaggedRecord';
import { Base64Codec } from '../util/Base64Codec';
import { equalsIgnoreCase, javaTrim, parseJavaInt } from '../util/java';
import type { ProblemSelector } from './ProblemSelector';
import { clearAltSymbolsFlag, ruleDirFor, setAltSymbols, setSyntax } from './symbols';

// ---- state ----

let dataSource: DataSource | null = null;
/** coreinfo (version.conf): upper-case keys. */
export let coreInfo: Map<string, string> | null = null;
/** The links table (links.conf): upper-case keys. */
export let links: Map<string, string> | null = null;
/**
 * The key of the scrambled legacy files, or null. The desktop sets it to the default key
 * whenever it runs from version.conf/spirit.txt rather than coreinfo.txt, i.e. always here.
 */
export let scrambleKey: string | null = null;
/** ServerConnection.localDir: the instructor's local additions (links' localDir), relative to data/. */
export let localDir: string | null = null;
/** ServerConnection.editDir. */
export let editDir: string | null = null;

/** The flags and values of the `logic` options (LogicProgram's static fields). */
export const options = {
  debug: false,
  printingEnabled: true,
  overheadColors: false,
  remote: false,
  noNetwork: false,
  hiddenMode: false,
  noCoreProblems: false,
  altSymbols: false,
  maxBackups: 1,
  backupName: null as string | null,
  restoreName: null as string | null,
  soloPort: null as number | null,
  repeatAuth: false,
  hideSensitive: false,
  optionO: null as string | null,
  /** The raw font-size option (the desktop derives a point size from it). */
  fontSize: null as string | null,
};

/** The desktop's local mode (-Dlogic.local=true); the web program always runs in it. */
export const localMode = true;

export class Credentials {
  user: string | null;
  password: string | null;

  constructor(userOrSpec: string | null, password?: string | null) {
    if (password !== undefined) {
      this.user = userOrSpec;
      this.password = password;
      return;
    }
    const i = userOrSpec == null ? -1 : userOrSpec.indexOf(':');
    if (i === -1) {
      this.user = userOrSpec;
      this.password = null;
    } else {
      this.user = userOrSpec!.substring(0, i);
      this.password = userOrSpec!.substring(i + 1);
    }
  }

  toString(): string {
    return this.password == null ? String(this.user) : this.user + ':' + this.password;
  }
}

let credentials: Map<string, Credentials> | null = null;

export function addCredentials(c: Credentials): void {
  if (credentials == null) credentials = new Map();
  credentials.set(String(c.user).toLowerCase(), c);
}

export function getCredentials(user: string | null): Credentials | null {
  return credentials != null && user != null ? credentials.get(user.toLowerCase()) ?? null : null;
}

export function getDataSource(): DataSource {
  if (dataSource == null) throw new Error('the program is not loaded (loadProgram)');
  return dataSource;
}

export function setDataSource(source: DataSource): void {
  dataSource = source;
}

// ---- core info and links ----

/** Reads "key: value" lines (blank and # lines skipped) into a table with upper-case keys. */
function readKeyValues(reader: ScrambledReader): Map<string, string> {
  const table = new Map<string, string>();
  let s: string | null;
  while ((s = reader.readLine()) != null) {
    const i = s.indexOf(':');
    if (!TaggedRecord.isBlankOrComment(s) && i !== -1) {
      table.set(javaTrim(s.substring(0, i)).toUpperCase(), javaTrim(s.substring(i + 1)));
    }
  }
  return table;
}

/**
 * LogicProgram.readCoreInfo: version.conf (or the scrambled spirit.txt). Reading it sets the
 * scramble key, as on the desktop when there is no coreinfo.txt.
 */
export async function readCoreInfo(source: DataSource): Promise<Map<string, string> | null> {
  let chosen = await source.readText('coreinfo.txt').then((t) => (t == null ? null : { path: 'coreinfo.txt', text: t }));
  let key: string | null = null;
  if (chosen == null) {
    chosen = await DataFiles.readChosen(source, DataFiles.VERSION_FILE);
    if (chosen == null) return null;
    // Scrambled mode: legacy data files (e.g. ones sent by the course server) are scrambled.
    key = DEFAULT_KEY;
  }
  const reader = DataFiles.isReadableFormat(chosen.path)
    ? DataFiles.openText(chosen.path, chosen.text, null, null)
    : new ScrambledReader(chosen.text, key);
  const table = readKeyValues(reader);
  if (coreInfo == null) scrambleKey = key;
  coreInfo = table;
  return table;
}

/**
 * LogicProgram.readLinks for the program's links: links.conf (or ghost.txt; links.txt when
 * not in scrambled mode). Selects the notation: `syntax` overrides the links' syntax: entry
 * (as -Dlogic.syntax does in local mode). Rebases the directory aliases (see the header).
 */
export async function readLinks(source: DataSource, syntax?: 1 | 2): Promise<Map<string, string> | null> {
  const chosen =
    scrambleKey == null
      ? await source.readText('links.txt').then((t) => (t == null ? null : { path: 'links.txt', text: t }))
      : await DataFiles.readChosen(source, DataFiles.LINKS_FILE);
  if (chosen == null) return null;
  const reader = DataFiles.isReadableFormat(chosen.path)
    ? DataFiles.openText(chosen.path, chosen.text, null, null)
    : new ScrambledReader(chosen.text, scrambleKey);
  const table = readKeyValues(reader);
  if (localMode && syntax !== undefined) table.set('SYNTAX', String(syntax));
  const n = parseJavaInt(table.get('SYNTAX'));
  setSyntax(n ?? 1);
  rebaseLinks(table, 'PROGDIR', 'progDir');
  rebaseLinks(table, 'LINKDIR', '', true);
  rebaseLinks(table, 'RULEDIR', ruleDirFor());
  links = table;
  readDirectoryLinks();
  return table;
}

/**
 * LogicProgram.rebaseLinks: values starting with the alias key's value get base instead.
 * stripSlash: base is the data directory itself, so "linkDir/options.rec" becomes "options.rec".
 */
export function rebaseLinks(table: Map<string, string>, key: string, base: string, stripSlash = false): void {
  const prefix = table.get(key);
  if (prefix == null) return;
  for (const [k, v] of table) {
    if (k === key || !v.startsWith(prefix)) continue;
    let rest = v.substring(prefix.length);
    if (stripSlash && base === '' && rest.startsWith('/')) rest = rest.substring(1);
    table.set(k, base + rest);
  }
}

/** ServerConnection.readDatabaseLinks: the directory links (paths relative to data/). */
function readDirectoryLinks(): void {
  const e = getLink('editDir');
  editDir = e == null ? null : e;
  const l = getLink('localDir');
  localDir = l == null ? null : l;
}

export function getValue(table: Map<string, string> | null, key: string | null, fallback: string | null): string | null {
  if (table == null || key == null) return fallback;
  return table.get(javaTrim(key).toUpperCase()) ?? fallback;
}

/**
 * LogicProgram.getLink: a link's value, or fallback. (The desktop appends the user's details
 * to the `feedback` link; that link belongs to the course server and is not used here.)
 */
export function getLink(key: string, fallback: string | null = null): string | null {
  return getValue(links, key, fallback);
}

// ---- options ----

/** LogicProgram.resetOptions: clears the `logic` options (before reading base and local options). */
export function resetOptions(): void {
  options.debug = false;
  options.printingEnabled = true;
  options.overheadColors = false;
  options.remote = false;
  options.noNetwork = false;
  options.hiddenMode = false;
  options.noCoreProblems = false;
  options.altSymbols = false;
  clearAltSymbolsFlag();
  options.maxBackups = 1;
  options.backupName = null;
  options.restoreName = null;
  options.soloPort = null;
  options.repeatAuth = false;
  options.optionO = null;
  credentials = null;
}

/** LogicProgram.readOptions: applies the `logic` records of an options file. */
export function readOptions(reader: ScrambledReader | null): boolean {
  if (reader == null) return false;
  const record = TaggedRecord.fromReader(reader, true);
  while (record.readNext()) {
    const name = record.getName();
    if (name == null || !equalsIgnoreCase(javaTrim(name), 'logic')) continue;
    for (const i of record.indexesOfAnyTag('+ufcbrpo')) {
      const tag = record.tagAt(i);
      const value = javaTrim(record.values[i]);
      if (tag === '+') {
        const flag = value.toLowerCase();
        if (flag === 'debug') options.debug = true;
        else if (flag === 'noprint') options.printingEnabled = false;
        else if (flag === 'altsymbols') {
          options.altSymbols = true;
          setAltSymbols(); // the wedge quantifiers
        } else if (flag === 'overhead') options.overheadColors = true;
        else if (flag === 'remote') options.remote = true;
        else if (flag === 'nonet') options.noNetwork = true;
        else if (flag === 'hidden') options.hiddenMode = true;
        else if (flag === 'nocoreprobs') options.noCoreProblems = true;
        else if (flag === 'repeatauth') options.repeatAuth = true;
        else if (flag === 'hidesensitive') options.hideSensitive = true;
      } else if (tag === 'u') {
        const c = new Credentials(value);
        if (c.password != null) c.password = unscramble(decodeDefaultCharset(new Base64Codec(c.password).getBytes()));
        addCredentials(c);
      } else if (tag === 'f') {
        options.fontSize = value;
      } else if (tag === 'c') {
        const n = parseJavaInt(value);
        if (n != null) options.maxBackups = n;
      } else if (tag === 'b') {
        options.backupName = value;
      } else if (tag === 'r') {
        options.restoreName = value;
      } else if (tag === 'p') {
        options.soloPort = parseJavaInt(value);
      } else if (tag === 'o') {
        options.optionO = value;
      }
    }
  }
  if (localMode) options.noNetwork = true;
  if (options.noNetwork) options.remote = false;
  record.close();
  return true;
}

/**
 * new String(bytes) with the default charset (UTF-8): the decoded password bytes. Invalid
 * sequences become U+FFFD as in Java.
 */
function decodeDefaultCharset(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * LogicProgram.selectorMatches: whether the selector selects the problem; a null name means
 * a user-created problem, which the `u` flag selects.
 */
export function selectorMatches(selector: ProblemSelector | null | undefined, name: string | null): boolean {
  return selector != null && (name == null ? selector.hasFlag('u') : selector.contains(name));
}

// ---- data files ----

/** LogicProgram.openDataFile(key, false): the linked data file as tagged-record lines, or null. */
export async function openDataFile(key: string): Promise<ScrambledReader | null> {
  const path = getLink(key);
  if (path == null) return null;
  return DataFiles.open(getDataSource(), path, key, scrambleKey);
}

/** LogicProgram.openLocalFile(key): the file of the same name in the local directory, or null. */
export async function openLocalFile(key: string, edit = false): Promise<ScrambledReader | null> {
  const path = getLink(key);
  const dir = edit ? editDir : localDir;
  if (path == null || dir == null) return null;
  return DataFiles.open(getDataSource(), joinPath(dir, baseName(path)), key, scrambleKey);
}

/** LogicProgram.openProblemFile: the file from the notation's directory, or from local/. */
export async function openProblemFile(key: string, local: boolean): Promise<ScrambledReader | null> {
  const path = getLink(key);
  if (path == null) return null;
  return DataFiles.open(getDataSource(), joinPath(local ? 'local' : ruleDirFor(), baseName(path)), key, scrambleKey);
}

function baseName(path: string): string {
  return path.substring(path.lastIndexOf('/') + 1);
}

function joinPath(dir: string, name: string): string {
  return dir === '' || dir === '.' ? name : dir.replace(/\/+$/, '') + '/' + name;
}

// ---- helpers ----

export function isDemoName(s: string): boolean {
  return equalsIgnoreCase(s, 'Demo') || equalsIgnoreCase(s, 'Test');
}

/**
 * LogicProgram.stripNamePrefix: a problem name without its prefix: "Deriv 1.7" -> "1.7"
 * (the part after the last '.' of the first word, when the name has a blank).
 */
export function stripNamePrefix(s: string): string;
export function stripNamePrefix(s: string | null): string | null;
export function stripNamePrefix(s: string | null): string | null {
  if (s == null) return null;
  const t = javaTrim(s);
  const i = t.indexOf(' ');
  if (i === -1) return t;
  const j = t.substring(0, i).lastIndexOf('.');
  return j === -1 ? t : javaTrim(t.substring(j + 1));
}

/** LogicProgram.splitLines: the lines of s, split at "\n". */
export function splitLines(s: string): string[] {
  return s.split('\n');
}

export function reverse(s: string | null): string | null {
  return s == null ? null : s.split('').reverse().join('');
}

export function splitChars(s: string | null): string[] {
  return s == null ? [] : s.split('');
}

export function toHex8(i: number): string {
  const s = '00000000' + (i < 0 ? '-' + (-i).toString(16) : i.toString(16));
  return s.substring(s.length - 8);
}

export function lastChars(s: string | null, n: number): string | null {
  if (s == null) return null;
  return s.length < n ? s : s.substring(s.length - n);
}

/** LogicProgram.parseErrorColumn: the column in a parser message "..., column N.", or -1. */
export function parseErrorColumn(s: string | null): number {
  const marker = ', column ';
  let i: number;
  if (s != null && (i = s.indexOf(marker)) !== -1) {
    const k = i + marker.length;
    const j = s.indexOf('.', k);
    if (j !== -1) return parseJavaInt(s.substring(k, j)) ?? -1;
  }
  return -1;
}

/** LogicProgram.utcTimestamp: "UTC: yyyy-MM-dd HH:mm:ss". */
export function utcTimestamp(date = new Date()): string {
  return 'UTC: ' + date.toISOString().substring(0, 19).replace('T', ' ');
}

/** LogicProgram.compactTimestamp: local time as yyyyMMdd.HHmmss. */
export function compactTimestamp(date = new Date()): string {
  const two = (n: number) => lastChars('0' + n, 2);
  return (
    '' + date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) + '.' +
    two(date.getHours()) + two(date.getMinutes()) + two(date.getSeconds())
  );
}
