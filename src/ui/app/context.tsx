// The app's services (the workspace store) for React, and the hooks to read them.

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { WorkSummary } from '../../sync/api';
import { parseWorkPath } from '../../workspace/paths';
import { storeSource, type WorkSource } from '../../workspace/source';
import type { WorkspaceSnapshot, WorkspaceStore } from '../../workspace/WorkspaceStore';
import { getEngineState } from '../engine/engine';
import { moduleForFile } from '../modules/registry';

export interface AppServices {
  store: WorkspaceStore;
  /** Your own workspace as a WorkSource. */
  own: WorkSource;
}

export const AppContext = createContext<AppServices | null>(null);

export function createServices(store: WorkspaceStore): AppServices {
  store.setSummarizer(summarizeFile);
  return { store, own: storeSource(store) };
}

export function useServices(): AppServices {
  const s = useContext(AppContext);
  if (!s) throw new Error('AppContext missing');
  return s;
}

export function useWorkspace(): WorkspaceSnapshot {
  const { store } = useServices();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Re-renders when the source's files change. */
export function useWorkRevision(source: WorkSource): number {
  return useSyncExternalStore(source.subscribe.bind(source), source.getRevision.bind(source), source.getRevision.bind(source));
}

/** Counts the problem records of a .rec work file (used when a module gives no summary). */
export function countProblems(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) if (/^\s*problem\s*:/.test(line)) n++;
  return n;
}

/**
 * A work file's summary: the module's summarize (when registered, and the engine is loaded
 * with the file's notation), else just the number of problems.
 */
export async function summarizeFile(path: string, content: string): Promise<WorkSummary | undefined> {
  const p = parseWorkPath(path);
  if (!p) return undefined;
  const m = moduleForFile(p.file);
  const engine = getEngineState();
  if (m?.def?.summarize && m.def.workFile === p.file) {
    if (engine.status !== 'ready' || engine.notation !== p.notation) return undefined;
    return m.def.summarize(content, { notation: p.notation });
  }
  return { total: countProblems(content) };
}

/** "12 of 140 correct"-style text for a summary. */
export function summaryText(s: WorkSummary | undefined): string | null {
  if (!s) return null;
  if (typeof s.completed === 'number' && typeof s.total === 'number') return `${s.completed} of ${s.total} correct`;
  if (typeof s.completed === 'number') return `${s.completed} correct`;
  if (typeof s.total === 'number') return `${s.total} problems saved`;
  return null;
}
