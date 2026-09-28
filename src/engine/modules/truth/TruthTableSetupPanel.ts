/**
 * Port of TruthTableSetupPanel.java and TruthSetupButtons.java (model part): the optional
 * setup stage (the doSetUp option) in which the student first builds the table's skeleton.
 *
 * Stage 0: the student types the sentence letters, separated by periods, and the number of
 * rows (checkLettersAndRows: truerr015..019). Stage 1: the student marks each letter in each
 * row T or F (checkAssignments: truerr011, truerr012). Then the table is shown.
 *
 * The setup work is saved under `&` as "P.Q.R:TTF?..." (the letters in the student's order,
 * then one character per chooser, row by row), and as "P.Q.R" once the setup is done.
 */
import { ErrorRef, Message } from '../../program/Message';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { parseJavaInt } from '../../util/java';
import type { TruthTableEvaluator } from '../../formula/TruthTableEvaluator';
import type { TruthProblemPanel } from './TruthProblemPanel';

export class TruthTableSetupPanel {
  readonly evaluator: TruthTableEvaluator | null;
  readonly letterCount: number;
  readonly rowCount: number;
  /** The letters and row count were accepted (stage 1 or later). */
  lettersEntered = false;
  /** choosers[row][letter]: -1 unset, 0 T, 1 F. */
  readonly choosers: number[][];
  /** Which part the desktop panel shows: the letter entry fields or the T/F grid. */
  view: 'letters' | 'grid' = 'grid';
  /** The "Sentence Letters" and "Number of Rows" fields (the letters in display symbols). */
  lettersText = '';
  rowCountText = '';

  constructor(readonly workPanel: TruthProblemPanel) {
    this.evaluator = workPanel.evaluator;
    this.letterCount = this.evaluator == null ? 0 : this.evaluator.sentenceLetters.length;
    this.rowCount = this.letterCount === 0 ? 0 : 1 << this.letterCount;
    this.choosers = [];
    for (let i = 0; i < this.rowCount; i++) this.choosers.push(new Array<number>(this.letterCount).fill(-1));
  }

  /** The expected chooser value (the choosers' user data): 0 (T) or 1 (F). */
  expectedValue(row: number, letter: number): number {
    return (row >> (this.letterCount - letter - 1)) & 1;
  }

  /** The header labels of the chooser grid: the letters in their current order. */
  getHeaderLabels(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.letterCount; i++) out.push(translateSymbols(this.evaluator!.sentenceLetters[i].toString(), maggie, symbols));
    return out;
  }

  /** Whether a chooser is shown in the error colors (highlightCell). */
  choiceShowsError(row: number, letter: number): boolean {
    if (this.workPanel.module.setupErrorsDisabled) return false;
    const i = this.choosers[row][letter];
    return i >= 0 && i !== this.expectedValue(row, letter);
  }

  showAssignmentGrid(): void {
    this.workPanel.setupStage = 1;
    this.workPanel.table.buildTable(null);
    this.view = 'grid';
  }

  loadSetup(s: string | null): void {
    if (!(this.lettersEntered = s != null)) {
      this.workPanel.setupDone = false;
      this.workPanel.setupStage = 0;
      this.lettersText = '';
      this.rowCountText = '';
      this.view = 'letters';
    } else {
      const i = s!.indexOf(':');
      let letters: string;
      if ((this.workPanel.setupDone = i === -1)) {
        letters = s!;
        s = null;
      } else {
        letters = s!.substring(0, i);
        s = s!.substring(i + 1);
      }
      this.evaluator!.parseLetterOrder(letters);
      if (this.workPanel.setupDone) return;
    }
    let l = 0;
    const n = s == null ? 0 : s.length;
    for (let j = 0; j < this.rowCount; j++) {
      for (let k = 0; k < this.letterCount; k++) this.choosers[j][k] = l < n ? 'TF'.indexOf(s!.charAt(l++)) : -1;
    }
  }

  getSetupCode(): string | null {
    if (!this.lettersEntered) return null;
    let s = '';
    for (let i = 0; i < this.letterCount; i++) s += (i === 0 ? '' : '.') + this.evaluator!.sentenceLetters[i].toString();
    if (this.workPanel.setupDone) return s;
    s += ':';
    for (let l = 0; l < this.rowCount; l++) {
      for (let j = 0; j < this.letterCount; j++) s += '?TF'.charAt(this.choosers[l][j] + 1);
    }
    return s;
  }

  hasSetupWork(): boolean {
    return this.getSetupCode() != null;
  }

  isAssignmentCorrect(): boolean {
    return this.checkAssignments().id == null;
  }

  checkAssignments(): ErrorRef {
    if (this.workPanel.setupDone) return new ErrorRef(null as unknown as string, Message.params('summary', 'Correct'));
    if (this.workPanel.module.completeSetup && !this.lettersEntered) return new ErrorRef('truerr020', Message.params('summary', 'Incomplete'));
    let missing = false;
    let wrong = false;
    for (let i = 0; i < this.rowCount; i++) {
      for (let j = 0; j < this.letterCount; j++) {
        const k = this.choosers[i][j];
        if (k === -1) missing = true;
        else if (k !== this.expectedValue(i, j)) wrong = true;
      }
    }
    if (wrong) return new ErrorRef('truerr011', Message.params('summary', 'Incorrect'));
    return missing
      ? new ErrorRef('truerr012', Message.params('summary', 'Incomplete'))
      : new ErrorRef(null as unknown as string, Message.params('summary', 'Correct'));
  }

  /** checkLettersAndRows: checks the typed letters (and sets their order) and the row count. */
  checkLettersAndRows(): ErrorRef {
    if (this.lettersEntered) return new ErrorRef(null as unknown as string, Message.params('summary', 'Correct'));
    const s = translateSymbols(this.lettersText, symbols, maggie);
    const e = this.evaluator!.parseLetterOrder(s);
    if (e.id != null) return e.putParam('summary', 'Incorrect');
    const n = parseJavaInt(this.rowCountText);
    return n != null && n === this.rowCount ? e.putParam('summary', 'Correct') : new ErrorRef('truerr019', Message.params('summary', 'Incorrect'));
  }

  /** A chooser's value changed (ChoiceButton.setSelectedIndex; the desktop beeps at a wrong one). */
  setChoice(row: number, letter: number, index: number): void {
    this.choosers[row][letter] = index;
  }

  /**
   * TruthSetupButtons.actionPerformed (OK): stage 0 checks the letters and rows and shows the
   * grid; stage 1 checks the grid and shows the table. Returns the error (id null when fine).
   */
  pressOk(): ErrorRef | null {
    const p = this.workPanel;
    if (p.setupStage === 0) {
      const e = this.checkLettersAndRows();
      if ((this.lettersEntered = e.id == null)) this.showAssignmentGrid();
      return e;
    }
    if (p.setupStage === 1) {
      const e = this.checkAssignments();
      if ((p.setupDone = e.id == null)) p.showTable();
      return e;
    }
    return null;
  }
}
