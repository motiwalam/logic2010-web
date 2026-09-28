// The Invalidity screen (the desktop's Invalidity window, LPInvalidation): show an argument
// invalid by giving a universe {0, …, n-1} and interpretations of its predicates, names and
// operations under which every premise is true and the conclusion false. A workspace field
// helps: copy the argument into it and expand its quantifiers over the universe.
//
// Saving follows the Parsing screen (course problems saved on check and when leaving; user
// problems under a name). The Derivation and Truth Table buttons open the argument in those
// modules as new user problems (`?new=`, see src/ui/README.md).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InterpretationEditor } from '../../../engine/modules/invalidity/InterpretationEditor';
import { flag, InvalidityWorkspace, LPInvalidation, loadInvalidityModule, MAX_UNIVERSE_SIZE, selector } from '../../../engine/modules/invalidity/LPInvalidation';
import { PredicateInterpretation, type SymbolInterpretation } from '../../../engine/modules/invalidity/SymbolInterpretation';
import * as Flows from '../../../engine/modules/truth/ModuleDialogs';
import type { ModuleMessage } from '../../../engine/modules/truth/ModuleUi';
import { ProblemListModel } from '../../../engine/problems/ProblemList';
import { STATE_CORRECT } from '../../../engine/problems/ProblemEntry';
import { invModule } from '../../../engine/program/ModuleConstants';
import { maggie, symbols, translateSymbols } from '../../../engine/program/symbols';
import { FormulaInput, type FormulaInputHandle } from '../../components/FormulaInput';
import { MessageView, type MessageLike } from '../../components/MessageView';
import { ModuleLayout, ProblemHeader, StatusPill } from '../../components/ModuleLayout';
import { nextProblem, ProblemList, type ProblemListHandle } from '../../components/ProblemList';
import { Menu, Toolbar, ToolButton, ToolbarSeparator } from '../../components/Toolbar';
import { DialogButtons, dialogs } from '../../dialogs/dialogs';
import { href, navigate } from '../../router';
import { messageLike, pickProblems, PrintSheet, type PrintSheetItem } from '../parsing/shared';
import { listFromModel } from '../problemRows';
import type { ModuleProps } from '../registry';
import { moduleUi, useModel, useModuleWorkspace } from '../truth/common';
import './invalidity.css';

export default function InvalidityScreen(props: ModuleProps) {
  const { ws, error, saved } = useModuleWorkspace<InvalidityWorkspace>(props, invModule, async (work, user, persist) => {
    await loadInvalidityModule();
    return InvalidityWorkspace.open(work, user, persist);
  });
  if (error) {
    return (
      <div className="page-state" role="alert">
        <h2>The invalidity work could not be read.</h2>
        <p className="muted">{error === 'not003' ? 'The work file does not match its digest (it was changed outside the program).' : error}</p>
      </div>
    );
  }
  if (!ws) return <div className="page-state" aria-busy="true">Loading the invalidity problems…</div>;
  return <InvalidityWork ws={ws} saved={saved} props={props} />;
}

const asMessage = (r: ModuleMessage): MessageLike => messageLike(r.message, r.params);
const toMaggie = (s: string) => translateSymbols(s, symbols, maggie);
const toShown = (s: string) => translateSymbols(s, maggie, symbols);

/** A cross-module link (see src/ui/README.md, "Cross-module links"). */
export function newProblemUrl(module: string, record: string): string {
  return href({ name: 'module', module, problem: null }) + '?new=' + encodeURIComponent(record);
}

function describeSummary(m: LPInvalidation, raw: string): string | null {
  if (m.statement == null || raw === 'Correct' || !raw.includes('.:')) return null;
  const [prem, conc] = raw.split('.:');
  const word = (c: string) => (c === 'T' ? 'true' : c === 'F' ? 'false' : 'undefined');
  const ps = prem === '' ? [] : prem.split('.');
  const parts = ps.map((c, i) => `premise ${i + 1} is ${word(c)}`);
  parts.push(`the conclusion is ${word(conc)}`);
  return 'In this interpretation ' + parts.join(', ') + '. To show the argument invalid, every premise must be true and the conclusion false.';
}

function InvalidityWork({ ws, saved, props }: { ws: InvalidityWorkspace; saved: number; props: ModuleProps }) {
  const { readOnly, openProblem } = props;
  const m = useMemo(() => new LPInvalidation(ws), [ws]);
  useModel(m);
  const listRef = useRef<ProblemListHandle>(null);
  const fieldRef = useRef<FormulaInputHandle>(null);
  const [message, setMessage] = useState<MessageLike | null>(null);
  const [printing, setPrinting] = useState<{ title: string; items: PrintSheetItem[] } | null>(null);

  const saveIfChanged = useCallback(() => {
    if (readOnly || m.problemIndex === -1 || m.dontChange) return;
    const record = m.getChangedProblem();
    if (record != null) void Flows.saveProblemsAs(m, moduleUi, record, false);
  }, [readOnly, m]);

  useEffect(() => {
    const name = props.problem;
    if (name == null) {
      if (m.problemIndex !== -1) {
        saveIfChanged();
        m.newProblem();
        setMessage(null);
      }
      return;
    }
    const entry = ws.problems.getEntry(name);
    const i = entry == null ? -1 : ws.problems.indexOf(entry);
    if (i === -1 || i === m.problemIndex) return;
    saveIfChanged();
    m.loadProblemAt(i);
    setMessage(null);
  }, [props.problem, ws, m, saveIfChanged]);

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && saveIfChanged();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveIfChanged);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', saveIfChanged);
      saveIfChanged();
    };
  }, [saveIfChanged]);

  const list = useMemo(
    () => listFromModel(new ProblemListModel(ws.problems, ws.exercises, { problemIndex: m.problemIndex, restrict: selector('monoProbs') }), ws.problems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, saved, m.problemIndex],
  );

  const hasProblem = m.statement != null;
  const isUserProblem = m.problemIndex === -1 && hasProblem;
  const isExercise = ws.isExercise(m.title);

  const saveAs = async (): Promise<boolean> => {
    const ok = await Flows.saveRenamed(m, moduleUi, m.saveProblem());
    if (ok && m.title) {
      dialogs.notify(`Saved as “${m.title}”.`, { tone: 'success' });
      openProblem(m.title, { replace: true });
    }
    return ok;
  };

  const confirmLeave = async (): Promise<boolean> => {
    if (readOnly || m.problemIndex !== -1 || !hasProblem || m.getChangedProblem() == null) return true;
    const choice = await moduleUi.confirmSave();
    if (choice === 'no') return true;
    if (choice === 'cancel') return false;
    return saveAs();
  };

  const open = async (name: string | null) => {
    if (name === props.problem && m.problemIndex !== -1) return;
    if (!(await confirmLeave())) return;
    openProblem(name);
  };

  const go = (delta: number) => {
    const n = nextProblem(list.rows, m.problemIndex === -1 ? props.problem : m.title, delta);
    if (n) void open(n);
    else listRef.current?.focusSearch();
  };

  const save = () => {
    if (m.problemIndex === -1 || m.dontChange) void saveAs();
    else {
      saveIfChanged();
      dialogs.notify('Saved.', { tone: 'success' });
    }
  };

  const doCheck = () => {
    const r = m.check();
    if (r.disabled) {
      void moduleUi.showText('Feature Disabled', 'Checking is disabled for this problem.');
      return;
    }
    if (r.correct) setMessage({ title: 'Correct. Every premise is true and the conclusion is false: the argument is invalid.', isError: false, expanded: true });
    else {
      const d = describeSummary(m, r.raw);
      setMessage({ title: d ?? r.status, isError: true, expanded: true });
    }
    saveIfChanged();
  };

  /** Takes the field's selection into the model (the field shows the model's text). */
  const syncSelection = () => {
    const input = fieldRef.current?.input;
    if (input) m.select(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  };

  const expand = (all: boolean) => {
    syncSelection();
    const r = all ? (m.expandOff ? m.expandAction(false) : m.expand(true)) : m.expandAction(false);
    if (r) void dialogs.message(asMessage(r));
    fieldRef.current?.focus();
  };

  const copy = () => {
    syncSelection();
    m.copyStatement();
    fieldRef.current?.focus();
  };

  const toDerivation = () => {
    const l = m.derivationLink(false);
    if ('record' in l) navigate(newProblemUrl('derivation', l.record));
    else void dialogs.message(asMessage(l));
  };

  const toTruthTable = (expanded: boolean) => {
    syncSelection();
    // the desktop sends the workspace selection; with nothing selected it would send "null"
    if (!expanded && m.getSelectedText() == null) {
      void dialogs.message({ title: 'Select a formula or argument in the workspace first, or open the whole argument expanded over the universe.', isError: false, expanded: true });
      return;
    }
    const l = m.truthTableLink(expanded);
    if ('record' in l) navigate(newProblemUrl('truth-tables', l.record));
    else void dialogs.message(asMessage(l));
  };

  const editSymbol = async (s: SymbolInterpretation) => {
    const r = m.editInterpretation(s);
    if (!('editor' in r)) {
      void moduleUi.showText(r.title, r.text);
      return;
    }
    const ok = await dialogs.open<boolean>((close) => <EditorGrid editor={r.editor} readOnly={readOnly} onDone={close} />, {
      title: 'Extend ' + s.getSignature(),
      dismissValue: false,
      size: 'large',
    });
    if (ok && !readOnly) m.applyEditor(r.editor);
  };

  const userProblem = async () => {
    if (!(await confirmLeave())) return;
    const text = await dialogs.prompt({
      title: 'User problem',
      prompt: 'Type an argument: premises separated by periods, then ∴ and the conclusion.',
      label: 'Argument',
      formula: true,
      initial: toMaggie(m.userProblemDefault()),
      confirmLabel: 'OK',
      validate: (v) => (v.trim() === '' ? 'Type an argument.' : null),
    });
    if (text == null) return;
    saveIfChanged();
    const r = m.createUserProblem(toShown(text));
    setMessage(r ? asMessage(r) : null);
    if (!r && props.problem != null) openProblem(null);
  };

  const deleteThis = async () => {
    const idx = m.problemIndex;
    const ok = isExercise ? await Flows.deleteWork(m, moduleUi) : await Flows.deleteProblemOrWork(m, moduleUi);
    if (!ok) return;
    setMessage(null);
    if (idx !== -1 && m.problemIndex === -1) openProblem(null);
  };

  const deleteSeveral = async () => {
    const r = await pickProblems(ws.problems, {
      title: 'Delete work or problems',
      prompt: 'Choose problems. “Delete work” clears your work on them (worked examples are kept); “Delete problems” removes your own problems (course problems are kept).',
      actions: [
        { value: 'work', label: 'Delete work', danger: true },
        { value: 'problems', label: 'Delete problems', danger: true },
      ],
    });
    if (!r) return;
    const before = m.problemIndex;
    await Flows.deleteMultipleProblems(moduleUi, ws, r.indices, r.action === 'work' ? 'work' : 'problems', m);
    if (before !== -1 && m.problemIndex === -1) openProblem(null);
    setMessage(null);
  };

  const print = async (kind: 'results' | 'list') => {
    saveIfChanged();
    const r = await pickProblems(ws.problems, {
      title: kind === 'results' ? 'Print results' : 'Print problem list',
      actions: [{ value: 'print', label: 'Print' }],
      exclude: selector('noPrint'),
      initial: m.problemIndex >= 0 ? [m.problemIndex] : [],
    });
    if (!r) return;
    const items: PrintSheetItem[] =
      kind === 'results'
        ? ws.getResults(r.indices).map((it) => ({ key: it.index, code: it.status, text: it.title }))
        : ws.getStatements(r.indices).map((it, k) => ({ key: k, text: it.text }));
    setPrinting({ title: 'Invalidity — ' + (kind === 'results' ? 'Results' : 'Problems'), items });
  };
  const donePrinting = useCallback(() => setPrinting(null), []);

  const entryState = m.problemIndex >= 0 ? ws.problems.getEntryAt(m.problemIndex)?.state : undefined;
  const st = m.status.trim();
  const status = st !== '' ? { text: st, tone: st === 'Correct' ? ('good' as const) : ('bad' as const) } : (entryState ?? null);

  const header = (
    <ProblemHeader
      name={hasProblem ? (m.getTitle() ?? (isUserProblem ? 'User problem' : 'Problem')) : 'Invalidity'}
      statement={hasProblem ? m.unparsed! : undefined}
      status={hasProblem ? status : null}
      note={m.note}
    />
  );

  const toolbar = (
    <Toolbar label="Invalidity">
      <ToolButton label="Select problem" shortcut="Mod+O" showShortcut={false} onClick={() => listRef.current?.focusSearch()} />
      <ToolButton label="Previous" shortcut="Alt+ArrowUp" showShortcut={false} onClick={() => go(-1)} />
      <ToolButton label="Next" shortcut="Alt+ArrowDown" altShortcuts={['Alt+N']} showShortcut={false} onClick={() => go(1)} />
      {!readOnly && (
        <>
          <ToolbarSeparator />
          <ToolButton label="Check" variant="primary" shortcut="Mod+K" disabled={!hasProblem} onClick={doCheck} />
          <ToolButton label={m.problemIndex === -1 || m.dontChange ? 'Save…' : 'Save'} shortcut="Mod+S" showShortcut={false} disabled={!hasProblem} onClick={save} />
          <ToolButton label="User problem…" disabled={flag('noUser')} onClick={() => void userProblem()} />
          <Menu
            label="Problem"
            buttonClass="btn tool-btn"
            items={[
              { label: 'Save a copy under a new name…', disabled: !hasProblem || m.problemIndex === -1 || m.dontChange, onSelect: () => void saveAs() },
              'separator',
              {
                label: isExercise ? 'Delete the work on this problem' : 'Delete the work or this problem…',
                disabled: !hasProblem || (isExercise && !m.hasWork()),
                onSelect: () => void deleteThis(),
              },
              'separator',
              { label: 'Delete work or problems…', onSelect: () => void deleteSeveral() },
            ]}
          />
        </>
      )}
      <Menu
        label="Open in"
        buttonClass="btn tool-btn"
        items={[
          { label: 'Derivation', description: 'The argument as a new derivation problem.', disabled: !hasProblem, onSelect: toDerivation },
          { label: 'Truth Table: the selection', description: 'The workspace selection as a truth-table problem.', onSelect: () => toTruthTable(false) },
          {
            label: 'Truth Table: the expanded argument',
            description: 'Every quantifier expanded over the universe.',
            disabled: !hasProblem || m.size === 0,
            onSelect: () => toTruthTable(true),
          },
        ]}
      />
      <Menu
        label="Print"
        buttonClass="btn tool-btn"
        items={[
          { label: 'Print this problem', shortcut: 'Mod+P', disabled: !hasProblem, onSelect: () => window.print() },
          { label: 'Print results…', description: 'The chosen problems with their states.', onSelect: () => void print('results') },
          { label: 'Print problem list…', description: 'The chosen problems’ arguments.', onSelect: () => void print('list') },
        ]}
      />
    </Toolbar>
  );

  const syms = m.symbols ?? [];
  return (
    <ModuleLayout
      sidebar={
        <ProblemList
          ref={listRef}
          rows={list.rows}
          filter={list.filter}
          countLabel={list.countLabel}
          selected={m.problemIndex === -1 ? null : m.title}
          onOpen={(id) => void open(id)}
        />
      }
      header={header}
      toolbar={toolbar}
      message={message ? <MessageView message={message} onDismiss={() => setMessage(null)} explain /> : null}
    >
      {!hasProblem ? (
        <div className="tt-empty">
          <p>Choose a problem from the list{readOnly || flag('noUser') ? '' : ', or make up your own with User problem'}.</p>
          <p className="muted">
            Show that an argument is invalid: choose the size of a universe, then say which objects each predicate is true of and what each name and
            operation stands for, so that every premise comes out true and the conclusion false.
          </p>
        </div>
      ) : (
        <div className="inv-work">
          <section className="inv-universe" aria-label="Universe">
            <label className="inv-size">
              <span>Size of the universe</span>
              <select className="input" value={m.size} disabled={readOnly} onChange={(e) => m.chooseSize(Number(e.target.value))}>
                {m.size === 0 && <option value={0}>choose…</option>}
                {Array.from({ length: MAX_UNIVERSE_SIZE }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <span className="inv-universe-label formula">{m.getUniverseLabel()}</span>
            {st !== '' && <StatusPill status={{ text: st, tone: st === 'Correct' ? 'good' : 'bad' }} />}
          </section>

          <section className="inv-symbols" aria-label="Interpretations">
            <h2 className="inv-h">Interpretations</h2>
            {syms.length === 0 ? (
              <p className="muted">This argument has no predicates, names or operations.</p>
            ) : (
              <ul className="inv-symbol-list">
                {syms.map((s) => (
                  <li key={s.getSignature() + (s instanceof PredicateInterpretation ? 'p' : 'o')} className="inv-symbol">
                    <button type="button" className="btn inv-symbol-btn formula" title={`Click to set the value of ${s.name}`} onClick={() => void editSymbol(s)}>
                      {toShown(s.name)}
                      <span className="inv-kind">{symbolKind(s)}</span>
                    </button>
                    <span className="inv-symbol-value formula">{m.size === 0 ? <span className="muted">choose the size of the universe first</span> : m.describeSymbol(s) || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="inv-workspace" aria-label="Workspace">
            <h2 className="inv-h">Workspace</h2>
            <p className="muted small">Scratch space: copy the argument here, select a quantified formula and expand it over the universe.</p>
            <FormulaInput
              ref={fieldRef}
              value={toMaggie(m.workspaceText)}
              readOnly={readOnly}
              ariaLabel="Workspace formulas"
              onChange={(v) => {
                const input = fieldRef.current?.input;
                m.setWorkspaceText(toShown(v), input?.selectionStart ?? undefined, input?.selectionEnd ?? undefined);
              }}
            />
            {!readOnly && (
              <div className="inv-workspace-tools">
                <button type="button" className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={copy} title="Copy the problem into the workspace">
                  Copy problem
                </button>
                <button type="button" className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={() => expand(false)} title="Expand the outermost selected quantifier">
                  Expand
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => expand(true)}
                  disabled={!m.expandAll}
                  title={m.expandAll ? 'Expand every quantifier in the selection' : 'Expanding every quantifier at once is not enabled for this problem'}
                >
                  Expand all
                </button>
              </div>
            )}
          </section>
          {entryState === STATE_CORRECT && st === '' && <p className="muted small">This problem is marked correct in {readOnly ? 'the' : 'your'} list.</p>}
        </div>
      )}
      <PrintSheet title={printing?.title ?? ''} items={printing?.items ?? null} onDone={donePrinting} />
    </ModuleLayout>
  );
}

function symbolKind(s: SymbolInterpretation): string {
  if (s instanceof PredicateInterpretation) return s.arity === 0 ? 'sentence letter' : s.arity === 1 ? 'predicate' : `${s.arity}-place predicate`;
  return s.arity === 0 ? 'name' : `${s.arity}-place operation`;
}

/** The interpretation editor (InterpretationEditor): a grid of check boxes or number choosers. */
function EditorGrid({ editor, readOnly, onDone }: { editor: InterpretationEditor; readOnly: boolean; onDone: (ok: boolean) => void }) {
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  const s = editor.symbol;
  const size = editor.universeSize;
  const name = toShown(s.name);
  const cellInput = (r: number, c: number) => {
    const cell = editor.cells[r][c];
    const label = `${name}(${cell.tuple.join(',')})`;
    return editor.isPredicate ? (
      <input type="checkbox" aria-label={label} checked={cell.checked} disabled={readOnly} onChange={(e) => (editor.setChecked(r, c, e.target.checked), bump())} />
    ) : (
      <select className="input" aria-label={label} value={cell.value} disabled={readOnly} onChange={(e) => (editor.setValue(r, c, Number(e.target.value)), bump())}>
        {Array.from({ length: size }, (_, i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
    );
  };
  return (
    <div className="inv-editor">
      {s.arity === 0 ? (
        <label className="inv-editor-single">
          {cellInput(0, 0)}
          <span className="formula">{editor.isPredicate ? `${name} is true` : `${name} stands for`}</span>
        </label>
      ) : (
        <div className="tt-scroll">
          <table className="tt-table inv-grid">
            <thead>
              <tr>
                {s.arity > 1 && <th scope="col" className="muted small">{s.arity === 2 ? 'first ↓ / second →' : 'first … ↓ / last →'}</th>}
                {Array.from({ length: editor.columns }, (_, c) => (
                  <th key={c} scope="col">
                    {s.arity === 1 ? `${name}(${c})` : c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {editor.cells.map((row, r) => (
                <tr key={r}>
                  {s.arity > 1 && <th scope="row">{row[0].tuple.slice(0, -1).join(',')}</th>}
                  {row.map((_, c) => (
                    <td key={c}>{cellInput(r, c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        {editor.isPredicate
          ? `Check the ${s.arity === 1 ? 'objects' : 'tuples'} that ${name} is true of.`
          : s.arity === 0
            ? `Choose the object ${name} names.`
            : `Choose the value of ${name} for each ${s.arity === 1 ? 'object' : 'tuple'}.`}
      </p>
      <DialogButtons>
        <button type="button" className="btn" onClick={() => onDone(false)}>
          Cancel
        </button>
        {!readOnly && (
          <button type="button" className="btn btn-primary" onClick={() => onDone(true)}>
            OK
          </button>
        )}
      </DialogButtons>
    </div>
  );
}
