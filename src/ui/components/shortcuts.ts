// Keyboard shortcuts. A shortcut is written like 'Mod+K' (Mod = Ctrl, or ⌘ on a Mac),
// 'Alt+N', 'Mod+Shift+ArrowDown'. Bindings are global while the component that registers
// them is mounted; the most recently registered binding of a key wins.

import { useEffect, useRef } from 'react';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface Parsed {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parse(shortcut: string): Parsed {
  const parts = shortcut.split('+');
  const key = parts.pop()!;
  return {
    mod: parts.includes('Mod') || parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key: key.length === 1 ? key.toUpperCase() : key,
  };
}

/** Whether a keyboard event is the shortcut. */
export function matchesShortcut(e: KeyboardEvent | React.KeyboardEvent, shortcut: string): boolean {
  const p = parse(shortcut);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== p.mod || e.shiftKey !== p.shift || e.altKey !== p.alt) return false;
  if (p.key.length === 1) {
    // e.code keeps working with other keyboard layouts and with Alt (which changes e.key on a Mac)
    const code = /[A-Z]/.test(p.key) ? 'Key' + p.key : /[0-9]/.test(p.key) ? 'Digit' + p.key : null;
    return (code != null && e.code === code) || e.key.toUpperCase() === p.key;
  }
  return e.key === p.key;
}

/** 'Mod+K' as shown to the user: 'Ctrl+K', or '⌘K' on a Mac. */
export function formatShortcut(shortcut: string): string {
  const p = parse(shortcut);
  const key = p.key === 'ArrowDown' ? '↓' : p.key === 'ArrowUp' ? '↑' : p.key === 'Enter' ? (isMac ? '↩' : 'Enter') : p.key;
  if (isMac) return (p.mod ? '⌘' : '') + (p.alt ? '⌥' : '') + (p.shift ? '⇧' : '') + key;
  return [p.mod ? 'Ctrl' : '', p.alt ? 'Alt' : '', p.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}

interface Binding {
  shortcut: string;
  handler: (e: KeyboardEvent) => void;
  /** Also fire while typing in a text field (default true for Mod/Alt shortcuts). */
  inFields: boolean;
}

const stack: Binding[] = [];

function isField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    // while a modal dialog is open, page shortcuts are off
    if (document.querySelector('dialog[open]') && !(e.target instanceof Node && document.querySelector('dialog[open]')!.contains(e.target))) return;
    for (let i = stack.length - 1; i >= 0; i--) {
      const b = stack[i];
      if (!matchesShortcut(e, b.shortcut)) continue;
      if (!b.inFields && isField(e.target)) continue;
      e.preventDefault();
      b.handler(e);
      return;
    }
  });
}

/**
 * Binds shortcuts while mounted: useShortcuts({ 'Mod+K': check, 'Alt+N': next }). Handlers
 * may change between renders; null/undefined handlers are skipped.
 */
export function useShortcuts(map: Record<string, ((e: KeyboardEvent) => void) | null | undefined | false>, opts: { inFields?: boolean } = {}): void {
  const ref = useRef(map);
  ref.current = map;
  const keys = Object.keys(map)
    .filter((k) => !!map[k])
    .join('|');
  useEffect(() => {
    const bindings: Binding[] = keys
      .split('|')
      .filter(Boolean)
      .map((shortcut) => {
        const p = parse(shortcut);
        return {
          shortcut,
          handler: (e: KeyboardEvent) => {
            const h = ref.current[shortcut];
            if (h) h(e);
          },
          inFields: opts.inFields ?? (p.mod || p.alt),
        };
      });
    stack.push(...bindings);
    return () => {
      for (const b of bindings) {
        const i = stack.indexOf(b);
        if (i !== -1) stack.splice(i, 1);
      }
    };
  }, [keys, opts.inFields]);
}
