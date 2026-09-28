// The Truth Tables screen (the desktop's Truth Tables window, LPTruthAnalysis): answer whether
// an argument is valid (or a formula a tautology), fill in its truth table cell by cell with
// each cell's evaluation tree, and check a counterexample row.
//
// Saving follows the Parsing screen: the work on a course problem is saved when it is checked
// and when the student leaves it; a user problem (or a worked example) is saved under a name
// the student gives. A link from another module (`?new=`, see src/ui/README.md) opens its
// statement as a new user problem.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TaggedRecord } from '../../../engine/data/TaggedRecord';
import { LPTruthAnalysis, loadTruthModule, selector, flag, TruthWorkspace, type CheckResult } from '../../../engine/modules/truth/LPTruthAnalysis';
import * as Flows from '../../../engine/modules/truth/ModuleDialogs';
import type { ModuleMessage } from '../../../engine/modules/truth/ModuleUi';
import { ProblemListModel } from '../../../engine/problems/ProblemList';
import { STATE_CORRECT } from '../../../engine/problems/ProblemEntry';
import { truModule } from '../../../engine/program/ModuleConstants';
import { MessageView, type MessageLike } from '../../components/MessageView';
import { ModuleLayout, ProblemHeader } from '../../components/ModuleLayout';
import { nextProblem, ProblemList, type ProblemListHandle } from '../../components/ProblemList';
import { Menu, Toolbar, ToolButton, ToolbarSeparator } from '../../components/Toolbar';
import { DialogButtons, dialogs } from '../../dialogs/dialogs';
import { FormulaInput } from '../../components/FormulaInput';
import { maggie, symbols, translateSymbols } from '../../../engine/program/symbols';
import { messageLike, pickProblems, PrintSheet, type PrintSheetItem } from '../parsing/shared';
import { listFromModel } from '../problemRows';
import type { ModuleProps } from '../registry';
import { moduleUi, useModel, useModuleWorkspace, useNewProblemParam } from './common';
import { CellEditor, SetupView, TruthTableView } from './TruthTableView';
import './truth.css';

export default function TruthScreen(props: ModuleProps) {
  const { ws, error, saved } = useModuleWorkspace<TruthWorkspace>(props, truModule, async (work, user, persist) => {
    await loadTruthModule();
    return TruthWorkspace.open(work, user, persist);
  });
  if (error) {
    return (
      <div className="page-state" role="alert">
        <h2>The truth-table work could not be read.</h2>
        <p className="muted">{error === 'not003' ? 'The work file does not match its digest (it was changed outside the program).' : error}</p>
      </div>
    );
  }
  if (!ws) return <div className="page-state" aria-busy="true">Loading the truth-table problems…</div>;
  return <TruthWork ws={ws} saved={saved} props={props} />;
}

function tone(s: string): 'good' | 'bad' | 'warn' | 'neutral' {
  return s === 'Correct' ? 'good' : s === 'Incorrect' ? 'bad' : s === 'Incomplete' ? 'warn' : 'neutral';
}

const asMessage = (r: ModuleMessage): MessageLike => messageLike(r.message, r.params);

function TruthWork({ ws, saved, props }: { ws: TruthWorkspace; saved: number; props: ModuleProps }) {
  const { readOnly, openProblem } = props;
  const m = useMemo(() => new LPTruthAnalysis(ws), [ws]);
  useModel(m);
  const listRef = useRef<ProblemListHandle>(null);
  const [message, setMessage] = useState<MessageLike | null>(null);
  const [printing, setPrinting] = useState<{ title: string; items: PrintSheetItem[] } | null>(null);
  const newParam = useNewProblemParam();

  const saveIfChanged = useCallback(() => {
    if (readOnly || m.problemIndex === -1 || m.dontChange) return;
    const record = m.getChangedProblem();
    if (record != null) void Flows.saveProblemsAs(m, moduleUi, record, false);
  }, [readOnly, m]);

  // a link from another module: its statement as a new user problem
  useEffect(() => {
    if (newParam == null) return;
    saveIfChanged();
    m.loadProblem(newParam.includes('`') ? newParam : TaggedRecord.toLine(TaggedRecord.formatField(newParam, '=')));
    setMessage(null);
    openProblem(null, { replace: true });
  }, [newParam, m, saveIfChanged, openProblem]);

  // open the problem named in the URL
  useEffect(() => {
    if (newParam != null) return;
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
  }, [props.problem, ws, m, saveIfChanged, newParam]);

  // save when leaving
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

  const p = m.problem;
  const hasProblem = p.statement != null && p.statement !== '';
  const isUserProblem = m.problemIndex === -1 && hasProblem;
  const isExercise = ws.isExercise(p.problemName);

  const saveAs = async (): Promise<boolean> => {
    const ok = await Flows.saveRenamed(m, moduleUi, m.saveProblem());
    if (ok && p.problemName) {
      dialogs.notify(`Saved as “${p.problemName}”.`, { tone: 'success' });
      openProblem(p.problemName, { replace: true });
    }
    return ok;
  };

  /** Before leaving an unsaved user problem: save it, discard it, or stay. */
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
    const n = nextProblem(list.rows, m.problemIndex === -1 ? props.problem : p.problemName, delta);
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
    if (m.checkDisabled) {
      void moduleUi.showText('Feature Disabled', 'Checking is disabled for this problem.');
      return;
    }
    if (p.table.selectedCell) m.commitSelectedCell();
    const r: CheckResult = m.checkProblem();
    if (r.error.id == null) setMessage({ title: 'Correct. Well done.', isError: false, expanded: true });
    else setMessage(r.message ? asMessage(r.message) : null);
    saveIfChanged();
  };

  const setupOk = () => {
    const r = m.pressSetupOk();
    setMessage(r ? asMessage(r) : null);
  };

  const userProblem = async () => {
    if (!(await confirmLeave())) return;
    let tableOnly = false;
    const text = await dialogs.open<string | null>(
      (close) => <UserProblemForm initial={translateSymbols(m.userProblemDefault(), symbols, maggie)} onDone={(t, only) => ((tableOnly = only), close(t))} />,
      { title: 'User problem', dismissValue: null, size: 'medium' },
    );
    if (text == null) return;
    saveIfChanged();
    const r = m.createUserProblem(translateSymbols(text, maggie, symbols), tableOnly);
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
    setPrinting({ title: 'Truth Tables — ' + (kind === 'results' ? 'Results' : 'Problems'), items });
  };
  const donePrinting = useCallback(() => setPrinting(null), []);

  const entryState = m.problemIndex >= 0 ? ws.problems.getEntryAt(m.problemIndex)?.state : undefined;
  const status = m.status.trim() !== '' ? { text: m.status.trim(), tone: tone(m.status.trim()) } : (entryState ?? null);

  const header = (
    <ProblemHeader
      name={hasProblem ? (m.getTitle() ?? (isUserProblem ? 'User problem' : 'Problem')) : 'Truth Tables'}
      statement={hasProblem ? p.statement! : undefined}
      status={hasProblem ? status : null}
      note={m.note}
    />
  );

  const toolbar = (
    <Toolbar label="Truth Tables">
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
        label="Print"
        buttonClass="btn tool-btn"
        items={[
          { label: 'Print this problem', shortcut: 'Mod+P', disabled: !hasProblem, onSelect: () => window.print() },
          { label: 'Print results…', description: 'The chosen problems with their states.', onSelect: () => void print('results') },
          { label: 'Print problem list…', description: 'The chosen problems’ statements.', onSelect: () => void print('list') },
        ]}
      />
    </Toolbar>
  );

  return (
    <ModuleLayout
      sidebar={
        <ProblemList
          ref={listRef}
          rows={list.rows}
          filter={list.filter}
          countLabel={list.countLabel}
          selected={m.problemIndex === -1 ? null : p.problemName}
          onOpen={(id) => void open(id)}
        />
      }
      header={header}
      toolbar={toolbar}
      message={message ? <MessageView message={message} onDismiss={() => setMessage(null)} explain /> : null}
      aside={hasProblem && p.showingTable && p.table.rowCount > 0 ? <CellEditor m={m} readOnly={readOnly} /> : undefined}
    >
      {!hasProblem ? (
        <div className="tt-empty">
          <p>Choose a problem from the list{readOnly || flag('noUser') ? '' : ', or make up your own with User problem'}.</p>
          <p className="muted">
            Work out the truth table of an argument (or a formula): for each row, give every part of each premise and of the conclusion a value, from the
            sentence letters up. Then say whether the argument is valid; if it is not, check a row in which all premises are true and the conclusion false.
          </p>
        </div>
      ) : (
        <div className="tt-work">
          {p.showingTable ? (
            <>
              <fieldset className="tt-question" disabled={readOnly}>
                <legend className="tt-question-text">{p.question}</legend>
                {p.answerVisible && (
                  <div className="tt-answers" role="radiogroup" aria-label={p.question}>
                    {['yes', 'no'].map((a, i) => (
                      <label key={a} className={'notation-option' + (p.answer === i ? ' is-on' : '')}>
                        <input type="radio" name="tt-answer" checked={p.answer === i} onChange={() => m.setAnswer(i)} />
                        <span>{a}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <TruthTableView m={m} readOnly={readOnly} />
            </>
          ) : (
            <SetupView m={m} readOnly={readOnly} onOk={setupOk} />
          )}
          {entryState === STATE_CORRECT && m.status.trim() === '' && <p className="muted small">This problem is marked correct in {readOnly ? 'the' : 'your'} list.</p>}
        </div>
      )}
      <PrintSheet title={printing?.title ?? ''} items={printing?.items ?? null} onDone={donePrinting} />
    </ModuleLayout>
  );
}

/** The "User Problem" dialog: an argument or formula, and the "Truth Table Only" box. Values are maggie. */
function UserProblemForm({ initial, onDone }: { initial: string; onDone: (text: string | null, tableOnly: boolean) => void }) {
  const [text, setText] = useState(initial);
  const [only, setOnly] = useState(false);
  const ok = () => text.trim() !== '' && onDone(text, only);
  return (
    <div className="tt-user-form">
      <p className="dialog-text">Type an argument (premises separated by periods, then ∴ and the conclusion) or a single formula.</p>
      <FormulaInput value={text} onChange={setText} onEnter={ok} autoFocus ariaLabel="Argument or formula" placeholder="P→Q . Q ∴ P" />
      <label className="tt-only">
        <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Truth table only (no question to answer)
      </label>
      <DialogButtons>
        <button type="button" className="btn" onClick={() => onDone(null, false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={text.trim() === ''} onClick={ok}>
          OK
        </button>
      </DialogButtons>
    </div>
  );
}
