/**
 * Port of TruthProblemPanel.java and TautologyQuestionPanel.java (model part): the loaded
 * problem (statement, argument, evaluator), the yes/no answer, the table and the setup stage,
 * and the work record.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { TruthTableEvaluator } from '../../formula/TruthTableEvaluator';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { ArgumentParser } from '../../rules/ArgumentParser';
import { equalsIgnoreCase } from '../../util/java';
import type { LPTruthAnalysis } from './LPTruthAnalysis';
import { rowAssignmentString, TruthTableGrid } from './TruthTableGrid';
import { TruthTableSetupPanel } from './TruthTableSetupPanel';

export class TruthProblemPanel {
  readonly table: TruthTableGrid;
  setupPanel: TruthTableSetupPanel | null = null;
  problemName: string | null = null;
  statement: string | null = null;
  evaluator: TruthTableEvaluator | null = null;
  /** The answer to the question: -1 none, 0 yes, 1 no. */
  answer = -1;
  premiseCount = 0;
  letterCount = 0;
  argument: ArgumentParser | null = null;
  setupDone = false;
  /** The question above the table. */
  question = 'Is this formula a tautology?';
  /** Whether the yes/no chooser is shown (not for "taut" problems). */
  answerVisible = true;
  /** Whether the table is shown (else the setup stage). */
  showingTable = true;
  /** TruthSetupButtons.stage (0: letters and rows, 1: assignments); kept across problems, as on the desktop. */
  setupStage = 1;
  loading = false;

  constructor(readonly module: LPTruthAnalysis) {
    this.table = new TruthTableGrid(this);
    this.clearProblem();
  }

  /** The prompt of the setup stage. */
  getSetupPrompt(): string {
    return this.setupStage === 0 ? 'Please separate sentence letters with a period.' : 'Please fill in the proper truth values.';
  }

  /** The statement as the title bar shows it (in the notation's symbols). */
  getDisplayStatement(): string {
    return this.statement == null ? '' : translateSymbols(this.statement, maggie, symbols);
  }

  clearProblem(): void {
    this.problemName = null;
    this.statement = null;
    this.module.lastUserProblem = null;
    this.question = 'Is this formula a tautology?';
    this.answerVisible = true;
    this.setupPanel = null;
    this.clearWork();
  }

  /** clearWork (Delete Work): clears the answer, the row check, the setup and the table. */
  clearWork(): void {
    this.module.status = '';
    this.answer = -1;
    this.table.counterexampleRow = -1;
    this.showingTable = !this.module.completeSetup;
    this.setupDone = false;
    if (this.setupPanel != null) this.setupPanel.loadSetup(null);
    this.table.buildTable(null);
  }

  loadProblem(t: TaggedRecord): void {
    this.clearProblem();
    this.problemName = t.getName();
    this.statement = t.valueAt(t.indexOfAnyTag('='));
    this.argument = new ArgumentParser(this.statement);
    this.evaluator = new TruthTableEvaluator(this.argument);
    this.premiseCount = this.argument.premises.length;
    this.letterCount = this.evaluator.sentenceLetters.length;
    this.module.assumeTautology = assumeTautology(t);
    if (this.module.assumeTautology) {
      this.question = 'Please complete a truth table for this formula.';
      this.answerVisible = false;
    } else if (!this.argument.conclusionOnly) {
      this.question = 'Is this argument tautologically valid?';
    }
    const codes = new Map<string, string[]>();
    for (const i of t.indexesOfTag('@')) {
      const s = t.values[i];
      let k = s.indexOf(':');
      if (k === -1) continue;
      const key = s.substring(0, k);
      let rest = s.substring(k + 1);
      const cells: string[] = [];
      for (let l = 0; l <= this.premiseCount; l++) {
        k = rest.indexOf('.');
        if (k === -1) {
          cells[l] = rest;
          rest = '';
        } else {
          cells[l] = rest.substring(0, k);
          rest = rest.substring(k + 1);
        }
      }
      codes.set(key.toUpperCase(), cells);
    }
    if (!this.module.assumeTautology) {
      this.answer = t.intValueAt(t.indexOfTag('*')) ?? -1;
      this.table.counterexampleRow = t.intValueAt(t.indexOfTag('#')) ?? -1;
    }
    const setup = t.valueAt(t.indexOfTag('&'));
    if (setup != null || this.module.completeSetup) {
      this.setupPanel = new TruthTableSetupPanel(this);
      this.setupPanel.loadSetup(setup);
      if (this.setupDone) this.showTable();
    }
    this.loading = true;
    this.table.buildTable(codes);
    this.loading = false;
  }

  showTable(): void {
    this.showingTable = true;
  }

  getWorkRecord(): string {
    let s = TaggedRecord.formatField(this.problemName, '$') + TaggedRecord.formatField(this.statement, '=');
    const codes = this.table.getCellCodes();
    for (let i = 0; i < this.table.rowCount; i++) {
      if (!this.table.rowHasWork(i)) continue;
      let row = rowAssignmentString(i, this.letterCount)!;
      const cells = codes.get(row);
      const n = cells == null ? 0 : cells.length;
      if (n === 0) continue;
      for (let k = 0; k < n; k++) row += (k === 0 ? ':' : '.') + cells![k];
      s += TaggedRecord.formatField(row, '@');
    }
    if (this.table.counterexampleRow !== -1) s += this.table.counterexampleRow + '`#';
    if (this.module.assumeTautology) s += 'taut`%';
    else if (this.answer !== -1) s += this.answer + '`*';
    return s + TaggedRecord.formatField(this.setupPanel == null ? null : this.setupPanel.getSetupCode(), '&');
  }

  /** The answer chooser (TautologyQuestionPanel.choiceChanged). */
  setAnswer(i: number): void {
    this.answer = i;
  }
}

/** LPTruthAnalysis.assumeTautology: the record's options include "taut" (any case). */
export function assumeTautology(t: TaggedRecord): boolean {
  for (const i of t.indexesOfTag('%')) {
    const s = t.valueAt(i);
    if (equalsIgnoreCase(s, 'taut')) return true;
  }
  return false;
}
