import type { Notation } from '../../workspace/paths';
import { useEngine } from '../engine/engine';
import { usePrefs } from '../prefs';

/** The notation in use: the engine's once loaded, else the preference or the course default. */
export function useNotation(): Notation {
  const engine = useEngine();
  const prefs = usePrefs();
  if (engine.status === 'ready') return engine.notation;
  return prefs.notation ?? engine.defaultNotation ?? 1;
}
