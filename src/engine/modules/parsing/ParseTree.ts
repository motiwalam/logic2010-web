/**
 * The parse tree of the Parsing module, without the Swing parts. Port of ParseTreePanel.java,
 * ParseTreeNodePanel.java and ParseTreeFormulaText.java (the model: nodes, expansion,
 * operator ranges, selection; painting, flashing and pixel positions are left to the UI).
 *
 * Positions are character indexes in a node's displayed text (its formula in display
 * symbols). The desktop tests a click's pixel x against the pixel positions of the operator
 * ranges' boundaries, which is the same as testing the index of the character clicked.
 */
import { FormulaParseNode } from '../../formula/FormulaParseNode';
import { IntervalSet } from '../../program/IntervalSet';
import { maggie, symbolBoundsAt, symbols, translateSymbols } from '../../program/symbols';
import { javaTrim, parseJavaInt } from '../../util/java';

/** The module state the tree reads (LPParsing.checkNow / noDescent). */
export interface ParseTreeContext {
  readonly checkNow: boolean;
  readonly noDescent: boolean;
}

/** One node: ParseTreeNodePanel with its ParseTreeFormulaText. */
export class ParseTreeNode {
  parent: ParseTreeNode | null = null;
  readonly children: ParseTreeNode[] = [];
  expanded = false;
  /** ParseTreeFormulaText.selectedRange: [start, end) of the symbol last clicked (null: none). */
  selectedRange: number[] | null = null;
  /** ParseTreeFormulaText.selectionCorrect: whether the last click (main-connective mode) hit the main connective. */
  selectionCorrect = false;
  /** The displayed text (the formula in display symbols). */
  readonly text: string;

  /** parseNode null: a text that is not a formula (the tree's root only). */
  constructor(
    readonly parseNode: FormulaParseNode | null,
    rawText: string | null = null,
  ) {
    if (parseNode != null) {
      this.text = translateSymbols(parseNode.toString(), maggie, symbols);
      const n = parseNode.getChildCount();
      for (let k = 0; k < n; k++) {
        const child = new ParseTreeNode(parseNode.getChild(k)!);
        child.parent = this;
        this.children.push(child);
      }
    } else {
      this.text = rawText == null ? '' : translateSymbols(rawText, maggie, symbols);
    }
  }

  getChildNodeCount(): number {
    return this.children.length;
  }

  getChildNode(i: number): ParseTreeNode | null {
    return this.children[i] ?? null;
  }

  /** Whether the node is shown: the root, or a child of an expanded node that is shown. */
  isVisible(): boolean {
    return this.parent == null || (this.parent.expanded && this.parent.isVisible());
  }

  /**
   * ParseTreeFormulaText.getOperatorRanges: the node's own symbols (main connective,
   * quantifier, predicate ...) as ranges of its displayed text.
   */
  getOperatorRanges(): IntervalSet {
    if (this.parseNode == null) return new IntervalSet();
    const set = this.parseNode.getOperatorRanges();
    const root = this.parseNode.getRoot(true);
    FormulaParseNode.convertRanges(root.strippedIndex!, root.parenDepth!, set, false);
    const start = this.parseNode.getTextRange()![0];
    for (let j = 0; j < set.count; j++) set.boundaries[j] -= start;
    translateSymbols(this.parseNode.toString(), maggie, symbols, set.boundaries);
    return set;
  }

  /** The operator ranges as [start, end) pairs. */
  getOperatorIntervals(): [number, number][] {
    const set = this.getOperatorRanges();
    const out: [number, number][] = [];
    for (let j = 0; j + 1 < set.count; j += 2) out.push([set.boundaries[j], set.boundaries[j + 1]]);
    return out;
  }

  /**
   * Whether a click on character i of the text hits the node's main connective (the test of
   * ParseTreeFormulaText.mousePressed): the node has children and i is in its operator ranges.
   * An index outside the text (a click beside it) never hits.
   */
  hitsMainConnective(i: number): boolean {
    return this.parseNode != null && this.parseNode.getChildCount() !== 0 && this.getOperatorRanges().contains(i);
  }

  /**
   * ParseTreeFormulaText.getSymbolRangeAt: the symbol at character i ([start, end)), or null
   * for a blank or a position outside the text.
   */
  getSymbolRangeAt(i: number): number[] | null {
    const s = this.text;
    if (i < 0 || i >= s.length) return null;
    return s.charAt(i) === ' ' ? null : symbolBoundsAt(s, i, symbols);
  }

  /** ParseTreeFormulaText.clearHighlight. */
  clearHighlight(): void {
    this.selectedRange = null;
    this.selectionCorrect = false;
  }

  /**
   * ParseTreeNodePanel.getExpansionString: the child count (or 0 if collapsed), then each
   * child's string; full: as if every node were expanded (the correct answer's shape).
   */
  getExpansionString(full: boolean): string {
    if (!full && !this.expanded) return '0';
    let s = '' + this.children.length;
    for (const child of this.children) s += ',' + child.getExpansionString(full);
    return s;
  }

  /** The nodes of the subtree in pre-order. */
  *walk(): IterableIterator<ParseTreeNode> {
    yield this;
    for (const child of this.children) yield* child.walk();
  }

  /** The path of child indexes from the root. */
  getPath(): number[] {
    if (this.parent == null) return [];
    const path = this.parent.getPath();
    path.push(this.parent.children.indexOf(this));
    return path;
  }
}

/** The tree: ParseTreePanel (status label, visibility) with its root node. */
export class ParseTree {
  root: ParseTreeNode = new ParseTreeNode(null, '');
  /** ParseTreePanel.statusLabel: "Complete", "Incomplete", "Correct", "Incorrect" or " ". */
  statusLabel = ' ';
  /** Whether the tree is shown (ParseTreePanel.setVisible). */
  visible = false;

  constructor(readonly context: ParseTreeContext) {
    this.updateStatus();
  }

  /**
   * ParseTreePanel.unexpandedCount: the number of hidden children, i.e. the child counts of
   * the nodes that are not expanded. The desktop keeps a running count; it always equals this.
   */
  get unexpandedCount(): number {
    let n = 0;
    for (const node of this.root.walk()) if (!node.expanded) n += node.children.length;
    return n;
  }

  /** ParseTreePanel.isComplete: main-connective mode: the root's selection is right; otherwise every node is expanded. */
  isComplete(): boolean {
    return this.context.noDescent ? this.root.selectionCorrect : this.unexpandedCount === 0;
  }

  /** ParseTreePanel.updateStatus. */
  updateStatus(): void {
    const { checkNow, noDescent } = this.context;
    if (noDescent) {
      const r = this.root.selectedRange;
      const none = r == null || r.length === 0;
      this.statusLabel = checkNow ? (this.isComplete() ? 'Correct' : none ? 'Incomplete' : 'Incorrect') : ' ';
    } else {
      this.statusLabel = checkNow ? (this.isComplete() ? 'Complete' : 'Incomplete') : ' ';
    }
  }

  /** ParseTreeNodePanel.setFormula on the root: a new tree for the text, collapsed. */
  setFormula(s: string | null): void {
    const parsed = new FormulaParseNode(s);
    this.root = parsed.expression != null ? new ParseTreeNode(parsed) : new ParseTreeNode(null, s);
    this.setExpanded(this.root, false);
    this.updateStatus();
  }

  /** ParseTreeNodePanel.setExpanded: collapsing a node collapses its subtree. */
  setExpanded(node: ParseTreeNode, flag: boolean): void {
    const i = node.children.length;
    if (this.context.checkNow && i !== 0) {
      if (node.expanded && !flag) {
        if (this.unexpandedCount === 0) this.statusLabel = 'Incomplete';
      } else if (!node.expanded && flag) {
        node.expanded = true;
        if (this.unexpandedCount === 0) this.statusLabel = 'Complete';
      }
    }
    node.expanded = flag;
    if (!flag) for (const child of node.children) this.setExpanded(child, false);
  }

  /**
   * ParseTreeNodePanel.restoreExpansion: reads an expansion string (see getExpansionString)
   * into the subtree; returns the rest of the string.
   *
   * (Java throws where the string names more children than a node has; such strings are not
   * written by the program. The port skips the missing children.)
   */
  restoreExpansion(node: ParseTreeNode, s: string | null): string {
    if (s == null) s = '';
    const i = s.indexOf(',');
    let head: string;
    if (i === -1) {
      head = s;
      s = '';
    } else {
      head = s.substring(0, i);
      s = s.substring(i + 1);
    }
    const j = parseJavaInt(javaTrim(head)) ?? 0;
    this.setExpanded(node, j !== 0);
    for (let k = 0; k < j; k++) {
      const child = node.getChildNode(k);
      if (child == null) break;
      s = this.restoreExpansion(child, s);
    }
    return s;
  }
}
