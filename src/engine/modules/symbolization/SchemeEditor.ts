/**
 * The model of SchemeEditor.java: a scheme of abbreviation as rows of "symbol : English".
 *
 * Stored form: "symbol:English.symbol:English..." where a ':' in a symbol and a '.' in the
 * English are escaped with a backslash (and a backslash itself). Symbols are stored in the
 * program's internal symbols and shown in the display symbols.
 */
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import { javaTrim } from '../../util/java';

export interface SchemeRow {
  /** The symbol as shown (display symbols). */
  symbol: string;
  english: string;
}

/** SchemeEditor.setScheme: the rows of a stored scheme (none for null). */
export function parseScheme(s: string | null): SchemeRow[] {
  const rows: SchemeRow[] = [];
  if (s == null) return rows;
  const d = new DelimitedTokenizer('\\:');
  const d1 = new DelimitedTokenizer('\\.');
  d.setInput(s);
  for (;;) {
    const symbol = d.nextToken();
    if (symbol == null) break;
    d1.setInput(d.getRemaining());
    const english = d1.nextToken();
    if (english == null) break;
    d.setInput(d1.getRemaining());
    rows.push({ symbol: translateSymbols(javaTrim(symbol), maggie, symbols), english: javaTrim(english) });
  }
  return rows;
}

/** SchemeEditor.getScheme: the stored form of rows (rows with an empty side are left out). */
export function encodeScheme(rows: readonly SchemeRow[]): string {
  let s = '';
  const d = new DelimitedTokenizer('\\:');
  const d1 = new DelimitedTokenizer('\\.');
  for (const row of rows) {
    const symbol = translateSymbols(javaTrim(row.symbol), symbols, maggie);
    const english = javaTrim(row.english);
    if (symbol.length !== 0 && english.length !== 0) {
      if (s.length !== 0) s += '.';
      s += d.escape(symbol) + ':' + d1.escape(english);
    }
  }
  return s;
}

/** An editable scheme (the scheme dialog's SchemeEditor(true)). */
export class SchemeEditor {
  rows: SchemeRow[] = [];

  constructor(scheme: string | null = null) {
    this.setScheme(scheme);
  }

  setScheme(s: string | null): void {
    this.rows = parseScheme(s);
  }

  getScheme(): string {
    return encodeScheme(this.rows);
  }

  /** Enter in a cell adds an empty row. */
  addRow(symbol = '', english = ''): void {
    this.rows.push({ symbol: translateSymbols(javaTrim(symbol), maggie, symbols), english: javaTrim(english) });
  }
}
