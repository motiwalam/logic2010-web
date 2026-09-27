/**
 * The notation-dependent tables and symbol helpers of the desktop program.
 * Port of LogicConstants.java (the symbol tables and letter sets) and of the symbol and
 * letter parts of LogicProgram.java (setSyntax, translateSymbols, shiftPositions,
 * findNumberedPlaceholder, sentenceLetter, ..., expandEscapes).
 *
 * Program-wide configuration: the current notation and tables are module-level state,
 * set once when the program loads (setSyntax, and the `altsymbols` option).
 */

/** Formulas inside the program ("Maggie-talk"). */
export const maggie: readonly string[] = ['@', '!', '%', '~', '&', '|', '->', '<->', '<>', '[m]', '.:', '\\'];
/** Backslash codes for the symbols. */
export const rob: readonly string[] = ['\\u', '\\e', '\\d', '\\n', '\\a', '\\o', '\\c', '\\b', '\\i', '\\m', '\\t', '\\\\'];
/** Display symbols with the wedge quantifiers (the `altsymbols` option). */
export const kaplan1: readonly string[] = ['⋀', '⋁', '℩', '∼', '∧', '∨', '→', '↔', '≠', '∊', '∴', '\\'];
/** Display symbols with ∀ and ∃ (the default in both notations). */
export const kaplan2: readonly string[] = ['∀', '∃', '℩', '∼', '∧', '∨', '→', '↔', '≠', '∊', '∴', '\\'];
export const kaplan3: readonly string[] = ['⋀', '⋁', '℩', '∼', '∧', '∨', '⟶', '⟷', '≠', '∊', '∴', '\\'];
export const kaplan4: readonly string[] = ['∀', '∃', '℩', '∼', '∧', '∨', '⟶', '⟷', '≠', '∊', '∴', '\\'];
/** Storage encodings (private font code points) for notation 1 and 2. */
export const kaplan5: readonly string[] = ['ȯɜ', 'ɜȯ', 'ũ', 'ž', 'Ǚ', 'ǚ', 'Ʈ', 'ƫ', 'ƹ', 'ǎ', 'Ŝ', '\\'];
export const kaplan6: readonly string[] = ['Ģ', 'Ĥ', 'ũ', 'ž', 'Ǚ', 'ǚ', 'Ʈ', 'ƫ', 'ƹ', 'ǎ', 'Ŝ', '\\'];
export const kaplan7: readonly string[] = ['Ģ', 'Ĥ', 'ũ', 'ž', 'Ħ', 'Ů', 'ĭľ', 'ļĭľ', 'ģ', 'ť', 'Ŝ', '\\'];
export const html1: readonly string[] = [
  '&#x22C0;', '&#x22C1;', '&#x2129;', '&#x223C;', '&#x2227;', '&#x2228;', '&#x2192;', '&#x2194;', '&#x2260;', '&#x220A;', '&#x2234;', '\\',
];
export const html2: readonly string[] = [
  '&#x2200;', '&#x2203;', '&#x2129;', '&#x223C;', '&#x2227;', '&#x2228;', '&#x2192;', '&#x2194;', '&#x2260;', '&#x220A;', '&#x2234;', '\\',
];
export const html3: readonly string[] = [
  '&#34;', '&#36;', '&#105;', '&#126;', '&#217;', '&#218;', '&#174;', '&#171;', '&#185;', '&#206;', '&#92;',
].map((c) => `<font face="Symbol">${c}</font>`).concat(['\\']);

export const sentenceLetters1 = 'PQRSTUVWXYZ';
export const sentenceLetters2 = 'PQRSTUVWXYZ';
export const monadicLetters1 = 'FGHIJKLMNO';
export const monadicLetters2 = 'FGHIJKLMNOABCDE';
export const operationLetters1 = 'ABCDE';
export const operationLetters2 = 'abcdefgh';
export const variableLetters1 = 'abcdefghijklmnopqrstuvwxyz';
export const variableLetters2 = 'ijklmnopqrstuvwxyz';
export const topVariables = 'xyzuvw';
export const autoVariables = 'xyzuvwlmnopqrst';

// ---- current notation (LogicProgram's static fields) ----

let syntax: 1 | 2 = 1;
/** The display symbols, parallel to maggie (LogicProgram.symbols). */
export let symbols: readonly string[] = kaplan2;
/** LogicProgram.encodedSymbols. */
export let encodedSymbols: readonly string[] = kaplan5;
/** LogicProgram.htmlSymbols. */
export let htmlSymbols: readonly string[] = html2;
export let sentenceLetters = 'PQRSTUVWXYZ';
export let predicateLetters = 'FGHIJKLMNO';
export let operationLetters = 'ABCDE';
export let variableLetters = 'abcdefghijklmnopqrstuvwxyz';
let altSymbols = false;

/** The current notation (FormulaParser.getSyntax). */
export function getSyntax(): 1 | 2 {
  return syntax;
}

/**
 * LogicProgram.setSyntax: selects the notation's tables. A number other than 1 or 2 keeps
 * the current notation (as FormulaParser.setSyntax does) and re-applies its tables.
 * The notation's rule directory is ruleDirFor(getSyntax()).
 */
export function setSyntax(n: number): void {
  if (n === 1 || n === 2) syntax = n;
  // quantifiers are shown as the traditional symbols in both notations (kaplan1 and
  // html1 have wedges); encodedSymbols is a storage encoding and stays per notation
  symbols = kaplan2;
  htmlSymbols = html2;
  sentenceLetters = 'PQRSTUVWXYZ';
  if (syntax === 1) {
    encodedSymbols = kaplan5;
    predicateLetters = 'FGHIJKLMNO';
    operationLetters = 'ABCDE';
    variableLetters = 'abcdefghijklmnopqrstuvwxyz';
  } else {
    encodedSymbols = kaplan6;
    predicateLetters = 'FGHIJKLMNOABCDE';
    operationLetters = 'abcdefgh';
    variableLetters = 'ijklmnopqrstuvwxyz';
  }
}

/** The notation's data directory, "syntax1" or "syntax2" (LogicProgram.ruleDir). */
export function ruleDirFor(n: 1 | 2 = syntax): string {
  return 'syntax' + n;
}

/**
 * The `altsymbols` flag of the `logic` options (readOptions): the wedge quantifiers.
 * As in the desktop program, resetting the options does not restore the symbols; a later
 * setSyntax does.
 */
export function setAltSymbols(): void {
  altSymbols = true;
  symbols = kaplan1;
}

export function isAltSymbols(): boolean {
  return altSymbols;
}

/** LogicProgram.resetOptions clears the flag (but not the symbols). */
export function clearAltSymbolsFlag(): void {
  altSymbols = false;
}

// ---- letters ----

function letterAt(letters: string, i: number): string {
  const n = letters.length;
  while (i < 0) i += n;
  while (i >= n) i -= n;
  return letters.substring(i, i + 1);
}

/** The i-th sentence letter, cyclically. */
export function sentenceLetter(i: number): string {
  return letterAt(sentenceLetters, i);
}

export function predicateLetter(i: number): string {
  return letterAt(predicateLetters, i);
}

export function operationLetter(i: number): string {
  return letterAt(operationLetters, i);
}

export function variableLetter(i: number): string {
  return letterAt(variableLetters, i);
}

/** The i-th of "xyzuvw", cyclically. */
export function defaultVariable(i: number): string {
  return letterAt(topVariables, i);
}

/** AtomicFormula's test: the first character of s is a predicate letter of the notation. */
export function isPredicateLetter(s: string): boolean {
  return s.length > 0 && predicateLetters.indexOf(s.charAt(0)) !== -1;
}

export function isSentenceLetter(s: string): boolean {
  return s.length > 0 && sentenceLetters.indexOf(s.charAt(0)) !== -1;
}

export function isOperationLetter(s: string): boolean {
  return s.length > 0 && operationLetters.indexOf(s.charAt(0)) !== -1;
}

export function isVariableLetter(s: string): boolean {
  return s.length > 0 && variableLetters.indexOf(s.charAt(0)) !== -1;
}

// ---- translation ----

/**
 * LogicProgram.findNumberedPlaceholder: the first "{n}" (n a number not starting with 0)
 * in s, or null.
 */
export function findNumberedPlaceholder(s: string | null): string | null {
  const n = s == null ? 0 : s.length;
  if (s == null) return null;
  let j = 0;
  while (j < n - 2) {
    let c = s.charAt(j + 1);
    if (s.charAt(j) === '{' && c >= '1' && c <= '9') {
      let k = j + 2;
      while (k < n && (c = s.charAt(k)) >= '0' && c <= '9') k++;
      if (c === '}') return s.substring(j, k + 1);
      if (k === n) break;
      j = k;
    } else {
      j++;
    }
  }
  return null;
}

/** LogicProgram.findQuestionVariable: the first "?ABC" meta-variable in s, or null. */
export function findQuestionVariable(s: string | null): string | null {
  if (s == null) return null;
  const n = s.length;
  let j = 0;
  while (j < n && s.charAt(j) !== '?') j++;
  if (j === n) return null;
  let k = j + 1;
  let c: string;
  while (k < n && (c = s.charAt(k)) >= 'A' && c <= 'Z') k++;
  return s.substring(j, k);
}

/**
 * LogicProgram.shiftPositions: the text grows by delta at position at; positions after it
 * move (but not to before it).
 */
export function shiftPositions(positions: number[] | null | undefined, at: number, delta: number): void {
  if (!positions || delta === 0) return;
  for (let l = 0; l < positions.length; l++) {
    if (positions[l] > at && (positions[l] += delta) < at) positions[l] = at;
  }
}

/**
 * LogicProgram.translateSymbols: replaces each occurrence of from[k] by to[k], taking the
 * leftmost match (ties: the first table entry). Text "{n}" is copied unchanged. Positions in
 * `positions` (e.g. a parse error column, or an IntervalSet's boundaries) are shifted in
 * place as the text changes.
 */
export function translateSymbols(
  s: string,
  from?: readonly string[],
  to?: readonly string[],
  positions?: number[] | null,
): string;
export function translateSymbols(
  s: string | null,
  from?: readonly string[],
  to?: readonly string[],
  positions?: number[] | null,
): string | null;
export function translateSymbols(
  s: string | null,
  from: readonly string[] = maggie,
  to: readonly string[] = symbols,
  positions: number[] | null = null,
): string | null {
  if (s == null) return null;
  let out = '';
  for (;;) {
    let i = -1;
    let j = -1;
    for (let k = 0; k < from.length; k++) {
      const l = s.indexOf(from[k]);
      if (l !== -1 && (i === -1 || l < i)) {
        i = l;
        j = k;
      }
    }
    const placeholder = findNumberedPlaceholder(s);
    const i1 = placeholder == null ? -1 : s.indexOf(placeholder);
    if (i1 !== -1 && (i === -1 || i1 < i)) {
      i = i1 + placeholder!.length;
      j = -1;
    }
    if (i === -1) return out + s;
    if (j === -1) {
      out += s.substring(0, i);
      s = s.substring(i);
    } else {
      shiftPositions(positions, out.length + i, to[j].length - from[j].length);
      out += s.substring(0, i) + to[j];
      s = s.substring(i + from[j].length);
    }
  }
}

/**
 * LogicProgram.symbolBoundsAt: the bounds [start, end) of the symbol of table covering
 * position i of s, or of the single character there.
 */
export function symbolBoundsAt(s: string, i: number, table: readonly string[]): [number, number] {
  const k = s.length;
  if (k === 0) return [0, 0];
  if (i < 0) i = 0;
  if (i >= k) i = k - 1;
  for (const sym of table) {
    const n = sym.length;
    const start = Math.max(0, i - n + 1);
    const end = Math.min(k - n, i);
    for (let l = start; l <= end; l++) {
      if (s.substring(l, l + n) === sym) return [l, l + n];
    }
  }
  return [i, i + 1];
}

/**
 * LogicProgram.expandEscapes: the backslash escapes of message texts. `\n` is a line break,
 * `\l` toggles logic mode, in which text is translated from maggie to the display symbols;
 * any other `\c` is c.
 */
export function expandEscapes(s: string): string {
  let logic = false;
  let out = '';
  let i: number;
  while ((i = s.indexOf('\\')) !== -1) {
    out += logic ? translateSymbols(s.substring(0, i), maggie, symbols) : s.substring(0, i);
    if (s.length < i + 2) {
      // As in Java: the loop ends and all of s is appended below, so the text before a
      // trailing backslash appears twice, followed by the backslash.
      break;
    }
    const c = s.charAt(i + 1);
    s = s.substring(i + 2);
    if (c === 'l') logic = !logic;
    else if (c === 'n') out += '\n';
    else out += c;
  }
  return out + (logic ? translateSymbols(s, maggie, symbols) : s);
}

/** LogicProgram.escapeBackslashes: doubles each backslash. */
export function escapeBackslashes(s: string): string {
  return s.split('\\').join('\\\\');
}
