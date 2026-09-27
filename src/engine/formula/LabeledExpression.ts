/**
 * Port of LabeledExpression.java and PremiseExpression.java: an expression with a label such
 * as "Premise 2" (the derivations' "Line n" variant, LineFormula, belongs to the derivation
 * module).
 */
import type { Expression } from './Expression';

export class LabeledExpression {
  label: string;
  expression: Expression | null;

  constructor(label: string, expression: Expression | null = null) {
    this.label = label;
    this.expression = expression;
  }
}

/** PremiseExpression: premise i (1-based) of a problem's premises. */
export class PremiseExpression extends LabeledExpression {
  premiseIndex: number;

  constructor(premises: readonly (Expression | null)[] | null, i: number) {
    super('Premise ' + i);
    if (premises == null || i < 1 || i > premises.length) throw new Error('no premise ' + i);
    this.premiseIndex = i - 1;
    this.expression = premises[i - 1];
  }
}
