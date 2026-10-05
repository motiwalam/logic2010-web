// The statistics of the derivations of a work (measureDerivation), worked out in the
// background and kept per record text, for the problem list's line counts and the Statistics
// view.

import { useEffect, useState } from 'react';
import { TaggedRecord } from '../../../engine/data/TaggedRecord';
import { hasWork } from '../../../engine/modules/derivation/DerivationProblemSet';
import type { DerivationWorkspace } from '../../../engine/modules/derivation/DerivationWorkspace';
import { type DerivationStats, measureDerivation } from '../../../engine/modules/derivation/expandDerivation';

const caches = new WeakMap<DerivationWorkspace, Map<string, DerivationStats | null>>();

function cacheOf(ws: DerivationWorkspace): Map<string, DerivationStats | null> {
  let cache = caches.get(ws);
  if (cache == null) caches.set(ws, (cache = new Map()));
  return cache;
}

export interface StatsStore {
  /** The statistics of a record: undefined while not worked out yet, null if it has no problem. */
  get(record: string | null): DerivationStats | null | undefined;
  /** Records with work still to measure, and all of them. */
  pending: number;
  total: number;
}

/** Measures every derivation with work, a few at a time; re-renders as results come in. `revision` changes when the work does. */
export function useDerivationStats(ws: DerivationWorkspace, revision: number): StatsStore {
  const [, setTick] = useState(0);
  const [progress, setProgress] = useState({ pending: 0, total: 0 });
  useEffect(() => {
    const cache = cacheOf(ws);
    const records: string[] = [];
    for (let i = 0; i < ws.problems.size(); i++) {
      const record = ws.problems.getRecordAt(i);
      if (record != null && hasWork(new TaggedRecord(record))) records.push(record);
    }
    const todo = records.filter((r) => !cache.has(r));
    setProgress({ pending: todo.length, total: records.length });
    if (todo.length === 0) return;
    let live = true;
    void (async () => {
      let since = performance.now();
      for (let k = 0; k < todo.length && live; k++) {
        try {
          cache.set(todo[k], await measureDerivation(ws, todo[k]));
        } catch {
          cache.set(todo[k], null);
        }
        // yield to the page now and then, and show what is there
        if (performance.now() - since > 40 || k === todo.length - 1) {
          setProgress({ pending: todo.length - k - 1, total: records.length });
          setTick((n) => n + 1);
          await new Promise((r) => setTimeout(r, 0));
          since = performance.now();
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [ws, revision]);
  const cache = cacheOf(ws);
  return { get: (record) => (record == null ? undefined : cache.get(record)), pending: progress.pending, total: progress.total };
}
