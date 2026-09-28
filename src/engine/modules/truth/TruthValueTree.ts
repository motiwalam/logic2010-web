/**
 * Port of TruthValueTree.java (the model part; TruthValueTreeLabel's value button and its
 * property-change handler are folded in): the evaluation tree of one table cell, in which the
 * student gives every subformula a value T or F, bottom-up.
 *
 * The desktop shows each cell's tree twice, as a tree (valueTree) and inline under the
 * formula (mirrorTree); the two are linked so that they always hold the same values. Here
 * both views show this one model.
 *
 * A node's value is the index of its value button: -1 unset ("?"), 0 "T", 1 "F". A node whose
 * formula is one of the table's sentence letters is locked to the row's value.
 */
import { ConnectiveFormula, type Expression } from '../../formula/Expression';
import type { FormulaParseNode } from '../../formula/FormulaParseNode';
import type { TruthTableCell } from './TruthTableCell';
import { rowAssignmentString } from './TruthTableGrid';

export const VALUE_CHOICES = ['T', 'F'] as const;

export class TruthValueTree {
  parent: TruthValueTree | null = null;
  readonly children: TruthValueTree[] = [];
  parseNode: FormulaParseNode | null = null;
  /** The value button's selected index (-1: "?"). */
  selectedIndex = -1;
  /** Locked to the row's value (a sentence letter). */
  locked = false;
  /** Shown as wrong (red); never for locked nodes or with tree errors disabled. */
  errorShown = false;
  /** After checkValues: this node and all below it are consistent. */
  correct = true;

  constructor(
    readonly cell: TruthTableCell,
    parseNode: FormulaParseNode | null,
  ) {
    this.setParseNode(parseNode);
  }

  /** setParseNode: builds the subtrees (one per child of a connective). */
  private setParseNode(node: FormulaParseNode | null): void {
    if (node == null || node.expression == null) {
      this.parseNode = null;
      return;
    }
    this.parseNode = node;
    if (node.expression instanceof ConnectiveFormula) {
      for (let k = 0; k < node.getChildCount(); k++) {
        const child = new TruthValueTree(this.cell, node.getChild(k));
        child.parent = this;
        this.children.push(child);
      }
    }
  }

  getExpression(): Expression | null {
    return this.parseNode == null ? null : this.parseNode.expression;
  }

  getConnective(): string | null {
    const e = this.getExpression();
    return e == null ? null : e.getSymbol();
  }

  /** The value button's text: "T", "F" or "?". */
  getDisplayText(): string {
    if (this.selectedIndex < 0) return '?';
    return this.selectedIndex < VALUE_CHOICES.length ? VALUE_CHOICES[this.selectedIndex] : 'bad index';
  }

  getValueChar(): string {
    return this.getDisplayText().charAt(0);
  }

  getRootTree(): TruthValueTree {
    let t: TruthValueTree = this;
    while (t.parent != null) t = t.parent;
    return t;
  }

  /** The formula text of the node (FormulaParseNode.toString), in the program's notation. */
  getFormulaText(): string {
    return this.parseNode == null ? '' : this.parseNode.toString();
  }

  /**
   * setValues: gives the nodes (in preorder) the values of the characters of s ("?", "T",
   * "F"); a sentence-letter node takes the row's value (and still uses up a character).
   * Returns the characters left over.
   */
  setValues(s: string | null): string | null {
    const panel = this.cell.workPanel;
    let c = '?';
    let locked = false;
    if (panel.evaluator != null) {
      const i = panel.evaluator.indexOfLetter(this.getExpression());
      if (i !== -1) {
        c = rowAssignmentString(this.cell.row, panel.letterCount)!.charAt(i);
        locked = true;
      }
    }
    if (s != null && s.length !== 0) {
      if (c === '?') c = s.charAt(0);
      s = s.substring(1);
    }
    this.locked = locked;
    this.errorShown = false;
    this.selectedIndex = '?TF'.indexOf(c) - 1;
    for (const child of this.children) s = child.setValues(s);
    return s;
  }

  /** hasEnteredValues: whether the student set any (unlocked) value. */
  hasEnteredValues(): boolean {
    if (!this.locked && this.selectedIndex !== -1) return true;
    return this.children.some((c) => c.hasEnteredValues());
  }

  /** getValues: the value characters in preorder. */
  getValues(): string {
    let s = this.getValueChar();
    for (const c of this.children) s += c.getValues();
    return s;
  }

  private showError(flag: boolean): void {
    if (this.errorShown !== flag && !this.locked && !this.cell.workPanel.module.treeErrorsDisabled) this.errorShown = flag;
  }

  /**
   * checkValues: checks each node against its children (and a sentence letter against the
   * row), marks the wrong ones and returns whether the whole tree is right. Without the
   * completeAllNodes option a true conditional or disjunction, or a false conjunction, may
   * leave the child that does not matter unset.
   */
  checkValues(): boolean {
    if (this.parseNode == null) return false;
    const panel = this.cell.workPanel;
    const c0 = this.getValueChar();
    this.correct = true;
    if (panel.evaluator != null) {
      const i = panel.evaluator.indexOfLetter(this.parseNode.expression);
      const row = rowAssignmentString(this.cell.row, panel.letterCount)!;
      if (i !== -1 && row.charAt(i) !== c0) this.correct = false;
    }
    if (this.correct && c0 !== '?') {
      const s = this.getConnective();
      const allNodes = panel.module.completeAllNodes;
      const a = () => this.children[0].getValueChar();
      const b = () => this.children[1].getValueChar();
      if (s === '~') {
        const x = a();
        this.correct = x !== '?' && (c0 === 'T') === (x === 'F');
      } else if (s === '->') {
        const x = a();
        const y = b();
        this.correct = x !== '?' && y !== '?' && (c0 === 'T') === (x === 'F' || y === 'T');
        if (!this.correct && !allNodes) this.correct = c0 === 'T' && (x === 'F' || y === 'T');
      } else if (s === '<->') {
        const x = a();
        const y = b();
        this.correct = x !== '?' && y !== '?' && (c0 === 'T') === ((x === 'T') === (y === 'T'));
      } else if (s === '&') {
        const x = a();
        const y = b();
        this.correct = x !== '?' && y !== '?' && (c0 === 'F') === (x === 'F' || y === 'F');
        if (!this.correct && !allNodes) this.correct = c0 === 'F' && (x === 'F' || y === 'F');
      } else if (s === '|') {
        const x = a();
        const y = b();
        this.correct = x !== '?' && y !== '?' && (c0 === 'T') === (x === 'T' || y === 'T');
        if (!this.correct && !allNodes) this.correct = c0 === 'T' && (x === 'T' || y === 'T');
      }
    }
    this.showError(!this.correct);
    for (const child of this.children) {
      if (!child.checkValues()) this.correct = false;
    }
    return this.correct;
  }

  /** The nodes in preorder (the order of getValues). */
  nodes(): TruthValueTree[] {
    const out: TruthValueTree[] = [this];
    for (const c of this.children) out.push(...c.nodes());
    return out;
  }
}
