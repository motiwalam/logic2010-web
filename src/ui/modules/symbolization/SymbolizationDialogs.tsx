// The Symbolization dialogs: an error or hint about a node (with Up / Text / Symb), the
// scheme editor (with Browse), and the Answer Manager.

import { useState } from 'react';
import {
  type AnswerManager,
  type LPSymbolizer,
  type NodeMessage,
  SchemeEditor,
} from '../../../engine/modules/symbolization';
import { Message } from '../../../engine/program/Message';
import { symModule } from '../../../engine/program/ModuleConstants';
import { expandEscapes } from '../../../engine/program/symbols';
import { DialogHandler } from '../../../engine/program/DialogHandler';
import { dialogs, DialogButtons } from '../../dialogs/dialogs';
import { pickProblems, symbolizationUi } from './support';

// ---- errors and hints ----

/** Shows an error or hint message; its buttons act on the tree and keep the dialog open. */
export function showNodeMessage(msg: NodeMessage, hint: boolean): Promise<void> {
  return dialogs.open<void>((close) => <NodeMessageBody msg={msg} close={close} />, {
    title: hint ? 'Hint' : msg.id.toLowerCase() === 'symerr003' ? 'Binding error' : 'Error in this part',
    dismissValue: undefined,
    tone: hint ? 'info' : 'error',
    size: 'medium',
  });
}

function NodeMessageBody({ msg, close }: { msg: NodeMessage; close: () => void }) {
  const [, setTick] = useState(0);
  const [beep, setBeep] = useState(false);
  const act = async (action: string | null) => {
    if (action == null || action === 'ok') {
      close();
      return;
    }
    let answer: string | null = null;
    if (action === 'symb') {
      const prompt = msg.symbPrompt();
      if (prompt != null) answer = await symbolizationUi.askForSymbol(prompt, msg.target);
    }
    const r = msg.perform(action, () => answer);
    setBeep(!!r.beep);
    if (r.close) close();
    setTick((t) => t + 1);
  };
  return (
    <div className="sym-node-message">
      <div className="sym-message-text formula-prose">{expandEscapes(msg.text).trim()}</div>
      {beep && <p className="muted small">This is the whole problem: there is no part above it.</p>}
      <DialogButtons>
        {msg.labels.map((label, i) => {
          const action = msg.handler.actions[i];
          return (
            <button
              key={label}
              type="button"
              className={action === 'ok' ? 'btn btn-primary' : 'btn'}
              title={
                action === 'up'
                  ? 'Explain the part above this one'
                  : action === 'text'
                    ? 'Put the right English into this part'
                    : action === 'symb'
                      ? 'Give this part the right connective or expression'
                      : undefined
              }
              onClick={() => void act(action)}
            >
              {label}
            </button>
          );
        })}
      </DialogButtons>
    </div>
  );
}

// ---- the scheme editor ----

/**
 * The Create Scheme / Edit Scheme dialog. Resolves with the editor on OK, null on Cancel
 * (Create Scheme has no Cancel, as on the desktop: closing it keeps the scheme as it is).
 */
export function showSchemeDialog(session: LPSymbolizer, editor: SchemeEditor, create: boolean): Promise<SchemeEditor | null> {
  return dialogs.open<SchemeEditor | null>((close) => <SchemeBody session={session} editor={editor} create={create} close={close} />, {
    title: create ? 'Create scheme' : 'Edit scheme',
    dismissValue: null,
    size: 'large',
  });
}

function SchemeBody({ session, editor, create, close }: { session: LPSymbolizer; editor: SchemeEditor; create: boolean; close: (v: SchemeEditor | null) => void }) {
  const [rows, setRows] = useState(() => editor.rows.map((r) => ({ ...r })));
  const update = (i: number, key: 'symbol' | 'english', value: string) => setRows(rows.map((r, k) => (k === i ? { ...r, [key]: value } : r)));
  const browse = async () => {
    const r = await pickProblems(session.data.problems!, {
      title: 'Copy the scheme of another problem',
      actions: [{ value: 'copy', label: 'Copy scheme' }],
    });
    if (!r || r.indices.length === 0) return;
    const s = session.schemeOfProblem(r.indices[0]);
    if (s != null) setRows(new SchemeEditor(s).rows);
  };
  const help = () => void dialogs.message({ title: Message.getModule(symModule, 'symnot008').text, isError: false });
  return (
    <div className="sym-scheme-editor">
      <p className="muted small">
        A symbol (a sentence letter, or a predicate or operation letter with placeholders {'{1}'}, {'{2}'}, … — Alt+1, Alt+2 type them) and the English
        it stands for. Enter in the last row adds a row.
      </p>
      <table className="sym-scheme-table">
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">English</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input
                  className="input formula"
                  aria-label={`Symbol ${i + 1}`}
                  value={r.symbol}
                  onChange={(e) => update(i, 'symbol', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const t = '{' + e.code.substring(5) + '}';
                      const s = el.selectionStart ?? r.symbol.length;
                      update(i, 'symbol', r.symbol.substring(0, s) + t + r.symbol.substring(el.selectionEnd ?? s));
                    }
                  }}
                />
              </td>
              <td>
                <input
                  className="input"
                  aria-label={`English ${i + 1}`}
                  value={r.english}
                  onChange={(e) => update(i, 'english', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && i === rows.length - 1) {
                      e.preventDefault();
                      setRows([...rows, { symbol: '', english: '' }]);
                    }
                  }}
                />
              </td>
              <td>
                <button type="button" className="icon-btn" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sym-scheme-tools">
        <button type="button" className="btn btn-small" onClick={() => setRows([...rows, { symbol: '', english: '' }])}>
          Add row
        </button>
        <button type="button" className="btn btn-small" title="Reset scheme" onClick={() => setRows([{ symbol: '', english: '' }])}>
          Clear
        </button>
        <button type="button" className="btn btn-small" title="Load scheme from another problem" onClick={() => void browse()}>
          Browse…
        </button>
        <button type="button" className="btn btn-small" onClick={help}>
          Help
        </button>
      </div>
      <DialogButtons>
        {!create && (
          <button type="button" className="btn" onClick={() => close(null)}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          title="Accept scheme"
          onClick={() => {
            editor.rows = rows;
            close(editor);
          }}
        >
          OK
        </button>
      </DialogButtons>
    </div>
  );
}

// ---- the Answer Manager ----

export function showAnswerManager(manager: AnswerManager, onChange: () => void): Promise<void> {
  return dialogs.open<void>((close) => <AnswerManagerBody manager={manager} close={close} onChange={onChange} />, {
    title: 'Answer Manager',
    dismissValue: undefined,
    size: 'large',
  });
}

const ANSWER_TIPS: Record<string, string> = {
  Add: 'Add the answer currently in the workspace.',
  Use: 'Load the selected answer into the workspace.',
  Delete: 'Delete the selected answer(s).',
  Replace: 'Replace the selected answer(s) with the answer currently in the workspace.',
  OK: 'OK as is',
};

function AnswerManagerBody({ manager, close, onChange }: { manager: AnswerManager; close: () => void; onChange: () => void }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [, setTick] = useState(0);
  const handler = new DialogHandler(manager.buttonSpec);
  const toggle = (i: number) => setSelected(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i].sort((a, b) => a - b));
  const act = async (action: string | null) => {
    if (action == null) return;
    const done = await manager.perform(action, selected);
    setSelected([]);
    setTick((t) => t + 1);
    onChange();
    if (done) close();
  };
  return (
    <div className="sym-answers">
      {manager.items.length === 0 ? (
        <p className="muted">This problem has no answers yet. Build one in the workspace (or with Direct), then Add it.</p>
      ) : (
        <div className="sym-pick-rows" role="group" aria-label="Answers">
          {manager.items.map((a, i) => (
            <label key={i} className="sym-pick-row">
              <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} />
              <span className="formula">{a}</span>
            </label>
          ))}
        </div>
      )}
      <DialogButtons>
        {handler.labels.map((label, i) => {
          const action = handler.actions[i];
          const needsOne = action === 'load';
          const needsSome = action === 'delete' || action === 'replace';
          return (
            <button
              key={label}
              type="button"
              className={action === 'ok' ? 'btn btn-primary' : 'btn'}
              title={ANSWER_TIPS[label]}
              disabled={(needsOne && selected.length !== 1) || (needsSome && selected.length === 0)}
              onClick={() => void act(action)}
            >
              {label}
            </button>
          );
        })}
      </DialogButtons>
    </div>
  );
}
