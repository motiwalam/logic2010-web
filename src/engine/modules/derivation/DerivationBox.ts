/**
 * Port of DerivationBox.java (and the collapsing of CollapsibleNode.java), without the Swing
 * parts: one (sub)derivation. Node 0 is the Show line; the others are lines and nested boxes.
 * A canceled box's last line is its cancelLine. The root box's Show line is the "Problem:"
 * line holding the argument.
 *
 * Scratch state filled in while checking: assumptionType (ASS_DD/ID/CD/BD: which assumption
 * opened the box), assumedSide (the side of a biconditional assumed, -1 none, 2 either),
 * boxVariables (the free variables occurring in the box, for the UD restriction) and
 * strategyConsistent.
 */
import type { Expression } from '../../formula/Expression';
import type { MessageParams } from '../../program/Message';
import { COMP_CHECK } from './DerivationConstants';
import { DerivationLine } from './DerivationLine';
import type { DerivationLineEditor } from './DerivationLineEditor';
import type { DerivationNode, DerivationNodeBase } from './DerivationNode';
import type { LineReference } from './LineReference';
import type { LPDerivation } from './LPDerivation';

export class DerivationBox implements DerivationNodeBase {
  module: LPDerivation;
  parentBox: DerivationBox | null;
  showLine: DerivationLine;
  cancelLine: DerivationLine | null = null;
  assumptionType = 0;
  boxVariables: string[] | null = null;
  strategyConsistent = false;
  assumedSide = -1;
  private expanded = true;
  /** The nodes: the Show line, then the body. */
  private readonly nodes: DerivationNode[] = [];

  /** A box in parent (a new Show line, or showLine made the Show line); the root box if parent is null. */
  constructor(module: LPDerivation, parent: DerivationBox | null, showLine: DerivationLine | null = null) {
    this.module = module;
    this.parentBox = parent;
    this.showLine = showLine ?? new DerivationLine(this, true);
    this.nodes.push(this.showLine);
  }

  getEnclosingBox(): DerivationBox | null {
    return this.parentBox;
  }

  // ---- the nodes (content indexes) ----

  getContentCount(): number {
    return this.nodes.length;
  }

  getNode(i: number): DerivationNode {
    const node = this.nodes[i];
    if (node === undefined) throw new RangeError('ArrayIndexOutOfBoundsException: ' + i);
    return node;
  }

  /** The nodes (read-only view): the Show line, then the body. */
  getNodes(): readonly DerivationNode[] {
    return this.nodes;
  }

  indexOfNode(node: DerivationNode): number {
    return this.nodes.indexOf(node);
  }

  /** Adds a node at index i (-1: at the end). */
  insertNode(node: DerivationNode, i: number): void {
    if (i < 0 || i > this.nodes.length) this.nodes.push(node);
    else this.nodes.splice(i, 0, node);
  }

  appendNode(node: DerivationNode): void {
    this.nodes.push(node);
  }

  removeNode(node: DerivationNode): void {
    const i = this.nodes.indexOf(node);
    if (i !== -1) this.nodes.splice(i, 1);
  }

  replaceNode(i: number, node: DerivationNode): void {
    this.nodes[i] = node;
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
  }

  expandAll(): void {
    this.setExpanded(true);
    for (const node of this.nodes) if (node instanceof DerivationBox) node.expandAll();
  }

  getLineNumber(): number {
    return this.showLine.getLineNumber();
  }

  /** The node numbered i in this box or its boxes (a binary search over the body). */
  findLine(i: number): DerivationNode | null {
    if (i <= 0) return null;
    let j = 1;
    let l = this.getContentCount() - 1;
    if (l < j) return null;
    let node = this.getNode(j);
    let n = node.getLineNumber();
    if (n === i) return node;
    if (i < n) return null;
    let before = node;
    node = this.getNode(l);
    n = node.getLineNumber();
    if (n === i) return node;
    if (i > n) return node.findLine(i);
    while (l - j > 1) {
      const k = Math.trunc((j + l) / 2);
      node = this.getNode(k);
      n = node.getLineNumber();
      if (n === i) return node;
      if (i < n) {
        l = k;
      } else {
        j = k;
        before = node;
      }
    }
    return before.findLine(i);
  }

  /** insertLine(i): a new line at index i (-1: at the end); renumbers. */
  insertLine(i: number): DerivationLine {
    const line = new DerivationLine(this, false);
    this.insertNode(line, i);
    this.module.problem.renumberAll();
    return line;
  }

  insertBox(i: number): DerivationBox {
    const box = new DerivationBox(this.module, this);
    this.insertNode(box, i);
    this.module.problem.renumberAll();
    return box;
  }

  renumberAll(): void {
    this.renumberLines(0);
    this.refreshReferenceNumbers();
  }

  refreshReferenceNumbers(): void {
    for (const node of this.nodes.slice()) node.refreshReferenceNumbers();
  }

  renumberLines(i: number): number {
    for (const node of this.nodes) i = node.renumberLines(i);
    return i;
  }

  getMaxBoxDepth(visibleOnly: boolean): number {
    if (visibleOnly && !this.isExpanded()) return 0;
    let j = 0;
    for (let k = 1; k < this.nodes.length; k++) {
      const l = this.nodes[k].getMaxBoxDepth(visibleOnly) + 1;
      if (l > j) j = l;
    }
    return j;
  }

  resetVariables(): void {
    this.boxVariables = null;
    for (let j = 1; j < this.nodes.length; j++) {
      const node = this.nodes[j];
      if (node instanceof DerivationBox) node.resetVariables();
    }
  }

  getBoxDepth(): number {
    return this.parentBox == null ? 0 : this.parentBox.getBoxDepth() + 1;
  }

  countLines(visibleOnly: boolean): number {
    let i = 1;
    if (!visibleOnly || this.isExpanded()) {
      for (let k = 1; k < this.nodes.length; k++) i += this.nodes[k].countLines(visibleOnly);
    }
    return i;
  }

  insertLineAfter(): DerivationLine | null {
    return this.showLine.insertLineAfter();
  }

  deleteNode(withBody: boolean): void {
    if (withBody) {
      let i = this.getContentCount();
      while (--i > 0) this.getNode(i).deleteNode(true);
    }
    this.showLine.deleteNode(false);
    this.module.problem.renumberAll();
  }

  setFormulaText(s: string): void {
    this.showLine.setFormulaText(s);
  }

  getFormulaText(stripComment: boolean): string | null {
    return this.showLine.getFormulaText(stripComment);
  }

  setAnnotationText(s: string): void {
    this.showLine.setAnnotationText(s);
  }

  getAnnotationText(stripComment: boolean): string | null {
    return this.showLine.getAnnotationText(stripComment);
  }

  setMessageText(s: string | null, isError: boolean): void {
    this.showLine.setMessageText(s, isError);
  }

  showMessage(id: string, params: MessageParams | null = null): void {
    this.showLine.showMessage(id, params);
  }

  showMessageInPhase(id: string, phase: number): void {
    this.showLine.showMessageInPhase(id, phase);
  }

  clearMessage(): void {
    this.showLine.clearMessage();
  }

  getFormulaEditor(): DerivationLineEditor | null {
    return this.showLine.formulaEditor;
  }

  getAnnotationEditor(): DerivationLineEditor | null {
    return null;
  }

  getIndexInBox(): number {
    return this.parentBox == null ? -1 : this.parentBox.indexOfNode(this);
  }

  focusEditor(_annotation: boolean): void {
    this.showLine.focusEditor(false);
  }

  getNextNode(visibleOnly: boolean): DerivationNode | null {
    return this.showLine.getNextNode(visibleOnly);
  }

  getPreviousNode(visibleOnly: boolean): DerivationNode | null {
    return this.showLine.getPreviousNode(visibleOnly);
  }

  getHeadNode(): DerivationNode {
    return this;
  }

  isShowLine(): boolean {
    return true;
  }

  isCancelLine(): boolean {
    return false;
  }

  areEnclosingBoxesExpanded(): boolean {
    return this.showLine.areEnclosingBoxesExpanded();
  }

  expandEnclosingBoxes(): void {
    this.showLine.expandEnclosingBoxes();
  }

  moveIntoPreviousBox(): void {
    const i = this.getIndexInBox();
    if (i > 0) {
      const node = this.parentBox!.getNode(i - 1);
      if (node instanceof DerivationBox) {
        this.parentBox!.removeNode(this);
        node.appendNode(this);
        this.parentBox = node;
      }
    }
  }

  moveOutOfBox(): void {
    if (this.parentBox != null) {
      const i = this.getIndexInBox();
      if (i === this.parentBox.getContentCount() - 1) {
        const grand = this.parentBox.parentBox;
        if (grand != null) {
          this.parentBox.removeNode(this);
          grand.insertNode(this, this.parentBox.getIndexInBox() + 1);
          this.parentBox = grand;
        }
      }
    }
  }

  addReferrer(r: LineReference): void {
    this.showLine.addReferrer(r);
  }

  removeReferrer(r: LineReference): void {
    this.showLine.removeReferrer(r);
  }

  detachReferrers(): void {
    this.showLine.detachReferrers();
  }

  retargetReferrers(): void {
    this.showLine.retargetReferrers();
  }

  checkSyntax(): boolean {
    let ok = true;
    for (const node of this.nodes) ok = node.checkSyntax() && ok;
    return ok;
  }

  getFormula(): Expression | null {
    return this.showLine.getFormula();
  }

  encodeWork(): string {
    let s = '';
    for (const node of this.nodes) s += node.encodeWork();
    if (this.cancelLine == null) s += '`=';
    return s;
  }

  encodeMessages(): string {
    let s = '';
    for (const node of this.nodes) s += node.encodeMessages();
    return s;
  }

  /**
   * verify (phase 4): the box structure (a sub-box must be canceled, dererr055; the root box
   * must reach the conclusion, dererr052..054) and every line of it.
   */
  async verify(): Promise<boolean> {
    const module = this.module;
    const old = module.setPhase(COMP_CHECK);
    if (this.parentBox != null) this.parentBox.strategyConsistent = false;
    this.strategyConsistent = true;
    try {
      const j = this.getContentCount();
      this.clearMessage();
      let ok: boolean;
      if (this.parentBox != null) {
        this.assumptionType = 0;
        this.assumedSide = -1;
        ok = await this.showLine.verify();
        if (this.cancelLine == null) {
          this.showMessage('dererr055');
          module.complete = false;
          ok = false;
        }
      } else {
        ok = module.conclusion != null;
        if (!ok) {
          this.showMessage(module.premises!.length === 0 ? 'dererr052' : 'dererr053');
        } else {
          let found = false;
          let k = 1;
          while (k < j && !(found = module.isConclusion(this.getNode(k).getFormula()))) k++;
          if (!found) {
            this.showMessage('dererr054');
            ok = false;
          }
        }
      }
      this.addShowVariablesToModule();
      for (let l = 1; l < j; l++) {
        ok = (await this.getNode(l).verify()) && ok;
        if (module.aborted()) return false;
      }
      this.exportVariablesToParent();
      return ok;
    } finally {
      module.setPhase(old);
    }
  }

  addShowVariablesToModule(): void {
    if (this.parentBox != null) {
      if (this.module.varNames == null) this.module.varNames = [];
      const e = this.showLine.getFormula();
      if (e != null) e.collectTermSymbols(this.module.varNames, null);
    }
  }

  exportVariablesToParent(): void {
    if (this.parentBox != null) {
      if (this.parentBox.boxVariables == null) this.parentBox.boxVariables = [];
      const e = this.showLine.getFormula();
      if (e != null) e.collectTermSymbols(null, this.parentBox.boxVariables);
    }
  }

  isUniversalVariableFree(): boolean {
    const e = this.showLine.getFormula();
    if (e == null || e.getSymbol() !== '@') return false;
    const s = e.getChild(0)!.getSymbol();
    for (let box = this.parentBox; box != null; box = box.parentBox) {
      if (box.boxVariables != null && box.boxVariables.includes(s)) return false;
    }
    return true;
  }
}
