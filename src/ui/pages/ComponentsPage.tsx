// The shared components, live (for module authors and for checking the look): /dev/components

import { useEffect, useState } from 'react';
import { loadModuleMessages } from '../../engine/program/loadProgram';
import { Message } from '../../engine/program/Message';
import { FormulaInput } from '../components/FormulaInput';
import { FormulaText } from '../components/FormulaText';
import { MessageView, type MessageLike } from '../components/MessageView';
import { ModuleLayout, ProblemHeader } from '../components/ModuleLayout';
import { ProblemList, type ProblemRow } from '../components/ProblemList';
import { Toolbar, ToolButton, ToolbarSeparator } from '../components/Toolbar';
import { dialogs } from '../dialogs/dialogs';
import { useEngine } from '../engine/engine';

const ROWS: ProblemRow[] = [
  { kind: 'heading', text: 'Chapter 1: sentential logic with ‘if’ and ‘not’' },
  { kind: 'problem', id: 'Deriv 1.001', label: '1.001:  ∼Q ∴ (P→Q)→∼P', state: 2 },
  { kind: 'problem', id: 'Deriv 1.002', label: '1.002:  P→Q, Q→R ∴ P→R', state: 1 },
  { kind: 'problem', id: 'Deriv 1.003', label: '1.003:  P ∴ Q→P', state: 3 },
  { kind: 'problem', id: 'Deriv 1.004', label: '1.004:  ∼∼P ∴ P', state: 0, restricted: true },
  { kind: 'heading', text: 'To enable MC1 & SSimp5, prove T2.' },
  { kind: 'problem', id: 'Deriv 1.005', label: '1.005:  P→(Q→R) ∴ Q→(P→R)', state: 4, hover: 'proves T2' },
  { kind: 'problem', id: 'Deriv 1.006EG', label: '1.006EG:  P ∴ P', state: 0, counted: false },
];

function toLike(m: Message): MessageLike {
  return { title: m.title, text: m.text, isError: m.isError, buttons: m.buttons };
}

export function ComponentsPage() {
  const engine = useEngine();
  const [formula, setFormula] = useState('@x(Fx->~Gx)');
  const [selected, setSelected] = useState<string | null>('Deriv 1.002');
  const [messages, setMessages] = useState<MessageLike[]>([]);
  const [lastResult, setLastResult] = useState('');

  useEffect(() => {
    if (engine.status !== 'ready') return;
    void loadModuleMessages(0).then(() => setMessages(['DerInf005', 'DerErr002', 'DerInf003'].map((id) => toLike(Message.getModule(0, id)))));
  }, [engine.status, engine.generation]);

  return (
    <div className="components-page">
      <ModuleLayout
        sidebar={<ProblemList rows={ROWS} selected={selected} onOpen={setSelected} />}
        header={<ProblemHeader name={selected ?? 'No problem'} statement="~Q .: (P->Q)->~P" status={1} note="A note from the problem file appears here." />}
        toolbar={
          <Toolbar label="Demo">
            <ToolButton label="Check" shortcut="Mod+K" variant="primary" onClick={() => dialogs.notify('Check pressed')} />
            <ToolButton label="Next" shortcut="Alt+ArrowDown" onClick={() => dialogs.notify('Next pressed')} />
            <ToolbarSeparator />
            <ToolButton label="Print" shortcut="Mod+P" onClick={() => window.print()} />
          </Toolbar>
        }
        message={messages[1] ? <MessageView message={messages[1]} onAction={(r) => setLastResult(r.label)} onDismiss={() => undefined} /> : null}
      >
        <section className="demo-block">
          <h2>FormulaInput</h2>
          <FormulaInput id="demo-formula" ariaLabel="Formula" value={formula} onChange={setFormula} allowPlaceholders keypadOpen />
          <p className="small muted">
            Value (stored): <code>{formula}</code> — shown: <FormulaText value={formula} />
          </p>
        </section>
        <section className="demo-block">
          <h2>Messages</h2>
          {messages.map((m, i) => (
            <MessageView key={i} message={m} onAction={(r) => setLastResult(r.label)} />
          ))}
          {lastResult && <p className="small muted">Pressed: {lastResult}</p>}
        </section>
        <section className="demo-block">
          <h2>Dialogs</h2>
          <div className="button-row">
            <button type="button" className="btn" onClick={async () => messages[0] && setLastResult(String((await dialogs.message(messages[0]))?.label))}>
              message()
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () =>
                setLastResult(
                  String(
                    await dialogs.choose({
                      title: 'Choose a conjunct',
                      prompt: 'Please choose a conjunct:',
                      choices: [
                        { value: 'P', label: '', formula: 'P' },
                        { value: 'Q->R', label: '', formula: 'Q->R' },
                      ],
                    }),
                  ),
                )
              }
            >
              choose()
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () =>
                setLastResult(
                  String(
                    await dialogs.prompt({
                      title: 'Instantiate',
                      label: 'Term to put for x',
                      formula: true,
                      validate: (v) => (v.trim() ? null : 'Enter a term.'),
                    }),
                  ),
                )
              }
            >
              prompt()
            </button>
            <button type="button" className="btn" onClick={async () => setLastResult(String(await dialogs.confirm({ title: 'Delete this line?', danger: true, confirmLabel: 'Delete' })))}>
              confirm()
            </button>
          </div>
        </section>
      </ModuleLayout>
    </div>
  );
}
