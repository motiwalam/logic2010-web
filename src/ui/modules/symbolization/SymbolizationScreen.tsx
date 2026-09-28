// The Symbolization screen (the desktop's LPSymbolizer window): the problem's English and
// scheme of abbreviation, the formula built so far, and the symbolization tree the student
// builds by choosing each part's connective and writing the English of its parts.
//
// Saving: the desktop saves when asked (Save, or "save changes?" on leaving). Here work on a
// problem of the list is saved to the workspace as it changes (a second after the last edit,
// on Check and on leaving). A user problem, or a changed worked example, is saved under a name
// the student gives (Save…), and leaving it unsaved asks first.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAnswers,
  getPrintProblems,
  getResults,
  getStatements,
  LPSymbolizer,
  type MenuItem as SymMenuItem,
  performMenuItem,
  type HintResult,
  type SymbolizationError,
  type SymbolizationModule,
  type SymbolizationNode,
} from '../../../engine/modules/symbolization';
import { ProblemListModel } from '../../../engine/problems/ProblemList';
import { MessageView, type MessageLike } from '../../components/MessageView';
import { ModuleLayout, ProblemHeader } from '../../components/ModuleLayout';
import { nextProblem, ProblemList, type ProblemListHandle } from '../../components/ProblemList';
import { Menu, Toolbar, ToolButton, ToolbarSeparator } from '../../components/Toolbar';
import { dialogs } from '../../dialogs/dialogs';
import { listFromModel } from '../problemRows';
import type { ModuleProps } from '../registry';
import { showAnswerManager, showNodeMessage, showSchemeDialog } from './SymbolizationDialogs';
import { locate, StaticTree, SymbolizationTree, type TreeHandle } from './SymbolizationTree';
import { pickProblems, PrintSheet, type PrintItem, showNotice, symbolizationUi, useSession, useSymbolizationWork } from './support';
import './symbolization.css';

export default function SymbolizationScreen(props: ModuleProps) {
  const { module, error } = useSymbolizationWork(props);
  if (error) {
    return (
      <div className="page-state" role="alert">
        <h2>The symbolization work could not be read.</h2>
        <p className="muted">{error === 'not003' ? 'The work file does not match its digest (it was changed outside the program).' : error}</p>
      </div>
    );
  }
  if (!module) return <div className="page-state" aria-busy="true">Loading the symbolization problems…</div>;
  return <SymbolizationWork key={props.readOnly ? 'ro' : 'rw'} module={module} props={props} />;
}

type Tone = 'good' | 'bad' | 'warn' | 'neutral';

function statusTone(s: string): Tone {
  if (s === 'Correct' || s === 'Correct Equivalent') return 'good';
  if (s === 'Incomplete' || s.startsWith('Duplicate')) return 'warn';
  if (s === 'Answer Not Available') return 'neutral';
  return 'bad';
}

function checkMessage(status: string): MessageLike | null {
  if (status === 'Correct') return { title: 'Correct. Well done.', isError: false, expanded: true };
  if (status === 'Correct Equivalent')
    return { title: 'Correct: your symbolization is equivalent to an answer.', text: 'It is built differently from the answers, but it says the same.', isError: false, expanded: true };
  if (status === 'Equivalent, but Incorrect')
    return {
      title: 'Equivalent, but incorrect.',
      text: 'Your formula is truth-functionally equivalent to an answer, but it does not follow the structure of the English. Break the sentence down the way it is built.',
      isError: true,
      expanded: true,
    };
  if (status === 'Incomplete') return { title: 'Incomplete: every part must end in an atomic expression.', text: 'The parts still marked “?” need a connective.', isError: true, expanded: true };
  if (status.startsWith('Duplicate')) return { title: status.replace('\n', ' ') + '.', text: 'You have already given this answer for another problem of the group.', isError: true, expanded: true };
  if (status.startsWith('Incorrect'))
    return {
      title: status === 'Incorrect' ? 'Incorrect.' : 'Incorrect: the quantifier is unrestricted.',
      text:
        (status === 'Incorrect' ? '' : 'A universal generalization usually restricts with a conditional, an existential one with a conjunction. ') +
        'The parts that do not match the closest answer have an Error button: click it for an explanation.',
      isError: true,
      expanded: true,
    };
  return null;
}

function SymbolizationWork({ module, props }: { module: SymbolizationModule; props: ModuleProps }) {
  const { readOnly, openProblem } = props;
  const session = useMemo(() => {
    const s = new LPSymbolizer(module, { ui: symbolizationUi });
    s.onNotice = showNotice;
    module.onNotice = showNotice;
    return s;
  }, [module]);
  const version = useSession(session);
  const [listVersion, setListVersion] = useState(0);
  const listRef = useRef<ProblemListHandle>(null);
  const treeRef = useRef<TreeHandle>(null);
  const [focused, setFocused] = useState<SymbolizationNode | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [printing, setPrinting] = useState<{ title: string; items: PrintItem[] } | null>(null);
  const p = session.problem;

  const autoSaves = !readOnly && session.problemIndex !== -1 && !session.dontChange;
  const saveIfChanged = useCallback(() => {
    if (readOnly || session.problemIndex === -1 || session.dontChange) return;
    const record = session.getChangedProblem();
    if (record == null) return;
    void session.saveProblems(record).then(() => setListVersion((v) => v + 1));
  }, [readOnly, session]);

  // save a second after the last change
  useEffect(() => {
    if (!autoSaves) return;
    const t = setTimeout(saveIfChanged, 1000);
    return () => clearTimeout(t);
  }, [version, autoSaves, saveIfChanged]);

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

  const loaded = () => {
    setChecked(null);
    setFocused(session.problem);
    treeRef.current?.focusNode(session.problem);
  };

  // open the problem named in the URL
  useEffect(() => {
    const name = props.problem;
    if (name == null) {
      if (session.problemIndex !== -1) {
        saveIfChanged();
        session.newProblem();
        setChecked(null);
      }
      return;
    }
    const entry = module.problems!.getEntry(name);
    const i = entry == null ? -1 : module.problems!.indexOf(entry);
    if (i === -1 || i === session.problemIndex) return;
    saveIfChanged();
    session.selectProblem(i);
    loaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.problem, module, session, saveIfChanged]);

  const list = useMemo(
    () =>
      listFromModel(
        new ProblemListModel(module.problems!, module.exercises, { problemIndex: session.problemIndex, restrict: module.selector('monoProbs') }),
        module.problems!,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [module, listVersion, session.problemIndex],
  );

  const hasProblem = p.statement != null;
  const unsavedCopy = session.problemIndex === -1 || session.dontChange;

  /** Before leaving a user problem or a changed example: save it, discard it, or stay. */
  const confirmLeave = async (): Promise<boolean> => {
    if (readOnly || !unsavedCopy || session.getChangedProblem() == null) return true;
    const r = await dialogs.message({
      title: 'Do you wish to save the current problem?',
      text: session.dontChange ? 'This is a worked example: your changes are saved as a copy under a name you choose.' : 'It is not in your problem list yet. Saved, it is kept under a name you choose.',
      buttons: 'Save:save. Discard:discard. Cancel:cancel;0',
    });
    if (r?.action === 'discard') return true;
    if (r?.action !== 'save') return false;
    return saveNamed();
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

  /** Save… (a user problem, or a copy of an example): asks for a name. */
  const saveNamed = async (): Promise<boolean> => {
    const ok = session.dontChange ? await session.saveAs() : await session.saveProblems(session.saveProblem());
    setListVersion((v) => v + 1);
    if (ok && p.problemName) {
      dialogs.notify(`Saved as “${p.problemName}”.`, { tone: 'success' });
      openProblem(p.problemName, { replace: true });
    }
    return ok;
  };

  const save = () => {
    if (unsavedCopy) void saveNamed();
    else {
      saveIfChanged();
      dialogs.notify('Saved.', { tone: 'success' });
    }
  };

  const saveCopy = async () => {
    const ok = await session.saveAs();
    setListVersion((v) => v + 1);
    if (ok && p.problemName) {
      dialogs.notify(`Saved a copy as “${p.problemName}”.`, { tone: 'success' });
      openProblem(p.problemName, { replace: true });
    }
  };

  const check = () => {
    const status = session.check();
    setChecked(status);
    saveIfChanged();
  };

  // ---- the tree ----

  const handleHint = (r: HintResult) => {
    if (r.kind === 'hint') void showNodeMessage(r.message, true);
    else if (r.kind === 'error') dialogs.notify('A part above this one is already wrong: see its Error button.', { tone: 'error' });
    else dialogs.notify('No hint is available here.');
  };

  const onHint = (node: SymbolizationNode) => {
    if (!session.canHint()) {
      dialogs.notify('Hints are disabled for this problem.');
      return;
    }
    handleHint(session.showHint(node));
  };

  const onApply = async (node: SymbolizationNode, kind: number) => {
    const next = await session.applyConnective(node, kind);
    if (next === 'beep') {
      const parent = node.getParentNode()!;
      const want = parent.argTypes[parent.indexOfChildNode(node)] === 1 ? 'a term' : 'a formula';
      dialogs.notify(`That does not fit here: this part must be ${want}.`, { tone: 'error' });
      return;
    }
    const to = next ?? node;
    setFocused(to);
    treeRef.current?.focusNode(to);
  };

  const onMenuItem = async (node: SymbolizationNode, item: SymMenuItem, field: HTMLTextAreaElement | null) => {
    if (item.edit) {
      if (!field) return;
      field.focus();
      const s = field.selectionStart;
      const e = field.selectionEnd;
      const sel = node.text.substring(s, e);
      const replace = (t: string) => {
        node.setText(node.text.substring(0, s) + t + node.text.substring(e));
        requestAnimationFrame(() => field.setSelectionRange(s + t.length, s + t.length));
      };
      if (item.label === 'Select All') field.select();
      else if (item.label === 'Copy') void navigator.clipboard?.writeText(sel);
      else if (item.label === 'Cut') {
        void navigator.clipboard?.writeText(sel);
        replace('');
      } else if (item.label === 'Clear') replace('');
      else if (item.label === 'Paste') {
        const t = await navigator.clipboard?.readText().catch(() => null);
        if (t != null) replace(t);
      }
      return;
    }
    const r = await performMenuItem(session, node, item.label);
    if (r.kind === 'hint') handleHint(r.result);
    else if (r.kind === 'focus') {
      const to = r.node ?? node;
      setFocused(to);
      treeRef.current?.focusNode(to);
    }
  };

  const onError = (err: SymbolizationError) => {
    const msg = session.openError(err);
    if (msg) void showNodeMessage(msg, false);
  };

  // ---- toolbar actions ----

  const direct = async () => {
    if (!session.canEnterDirectly()) return;
    const text = await dialogs.prompt({
      title: 'Direct symbolization',
      prompt: 'Type the whole symbolization. The tree is built from it (with the English of the closest answer where it matches).',
      label: 'Formula',
      formula: true,
      initial: session.lastDirect,
      confirmLabel: 'Build tree',
    });
    if (text == null) return;
    session.enterDirectSymbolization(text);
    setChecked(null);
    loaded();
  };

  const userProblem = async () => {
    if (!(await confirmLeave())) return;
    const text = await dialogs.prompt({
      title: 'User problem',
      prompt: 'Type an English sentence to symbolize.',
      label: 'Sentence',
      initial: session.userProblemText(),
      confirmLabel: 'Next: the scheme',
      validate: (v) => (v.trim() === '' ? 'Type a sentence.' : null),
    });
    if (text == null) return;
    saveIfChanged();
    if (!session.createUserProblem(text)) return;
    if (props.problem != null) openProblem(null);
    const editor = await showSchemeDialog(session, session.createScheme(), true);
    if (editor) session.acceptScheme(editor);
    loaded();
  };

  const editStatement = async () => {
    const s = session.editStatement();
    if (s == null) return;
    const text = await dialogs.prompt({ title: 'Edit statement', label: 'Sentence', initial: s, confirmLabel: 'OK' });
    if (text != null) session.editStatementDone(text);
  };

  const editScheme = async () => {
    const editor = session.editScheme();
    if (!editor) return;
    const r = await showSchemeDialog(session, editor, false);
    if (r) session.acceptScheme(r);
  };

  const answers = async () => {
    const manager = session.openAnswerManager();
    if (!manager) return;
    await showAnswerManager(manager, () => setListVersion((v) => v + 1));
    // Add saves a new problem under a name: show it as the list's problem
    if (session.problemIndex !== -1 && p.problemName && p.problemName !== props.problem) openProblem(p.problemName, { replace: true });
  };

  const deleteCurrent = async () => {
    const { choices, confirm } = session.deleteChoices();
    if (choices.length === 0) {
      dialogs.notify('There is no work on this problem to delete.');
      return;
    }
    let what: 'work' | 'problem' | null = choices[0];
    if (choices.length > 1) {
      what = await dialogs.choose({
        title: 'Delete',
        choices: [
          { value: 'work' as const, label: 'Delete the work on this problem' },
          { value: 'problem' as const, label: 'Delete this problem', description: 'It is removed from your problem list.' },
        ],
      });
    } else if (confirm) {
      const ok = await dialogs.confirm({
        title: what === 'work' ? 'Delete the work on this problem?' : 'Delete this problem?',
        confirmLabel: what === 'work' ? 'Delete work' : 'Delete problem',
        danger: true,
      });
      if (!ok) what = null;
    }
    if (what === 'work') {
      const i = session.problemIndex;
      session.deleteWork();
      // the desktop's reload forgets the problem's index: keep it open as the list's problem
      if (i !== -1) session.selectProblem(i);
      setListVersion((v) => v + 1);
      loaded();
    } else if (what === 'problem') {
      session.deleteProblem();
      setListVersion((v) => v + 1);
      openProblem(null);
      loaded();
    }
  };

  const deleteSeveral = async () => {
    const r = await pickProblems(module.problems!, {
      title: 'Delete work or problems',
      prompt: 'Choose problems. “Delete work” clears your work on them (worked examples are kept); “Delete problems” removes your own problems (course problems are kept).',
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
      if (r.indices.includes(current)) {
        session.selectProblem(current);
        loaded();
      }
    } else {
      if (!(await dialogs.confirm({ title: `Delete ${r.indices.length} problem(s)?`, body: 'Course problems are not deleted.', confirmLabel: 'Delete problems', danger: true }))) return;
      module.deleteProblemsAt(r.indices);
      if (r.indices.includes(current) && !module.isExercise(name)) {
        session.newProblem();
        openProblem(null);
      } else if (name != null) {
        const e = module.problems!.getEntry(name);
        if (e) session.problemIndex = module.problems!.indexOf(e);
      }
    }
    setListVersion((v) => v + 1);
  };

  const print = async (kind: 'problems' | 'results' | 'list' | 'answers') => {
    saveIfChanged();
    const set = kind === 'answers' ? module.exercises! : module.problems!;
    const r = await pickProblems(set, {
      title: { problems: 'Print problems', results: 'Print results', list: 'Print problem list', answers: 'Print answers' }[kind],
      actions: [{ value: 'print', label: 'Print' }],
      exclude: kind === 'answers' ? null : module.selector('noPrint'),
      initial: kind !== 'answers' && session.problemIndex >= 0 ? [session.problemIndex] : [],
    });
    if (!r) return;
    let items: PrintItem[];
    if (kind === 'list') items = getStatements(module, r.indices).map((text, k) => ({ key: k, text }));
    else if (kind === 'answers') items = getAnswers(module, r.indices).map((text, k) => ({ key: k, text }));
    else {
      const printed = kind === 'results' ? getResults(module, r.indices) : getPrintProblems(module, r.indices);
      items = printed.map((it, k) => ({ key: k, code: it.code, text: it.text, extra: kind === 'problems' ? <StaticTree node={it.session.problem} /> : undefined }));
    }
    setPrinting({ title: 'Symbolization — ' + { problems: 'Problems', results: 'Results', list: 'Problem list', answers: 'Answers' }[kind], items });
  };
  const donePrinting = useCallback(() => setPrinting(null), []);

  // ---- rendering ----

  const entryState = session.problemIndex >= 0 ? module.problems!.getEntryAt(session.problemIndex)?.state : undefined;
  const statusText = (session.status ?? '').trim();
  const status = statusText !== '' ? { text: statusText.replace('\n', ' '), tone: statusTone(statusText) } : (entryState ?? null);
  const isUserProblem = session.problemIndex === -1 && hasProblem;
  const message = checked != null && checked === session.status ? checkMessage(checked) : null;
  const formula = session.symbolization;
  const span = focused && focused !== p && focused.parent != null ? locate(p, focused) : null;

  const header = (
    <ProblemHeader
      name={hasProblem ? (session.title ?? (isUserProblem ? 'User problem' : 'Problem')) : 'Symbolization'}
      statement={hasProblem ? <span className="sym-statement">{p.statement}</span> : undefined}
      status={hasProblem ? status : null}
      note={session.note}
    />
  );

  const toolbar = (
    <Toolbar label="Symbolization">
      <ToolButton label="Select problem" shortcut="Mod+O" showShortcut={false} onClick={() => listRef.current?.focusSearch()} />
      <ToolButton label="Previous" shortcut="Alt+PageUp" showShortcut={false} onClick={() => go(-1)} />
      <ToolButton label="Next" shortcut="Alt+PageDown" showShortcut={false} onClick={() => go(1)} />
      {!readOnly && (
        <>
          <ToolbarSeparator />
          <ToolButton label="Check" variant="primary" shortcut="Mod+K" disabled={!hasProblem || session.checkDisabled} onClick={check} />
          <ToolButton label="Direct…" disabled={!hasProblem || session.directEntryDisabled} title="Enter the symbolization as a formula" onClick={() => void direct()} />
          <ToolButton label={unsavedCopy ? 'Save…' : 'Save'} shortcut="Mod+S" showShortcut={false} disabled={!hasProblem} onClick={save} />
          <ToolButton label="User problem…" disabled={module.noUser} onClick={() => void userProblem()} />
          <Menu
            label="Problem"
            buttonClass="btn tool-btn"
            items={[
              { label: 'Save a copy under a new name…', disabled: !hasProblem, onSelect: () => void saveCopy() },
              'separator',
              { label: 'Edit statement…', description: 'Your own problems only.', disabled: !hasProblem, onSelect: () => void editStatement() },
              { label: 'Edit scheme…', description: 'Your own problems only.', disabled: !hasProblem, onSelect: () => void editScheme() },
              { label: 'Answers…', description: 'The Answer Manager of your own problems.', disabled: !hasProblem, onSelect: () => void answers() },
              'separator',
              { label: 'Delete…', description: 'The work on this problem, or the problem.', disabled: !hasProblem, onSelect: () => void deleteCurrent() },
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
          { label: 'Print problems…', description: 'The chosen problems with their trees.', onSelect: () => void print('problems') },
          { label: 'Print results…', description: 'The chosen problems with their states and formulas.', onSelect: () => void print('results') },
          { label: 'Print problem list…', description: 'The chosen problems’ sentences and schemes.', onSelect: () => void print('list') },
        ]}
      />
    </Toolbar>
  );

  const scheme = hasProblem ? (
    <section className="sym-scheme" aria-label="Scheme of abbreviation">
      <h2 className="sym-panel-title">Scheme</h2>
      {session.schemeRows.length === 0 ? (
        <p className="muted small">No scheme.</p>
      ) : (
        <dl className="sym-scheme-list">
          {session.schemeRows.map((r, i) => (
            <div key={i} className="sym-scheme-row">
              <dt className="formula">{r.symbol}</dt>
              <dd>{r.english}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  ) : undefined;

  return (
    <ModuleLayout
      sidebar={
        <ProblemList
          ref={listRef}
          rows={list.rows}
          filter={list.filter}
          countLabel={list.countLabel}
          selected={session.problemIndex === -1 ? null : p.problemName}
          onOpen={(id) => void open(id)}
        />
      }
      header={header}
      toolbar={toolbar}
      message={message ? <MessageView message={message} onDismiss={() => setChecked(null)} explain /> : null}
      aside={scheme}
    >
      {!hasProblem ? (
        <div className="sym-empty">
          <p>Choose a problem from the list{readOnly || module.noUser ? '' : ', or write your own sentence with User problem'}.</p>
          <p className="muted">
            Break the English sentence down step by step: choose the main connective of each part (Enter or right-click on its text opens the menu), then
            write the English of its parts, until every part is an atomic expression of the scheme.
          </p>
        </div>
      ) : (
        <div className="sym-work">
          <section className="sym-formula-panel" aria-label="The symbolization so far">
            <h2 className="sym-panel-title">Symbolization</h2>
            <div className="sym-formula formula" aria-live="polite">
              {span ? (
                <>
                  {formula.substring(0, span[0])}
                  <mark className="sym-formula-focus">{formula.substring(span[0], span[1])}</mark>
                  {formula.substring(span[1])}
                </>
              ) : (
                formula
              )}
            </div>
          </section>
          <SymbolizationTree
            ref={treeRef}
            session={session}
            readOnly={readOnly}
            focused={focused}
            onFocusNode={setFocused}
            onApply={(n, k) => void onApply(n, k)}
            onMenuItem={(n, it, f) => void onMenuItem(n, it, f)}
            onHint={onHint}
            onError={onError}
          />
          {!readOnly && (
            <p className="sym-keys muted small">
              Enter or right-click: connective menu · Ctrl+Shift or Alt + N not, C if-then, A and, O or, B iff, U every, E some, D the, = equality, M member, 2 atomic, T truncate ·
              Alt+/ hint · Alt+arrows move · Ctrl+Enter new line
            </p>
          )}
        </div>
      )}
      <PrintSheet title={printing?.title ?? ''} items={printing?.items ?? null} onDone={donePrinting} />
    </ModuleLayout>
  );
}
