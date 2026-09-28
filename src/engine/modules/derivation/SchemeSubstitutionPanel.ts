/**
 * Port of SchemeSubstitutionPanel.java (as data): the table of a scheme's letters and their
 * values, with a field for each letter still open, and readInstantiation, which reads the
 * table back (errors: dererr059 parse error, dererr072 undeclared placeholder, or the
 * instantiation's own).
 */
import { FormulaParseException, parseFormula } from '../../formula/parseFormula';
import { SchemeInstantiation } from '../../formula/SchemeInstantiation';
import { IntervalSet } from '../../program/IntervalSet';
import { Message, type MessageParams } from '../../program/Message';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { DialogField, type SubstitutionRow } from './QueryDialog';

export class SchemeSubstitutionPanel {
  patternLabels: string[] = [];
  replacementFields: DialogField[] = [];
  rows: SubstitutionRow[] = [];
  errorId: string | null = null;
  errorParams: MessageParams | null = null;
  assignedCount: number;
  pendingCount: number;

  /** highlight: the open letters are highlighted (one layer each), as in the rule display. */
  constructor(inst: SchemeInstantiation, highlight = false) {
    this.assignedCount = inst.size;
    this.pendingCount = inst.pendingLetters.length;
    let j = 0;
    for (const letter of inst.keys()) {
      const r = inst.getReplacement(letter)!;
      this.patternLabels[j] = translateSymbols(r.pattern.toString(), maggie, symbols);
      const field = new DialogField(translateSymbols(r.replacement.toString(), maggie, symbols), false, 'Substitution for ' + this.patternLabels[j]);
      this.replacementFields[j] = field;
      this.rows.push({ label: this.patternLabels[j], labelHighlight: null, field });
      j++;
    }
    for (let l = this.assignedCount; l < this.assignedCount + this.pendingCount; l++) {
      const letter = inst.pendingLetters[l - this.assignedCount];
      let highlightSet: IntervalSet | null = null;
      let label: string;
      if (highlight) {
        const bounds = [0, letter.getLetter().length];
        label = translateSymbols(letter.toString(), maggie, symbols, bounds);
        highlightSet = IntervalSet.range(bounds[0], bounds[1] - bounds[0]);
      } else {
        label = translateSymbols(letter.toString(), maggie, symbols);
      }
      this.patternLabels[l] = label;
      const field = new DialogField('', true, 'Substitution for ' + letter.toString());
      this.replacementFields[l] = field;
      this.rows.push({ label, labelHighlight: highlightSet, field });
    }
  }

  /** The instantiation the table gives, or null (errorId / errorParams say why). */
  readInstantiation(): SchemeInstantiation | null {
    const inst = new SchemeInstantiation();
    let s: string | null = null;
    for (let i = 0; i < this.patternLabels.length; i++) {
      let pattern;
      let replacement;
      try {
        s = this.patternLabels[i];
        pattern = parseFormula(translateSymbols(s, symbols, maggie), true, true);
        s = this.replacementFields[i].getText();
        replacement = parseFormula(translateSymbols(s, symbols, maggie), true, true);
      } catch (e) {
        if (!(e instanceof FormulaParseException)) throw e;
        this.errorId = 'dererr059';
        this.errorParams = Message.params('parser error', s);
        return null;
      }
      if (replacement == null) {
        inst.addPendingLetter(pattern!);
      } else {
        if (replacement.hasUndeclaredPlaceholder(pattern!)) {
          this.errorId = 'dererr072';
          this.errorParams = Message.params('pattern', '\\l' + String(pattern) + '\\l', 'replacement', '\\l' + String(replacement) + '\\l');
          return null;
        }
        if (!inst.addReplacement(pattern!, replacement)) {
          this.errorId = inst.errorId;
          this.errorParams = inst.errorParams;
          return null;
        }
      }
    }
    return inst;
  }

  getPendingFields(): DialogField[] | null {
    if (this.pendingCount === 0) return null;
    return this.replacementFields.slice(this.assignedCount, this.assignedCount + this.pendingCount);
  }
}
