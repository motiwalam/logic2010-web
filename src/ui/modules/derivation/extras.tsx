// The derivation screen's other windows: a line message's explanation (the "?" button, with
// its actions), the Inference Rules list, the Strategic Advice outline, the keyboard summary,
// and a derivation as printed text.

import { useState } from 'react';
import type { OutlineNode } from '../../../engine/data/OutlineNode';
import type { DerivationLine } from '../../../engine/modules/derivation/DerivationLine';
import type { DerivationWorkspace } from '../../../engine/modules/derivation/DerivationWorkspace';
import { inferenceRules } from '../../../engine/modules/derivation/inferenceRules';
import type { LPDerivation } from '../../../engine/modules/derivation/LPDerivation';
import { expandEscapes, maggie, symbols, translateSymbols } from '../../../engine/program/symbols';
import { formatShortcut } from '../../components/shortcuts';
import { DialogButtons, dialogs } from '../../dialogs/dialogs';
import { buildRows, lineKind } from './DerivationEditor';

/** The "?" of a line's message: the explanation and the message's buttons (Replace, Check again ...). */
export async function explainLine(line: DerivationLine, run: (op: () => unknown) => Promise<void>): Promise<void> {
  const message = line.message;
  const handler = line.messageButton.handler;
  const labels = handler ? handler.getLabels() : ['OK'];
  const actions = handler ? handler.actions : [null];
  const index = await dialogs.open<number>(
    (close) => (
      <>
        <p className={'dl-explain-title ' + (line.shownIsError ? 'is-error' : 'is-info')}>{line.getShownMessage()}</p>
        <p className="msg-explanation">{expandEscapes(line.messageButton.explanation)}</p>
        {message && <p className="muted small">Message {message.id}</p>}
        <DialogButtons>
          {labels.map((label, i) => (
            <button key={i} type="button" className={i === 0 ? 'btn btn-primary' : 'btn'} autoFocus={i === 0} onClick={() => close(i)}>
              {label}
            </button>
          ))}
        </DialogButtons>
      </>
    ),
    { title: `Line ${line.getLineNumber()}`, dismissValue: -1, tone: line.shownIsError ? 'error' : 'info', size: 'medium' },
  );
  if (index >= 0 && handler && actions[index] != null) {
    const action = actions[index]!;
    await run(() => handler.perform(action.toLowerCase()));
  }
}

/** The Inference Rules list: every rule and theorem, ticked when usable (in this derivation, or with IE). */
export function showInferenceRules(ws: DerivationWorkspace, m: LPDerivation | null): void {
  const list = inferenceRules(ws, m);
  void dialogs.open<null>(
    (close) => <RulesList list={list} close={() => close(null)} />,
    { title: list.title, dismissValue: null, size: 'large' },
  );
}

function RulesList({ list, close }: { list: ReturnType<typeof inferenceRules>; close(): void }) {
  const [query, setQuery] = useState('');
  const [onlyTicked, setOnlyTicked] = useState(false);
  const q = query.trim().toLowerCase();
  const items = list.items.filter((it) => {
    if (it.type === 'heading') return q === '' && !onlyTicked;
    if (onlyTicked && !it.ticked) return false;
    return q === '' || it.name.toLowerCase().includes(q) || translateSymbols(it.form, maggie, symbols).toLowerCase().includes(q);
  });
  return (
    <div className="rules-list">
      <div className="rules-list-tools">
        <input className="input" type="search" placeholder="Search rules" aria-label="Search rules" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <label className="check-inline">
          <input type="checkbox" checked={onlyTicked} onChange={(e) => setOnlyTicked(e.target.checked)} /> only ticked
        </label>
      </div>
      <div className="rules-list-rows">
        {items.map((it, i) =>
          it.type === 'heading' ? (
            it.text.trim() === '' ? null : (
              <h3 key={i} className="rules-list-heading">
                {it.text}
              </h3>
            )
          ) : (
            <div key={i} className={'rules-list-row' + (it.ticked ? ' is-ticked' : '')}>
              <span className="rules-list-tick" aria-label={it.ticked ? 'ticked' : undefined}>
                {it.ticked ? '✓' : ''}
              </span>
              <span className="rules-list-name">{it.name}</span>
              <span className="formula">{translateSymbols(it.form, maggie, symbols)}</span>
            </div>
          ),
        )}
      </div>
      <p className="muted small">✓ {list.legend}</p>
      <DialogButtons>
        <button type="button" className="btn btn-primary" onClick={close}>
          Close
        </button>
      </DialogButtons>
    </div>
  );
}

/** Strategic Advice (derivation-tips.rec): the outline, collapsible. */
export function showAdvice(root: OutlineNode | null): void {
  void dialogs.open<null>(
    (close) => (
      <div className="advice">
        {root == null ? <p>The advice file could not be read.</p> : <AdviceNode node={root} top />}
        <DialogButtons>
          <button type="button" className="btn btn-primary" onClick={() => close(null)}>
            Close
          </button>
        </DialogButtons>
      </div>
    ),
    { title: 'Strategic Advice', dismissValue: null, size: 'large' },
  );
}

function AdviceNode({ node, top }: { node: OutlineNode; top?: boolean }) {
  const children = node.children.map((c, i) => <AdviceNode key={i} node={c} />);
  if (top) {
    return (
      <div className="advice-root">
        {node.text.trim() !== '' && <p className="advice-text">{node.text}</p>}
        {children}
      </div>
    );
  }
  const head = (
    <>
      <span className="advice-mark">{node.title}</span> <span className="advice-line">{node.text}</span>
    </>
  );
  if (node.children.length === 0) return <div className="advice-leaf">{head}</div>;
  return (
    <details className="advice-node" open={node.expanded}>
      <summary>{head}</summary>
      <div className="advice-body">{children}</div>
    </details>
  );
}

export const KEYS: [string, string][] = [
  ['Enter', 'A new line below. With the formula left empty, the line is checked first and its rule fills the formula in; a rule that closes the box (CD, ID, DD, UD, BD) boxes and cancels it'],
  ['Shift+Enter', 'Clear the formula and check the line again (the rule fills it in)'],
  ['Ctrl+Enter', 'Clear the formula, check, and start a new line'],
  ['Alt+Enter', 'A new line without checking'],
  ['Tab', 'Between the formula and the justification'],
  ['↑ / ↓', 'The line above / below'],
  ['Mod+Shift+S or Alt+S', 'Make the line a Show line, or a Show line an ordinary line (also: type “Show P”)'],
  ['Mod+Shift+X or Alt+X', 'Box and cancel the box at this line, or uncancel'],
  ['Alt+Delete', 'Delete the line (Alt+Shift+Delete on a Show line: the lines after it too)'],
  ['Alt+→ / Alt+←', 'Move this and the following lines into the open box above / out of their box'],
  ['Alt+↑ / Alt+↓', 'On a Show line: collapse / expand its box'],
  ['Mod+K', 'Check the whole derivation'],
  ['Mod+S', 'Save'],
  ['Mod+O', 'Choose a problem'],
  ['Alt+N / Alt+↓ (outside the lines)', 'Next problem'],
  ['Mod+Shift+A, B, C, D, E, I, N, O, T, U', 'In a formula: ∧ ↔ → ℩ ∃ ≠ ∼ ∨ ∴ ∀ (or Alt+letter)'],
];

export function showKeys(): void {
  void dialogs.open<null>(
    (close) => (
      <div className="keys-help">
        <table className="keys-table">
          <tbody>
            {KEYS.map(([k, what]) => (
              <tr key={k}>
                <th scope="row">
                  <kbd>{k.replace(/Mod\+/g, formatShortcut('Mod+X').replace(/X$/, ''))}</kbd>
                </th>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          A justification lists the lines it cites and the rule: <code>1 2 MP</code>, <code>PR2</code>, <code>ASS CD</code>, <code>3 CD</code>. Steps can be chained (<code>1 S 2 MP</code>);{' '}
          <code>MP[Q]</code> says what a step gives; <code>UI/a</code> answers the rule’s question; <code>-2</code> cites the line two up.
        </p>
        <DialogButtons>
          <button type="button" className="btn btn-primary" onClick={() => close(null)} autoFocus>
            Close
          </button>
        </DialogButtons>
      </div>
    ),
    { title: 'Keyboard', dismissValue: null, size: 'large' },
  );
}

/** A derivation as printed text (every box expanded). */
export function PrintedDerivation({ m, status }: { m: LPDerivation; status?: string }) {
  const rows = buildRows(m);
  return (
    <>
    {status ? <p className="pd-status">{status}</p> : null}
    <table className="printed-derivation">
      <tbody>
        {rows.map((r, i) => {
          const l = r.line;
          const kind = lineKind(l);
          if (kind === 'problem') return null;
          const canceled = kind === 'show' && l.box.cancelLine != null;
          return (
            <tr key={i}>
              <td className="pd-num">{l.getLineNumber()}</td>
              <td className="pd-formula" style={{ paddingLeft: `${r.rails.length * 1.4}em` }}>
                {kind === 'show' && <span className="pd-show">{canceled ? <s>Show</s> : 'Show'} </span>}
                <span className="formula">{kind === 'cancel' ? '' : translateSymbols(l.getFormulaText(false) ?? '', maggie, symbols)}</span>
              </td>
              <td className="pd-just">{l.annotationEditor?.text ?? ''}</td>
              <td className={'pd-msg' + (l.shownIsError ? ' is-error' : '')}>{l.getShownMessage()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </>
  );
}
