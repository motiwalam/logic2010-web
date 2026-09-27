/**
 * The quantifier words of the text notation: "forall x" for @x and "exists x" for !x.
 * Port of QuantifierWords.java.
 *
 * Inside the program formulas are written with @ and !. The words are accepted wherever
 * formula text is read (parseFormula, and the formula fields of the data files) and are
 * written into the formula fields of the saved work (DataFiles).
 *
 * toWords and toSymbols are exact inverses on the program's formulas: toWords puts one blank
 * between the word and its variable, and one after the variable unless the variable ends the
 * formula or is followed by a closing character; toSymbols removes exactly those blanks. So
 * "@xFx" is written "forall x Fx" and "@x Fx" is written "forall x  Fx".
 */

const WORDS = ['forall', 'exists'];
const SYMBOLS = '@!';
const CLOSING = ')]}.,:;';

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

/** The length of the variable (a lowercase letter and any digits) at i in s, or 0. */
export function variableLength(s: string, i: number): number {
  if (i >= s.length || s[i] < 'a' || s[i] > 'z') return 0;
  let j = i + 1;
  while (j < s.length && isDigit(s[j])) j++;
  return j - i;
}

/** "@x" and "!x" become "forall x" and "exists x". */
export function toWords(s: string): string;
export function toWords(s: string | null): string | null;
export function toWords(s: string | null): string | null {
  if (s == null || (s.indexOf('@') === -1 && s.indexOf('!') === -1)) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const j = SYMBOLS.indexOf(c);
    const k = j === -1 ? 0 : variableLength(s, i + 1);
    if (k === 0) {
      out += c;
      i++;
    } else {
      out += WORDS[j] + ' ' + s.slice(i + 1, i + 1 + k);
      i += 1 + k;
      if (i < s.length && CLOSING.indexOf(s[i]) === -1) out += ' ';
    }
  }
  return out;
}

/** "forall x" and "exists x" (blanks optional) become "@x" and "!x". */
export function toSymbols(s: string): string;
export function toSymbols(s: string | null): string | null;
export function toSymbols(s: string | null): string | null {
  return toSymbolsAt(s, -1)[0];
}

/**
 * Converts s, and gives in the second element the position in s of position pos of the
 * result (to report parse errors at the place the user typed).
 */
export function toSymbolsAt(s: string | null, pos: number): [string | null, number] {
  if (s == null || (s.indexOf('forall') === -1 && s.indexOf('exists') === -1)) return [s, pos];
  let out = '';
  let i = 0;
  let j = pos;
  while (i < s.length) {
    let k = -1;
    for (let l = 0; l < WORDS.length; l++) {
      if (s.startsWith(WORDS[l], i)) k = l;
    }
    let m = i + (k === -1 ? 0 : WORDS[k].length);
    while (k !== -1 && m < s.length && s[m] === ' ') m++;
    const n = k === -1 ? 0 : variableLength(s, m);
    if (out.length === pos) j = i;
    if (n === 0) {
      out += s[i];
      i++;
    } else {
      out += SYMBOLS[k] + s.slice(m, m + n);
      i = m + n;
      if (i < s.length && s[i] === ' ') i++;
    }
  }
  if (out.length === pos) j = s.length;
  return [out, j];
}
