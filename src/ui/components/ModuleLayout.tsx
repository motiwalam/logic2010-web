// The frame of a module screen: the problem list on the side, and the problem's title panel,
// toolbar, message bar and work area. On narrow screens the list becomes a drawer.

import { useEffect, useState, type ReactNode } from 'react';
import { getPrefs, setPrefs, usePrefs } from '../prefs';
import { FormulaText } from './FormulaText';
import { STATE_LABELS, stateName, type ProblemState } from './ProblemList';

export interface ModuleLayoutProps {
  /** The problem list (usually a <ProblemList/>). */
  sidebar?: ReactNode;
  sidebarLabel?: string;
  /** The title panel (usually a <ProblemHeader/>). */
  header?: ReactNode;
  toolbar?: ReactNode;
  /** The message bar (usually a <MessageView/>, or null). */
  message?: ReactNode;
  /** The work area. */
  children: ReactNode;
  /** Extra panel to the right of the work area (e.g. the derivation stack view). */
  aside?: ReactNode;
  footer?: ReactNode;
}

export function ModuleLayout({ sidebar, sidebarLabel = 'Problems', header, toolbar, message, children, aside, footer }: ModuleLayoutProps) {
  const prefs = usePrefs();
  const [drawer, setDrawer] = useState(false);
  const collapsed = prefs.sidebarCollapsed;
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  return (
    <div className={'module-layout' + (sidebar ? '' : ' no-sidebar') + (collapsed ? ' is-collapsed' : '') + (drawer ? ' drawer-open' : '')}>
      {sidebar && (
        <>
          <aside className="module-sidebar" aria-label={sidebarLabel} onClick={(e) => (e.target as HTMLElement).closest('.problem-row') && setDrawer(false)}>
            <div className="sidebar-head">
              <h2 className="sidebar-title">{sidebarLabel}</h2>
              <button
                type="button"
                className="icon-btn sidebar-collapse"
                aria-label={collapsed ? `Show ${sidebarLabel.toLowerCase()}` : `Hide ${sidebarLabel.toLowerCase()}`}
                title={collapsed ? 'Show the list' : 'Hide the list'}
                onClick={() => {
                  if (drawer) setDrawer(false);
                  else setPrefs({ sidebarCollapsed: !getPrefs().sidebarCollapsed });
                }}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
            </div>
            {!collapsed || drawer ? sidebar : null}
          </aside>
          <button type="button" className="btn drawer-toggle" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
            {sidebarLabel}
          </button>
          {drawer && <div className="drawer-scrim" onClick={() => setDrawer(false)} />}
        </>
      )}
      <main className="module-main" id="main">
        {header && <div className="module-header">{header}</div>}
        {toolbar && <div className="module-toolbar">{toolbar}</div>}
        {message && <div className="module-message">{message}</div>}
        <div className="module-work-row">
          <div className="module-work">{children}</div>
          {aside && <div className="module-aside">{aside}</div>}
        </div>
        {footer && <div className="module-footer">{footer}</div>}
      </main>
    </div>
  );
}

export interface ProblemHeaderProps {
  /** The problem's name, e.g. "Deriv 1.001". */
  name: ReactNode;
  /** The statement; a string is taken as a formula in maggie notation and shown in symbols. */
  statement?: ReactNode;
  /** A problem state (shown as Correct, Incorrect, ...) or your own status text. */
  status?: ProblemState | number | { text: string; tone: 'good' | 'bad' | 'neutral' | 'warn' } | null;
  /** The problem's note (the `note:` field). */
  note?: ReactNode;
  /** Extra controls on the right (e.g. previous/next). */
  actions?: ReactNode;
}

const TONES: Record<ProblemState, 'good' | 'bad' | 'neutral' | 'warn'> = {
  correct: 'good',
  incorrect: 'bad',
  incomplete: 'warn',
  'no-work': 'neutral',
  unchecked: 'neutral',
};

export function StatusPill({ status }: { status: NonNullable<ProblemHeaderProps['status']> }) {
  const s = typeof status === 'object' ? status : { text: STATE_LABELS[stateName(status)], tone: TONES[stateName(status)] };
  return <span className={'status-pill tone-' + s.tone}>{s.text}</span>;
}

/** The title panel of a problem (the desktop's ProblemTitlePanel). */
export function ProblemHeader({ name, statement, status, note, actions }: ProblemHeaderProps) {
  return (
    <div className="problem-header">
      <div className="problem-header-top">
        <h1 className="problem-name">{name}</h1>
        {status != null && <StatusPill status={status} />}
        {actions && <div className="problem-header-actions">{actions}</div>}
      </div>
      {statement != null && (
        <div className="problem-statement">{typeof statement === 'string' ? <FormulaText value={statement} block /> : statement}</div>
      )}
      {note != null && note !== '' && <p className="problem-note">{note}</p>}
    </div>
  );
}
