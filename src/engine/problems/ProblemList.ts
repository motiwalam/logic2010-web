/**
 * The problem list of the module dialogs, as data: rows (headings and problems), the search
 * filter and the completed counts. Port of the non-UI logic of ProblemSet.createListView,
 * ProblemListView (rememberRows, setFilter, matches, matchesTerm, moveSelection) and
 * ProblemSearchPanel (count, updateCounts).
 */
import { TaggedRecord } from '../data/TaggedRecord';
import { selectorMatches } from '../program/LogicProgram';
import type { ProblemSelector } from '../program/ProblemSelector';
import { expandEscapes, maggie, symbols, translateSymbols } from '../program/symbols';
import { javaTrim } from '../util/java';
import { STATE_CORRECT } from './ProblemEntry';
import { ProblemSet } from './ProblemSet';

export type ProblemListRow =
  | { kind: 'heading'; text: string }
  | {
      kind: 'problem';
      /** The problem's index in the set. */
      index: number;
      /** The row's text: "name:  statement" in display symbols. */
      text: string;
      /** The hover text: the row's text and the search note. */
      hover: string;
      state: number;
      /** Whether the restricting selector (the module's monoProbs) selects the problem (orange). */
      restricted: boolean;
    };

/** UserSetup.stripFirstWord: s without its first word ("Deriv 1.7" -> "1.7"). */
export function stripFirstWord(s: string): string {
  const t = javaTrim(s);
  const i = t.indexOf(' ');
  return i === -1 ? t : javaTrim(t.substring(i + 1));
}

export class ProblemListModel {
  /** All rows, as built (ProblemListView.allItems). */
  readonly allRows: ProblemListRow[] = [];
  /** For each row, its problem's index, or -1 (allRowToProblem). */
  readonly allRowToProblem: number[];
  /** The lower-case text each problem is searched in, by problem index (null: not listed). */
  readonly searchTexts: (string | null)[];
  /** The rows shown (after setFilter). */
  rows: ProblemListRow[];
  rowToProblem: number[];
  /** The row initially selected, or -1. */
  selectedRow = -1;

  /**
   * ProblemSet.createListView: the rows for the set's problems. exercises: the module's
   * exercises (for the headings, and problems not among them count as user problems);
   * problemIndex: the problem open in the module, or -1; multiple: a multiple-selection
   * list (no initial selection); showHidden: include `%hide` problems; restrict: the
   * selector that marks problems orange (monoProbs); exclude: problems left out;
   * hideExtraProblems: leave out extra (non-course) problems.
   */
  constructor(
    set: ProblemSet,
    exercises: ProblemSet | null,
    opts: {
      problemIndex?: number;
      multiple?: boolean;
      showHidden?: boolean;
      restrict?: ProblemSelector | null;
      exclude?: ProblemSelector | null;
      hideExtraProblems?: boolean;
      symbolTable?: readonly string[];
    } = {},
  ) {
    const headingsByName = exercises == null ? null : exercises.headingsByName;
    const symbolTable = opts.symbolTable ?? symbols;
    const n = set.size();
    const rowOf = new Array<number>(n).fill(0);
    const texts = new Array<string | null>(n).fill(null);
    for (let k = 0; k < n; k++) {
      const entry = set.getEntryAt(k)!;
      if ((entry.hidden && !opts.showHidden) || (entry.extraProblem && opts.hideExtraProblems)) continue;
      const record = new TaggedRecord(entry.name);
      let s = record.getName();
      const headings = headingsByName != null && s != null ? headingsByName.get(s) : undefined;
      for (let h of headings ?? []) {
        if (h == null || h === '') h = ' ';
        this.allRows.push({ kind: 'heading', text: expandEscapes(h) });
      }
      const exerciseName = ProblemSet.lookupName(exercises, s);
      if (selectorMatches(opts.exclude, exerciseName)) continue;
      const statement = set.getProblemStatement(record);
      if (s != null && exerciseName != null) s = stripFirstWord(s);
      s = (s == null ? '' : s + ':  ') + (statement == null ? '' : javaTrim(statement));
      const note = set.getSearchNote(record);
      const text = translateSymbols(s, maggie, symbolTable);
      texts[k] = (record.getName() + ' ' + (note == null ? '' : note)).toLowerCase();
      rowOf[k] = this.allRows.length;
      this.allRows.push({
        kind: 'problem',
        index: k,
        text,
        hover: text + (note == null ? '' : '   (' + note + ')'),
        state: entry.state,
        restricted: !set.plainColors && selectorMatches(opts.restrict, exerciseName),
      });
    }
    // As in the desktop, every problem's row is recorded, including those left out, whose
    // row number stays 0: they overwrite the entry of row 0 (a heading or the first problem).
    this.allRowToProblem = new Array<number>(this.allRows.length).fill(-1);
    if (this.allRows.length > 0) {
      for (let k = 0; k < n; k++) this.allRowToProblem[rowOf[k]] = k;
      const problemIndex = opts.problemIndex ?? -1;
      if (problemIndex !== -1) this.selectedRow = rowOf[problemIndex];
      else if (!opts.multiple && n > 0) this.selectedRow = rowOf[0];
    }
    this.searchTexts = texts;
    this.rows = this.allRows.slice();
    this.rowToProblem = this.allRowToProblem.slice();
  }

  /** The problem of the selected row, or -1. */
  getSelectedProblem(): number {
    return this.selectedRow >= 0 && this.selectedRow < this.rowToProblem.length ? this.rowToProblem[this.selectedRow] : -1;
  }

  /**
   * ProblemListView.setFilter: shows the problems whose search text matches every word of
   * the query, each with the headings just above it (blank headings left out). Keeps the
   * selected problem selected if it is still shown, else selects the first problem.
   */
  setFilter(query: string): void {
    const q = javaTrim(query).toLowerCase();
    const terms = q === '' ? [] : q.split(/[ \t\n\x0B\f\r]+/); // Java's \s+
    const selected = this.getSelectedProblem();
    const rows: ProblemListRow[] = [];
    const rowToProblem: number[] = [];
    for (let j = 0; j < this.allRows.length; j++) {
      const k = this.allRowToProblem[j];
      if (terms.length === 0) {
        rows.push(this.allRows[j]);
        rowToProblem.push(k);
      } else if (k >= 0 && k < this.searchTexts.length && matches(this.searchTexts[k], terms)) {
        let l = j;
        while (l > 0 && this.allRowToProblem[l - 1] < 0) l--;
        for (; l < j; l++) {
          const row = this.allRows[l];
          if (row.kind !== 'heading' || javaTrim(row.text) !== '') {
            rows.push(row);
            rowToProblem.push(-1);
          }
        }
        rows.push(this.allRows[j]);
        rowToProblem.push(k);
      }
    }
    this.rows = rows;
    this.rowToProblem = rowToProblem;
    let m = -1;
    let first = -1;
    for (let r = 0; r < rowToProblem.length; r++) {
      const p = rowToProblem[r];
      if (p >= 0 && first === -1) first = r;
      if (p >= 0 && p === selected) m = r;
    }
    this.selectedRow = m === -1 ? first : m;
  }

  /** ProblemListView.moveSelection: moves by delta rows, skipping headings. */
  moveSelection(delta: number): void {
    let l = this.selectedRow;
    do {
      l += delta;
    } while (l >= 0 && l < this.rows.length && this.rowToProblem[l] < 0);
    if (l >= 0 && l < this.rows.length) this.selectedRow = l;
  }
}

/**
 * Every term must occur in the text. A term like t2 or mc1 (ending in a letter and a number)
 * must match a whole name: t2 does not match t25 or st2.
 */
export function matches(text: string | null, terms: readonly string[]): boolean {
  if (text == null) return false;
  return terms.every((t) => matchesTerm(text, t));
}

export function matchesTerm(text: string, term: string): boolean {
  // String.matches(".*[a-z][0-9]+"): '.' matches no line terminator
  const whole = /^[^\n\r\u0085\u2028\u2029]*[a-z][0-9]+$/.test(term);
  let i = 0;
  while ((i = text.indexOf(term, i)) !== -1) {
    const j = i + term.length;
    if (
      !whole ||
      ((i === 0 || !isLetter(text.charAt(i - 1)) || !isLetter(term.charAt(0))) && (j >= text.length || !isDigit(text.charAt(j))))
    ) {
      return true;
    }
    i++;
  }
  return false;
}

/** Character.isLetter. */
function isLetter(c: string): boolean {
  return /\p{L}/u.test(c);
}

/** Character.isDigit. */
function isDigit(c: string): boolean {
  return /\p{Nd}/u.test(c);
}

/**
 * ProblemSearchPanel's counts: which problems count (not worked examples, and among the
 * exercises), and {completed, counted, rows} over given rows.
 */
export class ProblemCounts {
  readonly counted: boolean[];

  constructor(
    private readonly set: ProblemSet,
    exercises: ProblemSet | null,
    private readonly list: ProblemListModel,
  ) {
    this.counted = [];
    for (let i = 0; i < set.size(); i++) {
      const entry = set.getEntryAt(i);
      let c = false;
      if (entry != null && entry.name != null) {
        const record = new TaggedRecord(entry.name);
        c = !ProblemSet.isExample(record) && ProblemSet.lookupName(exercises, record.getName()) != null;
      }
      this.counted.push(c);
    }
  }

  /** [completed, counted, rows] over the problems in the rows. */
  count(rowToProblem: readonly number[] | null): [number, number, number] {
    const out: [number, number, number] = [0, 0, 0];
    for (const j of rowToProblem ?? []) {
      const entry = j >= 0 ? this.set.getEntryAt(j) : null;
      if (entry != null && this.list.searchTexts[j] != null) {
        out[2]++;
        if (j < this.counted.length && this.counted[j]) {
          out[1]++;
          if (entry.state === STATE_CORRECT) out[0]++;
        }
      }
    }
    return out;
  }

  /** The count line under the list; query is the search field's text. */
  label(query: string): string {
    const all = this.count(this.list.allRowToProblem);
    let s = 'Completed: ' + all[0] + '    Not completed: ' + (all[1] - all[0]);
    if (javaTrim(query) !== '') {
      const shown = this.count(this.list.rowToProblem);
      s += '    (matches: ' + shown[2] + ', ' + shown[0] + ' of ' + shown[1] + ' completed)';
    }
    return s;
  }
}
