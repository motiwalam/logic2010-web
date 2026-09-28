/**
 * Port of Justification.java, PremiseJustification.java, IndirectAssumptionJustification.java
 * and BiconditionalAssumptionJustification.java: the cached result of one step of a line's
 * justification (mostly a choice made in a dialog), saved in the work as "<type>:<data>" (the
 * `:` fields) and replayed by reapply without asking again.
 *
 * Types: 1 RuleApplication, 2 premise, 3 ASS ID (+: assume the negated Show formula, -: its
 * unnegation), 4 InterchangeJustification, 5 ASS BD (L/R; written but never read back:
 * Justification.decode has no branch for it).
 */
import type { DerivationLineChecker } from './DerivationLineChecker';

export abstract class Justification {
  label: string;

  constructor(label: string) {
    this.label = label;
  }

  abstract reapply(checker: DerivationLineChecker): Promise<boolean>;

  abstract encode(): string;

  abstract clone(): Justification;
}

/** PremiseJustification (type 2): premise premiseIndex (0-based) was chosen for PR. */
export class PremiseJustification extends Justification {
  static readonly TYPE = 2;
  premiseIndex: number;

  constructor(i: number) {
    super('PR' + (i + 1));
    this.premiseIndex = i;
  }

  clone(): PremiseJustification {
    return new PremiseJustification(this.premiseIndex);
  }

  async reapply(checker: DerivationLineChecker): Promise<boolean> {
    if (checker.ruleName !== this.label && checker.ruleName !== 'PR') return false;
    if ((checker.matchLine || checker.finalStep) && checker.argumentCount !== 0) return false;
    const premises = checker.line.box.module.premises!;
    if (this.premiseIndex >= premises.length) return false;
    checker.result = premises[this.premiseIndex];
    if (checker.matchLine && !checker.checkResultMatchesLine(true)) return false;
    checker.popStack(0);
    return true;
  }

  encode(): string {
    return '2:' + this.premiseIndex;
  }

  static decode(s: string): PremiseJustification | null {
    const i = s.indexOf(':');
    if (i === -1 || s.substring(0, i) !== '2') return null;
    const j = parseIntStrict(s.substring(i + 1));
    return j < 0 ? null : new PremiseJustification(j);
  }
}

/** IndirectAssumptionJustification (type 3): the choice between ~~A and A for ASS ID on Show ~A. */
export class IndirectAssumptionJustification extends Justification {
  static readonly TYPE = 3;
  negateShow: boolean;

  constructor(negateShow: boolean) {
    super('ASS ID');
    this.negateShow = negateShow;
  }

  clone(): IndirectAssumptionJustification {
    return new IndirectAssumptionJustification(this.negateShow);
  }

  async reapply(checker: DerivationLineChecker): Promise<boolean> {
    if (checker.ruleName !== this.label) return false;
    if ((checker.matchLine || checker.finalStep) && checker.argumentCount !== 0) return false;
    if (checker.result != null || checker.line.getIndexInBox() !== 1) return false;
    const e = checker.line.box.getFormula();
    if (e == null) return false;
    if (!this.negateShow && e.getSymbol() !== '~') return false;
    checker.line.box.assumptionType = 1;
    checker.result = this.negateShow ? e.negate() : e.getChild(0);
    if (checker.matchLine && !checker.checkResultMatchesLine(true)) return false;
    checker.popStack(0);
    return true;
  }

  encode(): string {
    return '3:' + (this.negateShow ? '+' : '-');
  }

  static decode(s: string): IndirectAssumptionJustification | null {
    const i = s.indexOf(':');
    if (i === -1 || s.substring(0, i) !== '3') return null;
    return new IndirectAssumptionJustification(s.substring(i + 1) !== '-');
  }
}

/** BiconditionalAssumptionJustification (type 5): the side assumed for ASS BD. */
export class BiconditionalAssumptionJustification extends Justification {
  static readonly TYPE = 5;
  rightSide: boolean;

  constructor(rightSide: boolean) {
    super('ASS BD');
    this.rightSide = rightSide;
  }

  clone(): BiconditionalAssumptionJustification {
    return new BiconditionalAssumptionJustification(this.rightSide);
  }

  async reapply(checker: DerivationLineChecker): Promise<boolean> {
    if (checker.ruleName !== this.label) return false;
    if ((checker.matchLine || checker.finalStep) && checker.argumentCount !== 0) return false;
    if (checker.result != null || checker.line.getIndexInBox() !== 1) return false;
    const e = checker.line.box.getFormula();
    if (e == null || e.getSymbol() !== '<->') return false;
    checker.line.box.assumptionType = 3;
    checker.result = e.getChild((checker.line.box.assumedSide = this.rightSide ? 1 : 0));
    if (checker.matchLine && !checker.checkResultMatchesLine(true)) return false;
    checker.popStack(0);
    return true;
  }

  encode(): string {
    return '5:' + (this.rightSide ? 'R' : 'L');
  }

  static decode(s: string): BiconditionalAssumptionJustification | null {
    const i = s.indexOf(':');
    if (i === -1 || s.substring(0, i) !== '5') return null;
    return new BiconditionalAssumptionJustification(s.substring(i + 1) === 'R');
  }
}

/** Integer.parseInt: throws NumberFormatException (an Error) if s is not a decimal int. */
export function parseIntStrict(s: string): number {
  if (!/^[+-]?\d+$/.test(s)) throw new Error('NumberFormatException: For input string: "' + s + '"');
  const n = Number(s);
  if (n > 2147483647 || n < -2147483648) throw new Error('NumberFormatException: For input string: "' + s + '"');
  return n;
}
