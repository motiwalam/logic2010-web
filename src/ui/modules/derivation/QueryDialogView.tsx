// The engine's dialogs (DerivationDialogs.show(QueryDialog)) on the shell's modal dialogs: the
// rule queries (which premise, which instance, the term for UI, the occurrences for EG, the
// part and the equivalence for IE ...) and the message windows, rendered from the dialog's
// blocks. The engine validates each button press (QueryDialog.press); a refused press keeps the
// dialog open (the engine has shown why in another dialog on top).

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { DerivationDialogs, DialogBlock, DialogField, QueryDialog } from '../../../engine/modules/derivation/QueryDialog';
import type { TermOccurrenceSelector } from '../../../engine/modules/derivation/TermOccurrenceSelector';
import type { HighlightedText } from '../../../engine/rules/HighlightedText';
import { expandEscapes, maggie, symbols, translateSymbols } from '../../../engine/program/symbols';
import { DialogButtons, dialogs } from '../../dialogs/dialogs';

/** A maggie formula with highlight layers, in display symbols (each layer a colour). */
export function Highlighted({ text, highlight }: { text: string; highlight: HighlightedText | null }) {
  if (highlight == null || !highlight.hasHighlights()) return <span className="formula">{translateSymbols(text, maggie, symbols)}</span>;
  // the layer of each character (the first that covers it), then runs of equal layers
  const layerAt = (i: number) => {
    const ls = highlight.layers ?? [];
    for (let k = 0; k < ls.length; k++) if (ls[k] != null && ls[k]!.contains(i)) return k;
    return -1;
  };
  const parts: ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || layerAt(i) !== layerAt(start)) {
      const layer = layerAt(start);
      const shown = translateSymbols(text.substring(start, i), maggie, symbols);
      parts.push(
        layer === -1 ? (
          <span key={start}>{shown}</span>
        ) : (
          <mark key={start} className={'hl hl-' + (layer % 6)}>
            {shown}
          </mark>
        ),
      );
      start = i;
    }
  }
  return <span className="formula">{parts}</span>;
}

function TextBlock({ text }: { text: string }) {
  return <p className="qd-text">{expandEscapes(text)}</p>;
}

/** A field of a dialog: its text is in display symbols, as the engine expects. */
function FieldInput({ field, label, autoFocus, onEnter, rerender }: { field: DialogField; label: string | null; autoFocus?: boolean; onEnter(): void; rerender(): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const sync = () => {
    const el = ref.current;
    if (el) field.select(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  };
  return (
    <label className="qd-field">
      {label && <span className="qd-field-label">{label}</span>}
      <input
        ref={ref}
        className={'input formula' + (field.editable ? '' : ' is-readonly')}
        value={field.text}
        readOnly={!field.editable}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          // typed ASCII forms show as symbols (-> is →), as in the formula fields
          const el = e.currentTarget;
          const pos = [el.selectionStart ?? 0, el.selectionEnd ?? 0];
          const value = translateSymbols(translateSymbols(el.value, symbols, maggie, pos), maggie, symbols, pos);
          field.text = value;
          field.select(pos[0], pos[1]);
          rerender();
          requestAnimationFrame(() => ref.current?.setSelectionRange(pos[0], pos[1]));
        }}
        onSelect={sync}
        onKeyUp={sync}
        onMouseUp={sync}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            sync();
            onEnter();
          }
        }}
      />
    </label>
  );
}

/** The occurrences of a term to replace by {1}: select them and press Alt+1 (or the button). */
function SelectorBlock({ selector, rerender, onEnter }: { selector: TermOccurrenceSelector; rerender(): void; onEnter(): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const place = async (i: number) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart ?? 0;
    const t = el.selectionEnd ?? s;
    await selector.insertPlaceholder(i, s, t);
    rerender();
    el.focus();
  };
  const undo = async () => {
    if (!selector.undo()) await selector.showMessage('dernot012', null);
    rerender();
    ref.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (e.altKey && digit) {
      e.preventDefault();
      const i = Number(digit[1]) - 1;
      if (i < selector.placeholderCount) void place(i);
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      void undo();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    }
  };
  return (
    <div className="qd-selector">
      <input
        ref={ref}
        className="input formula qd-selector-text"
        value={selector.text}
        readOnly
        autoFocus
        spellCheck={false}
        aria-label="Formula: select occurrences, then press Alt+1 (Ctrl+Z undoes)"
        onKeyDown={onKeyDown}
      />
      <div className="qd-selector-tools">
        {Array.from({ length: selector.placeholderCount }, (_, i) => (
          <button key={i} type="button" className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={() => void place(i)} title={`Replace the selection by {${i + 1}} (Alt+${i + 1})`}>
            Replace selection by {`{${i + 1}}`}
          </button>
        ))}

      </div>
      <dl className="qd-values">
        {selector.values.map((v, i) => (
          <div key={i}>
            <dt>{`{${i + 1}}`}</dt>
            <dd className="formula">{v ?? <span className="muted">not chosen yet</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Block({ block, d, rerender, onEnter, first }: { block: DialogBlock; d: QueryDialog; rerender(): void; onEnter(): void; first: boolean }) {
  switch (block.type) {
    case 'text':
      return <TextBlock text={block.text} />;
    case 'formula':
      return (
        <div className="qd-formula">
          <Highlighted text={block.text} highlight={block.highlight} />
        </div>
      );
    case 'choices':
      return (
        <fieldset className="choice-list">
          <legend className="visually-hidden">Choices</legend>
          {block.options.map((o, i) =>
            o.enabled ? (
              <label key={i} className={'choice' + (d.choice === i ? ' is-selected' : '')}>
                <input
                  type="radio"
                  name={'qd-' + d.lineNumber}
                  checked={d.choice === i}
                  autoFocus={d.choice === i}
                  onChange={() => {
                    d.choice = i;
                    rerender();
                  }}
                  onDoubleClick={() => {
                    d.choice = i;
                    onEnter();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onEnter();
                    }
                  }}
                />
                <span className="choice-label">{o.highlight != null ? <Highlighted text={o.text} highlight={o.highlight} /> : <span className="formula">{o.text}</span>}</span>
              </label>
            ) : null,
          )}
        </fieldset>
      );
    case 'field':
      return <FieldInput field={block.field} label={block.label} autoFocus={first && block.field.editable} onEnter={onEnter} rerender={rerender} />;
    case 'substitution': {
      let focused = false;
      return (
        <div className="qd-subst" role="group" aria-label="Substitution">
          {block.rows.map((r, i) => {
            const auto = first && r.field.editable && !focused;
            if (auto) focused = true;
            return (
              <div key={i} className="qd-subst-row">
                <span className="formula qd-subst-label">
                  {r.labelHighlight != null && !r.labelHighlight.isEmpty() ? <mark className="hl hl-0">{r.label}</mark> : r.label}
                </span>
                <span aria-hidden="true">⟼</span>
                <FieldInput field={r.field} label={null} autoFocus={auto} onEnter={onEnter} rerender={rerender} />
              </div>
            );
          })}
        </div>
      );
    }
    case 'selector':
      return <SelectorBlock selector={block.selector} rerender={rerender} onEnter={onEnter} />;
  }
}

/** The body of a rule query or message window. */
function QueryDialogBody({ d, done }: { d: QueryDialog; done: () => void }) {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const rerender = () => setTick((n) => n + 1);
  const press = async (i: number) => {
    if (busy) return;
    setBusy(true);
    try {
      if (await d.press(i)) done();
      else rerender();
    } finally {
      setBusy(false);
    }
  };
  const def = d.defaultButton >= 0 && d.defaultButton < d.buttons.length ? d.defaultButton : 0;
  const firstInput = d.blocks.findIndex((b) => b.type === 'field' || b.type === 'substitution' || b.type === 'selector' || b.type === 'choices');
  return (
    <div className={'qd qd-' + d.kind}>
      {d.blocks.map((b, i) => (
        <Block key={i} block={b} d={d} rerender={rerender} onEnter={() => void press(def)} first={i === firstInput} />
      ))}
      <DialogButtons>
        {d.buttons.map((label, i) => (
          <button
            key={i}
            type="button"
            className={i === def ? 'btn btn-primary' : 'btn'}
            autoFocus={firstInput === -1 && i === def}
            disabled={busy}
            onClick={() => void press(i)}
          >
            {label}
          </button>
        ))}
      </DialogButtons>
    </div>
  );
}

const TITLES: Partial<Record<QueryDialog['kind'], string>> = {
  chooseFormula: 'Choose',
  chooseRuleInstance: 'Which application?',
  chooseSideToShow: 'Choose a formula',
  instanceSchemeQuery: 'Complete the instance',
  universalTermQuery: 'Universal instantiation',
  existentialVarQuery: 'Existential instantiation',
  dummyVarQuery: 'Existential generalization',
  generalizationTermQuery: 'Existential generalization',
  leibniz12TermQuery: "Leibniz's law",
  leibniz34TermQuery: "Leibniz's law",
  eulerTermQuery: "Euler's law",
  interchangeFormulaQuery: 'Interchange of equivalents',
  interchangeRuleQuery: 'Interchange of equivalents',
  cieRuleQuery: 'Conditional interchange',
  renameBinders: 'Bound variables',
};

/** The UI side of the engine's DerivationDialogs. */
export function uiDerivationDialogs(): DerivationDialogs {
  return {
    async show(d: QueryDialog): Promise<void> {
      const title =
        d.kind === 'message'
          ? d.isError
            ? d.lineNumber > 0
              ? `Line ${d.lineNumber}`
              : 'Error'
            : 'Note'
          : (TITLES[d.kind] ?? d.title) + (d.lineNumber > 0 ? ` — line ${d.lineNumber}` : '');
      const how = await dialogs.open<'closed' | 'dismissed'>((close) => <QueryDialogBody d={d} done={() => close('closed')} />, {
        title,
        dismissValue: 'dismissed',
        tone: d.kind === 'message' ? (d.isError ? 'error' : 'info') : 'neutral',
        size: d.kind === 'chooseRuleInstance' || d.kind === 'message' ? 'large' : 'medium',
      });
      if (how === 'dismissed') d.close();
    },
  };
}
