// The parse tree: each node's formula, with its children laid out below and joined by lines.
// A click (or Enter at the keyboard caret) on a symbol of a node's text is the desktop's click
// on the formula: hitting the main connective expands the node (flashed green), anything else
// is an error (flashed red). In main-connective mode the clicked symbol is marked (orange).
// The symbol under the pointer is outlined, so it is clear what a click would pick.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ParseTreeNode } from '../../../engine/modules/parsing/ParseTree';
import type { ParsingClickResult } from '../../../engine/modules/parsing/ParsingProblemPanel';

export interface Flash {
  path: string;
  range: number[] | null;
  tone: 'good' | 'bad';
  id: number;
}

interface Props {
  root: ParseTreeNode;
  /** Clicks are ignored (read-only, or "Not Well Formed" chosen). */
  disabled: boolean;
  /** Main-connective mode: only the root is clicked, the choice is marked. */
  mainOnly: boolean;
  onClick(node: ParseTreeNode, index: number): ParsingClickResult;
}

const pathKey = (node: ParseTreeNode) => node.getPath().join('.');

/** The start of each symbol of the text (blanks skipped), for keyboard movement. */
function symbolStarts(node: ParseTreeNode): number[] {
  const out: number[] = [];
  for (let i = 0; i < node.text.length; ) {
    const r = node.getSymbolRangeAt(i);
    if (r == null) {
      i++;
      continue;
    }
    out.push(r[0]);
    i = Math.max(r[1], i + 1);
  }
  return out;
}

export function ParseTreeView({ root, disabled, mainOnly, onClick }: Props) {
  const [flash, setFlash] = useState<Flash | null>(null);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  const click = (node: ParseTreeNode, i: number) => {
    const r = onClick(node, i);
    if (r.kind === 'expanded') {
      setFlash({ path: pathKey(node), range: r.symbolRange, tone: 'good', id: Date.now() });
      setAnnounce('Right: the node is expanded.');
    } else if (r.kind === 'miss') {
      setFlash({ path: pathKey(node), range: r.symbolRange, tone: 'bad', id: Date.now() });
      setAnnounce(node.expanded ? 'This node is already expanded.' : 'That is not the main connective.');
    } else if (r.kind === 'selected') {
      setAnnounce(r.symbolRange ? 'Marked as the main connective.' : 'Nothing marked.');
    }
  };

  return (
    <div className="ptree-scroll">
      <div className="ptree">
        <NodeView node={root} disabled={disabled} mainOnly={mainOnly} flash={flash} onClick={click} />
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

function NodeView({
  node,
  disabled,
  mainOnly,
  flash,
  onClick,
}: {
  node: ParseTreeNode;
  disabled: boolean;
  mainOnly: boolean;
  flash: Flash | null;
  onClick(node: ParseTreeNode, i: number): void;
}) {
  const shown = node.expanded ? node.children : [];
  const leaf = node.children.length === 0;
  return (
    <div className={'pt-node' + (leaf && node.parseNode ? ' is-leaf' : '') + (node.expanded ? ' is-expanded' : '')}>
      <NodeLabel node={node} disabled={disabled || (mainOnly && node.parent != null)} mainOnly={mainOnly} flash={flash} onClick={onClick} />
      {shown.length > 0 && (
        <ul className="pt-children">
          {shown.map((c, k) => (
            <li key={k}>
              <NodeView node={c} disabled={disabled} mainOnly={mainOnly} flash={flash} onClick={onClick} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NodeLabel({
  node,
  disabled,
  mainOnly,
  flash,
  onClick,
}: {
  node: ParseTreeNode;
  disabled: boolean;
  mainOnly: boolean;
  flash: Flash | null;
  onClick(node: ParseTreeNode, i: number): void;
}) {
  const [hover, setHover] = useState<number[] | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const text = node.text;
  const key = pathKey(node);
  const myFlash = flash && flash.path === key ? flash : null;
  const selected = mainOnly && node.parent == null ? node.selectedRange : null;
  const caretRange = caret == null ? null : node.getSymbolRangeAt(caret);
  const inRange = (r: number[] | null | undefined, i: number) => r != null && r.length >= 2 && i >= r[0] && i < r[1];
  const active = !disabled && (mainOnly || !node.expanded);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const starts = symbolStarts(node);
    if (starts.length === 0) return;
    const at = caret == null ? -1 : starts.indexOf(caretRange ? caretRange[0] : caret);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      let j = at;
      if (e.key === 'ArrowRight') j = at < 0 ? 0 : Math.min(starts.length - 1, at + 1);
      else if (e.key === 'ArrowLeft') j = at < 0 ? starts.length - 1 : Math.max(0, at - 1);
      else if (e.key === 'Home') j = 0;
      else j = starts.length - 1;
      setCaret(starts[j]);
    } else if ((e.key === 'Enter' || e.key === ' ') && caret != null) {
      e.preventDefault();
      onClick(node, caret);
    }
  };

  const describe = node.expanded ? 'expanded' : leaf(node) ? 'a sentence letter or atomic formula' : 'not expanded yet';
  return (
    <div
      ref={ref}
      className={'pt-label formula' + (active ? ' is-active' : '') + (myFlash ? ' flash-' + myFlash.tone : '')}
      tabIndex={disabled ? -1 : 0}
      role={disabled ? undefined : 'button'}
      aria-label={`${text}, ${describe}. Use the arrow keys to choose a symbol and Enter to click it.`}
      aria-disabled={disabled || undefined}
      onKeyDown={onKey}
      onBlur={() => setCaret(null)}
      onMouseLeave={() => setHover(null)}
    >
      {text.split('').map((ch, i) => (
        <span
          key={i}
          className={
            'pt-ch' +
            (ch === ' ' ? ' is-space' : '') +
            (active && inRange(hover, i) ? ' is-hover' : '') +
            (inRange(caretRange, i) ? ' is-caret' : '') +
            (inRange(selected, i) ? ' is-selected' : '') +
            (myFlash && inRange(myFlash.range, i) ? ' is-flash' : '')
          }
          onMouseEnter={disabled ? undefined : () => setHover(node.getSymbolRangeAt(i))}
          onMouseDown={
            disabled
              ? undefined
              : (e) => {
                  e.preventDefault();
                  ref.current?.focus();
                  setCaret(null);
                  onClick(node, i);
                }
          }
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

function leaf(node: ParseTreeNode): boolean {
  return node.children.length === 0;
}
