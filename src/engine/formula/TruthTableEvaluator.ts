/**
 * Port of TruthTableEvaluator.java: the truth table of a formula (or of an argument: a row is
 * true when the conclusion is true or some premise false). The "sentence letters" are the
 * maximal non-connective subformulas, told apart by alpha-equivalence; row j gives letter k
 * the value of bit k of j.
 */
import type { ArgumentParser } from '../rules/ArgumentParser';
import { BinderMap } from './BinderMap';
import { javaTrim } from '../util/java';
import { ConnectiveFormula, Expression, Formula } from './Expression';
import { ErrorRef, params } from './messages';
import { FormulaParseException, parseFormula } from './parseFormula';

export class TruthTableEvaluator {
  formula: Expression | null;
  argument: ArgumentParser | null;
  sentenceLetters: Expression[] = [];
  rowResults: boolean[] = [];

  constructor(source: Expression | ArgumentParser) {
    if (source instanceof Expression) {
      this.argument = null;
      this.formula = source;
      this.collectSentenceLetters(this.formula);
    } else {
      this.formula = null;
      this.argument = source;
      for (const p of source.premises) this.collectSentenceLetters(p);
      this.collectSentenceLetters(source.conclusion);
    }
    this.computeRows();
  }

  collectSentenceLetters(e: Expression | null): void {
    if (e instanceof ConnectiveFormula) {
      for (let j = 0; j < e.getChildCount(); j++) this.collectSentenceLetters(e.getChild(j));
    } else if (e != null && this.indexOfLetter(e) === -1) {
      this.sentenceLetters.push(e);
    }
  }

  /** Sets the letter order from "P.Q.R" (truerr015..018 on errors; an ErrorRef with a null id when fine). */
  parseLetterOrder(s: string | null): ErrorRef {
    const items: (Expression | ErrorRef)[] = [];
    while (s != null) {
      const i = s.indexOf('.');
      let part: string;
      if (i === -1) {
        part = s;
        s = null;
      } else {
        part = s.substring(0, i);
        s = s.substring(i + 1);
      }
      part = javaTrim(part);
      if (part.length !== 0) {
        let e: Expression | null;
        try {
          e = parseFormula(part);
        } catch (err) {
          if (!(err instanceof FormulaParseException)) throw err;
          e = null;
        }
        items.push(e == null ? new ErrorRef('truerr016', params('unparsed', part)) : e);
      }
    }
    return this.setLetterOrder(items);
  }

  setLetterOrder(items: readonly (Expression | ErrorRef)[]): ErrorRef {
    const n = items.length;
    const order: number[] = [];
    for (let i = 0; i < n; i++) {
      const item = items[i];
      if (item instanceof ErrorRef) return item;
      order[i] = this.indexOfLetter(item);
      if (order[i] === -1) return new ErrorRef('truerr017', params('sentence', item + ''));
      for (let k = 0; k < i; k++) {
        if (order[i] === order[k]) return new ErrorRef('truerr018', params('sentence', item + ''));
      }
    }
    if (this.sentenceLetters.length !== n) return new ErrorRef('truerr015');
    this.sentenceLetters = order.map((k) => this.sentenceLetters[k]);
    this.computeRows();
    // Java: new ErrorRef(null), "no error"
    return new ErrorRef(null as unknown as string);
  }

  computeRows(): void {
    const n = this.sentenceLetters.length;
    this.rowResults = new Array<boolean>(n === 0 ? 0 : 2 ** n).fill(false);
    if (this.formula != null) {
      this.evaluateAllRows(this.formula, this.rowResults);
    } else if (this.argument != null) {
      this.evaluateAllRows(this.argument.conclusion, this.rowResults);
      const premise = new Array<boolean>(this.rowResults.length).fill(false);
      for (const p of this.argument.premises) {
        this.evaluateAllRows(p, premise);
        for (let l = 0; l < this.rowResults.length; l++) if (!premise[l]) this.rowResults[l] = true;
      }
    }
  }

  evaluateAllRows(e: Expression | null, results: boolean[]): void {
    for (let j = 0; j < results.length; j++) results[j] = this.evaluate(e, this.rowAssignment(j));
  }

  evaluate(e: Expression | null, row: readonly boolean[]): boolean {
    if (e instanceof ConnectiveFormula) {
      const s = e.getSymbol();
      if (s === '~') return !this.evaluate(e.getChild(0), row);
      const a = this.evaluate(e.getChild(0), row);
      const b = this.evaluate(e.getChild(1), row);
      if (s === '&') return a && b;
      if (s === '|') return a || b;
      if (s === '->') return !a || b;
      return s === '<->' ? a === b : false;
    }
    const i = this.indexOfLetter(e);
    return i === -1 ? false : row[i];
  }

  indexOfLetter(e: Expression | null): number {
    if (e == null) return -1;
    for (let j = 0; j < this.sentenceLetters.length; j++) {
      if (e.isAlphaEquivalent(this.sentenceLetters[j], new BinderMap())) return j;
    }
    return -1;
  }

  rowAssignment(row: number): boolean[] {
    const values: boolean[] = [];
    for (let k = 0; k < this.sentenceLetters.length; k++) {
      values.push(row % 2 !== 0);
      row = Math.floor(row / 2);
    }
    return values;
  }

  isAllTrue(): boolean {
    return this.rowResults.every((r) => r);
  }

  /** Whether two formulas are truth-functionally equivalent (false unless both are formulas). */
  static areEquivalent(a: Expression | null, b: Expression | null): boolean {
    if (!(a instanceof Formula) || !(b instanceof Formula)) return false;
    const c = new ConnectiveFormula('<->');
    c.addChild(a);
    c.addChild(b);
    return new TruthTableEvaluator(c).isAllTrue();
  }
}
