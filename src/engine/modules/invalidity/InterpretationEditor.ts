/**
 * Port of InterpretationEditor.java (model part): the grid in which the student sets a
 * symbol's interpretation, `columns` = size (1 for arity 0) by `rows` = size^(arity-1): a
 * checkbox per tuple for a predicate, a number chooser (0 .. size-1) for an operation. The
 * cell in column c and row r stands for the tuple (r % size, (r / size) % size, ..., c).
 * applyToSymbol writes the grid back (the dialog's OK). The dialog's title is
 * "Extend " + symbol.getSignature().
 */
import { ExpressionPath } from '../../formula/ExpressionPath';
import { JavaHashtable } from '../../util/java';
import { OperationInterpretation, PredicateInterpretation, type SymbolInterpretation } from './SymbolInterpretation';

export interface EditorCell {
  /** The label the desktop shows next to the box (e.g. "F(2)", "R(,01)" — sic). */
  label: string;
  tuple: number[];
  /** Predicate: checked. */
  checked: boolean;
  /** Operation: the chosen element. */
  value: number;
}

export class InterpretationEditor {
  readonly columns: number;
  readonly rows: number;
  /** cells[row][column]. */
  readonly cells: EditorCell[][] = [];
  readonly isPredicate: boolean;

  constructor(
    readonly symbol: SymbolInterpretation,
    readonly universeSize: number,
  ) {
    const i = universeSize;
    this.isPredicate = symbol instanceof PredicateInterpretation;
    this.columns = symbol.arity === 0 ? 1 : i;
    let rows = 1;
    for (let j = 1; j < symbol.arity; j++) rows *= i;
    this.rows = rows;
    if (this.columns === 0) return;
    if (symbol.arity === 0) {
      const v = symbol.getValue(null);
      this.cells.push([{ label: symbol.name, tuple: [], checked: v === true, value: typeof v === 'number' ? v : 0 }]);
      return;
    }
    for (let r = 0; r < rows; r++) {
      const a = new Array<number>(symbol.arity).fill(0);
      let s = '';
      let l = r;
      for (let k = 1; k < symbol.arity; k++) {
        s += ',' + (a[k - 1] = l % i);
        l = Math.trunc(l / i);
      }
      const row: EditorCell[] = [];
      for (let c = 0; c < this.columns; c++) {
        a[symbol.arity - 1] = c;
        const v = symbol.getValue(a);
        row.push({ label: symbol.name + '(' + s + c + ')', tuple: a.slice(), checked: v === true, value: typeof v === 'number' ? v : 0 });
      }
      this.cells.push(row);
    }
  }

  setChecked(row: number, col: number, checked: boolean): void {
    this.cells[row][col].checked = checked;
  }

  setValue(row: number, col: number, value: number): void {
    this.cells[row][col].value = value;
  }

  /** applyToSymbol: the grid becomes the symbol's interpretation. */
  applyToSymbol(): void {
    const sym = this.symbol;
    if (this.columns === 0) {
      // the desktop's grid has no layout here and fails; nothing is changed
      return;
    }
    if (sym instanceof PredicateInterpretation) {
      const ext: ExpressionPath[] = [];
      for (const row of this.cells) for (const cell of row) if (cell.checked) ext.push(new ExpressionPath(cell.tuple));
      sym.extension = ext;
    } else if (sym instanceof OperationInterpretation) {
      if (sym.arity === 0) {
        sym.valueTable = null;
        sym.defaultValue = this.cells[0][0].value;
      } else {
        const table = new JavaHashtable<ExpressionPath, number>({ hash: (p) => p.hashCode(), equals: (a, b) => a.equals(b) });
        for (const row of this.cells) for (const cell of row) table.put(new ExpressionPath(cell.tuple), cell.value);
        sym.valueTable = table;
        sym.defaultValue = null;
      }
    }
  }
}
