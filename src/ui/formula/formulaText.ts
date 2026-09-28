// The text logic of FormulaInput, without React: the field shows display symbols (∀ ∃ → ...)
// while the value is ASCII "maggie" notation (@ ! -> ...), as the desktop's FormulaTextPane
// does. Typed ASCII forms, quantifier words and pasted Unicode variants are translated as
// the user types, keeping the caret where it belongs.

import { toSymbols } from '../../engine/data/QuantifierWords';
import { FormulaParseNode } from '../../engine/formula/FormulaParseNode';
import { maggie, symbols, translateSymbols } from '../../engine/program/symbols';

/** Other characters people paste or type for the connectives (-> maggie). */
const VARIANTS: readonly [string, string][] = [
  ['¬', '~'],
  ['⊃', '->'],
  ['≡', '<->'],
  ['⇒', '->'],
  ['⇔', '<->'],
  ['⟶', '->'],
  ['⟷', '<->'],
  ['⋀', '@'],
  ['⋁', '!'],
  ['·', '&'],
  ['∈', '[m]'],
];

export interface FieldState {
  /** What the field shows. */
  display: string;
  /** The value (ASCII maggie notation). */
  value: string;
  selStart: number;
  selEnd: number;
}

/** maggie -> display symbols. */
export function toDisplay(value: string): string {
  return translateSymbols(value, maggie, symbols);
}

/** display symbols (and variants) -> maggie, shifting the positions. */
export function toValue(display: string, positions: number[] = []): string {
  let s = display;
  for (const [from, to] of VARIANTS) {
    if (from === to || !s.includes(from)) continue;
    s = translateSymbols(s, [from], [to], positions);
  }
  return translateSymbols(s, symbols, maggie, positions);
}

/**
 * Quantifier words ("forall x", "exists y") -> @x / !y, mapping a caret position: the
 * text before the caret is converted on its own, so the caret stays after what was typed.
 */
function wordsToSymbols(s: string, caret: number): [string, number] {
  if (!s.includes('forall') && !s.includes('exists')) return [s, caret];
  const whole = toSymbols(s);
  const before = toSymbols(s.slice(0, caret));
  if (whole.startsWith(before)) return [whole, before.length];
  return [whole, Math.min(caret, whole.length)];
}

/**
 * Normalizes what the field holds after an edit: translates everything to the value and
 * back to display symbols, mapping the selection.
 */
export function normalize(rawDisplay: string, selStart: number, selEnd: number): FieldState {
  const pos = [selStart, selEnd];
  let value = toValue(rawDisplay, pos);
  const [v1, start] = wordsToSymbols(value, pos[0]);
  const [, end] = wordsToSymbols(value, pos[1]);
  value = v1;
  const out = [start, end];
  const display = translateSymbols(value, maggie, symbols, out);
  return { display, value, selStart: clamp(out[0], display), selEnd: clamp(out[1], display) };
}

function clamp(n: number, s: string): number {
  return Math.max(0, Math.min(n, s.length));
}

/** The state for a value set from outside, with the caret at the end. */
export function fromValue(value: string): FieldState {
  const display = toDisplay(value);
  return { display, value, selStart: display.length, selEnd: display.length };
}

/** Replaces the selection with text (maggie or display), leaving the caret after it. */
export function insertText(state: FieldState, text: string): FieldState {
  const inserted = toDisplay(text);
  const raw = state.display.slice(0, state.selStart) + inserted + state.display.slice(state.selEnd);
  const caret = state.selStart + inserted.length;
  return normalize(raw, caret, caret);
}

/**
 * The desktop's formula shortcuts (FormulaTextPane.shortcutSymbol): Ctrl+Shift+letter
 * inserts a connective. Keys are KeyboardEvent.code values.
 */
export const SHORTCUT_SYMBOLS: Readonly<Record<string, string>> = {
  KeyA: '&',
  KeyB: '<->',
  KeyC: '->',
  KeyD: '%',
  KeyE: '!',
  KeyI: '<>',
  KeyN: '~',
  KeyO: '|',
  KeyT: '.:',
  KeyU: '@',
  Enter: '[m]',
};

/** The shortcut letter of a maggie symbol ('->' -> 'C'), for tooltips. */
export function shortcutFor(symbol: string): string | null {
  for (const [code, s] of Object.entries(SHORTCUT_SYMBOLS)) {
    if (s === symbol) return code.startsWith('Key') ? code.slice(3) : code;
  }
  return null;
}

const OPEN = '({[';
const CLOSE = ')}]';

function findOpenBracket(s: string, i: number): number {
  let pending = '';
  if (s.length === 0) return -1;
  while (--i >= 0) {
    const c = s.charAt(i);
    const k = CLOSE.indexOf(c);
    if (k !== -1) pending = OPEN.charAt(k) + pending;
    else if (OPEN.includes(c)) {
      if (pending.length === 0) return i;
      if (pending.charAt(0) !== c) return -1;
      pending = pending.substring(1);
    }
  }
  return -1;
}

function findCloseBracket(s: string, i: number): number {
  let pending = '';
  const n = s.length;
  if (n === 0) return -1;
  while (++i <= n) {
    const c = s.charAt(i - 1);
    const k = OPEN.indexOf(c);
    if (k !== -1) pending = CLOSE.charAt(k) + pending;
    else if (CLOSE.includes(c)) {
      if (pending.length === 0) return i;
      if (pending.charAt(0) !== c) return -1;
      pending = pending.substring(1);
    }
  }
  return -1;
}

/**
 * Ctrl+B (FormulaTextPane.selectEnclosingBrackets): the innermost bracket pair around the
 * selection that is larger than it, brackets included; null if there is none.
 */
export function selectEnclosingBrackets(s: string, selStart: number, selEnd: number): [number, number] | null {
  let i = selStart;
  let j = selStart;
  while ((i = findOpenBracket(s, i)) >= 0 && (j = findCloseBracket(s, j)) >= 0) {
    if (OPEN.indexOf(s.charAt(i)) !== CLOSE.indexOf(s.charAt(j - 1))) return null;
    if (j > selEnd) return [i, j];
  }
  return null;
}

/** Keypad rows (FormulaEntryField.showKeypad), as maggie strings; `\l` marks connectives there. */
export interface KeypadKey {
  /** What is inserted (maggie). */
  insert: string;
  /** What the key shows. */
  label: string;
  /** Ctrl+Shift shortcut letter, if any. */
  shortcut: string | null;
  /** Accessible name. */
  name: string;
}

const CONNECTIVE_NAMES: Record<string, string> = {
  '->': 'conditional',
  '~': 'negation',
  '&': 'conjunction',
  '|': 'disjunction',
  '<->': 'biconditional',
  '@': 'universal quantifier',
  '!': 'existential quantifier',
  '=': 'identity',
  '<>': 'non-identity',
  '%': 'definite description',
  '(': 'open parenthesis',
  ')': 'close parenthesis',
  '.': 'premise separator',
  '.:': 'therefore',
  '[m]': 'membership',
};

function keys(items: readonly string[], kind?: string): KeypadKey[] {
  return items.map((insert) => ({
    insert,
    label: toDisplay(insert),
    shortcut: shortcutFor(insert),
    name: CONNECTIVE_NAMES[insert] ?? (kind ? `${kind} ${insert}` : insert),
  }));
}

export interface KeypadRow {
  title: string;
  keys: KeypadKey[];
}

/** The keypad's rows for the current notation (the letter sets come from symbols.ts). */
export function keypadRows(letters: { sentence: string; operation: string; predicate: string }): KeypadRow[] {
  return [
    { title: 'Connectives', keys: keys(['->', '~', '&', '|', '<->', '@', '!', '=', '<>', '%']) },
    { title: 'Sentence letters', keys: keys([...letters.sentence], 'sentence letter') },
    { title: 'Punctuation', keys: keys(['(', ')', '.', '.:']) },
    { title: 'Operation letters', keys: keys([...letters.operation], 'operation letter') },
    { title: 'Predicate letters', keys: keys([...letters.predicate], 'predicate letter') },
    { title: 'Variables', keys: keys([...'xyzuvw'], 'variable') },
    { title: 'Digits', keys: keys([...'0123456789'], 'digit') },
  ];
}

/**
 * Ctrl+E (FormulaTextPane): the smallest well-formed part of the formula properly containing
 * the selection, in display positions; null if the text does not parse.
 */
export function selectEnclosingFormula(display: string, selStart: number, selEnd: number): [number, number] | null {
  const pos = [selStart, selEnd];
  const value = toValue(display, pos);
  try {
    const range = new FormulaParseNode(value).findNodeContaining(pos[0], pos[1], true).getTextRange();
    if (!range) return null;
    const out = [range[0], range[1]];
    translateSymbols(value, maggie, symbols, out);
    return [out[0], out[1]];
  } catch {
    return null;
  }
}
