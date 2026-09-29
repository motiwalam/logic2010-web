// The Recognizing Rules screen: name the rule that licenses an argument, or "None" (the
// desktop's Recognizing Rules window, LPRecognition / RecognitionProblemPanel).
//
// Saving follows the Parsing screen: the answer to a course problem is saved to the workspace
// when it is checked and when the student leaves the problem; user problems and worked
// examples are saved under a name the student gives.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { TaggedRecord } from '../../../engine/data/TaggedRecord';
import { type LPRecognition, RecognitionModule, type RecognitionCheckResult } from '../../../engine/modules/recognition/LPRecognition';
import { RecognitionProblemPanel } from '../../../engine/modules/recognition/RecognitionProblemPanel';
import { ProblemListModel } from '../../../engine/problems/ProblemList';
import { FormulaText } from '../../components/FormulaText';
import { MessageView } from '../../components/MessageView';
import { ModuleLayout, ProblemHeader } from '../../components/ModuleLayout';
import { nextProblem, ProblemList, type ProblemListHandle } from '../../components/ProblemList';
import { Menu, Toolbar, ToolButton, ToolbarSeparator } from '../../components/Toolbar';
import { dialogs } from '../../dialogs/dialogs';
import { messageLike, moduleDialogs, pickProblems, PrintSheet, type PrintSheetItem, useModel, useModuleWork } from '../parsing/shared';
import { listFromModel } from '../problemRows';
import { FormulaSearchHelp } from '../../components/FormulaSearchHelp';
import type { ModuleProps } from '../registry';
import { recModule } from '../../../engine/program/ModuleConstants';
import './recognition.css';

export default function RecognitionScreen(props: ModuleProps) {
  const { module, error } = useModuleWork(props, recModule, (init) => RecognitionModule.load(init));
  if (error) {
    return (
      <div className="page-state" role="alert">
        <h2>The rule-recognition work could not be read.</h2>
        <p className="muted">{error === 'not003' ? 'The work file does not match its digest (it was changed outside the program).' : error}</p>
      </div>
    );
  }
  if (!module) return <div className="page-state" aria-busy="true">Loading the rule-recognition problems…</div>;
  return <RecognitionWork module={module} props={props} />;
}

/** The theorem numbers of an interval set's text "{1,21,30,31}" as "T1–T20, T30". */
function theoremRanges(w: LPRecognition): string[] {
  const out: string[] = [];
  const b = w.activeRange?.boundaries ?? [];
  for (let k = 0; k + 1 < b.length; k += 2) out.push(b[k + 1] - b[k] === 1 ? `T${b[k]}` : `T${b[k]}–T${b[k + 1] - 1}`);
  return out;
}

function RecognitionWork({ module, props }: { module: RecognitionModule; props: ModuleProps }) {
  const { readOnly, openProblem } = props;
  const session = useMemo(() => module.open(), [module]);
  const moduleVersion = useModel(module);
  useModel(session);
  const listRef = useRef<ProblemListHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [result, setResult] = useState<RecognitionCheckResult | null>(null);
  const [printing, setPrinting] = useState<{ title: string; items: PrintSheetItem[] } | null>(null);

  const saveIfChanged = useCallback(() => {
    if (readOnly || session.problemIndex === -1 || session.dontChange) return;
    const record = session.getChangedProblem();
    if (record != null) void session.saveChanges(record, moduleDialogs);
  }, [readOnly, session]);

  useEffect(() => {
    const name = props.problem;
    if (name == null) {
      if (session.problemIndex !== -1) {
        saveIfChanged();
        session.newProblem();
        setResult(null);
      }
      return;
    }
    const entry = module.problems.getEntry(name);
    const i = entry == null ? -1 : module.problems.indexOf(entry);
    if (i === -1 || i === session.problemIndex) return;
    saveIfChanged();
    session.selectProblem(i);
    setResult(null);
  }, [props.problem, module, session, saveIfChanged]);

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
    () => listFromModel(new ProblemListModel(module.problems, module.exercises, { problemIndex: session.problemIndex, restrict: module.options.monoProbs }), module.problems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [module, moduleVersion, session.problemIndex],
  );

  const p = session.problem;
  const hasProblem = p.statement != null;
  const isUserProblem = session.problemIndex === -1 && hasProblem;
  const isExercise = module.isExercise(p.problemName);

  const saveAs = async (): Promise<boolean> => {
    const ok = await session.save(moduleDialogs);
    if (ok && p.problemName) {
      dialogs.notify(`Saved as “${p.problemName}”.`, { tone: 'success' });
      openProblem(p.problemName, { replace: true });
    }
    return ok;
  };

  const confirmLeave = async (): Promise<boolean> => {
    if (readOnly || session.problemIndex !== -1 || !hasProblem || session.getChangedProblem() == null) return true;
    const r = await dialogs.message({
      title: 'Do you wish to save the current problem?',
      text: 'It is not in your problem list yet. Saved, it is kept under a name you choose.',
      buttons: 'Save:save. Discard:discard. Cancel:cancel;0',
    });
    if (r?.action === 'discard') return true;
    if (r?.action !== 'save') return false;
    return saveAs();
  };

  const open = async (name: string | null) => {
    if (name === props.problem && session.problemIndex !== -1) return;
    if (!(await confirmLeave())) return;
    openProblem(name);
  };

  const go = (delta: number) => {
    const n = nextProblem(list.rows, session.problemIndex === -1 ? props.problem : p.problemName, delta);
    if (n) void open(n);
    else listRef.current?.focusSearch();
  };

  const save = () => {
    if (session.problemIndex === -1 || session.dontChange) void saveAs();
    else {
      saveIfChanged();
      dialogs.notify('Saved.', { tone: 'success' });
    }
  };

  const doCheck = () => {
    const r = session.check();
    if (r.disabled) {
      void dialogs.message({ title: 'Feature Disabled', text: 'Checking is disabled for this problem.', isError: false, expanded: true });
      return;
    }
    setResult(r);
    saveIfChanged();
  };

  const userProblem = async () => {
    if (!(await confirmLeave())) return;
    const text = await dialogs.prompt({
      title: 'User problem',
      prompt: 'Type an argument: its premises separated by dots, then ∴ (.:) and the conclusion, e.g. P→Q . P ∴ Q.',
      label: 'Argument',
      formula: true,
      confirmLabel: 'Use it',
      validate: (v) => (v.trim() === '' ? 'Type an argument.' : null),
    });
    if (text == null) return;
    saveIfChanged();
    const error = session.loadUserProblem(text);
    if (error) {
      await dialogs.message(messageLike(error.message, error.params));
      return;
    }
    setResult(null);
    if (props.problem != null) openProblem(null);
  };

  const deleteWork = async () => {
    if (!(await dialogs.confirm({ title: 'Delete the work on this problem?', confirmLabel: 'Delete work', danger: true }))) return;
    const i = session.problemIndex;
    if (i === -1) session.removeWork();
    else {
      session.deleteWork();
      session.selectProblem(i);
    }
    setResult(null);
  };

  const deleteProblem = async () => {
    if (!(await dialogs.confirm({ title: 'Delete this problem?', body: 'It is removed from your problem list.', confirmLabel: 'Delete problem', danger: true }))) return;
    session.deleteProblem();
    setResult(null);
    openProblem(null);
  };

  const deleteSeveral = async () => {
    const r = await pickProblems(module.problems, {
      title: 'Delete work or problems',
      prompt: 'Choose problems. “Delete work” clears your answers (worked examples are kept); “Delete problems” removes your own problems (course problems are kept).',
      actions: [
        { value: 'work', label: 'Delete work', danger: true },
        { value: 'problems', label: 'Delete problems', danger: true },
      ],
    });
    if (!r) return;
    const current = session.problemIndex;
    const name = p.problemName;
    if (r.action === 'work') {
      if (!(await dialogs.confirm({ title: `Delete the work on ${r.indices.length} problem(s)?`, confirmLabel: 'Delete work', danger: true }))) return;
      module.deleteWorkOf(r.indices);
      if (r.indices.includes(current)) session.selectProblem(current);
    } else {
      if (!(await dialogs.confirm({ title: `Delete ${r.indices.length} problem(s)?`, body: 'Course problems are not deleted.', confirmLabel: 'Delete problems', danger: true }))) return;
      module.deleteProblems(r.indices);
      if (r.indices.includes(current) && !module.isExercise(name)) {
        session.newProblem();
        openProblem(null);
      } else if (name != null) {
        const e = module.problems.getEntry(name);
        if (e) session.problemIndex = module.problems.indexOf(e);
      }
    }
    setResult(null);
  };

  const print = async (kind: 'results' | 'list' | 'statements') => {
    saveIfChanged();
    const r = await pickProblems(module.problems, {
      title: kind === 'results' ? 'Print results' : kind === 'list' ? 'Print problems with answers' : 'Print problem list',
      actions: [{ value: 'print', label: 'Print' }],
      exclude: module.options.noPrint,
      initial: session.problemIndex >= 0 ? [session.problemIndex] : [],
    });
    if (!r) return;
    const items = kind === 'results' ? module.getResults(r.indices) : kind === 'list' ? module.getPrintProblems(r.indices) : module.getStatements(r.indices);
    setPrinting({
      title: 'Recognizing Rules — ' + (kind === 'results' ? 'Results' : 'Problems'),
      items: items.map((it) => ({ key: it.index, code: it.stateCode, text: it.text, extra: it.answer ? <div className="print-answer">{it.answer}</div> : undefined })),
    });
  };
  const donePrinting = useCallback(() => setPrinting(null), []);

  const entryState = session.problemIndex >= 0 ? module.problems.getEntryAt(session.problemIndex)?.state : undefined;
  const status = session.status.trim() !== '' ? { text: session.status.trim(), tone: session.status.trim() === 'Correct' ? ('good' as const) : ('bad' as const) } : (entryState ?? null);
  const suggestions = [...(session.activeRules ?? []), 'None'];
  const theorems = theoremRanges(session);

  const chips = (
    <div className="rule-chips" aria-label="Possible answers">
      <span className="muted small">Possible answers:</span>
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          className={'rule-chip' + (p.ruleText.trim().toUpperCase() === s.toUpperCase() ? ' is-on' : '')}
          onClick={() => {
            session.setRuleText(s);
            setResult(null);
            inputRef.current?.focus();
          }}
        >
          {s}
        </button>
      ))}
      {theorems.length > 0 && <span className="muted small">and theorems {theorems.join(', ')}</span>}
    </div>
  );

  const header = (
    <ProblemHeader
      name={hasProblem ? (session.title ?? (isUserProblem ? 'User problem' : 'Problem')) : 'Recognizing Rules'}
      status={hasProblem ? status : null}
      note={exerciseNote(module, p.problemName)}
    />
  );

  const toolbar = (
    <Toolbar label="Recognizing Rules">
      <ToolButton label="Select problem" shortcut="Mod+O" showShortcut={false} onClick={() => listRef.current?.focusSearch()} />
      <ToolButton label="Previous" shortcut="Alt+ArrowUp" showShortcut={false} onClick={() => go(-1)} />
      <ToolButton label="Next" shortcut="Alt+ArrowDown" altShortcuts={['Alt+N']} showShortcut={false} onClick={() => go(1)} />
      {!readOnly && (
        <>
          <ToolbarSeparator />
          <ToolButton label="Check" variant="primary" shortcut="Mod+K" disabled={!hasProblem} onClick={doCheck} />
          <ToolButton label={session.problemIndex === -1 || session.dontChange ? 'Save…' : 'Save'} shortcut="Mod+S" showShortcut={false} disabled={!hasProblem} onClick={save} />
          <ToolButton label="User problem…" disabled={module.options.noUser} onClick={() => void userProblem()} />
          <Menu
            label="Problem"
            buttonClass="btn tool-btn"
            items={[
              {
                label: 'Save a copy under a new name…',
                disabled: !hasProblem || session.problemIndex === -1 || session.dontChange,
                onSelect: () => void saveAs(),
              },
              'separator',
              { label: 'Delete the work on this problem', disabled: !hasProblem, onSelect: () => void deleteWork() },
              { label: 'Delete this problem', disabled: !hasProblem || isExercise, description: isExercise ? 'Course problems cannot be deleted.' : undefined, onSelect: () => void deleteProblem() },
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
          { label: 'Print this problem', disabled: !hasProblem, onSelect: () => window.print() },
          { label: 'Print results…', description: 'The chosen problems with their states.', onSelect: () => void print('results') },
          { label: 'Print problems with answers…', description: 'The chosen problems, states and your answers.', onSelect: () => void print('list') },
          { label: 'Print problem list…', description: 'The chosen problems’ arguments.', onSelect: () => void print('statements') },
        ]}
      />
    </Toolbar>
  );

  const message =
    result && !result.disabled ? (
      <MessageView
        message={{ title: result.correct ? 'Correct' : 'Incorrect', text: p.comment, isError: !result.correct, expanded: true }}
        onDismiss={() => setResult(null)}
        explain
      />
    ) : null;

  return (
    <ModuleLayout
      sidebar={
        <ProblemList
          ref={listRef}
          rows={list.rows}
          filter={list.filter}
          countLabel={list.countLabel}
          hint={list.hint}
          searchPlaceholder={list.searchPlaceholder}
          searchHelp={list.formulaSearch ? <FormulaSearchHelp /> : undefined}
          selected={session.problemIndex === -1 ? null : p.problemName}
          onOpen={(id) => void open(id)}
        />
      }
      header={header}
      toolbar={toolbar}
      message={message}
    >
      {!hasProblem ? (
        <div className="recognition-empty">
          <p>Choose a problem from the list{readOnly || module.options.noUser ? '' : ', or type your own argument with User problem'}.</p>
          <p className="muted">Each problem is an argument. Name the rule of which it is an instance, or answer “None” if no rule of the chapter applies.</p>
        </div>
      ) : (
        <div className="recognition-work">
          <figure className="argument" aria-label="The argument">
            {p.argument == null ? (
              <FormulaText value={p.statement ?? ''} block />
            ) : (
              <>
                <ol className="argument-premises">
                  {p.argument.premiseTexts.map((t, k) => (
                    <li key={k}>
                      <FormulaText value={t} />
                    </li>
                  ))}
                </ol>
                <div className="argument-conclusion">
                  <span className="argument-therefore" aria-label="therefore">
                    ∴
                  </span>
                  <FormulaText value={p.argument.conclusionText ?? ''} />
                </div>
              </>
            )}
          </figure>

          <form
            className="rule-answer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!readOnly) doCheck();
            }}
          >
            <label htmlFor={listId + '-in'} className="rule-answer-label">
              {RecognitionProblemPanel.getPromptText()}
            </label>
            <div className="rule-answer-row">
              <input
                ref={inputRef}
                id={listId + '-in'}
                className="input rule-input"
                list={listId}
                value={p.ruleText}
                readOnly={readOnly}
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. MP"
                onChange={(e) => {
                  session.setRuleText(e.target.value);
                  setResult(null);
                }}
              />
              <datalist id={listId}>
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              {!readOnly && (
                <button type="submit" className="btn btn-primary">
                  Check
                </button>
              )}
            </div>
            {!readOnly && suggestions.length > 1 && (suggestions.length > 14 ? (
              <details className="rule-more">
                <summary>Possible answers ({suggestions.length})</summary>
                {chips}
              </details>
            ) : (
              chips
            ))}
          </form>
        </div>
      )}
      <PrintSheet title={printing?.title ?? ''} items={printing?.items ?? null} onDone={donePrinting} />
    </ModuleLayout>
  );
}

/** The note (`!`) of a course problem. */
function exerciseNote(module: RecognitionModule, name: string | null): string | null {
  const t = new TaggedRecord(module.exercises.getRecord(name));
  return t.valueAt(t.indexOfTag('!'));
}
