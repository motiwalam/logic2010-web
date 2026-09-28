// Display preferences (per browser): theme, text size, high contrast (the desktop's
// "overhead" colours), and the formula notation. Kept in localStorage and applied to <html>.

import { useSyncExternalStore } from 'react';
import type { Notation } from '../workspace/paths';

export type Theme = 'system' | 'light' | 'dark';

export interface Prefs {
  theme: Theme;
  /** Text size, as a multiple of the base size. */
  textScale: number;
  /** Stronger colours and borders, for projectors ("overhead" in the desktop program). */
  highContrast: boolean;
  /** The notation chosen here; null: the course default (links.conf `syntax:`). */
  notation: Notation | null;
  /** Show the formula keypad under formula fields by default. */
  keypadOpen: boolean;
  /** The problem list is collapsed in module screens. */
  sidebarCollapsed: boolean;
}

export const TEXT_SCALES = [0.875, 1, 1.125, 1.25, 1.5, 1.75] as const;

const DEFAULTS: Prefs = { theme: 'system', textScale: 1, highContrast: false, notation: null, keypadOpen: false, sidebarCollapsed: false };
const KEY = 'logic2010:prefs';

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // unavailable storage: defaults
  }
  return DEFAULTS;
}

let prefs: Prefs = typeof localStorage === 'undefined' ? DEFAULTS : load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // not persisted
  }
  applyPrefs();
  for (const l of [...listeners]) l();
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getPrefs,
    getPrefs,
  );
}

const darkQuery = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-color-scheme: dark)');
darkQuery?.addEventListener('change', () => applyPrefs());

/** The theme in effect. */
export function effectiveTheme(p: Prefs = prefs): 'light' | 'dark' {
  return p.theme === 'system' ? (darkQuery?.matches ? 'dark' : 'light') : p.theme;
}

export function applyPrefs(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = effectiveTheme();
  root.dataset.contrast = prefs.highContrast ? 'high' : 'normal';
  root.style.setProperty('--text-scale', String(prefs.textScale));
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', effectiveTheme() === 'dark' ? '#131a24' : '#f4f6f9');
}
