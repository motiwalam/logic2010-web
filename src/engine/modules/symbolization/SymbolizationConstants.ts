/**
 * Port of SymbolizationConstants.java: the node kinds of a symbolization tree and the
 * per-kind tables (symbol, menu label, shortcut, words, output and argument types, chapter).
 */

export const NONE = 0;
export const NEGATION = 1;
export const IMPLICATION = 2;
export const CONJUNCTION = 3;
export const DISJUNCTION = 4;
export const EQUIVALENCE = 5;
export const UNIVERSAL = 6;
export const EXISTENTIAL = 7;
export const DESCRIPTIVE = 8;
export const EQUATION = 9;
export const MEMBER = 10;
export const SYMBOLIC = 11;

/** Expression types of a node's output and of its argument slots. */
export const TYPE_FORMULA = 0;
export const TYPE_TERM = 1;
export const TYPE_ANY = 2;

export const connOutTypes: readonly number[] = [2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2];
export const connArgTypes: readonly (readonly number[])[] = [[], [0], [0, 0], [0, 0], [0, 0], [0, 0], [0], [0], [0], [1, 1], [1, 1], []];
/** The node code of each kind (internal symbols; binders and atoms add their label). */
export const connSymbol: readonly string[] = ['?', '~', '->', '&', '|', '<->', '@', '!', '%', '=', '[m]', '*'];
export const connMenu: readonly string[] = [
  'Truncate',
  'Negation',
  'Conditional',
  'Conjunction',
  'Disjunction',
  'Biconditional',
  'Univ Gen',
  'Exist Gen',
  'Descriptive',
  'Equality',
  'Member',
  'Atomic',
];
export const connHover: readonly string[] = [
  'Ctrl+Shift+T',
  'Ctrl+Shift+N',
  'Ctrl+Shift+C',
  'Ctrl+Shift+A',
  'Ctrl+Shift+O',
  'Ctrl+Shift+B',
  'Ctrl+Shift+U',
  'Ctrl+Shift+E',
  'Ctrl+Shift+D',
  'Ctrl+Shift+=',
  'Ctrl+Shift+M',
  'Ctrl+Shift+@',
];
/**
 * The key that applies each kind with Ctrl+Shift (SymbolizationTextPane.keyPressed /
 * keyTyped). Member also takes Ctrl+Shift+Enter, atomic Ctrl+Shift+2. Alt (Meta) added
 * copies the node's text to the clipboard first.
 */
export const connShortcutKeys: readonly (readonly string[])[] = [
  ['T'],
  ['N'],
  ['C'],
  ['A'],
  ['O'],
  ['B'],
  ['U'],
  ['E'],
  ['D'],
  ['='],
  ['M', 'Enter'],
  ['@', '2'],
];
export const editMenu: readonly string[] = ['Cut', 'Copy', 'Paste', 'Select All', 'Clear'];
export const editHover: readonly (string | null)[] = ['Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Ctrl+A', null];
export const connWords: readonly string[] = [
  'an unparsed statement',
  'a negation',
  'a conditional',
  'a conjunction',
  'a disjunction',
  'a biconditional',
  'a universal generalization',
  'an existential generalization',
  'a descriptive statement',
  'an equality',
  'a member relation',
  'an atomic expression',
];
/** The chapter from which each kind is offered in the connective menu. */
export const connChaps: readonly number[] = [1, 1, 1, 2, 2, 2, 3, 3, 6, 5, 5, 1];
export const expTypes: readonly string[] = ['Formula', 'Term'];

export function isBinderKind(kind: number): boolean {
  return kind === UNIVERSAL || kind === EXISTENTIAL || kind === DESCRIPTIVE;
}
