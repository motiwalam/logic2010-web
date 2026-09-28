// The truth table (the desktop's TruthTableGrid), a cell's evaluation tree in its two forms
// (TruthValueTree: the tree, and the mirror tree inline under the formula), and the setup
// stage (TruthTableSetupPanel).
//
// Keyboard: in the table the arrow keys move between cells (the cell under the focus is the
// one being edited); T and F fill the cell's tree bottom-up (the next unset subformula), ?
// or Backspace clears the last value set; X checks the row as the counterexample; Enter or
// Escape closes the cell.

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LPTruthAnalysis } from '../../../engine/modules/truth/LPTruthAnalysis';
import type { TruthTableCell } from '../../../engine/modules/truth/TruthTableCell';
import type { TruthValueTree } from '../../../engine/modules/truth/TruthValueTree';
import { ConnectiveFormula } from '../../../engine/formula/Expression';
import { maggie, symbols, translateSymbols } from '../../../engine/program/symbols';
import { FormulaText } from '../../components/FormulaText';

const show = (s: string) => translateSymbols(s, maggie, symbols);

/** "(A)" -> "A" when the parentheses enclose the whole text. */
function stripOuterParens(s: string): string {
  if (!s.startsWith('(') || !s.endsWith(')')) return s;
  let depth = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return s;
  }
  return s.slice(1, -1);
}

/** The nodes in the order a student fills them: children before their parent, unlocked only. */
export function fillOrder(tree: TruthValueTree): TruthValueTree[] {
  const out: TruthValueTree[] = [];
  const walk = (t: TruthValueTree) => {
    for (const c of t.children) walk(c);
    if (!t.locked && t.parseNode != null) out.push(t);
  };
  walk(tree);
  return out;
}

/** Sets a node (by its preorder index) and shows the tree's value on the cell at once. */
export function setNode(m: LPTruthAnalysis, cell: TruthTableCell, node: TruthValueTree, value: number): void {
  const index = cell.valueTree.nodes().indexOf(node);
  m.setNodeValue(cell.row, cell.col, index, value);
  cell.commitTreeValue();
  m.notifyChanged();
}

/** T/F/? typed on a cell: the next unset subformula (or the whole formula when all are set). */
export function typeValue(m: LPTruthAnalysis, cell: TruthTableCell, key: 'T' | 'F' | '?'): void {
  const order = fillOrder(cell.valueTree);
  if (order.length === 0) return;
  if (key === '?') {
    const last = [...order].reverse().find((n) => n.selectedIndex !== -1);
    if (last) setNode(m, cell, last, -1);
    return;
  }
  const next = order.find((n) => n.selectedIndex === -1) ?? order[order.length - 1];
  setNode(m, cell, next, key === 'T' ? 0 : 1);
}

function valueClass(t: TruthValueTree, readOnly: boolean): string {
  return 'tv-value' + (t.locked ? ' is-locked' : '') + (t.errorShown ? ' is-wrong' : '') + (readOnly ? ' is-readonly' : '') + (t.selectedIndex >= 0 ? ' is-set' : '');
}

function ValueButton({ m, cell, t, readOnly }: { m: LPTruthAnalysis; cell: TruthTableCell; t: TruthValueTree; readOnly: boolean }) {
  const v = t.getDisplayText();
  const cycle = () => setNode(m, cell, t, t.selectedIndex === -1 ? 0 : t.selectedIndex === 0 ? 1 : -1);
  const onKey = (e: KeyboardEvent) => {
    const k = e.key.toUpperCase();
    if (k === 'T' || k === 'F' || k === '?' || e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      setNode(m, cell, t, k === 'T' ? 0 : k === 'F' ? 1 : -1);
    }
  };
  if (t.locked || readOnly) {
    return (
      <span className={valueClass(t, true)} title={t.locked ? 'A sentence letter: its value is the row’s' : undefined}>
        {v}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={valueClass(t, false)}
      aria-label={`${show(t.getFormulaText())}: ${v === '?' ? 'no value' : v === 'T' ? 'true' : 'false'}${t.errorShown ? ' (wrong)' : ''}`}
      onClick={cycle}
      onKeyDown={onKey}
    >
      {v}
    </button>
  );
}

/** The evaluation tree (the desktop's valueTree). */
export function TreeForm({ m, cell, t, readOnly }: { m: LPTruthAnalysis; cell: TruthTableCell; t: TruthValueTree; readOnly: boolean }) {
  return (
    <div className="tv-node">
      <div className="tv-label">
        <span className="tv-formula formula">{show(t.parent == null ? stripOuterParens(t.getFormulaText()) : t.getFormulaText())}</span>
        <ValueButton m={m} cell={cell} t={t} readOnly={readOnly} />
      </div>
      {t.children.length > 0 && (
        <div className="tv-children">
          {t.children.map((c, i) => (
            <TreeForm key={i} m={m} cell={cell} t={c} readOnly={readOnly} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The inline form (the desktop's mirrorTree): the formula with each value under its connective. */
export function InlineForm({ m, cell, t, readOnly, top = true }: { m: LPTruthAnalysis; cell: TruthTableCell; t: TruthValueTree; readOnly: boolean; top?: boolean }): ReactNode {
  const e = t.getExpression();
  const col = (text: string, value: ReactNode, key: string | number, cls = '') => (
    <span key={key} className={'tv-col ' + cls}>
      <span className="tv-col-text formula">{text}</span>
      <span className="tv-col-value">{value}</span>
    </span>
  );
  if (!(e instanceof ConnectiveFormula) || t.children.length === 0) {
    return col(show(t.getFormulaText()), <ValueButton m={m} cell={cell} t={t} readOnly={readOnly} />, 'leaf', 'is-leaf');
  }
  const op = col(show(e.getSymbol()), <ValueButton m={m} cell={cell} t={t} readOnly={readOnly} />, 'op', 'is-op');
  const parts: ReactNode[] = [];
  if (t.children.length === 1) {
    parts.push(op, <InlineForm key="a" m={m} cell={cell} t={t.children[0]} readOnly={readOnly} top={false} />);
  } else {
    if (!top) parts.push(col('(', null, 'l', 'is-paren'));
    parts.push(<InlineForm key="a" m={m} cell={cell} t={t.children[0]} readOnly={readOnly} top={false} />, op, <InlineForm key="b" m={m} cell={cell} t={t.children[1]} readOnly={readOnly} top={false} />);
    if (!top) parts.push(col(')', null, 'r', 'is-paren'));
  }
  return (
    <span className={top ? 'tv-inline' : 'tv-group'} key="g">
      {parts}
    </span>
  );
}

/** The editor of the selected cell: both forms of its tree. */
export function CellEditor({ m, readOnly }: { m: LPTruthAnalysis; readOnly: boolean }) {
  const cell = m.problem.table.getSelectedCell();
  if (cell == null) {
    return (
      <div className="tt-editor is-empty">
        <p className="muted small">Choose a cell of the table to work out its value: give each part of the formula a value, from the sentence letters up.</p>
      </div>
    );
  }
  const p = m.problem;
  const colName = cell.col < p.premiseCount ? `Premise ${cell.col + 1}` : p.argument != null && !p.argument.conclusionOnly ? 'Conclusion' : 'Formula';
  return (
    <div className="tt-editor" aria-label="Cell editor">
      <div className="tt-editor-head">
        <span>
          <strong>{colName}</strong>, row <span className="formula">{p.table.getRowLabel(cell.row)}</span>
        </span>
        {!readOnly && (
          <button type="button" className="btn btn-small" onClick={() => m.commitSelectedCell()}>
            OK
          </button>
        )}
      </div>
      <div className="tv-tree">
        <TreeForm m={m} cell={cell} t={cell.valueTree} readOnly={readOnly} />
      </div>
      <div className="tv-mirror" aria-label="Inline form">
        <InlineForm m={m} cell={cell} t={cell.valueTree} readOnly={readOnly} />
      </div>
      {!readOnly && <p className="muted small tt-keys">Keys: T, F fill the next part from the bottom up; ? or Backspace takes back the last; arrows move between cells.</p>}
    </div>
  );
}

/** The table. */
export function TruthTableView({ m, readOnly }: { m: LPTruthAnalysis; readOnly: boolean }) {
  const p = m.problem;
  const g = p.table;
  const tableRef = useRef<HTMLTableElement>(null);
  const sel = g.selectedCell;
  const headers = g.getHeaderLabels();
  const formulas: (string | null)[] = [];
  if (p.argument) {
    for (let j = 0; j < p.premiseCount; j++) formulas.push(p.argument.premiseTexts[j] ?? null);
    formulas.push(p.argument.conclusionText);
  }

  // keep the keyboard focus on the selected cell
  useEffect(() => {
    if (sel == null) return;
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${sel.row}-${sel.col}"]`);
    if (el && tableRef.current?.contains(document.activeElement) && document.activeElement !== el) el.focus();
  }, [sel]);

  const move = (row: number, col: number) => {
    const r = Math.max(0, Math.min(g.rowCount - 1, row));
    const c = Math.max(0, Math.min(p.premiseCount, col));
    m.setCellSelected(r, c, true);
    tableRef.current?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`)?.focus();
  };

  const onKey = (e: KeyboardEvent, cell: TruthTableCell) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    let handled = true;
    if (k === 'ArrowUp') move(cell.row - 1, cell.col);
    else if (k === 'ArrowDown') move(cell.row + 1, cell.col);
    else if (k === 'ArrowLeft') move(cell.row, cell.col - 1);
    else if (k === 'ArrowRight') move(cell.row, cell.col + 1);
    else if (k === 'Home') move(cell.row, 0);
    else if (k === 'End') move(cell.row, p.premiseCount);
    else if (k === 'Enter' || k === 'Escape') {
      if (sel != null) m.commitSelectedCell();
      else if (k === 'Enter') move(cell.row, cell.col);
    } else if (readOnly) handled = false;
    else if (k === 't' || k === 'T' || k === 'f' || k === 'F') {
      if (sel == null || sel.row !== cell.row || sel.col !== cell.col) m.setCellSelected(cell.row, cell.col, true);
      typeValue(m, cell, k.toUpperCase() as 'T' | 'F');
    } else if (k === '?' || k === 'Backspace' || k === 'Delete') typeValue(m, cell, '?');
    else if ((k === 'x' || k === 'X') && g.hasCounterexampleColumn()) m.setCounterexample(cell.row, g.counterexampleRow !== cell.row);
    else handled = false;
    if (handled) e.preventDefault();
  };

  if (g.rowCount === 0) return <p className="muted">This problem has no sentence letters, so there is no table.</p>;
  return (
    <div className="tt-scroll">
      <table className="tt-table" ref={tableRef} aria-label="Truth table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} scope="col" className={i < p.letterCount ? 'tt-letter' + (i === p.letterCount - 1 ? ' tt-last-letter' : '') : 'tt-formula-col'}>
                <span className="formula">{h}</span>
                {i >= p.letterCount && formulas[i - p.letterCount] != null && (
                  <span className="tt-col-formula">
                    <FormulaText value={formulas[i - p.letterCount]!} />
                  </span>
                )}
              </th>
            ))}
            {g.hasCounterexampleColumn() && (
              <th scope="col" className="tt-ce-col" title="Check the row that shows the argument invalid (all premises true, the conclusion false)">
                Counter&shy;example
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {g.cells.map((row, r) => {
            const label = g.getRowLabel(r);
            return (
              <tr key={r} className={g.counterexampleRow === r ? 'is-counterexample' : undefined}>
                {[...label].map((c, i) => (
                  <th key={i} scope="row" className={'tt-letter' + (i === p.letterCount - 1 ? ' tt-last-letter' : '')}>
                    {c}
                  </th>
                ))}
                {row.map((cell, c) => {
                  const selected = sel != null && sel.row === r && sel.col === c;
                  return (
                    <td key={c} className="tt-cell-td">
                      <button
                        type="button"
                        data-cell={`${r}-${c}`}
                        className={'tt-cell' + (selected ? ' is-selected' : '') + (cell.showsError() ? ' is-wrong' : '') + (cell.text === '?' ? ' is-empty' : '')}
                        tabIndex={selected || (sel == null && r === 0 && c === 0) ? 0 : -1}
                        aria-pressed={selected}
                        aria-label={`${headers[p.letterCount + c]}, row ${label}: ${cell.text === '?' ? 'no value' : cell.text}${cell.showsError() ? ', wrong' : ''}`}
                        onClick={() => m.clickCell(r, c)}
                        onKeyDown={(e) => onKey(e, cell)}
                      >
                        {cell.text}
                      </button>
                    </td>
                  );
                })}
                {g.hasCounterexampleColumn() && (
                  <td className="tt-ce">
                    <input
                      type="checkbox"
                      aria-label={`Row ${label} is a counterexample`}
                      checked={g.counterexampleRow === r}
                      disabled={readOnly}
                      onChange={(e) => m.setCounterexample(r, e.target.checked)}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The setup stage: the letters and the number of rows, then the rows' letter values. */
export function SetupView({ m, readOnly, onOk }: { m: LPTruthAnalysis; readOnly: boolean; onOk: () => void }) {
  const p = m.problem;
  const sp = p.setupPanel;
  if (sp == null) return null;
  const stage = sp.lettersEntered ? 1 : p.setupStage;
  return (
    <section className="tt-setup" aria-label="Set up the table">
      <p className="tt-setup-prompt">{p.getSetupPrompt()}</p>
      {!sp.lettersEntered && stage === 0 ? (
        <form
          className="tt-setup-fields"
          onSubmit={(e) => {
            e.preventDefault();
            onOk();
          }}
        >
          <label>
            <span>Sentence letters</span>
            <input className="input formula" value={sp.lettersText} placeholder="P.Q.R" disabled={readOnly} onChange={(e) => m.setSetupFields(e.target.value, sp.rowCountText)} />
          </label>
          <label>
            <span>Number of rows</span>
            <input className="input" inputMode="numeric" value={sp.rowCountText} size={5} disabled={readOnly} onChange={(e) => m.setSetupFields(sp.lettersText, e.target.value)} />
          </label>
          {!readOnly && (
            <button type="submit" className="btn btn-primary">
              OK
            </button>
          )}
        </form>
      ) : (
        <>
          <table className="tt-table tt-setup-grid">
            <thead>
              <tr>
                {sp.getHeaderLabels().map((h, i) => (
                  <th key={i} scope="col" className="formula">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sp.choosers.map((row, r) => (
                <tr key={r}>
                  {row.map((v, j) => (
                    <td key={j}>
                      <button
                        type="button"
                        className={'tt-cell' + (sp.choiceShowsError(r, j) ? ' is-wrong' : '') + (v === -1 ? ' is-empty' : '')}
                        disabled={readOnly}
                        aria-label={`Row ${r + 1}, letter ${j + 1}: ${v === -1 ? 'no value' : v === 0 ? 'T' : 'F'}`}
                        onClick={() => m.setSetupChoice(r, j, v === -1 ? 0 : v === 0 ? 1 : -1)}
                        onKeyDown={(e) => {
                          const k = e.key.toUpperCase();
                          if (k === 'T' || k === 'F' || k === '?' || e.key === 'Backspace') {
                            e.preventDefault();
                            m.setSetupChoice(r, j, k === 'T' ? 0 : k === 'F' ? 1 : -1);
                            const next = (e.currentTarget.closest('td')?.nextElementSibling ?? e.currentTarget.closest('tr')?.nextElementSibling?.firstElementChild)?.querySelector('button');
                            if (k !== '?' && e.key !== 'Backspace') next?.focus();
                          }
                        }}
                      >
                        {v === -1 ? '?' : v === 0 ? 'T' : 'F'}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly && (
            <button type="button" className="btn btn-primary" onClick={onOk}>
              OK
            </button>
          )}
        </>
      )}
    </section>
  );
}
