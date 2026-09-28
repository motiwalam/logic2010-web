/**
 * Port of SymbolizationNodeMenu.java: a node's connective menu (Enter or right click), with
 * the chapter filtering of its items, and the actions of its special items (Inequality,
 * Rest Univ, Rest Exist, Unrest, Hint). The edit items (Cut, Copy, Paste, Select All,
 * Clear) act on the node's text field and are left to the UI.
 */
import { ChildRecordSnapshot } from './ChildRecordSnapshot';
import type { HintResult, LPSymbolizer } from './LPSymbolizer';
import { connChaps, connHover, connMenu, connOutTypes, editHover, editMenu } from './SymbolizationConstants';
import type { SymbolizationNode } from './SymbolizationNode';

export const HINT_LABEL = 'Hint';
export const HINT_HOVER = 'Ctrl+Shift+?';
const HINT_CHAPTER = 1;
export const INEQUALITY_LABEL = 'Inequality';
const INEQUALITY_CHAPTER = 5;
export const RESTRICTED_LABELS = ['Rest Univ', 'Rest Exist', 'Unrest'] as const;
export const RESTRICTED_HOVER = [
  'Restricted Universal Generalization',
  'Restricted Existential Generalization',
  'Remove Restricted Generalization',
] as const;
const RESTRICTED_CHAPTER = 3;

export interface MenuItem {
  label: string;
  hover: string | null;
  /** The node kind a connective item applies; null for the other items. */
  kind: number | null;
  /** true for the edit items (after the separator). */
  edit: boolean;
}

function isChapterAvailable(chapter: number | null, needed: number | null): boolean {
  return chapter == null || needed == null || chapter >= needed;
}

/** rebuildItems: the menu of the node. */
export function menuItems(session: LPSymbolizer, node: SymbolizationNode): MenuItem[] {
  const parent = node.getParentNode();
  const chapter = session.chapter;
  const j = parent == null ? -1 : parent.indexOfChildNode(node);
  const k = parent == null ? 2 : parent.argTypes[j];
  const items: MenuItem[] = [];
  for (let l = 0; l < connOutTypes.length; l++) {
    const t = connOutTypes[l];
    if ((t === 2 || k === 2 || t === k) && isChapterAvailable(chapter, connChaps[l])) {
      items.push({ label: connMenu[l], hover: connHover[l], kind: l, edit: false });
    }
  }
  if ((k === 0 || k === 2) && isChapterAvailable(chapter, INEQUALITY_CHAPTER)) {
    items.push({ label: INEQUALITY_LABEL, hover: null, kind: null, edit: false });
  }
  if (!session.hintsDisabled && session.problem.countAnswers() !== 0 && isChapterAvailable(chapter, HINT_CHAPTER)) {
    items.push({ label: HINT_LABEL, hover: HINT_HOVER, kind: null, edit: false });
  }
  if (k === 0 || k === 2) {
    for (let r = 0; r < 2; r++) {
      if (isChapterAvailable(chapter, RESTRICTED_CHAPTER)) {
        items.push({ label: RESTRICTED_LABELS[r], hover: RESTRICTED_HOVER[r], kind: null, edit: false });
      }
    }
  }
  const c0 = node.getChildNode(0)?.connective;
  if (
    ((node.connective === 6 && c0 === 2) || (node.connective === 7 && c0 === 3) || (node.connective === 1 && c0 === 9)) &&
    isChapterAvailable(chapter, RESTRICTED_CHAPTER)
  ) {
    items.push({ label: RESTRICTED_LABELS[2], hover: RESTRICTED_HOVER[2], kind: null, edit: false });
  }
  for (let e = 0; e < editMenu.length; e++) items.push({ label: editMenu[e], hover: editHover[e], kind: null, edit: true });
  return items;
}

export type MenuActionResult =
  /** The node to focus next (or null). */
  | { kind: 'focus'; node: SymbolizationNode | null }
  | { kind: 'hint'; result: HintResult }
  /** An edit item: the UI performs it on the text field. */
  | { kind: 'edit'; label: string }
  | { kind: 'none' };

/** actionPerformed: performs a (non-edit) menu item on the node. */
export async function performMenuItem(session: LPSymbolizer, node: SymbolizationNode, label: string): Promise<MenuActionResult> {
  const kind = connMenu.indexOf(label);
  if (kind !== -1) return { kind: 'focus', node: await session.setConnective(node, kind, null) };
  if (label === INEQUALITY_LABEL) {
    const snapshot = new ChildRecordSnapshot(node);
    node.setConnective(0, null, false);
    await session.setConnective(node, 1, null);
    const child = node.getChildNode(0);
    if (child == null) return { kind: 'none' };
    child.setConnective(9, null, false);
    snapshot.restore(child);
    return { kind: 'focus', node: child };
  }
  if (label === HINT_LABEL) return { kind: 'hint', result: session.showHint(node) };
  if (label === RESTRICTED_LABELS[0] || label === RESTRICTED_LABELS[1]) {
    const universal = label === RESTRICTED_LABELS[0];
    const snapshot = new ChildRecordSnapshot(node);
    node.setConnective(0, null, false);
    await session.setConnective(node, universal ? 6 : 7, null);
    const child = node.getChildNode(0);
    if (child == null) return { kind: 'none' };
    child.setConnective(universal ? 2 : 3, null, false);
    snapshot.restore(child);
    return { kind: 'focus', node: child };
  }
  if (label === RESTRICTED_LABELS[2]) {
    const inner = node.getChildNode(0)!;
    const snapshot = new ChildRecordSnapshot(inner);
    const j1 = inner.connective;
    node.setConnective(0, null, false);
    await session.setConnective(node, j1, null);
    snapshot.restore(node);
    return { kind: 'focus', node };
  }
  if (editMenu.includes(label)) return { kind: 'edit', label };
  return { kind: 'none' };
}
