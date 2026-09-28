// The derivation itself: numbered lines, Show lines opening boxes (drawn as brackets; a boxed
// and canceled Show struck through), collapsible boxes, each line's formula and justification
// fields and its message. The keys go to the engine's editor (DerivationLineEditor), which
// implements the desktop's keyboard: Enter (and Shift/Ctrl/Alt+Enter), Tab, Ctrl+Shift+S
// (Show), Ctrl+Shift+X (box and cancel), Alt+Delete, Up/Down, Alt+Up/Down (collapse, expand),
// Alt+Left/Right (outdent, indent).

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { DerivationBox } from '../../../engine/modules/derivation/DerivationBox';
import type { DerivationLine } from '../../../engine/modules/derivation/DerivationLine';
import { ALT, CTRL, type DerivationLineEditor, SHIFT, VK_DOWN, VK_LEFT, VK_RIGHT, VK_UP } from '../../../engine/modules/derivation/DerivationLineEditor';
import type { LPDerivation } from '../../../engine/modules/derivation/LPDerivation';
import { maggie, symbols, translateSymbols } from '../../../engine/program/symbols';
import { FormulaInput, type FormulaInputHandle } from '../../components/FormulaInput';
import { FormulaText } from '../../components/FormulaText';

export interface Rail {
  box: DerivationBox;
  first: boolean;
  last: boolean;
}

export interface Row {
  line: DerivationLine;
  /** The brackets of the boxes the line is in (outermost first; the root box has none). */
  rails: Rail[];
}

/** The visible lines in order, with the brackets of their boxes. */
export function buildRows(m: LPDerivation): Row[] {
  const rows: Row[] = [{ line: m.problem.showLine, rails: [] }];
  const body = (box: DerivationBox, depth: Rail[]) => {
    const nodes = box.getNodes();
    for (let i = 1; i < nodes.length; i++) {
      const node = nodes[i];
      if (node instanceof DerivationBox) {
        rows.push({ line: node.showLine, rails: depth.map((r) => ({ ...r, first: false, last: false })) });
        if (node.isExpanded()) {
          const start = rows.length;
          body(node, [...depth, { box: node, first: false, last: false }]);
          if (rows.length > start) {
            const k = depth.length;
            rows[start].rails[k].first = true;
            rows[rows.length - 1].rails[k].last = true;
          }
        }
      } else {
        rows.push({ line: node, rails: depth.map((r) => ({ ...r, first: false, last: false })) });
      }
    }
  };
  body(m.problem, []);
  return rows;
}

/** The line's kind. */
export function lineKind(line: DerivationLine): 'problem' | 'show' | 'cancel' | 'line' {
  if (line.box.showLine === line) return line.box.parentBox == null ? 'problem' : 'show';
  return line.box.cancelLine === line ? 'cancel' : 'line';
}

export interface DerivationEditorHandle {
  /** Focuses the field the engine has the focus in (or the first empty line). */
  focusCurrent(): void;
  /** Inserts text at the caret of the justification field of the line. */
  insertInJustification(line: DerivationLine, text: string, caret: number): void;
}

export interface DerivationEditorProps {
  m: LPDerivation;
  version: number;
  readOnly: boolean;
  /** Runs an engine operation (then the focus moves and the view updates). */
  run(op: () => unknown): Promise<void>;
  /** Whether an operation is running. */
  busy(): boolean;
  /** The caret moved (for the stack and rules views). */
  onCursor(): void;
  /** The "?" of a line's message. */
  onExplain(line: DerivationLine): void;
}

function modifiers(e: KeyboardEvent): number {
  return (e.shiftKey ? SHIFT : 0) | (e.ctrlKey || e.metaKey ? CTRL : 0) | (e.altKey ? ALT : 0);
}

/**
 * The key as the engine's editor takes it: [typed character, modifiers] for handleKeyTyped,
 * or [key code, modifiers] for handleKeyPressed, or null.
 */
export function engineKey(e: KeyboardEvent): { typed: string; mods: number } | { code: number; mods: number } | null {
  const mods = modifiers(e);
  if (e.key === 'Enter') return { typed: '\n', mods };
  if (e.key === 'Tab' && (mods & CTRL) === 0) return { typed: '\t', mods };
  if ((e.key === 'Delete' || e.key === 'Backspace') && e.altKey) return { typed: '\u007f', mods: mods & (SHIFT | ALT) };
  const showKey = (mods & (CTRL | SHIFT)) === (CTRL | SHIFT) || mods === ALT;
  if (showKey && e.code === 'KeyS') return { typed: '\u0013', mods: SHIFT | CTRL };
  if (showKey && e.code === 'KeyX') return { typed: '\u0018', mods: SHIFT | CTRL };
  if (e.key === 'ArrowUp') return { code: VK_UP, mods };
  if (e.key === 'ArrowDown') return { code: VK_DOWN, mods };
  if (e.key === 'ArrowLeft' && e.altKey) return { code: VK_LEFT, mods };
  if (e.key === 'ArrowRight' && e.altKey) return { code: VK_RIGHT, mods };
  return null;
}

/** Sends a key to the engine's editor; true if it was a derivation key (then the browser's action is prevented). */
export function sendKey(editor: DerivationLineEditor, e: KeyboardEvent, readOnly: boolean, run: (op: () => unknown) => Promise<void>): boolean {
  const k = engineKey(e);
  if (k == null) return false;
  e.preventDefault();
  if ('typed' in k) {
    if (readOnly && k.typed !== '\t') return true;
    void run(() => editor.handleKeyTyped(k.typed, k.mods));
  } else {
    // read-only: moving and collapsing only
    if (readOnly && (k.code === VK_LEFT || k.code === VK_RIGHT)) return true;
    void run(() => editor.handleKeyPressed(k.code, k.mods));
  }
  return true;
}

export const DerivationEditor = forwardRef<DerivationEditorHandle, DerivationEditorProps>(function DerivationEditor(props, ref) {
  const { m, readOnly, run, busy, onCursor, onExplain } = props;
  const rows = buildRows(m);
  const fields = useRef(new Map<DerivationLineEditor, { focus(): void; el(): HTMLElement | null }>());
  const root = useRef<HTMLDivElement>(null);

  const register = (editor: DerivationLineEditor | null, api: { focus(): void; el(): HTMLElement | null } | null) => {
    if (editor == null) return;
    if (api) fields.current.set(editor, api);
    else fields.current.delete(editor);
  };

  const focusEditor = (editor: DerivationLineEditor | null) => {
    if (!editor) return;
    const f = fields.current.get(editor);
    if (!f) return;
    const el = f.el();
    if (el && document.activeElement !== el) f.focus();
  };

  // the engine moved the focus: move the browser's there too (not while a dialog is open)
  useLayoutEffect(() => {
    if (document.querySelector('dialog[open]')) return;
    const target = m.focus;
    if (target == null) return;
    const f = fields.current.get(target);
    const el = f?.el();
    if (!el) return;
    const active = document.activeElement;
    if (active !== el && (active == null || active === document.body || root.current?.contains(active))) f!.focus();
    // the justification field shows the engine's selection (e.g. after renumbering)
    if (el instanceof HTMLInputElement && target.isAnnotation() && document.activeElement === el) {
      if (el.selectionStart !== target.selectionStart || el.selectionEnd !== target.selectionEnd) el.setSelectionRange(target.selectionStart, target.selectionEnd);
    }
    el.closest('.dl-row')?.scrollIntoView({ block: 'nearest' });
  });

  useImperativeHandle(ref, () => ({
    focusCurrent() {
      const target = m.focus ?? m.lastFocus;
      if (target && fields.current.has(target)) {
        focusEditor(target);
        return;
      }
      // the first line with an empty justification, else the last line
      const lines = m.getLines(true).filter((l) => l.annotationEditor != null || (l.formulaEditor != null && l.box.parentBox != null));
      const empty = lines.find((l) => l.annotationEditor != null && l.annotationEditor.text.trim() === '');
      const line = empty ?? lines[lines.length - 1] ?? m.problem.showLine;
      if (line) focusEditor(line.formulaEditor != null && line.getFormulaText(false) === '' ? line.formulaEditor : (line.annotationEditor ?? line.formulaEditor));
    },
    insertInJustification(line, text, caret) {
      const editor = line.annotationEditor;
      if (!editor || readOnly) return;
      const s = editor.text;
      const at = Math.max(0, Math.min(caret, s.length));
      const before = s.substring(0, at);
      const after = s.substring(at);
      const insert = (before !== '' && !/\s$/.test(before) ? ' ' : '') + text + (after !== '' && !/^\s/.test(after) ? ' ' : '');
      editor.edit(before + insert + after, before.length + insert.length);
      void run(() => m.setFocus(editor));
      requestAnimationFrame(() => focusEditor(editor));
    },
  }));

  const onFocus = (editor: DerivationLineEditor) => {
    if (busy() || m.focus === editor) return;
    m.setFocus(editor);
    onCursor();
  };

  const onBlur = (e: React.FocusEvent) => {
    if (busy()) return;
    const next = e.relatedTarget as HTMLElement | null;
    // to another field of the derivation (its onFocus moves the engine's focus), or into a dialog
    if (next && (root.current?.contains(next) || next.closest('dialog'))) return;
    setTimeout(() => {
      if (busy() || document.querySelector('dialog[open]')) return;
      const active = document.activeElement;
      if (active && root.current?.contains(active)) return;
      if (m.focus != null) m.setFocus(null);
    }, 0);
  };

  const focusedLine = m.focus?.line ?? null;
  const focusedBox = focusedLine == null ? null : focusedLine.getEnclosingBox();

  return (
    <div className={'derivation' + (readOnly ? ' is-readonly' : '')} ref={root} role="group" aria-label="Derivation">
      {rows.map((row) => (
        <LineRow
          key={rowKey(row.line)}
          row={row}
          m={m}
          readOnly={readOnly}
          focused={focusedLine === row.line}
          boxFocused={focusedBox != null && focusedBox.showLine === row.line}
          register={register}
          onFocus={onFocus}
          onBlur={onBlur}
          onKey={(editor, e) => sendKey(editor, e, readOnly, run)}
          onCursor={onCursor}
          onToggle={(box) => void run(() => box.setExpanded(!box.isExpanded()))}
          onExplain={onExplain}
          onEdited={() => m.changed()}
        />
      ))}
      {!readOnly && m.problem.getContentCount() === 1 && (
        <p className="dl-start-hint">
          Press <kbd>Enter</kbd> for the first line, then type <code>show conc</code> in its justification (or the formula “Show …”).
        </p>
      )}
    </div>
  );
});

const keys = new WeakMap<DerivationLine, number>();
let nextKey = 1;
function rowKey(line: DerivationLine): number {
  let k = keys.get(line);
  if (k == null) keys.set(line, (k = nextKey++));
  return k;
}

interface LineRowProps {
  row: Row;
  m: LPDerivation;
  readOnly: boolean;
  focused: boolean;
  boxFocused: boolean;
  register(editor: DerivationLineEditor | null, api: { focus(): void; el(): HTMLElement | null } | null): void;
  onFocus(editor: DerivationLineEditor): void;
  onBlur(e: React.FocusEvent): void;
  onKey(editor: DerivationLineEditor, e: KeyboardEvent): boolean;
  onCursor(): void;
  onToggle(box: DerivationBox): void;
  onExplain(line: DerivationLine): void;
  onEdited(): void;
}

function LineRow({ row, m, readOnly, focused, boxFocused, register, onFocus, onBlur, onKey, onCursor, onToggle, onExplain, onEdited }: LineRowProps) {
  const { line, rails } = row;
  const kind = lineKind(line);
  const n = line.getLineNumber();
  const formulaRef = useRef<FormulaInputHandle>(null);
  const justRef = useRef<HTMLInputElement>(null);
  const fe = line.formulaEditor;
  const ae = line.annotationEditor;

  useEffect(() => {
    register(fe, fe ? { focus: () => formulaRef.current?.focus(), el: () => document.getElementById(`dl-f-${rowKeyOf(line)}`)?.querySelector('input') ?? null } : null);
    register(ae, ae ? { focus: () => justRef.current?.focus(), el: () => justRef.current } : null);
    return () => {
      register(fe, null);
      register(ae, null);
    };
  });

  const box = line.box;
  const canceled = kind === 'show' && box.cancelLine != null;
  const hasBody = kind === 'show' && box.getContentCount() > 1;
  const message = line.getShownMessage();
  const isError = line.shownIsError;
  const formula = line.getFormulaText(false);
  const label = kind === 'problem' ? (m.titleState.title != null ? m.titleState.title + ':' : 'Problem:') : kind === 'show' ? 'Show' : null;

  return (
    <div
      className={
        'dl-row dl-' + kind + (focused ? ' is-focused' : '') + (boxFocused ? ' is-box-focused' : '') + (canceled ? ' is-canceled' : '') + (message ? (isError ? ' has-error' : ' has-info') : '')
      }
      data-line={n}
      style={{ ['--depth' as string]: rails.length }}
    >
      <span className="dl-num" aria-hidden={kind === 'problem'}>
        {kind === 'problem' ? '' : n}
      </span>
      <div className="dl-main">
        {rails.map((r, i) => (
          <span key={i} className={'dl-rail' + (r.first ? ' is-first' : '') + (r.last ? ' is-last' : '') + (r.box.cancelLine != null ? ' is-closed' : '')} aria-hidden="true" />
        ))}
        {kind === 'show' && (
          <button
            type="button"
            className={'dl-toggle' + (hasBody ? '' : ' is-empty')}
            tabIndex={-1}
            aria-label={box.isExpanded() ? `Collapse the box of line ${n}` : `Expand the box of line ${n}`}
            aria-expanded={box.isExpanded()}
            disabled={!hasBody}
            title={hasBody ? (box.isExpanded() ? 'Collapse (Alt+↑)' : 'Expand (Alt+↓)') : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onToggle(box)}
          >
            {hasBody ? (box.isExpanded() ? '▾' : '▸') : ''}
          </button>
        )}
        {label && (
          <span className={'dl-label' + (canceled ? ' is-canceled' : '')}>
            {canceled ? <s>{label}</s> : label}
            {canceled && <span className="visually-hidden"> (boxed and canceled)</span>}
          </span>
        )}
        {kind === 'problem' && fe ? (
          <div className="dl-formula dl-statement" id={`dl-f-${rowKeyOf(line)}`} onBlur={onBlur}>
            <FormulaInput
              ref={formulaRef}
              value={formula ?? ''}
              readOnly
              keypad={false}
              ariaLabel="The problem (press Enter to add a line)"
              onChange={() => undefined}
              onKeyDown={(e) => onKey(fe, e)}
              onFocus={() => onFocus(fe)}
              className="dl-formula-input"
            />
          </div>
        ) : fe ? (
          <div className="dl-formula" id={`dl-f-${rowKeyOf(line)}`} onBlur={onBlur}>
            <FormulaInput
              ref={formulaRef}
              value={formula ?? ''}
              readOnly={readOnly}
              keypad={false}
              ariaLabel={(kind === 'show' ? 'Show line ' : 'Line ') + n + ' formula'}
              invalid={!line.syntaxOk}
              onChange={(v) => {
                fe.edit(translateSymbols(v, maggie, symbols));
                onEdited();
              }}
              onKeyDown={(e) => onKey(fe, e)}
              onFocus={() => onFocus(fe)}
              className="dl-formula-input"
            />
          </div>
        ) : (
          <span className="dl-formula dl-cancel-mark" aria-hidden="true" />
        )}
        {!box.isExpanded() && kind === 'show' && hasBody && <span className="dl-collapsed muted">… {box.countLines(false) - 1} lines</span>}
      </div>
      <div className="dl-just">
        {ae ? (
          <input
            ref={justRef}
            className="input dl-just-input"
            value={ae.text}
            readOnly={readOnly}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label={'Line ' + n + ' justification'}
            placeholder={focused && !readOnly && ae.text === '' ? 'e.g. 1 2 MP' : undefined}
            onChange={(e) => {
              const el = e.currentTarget;
              ae.edit(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length);
              onEdited();
              onCursor();
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              if (document.activeElement === el) {
                ae.select(el.selectionStart ?? 0, el.selectionEnd ?? 0);
                onCursor();
              }
            }}
            onKeyDown={(e) => onKey(ae, e)}
            onFocus={() => onFocus(ae)}
            onBlur={onBlur}
          />
        ) : kind === 'show' && m.doShowLog && line.commandLog?.text ? (
          <span className="dl-log muted">{line.commandLog.text}</span>
        ) : null}
      </div>
      <div className={'dl-msg' + (message ? (isError ? ' is-error' : ' is-info') : '')} role={message && isError ? 'alert' : undefined}>
        {message && (
          <>
            <span className="dl-msg-text">{message}</span>
            {line.messageButtonVisible && (
              <button type="button" className="dl-why" title="Explain this message" aria-label={`Explain the message of line ${n}`} onClick={() => onExplain(line)}>
                ?
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function rowKeyOf(line: DerivationLine): number {
  return rowKey(line);
}

/** The FormulaInput's focus handler is its onFocus; blur of formula fields is caught by the wrapper. */
export function isEditorElement(el: Element | null): boolean {
  return el != null && el.closest('.derivation') != null && (el.classList.contains('dl-just-input') || el.closest('.dl-formula') != null);
}
