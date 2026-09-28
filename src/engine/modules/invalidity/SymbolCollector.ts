/**
 * Port of SymbolCollector.java: the predicates (atomic formulas) and operations (operation
 * terms, names included) of an argument, by name and arity, in order of appearance; the
 * module's current interpretations take the place of the new ones they equal.
 */
import { AtomicFormula, type Expression, OperationTerm } from '../../formula/Expression';
import { OperationInterpretation, PredicateInterpretation, type SymbolInterpretation } from './SymbolInterpretation';

export class SymbolCollector {
  readonly predicates: SymbolInterpretation[] = [];
  readonly operations: SymbolInterpretation[] = [];

  collect(e: Expression | null): void {
    if (e instanceof AtomicFormula) {
      const p = new PredicateInterpretation(e.getSymbol(), e.getChildCount());
      if (!this.predicates.some((x) => x.equals(p))) this.predicates.push(p);
    } else if (e instanceof OperationTerm) {
      const o = new OperationInterpretation(e.getSymbol(), e.getChildCount());
      if (!this.operations.some((x) => x.equals(o))) this.operations.push(o);
    }
    const n = e == null ? 0 : e.getChildCount();
    for (let i = 0; i < n; i++) this.collect(e!.getChild(i));
  }

  /** mergeInterpretations: the module's interpretations replace the equal collected ones. */
  mergeInterpretations(symbols: readonly SymbolInterpretation[] | null): void {
    for (const s of symbols ?? []) {
      if (s instanceof PredicateInterpretation) {
        const k = this.predicates.findIndex((x) => x.equals(s));
        if (k !== -1) this.predicates[k] = s;
      } else if (s instanceof OperationInterpretation) {
        const k = this.operations.findIndex((x) => x.equals(s));
        if (k !== -1) this.operations[k] = s;
      }
    }
  }

  /** The predicates, then the operations. */
  getAllSymbols(): SymbolInterpretation[] {
    return [...this.predicates, ...this.operations];
  }
}
