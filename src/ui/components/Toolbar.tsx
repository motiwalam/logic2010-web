// Toolbars, buttons with keyboard shortcuts, and drop-down menus.

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { formatShortcut, useShortcuts } from './shortcuts';

export function Kbd({ shortcut }: { shortcut: string }) {
  return <kbd className="kbd">{formatShortcut(shortcut)}</kbd>;
}

export interface ToolButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  label: ReactNode;
  onClick: () => void;
  /** Keyboard shortcut ('Mod+K'); bound while the button is shown and enabled. */
  shortcut?: string;
  /** More shortcuts for the same action (not shown). */
  altShortcuts?: string[];
  icon?: ReactNode;
  variant?: 'default' | 'primary' | 'quiet' | 'danger';
  /** Show the shortcut in the button (it is always in the tooltip). */
  showShortcut?: boolean;
}

/** A toolbar button; its shortcut works anywhere on the page while it is enabled. */
export function ToolButton({ label, onClick, shortcut, altShortcuts, icon, variant = 'default', showShortcut = true, disabled, title, className, ...rest }: ToolButtonProps) {
  const map: Record<string, (() => void) | null> = {};
  if (!disabled) for (const s of [shortcut, ...(altShortcuts ?? [])]) if (s) map[s] = onClick;
  useShortcuts(map);
  const tip = [typeof label === 'string' ? label : title, shortcut ? `(${formatShortcut(shortcut)})` : ''].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={`btn tool-btn btn-${variant}` + (className ? ' ' + className : '')}
      onClick={onClick}
      disabled={disabled}
      title={title ?? tip}
      aria-keyshortcuts={shortcut ? shortcut.replace('Mod', 'Control') : undefined}
      {...rest}
    >
      {icon && <span className="tool-icon">{icon}</span>}
      <span className="tool-label">{label}</span>
      {shortcut && showShortcut && <Kbd shortcut={shortcut} />}
    </button>
  );
}

export function Toolbar({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="toolbar" aria-label={label} className={'toolbar' + (className ? ' ' + className : '')}>
      {children}
    </div>
  );
}

export function ToolbarSeparator() {
  return <span className="toolbar-sep" role="separator" />;
}

export interface MenuItem {
  label: ReactNode;
  onSelect?: () => void;
  /** A link (opens in a new tab when external). */
  href?: string;
  external?: boolean;
  description?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

/** A button that opens a menu of actions or links. */
export function Menu({ label, items, align = 'start', buttonClass, icon }: { label: ReactNode; items: (MenuItem | 'separator')[]; align?: 'start' | 'end'; buttonClass?: string; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    list.current?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const focusables = () => [...(list.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])];
  const onKey = (e: React.KeyboardEvent) => {
    const els = focusables();
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') els[(i + 1) % els.length]?.focus();
    else if (e.key === 'ArrowUp') els[(i - 1 + els.length) % els.length]?.focus();
    else if (e.key === 'Home') els[0]?.focus();
    else if (e.key === 'End') els[els.length - 1]?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      if (e.key === 'Escape') root.current?.querySelector<HTMLElement>('button')?.focus();
      if (e.key === 'Tab') return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div className="menu" ref={root} onKeyDown={open ? onKey : undefined}>
      <button
        type="button"
        className={buttonClass ?? 'btn'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        {label}
        <svg className="menu-caret" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div id={id} role="menu" ref={list} className={'menu-list menu-' + align}>
          {items.map((item, i) =>
            item === 'separator' ? (
              <div key={i} role="separator" className="menu-sep" />
            ) : item.href ? (
              <a
                key={i}
                role="menuitem"
                className="menu-item"
                href={item.href}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener' : undefined}
                onClick={() => setOpen(false)}
              >
                <span className="menu-item-label">{item.label}</span>
                {item.description && <span className="menu-item-desc">{item.description}</span>}
              </a>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                className={'menu-item' + (item.danger ? ' is-danger' : '')}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                <span className="menu-item-label">
                  {item.label}
                  {item.shortcut && <Kbd shortcut={item.shortcut} />}
                </span>
                {item.description && <span className="menu-item-desc">{item.description}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
