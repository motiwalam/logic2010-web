/**
 * The model of DerivationLineEditor.java: one of a line's two text fields (the formula or the
 * justification), with the selection it keeps while it does not have the focus, and the
 * desktop's key handling (Enter, Ctrl+Shift+S/X/Q, Tab, Alt+Delete, Up/Down, Alt+arrows) as
 * operations on the derivation.
 *
 * The UI shows `text` and reports edits with setText and selection changes with select; the
 * module's focus (LPDerivation.focus) is the editor the UI has focused. Where the desktop
 * requests the focus for another field, the module records it (LPDerivation.requestFocus)
 * and moves it when the operation ends (flushFocus), running focusLost and focusGained as the
 * Swing focus events would.
 */
import type { DerivationLine } from './DerivationLine';
import type { DerivationNode } from './DerivationNode';

/** KeyEvent modifier bits (InputEvent.SHIFT_MASK, CTRL_MASK, META_MASK, ALT_MASK). */
export const SHIFT = 1;
export const CTRL = 2;
export const META = 4;
export const ALT = 8;

/** Key codes of handleKeyPressed (KeyEvent.VK_*). */
export const VK_LEFT = 37;
export const VK_UP = 38;
export const VK_RIGHT = 39;
export const VK_DOWN = 40;

export class DerivationLineEditor {
  line: DerivationLine;
  text = '';
  selectionStart = 0;
  selectionEnd = 0;
  caretPosition = 0;
  savedSelectionStart = 0;
  savedSelectionEnd = 0;
  savedCaretPosition = 0;
  ignoreFocusLoss = false;
  editable = true;

  constructor(line: DerivationLine) {
    this.line = line;
  }

  get module() {
    return this.line.box.module;
  }

  isAnnotation(): boolean {
    return this.line.annotationEditor === this;
  }

  getText(): string {
    return this.text;
  }

  /** JTextComponent.setText: the caret ends at the end of the text. */
  setText(s: string | null): void {
    this.text = s ?? '';
    this.selectionStart = this.selectionEnd = this.caretPosition = this.text.length;
  }

  /** An edit by the user (the UI's input): the text and the selection after it. */
  edit(s: string, selectionStart = s.length, selectionEnd = selectionStart): void {
    this.text = s;
    this.select(selectionStart, selectionEnd);
  }

  select(start: number, end: number): void {
    const n = this.text.length;
    start = Math.max(0, Math.min(start, n));
    end = Math.max(start, Math.min(end, n));
    this.selectionStart = start;
    this.selectionEnd = end;
    this.caretPosition = end;
  }

  setCaretPosition(i: number): void {
    this.select(i, i);
  }

  getSelectionStart(): number {
    return this.selectionStart;
  }

  getSelectionEnd(): number {
    return this.selectionEnd;
  }

  getCaretPosition(): number {
    return this.caretPosition;
  }

  requestFocus(): void {
    this.module.requestFocus(this);
  }

  // ---- key handling (handleKeyTyped / handleKeyPressed) ----

  /**
   * DerivationLineEditor.handleKeyTyped: c is the typed character (Ctrl+Shift+S is '\u0013',
   * Ctrl+Shift+X '\u0018', Ctrl+Shift+Q '\u0011', Enter '\n', Alt+Delete '\u007f' with ALT),
   * modifiers the SHIFT/CTRL/ALT bits. Returns whether the key was handled.
   */
  async handleKeyTyped(c: string, modifiers: number): Promise<boolean> {
    const code = c.charCodeAt(0);
    const line = this.line;
    if (code === 17 && (modifiers & SHIFT) !== 0) return true;
    if (code === 19 && (modifiers & SHIFT) !== 0) {
      const node = line.toggleShow();
      if (node != null) node.focusEditor(false);
      return true;
    }
    if (code === 24 && (modifiers & SHIFT) !== 0) {
      await line.toggleBoxAndCancel();
      if (line.box.cancelLine === line) line.focusEditor(true);
      return true;
    }
    if (c === '\t' && (modifiers & CTRL) === 0) {
      line.focusEditor(this === line.formulaEditor);
      return true;
    }
    if (c !== '\n' && c !== '\r') {
      if (code === 127 && (modifiers & ALT) !== 0) {
        if ((modifiers & SHIFT) !== 0 && line === line.box.showLine) line.deleteFollowingLines();
        if (line.box.module.problem.showLine !== line) {
          let node: DerivationNode | null = line.getNextNode(false);
          if (node == null) node = line.getPreviousNode(true);
          const annotation = line.annotationEditor === this;
          line.deleteNode(false);
          node!.focusEditor(annotation);
        }
        return true;
      }
      return false;
    }
    if (this === line.formulaEditor) line.applyShowPrefix();
    let next: DerivationLine | null = null;
    const annotation = line.annotationEditor === this;
    const j = modifiers & (SHIFT | CTRL | ALT);
    if (line.box.module.commandMode) {
      if (line.annotationEditor != null && (j === SHIFT || j === CTRL)) {
        line.clearMessage(1);
        line.setFormulaText('');
        line.formula = null;
        line.syntaxOk = true;
      }
      if (j !== (SHIFT | CTRL) && j !== ALT) await line.commitEdit(j !== 0 || line.formulaEditor != null);
      next = j === SHIFT ? line : line.insertLineAfter();
    } else {
      next = line.insertLineAfter();
    }
    if (next != null) {
      if (next !== line && line.box.showLine === line) next.focusEditor(line.box.module.commandMode);
      else next.focusEditor(annotation);
    }
    return true;
  }

  /** DerivationLineEditor.handleKeyPressed: Up/Down (Alt: collapse/expand), Alt+Right/Left. */
  handleKeyPressed(keyCode: number, modifiers: number, c = ''): boolean {
    const line = this.line;
    if (c === '\t' && (modifiers & CTRL) === 0) return true;
    if (keyCode === VK_UP) {
      if ((modifiers & ALT) === 0) {
        const node = line.getPreviousNode(true);
        if (node != null) node.focusEditor(line.annotationEditor === this);
      } else if (line.box.showLine === line && line.box.module.problem.showLine !== line && line.box.getContentCount() > 1) {
        line.box.setExpanded(false);
      }
      return true;
    }
    if (keyCode === VK_DOWN) {
      if ((modifiers & ALT) === 0) {
        const node = line.getNextNode(true);
        if (node != null) node.focusEditor(line.annotationEditor === this);
      } else if (line.box.showLine === line) {
        line.box.setExpanded(true);
      }
      return true;
    }
    if (keyCode === VK_RIGHT && (modifiers & ALT) !== 0) {
      line.indentIntoOpenBox();
      return true;
    }
    if (keyCode === VK_LEFT && (modifiers & ALT) !== 0) {
      line.outdentFollowingLines();
      return true;
    }
    return false;
  }

  // ---- focus ----

  /** focusGained: the editor gets the module's focus. */
  focusGained(): void {
    const module = this.module;
    if (module.focus !== this) {
      if (this === this.line.annotationEditor) {
        this.line.refreshReferenceNumbers();
        this.line.clearReferences();
      }
      this.restoreSelection();
      module.focus = this;
      module.lastFocus = this;
    }
  }

  /** focusLost: parses what was edited (the references, or the formula and a redundant Show). */
  focusLost(): void {
    const module = this.module;
    if (module.focus === this) {
      if (this.ignoreFocusLoss) {
        this.ignoreFocusLoss = false;
      } else if (this === this.line.annotationEditor) {
        this.line.parseReferences();
      } else if (this === this.line.formulaEditor) {
        this.line.parseFormula();
        this.line.checkRedundantShow();
      }
      this.saveSelection(true);
      module.focus = null;
    }
  }

  saveSelection(clear: boolean): void {
    this.savedSelectionStart = this.selectionStart;
    this.savedSelectionEnd = this.selectionEnd;
    this.savedCaretPosition = this.caretPosition;
    if (clear) this.select(0, 0);
  }

  restoreSelection(): void {
    this.select(this.savedSelectionStart, this.savedSelectionEnd);
  }

  /** The text at i of length j became length k: shifts the saved selection. */
  adjustSavedSelection(i: number, j: number, k: number): void {
    const adjust = (p: number) => (p >= i + j ? p + (k - j) : p > i + k ? i + k : p);
    this.savedSelectionStart = adjust(this.savedSelectionStart);
    this.savedSelectionEnd = adjust(this.savedSelectionEnd);
    this.savedCaretPosition = adjust(this.savedCaretPosition);
  }
}
