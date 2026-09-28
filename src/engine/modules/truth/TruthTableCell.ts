/**
 * Port of TruthTableCell.java (model part): one premise or conclusion cell of a table row.
 *
 * The cell shows a value (T, F or ?) and may be flagged wrong. Its evaluation tree is edited
 * while the cell is selected; deselecting it (or OK) commits the tree's root value and its
 * consistency to the cell. A cell's saved code is `<tree values><sign><value>`, the sign `+`
 * (fine) or `-` (wrong); an empty cell is `+?`.
 */
import { FormulaParseNode } from '../../formula/FormulaParseNode';
import type { TruthProblemPanel } from './TruthProblemPanel';
import { rowAssignmentString } from './TruthTableGrid';
import { TruthValueTree } from './TruthValueTree';

export class TruthTableCell {
  /** The code last loaded or committed. */
  cellCode = '';
  /** The value shown on the cell ("T", "F", "?"; whatever a saved code held). */
  text = '';
  isWrong = false;
  readonly valueTree: TruthValueTree;

  /** col: premise index, or premiseCount for the conclusion. */
  constructor(
    code: string,
    readonly workPanel: TruthProblemPanel,
    readonly col: number,
    readonly row: number,
  ) {
    let node: FormulaParseNode | null = null;
    const argument = workPanel.argument;
    if (argument != null) {
      node = new FormulaParseNode(col < workPanel.premiseCount ? argument.premises[col] : argument.conclusion);
    }
    this.valueTree = new TruthValueTree(this, node);
    this.loadCode(code, true);
  }

  /** The mirror (inline) tree is the same model on the desktop's second view. */
  get mirrorTree(): TruthValueTree {
    return this.valueTree;
  }

  /**
   * loadCode: shows a saved code. A cell whose formula is a sentence letter shows the row's
   * value (wrong if the code gave the other value).
   */
  loadCode(s: string, checkLetter: boolean): void {
    let value = TruthTableCell.extractValue(s);
    let wrong = TruthTableCell.hasErrorSign(s);
    const i = checkLetter ? this.workPanel.evaluator!.indexOfLetter(this.valueTree.getExpression()) : -1;
    if (i !== -1) {
      const v = this.getRowAssignment().substring(i, i + 1);
      if (value === '?') {
        value = v;
        wrong = false;
      } else {
        wrong = value !== v;
      }
    }
    this.valueTree.setValues(TruthTableCell.extractTreeValues(s));
    this.valueTree.checkValues();
    this.text = value;
    this.isWrong = wrong;
    this.cellCode = this.valueTree.getValues() + (wrong ? '-' : '+') + value;
  }

  /** getTreeCode: the code of the tree as it is now (sign from its consistency check). */
  getTreeCode(): string {
    return this.valueTree.getValues() + (this.valueTree.correct ? '+' : '-') + this.valueTree.getDisplayText();
  }

  applyCode(s: string): void {
    this.text = TruthTableCell.extractValue(s);
    this.isWrong = TruthTableCell.hasErrorSign(s);
    this.cellCode = s;
  }

  /** Whether the cell is shown in the error colors (setWrong, unless table errors are disabled). */
  showsError(): boolean {
    return this.isWrong && !this.workPanel.module.tableErrorsDisabled;
  }

  getCode(): string {
    return this.valueTree.getValues() + (this.isWrong ? '-' : '+') + this.text;
  }

  getRowAssignment(): string {
    return rowAssignmentString(this.row, this.workPanel.letterCount)!;
  }

  commitTreeValue(): void {
    this.applyCode(this.getTreeCode());
  }

  static extractValue(s: string): string {
    const i = TruthTableCell.findSignIndex(s);
    return i === -1 ? '?' : s.substring(i + 1);
  }

  static extractTreeValues(s: string): string {
    const i = TruthTableCell.findSignIndex(s);
    return i === -1 ? s : s.substring(0, i);
  }

  static findSignIndex(s: string | null): number {
    if (s == null) return -1;
    const i = s.indexOf('+');
    return i === -1 ? s.indexOf('-') : i;
  }

  static hasErrorSign(s: string): boolean {
    return s.indexOf('-') !== -1;
  }
}
