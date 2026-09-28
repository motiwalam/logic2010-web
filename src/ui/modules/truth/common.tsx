// What the Truth Tables and Invalidity screens share: loading a module's workspace from the
// work file (and saving it back), the engine's ModuleUi on the shell's dialogs, the
// "save changes?" flow for user problems, and reading a cross-module `?new=` link.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ModuleUi } from '../../../engine/modules/truth/ModuleUi';
import type { UserInfo } from '../../../engine/program/UserInfo';
import { useWorkRevision } from '../../app/context';
import { dialogs } from '../../dialogs/dialogs';
import { useLocation } from '../../router';
import { messageLike, workUser } from '../parsing/shared';
import type { ModuleProps } from '../registry';

export interface WorkspaceLike {
  persist: (ws: never) => boolean | Promise<boolean>;
  writeWork(user: UserInfo): { text: string };
}

/**
 * Opens a module's workspace (TruthWorkspace.open / InvalidityWorkspace.open) from the work
 * file, saving it back whenever the engine saves (never for read-only work), and reopening it
 * when the file changes from elsewhere (sync, import). `saved` counts the saves (the problem
 * list's states change with them).
 */
export function useModuleWorkspace<W extends WorkspaceLike>(
  props: ModuleProps,
  moduleIndex: number,
  open: (work: { fileName: string; text: string } | null, user: UserInfo, persist: (ws: W) => boolean) => Promise<W>,
): { ws: W | null; error: string | null; saved: number } {
  const { work, workPath, readOnly } = props;
  const revision = useWorkRevision(work);
  const lastText = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<{ ws: W | null; error: string | null }>({ ws: null, error: null });
  const [saved, setSaved] = useState(0);
  const text = work.getFile(workPath);

  useEffect(() => {
    // our own save comes back as a new revision with the text we wrote: no reload
    if (lastText.current !== undefined && text === lastText.current && state.ws != null) return;
    let live = true;
    const fileName = workPath.substring(workPath.lastIndexOf('/') + 1);
    const user = workUser(moduleIndex);
    open(text == null ? null : { fileName, text }, user, (ws) => {
      if (!readOnly) {
        const t = ws.writeWork(user).text;
        lastText.current = t;
        work.saveFile(workPath, t);
      }
      setSaved((n) => n + 1);
      return true;
    })
      .then((ws) => {
        if (!live) return;
        const d = (ws as unknown as { digestCheck: { ok: boolean } | null }).digestCheck;
        if (d != null && !d.ok) {
          setState({ ws: null, error: 'not003' });
          return;
        }
        if (lastText.current === undefined || lastText.current === null) lastText.current = text;
        setState({ ws, error: null });
      })
      .catch((e: unknown) => live && setState({ ws: null, error: String(e) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, text, workPath, readOnly]);
  return { ...state, saved };
}

/** The engine's questions (ModuleUi) on the shell's dialogs. */
export const moduleUi: ModuleUi = {
  async showMessage(message, params) {
    const r = await dialogs.message(messageLike(message, params, message.isError));
    return r == null ? -1 : r.index;
  },
  async showText(title, text) {
    await dialogs.message({ title, text, isError: false, expanded: true });
  },
  async confirmSave() {
    const r = await dialogs.message({
      title: 'Do you wish to save the current problem?',
      text: 'It is not in your problem list yet. Saved, it is kept under a name you choose.',
      buttons: 'Save:save. Discard:discard. Cancel:cancel;0',
      isError: false,
    });
    return r?.action === 'save' ? 'yes' : r?.action === 'discard' ? 'no' : 'cancel';
  },
  askProblemName(initial) {
    return dialogs.prompt({ title: 'Save the problem', prompt: 'Please supply a name for this problem', label: 'Name', initial, confirmLabel: 'Save' });
  },
  chooseDeleteWorkOrProblem() {
    return dialogs.choose<'work' | 'problem'>({
      title: 'Delete',
      choices: [
        { value: 'work', label: 'Delete the work on this problem' },
        { value: 'problem', label: 'Delete this problem', description: 'It is removed from your problem list.' },
      ],
    });
  },
  confirm(text) {
    return dialogs.confirm({ title: text, confirmLabel: text.startsWith('Delete this problem') ? 'Delete problem' : 'Delete work', danger: true });
  },
};

/**
 * The `new` parameter of the location (a cross-module link, see src/ui/README.md), and a
 * function that removes it from the URL once the screen has taken it.
 */
export function useNewProblemParam(): string | null {
  const loc = useLocation();
  const q = loc.indexOf('?');
  if (q === -1) return null;
  return new URLSearchParams(loc.slice(q)).get('new');
}

export function notEnabled(what: string): void {
  dialogs.notify(`${what} is disabled for this problem.`);
}

/** Re-renders when an engine model (a ChangeNotifier) changes. */
export function useModel(model: { subscribe(l: () => void): () => void; getVersion(): number } | null): number {
  return useSyncExternalStore(
    (l) => (model ? model.subscribe(l) : () => undefined),
    () => (model ? model.getVersion() : -1),
    () => (model ? model.getVersion() : -1),
  );
}
