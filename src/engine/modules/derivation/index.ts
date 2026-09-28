/**
 * The derivation module's engine (a port of LPDerivation and its classes, without Swing).
 *
 * - DerivationConfig.load(): the program-wide part (options, box rules, course exercises).
 * - DerivationWorkspace.open(config, workFile): a student's work (problems, states, user rules).
 * - new LPDerivation(workspace, { dialogs }): a derivation being worked on; its tree
 *   (problem: DerivationBox of DerivationLines), editing through the lines' editors
 *   (DerivationLineEditor) and operations, checking (checkProblem, DerivationLine.checkLine),
 *   change notification (subscribe / getVersion / run).
 * - DerivationDialogs: what the UI implements (show a QueryDialog).
 * - stackViewData / rulesViewData: the Stack and Applicable views.
 * - inferenceRules: the Inference Rules list; keypadFor: the keypad's keys.
 * - problemOperations: open, save, delete, user problems.
 */
export * from './DerivationConstants';
export { DerivationBox } from './DerivationBox';
export { DerivationConfig, SELECTOR_OPTIONS, type SelectorOption } from './DerivationConfig';
export * as DerivationDialogFunctions from './DerivationDialogs';
export { DerivationLine, MessageDetails } from './DerivationLine';
export { DerivationLineChecker } from './DerivationLineChecker';
export { ALT, CTRL, DerivationLineEditor, META, SHIFT, VK_DOWN, VK_LEFT, VK_RIGHT, VK_UP } from './DerivationLineEditor';
export type { DerivationNode } from './DerivationNode';
export {
  countProblemLines,
  DerivationProblemEntry,
  DerivationProblemSet,
  getProblemRuleProven,
  getProblemStatement,
  getWork,
  hasWork,
  removeWork,
  UserRule,
} from './DerivationProblemSet';
export { DerivationQueryHandler } from './DerivationQueryHandler';
export { Applicable, computeRules, rulesViewData, RulesResult, type RulesViewData, UNKNOWNS_NOTE } from './DerivationRulesView';
export { computeStack, cursorOf, StackSnapshot, stackViewData, type StackViewData, textBeforeCursor } from './DerivationStackView';
export { DerivationWorkspace, WORK_KEY } from './DerivationWorkspace';
export { inferenceRules, type InferenceRuleItem, type InferenceRulesList } from './inferenceRules';
export { InterchangeJustification, LineRule, PremiseRule } from './InterchangeJustification';
export { BiconditionalAssumptionJustification, IndirectAssumptionJustification, Justification, PremiseJustification } from './Justification';
export { keypadFor, type KeypadGridData } from './keypad';
export { LineReference } from './LineReference';
export { LPDerivation, type LPDerivationOptions, type TitleState } from './LPDerivation';
export * as problemOperations from './problemOperations';
export {
  type ChoiceHandler,
  type DerivationDialogs,
  type DialogBlock,
  DialogField,
  type DialogKind,
  HeadlessDialogs,
  QueryDialog,
  type SubstitutionRow,
} from './QueryDialog';
export { RuleApplication } from './RuleApplication';
export { SchemeSubstitutionPanel } from './SchemeSubstitutionPanel';
export { TermOccurrenceSelector } from './TermOccurrenceSelector';
