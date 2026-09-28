/**
 * Port of TermOccurrenceSelector.java and its subclasses (GeneralizationTermSelector,
 * Leibniz12TermSelector, Leibniz34TermSelector, EulerTermSelector), PlaceholderEdit.java and
 * SubstitutionValuesPanel.java, as a model: a read-only formula in which the user selects
 * occurrences of a term and replaces them with a placeholder {1} (Alt+1 on the desktop;
 * insertPlaceholder here), with undo. Each selection is validated; the failures are the
 * subclass's dernotNNN messages, shown with showMessage.
 */
import type { Expression, Term } from '../../formula/Expression';
import { Term as TermClass } from '../../formula/Expression';
import { FormulaParseException, parseFormula } from '../../formula/parseFormula';
import { FormulaParseNode } from '../../formula/FormulaParseNode';
import { SchematicLetter } from '../../formula/SchematicLetter';
import { Message, type MessageParams } from '../../program/Message';
import { escapeBackslashes, maggie, symbols, translateSymbols } from '../../program/symbols';
import type { SchematicLetter as Letter } from '../../formula/SchematicLetter';

export type SelectorKind = 'generalization' | 'leibniz12' | 'leibniz34' | 'euler';

/** The messages of each kind: not well formed, not a term, not a standalone term, bound occurrence, different term. */
const REPORTS: Record<SelectorKind, [string, string, string, string, string]> = {
  generalization: ['dernot014', 'dernot015', 'dernot028', 'dernot026', 'dernot016'],
  leibniz12: ['dernot030', 'dernot031', 'dernot035', 'dernot033', 'dernot032'],
  leibniz34: ['dernot036', 'dernot037', 'dernot042', 'dernot039', 'dernot038'],
  euler: ['dernot048', 'dernot049', 'dernot050', 'dernot051', 'dernot052'],
};

interface PlaceholderEdit {
  placeholderIndex: number;
  position: number;
  replacedText: string;
}

export class TermOccurrenceSelector {
  kind: SelectorKind;
  /** The formula as shown (display symbols), with the placeholders put in. */
  text: string;
  placeholderCount: number;
  undoStack: PlaceholderEdit[] = [];
  selectedTerms: (Term | null)[];
  selectionCounts: number[];
  /** The value of each placeholder, as the SubstitutionValuesPanel shows it (display symbols). */
  values: (string | null)[];
  messageParams: MessageParams;
  /** Leibniz/Euler: the parameters their messages add. */
  extraParams: MessageParams | null;
  /** Leibniz34: the rule's letter the selection instantiates. */
  ruleLetter: Letter | null = null;
  /** Shows a message window (DerivationDialogs.showMessage(id, params)). */
  showMessage: (id: string, params: MessageParams | null) => Promise<void>;

  constructor(
    kind: SelectorKind,
    e: Expression,
    showMessage: (id: string, params: MessageParams | null) => Promise<void>,
    params: MessageParams | null = null,
    placeholderCount = 1,
  ) {
    this.kind = kind;
    this.text = translateSymbols(e.format(true, 1), maggie, symbols);
    this.placeholderCount = placeholderCount;
    this.selectedTerms = new Array<Term | null>(placeholderCount).fill(null);
    this.selectionCounts = new Array<number>(placeholderCount).fill(0);
    this.values = new Array<string | null>(placeholderCount).fill(null);
    this.showMessage = showMessage;
    // Euler selectors keep the params as their own message params; the others as extra params
    this.messageParams = kind === 'euler' && params != null ? params : new Map();
    this.extraParams = kind === 'leibniz12' || kind === 'leibniz34' ? params : null;
  }

  getText(): string {
    return this.text;
  }

  setPlaceholderValue(i: number, s: string | null): void {
    this.values[i] = s == null ? null : translateSymbols(s, maggie, symbols);
  }

  private report(which: number, params: MessageParams): Promise<void> {
    const merged = this.extraParams == null ? params : Message.mergeParams(this.extraParams, params);
    return this.showMessage(REPORTS[this.kind][which], merged);
  }

  /**
   * Replaces the selection [start, end) of the text by placeholder i (0-based), if it is an
   * occurrence of a term that may be replaced; otherwise shows why. Returns whether the text
   * changed.
   */
  async insertPlaceholder(i: number, start: number, end: number): Promise<boolean> {
    const s = SchematicLetter.placeholder(i);
    if (i < 0 || i >= this.placeholderCount) return false;
    const s1 = this.text;
    const params = Message.mergeParams(this.messageParams, null)!;
    Message.putParam(params, 'full text', escapeBackslashes(s1));
    const s2 = s1.substring(start, end);
    if (s2.length === 0) {
      await this.showMessage('dernot013', params);
      return false;
    }
    Message.putParam(params, 'selection', escapeBackslashes(s2));
    const range = [start, end];
    const s3 = translateSymbols(s1, symbols, maggie, range);
    const s4 = s3.substring(0, range[0]) + s + s3.substring(range[1]);
    Message.putParam(params, 'subbed text', '\\l' + s4 + '\\l');
    let e: Expression | null;
    try {
      e = parseFormula(translateSymbols(s2, symbols, maggie), true, false);
    } catch (err) {
      if (!(err instanceof FormulaParseException)) throw err;
      await this.report(0, params);
      return false;
    }
    if (!(e instanceof TermClass)) {
      await this.report(1, params);
      return false;
    }
    try {
      parseFormula(s4, true, true);
    } catch (err) {
      if (!(err instanceof FormulaParseException)) throw err;
      await this.report(2, params);
      return false;
    }
    let whole: Expression | null;
    try {
      whole = parseFormula(s3, true, true);
    } catch (err) {
      if (!(err instanceof FormulaParseException)) throw err;
      whole = null;
    }
    const node = new FormulaParseNode(whole);
    node.text = s3;
    const selected = node.findNodeContaining(range[0], range[1]).getExpression()!;
    if (selected.findMislinkedVariables() != null) {
      await this.report(3, params);
      return false;
    }
    if (this.selectionCounts[i] !== 0) {
      if (!e.isIdentical(this.selectedTerms[i])) {
        await this.report(4, Message.putParam(params, 'old term', '\\l' + String(this.selectedTerms[i]) + '\\l'));
        return false;
      }
    } else {
      this.setPlaceholderValue(i, e.toString());
      this.selectedTerms[i] = e as Term;
    }
    this.selectionCounts[i]++;
    this.undoStack.push({ placeholderIndex: i, position: start, replacedText: s2 });
    this.text = s1.substring(0, start) + s + s1.substring(end);
    return true;
  }

  /** Undoes the last replacement (Ctrl+Z); false (dernot012) if there is none. */
  undo(): boolean {
    const n = this.undoStack.length;
    if (n === 0) return false;
    const edit = this.undoStack.pop()!;
    const j = edit.placeholderIndex;
    const k = edit.position;
    if (--this.selectionCounts[j] === 0) {
      this.setPlaceholderValue(j, null);
      this.selectedTerms[j] = null;
    }
    this.text = this.text.substring(0, k) + edit.replacedText + this.text.substring(k + SchematicLetter.placeholder(j).length);
    return true;
  }
}
