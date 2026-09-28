/**
 * The Inference Rules list (DerivationDialogs.showInferenceRules), as data: the user's rules
 * (under the dertxt001 heading), the rules and the theorems, each with its headings, its form,
 * and whether it is ticked: for a problem, available in this derivation (enabled, some form
 * proven); without a problem (the Rules button), usable with Interchange of Equivalents (has a
 * converse).
 */
import { expandEscapes } from '../../program/symbols';
import { ruleTable } from '../../rules/RuleTable';
import type { RuleTable } from '../../rules/RuleTable';
import { getDerivationMessage } from './DerivationMessage';
import { intervalElements } from './DerivationProblemSet';
import type { DerivationWorkspace } from './DerivationWorkspace';
import type { LPDerivation } from './LPDerivation';


export type InferenceRuleItem =
  /** A heading line (expandEscapes applied). */
  | { type: 'heading'; text: string }
  /** A rule or theorem: its name (T<n> for a theorem), its form (maggie symbols), whether ticked. */
  | { type: 'rule'; name: string; form: string; ticked: boolean; theorem: boolean };

export interface InferenceRulesList {
  title: string;
  items: InferenceRuleItem[];
  /** What the tick means. */
  legend: string;
}

/** module: the derivation (the list of its available rules), or null (all rules). */
export function inferenceRules(workspace: DerivationWorkspace, module: LPDerivation | null): InferenceRulesList {
  const items: InferenceRuleItem[] = [];
  const table = ruleTable!;
  const userRules = workspace.userRules;
  const ticked = (t: RuleTable) => (module == null ? table.properties.getRulesWithConverse(t) : module.enabledRules(t));
  const addRules = (t: RuleTable, tickedNames: string[]) => {
    for (const name of t.ruleNames) {
      for (const h of t.headings.get(name) ?? []) items.push({ type: 'heading', text: expandEscapes(h) });
      const rule = workspace.getRule(name);
      items.push({ type: 'rule', name, form: rule == null ? '' : rule.format(' . ', ' .: '), ticked: tickedNames.includes(name), theorem: false });
    }
  };
  if (userRules != null && userRules.size > 0) {
    const message = getDerivationMessage('dertxt001');
    for (const line of expandEscapes(message.text).split('\n')) items.push({ type: 'heading', text: line });
    addRules(userRules, ticked(userRules));
  }
  addRules(table, ticked(table));
  const theorems = table.theorems!;
  const enabled = module == null ? table.properties.getTheoremsWithConverse(theorems) : module.enabledTheorems(theorems);
  const enabledSet = new Set(intervalElements(enabled));
  for (const n of theorems.numbers()) {
    for (const h of theorems.headings.get(n) ?? []) items.push({ type: 'heading', text: expandEscapes(h) });
    const theorem = theorems.getTheorem(n);
    items.push({ type: 'rule', name: 'T' + n, form: theorem == null ? '' : theorem.toString(), ticked: enabledSet.has(n), theorem: true });
  }
  return {
    title: module == null ? 'Inference Rules' : 'Available Inference Rules',
    items,
    legend: module == null ? 'usable with Interchange of Equivalents' : 'available for this derivation',
  };
}
