// The Stack and Applicable panels (the desktop's DerivationStackView and DerivationRulesView,
// see the README of the desktop program): the stack of the justification at the caret, and the
// rules that could be the next step there with what they give. Both follow the caret; they run
// the steps without dialogs and change nothing. Clicking a rule types it into the justification.

import { useEffect, useState } from 'react';
import type { DerivationLine } from '../../../engine/modules/derivation/DerivationLine';
import { type Applicable, rulesViewData, type RulesViewData, UNKNOWNS_NOTE } from '../../../engine/modules/derivation/DerivationRulesView';
import { stackViewData, type StackViewData } from '../../../engine/modules/derivation/DerivationStackView';
import type { LPDerivation } from '../../../engine/modules/derivation/LPDerivation';
import { HeadlessDialogs } from '../../../engine/modules/derivation/QueryDialog';
import { maggie, symbols, translateSymbols } from '../../../engine/program/symbols';

/** The line and caret the panels follow: the justification last focused. */
export function cursorLine(m: LPDerivation): { line: DerivationLine; caret: number } | null {
  const e = m.lastFocus;
  if (e == null || e.line.annotationEditor == null) return null;
  const text = e.line.annotationEditor.text;
  return { line: e.line, caret: e.isAnnotation() ? e.caretPosition : text.length };
}

/** Runs a computation of the views with no dialogs (they may otherwise show validation messages). */
async function quietly<T>(m: LPDerivation, f: () => Promise<T>): Promise<T> {
  // one computation at a time: each saves and restores the module state it changes
  // (serialMode, the dialogs), so two interleaved ones would restore each other's
  const before = chains.get(m) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  chains.set(m, before.then(() => mine));
  await before;
  const saved = m.dialogs;
  m.dialogs = new HeadlessDialogs();
  try {
    return await f();
  } finally {
    m.dialogs = saved;
    release();
  }
}

const chains = new WeakMap<LPDerivation, Promise<void>>();

function useComputed<T>(m: LPDerivation, key: string, busy: () => boolean, compute: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (busy()) {
      const t = setTimeout(() => setRetry((n) => n + 1), 150);
      return () => clearTimeout(t);
    }
    let live = true;
    void quietly(m, compute)
      .then((v) => live && setValue(v))
      .catch(() => live && setValue(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry]);
  return value;
}

export function StackPanel({ m, stateKey, busy }: { m: LPDerivation; stateKey: string; busy: () => boolean }) {
  const cur = cursorLine(m);
  const data = useComputed<StackViewData>(m, stateKey, busy, () => stackViewData(cur?.line ?? null, null, cur?.caret ?? null));
  return (
    <section className="side-panel stack-panel" aria-label="Stack at the cursor">
      <h2 className="side-title">Stack at the cursor</h2>
      {data == null ? null : (
        <>
          <p className="side-note">{data.heading}</p>
          {data.emptyNote && <p className="side-note muted">{data.emptyNote}</p>}
          <ol className="stack-rows">
            {data.rows.map((r, i) => (
              <li key={i} className={'stack-row' + (r.top ? ' is-top' : '')}>
                <span className="formula">{r.formula}</span>
                <span className="stack-origin">{r.origin}</span>
              </li>
            ))}
          </ol>
          {data.snapshot?.error && <p className="side-error">{data.snapshot.error}</p>}
        </>
      )}
    </section>
  );
}

/** A result with its unknowns (?P, ?t ...) marked. */
function Result({ a }: { a: Applicable }) {
  if (!a.formula) return <span className="rule-desc">{a.result}</span>;
  const shown = translateSymbols(a.result, maggie, symbols);
  const parts = shown.split(/(\?[A-Za-z]\d*)/);
  return (
    <span className="formula">
      {parts.map((p, i) => (/^\?[A-Za-z]\d*$/.test(p) ? <i key={i} className="unknown">{p}</i> : <span key={i}>{p}</span>))}
    </span>
  );
}

function RuleRow({ a, onUse, readOnly }: { a: Applicable; onUse(a: Applicable): void; readOnly: boolean }) {
  const tip = a.details().replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return (
    <li className={'rule-row' + (a.lock != null ? ' is-locked' : '') + (a.matchesLine ? ' matches-line' : '')}>
      <button type="button" className="rule-use" disabled={readOnly || a.command == null} title={tip} onMouseDown={(e) => e.preventDefault()} onClick={() => onUse(a)}>
        <span className="rule-name">{a.rule}</span>
        <Result a={a} />
        {a.matchesLine && <span className="rule-match">= line</span>}
      </button>
      {a.lock && <span className="rule-lock">{a.lock}</span>}
      <details className="rule-details">
        <summary aria-label={`Details of ${a.rule}`}>i</summary>
        <div className="rule-details-body">
          {tip.split('\n').map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
      </details>
    </li>
  );
}

export function RulesPanel({ m, stateKey, busy, onUse, readOnly }: { m: LPDerivation; stateKey: string; busy: () => boolean; onUse(a: Applicable, line: DerivationLine, caret: number): void; readOnly: boolean }) {
  const cur = cursorLine(m);
  const data = useComputed<RulesViewData>(m, stateKey, busy, () => rulesViewData(cur?.line ?? null, null, cur?.caret ?? null));
  const use = (a: Applicable) => cur && onUse(a, cur.line, cur.caret);
  return (
    <section className="side-panel rules-panel" aria-label="Rules at the cursor">
      <h2 className="side-title">Rules at the cursor</h2>
      {data == null ? null : (
        <>
          <p className="side-note">{data.heading}</p>
          {data.notes.map((n, i) => (
            <p key={i} className={data.result?.error ? 'side-error' : 'side-note muted'}>
              {n}
            </p>
          ))}
          <ul className="rule-rows">
            {data.available.map((a, i) => (
              <RuleRow key={i} a={a} onUse={use} readOnly={readOnly} />
            ))}
          </ul>
          {data.locked.length > 0 && (
            <>
              <h3 className="side-sub">Not allowed here</h3>
              <ul className="rule-rows">
                {data.locked.map((a, i) => (
                  <RuleRow key={i} a={a} onUse={use} readOnly={readOnly} />
                ))}
              </ul>
            </>
          )}
          {data.stackOperations.length > 0 && (
            <>
              <h3 className="side-sub">Stack operations</h3>
              <ul className="rule-rows">
                {data.stackOperations.map((a, i) => (
                  <RuleRow key={i} a={a} onUse={use} readOnly={readOnly} />
                ))}
              </ul>
            </>
          )}
          {data.line != null && data.result != null && data.result.error == null && data.result.closed == null && <p className="side-note muted small">{UNKNOWNS_NOTE}</p>}
        </>
      )}
    </section>
  );
}
