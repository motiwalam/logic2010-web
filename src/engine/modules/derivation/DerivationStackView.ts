/**
 * Port of the computation of DerivationStackView.java (the Stack button): the formulas on the
 * stack of the justification being edited, after the steps before the cursor. The steps are
 * previewed with a DerivationLineChecker in preview mode (as Check runs them, in serial mode,
 * recording the first error instead of showing it); what checking changes is restored, so
 * nothing in the derivation changes.
 */
import type { Expression } from '../../formula/Expression';
import { ErrorRef } from '../../program/Message';
import { translateSymbols } from '../../program/symbols';
import { javaTrim } from '../../util/java';
import { isJavaWhitespace } from './chars';
import type { DerivationLine } from './DerivationLine';
import { DerivationLineChecker } from './DerivationLineChecker';
import { formatDerivationMessage, getDerivationMessage } from './DerivationMessage';

/** Errors that only mean the text ends early; not shown at the end of the text. */
const IGNORED_AT_END = ['dererr001', 'dererr002', 'dererr018'];

export class StackSnapshot {
  /** The stack, bottom first. */
  formulas: Expression[] = [];
  /** Where each formula came from: "line 2", "by MP", or "". */
  origins: string[] = [];
  /** Why the steps do not apply, or null. */
  error: string | null = null;
  /** The box rule that closed the box, or null. */
  closed: string | null = null;

  signature(): string {
    return this.formulas.map(String).join(',') + '\u0000' + this.origins.join(',') + '\u0000' + this.error + '\u0000' + this.closed;
  }
}

/** What the view shows: a note, or the line, the text before the cursor and the stack there. */
export interface StackViewData {
  line: DerivationLine | null;
  /** "Line n, after: <text>" or the note when the cursor is not in a justification. */
  heading: string;
  snapshot: StackSnapshot | null;
  /** Rows, top first: the formula (display symbols), the origin (with "top, " on the first). */
  rows: { formula: string; origin: string; top: boolean }[];
  /** "(empty)" or "X closes the box; the stack is empty.", or null. */
  emptyNote: string | null;
}

/**
 * The justification text whose steps are complete at the cursor: the text before it, without
 * a word the cursor is inside, a comment, or a formula in brackets not yet closed (the rule
 * name before it is left out too).
 */
export function textBeforeCursor(s: string, i: number): string {
  i = Math.max(0, Math.min(i, s.length));
  if (i > 0 && i < s.length && !isJavaWhitespace(s.charAt(i)) && !isJavaWhitespace(s.charAt(i - 1))) {
    while (i > 0 && !isJavaWhitespace(s.charAt(i - 1))) i--;
  }
  let s1 = s.substring(0, i);
  const j = s1.indexOf('#');
  if (j !== -1) s1 = s1.substring(0, j);
  let depth = 0;
  let open = -1;
  for (let m = 0; m < s1.length; m++) {
    const c = s1.charAt(m);
    if (c === '[' && depth++ === 0) open = m;
    else if (c === ']' && depth > 0) depth--;
  }
  if (depth > 0) {
    let n = open;
    while (n > 0 && isJavaWhitespace(s1.charAt(n - 1))) n--;
    while (n > 0 && DerivationLineChecker.isNameChar(s1.charAt(n - 1))) n--;
    s1 = s1.substring(0, n);
  }
  return s1;
}

export function isBoxRule(s: string): boolean {
  return s === 'CD' || s === 'ID' || s === 'DD' || s === 'UD' || s === 'BD';
}

/** Work done with the checker at the cursor (the rules view), before the state is restored. */
export type StackVisitor = (checker: DerivationLineChecker, snapshot: StackSnapshot) => void | Promise<void>;

/**
 * Runs the steps of text on the line's justification, as the Check button would but with no
 * dialogs (serial mode) and no messages, and restores what checking changes. If the steps
 * apply without error and leave the box open, visitor looks at the checker there first.
 */
export async function computeStack(line: DerivationLine, text: string, visitor: StackVisitor | null = null): Promise<StackSnapshot> {
  const module = line.box.module;
  const box = line.box;
  const serialMode = module.serialMode;
  const complete = module.complete;
  const proofMissing = module.proofMissing;
  const aborted = module.aborted();
  const assumptionType = box.assumptionType;
  const assumedSide = box.assumedSide;
  const strategyConsistent = box.strategyConsistent;
  const readyToCancel = line.readyToCancel;
  const justifications = line.justifications == null ? null : line.justifications.slice();
  const snapshot = new StackSnapshot();
  const origins = new Map<Expression, string>();
  module.serialMode = true;
  try {
    const checker = new DerivationLineChecker(line, false, text);
    for (;;) {
      const ok = checker.readNextStep();
      const name = checker.getRuleName();
      if (!ok || name == null) {
        const error = checker.previewError;
        if (error != null && !IGNORED_AT_END.includes(error.id.toLowerCase())) snapshot.error = describe(error, checker);
        break;
      }
      if (name.startsWith('SHOW ')) {
        snapshot.error = name + ' starts a new Show line.';
        break;
      }
      const boxRule = isBoxRule(name);
      if (!(await checker.checkStep(false, boxRule))) {
        snapshot.error = name + ': ' + describe(checker.previewError, checker);
        break;
      }
      if (boxRule) {
        snapshot.closed = name;
        break;
      }
      if (checker.result != null && !DerivationLineChecker.isStackOperation(name)) origins.set(checker.result, 'by ' + name);
    }
    for (let k = 0; k < checker.getStackSize(); k++) {
      const e = checker.getStackFormula(k)!;
      const node = checker.getCitedNode(k);
      snapshot.formulas.push(e);
      const origin = node != null ? 'line ' + node.getLineNumber() : origins.get(e);
      snapshot.origins.push(origin == null ? '' : origin);
    }
    if (visitor != null && snapshot.error == null && snapshot.closed == null) await visitor(checker, snapshot);
  } catch (e) {
    snapshot.error = 'The stack could not be computed here (' + javaExceptionName(e) + ').';
  } finally {
    module.serialMode = serialMode;
    module.complete = complete;
    module.proofMissing = proofMissing;
    module.abort(aborted);
    box.assumptionType = assumptionType;
    box.assumedSide = assumedSide;
    box.strategyConsistent = strategyConsistent;
    line.readyToCancel = readyToCancel;
    line.justifications = justifications;
  }
  return snapshot;
}

function javaExceptionName(e: unknown): string {
  if (e instanceof TypeError) return 'java.lang.NullPointerException';
  return e instanceof Error ? e.message : String(e);
}

/** The error in words (dererr064: a dialog would be needed). */
export function describe(error: ErrorRef | null, checker: DerivationLineChecker): string {
  if (error == null) return 'this step does not apply.';
  if (error.id.toLowerCase() === 'dererr064') {
    return 'this step needs a choice the program would ask for in a dialog; a formula in brackets after the rule name makes it.';
  }
  const message = getDerivationMessage(error.id);
  const s = message.title != null ? message.title : message.text;
  return translateSymbols(formatDerivationMessage(s, error.params, checker).split('\\l').join(''));
}

/**
 * The stack view at the cursor: line is the line whose justification has the focus (the
 * module's lastFocus), caret the cursor position in it (the end if the formula has the focus).
 */
export async function stackViewData(line: DerivationLine | null, text: string | null = null, caret: number | null = null): Promise<StackViewData> {
  if (line == null || line.annotationEditor == null) {
    return { line: null, heading: 'Put the cursor in a justification to see the stack there.', snapshot: null, rows: [], emptyNote: null };
  }
  const s = text ?? line.annotationEditor.getText();
  const before = textBeforeCursor(s, caret ?? s.length);
  const snapshot = await computeStack(line, before);
  const shown = javaTrim(before) === '' ? '(no steps yet)' : javaTrim(before);
  const rows: StackViewData['rows'] = [];
  for (let i = snapshot.formulas.length - 1; i >= 0; i--) {
    const top = i === snapshot.formulas.length - 1;
    rows.push({ formula: translateSymbols(snapshot.formulas[i].toString()), origin: (top ? 'top, ' : '') + snapshot.origins[i], top });
  }
  let emptyNote: string | null = null;
  if (snapshot.formulas.length === 0) emptyNote = snapshot.closed != null ? snapshot.closed + ' closes the box; the stack is empty.' : '(empty)';
  return { line, heading: 'Line ' + line.getLineNumber() + ', after: ' + shown, snapshot, rows, emptyNote };
}

/** The line and caret the views follow: the module's last focused editor. */
export function cursorOf(module: { lastFocus: { line: DerivationLine; getCaretPosition(): number; isAnnotation(): boolean } | null }): { line: DerivationLine; caret: number } | null {
  const editor = module.lastFocus;
  if (editor == null || editor.line.annotationEditor == null) return null;
  const s = editor.line.annotationEditor.getText();
  return { line: editor.line, caret: editor.isAnnotation() ? editor.getCaretPosition() : s.length };
}
