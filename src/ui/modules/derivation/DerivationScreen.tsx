// The Derivations screen (the desktop's Derivation window, LPDerivation): prove arguments in
// Kalish–Montague style natural deduction, line by line, with the desktop's command mode (a
// line is checked when you press Enter; a rule that closes a box boxes and cancels it), Show
// lines, boxes, the rule queries, Check, and the Stack and Applicable panels.
//
// Saving follows the other screens: the work on a course problem is saved when it is checked
// and when the student leaves it; a user problem (or a worked example, which may not change)
// is saved under a name the student gives. A link from another module (`?new=`) opens its
// argument as a new user problem.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TaggedRecord } from '../../../engine/data/TaggedRecord';
import { loadTips } from '../../../engine/program/loadProgram';
import { DerivationConfig } from '../../../engine/modules/derivation/DerivationConfig';
import { DerivationLine } from '../../../engine/modules/derivation/DerivationLine';
import { ALT, CTRL, SHIFT, VK_DOWN, VK_LEFT, VK_RIGHT, VK_UP, type DerivationLineEditor } from '../../../engine/modules/derivation/DerivationLineEditor';
import { hasWork as recordHasWork, getProblemStatement } from '../../../engine/modules/derivation/DerivationProblemSet';
import { DerivationWorkspace } from '../../../engine/modules/derivation/DerivationWorkspace';
import { expandDerivation, ExpandError } from '../../../engine/modules/derivation/expandDerivation';
import { tidyDerivation } from '../../../engine/modules/derivation/tidyDerivation';
import { LPDerivation } from '../../../engine/modules/derivation/LPDerivation';
import * as ops from '../../../engine/modules/derivation/problemOperations';
import { HeadlessDialogs } from '../../../engine/modules/derivation/QueryDialog';
import type { Applicable } from '../../../engine/modules/derivation/DerivationRulesView';
import { ProblemListModel } from '../../../engine/problems/ProblemList';
import { STATE_CODES, STATE_CORRECT } from '../../../engine/problems/ProblemEntry';
import { ErrorRef, Message } from '../../../engine/program/Message';
import { selectorMatches } from '../../../engine/program/LogicProgram';
import { derModule } from '../../../engine/program/ModuleConstants';
import { maggie, symbols, translateSymbols } from '../../../engine/program/symbols';
import { useWorkRevision } from '../../app/context';
import { ModuleLayout, ProblemHeader } from '../../components/ModuleLayout';
import { nextProblem, ProblemList, type ProblemListHandle } from '../../components/ProblemList';
import { Menu, Toolbar, ToolButton, ToolbarSeparator } from '../../components/Toolbar';
import { useShortcuts } from '../../components/shortcuts';
import { dialogs } from '../../dialogs/dialogs';
import { pickProblems, PrintSheet, type PrintSheetItem, workUser } from '../parsing/shared';
import { listFromModel } from '../problemRows';
import { FormulaSearchHelp } from '../../components/FormulaSearchHelp';
import type { ModuleProps } from '../registry';
import { useModel, useNewProblemParam } from '../truth/common';
import { DerivationEditor, type DerivationEditorHandle } from './DerivationEditor';
import { explainLine, KEYS, PrintedDerivation, showAdvice, showInferenceRules, showKeys } from './extras';
import { uiDerivationDialogs } from './QueryDialogView';
import { RulesPanel, StackPanel } from './SidePanels';
import { type TidyCandidate, tidyDialog } from './TidyDialog';
import './derivation.css';

// ---- loading the work ----

function useDerivationWork(props: ModuleProps): { ws: DerivationWorkspace | null; error: string | null; saved: number; persist: () => void } {
  const { work, workPath, readOnly } = props;
  const revision = useWorkRevision(work);
  const lastText = useRef<string | null | undefined>(undefined);
  const config = useRef<Promise<DerivationConfig> | null>(null);
  const [state, setState] = useState<{ ws: DerivationWorkspace | null; error: string | null }>({ ws: null, error: null });
  const [saved, setSaved] = useState(0);
  const text = work.getFile(workPath);
  const wsRef = useRef<DerivationWorkspace | null>(null);

  useEffect(() => {
    // our own save comes back as a new revision with the text we wrote: no reload
    if (lastText.current !== undefined && text === lastText.current && wsRef.current != null) return;
    let live = true;
    const fileName = workPath.substring(workPath.lastIndexOf('/') + 1);
    (async () => {
      config.current ??= DerivationConfig.load();
      const cfg = await config.current;
      const ws = await DerivationWorkspace.open(cfg, text == null ? null : { fileName, text }, workUser(derModule));
      if (!live) return;
      if (ws.digestCheck != null && !ws.digestCheck.ok) {
        setState({ ws: null, error: 'not003' });
        return;
      }
      if (lastText.current === undefined || lastText.current === null) lastText.current = text;
      wsRef.current = ws;
      setState({ ws, error: null });
    })().catch((e: unknown) => live && setState({ ws: null, error: String(e) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, text, workPath, readOnly]);

  const persist = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || readOnly) return;
    const t = ws.write(workUser(derModule)).text;
    lastText.current = t;
    work.saveFile(workPath, t);
    setSaved((n) => n + 1);
  }, [readOnly, work, workPath]);

  return { ...state, saved, persist };
}

export default function DerivationScreen(props: ModuleProps) {
  const { ws, error, saved, persist } = useDerivationWork(props);
  if (error) {
    return (
      <div className="page-state" role="alert">
        <h2>The derivation work could not be read.</h2>
        <p className="muted">{error === 'not003' ? 'The work file does not match its digest (it was changed outside the program).' : error}</p>
      </div>
    );
  }
  if (!ws) return <div className="page-state" aria-busy="true">Loading the derivation problems…</div>;
  return <DerivationWork ws={ws} saved={saved} persist={persist} props={props} />;
}

// ---- the screen ----

type LineOp = { typed: string; mods: number } | { code: number; mods: number };

const LINE_OPS: { label: string; keys: string; op: LineOp; needsShow?: boolean }[] = [
  { label: 'Check this line', keys: 'Enter', op: { typed: '\n', mods: 0 } },
  { label: 'New line below (no check)', keys: 'Alt+Enter', op: { typed: '\n', mods: ALT } },
  { label: 'Show line / ordinary line', keys: 'Alt+S', op: { typed: '\u0013', mods: SHIFT | CTRL } },
  { label: 'Box and cancel / uncancel', keys: 'Alt+X', op: { typed: '\u0018', mods: SHIFT | CTRL } },
  { label: 'Delete this line', keys: 'Alt+Delete', op: { typed: '\u007f', mods: ALT } },
  { label: 'Into the open box above', keys: 'Alt+→', op: { code: VK_RIGHT, mods: ALT } },
  { label: 'Out of the box', keys: 'Alt+←', op: { code: VK_LEFT, mods: ALT } },
  { label: 'Collapse this box', keys: 'Alt+↑', op: { code: VK_UP, mods: ALT }, needsShow: true },
  { label: 'Expand this box', keys: 'Alt+↓', op: { code: VK_DOWN, mods: ALT }, needsShow: true },
];

const PANELS_KEY = 'logic2010:derivation-panels';

function loadPanels(): { stack: boolean; rules: boolean } {
  try {
    const raw = localStorage.getItem(PANELS_KEY);
    if (raw) return { stack: false, rules: false, ...(JSON.parse(raw) as object) };
  } catch {
    // defaults
  }
  // open by default where they fit beside the derivation; on narrow screens they would push it down
  const wide = typeof matchMedia === 'undefined' || matchMedia('(min-width: 70rem)').matches;
  return { stack: wide, rules: wide };
}

function toneOf(s: string): 'good' | 'bad' | 'warn' | 'neutral' {
  return s === 'Correct' ? 'good' : s === 'Incorrect' ? 'bad' : s === 'Incomplete' ? 'warn' : 'neutral';
}

function DerivationWork({ ws, saved, persist, props }: { ws: DerivationWorkspace; saved: number; persist: () => void; props: ModuleProps }) {
  const { readOnly, openProblem } = props;
  const m = useMemo(() => new LPDerivation(ws, { dialogs: uiDerivationDialogs(), hasFrame: true, doSubs: true }), [ws]);
  const version = useModel(m);
  const [panels, setPanels] = useState<{ stack: boolean; rules: boolean }>(loadPanels);
  const showStack = panels.stack;
  const showRules = panels.rules;
  const listRef = useRef<ProblemListHandle>(null);
  const editorRef = useRef<DerivationEditorHandle>(null);
  const busyCount = useRef(0);
  const [cursor, setCursor] = useState(0);
  const [printing, setPrinting] = useState<{ title: string; items: PrintSheetItem[] } | null>(null);
  const newParam = useNewProblemParam();
  const busy = useCallback(() => busyCount.current > 0, []);

  const run = useCallback(
    async (op: () => unknown) => {
      busyCount.current++;
      try {
        await m.run(op);
      } catch (e) {
        dialogs.notify('Something went wrong: ' + String(e), { tone: 'error' });
      } finally {
        busyCount.current--;
        setCursor((n) => n + 1);
      }
    },
    [m],
  );

  const saveIfChanged = useCallback(async () => {
    if (readOnly || m.problemIndex === -1 || m.dontChange) return;
    const record = m.getChangedProblem();
    if (record == null) return;
    await ops.saveProblemRecord(m, record);
    persist();
  }, [readOnly, m, persist]);

  // a link from another module: its argument as a new user problem
  useEffect(() => {
    if (newParam == null) return;
    void (async () => {
      await saveIfChanged();
      m.loadProblem(newParam.includes('`') ? newParam : TaggedRecord.toLine(TaggedRecord.formatField(newParam, '-') + TaggedRecord.formatField('', '=')));
      m.changed();
      openProblem(null, { replace: true });
      requestAnimationFrame(() => editorRef.current?.focusCurrent());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newParam]);

  // open the problem named in the URL
  useEffect(() => {
    if (newParam != null) return;
    const name = props.problem;
    if (name == null) {
      if (m.problemIndex !== -1) {
        void (async () => {
          await saveIfChanged();
          m.newProblem();
          m.changed();
        })();
      }
      return;
    }
    const entry = ws.problems.getEntry(name);
    const i = entry == null ? -1 : ws.problems.indexOf(entry);
    if (i === -1 || i === m.problemIndex) return;
    void (async () => {
      busyCount.current++;
      try {
        await saveIfChanged();
        await ops.openProblem(m, i);
      } finally {
        busyCount.current--;
      }
      m.changed();
      requestAnimationFrame(() => editorRef.current?.focusCurrent());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.problem, ws, newParam]);

  // save when leaving
  useEffect(() => {
    const save = () => void saveIfChanged();
    const onHide = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', save);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [saveIfChanged]);

  const list = useMemo(
    () => listFromModel(new ProblemListModel(ws.problems, ws.problems.exercises, { problemIndex: m.problemIndex, restrict: ops.listSelector(m) }), ws.problems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, saved, m.problemIndex, version],
  );

  const statement = m.problem.getFormulaText(false) ?? '';
  const hasProblem = statement.trim() !== '';
  const isUserProblem = m.problemIndex === -1 && hasProblem;
  const title = m.problemTitle;
  const isExample = ws.isExample(title);

  // ---- flows ----

  const askName = async (initial: string): Promise<string | null> =>
    dialogs.prompt({
      title: 'Save the problem',
      prompt: 'Please supply a name for this problem',
      label: 'Name',
      initial,
      confirmLabel: 'Save',
      validate: (v) => {
        const r = ops.validateProblemName(m, v);
        return r instanceof ErrorRef ? Message.substitute(Message.get(r.id).text, r.params == null ? null : new Map(r.params)).replace(/\\n/g, ' ') : null;
      },
    });

  const saveAs = async (rename: boolean): Promise<boolean> => {
    const name = await askName(ops.proposedProblemName(m, rename));
    if (name == null) return false;
    let ok = false;
    await run(async () => {
      ok = rename ? await ops.saveRenamed(m, m.saveProblem(), name.trim()) : await ops.save(m, name.trim());
    });
    if (!ok) return false;
    persist();
    dialogs.notify(`Saved as “${m.problemTitle}”.`, { tone: 'success' });
    if (m.problemTitle) openProblem(m.problemTitle, { replace: true });
    return true;
  };

  const save = async () => {
    if (readOnly || !hasProblem) return;
    if (ops.saveNeedsName(m)) {
      await saveAs(m.dontChange);
      return;
    }
    await run(() => ops.save(m));
    persist();
    dialogs.notify('Saved.', { tone: 'success' });
  };

  const confirmLeave = async (): Promise<boolean> => {
    if (readOnly || m.problemIndex !== -1 || !hasProblem || !ops.hasUnsavedChanges(m)) return true;
    const r = await dialogs.message({
      title: 'Do you wish to save the current problem?',
      text: 'It is not in your problem list yet. Saved, it is kept under a name you choose.',
      buttons: 'Save:save. Discard:discard. Cancel:cancel;0',
      isError: false,
    });
    if (r?.action === 'discard') return true;
    if (r?.action !== 'save') return false;
    return saveAs(false);
  };

  const open = async (name: string | null) => {
    if (name === props.problem && m.problemIndex !== -1) {
      editorRef.current?.focusCurrent();
      return;
    }
    if (!(await confirmLeave())) return;
    openProblem(name);
  };

  const go = (delta: number) => {
    const n = nextProblem(list.rows, m.problemIndex === -1 ? props.problem : title, delta);
    if (n) void open(n);
    else listRef.current?.focusSearch();
  };

  const check = async () => {
    if (!hasProblem) return;
    setExpansion(null);
    await run(() => m.check());
    await saveIfChanged();
    const s = m.titleState.status;
    if (s) dialogs.notify(s === 'Correct' ? 'Correct derivation.' : s === 'Incomplete' ? 'The derivation is incomplete.' : 'The derivation has errors.', { tone: s === 'Correct' ? 'success' : 'info' });
    editorRef.current?.focusCurrent();
  };

  const userProblem = async () => {
    if (!(await confirmLeave())) return;
    const text = await dialogs.prompt({
      title: 'User problem',
      prompt: 'Type an argument: its premises separated by dots, then ∴ (.:) and the conclusion, e.g. P→Q . P ∴ Q. An argument with no premises is a theorem: ∴ P→P.',
      label: 'Argument',
      formula: true,
      initial: ops.lastUserProblemText(m),
      confirmLabel: 'Start',
      validate: (v) => (v.trim() === '' ? 'Type an argument.' : null),
    });
    if (text == null) return;
    await saveIfChanged();
    let ok = false;
    await run(async () => {
      ok = await ops.enterUserProblem(m, text);
    });
    if (!ok) return;
    if (props.problem != null) openProblem(null);
    requestAnimationFrame(() => editorRef.current?.focusCurrent());
  };

  // ---- expand: a read-only view of the derivation with one rule per line ----

  // the expanded view (its own module), of the problem it was made for; the work is not changed
  const [expansion, setExpansion] = useState<{ vm: LPDerivation; index: number; title: string | null; statement: string; before: number; after: number } | null>(null);
  const expandedView =
    expansion != null && expansion.index === m.problemIndex && expansion.title === m.problemTitle && expansion.statement === (m.problem.getFormulaText(false) ?? '')
      ? expansion
      : null;
  const viewVersion = useModel(expandedView?.vm ?? null);
  const viewRun = useCallback(async (op: () => unknown) => {
    if (expandedView != null) await expandedView.vm.run(op);
  }, [expandedView]);

  const toggleExpand = async () => {
    if (expandedView != null) {
      setExpansion(null);
      requestAnimationFrame(() => editorRef.current?.focusCurrent());
      return;
    }
    if (!hasProblem) return;
    let result: Awaited<ReturnType<typeof expandDerivation>>;
    try {
      result = await expandDerivation(ws, m.saveProblem());
    } catch (e) {
      if (!(e instanceof ExpandError)) throw e;
      dialogs.notify(e.message, { tone: 'error' });
      return;
    }
    if (!result.changed) {
      dialogs.notify('Nothing to expand: every line already applies a single rule.');
      return;
    }
    const vm = new LPDerivation(ws, { dialogs: new HeadlessDialogs(), hasFrame: true, doSubs: true });
    vm.loadProblem(result.record);
    vm.problem.expandAll();
    if (!m.checkDisabled) await vm.checkProblem();
    setExpansion({ vm, index: m.problemIndex, title: m.problemTitle, statement: m.problem.getFormulaText(false) ?? '', before: result.linesBefore, after: result.linesAfter });
  };

  // ---- tidy: clean up the derivations of the work ----

  const tidyAll = async () => {
    await saveIfChanged();
    const candidates: TidyCandidate[] = [];
    ws.problems.elements().forEach((entry, i) => {
      const record = ws.problems.getRecordAt(i);
      if (record == null) return;
      const t = new TaggedRecord(record);
      const name = t.getName() ?? '';
      if (!recordHasWork(t) || ws.isExample(name)) return;
      candidates.push({ index: i, name, text: `${name}: ${translateSymbols(getProblemStatement(t) ?? '', maggie, symbols)}` });
    });
    if (candidates.length === 0) {
      dialogs.notify('There are no derivations with work to tidy.');
      return;
    }
    const outcomes = await tidyDialog(candidates, (c, options) => tidyDerivation(ws, ws.problems.getRecordAt(c.index)!, options));
    if (outcomes == null) return;
    await run(async () => {
      for (const { candidate, result } of outcomes) {
        ws.problems.replaceProblem(result.record, candidate.index);
        await ws.updateState(ws.problems.getEntryAt(candidate.index)!);
      }
      if (outcomes.some((o) => o.candidate.index === m.problemIndex)) await ops.openProblem(m, m.problemIndex);
    });
    setExpansion(null);
    persist();
    dialogs.notify(`Tidied ${outcomes.length} derivation${outcomes.length === 1 ? '' : 's'}.`, { tone: 'success' });
  };

  const deleteCurrent = async () => {
    if (ops.deleteKind(m) === 'work') {
      if (!ops.hasWork(m)) return;
      if (!(await dialogs.confirm({ title: 'Delete the work on this problem?', body: isExample ? 'This is a worked example: its lines go from this window only.' : undefined, confirmLabel: 'Delete work', danger: true }))) return;
      let changed = false;
      await run(() => {
        changed = ops.deleteWork(m);
      });
      if (changed) persist();
    } else {
      if (m.problemIndex === -1 && !hasProblem) return;
      if (!(await dialogs.confirm({ title: 'Delete this problem?', body: 'It is removed from your problem list.', confirmLabel: 'Delete problem', danger: true }))) return;
      let changed = false;
      await run(() => {
        changed = ops.deleteProblem(m);
      });
      if (changed) persist();
      openProblem(null);
    }
  };

  const deleteSeveral = async () => {
    await saveIfChanged();
    const r = await pickProblems(ws.problems, {
      title: 'Delete work or problems',
      prompt: 'Choose problems. “Delete work” clears your derivations (worked examples are kept); “Delete problems” removes your own problems (course problems are kept).',
      actions: [
        { value: 'work', label: 'Delete work', danger: true },
        { value: 'problems', label: 'Delete problems', danger: true },
      ],
    });
    if (!r) return;
    const work = r.action === 'work';
    if (!(await dialogs.confirm({ title: work ? `Delete the work on ${r.indices.length} problem(s)?` : `Delete ${r.indices.length} problem(s)?`, confirmLabel: work ? 'Delete work' : 'Delete problems', danger: true }))) return;
    const current = title;
    await run(() => ops.deleteProblems(m, r.indices, work));
    persist();
    const entry = current == null ? null : ws.problems.getEntry(current);
    if (entry == null) {
      m.newProblem();
      openProblem(null);
    } else {
      await run(() => ops.openProblem(m, ws.problems.indexOf(entry)));
    }
  };

  const lineOp = async (op: LineOp) => {
    const editor: DerivationLineEditor | null = m.focus ?? m.lastFocus;
    if (editor == null || !hasProblem) {
      dialogs.notify('Put the cursor in a line first.');
      return;
    }
    if (m.focus !== editor) m.setFocus(editor);
    await run(() => ('typed' in op ? editor.handleKeyTyped(op.typed, op.mods) : editor.handleKeyPressed(op.code, op.mods)));
    editorRef.current?.focusCurrent();
  };

  const useRule = (a: Applicable, line: DerivationLine, caret: number) => {
    if (a.command == null) return;
    editorRef.current?.insertInJustification(line, a.command, caret);
  };

  const togglePanel = (key: 'stack' | 'rules') => {
    const next = { ...panels, [key]: !panels[key] };
    setPanels(next);
    try {
      localStorage.setItem(PANELS_KEY, JSON.stringify(next));
    } catch {
      // not kept
    }
    requestAnimationFrame(() => editorRef.current?.focusCurrent());
  };

  // ---- printing ----

  const print = async (kind: 'problems' | 'results' | 'list') => {
    await saveIfChanged();
    const r = await pickProblems(ws.problems, {
      title: kind === 'problems' ? 'Print derivations' : kind === 'results' ? 'Print results' : 'Print problem list',
      actions: [{ value: 'print', label: 'Print' }],
      exclude: ops.printSelector(m),
      initial: m.problemIndex >= 0 ? [m.problemIndex] : [],
    });
    if (!r) return;
    const items: PrintSheetItem[] = [];
    for (const i of r.indices) {
      const entry = ws.problems.getEntryAt(i)!;
      const record = new TaggedRecord(entry.name);
      const name = record.getName() ?? '';
      const text = `${name}: ${translateSymbols(getProblemStatement(record) ?? '', maggie, symbols)}`;
      if (kind === 'results') {
        const noCode = selectorMatches(m.config.selector('noPrintCheck'), ws.getExerciseTitle(name));
        if (m.config.printIncorrect && entry.state !== 1 && entry.state !== 3) continue;
        items.push({ key: i, code: noCode ? ' ' : STATE_CODES[entry.state], text });
      } else if (kind === 'list') {
        items.push({ key: i, text });
      } else {
        if (m.config.printIncorrect && entry.state !== 1 && entry.state !== 3) continue;
        const pm = new LPDerivation(ws, { dialogs: new HeadlessDialogs(), hasFrame: true, doSubs: true, forPrint: true });
        pm.loadProblem(entry.name);
        pm.problem.expandAll();
        if (recordHasWork(record)) await pm.checkProblem();
        items.push({ key: i, text, extra: <PrintedDerivation m={pm} status={recordHasWork(record) ? pm.problem.showLine.getShownMessage() : 'No work'} /> });
      }
    }
    setPrinting({ title: 'Derivations — ' + (kind === 'results' ? 'Results' : kind === 'list' ? 'Problems' : 'Work'), items });
  };
  const donePrinting = useCallback(() => setPrinting(null), []);

  useShortcuts({ 'Mod+O': () => listRef.current?.focusSearch(), F1: showKeys }, { inFields: true });

  // ---- the view ----

  const entryState = m.problemIndex >= 0 ? ws.problems.getEntryAt(m.problemIndex)?.state : undefined;
  const statusText = m.titleState.status ?? '';
  const status = statusText.trim() !== '' ? { text: statusText, tone: toneOf(statusText) } : (entryState ?? null);
  const note = m.titleState.note;
  const focusedLine = (m.focus ?? m.lastFocus)?.line ?? null;
  const focusedIsShow = focusedLine != null && focusedLine.box.showLine === focusedLine && focusedLine.box.parentBox != null;
  const stateKey = `${version}:${cursor}:${showStack}:${showRules}`;
  const firstOpen = useMemo(() => list.rows.find((r) => r.kind === 'problem' && r.state !== STATE_CORRECT && r.counted !== false) ?? null, [list]);

  const header = (
    <ProblemHeader
      name={hasProblem ? (m.titleState.title ?? (isUserProblem ? 'User problem' : 'Problem')) : 'Derivations'}
      status={hasProblem ? status : null}
      note={
        hasProblem ? (
          <>
            {isExample && <span className="dl-badge">Worked example{readOnly ? '' : ': save it under a new name to keep changes'}</span>}
            {note ? ' ' + note : null}
          </>
        ) : null
      }
    />
  );

  const toolbar = (
    <Toolbar label="Derivation" className="dl-toolbar">
      <ToolButton label="‹ Prev" shortcut="Alt+ArrowUp" showShortcut={false} onClick={() => go(-1)} aria-label="Previous problem" />
      <ToolButton label="Next ›" shortcut="Alt+ArrowDown" altShortcuts={['Alt+N']} showShortcut={false} onClick={() => go(1)} aria-label="Next problem" />
      <ToolbarSeparator />
      <ToolButton
        label="Expand"
        aria-pressed={expandedView != null}
        className={expandedView != null ? 'is-on' : ''}
        title={expandedView != null ? 'Back to the derivation' : 'View the derivation with one rule per line (your work is not changed)'}
        disabled={!hasProblem}
        onClick={() => void toggleExpand()}
      />
      {!readOnly && (
        <>
          <ToolbarSeparator />
          <ToolButton label="Check" variant="primary" shortcut="Mod+K" showShortcut={false} disabled={!hasProblem} onClick={() => void check()} />
          <ToolButton label={ops.saveNeedsName(m) ? 'Save…' : 'Save'} shortcut="Mod+S" showShortcut={false} disabled={!hasProblem} onClick={() => void save()} />
          <ToolButton label="User…" title="Type your own argument to derive" disabled={m.config.noUser} onClick={() => void userProblem()} />
          <Menu
            label="Line"
            buttonClass="btn tool-btn"
            items={LINE_OPS.map((o) => ({
              label: o.label,
              shortcut: o.keys,
              disabled: !hasProblem || expandedView != null || (o.needsShow === true && !focusedIsShow),
              onSelect: () => void lineOp(o.op),
            }))}
          />
          <Menu
            label="Problem"
            buttonClass="btn tool-btn"
            items={[
              { label: 'Save under a new name…', disabled: !hasProblem, onSelect: () => void saveAs(true) },
              'separator',
              ops.deleteKind(m) === 'work'
                ? { label: 'Delete the work on this problem', disabled: !hasProblem || !ops.hasWork(m), danger: true, onSelect: () => void deleteCurrent() }
                : { label: 'Delete this problem', disabled: !hasProblem, danger: true, onSelect: () => void deleteCurrent() },
              { label: 'Delete work or problems…', onSelect: () => void deleteSeveral() },
            ]}
          />
        </>
      )}
      <span className="dl-wide-only">
      <ToolbarSeparator />
      <ToolButton label="Stack" aria-pressed={showStack} className={showStack ? 'is-on' : ''} onClick={() => togglePanel('stack')} title="The formulas on the stack of the justification at the cursor" />
      <ToolButton label="Applicable" aria-pressed={showRules} className={showRules ? 'is-on' : ''} onClick={() => togglePanel('rules')} title="The rules that apply at the cursor, and what they give" />
      <Menu
        label="Rules"
        buttonClass="btn tool-btn"
        items={[
          { label: 'Rules for this derivation', description: 'Ticked: available in this problem.', disabled: !hasProblem, onSelect: () => showInferenceRules(ws, m) },
          { label: 'All inference rules', description: 'Ticked: usable with Interchange of Equivalents.', onSelect: () => showInferenceRules(ws, null) },
        ]}
      />
      <Menu
        label="Guide"
        buttonClass="btn tool-btn"
        align="end"
        items={[
          { label: 'Keyboard', description: 'Every key of the derivation editor.', shortcut: 'F1', onSelect: showKeys },
          { label: 'Strategic advice', description: 'How to find a derivation.', onSelect: () => void loadTips().then(showAdvice) },
        ]}
      />
      <Menu
        label="Print"
        buttonClass="btn tool-btn"
        align="end"
        items={[
          { label: 'Print this derivation', disabled: !hasProblem, shortcut: 'Mod+P', onSelect: () => window.print() },
          { label: 'Print derivations…', description: 'The chosen problems with their work, checked.', onSelect: () => void print('problems') },
          { label: 'Print results…', description: 'The chosen problems with their states.', onSelect: () => void print('results') },
          { label: 'Print problem list…', description: 'The chosen problems’ arguments.', onSelect: () => void print('list') },
        ]}
      />
      </span>
      <span className="dl-narrow-only">
        <Menu
          label="More"
          buttonClass="btn tool-btn"
          align="end"
          items={[
            { label: showStack ? 'Hide the stack' : 'Show the stack', onSelect: () => togglePanel('stack') },
            { label: showRules ? 'Hide the applicable rules' : 'Show the applicable rules', onSelect: () => togglePanel('rules') },
            'separator',
            { label: 'Rules for this derivation', disabled: !hasProblem, onSelect: () => showInferenceRules(ws, m) },
            { label: 'All inference rules', onSelect: () => showInferenceRules(ws, null) },
            { label: 'Keyboard', onSelect: showKeys },
            { label: 'Strategic advice', onSelect: () => void loadTips().then(showAdvice) },
            'separator',
            { label: 'Print this derivation', disabled: !hasProblem, onSelect: () => window.print() },
            { label: 'Print derivations…', onSelect: () => void print('problems') },
          ]}
        />
      </span>
    </Toolbar>
  );

  const aside =
    hasProblem && expandedView == null && (showStack || showRules) ? (
      <div className="dl-aside">
        {showStack && <StackPanel m={m} stateKey={stateKey} busy={busy} />}
        {showRules && <RulesPanel m={m} stateKey={stateKey} busy={busy} onUse={useRule} readOnly={readOnly} />}
      </div>
    ) : undefined;

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
          selected={m.problemIndex === -1 ? null : title}
          onOpen={(id) => void open(id)}
        />
      }
      header={header}
      toolbar={toolbar}
      aside={aside}
    >
      {!hasProblem ? (
        <div className="derivation-empty">
          <p className="lead">Choose a problem from the list{readOnly || m.config.noUser ? '' : ', or type your own argument with User problem'}.</p>
          {!readOnly && firstOpen && firstOpen.kind === 'problem' && (
            <p>
              <button type="button" className="btn btn-primary" onClick={() => void open(firstOpen.id)}>
                Start with {firstOpen.label}
              </button>
            </p>
          )}
          <div className="derivation-howto">
            <h2>How it works</h2>
            <ol>
              <li>
                A derivation starts from its problem line. Press <kbd>Enter</kbd> there for the first line, and type <code>show conc</code> in the justification to show the conclusion (or type “Show P” as a formula).
              </li>
              <li>
                On each line, type a justification such as <code>pr1</code>, <code>ass cd</code>, <code>2 3 mp</code> and press <kbd>Enter</kbd>: with the formula left empty, the rule fills it in (or type the formula yourself first; <kbd>Tab</kbd> moves between the two).
              </li>
              <li>
                A line such as <code>5 cd</code> or <code>4 6 id</code> that reaches the Show line boxes and cancels its box. <kbd>Ctrl+K</kbd> checks the whole derivation.
              </li>
              <li>
                The <strong>Stack</strong> and <strong>Applicable</strong> panels show what the justification you are typing has on its stack, and which rules apply there.
              </li>
            </ol>
            <button type="button" className="btn btn-small" onClick={showKeys}>
              All keys
            </button>
          </div>
        </div>
      ) : (
        <div className="derivation-wrap">
          {expandedView != null ? (
            <>
              <p className="dl-expand-banner" role="status">
                <strong>Expanded view</strong>: one rule per line ({expandedView.before} → {expandedView.after} lines). It is read-only and your derivation is unchanged.{' '}
                <button type="button" className="linklike" onClick={() => void toggleExpand()}>
                  Back to the derivation
                </button>
              </p>
              <DerivationEditor m={expandedView.vm} version={viewVersion} readOnly run={viewRun} busy={busy} onCursor={() => undefined} onExplain={(line) => void explainLine(line, viewRun)} />
            </>
          ) : (
            <DerivationEditor ref={editorRef} m={m} version={version} readOnly={readOnly} run={run} busy={busy} onCursor={() => setCursor((n) => n + 1)} onExplain={(line) => void explainLine(line, run)} />
          )}
          {!readOnly && expandedView == null && (
            <div className="derivation-foot">
              <button type="button" className="btn btn-small btn-quiet" onClick={() => void lineOp({ typed: '\n', mods: ALT })} title="A new line after the current one (Alt+Enter)">
                + Line
              </button>
              <span className="muted small">
                <kbd>Enter</kbd> next line (an empty formula is filled in) · <kbd>Tab</kbd> formula ⇄ justification · <kbd>Alt+S</kbd> Show · <kbd>Alt+X</kbd> box & cancel ·{' '}
                <button type="button" className="linklike" onClick={showKeys}>
                  all {KEYS.length} keys
                </button>
              </span>
            </div>
          )}
        </div>
      )}
      {props.barSlot != null &&
        !readOnly &&
        createPortal(
          <button type="button" className="btn btn-small btn-quiet" title="Clean up your derivations: blank, unused and repeated lines, notation" onClick={() => void tidyAll()}>
            Tidy
          </button>,
          props.barSlot,
        )}
      <PrintSheet title={printing?.title ?? ''} items={printing?.items ?? null} onDone={donePrinting} />
    </ModuleLayout>
  );
}
