/**
 * Ports of the matchTree listeners: MatchCounter.java, HintCollector.java, ErrorMarker.java,
 * and SymbolizationConnectivePanel.showError (which puts the error buttons on the nodes).
 */
import { ExpressionPath } from '../../formula/ExpressionPath';
import { SymbolizationError, SymbolizationHint } from './SymbolizationError';
import type { NodeMatchListener, SymbolizationNode } from './SymbolizationNode';
import { translateExpressionText } from './SymbolizationNode';

export class MatchCounter implements NodeMatchListener {
  count = 0;

  reset(): void {
    this.count = 0;
  }

  getCount(): number {
    return this.count;
  }

  nodeMatched(): void {
    this.count++;
  }

  nodeMismatched(): void {}
}

/** Collects the hint for the target node, and an error button for each mismatch. */
export class HintCollector implements NodeMatchListener {
  errors: SymbolizationError[] = [];
  hint: SymbolizationHint | null = null;

  constructor(public target: SymbolizationNode) {}

  getErrors(): SymbolizationError[] {
    return this.errors;
  }

  getHint(): SymbolizationHint | null {
    return this.hint;
  }

  nodeMatched(node: SymbolizationNode, answer: SymbolizationNode, v: string[], v1: string[]): void {
    if (this.hint == null && node === this.target) this.hint = new SymbolizationHint(node, answer, v, v1);
  }

  nodeMismatched(node: SymbolizationNode, answer: SymbolizationNode, v: string[], v1: string[]): void {
    if (this.hint == null && node === this.target) this.hint = new SymbolizationHint(node, answer, v, v1);
    this.errors.push(new SymbolizationError(node, answer, v, v1));
  }
}

/**
 * Marks each mismatch with an error button, and notices "Quantifier Unrestricted": the
 * student chose the right quantifier but not the conditional (universal) or conjunction
 * (existential) under it.
 */
export class ErrorMarker implements NodeMatchListener {
  quantifierUnrestricted = false;

  nodeMatched(): void {}

  nodeMismatched(node: SymbolizationNode, answer: SymbolizationNode, v: string[], v1: string[]): void {
    if (node.getConnectivePanel() != null) showError(node, answer, v, v1);
    const p = node.getParentNode();
    const q = answer.getParentNode();
    if (
      p != null &&
      q != null &&
      p.connective === q.connective &&
      answer.connective !== node.connective &&
      ((q.connective === 6 && answer.connective === 2) || (q.connective === 7 && answer.connective === 3))
    ) {
      this.quantifierUnrestricted = true;
    }
  }
}

/**
 * SymbolizationConnectivePanel.showError: an error button on the node (unless error
 * messages are disabled), and when the answer is an atomic expression whose variables the
 * student's binders capture, error buttons on those binders too. Counts an error.
 */
export function showError(node: SymbolizationNode, answer: SymbolizationNode, v: string[], v1: string[]): void {
  const host = node.host!;
  const panel = node.getConnectivePanel()!;
  if (!host.errorMessagesDisabled) {
    panel.addButton(new SymbolizationError(node, answer, v, v1), true);
    if (answer.connective === 11) {
      const path = new ExpressionPath();
      if (translateExpressionText(answer.getLabel(), v1, v, path) == null) {
        for (let i = 0; i < path.depth; i++) {
          let n: SymbolizationNode | null = node;
          let a: SymbolizationNode | null = answer;
          let j = v.length;
          const k = path.indexes[i];
          while (j > k && (n = n!.getParentNode()) != null) {
            a = a!.getParentNode();
            if (n.isBinder()) j--;
          }
          if (n != null) {
            const binderPanel = n.getConnectivePanel()!;
            if (binderPanel.errorButton == null) {
              binderPanel.addButton(new SymbolizationError(n, a!, v.slice(0, j), v1.slice(0, j)), true);
            }
          }
        }
      }
    }
  }
  host.errorCount++;
}
