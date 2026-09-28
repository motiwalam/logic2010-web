/**
 * Port of TruthTableGrid.java and ExclusiveCheckBox.java (model part): the table's cells, the
 * header labels, the counterexample row (the row checkboxes act as radio buttons) and the
 * selected cell.
 *
 * Rows: row i gives the letters the values of rowAssignmentString(i, n): the bits of i with
 * the most significant on the left, 0 meaning T, so row 0 is TT...T.
 */
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import type { TruthProblemPanel } from './TruthProblemPanel';
import { TruthTableCell } from './TruthTableCell';

/** TruthTableGrid.rowAssignmentString: the row's letter values, e.g. "TFT" (null for i < 0). */
export function rowAssignmentString(i: number, n: number): string | null {
  if (i < 0) return null;
  let s = '';
  for (let k = 0; k < n; k++) {
    s = (i % 2 === 0 ? 'T' : 'F') + s;
    i = Math.trunc(i / 2);
  }
  return s;
}

export interface CellPosition {
  row: number;
  col: number;
}

export class TruthTableGrid {
  cells: TruthTableCell[][] = [];
  selectedCell: CellPosition | null = null;
  counterexampleRow = -1;
  columnCount = 0;
  rowCount = 0;

  constructor(readonly workPanel: TruthProblemPanel) {}

  /**
   * buildHeader: the header labels: the sentence letters (in the notation's symbols), Pr1..Prn,
   * and Conc (an argument) or Form (a formula).
   */
  getHeaderLabels(): string[] {
    const p = this.workPanel;
    const out: string[] = [];
    for (let i = 0; i < p.letterCount; i++) out.push(translateSymbols(p.evaluator!.sentenceLetters[i].toString(), maggie, symbols));
    for (let j = 0; j < p.premiseCount; j++) out.push('Pr' + (j + 1));
    out.push(p.argument != null && !p.argument.conclusionOnly ? 'Conc' : 'Form');
    return out;
  }

  /** buildTable: new cells from the codes by row assignment (a missing cell is "+?"). */
  buildTable(codes: Map<string, (string | null)[]> | null): void {
    const p = this.workPanel;
    this.columnCount = 2 + p.letterCount + p.premiseCount;
    this.rowCount = p.letterCount === 0 ? 0 : 1 << p.letterCount;
    this.selectedCell = null;
    this.cells = [];
    for (let i = 0; i < this.rowCount; i++) {
      const s = rowAssignmentString(i, p.letterCount)!;
      const rowCodes = codes == null ? undefined : codes.get(s);
      const row: TruthTableCell[] = [];
      for (let k = 0; k <= p.premiseCount; k++) {
        const code = rowCodes == null ? null : rowCodes[k];
        row.push(new TruthTableCell(code ?? '+?', p, k, i));
      }
      this.cells.push(row);
    }
  }

  /** The row's letter values as the table shows them. */
  getRowLabel(i: number): string {
    return rowAssignmentString(i, this.workPanel.letterCount)!;
  }

  /** Whether the row shows a counterexample checkbox column (not for "taut" problems). */
  hasCounterexampleColumn(): boolean {
    return !this.workPanel.module.assumeTautology;
  }

  /** ExclusiveCheckBox: checking a row unchecks the others; unchecking it clears the choice. */
  setCounterexampleChecked(row: number, checked: boolean): void {
    if (checked) this.counterexampleRow = row;
    else if (this.counterexampleRow !== -1 && this.counterexampleRow === row) this.counterexampleRow = -1;
  }

  /** getCellCodes: every row's cell codes, by row assignment. */
  getCellCodes(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (let i = 0; i < this.rowCount; i++) {
      out.set(rowAssignmentString(i, this.workPanel.letterCount)!, this.cells[i].map((c) => c.getCode()));
    }
    return out;
  }

  rowHasWork(i: number): boolean {
    return this.cells[i].some((c) => c.valueTree.hasEnteredValues());
  }

  getSelectedCell(): TruthTableCell | null {
    const p = this.selectedCell;
    return p == null ? null : this.cells[p.row][p.col];
  }

  /**
   * TruthTableCell.setSelected: selecting a cell commits and deselects the previously selected
   * one; deselecting the selected cell commits its tree.
   */
  setSelected(row: number, col: number, selected: boolean): void {
    const p = this.selectedCell;
    const same = p != null && p.row === row && p.col === col;
    if (selected) {
      if (p != null && !same) this.setSelected(p.row, p.col, false);
      this.selectedCell = { row, col };
    } else if (same) {
      this.cells[row][col].commitTreeValue();
      this.selectedCell = null;
    }
  }

  /** A click on a cell (fireActionPerformed): toggles its selection. */
  clickCell(row: number, col: number): void {
    const p = this.selectedCell;
    this.setSelected(row, col, p == null || p.row !== row || p.col !== col);
  }
}

/** The static row predicates of LPTruthAnalysis. */
export function checkRowError(row: readonly TruthTableCell[]): boolean {
  return row.some((c) => c.isWrong);
}

export function checkRowComplete(row: readonly TruthTableCell[]): boolean {
  return !row.some((c) => c.text === '?');
}

/** A row is valid if its conclusion is T or some premise F (as the cells show them). */
export function checkRowValid(row: readonly TruthTableCell[]): boolean {
  const n = row.length;
  if (row[n - 1].text === 'T') return true;
  for (let j = 0; j < n - 1; j++) if (row[j].text === 'F') return true;
  return false;
}
