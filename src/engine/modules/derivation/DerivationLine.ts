/**
 * Port of DerivationLine.java (without the Swing parts): one row of a derivation. An ordinary
 * line has a formula and a justification (annotation); a Show line (the first node of its
 * DerivationBox) has a formula and a "command log" instead of a justification; a cancel line
 * (the last node of a canceled box) has only a justification.
 *
 * The line keeps one message at a time (message, messageText, messagePhase), the parsed
 * formula, the LineReferences of its justification and the lines citing it (referrers), and
 * the cache of its justification steps (justifications).
 */
import type { Expression } from '../../formula/Expression';
import { FormulaParseException, parseFormula } from '../../formula/parseFormula';
import { Message, type MessageParams, type MessageParamSource, ErrorRef } from '../../program/Message';
import { expandEscapes, maggie, rob, symbols, translateSymbols } from '../../program/symbols';
import { TaggedRecord } from '../../data/TaggedRecord';
import { javaTrim, parseJavaInt } from '../../util/java';
import { COMP_CHECK, EXPR_PARSE, JUST_CHECK, JUST_PARSE } from './DerivationConstants';
import { DerivationBox } from './DerivationBox';
import { DerivationLineEditor } from './DerivationLineEditor';
import { formatDerivationMessage, getDerivationMessage } from './DerivationMessage';
import type { DerivationNode, DerivationNodeBase } from './DerivationNode';
import { DerivationQueryHandler } from './DerivationQueryHandler';
import type { DerivationLineChecker } from './DerivationLineChecker';
import type { Justification } from './Justification';
import { LineReference } from './LineReference';
import { isDigit, isJavaLetter, isJavaWhitespace } from './chars';

/** The "?" button of a line's message: the long explanation and its button actions. */
export class MessageDetails {
  explanation = '';
  handler: DerivationQueryHandler | null = null;

  reset(): void {
    this.explanation = '';
    this.handler = null;
  }

  setHandlerParam(name: string, value: unknown): void {
    if (this.handler != null) this.handler.setProperty(name, value);
  }
}

export class DerivationLine implements DerivationNodeBase, MessageParamSource {
  box: DerivationBox;
  /** The label "Show " / "Problem: " of a Show line (null for other lines). */
  showLabel: string | null;
  formulaEditor: DerivationLineEditor | null;
  annotationEditor: DerivationLineEditor | null;
  /** The command that created a Show line (e.g. "SHOW CONC"), for Show lines. */
  commandLog: { text: string } | null;
  references: LineReference[] | null;
  referrers: LineReference[] = [];
  private lineNumber = 0;
  messagePhase = 0;
  formula: Expression | null = null;
  syntaxOk = true;
  readyToCancel = false;
  errorHighlighted = false;
  justifications: (Justification | null)[] | null = null;
  message: Message | null = null;
  messageText: string | null = null;
  /** A message set from saved work (setMessageText): its text and whether it is an error. */
  shownText: string | null = null;
  shownIsError = false;
  /** Whether the "?" button shows. */
  messageButtonVisible = false;
  readonly messageButton = new MessageDetails();

  constructor(box: DerivationBox, isShow: boolean) {
    this.box = box;
    if (isShow) {
      this.showLabel = box.parentBox == null ? 'Problem: ' : 'Show ';
      this.commandLog = { text: '' };
      this.annotationEditor = null;
      this.references = null;
    } else {
      this.showLabel = null;
      this.commandLog = null;
      this.annotationEditor = new DerivationLineEditor(this);
      this.references = [];
    }
    this.formulaEditor = new DerivationLineEditor(this);
  }

  get module() {
    return this.box.module;
  }

  getEnclosingBox(): DerivationBox | null {
    return this.box.showLine === this ? this.box.parentBox : this.box;
  }

  setFormulaText(s: string): void {
    if (this.formulaEditor != null) this.formulaEditor.setText(translateSymbols(s, maggie, symbols));
  }

  getFormulaText(stripComment: boolean): string | null {
    if (this.formulaEditor == null) return null;
    let s = this.formulaEditor.getText();
    if (stripComment) s = this.stripComment(s)!;
    return translateSymbols(s, symbols, maggie);
  }

  setAnnotationText(s: string): void {
    if (this.annotationEditor != null) this.annotationEditor.setText(s);
  }

  getAnnotationText(stripComment: boolean): string | null {
    if (this.annotationEditor == null) return null;
    let s = this.annotationEditor.getText();
    if (stripComment) s = this.stripComment(s)!;
    return s;
  }

  stripComment(s: string | null): string | null {
    if (s == null) return null;
    const i = s.indexOf('#');
    return i === -1 ? s : javaTrim(s.substring(0, i));
  }

  getParamValue(s: string): string | null {
    if (s === 'line number') return this.getLineNumber() + '';
    if (s === 'wff') return '\\l' + this.getFormulaText(true) + '\\l';
    if (s === 'show') {
      const box = this.getEnclosingBox();
      if (box != null) return '\\l' + box.getFormulaText(true) + '\\l';
    }
    if (s === 'show line number') {
      const box = this.getEnclosingBox();
      if (box != null) return box.showLine.getLineNumber() + '';
    }
    if (s === 'premises') {
      const premises = this.box.module.premises;
      const n = premises == null ? 0 : premises.length;
      let out = '\\l';
      for (let k = 0; k < n; k++) {
        if (k !== 0) out += '\\n';
        out += String(premises![k]);
      }
      return out + '\\l';
    }
    if (s.length >= 7 && s.substring(0, 7) === 'premise') {
      const premises = this.box.module.premises;
      const n = premises == null ? 0 : premises.length;
      const i = parseJavaInt(javaTrim(s.substring(7))) ?? 0;
      if (i > 0 && i <= n) return '\\l' + String(premises![i - 1]) + '\\l';
    }
    if (s === 'branch lines left') {
      const l = this.countLinesBelow();
      return l + ' line' + (l === 1 ? '' : 's');
    }
    if (s === 'operator' || s === 'quantifier' || s === 'connective') {
      const e = this.getFormula();
      return e == null ? '' : '\\l' + e.getSymbol() + '\\l';
    }
    if (s === 'bound variable' || s === 'antecedent') s = 'arg 1';
    else if (s === 'bound wff' || s === 'consequent') s = 'arg 2';
    if (s.length >= 3 && s.substring(0, 3) === 'arg') {
      const e = this.getFormula();
      if (e == null) return '';
      const k = e.getChildCount();
      const i = parseJavaInt(javaTrim(s.substring(3))) ?? 0;
      if (i > 0 && i <= k) return '\\l' + String(e.getChild(i - 1)) + '\\l';
    }
    return null;
  }

  countLinesBelow(): number {
    const node: DerivationNode = this.box.showLine === this ? this.box : this;
    const box = node.getEnclosingBox()!;
    let i = 0;
    const j = box.getContentCount();
    for (let l = node.getIndexInBox() + 1; l < j; l++) i += box.getNode(l).countLines(false);
    return i;
  }

  // ---- messages ----

  /** setMessageText: a message given as text (read from saved work). */
  setMessageText(s: string | null, isError: boolean): void {
    this.messagePhase = 0;
    this.shownText = s == null ? '' : s;
    this.shownIsError = s != null && isError;
  }

  /** showMessage(id) / showMessage(id, params): in the module's current phase. */
  showMessage(id: string, params: MessageParams | null = null): void {
    this.showMessageAt(id, null, this.box.module.phase, params);
  }

  /** showMessage(id, phase) */
  showMessageInPhase(id: string, phase: number, params: MessageParams | null = null): void {
    this.showMessageAt(id, null, phase, params);
  }

  /**
   * DerivationLine.showMessage(s, checker, phase, params): shows the message unless one of a
   * lower (earlier) phase is shown; counts errors (not dererr078/057); with the noErrMess
   * option, errors show as "Error" except on the problem line and for dererr064/078.
   */
  showMessageAt(id: string, checker: DerivationLineChecker | null, phase: number, params: MessageParams | null): void {
    const module = this.box.module;
    if (module.isRestating()) return;
    if (this.messagePhase !== 0 && phase >= this.messagePhase) return;
    this.message = getDerivationMessage(id);
    if (this.message.isError) {
      const mid = this.message.id.toLowerCase();
      if (mid !== 'dererr078' && mid !== 'dererr057') module.errorCount++;
    }
    this.messagePhase = phase;
    this.messageText =
      checker == null
        ? formatDerivationMessage(this.message.title, params, null, this)
        : formatDerivationMessage(this.message.title, params, checker);
    this.shownIsError = this.message.isError;
    const mid = this.message.id.toLowerCase();
    if (module.errorMessagesDisabled && mid !== 'dererr064') {
      if (mid !== 'dererr078' && (this.box.parentBox != null || this.box.showLine !== this)) {
        if (this.message.isError) this.shownText = 'Error';
      } else {
        this.shownText = expandEscapes(this.messageText);
      }
    } else {
      this.shownText = expandEscapes(this.messageText);
      this.messageButtonVisible = true;
      this.prepareExplanation(params, checker);
    }
    if (this.message.isError) this.flagEnclosingBox();
  }

  /** MessageDetailsButton.prepareExplanation. */
  prepareExplanation(params: MessageParams | null, checker: DerivationLineChecker | null): void {
    this.messageButton.explanation =
      checker == null
        ? formatDerivationMessage(this.message!.text, params, null, this)
        : formatDerivationMessage(this.message!.text, params, checker);
    this.messageButton.handler = new DerivationQueryHandler(this, this.message!.buttons);
  }

  /** In serial mode an error in a box also marks the enclosing Show line (dererr078). */
  flagEnclosingBox(): void {
    if (this.box.module.serialMode && this.box.parentBox != null) {
      const box = this.getEnclosingBox()!;
      if (box.parentBox != null) box.showLine.showMessageInPhase('dererr078', COMP_CHECK);
    }
  }

  setMessageButtonParam(name: string, value: unknown): void {
    this.messageButton.setHandlerParam(name, value);
  }

  clearMessage(phase: number = this.box.module.phase): void {
    if (this.box.module.isRestating()) return;
    if (this.messagePhase === 0 || phase === this.messagePhase) {
      this.messageButtonVisible = false;
      this.messageButton.reset();
      this.message = null;
      this.errorHighlighted = false;
      this.messagePhase = 0;
      this.messageText = null;
      this.shownText = '';
      this.shownIsError = false;
    }
  }

  /** The text the message pane shows ('' if none). */
  getShownMessage(): string {
    return this.shownText ?? '';
  }

  getFormulaEditor(): DerivationLineEditor | null {
    return this.formulaEditor;
  }

  getAnnotationEditor(): DerivationLineEditor | null {
    return this.annotationEditor;
  }

  getIndexInBox(): number {
    return this.box.indexOfNode(this);
  }

  focusEditor(annotation: boolean): void {
    this.expandEnclosingBoxes();
    if ((annotation || this.formulaEditor == null) && this.annotationEditor != null) this.annotationEditor.requestFocus();
    else if (this.formulaEditor != null) this.formulaEditor.requestFocus();
  }

  /**
   * commitEdit (Enter in command mode): checks the line at once (interactive), and boxes and
   * cancels it when its rule closes the box and nothing follows it.
   */
  async commitEdit(clearCache: boolean): Promise<void> {
    if (this.annotationEditor != null && (this.formulaEditor == null ? clearCache : this.formulaEditor.getText() === '')) {
      const module = this.box.module;
      module.abort(false);
      module.resetVarNames();
      if (clearCache) this.justifications = null;
      if (module.focus === this.annotationEditor) this.parseReferences();
      else if (module.focus === this.formulaEditor) this.parseFormula();
      if ((await this.checkLine(true)) && this.readyToCancel) await this.toggleBoxAndCancel();
    }
  }

  /** "Show P" typed in the formula field makes the line a Show line of P. */
  applyShowPrefix(): DerivationBox | null {
    if (this.formulaEditor == null || this.annotationEditor == null) return null;
    const s = javaTrim(this.formulaEditor.getText());
    if (s.length < 4 || s.substring(0, 4).toLowerCase() !== 'show') return null;
    if (s.length > 4 && !isJavaWhitespace(s.charAt(4))) return null;
    this.formulaEditor.setText(javaTrim(s.substring(4)));
    return this.makeShowLine();
  }

  insertLineAfter(): DerivationLine | null {
    let box: DerivationBox | null = this.box;
    const editor = this.box.module.focus;
    const flag = editor != null && editor === editor.line.annotationEditor;
    let i = this.getIndexInBox();
    if (this.box.cancelLine === this || !this.box.isExpanded()) {
      box = box.parentBox;
      if (box == null) return null;
      i = this.box.getIndexInBox();
    }
    if (flag) editor!.line.parseReferences();
    const line = box.insertLine(i + 1);
    this.box.module.problem.renumberAll();
    if (flag) {
      editor!.line.refreshReferenceNumbers();
      editor!.line.clearReferences();
    }
    return line;
  }

  deleteNode(_withBody: boolean): void {
    if (this.box.showLine === this) {
      if (this.box.parentBox != null) this.makePlainLine()!.deleteNode(false);
      return;
    }
    if (this.box.cancelLine === this) this.uncancel();
    const editor = this.box.module.focus;
    const flag = editor != null && editor === editor.line.annotationEditor && editor.line !== this;
    if (flag) editor!.line.parseReferences();
    this.clearReferences();
    this.detachReferrers();
    this.suppressEditorFocusLoss();
    this.box.module.forgetFocus(this);
    this.box.removeNode(this);
    this.box.module.problem.renumberAll();
    if (flag) {
      editor!.line.refreshReferenceNumbers();
      editor!.line.clearReferences();
    }
  }

  getNextNode(visibleOnly: boolean): DerivationNode | null {
    let i = this.getIndexInBox() + 1;
    let box: DerivationBox | null = this.box;
    while (box != null && i >= (visibleOnly && !box.isExpanded() ? 1 : box.getContentCount())) {
      i = box.getIndexInBox() + 1;
      box = box.parentBox;
    }
    return box == null ? null : box.getNode(i);
  }

  getPreviousNode(visibleOnly: boolean): DerivationNode | null {
    let i = this.getIndexInBox();
    let box: DerivationBox | null = this.box;
    if (i === 0) {
      i = box.getIndexInBox();
      box = box.parentBox;
    }
    if (box == null) return null;
    let node: DerivationNode = box.getNode(i - 1);
    while (node instanceof DerivationBox) {
      box = node;
      if ((visibleOnly && !box.isExpanded()) || box.getContentCount() === 1) break;
      node = box.getNode(box.getContentCount() - 1);
    }
    return node;
  }

  getHeadNode(): DerivationNode {
    return this.box.showLine === this ? this.box : this;
  }

  isShowLine(): boolean {
    return this.box.showLine === this;
  }

  isCancelLine(): boolean {
    return this.box.cancelLine === this;
  }

  areEnclosingBoxesExpanded(): boolean {
    for (let box = this.box.showLine === this ? this.box.parentBox : this.box; box != null; box = box.parentBox) {
      if (!box.isExpanded()) return false;
    }
    return true;
  }

  expandEnclosingBoxes(): void {
    for (let box = this.box.showLine === this ? this.box.parentBox : this.box; box != null; box = box.parentBox) {
      if (!box.isExpanded()) box.setExpanded(true);
    }
  }

  /** canUse: whether this line may cite node (shows the error if not). */
  canUse(node: DerivationNode): boolean {
    const error = this.usageError(node);
    if (error != null) this.showMessage(error.id, error.params);
    return error == null;
  }

  /** Why this line may not cite node, or null if it may (the scope rule). */
  usageError(node: DerivationNode): ErrorRef | null {
    let box = this.getEnclosingBox();
    let head: DerivationNode = this.getHeadNode();
    const targetBox = node.getEnclosingBox();
    const targetHead = node.getHeadNode();
    if (targetBox != null && this.box.showLine !== this) {
      while (box !== targetBox && box != null) {
        head = box;
        box = box.parentBox;
      }
      if (box === targetBox && targetHead.getIndexInBox() < head.getIndexInBox()) return null;
      const i = targetHead.getLineNumber();
      if (i >= this.getLineNumber()) return new ErrorRef('dererr044', Message.params('remote line number', i + ''));
      if (box === targetBox) return new ErrorRef('dererr045', Message.params('remote line number', i + ''));
      return new ErrorRef('dererr046', Message.params('remote line number', i + ''));
    }
    return new ErrorRef('dererrtxt', Message.params('text', 'unexpected error; contact instructor: LPDerLine.canUse(ILPDerLine)'));
  }

  moveIntoPreviousBox(): void {
    if (this.box.cancelLine === this) this.uncancel();
    if (this.box.showLine === this) {
      this.box.moveIntoPreviousBox();
      return;
    }
    const i = this.getIndexInBox();
    if (i > 0) {
      const node = this.box.getNode(i - 1);
      if (node instanceof DerivationBox) {
        const editor = this.box.module.focus;
        this.box.removeNode(this);
        node.appendNode(this);
        this.box = node;
        // Java: focus.requestFocus() (a NullPointerException when no field has the focus)
        if (editor == null) throw new TypeError('NullPointerException: no focus (DerivationLine.moveIntoPreviousBox)');
        editor.requestFocus();
      }
    }
  }

  /** Alt+Right: moves this line and the lines after it into the last open box before them. */
  indentIntoOpenBox(): void {
    let i = this.getIndexInBox();
    let box: DerivationBox | null = this.box;
    if (i === 0) {
      i = box.getIndexInBox();
      box = box.parentBox;
    }
    if (box != null) {
      let j = i;
      while (--j > 0) {
        const node = box.getNode(j);
        if (node instanceof DerivationBox && node.cancelLine == null && node.isExpanded()) break;
      }
      if (j > 0) {
        while (--i >= j) box.getNode(j + 1).moveIntoPreviousBox();
      }
    }
  }

  moveOutOfBox(): void {
    if (this.box.cancelLine === this) this.uncancel();
    if (this.box.showLine === this) {
      this.box.moveOutOfBox();
      return;
    }
    const i = this.getIndexInBox();
    if (i === this.box.getContentCount() - 1) {
      const parent = this.box.parentBox;
      if (parent != null) {
        const editor = this.box.module.focus;
        this.box.removeNode(this);
        parent.insertNode(this, this.box.getIndexInBox() + 1);
        this.box = parent;
        if (editor == null) throw new TypeError('NullPointerException: no focus (DerivationLine.moveOutOfBox)');
        editor.requestFocus();
      }
    }
  }

  /** Alt+Left: moves this line and the lines after it out of their box. */
  outdentFollowingLines(): void {
    const i0 = this.getIndexInBox();
    let i = i0;
    let box: DerivationBox | null = this.box;
    if (i === 0) {
      i = box.getIndexInBox();
      box = box.parentBox;
    }
    if (box != null && box.parentBox != null) {
      let j = box.getContentCount();
      while (--j >= i) box.getNode(j).moveOutOfBox();
    }
  }

  suppressEditorFocusLoss(): void {
    if (this.formulaEditor != null) this.formulaEditor.ignoreFocusLoss = true;
    if (this.annotationEditor != null) this.annotationEditor.ignoreFocusLoss = true;
  }

  restoreEditorFocusLoss(): void {
    if (this.formulaEditor != null) this.formulaEditor.ignoreFocusLoss = false;
    if (this.annotationEditor != null) this.annotationEditor.ignoreFocusLoss = false;
  }

  /** Ctrl+Shift+S: makes a line a Show line, or a Show line a plain line. */
  toggleShow(): DerivationNode | null {
    return this.box.showLine === this ? this.makePlainLine() : this.makeShowLine();
  }

  /** makeShowLine: the line becomes the Show line of a new box in its place. */
  makeShowLine(): DerivationBox | null {
    if (this.box.showLine === this) return this.box;
    if (this.box.cancelLine === this) return null;
    this.showLabel = 'Show ';
    const annotation = this.annotationEditor;
    this.commandLog = { text: '' };
    this.box.module.forgetFocusOf(annotation);
    this.annotationEditor = null;
    this.clearReferences();
    this.references = null;
    const parent = this.box;
    const i = parent.indexOfNode(this);
    this.suppressEditorFocusLoss();
    const box = new DerivationBox(parent.module, parent, this);
    parent.replaceNode(i, box);
    this.box = box;
    this.restoreEditorFocusLoss();
    return this.box;
  }

  /** makePlainLine: a Show line becomes an ordinary line; its box's body moves out after it. */
  makePlainLine(): DerivationLine | null {
    const parent = this.box.parentBox;
    if (this.box.showLine !== this) return this;
    if (parent == null) return null;
    let i = this.box.getContentCount();
    while (--i > 0) this.box.getNode(i).moveOutOfBox();
    this.showLabel = null;
    this.commandLog = null;
    this.annotationEditor = new DerivationLineEditor(this);
    this.references = [];
    const j = parent.indexOfNode(this.box);
    this.suppressEditorFocusLoss();
    parent.replaceNode(j, this);
    this.box = parent;
    this.restoreEditorFocusLoss();
    return this;
  }

  /** Ctrl+Shift+X: boxes and cancels the line's box, or uncancels it. */
  async toggleBoxAndCancel(): Promise<void> {
    if (this.box.cancelLine === this) this.uncancel();
    else await this.boxAndCancel();
  }

  async boxAndCancel(): Promise<void> {
    const module = this.box.module;
    if (this.box.parentBox == null) {
      await module.showDialogMessage('dernot009', null, null, null, this);
      return;
    }
    if (this.box.showLine === this) {
      await module.showDialogMessage('dernot010', null, null, null, this);
      return;
    }
    if (this.box.cancelLine == null && this.isLastInBox()) this.deleteFollowingLines();
    if (this.box.getContentCount() - 1 !== this.getIndexInBox()) {
      await module.showDialogMessage('dernot011', null, null, null, this);
    } else if (this.box.cancelLine == null) {
      this.setCanceled();
    }
  }

  /** loadProblem's boxAndCancel for a `#` line (its messages are shown without waiting). */
  setCanceledOnLoad(): void {
    const module = this.box.module;
    if (this.box.parentBox == null) {
      void module.showDialogMessage('dernot009', null, null, null, this);
      return;
    }
    if (this.box.showLine === this) {
      void module.showDialogMessage('dernot010', null, null, null, this);
      return;
    }
    if (this.box.cancelLine == null && this.isLastInBox()) this.deleteFollowingLines();
    if (this.box.getContentCount() - 1 !== this.getIndexInBox()) void module.showDialogMessage('dernot011', null, null, null, this);
    else if (this.box.cancelLine == null) this.setCanceled();
  }

  /** The line becomes the box's cancel line (its formula field goes). */
  setCanceled(): void {
    this.formulaEditor!.ignoreFocusLoss = true;
    this.box.module.forgetFocusOf(this.formulaEditor);
    this.formulaEditor = null;
    this.formula = null;
    this.syntaxOk = true;
    this.clearMessage(1);
    this.box.cancelLine = this;
  }

  uncancel(): void {
    if (this.box.cancelLine === this) {
      this.formulaEditor = new DerivationLineEditor(this);
      this.formula = null;
      this.syntaxOk = true;
      this.box.cancelLine = null;
    }
  }

  /** Whether only empty lines follow this one in its box. */
  isLastInBox(): boolean {
    const n = this.box.getContentCount();
    for (let j = this.getIndexInBox() + 1; j < n; j++) {
      const node = this.box.getNode(j);
      if (node instanceof DerivationBox) return false;
      const s = node.getFormulaText(true);
      const s1 = node.getAnnotationText(true);
      if ((s != null && javaTrim(s) !== '') || (s1 != null && javaTrim(s1) !== '')) return false;
    }
    return true;
  }

  deleteFollowingLines(): void {
    const i = this.getIndexInBox() + 1;
    while (this.box.getContentCount() > i) this.box.getNode(i).deleteNode(true);
  }

  renumberLines(i: number): number {
    this.setLineNumber(i);
    return i + 1;
  }

  getMaxBoxDepth(_visibleOnly: boolean): number {
    return 0;
  }

  getBoxDepth(): number {
    return this.box.showLine === this ? this.box.getBoxDepth() : this.box.getBoxDepth() + 1;
  }

  countLines(_visibleOnly: boolean): number {
    return 1;
  }

  getLineNumber(): number {
    return this.lineNumber;
  }

  setLineNumber(i: number): void {
    this.lineNumber = i;
  }

  findLine(_n: number): DerivationNode | null {
    return null;
  }

  /** The node i lines back (i < 0) in the same box or its enclosing boxes' earlier lines. */
  getRelativeNode(i: number | null): DerivationNode | null {
    if (i == null || i >= 0) return null;
    let j = this.getIndexInBox();
    let box: DerivationBox | null = this.box;
    if (j === 0) {
      j = box.getIndexInBox();
      box = box.parentBox;
    }
    if (box == null) return null;
    j += i;
    return j > 0 ? box.getNode(j) : box.showLine.getRelativeNode(j - 1);
  }

  static isOperatorChar(c: string): boolean {
    return !isJavaLetter(c) && c.charCodeAt(0) < 256 ? '~!@#$%^&*()_+-=<>|'.indexOf(c) !== -1 : true;
  }

  /** Relative references such as -2 become line numbers. */
  resolveRelativeReferences(): void {
    const s = this.getAnnotationText(true)!;
    const n = s.length;
    let j = 0;
    let end = 0;
    let c0 = '\u0000';
    let c1 = '\u0000';
    for (;;) {
      let found = false;
      while (j < n) {
        c0 = c1;
        c1 = s.charAt(j);
        if (c1 === '-') {
          found = true;
          break;
        }
        j++;
      }
      if (!found && j >= n) {
        this.refreshReferenceNumbers();
        this.clearReferences();
        return;
      }
      const k = j++;
      for (; j < n; j++) {
        c1 = s.charAt(j);
        if (!isDigit(c1)) break;
      }
      const l = j++;
      if (
        (k === 0 || !DerivationLine.isOperatorChar(c0)) &&
        (l === n || !DerivationLine.isOperatorChar(c1)) &&
        this.addReferenceTo(k - end, l - k, this.getRelativeNode(parseJavaInt(s.substring(k, l)))) != null
      ) {
        end = l;
      }
    }
  }

  /** parseReferences: the line numbers of the justification become LineReferences (phase 2). */
  parseReferences(resolveRelative = true): void {
    const old = this.box.module.setPhase(JUST_PARSE);
    try {
      if (this.annotationEditor == null) return;
      this.clearMessage();
      this.clearReferences();
      if (resolveRelative) this.resolveRelativeReferences();
      const s = this.getAnnotationText(true)!;
      const n = s.length;
      let k = 0;
      let end = 0;
      let c0 = '\u0000';
      let c1 = '\u0000';
      for (;;) {
        while (k < n) {
          c0 = c1;
          c1 = s.charAt(k);
          if (isDigit(c1)) break;
          k++;
        }
        if (k >= n) return;
        const l = k++;
        for (; k < n; k++) {
          c1 = s.charAt(k);
          if (!isDigit(c1)) break;
        }
        const i1 = k++;
        if ((l !== 0 && DerivationLine.isOperatorChar(c0)) || (i1 !== n && DerivationLine.isOperatorChar(c1))) {
          if ((l === 0 || !DerivationLine.isOperatorChar(c0)) && i1 !== n && DerivationLine.isOperatorChar(c1)) {
            this.showMessage('dererr047');
          }
        } else if (this.addReferenceNumber(l - end, i1 - l, parseJavaInt(s.substring(l, i1))) != null) {
          end = i1;
        }
      }
    } finally {
      this.box.module.setPhase(old);
    }
  }

  /** Rewrites the cited line numbers from their targets' current numbers. */
  refreshReferenceNumbers(): void {
    const s = this.getAnnotationText(false);
    if (s == null) return;
    const editor = this.annotationEditor!;
    let out = '';
    let j = 0;
    const focused = this.box.module.focus === editor;
    if (focused) editor.saveSelection(false);
    for (const ref of this.references!) {
      const s2 = ref.target.getLineNumber().toString();
      editor.adjustSavedSelection(out.length + ref.offset, ref.length, s2.length);
      out += s.substring(j, j + ref.offset) + s2;
      j += ref.offset + ref.length;
      ref.length = s2.length;
    }
    out += s.substring(j);
    this.setAnnotationText(out);
    if (focused) editor.restoreSelection();
  }

  addReferenceTo(offset: number, length: number, node: DerivationNode | null): LineReference | null {
    if (node == null) return null;
    const ref = new LineReference(offset, length, node, this);
    this.references!.push(ref);
    node.addReferrer(ref);
    return ref;
  }

  addReferenceNumber(offset: number, length: number, n: number | null): LineReference | null {
    return n == null ? null : this.addReferenceTo(offset, length, this.box.module.problem.findLine(n));
  }

  /** The cited line was deleted: its number becomes <deleted>. */
  removeReference(ref: LineReference): void {
    const refs = this.references!;
    let n = refs.length;
    let j = 0;
    ref.target.removeReferrer(ref);
    const editor = this.annotationEditor;
    const focused = this.box.module.focus === editor && editor != null;
    if (focused) editor!.saveSelection(false);
    for (let k = 0; k < n; k++) {
      const r = refs[k];
      if (r === ref) {
        const s = this.getAnnotationText(false)!;
        const s1 = '<deleted>';
        editor!.adjustSavedSelection(j + r.offset, r.length, s1.length);
        this.setAnnotationText(s.substring(0, j + r.offset) + s1 + s.substring(j + r.offset + r.length));
        refs.splice(k, 1);
        n--;
        j = r.offset + s1.length;
        if (k < n) refs[k].offset += j;
        break;
      }
      j += r.offset + r.length;
    }
    if (focused) editor!.restoreSelection();
  }

  clearReferences(): void {
    const refs = this.references;
    if (refs == null) return;
    let i = refs.length;
    while (--i >= 0) {
      const ref = refs[i];
      ref.target.removeReferrer(ref);
      refs.splice(i, 1);
    }
  }

  addReferrer(ref: LineReference): void {
    this.referrers.push(ref);
  }

  removeReferrer(ref: LineReference): void {
    const i = this.referrers.indexOf(ref);
    if (i !== -1) this.referrers.splice(i, 1);
  }

  detachReferrers(): void {
    while (this.referrers.length !== 0) {
      const ref = this.referrers[0];
      ref.source.removeReference(ref);
    }
  }

  retargetReferrers(): void {
    const node: DerivationNode = this.box.showLine === this ? this.box : this;
    for (const ref of this.referrers) ref.target = node;
  }

  /** dernot053: a Show line whose formula is an earlier line or a premise. */
  checkRedundantShow(): void {
    if (this.syntaxOk && this.formula != null && this === this.box.showLine && this.box.parentBox != null) {
      let i = this.box.getIndexInBox();
      for (let box: DerivationBox | null = this.box.parentBox; box != null; box = box.parentBox) {
        while (--i !== 0) {
          const node = box.getNode(i);
          if (this.formula.isIdentical(node.getFormula())) {
            this.showMessage('dernot053', Message.params('previous', 'line ' + node.getLineNumber()));
            return;
          }
        }
        i = box.getIndexInBox();
      }
      const premises = this.box.module.premises;
      const n = premises == null ? 0 : premises.length;
      for (let k = 0; k < n; k++) {
        if (this.formula.isIdentical(premises![k])) {
          this.showMessage('dernot053', Message.params('previous', 'premise ' + (k + 1)));
          return;
        }
      }
    }
  }

  checkSyntax(): boolean {
    if (this.box.module.focus === this.formulaEditor && this.formulaEditor != null) this.parseFormula();
    return this.syntaxOk;
  }

  /** parseFormula (phase 1): parses the formula; the problem line is parsed as the argument. */
  parseFormula(): void {
    const old = this.box.module.setPhase(EXPR_PARSE);
    try {
      this.syntaxOk = true;
      if (this.formulaEditor == null) return;
      this.clearMessage();
      if (this.box.showLine === this && this.box.parentBox == null) {
        this.box.module.parseProblem();
        return;
      }
      this.applyShowPrefix();
      try {
        this.formula = parseFormula(this.getFormulaText(true), false, false, this.box.showLine === this);
      } catch (e) {
        if (!(e instanceof FormulaParseException)) throw e;
        this.formula = null;
        const s = e.message;
        if (s == null || s === '') this.showMessage('dererr059', Message.params('parser error', this.getFormulaText(true)));
        else this.showMessage('dererrtxt', Message.params('text', s));
        this.syntaxOk = false;
      }
    } finally {
      this.box.module.setPhase(old);
    }
  }

  getFormula(): Expression | null {
    return this.formula;
  }

  verify(): Promise<boolean> {
    return this.checkLine(false);
  }

  /**
   * checkLine (phase 3): checks the justification step by step with a DerivationLineChecker.
   * interactive: the user just entered the line (dialogs, filling in an empty formula and
   * the SHOW commands are allowed).
   */
  async checkLine(interactive: boolean): Promise<boolean> {
    const module = this.box.module;
    const old = module.setPhase(JUST_CHECK);
    try {
      if (!this.syntaxOk) {
        this.box.strategyConsistent = false;
        return false;
      }
      this.readyToCancel = false;
      if (this.box.showLine !== this) this.clearMessage(COMP_CHECK);
      this.clearMessage();
      if (this.annotationEditor != null) {
        const checker = module.createChecker(this, interactive);
        if (this.formulaEditor != null && this.formula == null) {
          if (javaTrim(this.getAnnotationText(true)!) === '') {
            if (!interactive) this.showMessage('derinf003');
            return true;
          }
          if (!interactive) {
            this.showMessage('derinf004');
            return true;
          }
        }
        while (await checker.readNextStep()) {
          if (checker.getRuleName() == null) {
            this.showMessage('dererr049');
            this.box.strategyConsistent = false;
            return false;
          }
          if (!checker.skipToNextStep()) {
            if (module.serialMode) return (await checker.checkStep(true)) && this.checkNotAtTopLevel();
            if (interactive) return await checker.checkStep(true);
            if (!(await checker.checkStep(false, true))) return false;
            if (checker.lineFormula == null || checker.lineFormula.isIdentical(checker.result)) return true;
            let params: MessageParams | null = null;
            if (checker.consumedFormulas != null) {
              let s = '';
              checker.consumedFormulas.forEach((f, k) => (s += (k === 0 ? '' : '\\n') + String(f)));
              params = Message.putParam(params, 'rule form premises', '\\l' + s + '\\l');
            }
            const props = module.commandMode ? new Map<string, unknown>() : null;
            if (props != null) {
              if (this.justifications != null) props.set('caches', this.justifications);
              props.set('just', checker);
              if (checker.result != null) {
                props.set('sum', checker.result);
                params = Message.putParam(params, 'rule form conclusion', '\\l' + String(checker.result) + '\\l');
              }
            }
            await module.showDialogMessage(module.commandMode ? 'dernot100' : 'dernot101', params, props, checker);
            return false;
          }
          if (!module.queuedMode) {
            this.showMessage('dererr050');
            this.box.strategyConsistent = false;
            return false;
          }
          if (!(await checker.checkStep(false))) return false;
          if (module.aborted()) return false;
          if (checker.matchLine) return true;
          this.collectVariables(checker.result);
          this.readyToCancel = false;
        }
        return false;
      }
      if (this.formula != null) return true;
      this.showMessage('dererr048');
      this.box.strategyConsistent = false;
      return false;
    } finally {
      if (this.box.showLine !== this) this.collectVariables(this.formula);
      module.setPhase(old);
    }
  }

  collectVariables(e: Expression | null): void {
    if (this.box.boxVariables == null) this.box.boxVariables = [];
    if (this.box.module.varNames == null) this.box.module.varNames = [];
    if (e != null) e.collectTermSymbols(this.box.module.varNames, this.box.boxVariables);
  }

  checkNotAtTopLevel(): boolean {
    if (this.annotationEditor != null && this.box.parentBox == null) {
      this.showMessageInPhase('dererr051', COMP_CHECK);
      this.box.module.complete = false;
      return false;
    }
    return true;
  }

  encodeJustifications(): string {
    let s = '';
    if (this.justifications != null) {
      let empty = true;
      for (const j of this.justifications) {
        if (j != null) empty = false;
        s += TaggedRecord.formatField(j == null ? '' : j.encode(), ':');
      }
      if (empty) s = '';
    }
    return s;
  }

  encodeWork(): string {
    if (this.box.showLine === this) {
      let s = TaggedRecord.formatField(this.getFormulaText(false), this.box.isExpanded() ? '-' : '+');
      const log = this.commandLog == null ? null : translateSymbols(this.commandLog.text, symbols, rob);
      if (log != null && log.length !== 0) s += TaggedRecord.formatField(log, 's');
      return s + this.encodeJustifications();
    }
    const s = translateSymbols(this.getAnnotationText(false)!, symbols, rob);
    return this.box.cancelLine === this
      ? TaggedRecord.formatField(s, '#') + this.encodeJustifications()
      : TaggedRecord.formatField(this.getFormulaText(false), '<') + TaggedRecord.formatField(s, '>') + this.encodeJustifications();
  }

  encodeMessages(): string {
    return this.message != null && this.message.isError
      ? TaggedRecord.formatField(this.getLineNumber() + ':' + this.messageText, 'm')
      : '';
  }
}

