// Starting the logic engine in the browser: the program-wide configuration (links, notation,
// messages, options, rules and theorems) loaded from <base>data/. Switching the notation
// loads it again; module screens remount (keyed by `generation`) because the engine's
// tables are program-wide.

import { useSyncExternalStore } from 'react';
import type { DataSource } from '../../engine/data/DataSource';
import { getLink } from '../../engine/program/LogicProgram';
import { loadProgram } from '../../engine/program/loadProgram';
import { getSyntax } from '../../engine/program/symbols';
import type { Notation } from '../../workspace/paths';

export const DATA_URL = (import.meta.env?.BASE_URL ?? '/').replace(/\/*$/, '/') + 'data/';

export interface EngineState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The notation loaded (valid when ready). */
  notation: Notation;
  /** The course default (links.conf `syntax:`), once known. */
  defaultNotation: Notation | null;
  error: string | null;
  /** Increases with every successful load. */
  generation: number;
}

/**
 * Fetches data files over HTTP. Unlike the engine's HttpDataSource, an HTML answer also
 * counts as "no such file": the Vite dev server answers missing paths with index.html
 * (status 200), and the engine probes for optional files (coreinfo.txt, links.txt, ...).
 */
export class WebDataSource implements DataSource {
  constructor(private readonly baseUrl: string) {}

  async readText(path: string): Promise<string | null> {
    const response = await fetch(this.baseUrl + path.split('/').map(encodeURIComponent).join('/'));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`could not read ${path}: HTTP ${response.status}`);
    if ((response.headers.get('content-type') ?? '').includes('text/html')) return null;
    return response.text();
  }
}

let state: EngineState = { status: 'idle', notation: 1, defaultNotation: null, error: null, generation: 0 };
const listeners = new Set<() => void>();
let chain: Promise<void> = Promise.resolve();
let requested: Notation | null | undefined;

function set(patch: Partial<EngineState>): void {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
}

export function getEngineState(): EngineState {
  return state;
}

export function useEngine(): EngineState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getEngineState,
    getEngineState,
  );
}

async function readDefaultNotation(source: DataSource): Promise<Notation> {
  const text = (await source.readText('links.conf')) ?? '';
  const m = /^\s*syntax\s*:\s*([12])\s*$/m.exec(text);
  return m && m[1] === '2' ? 2 : 1;
}

/**
 * Loads (or reloads) the program for a notation (null: the course default). Calls are
 * serialized; a load that a later call supersedes is skipped.
 */
export function loadEngine(notation: Notation | null): Promise<void> {
  requested = notation;
  chain = chain.then(async () => {
    if (requested !== notation) return; // superseded
    if (state.status === 'ready' && notation != null && state.notation === notation) return;
    set({ status: 'loading', error: null });
    try {
      const source = new WebDataSource(DATA_URL);
      const defaultNotation = state.defaultNotation ?? (await readDefaultNotation(source));
      await loadProgram(source, { syntax: notation ?? undefined });
      set({ status: 'ready', notation: getSyntax(), defaultNotation, generation: state.generation + 1 });
    } catch (err) {
      console.error(err);
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  });
  return chain;
}

/** The URL of a data file, e.g. dataUrl('docs/derhelp.pdf'). */
export function dataUrl(path: string): string {
  return DATA_URL + path.split('/').map(encodeURIComponent).join('/');
}

/** A help document's URL from its links.conf key (e.g. 'derHelp'), or null. */
export function docUrl(key: string): string | null {
  const path = getLink(key);
  return path ? dataUrl(path) : null;
}
