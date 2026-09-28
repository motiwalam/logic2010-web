// Loading and saving the Symbolization work (symbolization.rec and the user key,
// symbolization-answers.rec), engine messages as dialogs, a problem picker and the print sheet.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TaggedRecord } from '../../../engine/data/TaggedRecord';
import { LPSymbolizer, SymbolizationModule, type SymbolizationNotice, type SymbolizationNode } from '../../../engine/modules/symbolization';
import { ProblemListModel } from '../../../engine/problems/ProblemList';
import { STATE_CORRECT, STATE_NO_WORK } from '../../../engine/problems/ProblemEntry';
import type { ProblemSet } from '../../../engine/problems/ProblemSet';
import { Message, type MessageParams } from '../../../engine/program/Message';
import { moduleDigestVersKeys, symModule } from '../../../engine/program/ModuleConstants';
import type { ProblemSelector } from '../../../engine/program/ProblemSelector';
import { UserInfo } from '../../../engine/program/UserInfo';
import type { WorkSummary } from '../../../sync/api';
import { useWorkRevision } from '../../app/context';
import type { MessageLike } from '../../components/MessageView';
import { dialogs, DialogButtons } from '../../dialogs/dialogs';
import type { ModuleProps } from '../registry';

export const WORK_FILE = 'symbolization.rec';
export const KEY_FILE = 'symbolization-answers.rec';

/** The desktop's local-mode user, with the module's digest version (the desktop writes version 1). */
export function workUser(): UserInfo {
  const user = UserInfo.localUser();
  user.put(moduleDigestVersKeys[symModule], '1');
  return user;
}

export async function loadModule(workText: string | null, keyText: string | null, acceptBadDigest = false): Promise<SymbolizationModule> {
  return SymbolizationModule.load({
    work: workText == null ? null : { fileName: WORK_FILE, text: workText },
    userKey: keyText == null ? null : { fileName: KEY_FILE, text: keyText },
    user: workUser(),
    acceptBadDigest,
  });
}

/** The progress figures: course problems (not examples), correct and attempted. */
export function summarizeSet(set: ProblemSet): WorkSummary {
  let completed = 0;
  let attempted = 0;
  let total = 0;
  for (let i = 0; i < set.size(); i++) {
    const entry = set.getEntryAt(i)!;
    const name = TaggedRecord.nameOf(entry.name);
    if (TaggedRecord.isExample(entry.name) || set.exercises?.getRecord(name) == null) continue;
    total++;
    if (entry.state === STATE_CORRECT) completed++;
    if (entry.state !== STATE_NO_WORK) attempted++;
  }
  return { completed, attempted, total };
}

/**
 * The module loaded from the workspace. The engine's saves go back to the workspace (never
 * for read-only work) and do not cause a reload; other changes of either file do.
 */
export function useSymbolizationWork(props: ModuleProps): { module: SymbolizationModule | null; error: string | null } {
  const { work, workPath, readOnly } = props;
  const revision = useWorkRevision(work);
  const dir = workPath.substring(0, workPath.lastIndexOf('/') + 1);
  const keyPath = dir + KEY_FILE;
  const text = work.getFile(workPath);
  const keyText = work.getFile(keyPath);
  const written = useRef<{ work: string | null; key: string | null } | null>(null);
  const [state, setState] = useState<{ module: SymbolizationModule | null; error: string | null }>({ module: null, error: null });

  useEffect(() => {
    const w = written.current;
    if (w != null && state.module != null && w.work === text && w.key === keyText) return;
    let live = true;
    loadModule(text, keyText, readOnly)
      .then((m) => {
        if (!live) return;
        written.current = { work: text, key: keyText };
        m.persist = (files) => {
          if (readOnly) return;
          for (const f of files) {
            const path = f.fileName === KEY_FILE ? keyPath : workPath;
            if (written.current) {
              if (path === keyPath) written.current.key = f.text;
              else written.current.work = f.text;
            }
            work.saveFile(path, f.text);
          }
        };
        setState({ module: m, error: null });
      })
      .catch((e: unknown) => {
        if (!live) return;
        const id = (e as { messageId?: string }).messageId;
        setState({ module: null, error: id ?? String(e) });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, text, keyText, workPath, readOnly]);
  return state;
}

/** Re-renders on every change of the open problem. */
export function useSession(session: LPSymbolizer): number {
  return useSyncExternalStore(
    (l) => session.subscribe(l),
    () => session.version,
    () => session.version,
  );
}

/** A catalogue message (params substituted) for MessageView / dialogs.message. */
export function messageLike(m: Message, params: MessageParams | null = null, isError = false): MessageLike {
  const text = Message.substitute(m.text, params == null ? null : new Map(params));
  if (m.title === m.id || m.title.toLowerCase() === m.id.toLowerCase()) return { title: text, isError: isError || m.isError, buttons: m.buttons };
  return { title: Message.substitute(m.title, params == null ? null : new Map(params)), text, isError: m.isError, buttons: m.buttons };
}

/** Shows what the engine tells the user. */
export function showNotice(n: SymbolizationNotice): void {
  if (n.kind === 'message') void dialogs.message(messageLike(n.message, n.params));
  else void dialogs.message({ title: n.title, text: n.text, isError: true });
}

/** The engine's questions (askForSymbol, askProblemName) on the shell's dialogs. */
export const symbolizationUi = {
  askForSymbol: (prompt: string, node: SymbolizationNode) =>
    dialogs.prompt({
      title: prompt === 'Bound Variable:' ? 'Bound variable' : 'Atomic expression',
      prompt: (
        <>
          <span className="muted">For </span>“{node.text.trim()}”
        </>
      ),
      label: prompt.replace(':', ''),
      formula: true,
      confirmLabel: 'OK',
    }),
  askProblemName: (initial: string) =>
    dialogs.prompt({ title: 'Save the problem', prompt: 'Please supply a name for this problem', label: 'Name', initial, confirmLabel: 'Save' }),
};

// ---- choosing several problems (print, delete) ----

export interface PickOptions {
  title: string;
  prompt?: ReactNode;
  actions: { value: string; label: string; danger?: boolean }[];
  initial?: number[];
  exclude?: ProblemSelector | null;
}

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
    return [...model.rows];
  }, [model, query]);
  const shown = rows.flatMap((r) => (r.kind === 'problem' ? [r.index] : []));
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
    <div className="sym-pick">
      {opts.prompt != null && <div className="dialog-text">{opts.prompt}</div>}
      <div className="sym-pick-tools">
        <input className="input" type="search" placeholder="Search problems" aria-label="Search problems" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn btn-small" onClick={() => setAll(true)}>
          Choose all shown
        </button>
        <button type="button" className="btn btn-small" onClick={() => setAll(false)}>
          Clear shown
        </button>
      </div>
      <div className="sym-pick-rows" role="group" aria-label="Problems">
        {rows.map((r, k) =>
          r.kind === 'heading' ? (
            r.text.trim() === '' ? null : (
              <div key={k} className="sym-pick-heading">
                {r.text}
              </div>
            )
          ) : (
            <label key={k} className="sym-pick-row">
              <input type="checkbox" checked={chosen.has(r.index)} onChange={() => toggle(r.index)} />
              <span>{r.text}</span>
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

export interface PrintItem {
  key: string | number;
  code?: string;
  text: string;
  extra?: ReactNode;
}

/** A printout: while items are set, the page prints only this sheet. */
export function PrintSheet({ title, items, onDone }: { title: string; items: PrintItem[] | null; onDone: () => void }) {
  useEffect(() => {
    if (!items) return;
    document.body.classList.add('sym-print-mode');
    const after = () => {
      document.body.classList.remove('sym-print-mode');
      onDone();
    };
    window.addEventListener('afterprint', after, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', after);
      document.body.classList.remove('sym-print-mode');
    };
  }, [items, onDone]);
  if (!items) return null;
  return createPortal(
    <div className="sym-print-sheet">
      <header className="sym-print-head">
        <strong>{title}</strong>
        <span>{new Date().toLocaleDateString()}</span>
      </header>
      {items.map((it) => (
        <div key={it.key} className="sym-print-item">
          {it.code !== undefined && <span className="sym-print-code">{it.code}</span>}
          <div className="sym-print-text">
            <div className="formula" style={{ whiteSpace: 'pre-wrap' }}>
              {it.text}
            </div>
            {it.extra}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
