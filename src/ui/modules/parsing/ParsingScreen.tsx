// The Parsing screen: choose the notation of a string (official, informal, not well formed)
// and take a formula apart by clicking the main connective of each part (the desktop's Parsing
// window, LPParsing / ParsingProblemPanel).
//
// Saving: the desktop saves when asked (Save, or "save changes?" on leaving). Here the work
// on a course problem is saved to the workspace when it is checked and when the student leaves
// it (another problem, another page, the tab hidden). A user problem, or a worked example, is
// saved under a name the student gives (Save…), as on the desktop.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LPParsing, ParsingModule } from '../../../engine/modules/parsing/LPParsing';
import { NOTATION_LABELS, type ParsingCheckResult } from '../../../engine/modules/parsing/ParsingProblemPanel';
import { ProblemListModel } from '../../../engine/problems/ProblemList';
import { STATE_CORRECT } from '../../../engine/problems/ProblemEntry';
import { MessageView, type MessageLike } from '../../components/MessageView';
import { ModuleLayout, ProblemHeader, StatusPill } from '../../components/ModuleLayout';
import { nextProblem, ProblemList, type ProblemListHandle } from '../../components/ProblemList';
import { Menu, Toolbar, ToolButton, ToolbarSeparator } from '../../components/Toolbar';
import { dialogs } from '../../dialogs/dialogs';
import { listFromModel } from '../problemRows';
import { FormulaSearchHelp } from '../../components/FormulaSearchHelp';
import type { ModuleProps } from '../registry';
import { parModule } from '../../../engine/program/ModuleConstants';
import { ParseTreeView } from './ParseTreeView';
import { messageLike, moduleDialogs, pickProblems, PrintSheet, type PrintSheetItem, useModel, useModuleWork } from './shared';
import './parsing.css';

export default function ParsingScreen(props: ModuleProps) {
  const { module, error } = useModuleWork(props, parModule, (init) => ParsingModule.load(init));
  if (error) {
    return (
      <div className="page-state" role="alert">
        <h2>The parsing work could not be read.</h2>
        <p className="muted">{error === 'not003' ? 'The work file does not match its digest (it was changed outside the program).' : error}</p>
      </div>
    );
  }
  if (!module) return <div className="page-state" aria-busy="true">Loading the parsing problems…</div>;
  return <ParsingWork module={module} props={props} />;
}

function tone(summary: string): 'good' | 'bad' | 'warn' | 'neutral' {
  return summary === 'Correct' || summary === 'Complete' ? 'good' : summary === 'Incorrect' ? 'bad' : summary === 'Incomplete' ? 'warn' : 'neutral';
}

function checkMessage(r: ParsingCheckResult): MessageLike {
  if (r.id == null) return { title: 'Correct. Well done.', isError: false, expanded: true };
  // parerr004 is not in the course's message file
  if (r.id === 'parerr004') return { title: 'The symbol you marked is not the main connective.', isError: true, expanded: true };
  return messageLike(LPParsing.message(r.id));
}

function ParsingWork({ module, props }: { module: ParsingModule; props: ModuleProps }) {
  const { readOnly, openProblem } = props;
  const session = useMemo(() => module.open(), [module]);
  const moduleVersion = useModel(module);
  useModel(session);
  const listRef = useRef<ProblemListHandle>(null);
  const [check, setCheck] = useState<ParsingCheckResult | null>(null);
  const [printing, setPrinting] = useState<{ title: string; items: PrintSheetItem[] } | null>(null);

  const saveIfChanged = useCallback(() => {
    if (readOnly || session.problemIndex === -1 || session.dontChange) return;
    const record = session.getChangedProblem();
    if (record != null) void session.saveChanges(record, moduleDialogs);
  }, [readOnly, session]);

  // open the problem named in the URL
  useEffect(() => {
    const name = props.problem;
    if (name == null) {
      if (session.problemIndex !== -1) {
        saveIfChanged();
        session.newProblem();
        setCheck(null);
      }
      return;
    }
    const entry = module.problems.getEntry(name);
    const i = entry == null ? -1 : module.problems.indexOf(entry);
    if (i === -1 || i === session.problemIndex) return;
    saveIfChanged();
    session.selectProblem(i);
    setCheck(null);
  }, [props.problem, module, session, saveIfChanged]);

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
    () => listFromModel(new ProblemListModel(module.problems, module.exercises, { problemIndex: session.problemIndex, restrict: module.options.monoProbs }), module.problems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [module, moduleVersion, session.problemIndex],
  );

  const isUserProblem = session.problemIndex === -1 && session.problem.statement != null;
  const isExercise = module.isExercise(session.problem.problemName);

  /** Before leaving an unsaved user problem: save it, discard it, or stay. */
  const confirmLeave = async (): Promise<boolean> => {
    if (readOnly || session.problemIndex !== -1 || session.getChangedProblem() == null) return true;
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
    const n = nextProblem(list.rows, session.problemIndex === -1 ? props.problem : session.problem.problemName, delta);
    if (n) void open(n);
    else listRef.current?.focusSearch();
  };

  const saveAs = async (): Promise<boolean> => {
    const ok = await session.save(moduleDialogs);
    if (ok && session.problem.problemName) {
      dialogs.notify(`Saved as “${session.problem.problemName}”.`, { tone: 'success' });
      openProblem(session.problem.problemName, { replace: true });
    }
    return ok;
  };

  const save = () => {
    if (session.problemIndex === -1 || session.dontChange) void saveAs();
    else {
      saveIfChanged();
      dialogs.notify('Saved.', { tone: 'success' });
    }
  };

  const doCheck = () => {
    if (session.checkDisabled) {
      dialogs.notify('Checking is disabled for this problem.');
      return;
    }
    setCheck(session.check());
    saveIfChanged();
  };

  const userProblem = async () => {
    if (!(await confirmLeave())) return;
    const text = await dialogs.prompt({
      title: 'User problem',
      prompt: 'Type a string to parse: a formula in official or informal notation, or something that is not well formed.',
      label: 'String',
      formula: true,
      initial: session.lastUserProblem ?? '',
      confirmLabel: 'Parse it',
      validate: (v) => (v.trim() === '' ? 'Type something to parse.' : null),
    });
    if (text == null) return;
    saveIfChanged();
    session.loadUserProblem(text);
    setCheck(null);
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
    setCheck(null);
  };

  const deleteProblem = async () => {
    if (!(await dialogs.confirm({ title: 'Delete this problem?', body: 'It is removed from your problem list.', confirmLabel: 'Delete problem', danger: true }))) return;
    session.deleteProblem();
    setCheck(null);
    openProblem(null);
  };

  const deleteSeveral = async () => {
    const r = await pickProblems(module.problems, {
      title: 'Delete work or problems',
      prompt: 'Choose problems. “Delete work” clears your work on them (worked examples are kept); “Delete problems” removes your own problems (course problems are kept).',
      actions: [
        { value: 'work', label: 'Delete work', danger: true },
        { value: 'problems', label: 'Delete problems', danger: true },
      ],
    });
    if (!r) return;
    const current = session.problemIndex;
    const name = session.problem.problemName;
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
    setCheck(null);
  };

  const print = async (kind: 'results' | 'list') => {
    saveIfChanged();
    const r = await pickProblems(module.problems, {
      title: kind === 'results' ? 'Print results' : 'Print problem list',
      actions: [{ value: 'print', label: 'Print' }],
      exclude: module.options.noPrint,
      initial: session.problemIndex >= 0 ? [session.problemIndex] : [],
    });
    if (!r) return;
    const items = kind === 'results' ? module.getResults(r.indices) : module.getStatements(r.indices);
    setPrinting({
      title: 'Parsing — ' + (kind === 'results' ? 'Results' : 'Problems'),
      items: items.map((it) => ({ key: it.index, code: it.stateCode, text: it.text })),
    });
  };
  const donePrinting = useCallback(() => setPrinting(null), []);

  const p = session.problem;
  const tree = p.tree;
  const entryState = session.problemIndex >= 0 ? module.problems.getEntryAt(session.problemIndex)?.state : undefined;
  const status = session.status.trim() !== '' ? { text: session.status.trim(), tone: tone(session.status.trim()) } : (entryState ?? null);
  const hasProblem = p.statement != null;
  const treeStatus = tree.statusLabel.trim();

  const header = (
    <ProblemHeader
      name={hasProblem ? (session.title ?? (isUserProblem ? 'User problem' : 'Problem')) : 'Parsing'}
      statement={hasProblem ? p.statement! : undefined}
      status={hasProblem ? status : null}
      note={session.note}
    />
  );

  const toolbar = (
    <Toolbar label="Parsing">
      <ToolButton label="Select problem" shortcut="Mod+O" showShortcut={false} onClick={() => listRef.current?.focusSearch()} />
      <ToolButton label="Previous" shortcut="Alt+ArrowUp" showShortcut={false} onClick={() => go(-1)} />
      <ToolButton label="Next" shortcut="Alt+ArrowDown" altShortcuts={['Alt+N']} showShortcut={false} onClick={() => go(1)} />
      {!readOnly && (
        <>
          <ToolbarSeparator />
          <ToolButton label="Check" variant="primary" shortcut="Mod+K" disabled={!hasProblem || session.checkDisabled} onClick={doCheck} />
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
          { label: 'Print this problem', shortcut: 'Mod+P', disabled: !hasProblem, onSelect: () => window.print() },
          { label: 'Print results…', description: 'The chosen problems with their states.', onSelect: () => void print('results') },
          { label: 'Print problem list…', description: 'The chosen problems’ strings.', onSelect: () => void print('list') },
        ]}
      />
    </Toolbar>
  );

  const message = check ? <MessageView message={checkMessage(check)} onDismiss={() => setCheck(null)} explain /> : null;

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
          selected={session.problemIndex === -1 ? null : session.problem.problemName}
          onOpen={(id) => void open(id)}
        />
      }
      header={header}
      toolbar={toolbar}
      message={message}
    >
      {!hasProblem ? (
        <div className="parsing-empty">
          <p>Choose a problem from the list{readOnly || module.options.noUser ? '' : ', or make up your own with User problem'}.</p>
          <p className="muted">
            For each string, say whether it is a formula in official notation, a formula in informal notation, or not well formed. Then take the formula
            apart: click the main connective of each part until only sentence letters and atomic formulas are left.
          </p>
        </div>
      ) : (
        <div className="parsing-work">
          <fieldset className="notation-chooser" disabled={readOnly}>
            <legend>This string is</legend>
            {NOTATION_LABELS.map((label, i) => (
              <label key={i} className={'notation-option' + (p.notationIndex === i ? ' is-on' : '')}>
                <input type="radio" name="notation" checked={p.notationIndex === i} onChange={() => session.selectNotation(i)} />
                <span>{label === 'Not Well Formed' ? 'not well formed' : 'a formula in ' + label.toLowerCase()}</span>
              </label>
            ))}
            {p.resultText.trim() !== '' && (
              <div className="notation-result">
                <StatusPill status={{ text: p.resultText.trim(), tone: tone(p.resultText.trim()) }} />
              </div>
            )}
          </fieldset>

          <section className="parse-tree-panel" aria-label="Parse tree">
            <div className="parse-tree-head">
              <h2 className="parse-tree-title">{session.noDescent ? 'Main connective' : 'Parse tree'}</h2>
              {treeStatus !== '' && tree.visible && <StatusPill status={{ text: treeStatus, tone: tone(treeStatus) }} />}
            </div>
            {!tree.visible ? (
              <p className="muted">Choose the right notation above; then the formula can be taken apart here.</p>
            ) : (
              <>
                {!readOnly && <p className="parse-tree-help muted">
                  {p.notationIndex === 2
                    ? 'You said the string is not well formed, so there is nothing to take apart.'
                    : session.noDescent
                      ? 'Click the main connective of the formula (or move to it with the arrow keys and press Enter).'
                      : 'Click the main connective of a formula to break it into its parts (or use the arrow keys and Enter). Go on until every part is a sentence letter or an atomic formula.'}
                </p>}
                <div className={p.notationIndex === 2 ? 'is-dimmed' : undefined}>
                  <ParseTreeView root={tree.root} disabled={readOnly || p.notationIndex === 2} mainOnly={session.noDescent} onClick={(node, i) => session.click(node, i)} />
                </div>
              </>
            )}
            {entryState === STATE_CORRECT && session.status.trim() === '' && <p className="muted small">This problem is marked correct in {readOnly ? 'the' : 'your'} list.</p>}
          </section>
        </div>
      )}
      <PrintSheet title={printing?.title ?? ''} items={printing?.items ?? null} onDone={donePrinting} />
    </ModuleLayout>
  );
}

