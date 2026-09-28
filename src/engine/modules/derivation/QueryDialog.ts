/**
 * A dialog the derivation engine opens, as data (the desktop's MessageDialog with the content
 * its DerivationDialogs methods build). The UI shows it (DerivationDialogs.show), lets the
 * user edit its fields and choices, calls press(i) for a button (the engine's handlers may
 * refuse to close the dialog, e.g. after showing an error) and close() for Escape; show
 * resolves when the dialog is closed. selectedButton then says how (-1: closed without a
 * button).
 *
 * The answers typed after a rule name ("UI/a") fill the fields without showing the dialog
 * (fillFieldsAndChoose).
 */
import type { IntervalSet } from '../../program/IntervalSet';
import type { HighlightedText } from '../../rules/HighlightedText';
import type { TermOccurrenceSelector } from './TermOccurrenceSelector';

/** An editable (or read-only) text field of a dialog: the text as shown (display symbols). */
export class DialogField {
  text: string;
  selectionStart = 0;
  selectionEnd = 0;
  editable: boolean;
  /** The field's name (e.g. "Substitution for P"). */
  name: string | null;

  constructor(text = '', editable = true, name: string | null = null) {
    this.text = text;
    this.editable = editable;
    this.name = name;
    this.selectionStart = this.selectionEnd = text.length;
  }

  getText(): string {
    return this.text;
  }

  setText(s: string): void {
    this.text = s;
    this.selectionStart = this.selectionEnd = s.length;
  }

  select(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  getSelectedText(): string {
    return this.text.substring(this.selectionStart, this.selectionEnd);
  }
}

/** One row of a scheme substitution: a letter (pattern) and its value. */
export interface SubstitutionRow {
  /** The pattern in display symbols, e.g. "P" or "F(x)". */
  label: string;
  /** Highlighted ranges of the label (one layer), or null. */
  labelHighlight: IntervalSet | null;
  field: DialogField;
}

export type DialogBlock =
  /** Explanatory text: a message text with \l (logic) and \n escapes (expandEscapes). */
  | { type: 'text'; text: string }
  /** A formula (maggie symbols; the UI translates), possibly with highlight layers. */
  | { type: 'formula'; text: string; highlight: HighlightedText | null }
  /** Radio choices (texts in display symbols, or highlighted formulas in maggie); dialog.choice is the one selected. */
  | { type: 'choices'; options: { text: string; highlight: HighlightedText | null; enabled: boolean }[] }
  /** One text field. */
  | { type: 'field'; field: DialogField; label: string | null }
  /** A scheme substitution table (SchemeSubstitutionPanel). */
  | { type: 'substitution'; rows: SubstitutionRow[] }
  /** Occurrences of a term to select and replace by placeholders (TermOccurrenceSelector). */
  | { type: 'selector'; selector: TermOccurrenceSelector };

/** A button handler (DialogHandler.handleChoice): whether the dialog may close. */
export interface ChoiceHandler {
  handleChoice(dialog: QueryDialog): Promise<boolean>;
}

/**
 * The kinds are the desktop's method names: chooseFormula, chooseRuleInstance,
 * chooseSideToShow, instanceSchemeQuery, universalTermQuery, existentialVarQuery,
 * dummyVarQuery, generalizationTermQuery, leibniz12TermQuery, leibniz34TermQuery,
 * eulerTermQuery, interchangeFormulaQuery, interchangeRuleQuery, cieRuleQuery,
 * renameBinders (naming bound variables), and message (a message window: id is its title).
 */
export type DialogKind =
  | 'message'
  | 'chooseFormula'
  | 'chooseRuleInstance'
  | 'chooseSideToShow'
  | 'instanceSchemeQuery'
  | 'universalTermQuery'
  | 'existentialVarQuery'
  | 'dummyVarQuery'
  | 'generalizationTermQuery'
  | 'leibniz12TermQuery'
  | 'leibniz34TermQuery'
  | 'eulerTermQuery'
  | 'interchangeFormulaQuery'
  | 'interchangeRuleQuery'
  | 'cieRuleQuery'
  | 'renameBinders';

export class QueryDialog {
  kind: DialogKind;
  title: string;
  blocks: DialogBlock[];
  buttons: string[];
  defaultButton: number;
  /** The selected choice (a 'choices' block). */
  choice = 0;
  selectedButton = -1;
  readonly handlers: ChoiceHandler[] = [];
  /** For a message window: the message id and whether it is an error. */
  messageId: string | null = null;
  isError = false;
  /** The line the dialog is about (its number), or 0. */
  lineNumber = 0;

  constructor(kind: DialogKind, title: string, blocks: DialogBlock[], buttons: string[], defaultButton = 0) {
    this.kind = kind;
    this.title = title;
    this.blocks = blocks;
    this.buttons = buttons;
    this.defaultButton = defaultButton;
  }

  addHandler(handler: ChoiceHandler | null): void {
    if (handler != null) this.handlers.push(handler);
  }

  /** A button was pressed: runs the handlers; true when the dialog closes. */
  async press(i: number): Promise<boolean> {
    this.selectedButton = i;
    if (i < 0 || i >= this.buttons.length) return true;
    return this.runHandlers();
  }

  /** Escape or the window's close box. */
  close(): void {
    this.selectedButton = -1;
  }

  async runHandlers(): Promise<boolean> {
    let ok = true;
    for (const h of this.handlers) ok = (await h.handleChoice(this)) && ok;
    return ok;
  }

  getSelectedLabel(): string | null {
    return this.selectedButton >= 0 && this.selectedButton < this.buttons.length ? this.buttons[this.selectedButton] : null;
  }

  /**
   * MessageDialog.fillFieldsAndChoose: fills the fields from the preset answers (consuming
   * them); if every field is filled, presses button i and returns whether the handlers
   * accept.
   */
  async fillFieldsAndChoose(presets: string[] | null, fields: DialogField[] | null, i: number): Promise<boolean> {
    let j = presets == null ? 0 : presets.length;
    let k = fields == null ? 0 : fields.length;
    if (k < j) j = k;
    k -= j;
    for (let l = 0; l < j; l++) {
      fields![l].setText(presets![0]);
      presets!.splice(0, 1);
      fields![l].select(0, fields![l].text.length);
    }
    if (k === 0 && i !== -1) {
      this.selectedButton = i;
      return this.runHandlers();
    }
    return false;
  }

  /** The dialog's content as plain lines (for tests and logs). */
  describe(): string[] {
    const out: string[] = [];
    for (const b of this.blocks) {
      switch (b.type) {
        case 'text':
          out.push(b.text);
          break;
        case 'formula':
          out.push(b.text);
          break;
        case 'choices':
          for (const o of b.options) out.push('( ) ' + o.text);
          break;
        case 'field':
          out.push((b.label ?? '') + '[' + b.field.text + ']');
          break;
        case 'substitution':
          for (const r of b.rows) out.push(r.label + ' = [' + r.field.text + ']');
          break;
        case 'selector':
          out.push('[' + b.selector.text + ']');
          break;
      }
    }
    return out;
  }
}

/** What the UI implements: showing the engine's dialogs. */
export interface DerivationDialogs {
  /** Shows the dialog; resolves when it is closed (see QueryDialog). */
  show(dialog: QueryDialog): Promise<void>;
}

/**
 * Dialogs for a module without a window (the desktop's hidden LPDerivation, which replays
 * work to compute problem states): every dialog is closed at once; message windows are
 * recorded.
 */
export class HeadlessDialogs implements DerivationDialogs {
  readonly shown: QueryDialog[] = [];

  async show(dialog: QueryDialog): Promise<void> {
    this.shown.push(dialog);
    dialog.close();
  }
}
