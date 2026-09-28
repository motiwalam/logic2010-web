// Pieces the Parsing and Recognizing Rules screens share: loading the module's work from the
// workspace (and saving it back), the engine's dialog interface on top of the shell's dialogs,
// catalogue messages as MessageView messages, a multi-problem picker (print, delete) and the
// print sheet.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WrittenWork } from '../../../engine/problems/LogicModule';
import { ProblemListModel } from '../../../engine/problems/ProblemList';
import type { ProblemSet } from '../../../engine/problems/ProblemSet';
import type { ProblemSelector } from '../../../engine/program/ProblemSelector';
import { STATE_CORRECT, STATE_NO_WORK } from '../../../engine/problems/ProblemEntry';
import { TaggedRecord } from '../../../engine/data/TaggedRecord';
import { Message, type MessageParams } from '../../../engine/program/Message';
import { UserInfo } from '../../../engine/program/UserInfo';
import { moduleDigestVersKeys } from '../../../engine/program/ModuleConstants';
import type { ChangeNotifier } from '../../../engine/modules/parsing/ChangeNotifier';
import type { ModuleDialogs } from '../../../engine/modules/parsing/moduleSupport';
import type { WorkSummary } from '../../../sync/api';
import { useWorkRevision } from '../../app/context';
import type { MessageLike } from '../../components/MessageView';
import { dialogs, DialogButtons } from '../../dialogs/dialogs';
import type { ModuleProps } from '../registry';
import './shared.css';

/**
 * The student identity of work-file digests: the desktop's local-mode user, with the module's
 * digest version set to 1 (the desktop sets it before writing a module's work, so every work
 * file it or this site writes carries version 1).
 */
export function workUser(moduleIndex: number): UserInfo {
  const user = UserInfo.localUser();
  user.put(moduleDigestVersKeys[moduleIndex], '1');
  return user;
}

/** Re-renders when the engine model changes. */
export function useModel(model: ChangeNotifier | null): number {
  return useSyncExternalStore(
    (l) => (model ? model.subscribe(l) : () => undefined),
    () => (model ? model.getVersion() : -1),
    () => (model ? model.getVersion() : -1),
  );
}

/** A catalogue message with its parameters substituted, for MessageView / dialogs.message. */
export function messageLike(m: Message, params: MessageParams | null = null, isError = true): MessageLike {
  const text = Message.substitute(m.text, params == null ? null : new Map(params));
  // module messages have only a text: it is the title
  if (m.title === m.id || m.title.toLowerCase() === m.id.toLowerCase()) return { title: text, isError, buttons: m.buttons };
  return { title: Message.substitute(m.title, params == null ? null : new Map(params)), text, isError: m.isError, buttons: m.buttons };
}

/** The engine's dialogs (problem names, catalogue messages) on the shell's dialogs. */
export const moduleDialogs: ModuleDialogs = {
  askProblemName: (initial) =>
    dialogs.prompt({ title: 'Save the problem', prompt: 'Please supply a name for this problem', label: 'Name', initial, confirmLabel: 'Save' }),
  showMessage: async (message, params) => {
    await dialogs.message(messageLike(message, params));
  },
};

interface Loaded<M> {
  module: M;
  error: null;
}

/**
 * Loads a module's work (ParsingModule.load / RecognitionModule.load) from the workspace file,
 * saving it back when the engine saves (never for read-only work). Reloads when the file is
 * changed from elsewhere (sync, import, another tab).
 */
export function useModuleWork<M>(
  props: ModuleProps,
  moduleIndex: number,
  load: (init: { work: { fileName: string; text: string } | null; user: UserInfo; persist: (w: WrittenWork) => boolean }) => Promise<{ module: M | null; error: string | null }>,
): { module: M | null; error: string | null } {
  const { work, workPath, readOnly } = props;
  const revision = useWorkRevision(work);
  const lastText = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<{ module: M | null; error: string | null }>({ module: null, error: null });
  const text = work.getFile(workPath);

  useEffect(() => {
    // the engine's own save comes back as a new revision with the text it wrote: no reload
    if (lastText.current !== undefined && text === lastText.current && state.module != null) return;
    let live = true;
    const fileName = workPath.substring(workPath.lastIndexOf('/') + 1);
    load({
      work: text == null ? null : { fileName, text },
      user: workUser(moduleIndex),
      persist: (w) => {
        if (readOnly) return true;
        lastText.current = w.text;
        work.saveFile(workPath, w.text);
        return true;
      },
    })
      .then((r) => {
        if (!live) return;
        if (lastText.current === undefined || lastText.current === null) lastText.current = text;
        setState(r);
      })
      .catch((e: unknown) => live && setState({ module: null, error: String(e) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, text, workPath, readOnly]);
  return state as Loaded<M> | { module: null; error: string | null };
}

/** The progress figures of a module's problems (for summarize): counted as the desktop's "Completed". */
export function summarizeSet(set: ProblemSet): WorkSummary {
  let completed = 0;
  let attempted = 0;
  let total = 0;
  for (let i = 0; i < set.size(); i++) {
    const entry = set.getEntryAt(i)!;
    const record = new TaggedRecord(entry.name);
    const name = record.getName();
    if (TaggedRecord.isExample(entry.name) || set.exercises?.getRecord(name) == null) continue;
    total++;
    if (entry.state === STATE_CORRECT) completed++;
    if (entry.state !== STATE_NO_WORK) attempted++;
  }
  return { completed, attempted, total };
}

// ---- choosing several problems (print, delete) ----

export interface PickOptions {
  title: string;
  prompt?: ReactNode;
  /** The buttons: each resolves with its value and the chosen indices. */
  actions: { value: string; label: string; danger?: boolean }[];
  /** Problems initially chosen. */
  initial?: number[];
  /** Problems left out of the list (e.g. the module's noPrint selector). */
  exclude?: ProblemSelector | null;
  /** Only problems that pass this test are listed. */
  only?: (index: number) => boolean;
}

/** A list of the set's problems with check boxes (the desktop's multiple-selection problem list). */
export function pickProblems(set: ProblemSet, opts: PickOptions): Promise<{ action: string; indices: number[] } | null> {
  const model = new ProblemListModel(set, set.exercises, { multiple: true, exclude: opts.exclude ?? null });
  return dialogs.open<{ action: string; indices: number[] } | null>((done) => <PickBody model={model} opts={opts} done={done} />, {
    title: opts.title,
    dismissValue: null,
    size: 'large',
  });
}

function PickBody({ model, opts, done }: { model: ProblemListModel; opts: PickOptions; done: (v: { action: string; indices: number[] } | null) => void }) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(opts.initial ?? []));
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    model.setFilter(query);
    const only = opts.only;
    if (!only) return model.rows;
    // drop the problems left out, and headings left with no problem under them
    const kept = model.rows.filter((r) => r.kind === 'heading' || only(r.index));
    return kept.filter((r, k) => {
      if (r.kind === 'problem') return true;
      const next = kept.slice(k + 1).find((x) => x.kind === 'problem' || x.text.trim() !== '');
      return next != null && (next.kind === 'problem' || kept.slice(k + 1).some((x) => x.kind === 'problem'));
    });
  }, [model, query, opts]);
  const shown = rows.filter((r) => r.kind === 'problem').map((r) => (r.kind === 'problem' ? r.index : -1));
  const toggle = (i: number) => {
    const next = new Set(chosen);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setChosen(next);
  };
  const setAll = (on: boolean) => {
    const next = new Set(chosen);
    for (const i of shown) {
      if (on) next.add(i);
      else next.delete(i);
    }
    setChosen(next);
  };
  return (
    <div className="pick">
      {opts.prompt != null && <div className="dialog-text">{opts.prompt}</div>}
      <div className="pick-tools">
        <input className="input" type="search" placeholder="Search problems" aria-label="Search problems" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn btn-small" onClick={() => setAll(true)}>
          Choose all shown
        </button>
        <button type="button" className="btn btn-small" onClick={() => setAll(false)}>
          Clear shown
        </button>
      </div>
      <div className="pick-rows" role="group" aria-label="Problems">
        {rows.map((r, k) =>
          r.kind === 'heading' ? (
            r.text.trim() === '' ? null : (
              <div key={k} className="pick-heading">
                {r.text}
              </div>
            )
          ) : (
            <label key={k} className="pick-row">
              <input type="checkbox" checked={chosen.has(r.index)} onChange={() => toggle(r.index)} />
              <span className="formula">{r.text}</span>
            </label>
          ),
        )}
      </div>
      <p className="muted small">{chosen.size === 1 ? '1 problem chosen' : `${chosen.size} problems chosen`}</p>
      <DialogButtons>
        <button type="button" className="btn" onClick={() => done(null)}>
          Cancel
        </button>
        {opts.actions.map((a) => (
          <button
            key={a.value}
            type="button"
            className={a.danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={chosen.size === 0}
            onClick={() => done({ action: a.value, indices: [...chosen].sort((x, y) => x - y) })}
          >
            {a.label}
          </button>
        ))}
      </DialogButtons>
    </div>
  );
}

// ---- printing ----

export interface PrintSheetItem {
  key: string | number;
  /** The state letter column (Print Results), or undefined. */
  code?: string;
  text: ReactNode;
  extra?: ReactNode;
}

/**
 * A printout (the desktop's printed pages: header, then one item per problem). While items are
 * set, the page prints only this sheet; onDone is called after the print dialog closes.
 */
export function PrintSheet({ title, items, onDone }: { title: string; items: PrintSheetItem[] | null; onDone: () => void }) {
  useEffect(() => {
    if (!items) return;
    document.body.classList.add('print-sheet-mode');
    const after = () => {
      document.body.classList.remove('print-sheet-mode');
      onDone();
    };
    window.addEventListener('afterprint', after, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', after);
      document.body.classList.remove('print-sheet-mode');
    };
  }, [items, onDone]);
  if (!items) return null;
  return createPortal(
    <div className="print-sheet">
      <header className="print-sheet-head">
        <strong>{title}</strong>
        <span>{new Date().toLocaleDateString()}</span>
      </header>
      {items.map((it) => (
        <div key={it.key} className="print-item">
          {it.code !== undefined && <span className="print-code">{it.code}</span>}
          <div className="print-text">
            <div className="formula">{it.text}</div>
            {it.extra}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
