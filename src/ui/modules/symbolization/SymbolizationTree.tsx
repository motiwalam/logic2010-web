// The symbolization tree: each node shows its English (editable), its connective (a button
// that opens the connective menu) and, indented below, its parts. The node with the focus is
// highlighted, and its part of the formula is highlighted in the formula above the tree.

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  connWords,
  isBinderKind,
  menuItems,
  type LPSymbolizer,
  type MenuItem as SymMenuItem,
  type SymbolizationError,
  SymbolizationNode,
} from '../../../engine/modules/symbolization';
import { formatShortcut } from '../../components/shortcuts';

/** Ctrl+Shift+<code> (and Alt+<code>) applies a connective (SymbolizationTextPane). */
const KEY_KINDS: Record<string, number> = {
  KeyT: 0,
  KeyN: 1,
  KeyC: 2,
  KeyA: 3,
  KeyO: 4,
  KeyB: 5,
  KeyU: 6,
  KeyE: 7,
  KeyD: 8,
  Equal: 9,
  KeyM: 10,
  Enter: 10,
  Digit2: 11,
};

const KIND_KEYS = ['T', 'N', 'C', 'A', 'O', 'B', 'U', 'E', 'D', '=', 'M', '@'];

/** The shortcut shown for a kind: Ctrl+Shift+X, and the Alt+X the browser always lets through. */
export function kindShortcut(kind: number): string {
  const k = KIND_KEYS[kind];
  const alt = k === '@' ? '2' : k;
  return `${formatShortcut('Mod+Shift+' + (k === '@' ? '2' : k))} · ${formatShortcut('Alt+' + alt)}`;
}

/** What each child is, by the parent's kind. */
function roleOf(parent: SymbolizationNode, i: number): string {
  switch (parent.connective) {
    case 1:
      return 'negated';
    case 2:
      return i === 0 ? 'if' : 'then';
    case 3:
      return 'conjunct';
    case 4:
      return 'disjunct';
    case 5:
      return i === 0 ? 'left' : 'right';
    case 6:
    case 7:
    case 8:
      return 'body';
    case 9:
    case 10:
      return i === 0 ? 'left term' : 'right term';
    default:
      return '';
  }
}

/** The node's connective as shown in its button. */
export function connectiveText(n: SymbolizationNode): string {
  const p = n.panel;
  if (n.connective === 0 || p == null) return '';
  if (n.connective === 11) return p.labelText ?? '';
  if (isBinderKind(n.connective)) return (p.symbolText ?? '') + (p.labelText ?? '');
  return p.symbolText ?? '';
}

/** Where target's text is in root.toString() ([start, end)), or null. Mirrors SymbolizationNode.toString. */
export function locate(n: SymbolizationNode, target: SymbolizationNode, base = 0): [number, number] | null {
  if (n === target) return [base, base + n.toString().length];
  const sym = n.panel?.symbolText ?? '';
  const label = String(n.panel?.labelText ?? null);
  const c = n.children;
  const len = (k: number) => String(c[k]).length;
  switch (n.connective) {
    case 1:
      return c[0] ? locate(c[0], target, base + sym.length) : null;
    case 2:
    case 3:
    case 4:
    case 5:
      return (c[0] && locate(c[0], target, base + 1)) || (c[1] ? locate(c[1], target, base + 1 + len(0) + 1 + sym.length + 1) : null);
    case 6:
    case 7:
    case 8:
      return c[0] ? locate(c[0], target, base + sym.length + label.length + 1) : null;
    case 9:
    case 10:
      return (c[0] && locate(c[0], target, base)) || (c[1] ? locate(c[1], target, base + len(0) + 1 + sym.length + 1) : null);
    default:
      return null;
  }
}

export interface TreeHandle {
  focusNode(node: SymbolizationNode | null): void;
}

export interface TreeProps {
  session: LPSymbolizer;
  readOnly: boolean;
  focused: SymbolizationNode | null;
  onFocusNode(node: SymbolizationNode): void;
  /** Applies a kind with the keyboard or the menu (async: may ask for a symbol). */
  onApply(node: SymbolizationNode, kind: number): void;
  onMenuItem(node: SymbolizationNode, item: SymMenuItem, field: HTMLTextAreaElement | null): void;
  onHint(node: SymbolizationNode): void;
  onError(error: SymbolizationError): void;
}

export const SymbolizationTree = forwardRef<TreeHandle, TreeProps>(function SymbolizationTree(props, ref) {
  const fields = useRef(new Map<number, HTMLTextAreaElement>());
  const [menuFor, setMenuFor] = useState<number | null>(null);
  useImperativeHandle(ref, () => ({
    focusNode(node) {
      if (node == null) return;
      // after the render that creates the node's field
      requestAnimationFrame(() => fields.current.get(node.id)?.focus());
    },
  }));
  return (
    <div className="sym-tree" role="tree" aria-label="Symbolization tree">
      <NodeView node={props.session.problem} depth={0} role="" p={props} fields={fields.current} menuFor={menuFor} setMenuFor={setMenuFor} />
    </div>
  );
});

interface NodeViewProps {
  node: SymbolizationNode;
  depth: number;
  role: string;
  p: TreeProps;
  fields: Map<number, HTMLTextAreaElement>;
  menuFor: number | null;
  setMenuFor(id: number | null): void;
}

function autoSize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function NodeView({ node, depth, role, p, fields, menuFor, setMenuFor }: NodeViewProps) {
  const field = useRef<HTMLTextAreaElement | null>(null);
  const { readOnly } = p;
  const focused = p.focused === node;
  const kindText = connectiveText(node);
  const errors = node.panel?.buttons ?? [];
  const complete = node.connective !== 0 && !node.isIncomplete();
  useLayoutEffect(() => autoSize(field.current));

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    // Alt+arrows: move in the tree
    if (e.altKey && !mod && !e.shiftKey && e.key.startsWith('Arrow')) {
      e.preventDefault();
      e.stopPropagation();
      const parent = node.getParentNode();
      let to: SymbolizationNode | null = null;
      if (e.key === 'ArrowUp') to = parent;
      else if (e.key === 'ArrowDown') to = node.getChildNode(0);
      else if (parent) to = parent.getChildNode(parent.indexOfChildNode(node) + (e.key === 'ArrowRight' ? 1 : -1));
      if (to) fields.get(to.id)?.focus();
      return;
    }
    if (readOnly) return;
    // Ctrl+Shift+? (/): hint
    if (((mod && e.shiftKey) || (e.altKey && !mod)) && e.code === 'Slash') {
      e.preventDefault();
      e.stopPropagation();
      p.onHint(node);
      return;
    }
    const kind = KEY_KINDS[e.code];
    if (kind !== undefined && ((mod && e.shiftKey) || (e.altKey && !mod && e.code !== 'Enter'))) {
      e.preventDefault();
      e.stopPropagation();
      // Alt added (Ctrl+Alt+Shift): copy the text first
      if (mod && e.altKey) void navigator.clipboard?.writeText(node.text.trim()).catch(() => undefined);
      p.onApply(node, kind);
      return;
    }
    if (e.key === 'Enter' && mod && !e.shiftKey) {
      // Ctrl+Enter: a line break in the English
      e.preventDefault();
      const el = e.currentTarget;
      const s = el.selectionStart;
      const t = node.text.substring(0, s) + '\n' + node.text.substring(el.selectionEnd);
      node.setText(t);
      requestAnimationFrame(() => el.setSelectionRange(s + 1, s + 1));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !mod) {
      e.preventDefault();
      setMenuFor(node.id);
    }
  };

  return (
    <div
      className={'sym-node' + (focused ? ' is-focused' : '') + (node.connective === 0 ? ' is-open' : '') + (errors.length ? ' has-error' : '')}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={node.children.length ? true : undefined}
      aria-selected={focused}
    >
      <div className="sym-node-row">
        {role && <span className="sym-role">{role}</span>}
        <div className="sym-node-main">
          <div className="sym-kind-wrap">
            <button
              type="button"
              className={'sym-kind' + (node.connective === 0 ? ' is-empty' : '') + (node.connective === 11 ? ' is-atom' : '')}
              title={node.connective === 0 ? 'Choose what this part is' : connWords[node.connective]}
              aria-label={node.connective === 0 ? 'Choose the connective' : `${connWords[node.connective]} ${kindText}: change`}
              disabled={readOnly}
              aria-haspopup="menu"
              aria-expanded={menuFor === node.id}
              onClick={() => setMenuFor(menuFor === node.id ? null : node.id)}
            >
              {node.connective === 0 ? (readOnly ? '·' : '?') : <span className="formula">{kindText}</span>}
            </button>
            {menuFor === node.id && (
              <ConnectiveMenu
                items={menuItems(p.session, node)}
                onClose={(refocus) => {
                  setMenuFor(null);
                  if (refocus) field.current?.focus();
                }}
                onSelect={(item) => {
                  setMenuFor(null);
                  if (item.kind != null) p.onApply(node, item.kind);
                  else p.onMenuItem(node, item, field.current);
                }}
              />
            )}
          </div>
          <textarea
            ref={(el) => {
              field.current = el;
              if (el) fields.set(node.id, el);
              else fields.delete(node.id);
            }}
            className="sym-text"
            rows={1}
            value={node.text.trim() === '' ? '' : node.text}
            placeholder={node.connective === 0 ? 'the English of this part' : ''}
            readOnly={readOnly}
            spellCheck={false}
            aria-label={(role ? role + ': ' : '') + 'English'}
            onFocus={() => p.onFocusNode(node)}
            onChange={(e) => node.setText(e.target.value)}
            onBlur={() => !readOnly && node.normalizeText()}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => {
              if (readOnly) return;
              e.preventDefault();
              setMenuFor(node.id);
            }}
          />
          {errors.map((err, i) => (
            <button key={i} type="button" className="sym-error-btn" onClick={() => p.onError(err)} title="Why is this part wrong?">
              Error
            </button>
          ))}
        </div>
        {complete && depth > 0 && node.children.length > 0 && (
          <div className="sym-part formula" aria-label="This part in symbols">
            {node.toString()}
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="sym-children" role="group">
          {node.children.map((c, i) => (
            <NodeView key={c.id} node={c} depth={depth + 1} role={roleOf(node, i)} p={p} fields={fields} menuFor={menuFor} setMenuFor={setMenuFor} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectiveMenu({ items, onSelect, onClose }: { items: SymMenuItem[]; onSelect(item: SymMenuItem): void; onClose(refocus: boolean): void }) {
  const list = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.sym-kind')) close.current(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
  const onKey = (e: ReactKeyboardEvent) => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') els[(i + 1) % els.length]?.focus();
    else if (e.key === 'ArrowUp') els[(i - 1 + els.length) % els.length]?.focus();
    else if (e.key === 'Home') els[0]?.focus();
    else if (e.key === 'End') els[els.length - 1]?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') onClose(true);
    else {
      // a letter picks the first item starting with it
      const k = e.key.length === 1 ? e.key.toLowerCase() : '';
      const hit = k ? els.find((el) => el.textContent?.trim().toLowerCase().startsWith(k)) : undefined;
      if (!hit) return;
      hit.focus();
    }
    e.preventDefault();
    e.stopPropagation();
  };
  const edit = items.findIndex((it) => it.edit);
  return (
    <div className="sym-menu menu-list" role="menu" ref={list} onKeyDown={onKey}>
      {items.map((it, i) => (
        <div key={it.label}>
          {i === edit && <div role="separator" className="menu-sep" />}
          <button type="button" role="menuitem" className="menu-item sym-menu-item" onClick={() => onSelect(it)}>
            <span className="menu-item-label">{it.label}</span>
            {it.kind != null ? (
              <span className="sym-menu-key">{kindShortcut(it.kind)}</span>
            ) : it.hover ? (
              <span className="sym-menu-key">{it.label === 'Hint' ? `${formatShortcut('Mod+Shift+/')} · ${formatShortcut('Alt+/')}` : it.hover}</span>
            ) : null}
          </button>
        </div>
      ))}
    </div>
  );
}

/** A static copy of a tree (printing). */
export function StaticTree({ node, role = '' }: { node: SymbolizationNode; role?: string }) {
  return (
    <div className="sym-static">
      <div className="sym-static-row">
        {role && <span className="sym-role">{role}</span>}
        <span className="sym-static-kind formula">{connectiveText(node) || '?'}</span>
        <span>{node.text.trim()}</span>
      </div>
      {node.children.length > 0 && (
        <div className="sym-static-children">
          {node.children.map((c, i) => (
            <StaticTree key={c.id} node={c} role={roleOf(node, i)} />
          ))}
        </div>
      )}
    </div>
  );
}
