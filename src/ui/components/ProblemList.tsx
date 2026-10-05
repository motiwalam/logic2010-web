// ProblemList: a module's problems with their headings, states (coloured as the desktop's
// problem list: correct green, incorrect/incomplete red, restricted problems orange), a
// search field, keyboard navigation and the completed counts.

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';

/** Problem states, indexed by the engine's STATE_* numbers (ProblemEntry.ts). */
export const PROBLEM_STATES = ['no-work', 'incorrect', 'correct', 'incomplete', 'unchecked'] as const;
export type ProblemState = (typeof PROBLEM_STATES)[number];

export const STATE_LABELS: Record<ProblemState, string> = {
  'no-work': 'No work',
  incorrect: 'Incorrect',
  correct: 'Correct',
  incomplete: 'Incomplete',
  unchecked: 'Not checked yet',
};

export function stateName(state: ProblemState | number): ProblemState {
  return typeof state === 'number' ? (PROBLEM_STATES[state] ?? 'no-work') : state;
}

export type ProblemRow =
  | { kind: 'heading'; text: string }
  | {
      kind: 'problem';
      /** The problem's name (what openProblem takes and the URL shows). */
      id: string;
      /** The row's text, e.g. "1.001:  ∼Q ∴ (P→Q)→∼P" (display symbols). */
      label: ReactNode;
      /** Plain text searched by the default filter (defaults to label if it is a string). */
      searchText?: string;
      /** Hover text (e.g. what the problem proves). */
      hover?: string;
      state: ProblemState | number;
      /** Marked orange (the module's restricting selector, e.g. monoProbs). */
      restricted?: boolean;
      /** Counted in "Completed / Not completed" (not worked examples or your own problems). */
      counted?: boolean;
      /** A short note at the row's end (e.g. a derivation's length), and its explanation. */
      meta?: ReactNode;
      metaTitle?: string;
    };

/**
 * The default search: every word of the query occurs in the problem's text (case-insensitive);
 * matching problems are shown with the headings just above them.
 */
export function defaultFilter(query: string, rows: readonly ProblemRow[]): ProblemRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows.slice();
  const out: ProblemRow[] = [];
  let headings: ProblemRow[] = [];
  let lastWasProblem = true;
  for (const r of rows) {
    if (r.kind === 'heading') {
      if (lastWasProblem) headings = [];
      headings.push(r);
      lastWasProblem = false;
      continue;
    }
    lastWasProblem = true;
    const text = (r.id + ' ' + (r.searchText ?? (typeof r.label === 'string' ? r.label : '')) + ' ' + (r.hover ?? '')).toLowerCase();
    if (terms.every((t) => text.includes(t))) {
      out.push(...headings.filter((h) => h.kind === 'heading' && h.text.trim() !== ''));
      headings = [];
      out.push(r);
    }
  }
  return out;
}

/** "Completed: n    Not completed: m" (the desktop's count line), plus the matches while searching. */
export function defaultCountLabel(query: string, all: readonly ProblemRow[], shown: readonly ProblemRow[]): string {
  const count = (rows: readonly ProblemRow[]) => {
    let completed = 0;
    let counted = 0;
    let n = 0;
    for (const r of rows) {
      if (r.kind !== 'problem') continue;
      n++;
      if (r.counted === false) continue;
      counted++;
      if (stateName(r.state) === 'correct') completed++;
    }
    return { completed, counted, n };
  };
  const a = count(all);
  let s = `Completed: ${a.completed}    Not completed: ${a.counted - a.completed}`;
  if (query.trim() !== '') {
    const m = count(shown);
    s += `    (matches: ${m.n}, ${m.completed} of ${m.counted} completed)`;
  }
  return s;
}

/** The problem after `current` in the list (skipping headings), or null. */
export function nextProblem(rows: readonly ProblemRow[], current: string | null, delta = 1): string | null {
  const problems = rows.filter((r): r is Extract<ProblemRow, { kind: 'problem' }> => r.kind === 'problem');
  if (problems.length === 0) return null;
  const i = problems.findIndex((p) => p.id === current);
  if (i === -1) return problems[delta > 0 ? 0 : problems.length - 1].id;
  return problems[i + delta]?.id ?? null;
}

export interface ProblemListProps {
  rows: readonly ProblemRow[];
  /** The open problem. */
  selected: string | null;
  /** A problem was chosen (click, or Enter on the keyboard cursor). */
  onOpen(id: string): void;
  /** Search: the rows to show for a query (default: defaultFilter). */
  filter?: (query: string, rows: readonly ProblemRow[]) => ProblemRow[];
  /** The line under the list (default: defaultCountLabel); null hides it. */
  countLabel?: ((query: string, all: readonly ProblemRow[], shown: readonly ProblemRow[]) => ReactNode) | null;
  searchPlaceholder?: string;
  /** A note under the search field for a query (e.g. a formula that does not parse), or null. */
  hint?: (query: string) => ReactNode | null;
  /** Search syntax, shown by a "?" button next to the search field. */
  searchHelp?: ReactNode;
  /** Accessible name of the list. */
  label?: string;
  className?: string;
}

export interface ProblemListHandle {
  /** Puts the focus in the search field (Ctrl+O). */
  focusSearch(): void;
}

function glyph(state: ProblemState): string {
  switch (state) {
    case 'correct':
      return '✓';
    case 'incorrect':
      return '✗';
    case 'incomplete':
      return '…';
    case 'unchecked':
      return '?';
    default:
      return '';
  }
}

export const ProblemList = forwardRef<ProblemListHandle, ProblemListProps>(function ProblemList(props, ref) {
  const { rows, selected, onOpen } = props;
  const [query, setQuery] = useState('');
  const filter = props.filter ?? defaultFilter;
  const shown = useMemo(() => filter(query, rows), [filter, query, rows]);
  const [cursor, setCursor] = useState<string | null>(selected);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const optId = (id: string) => baseId + '-' + encodeURIComponent(id).replace(/%/g, '_');

  useImperativeHandle(ref, () => ({ focusSearch: () => search.current?.focus() }));

  useEffect(() => setCursor(selected), [selected]);

  // keep the cursor on a shown problem
  const shownProblems = shown.filter((r) => r.kind === 'problem') as Extract<ProblemRow, { kind: 'problem' }>[];
  const cursorShown = shownProblems.some((p) => p.id === cursor);
  const active = cursorShown ? cursor : (shownProblems[0]?.id ?? null);

  /** Scrolls the list (only the list, not the page) to show a row. */
  const reveal = (id: string | null, center: boolean) => {
    const box = list.current;
    const el = id ? document.getElementById(optId(id)) : null;
    if (!box || !el) return;
    const top = el.offsetTop; // the list is the offset parent (position: relative)
    if (center) box.scrollTop = top - box.clientHeight / 2 + el.offsetHeight / 2;
    else if (top < box.scrollTop) box.scrollTop = top;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight;
  };

  useEffect(() => reveal(active, false), [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // the open problem is scrolled into view when it changes
  useEffect(() => reveal(selected, true), [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (delta: number) => {
    const i = shownProblems.findIndex((p) => p.id === active);
    const next = shownProblems[Math.max(0, Math.min(shownProblems.length - 1, i + delta))];
    if (next) setCursor(next.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'PageDown':
        move(10);
        break;
      case 'PageUp':
        move(-10);
        break;
      case 'Home':
        if (e.target === search.current) return;
        setCursor(shownProblems[0]?.id ?? null);
        break;
      case 'End':
        if (e.target === search.current) return;
        setCursor(shownProblems[shownProblems.length - 1]?.id ?? null);
        break;
      case 'Enter':
        if (active) onOpen(active);
        break;
      case 'Escape':
        if (query) setQuery('');
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const hint = props.hint && query.trim() !== '' ? props.hint(query) : null;
  const [helpOpen, setHelpOpen] = useState(false);
  const count = props.countLabel === null ? null : (props.countLabel ?? defaultCountLabel)(query, rows, shown);

  return (
    <div className={'problem-list' + (props.className ? ' ' + props.className : '')}>
      <div className="problem-search">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="search-icon">
          <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={search}
          type="search"
          className="input"
          placeholder={props.searchPlaceholder ?? 'Search problems'}
          aria-label="Search problems"
          aria-controls={baseId + '-list'}
          aria-activedescendant={active ? optId(active) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby={hint ? baseId + '-hint' : undefined}
        />
        {props.searchHelp != null && (
          <button
            type="button"
            className="search-help-button"
            aria-label="Search syntax"
            aria-expanded={helpOpen}
            aria-controls={baseId + '-help'}
            title="Search syntax"
            onClick={() => setHelpOpen((o) => !o)}
          >
            ?
          </button>
        )}
      </div>
      {props.searchHelp != null && helpOpen && (
        <div id={baseId + '-help'} className="search-help" role="note">
          {props.searchHelp}
        </div>
      )}
      {hint != null && (
        <p id={baseId + '-hint'} className="search-hint" role="status">
          {hint}
        </p>
      )}
      <ul
        ref={list}
        id={baseId + '-list'}
        role="listbox"
        aria-label={props.label ?? 'Problems'}
        tabIndex={0}
        aria-activedescendant={active ? optId(active) : undefined}
        className="problem-rows"
        onKeyDown={onKeyDown}
      >
        {shown.map((r, i) =>
          r.kind === 'heading' ? (
            <li key={'h' + i} role="presentation" className={'problem-heading' + (r.text.trim() === '' ? ' is-blank' : '')}>
              {r.text}
            </li>
          ) : (
            <li
              key={r.id}
              id={optId(r.id)}
              role="option"
              aria-selected={r.id === selected}
              className={
                'problem-row state-' +
                stateName(r.state) +
                (r.restricted ? ' is-restricted' : '') +
                (r.id === selected ? ' is-open' : '') +
                (r.id === active ? ' is-cursor' : '')
              }
              title={r.hover}
              onClick={() => {
                setCursor(r.id);
                onOpen(r.id);
              }}
            >
              <span className="problem-state" aria-hidden="true">
                {glyph(stateName(r.state))}
              </span>
              <span className="problem-label">{r.label}</span>
              {r.meta != null && (
                <span className="problem-meta" title={r.metaTitle}>
                  {r.meta}
                </span>
              )}
              <span className="visually-hidden">
                {', ' + STATE_LABELS[stateName(r.state)]}
                {r.restricted ? ', restricted' : ''}
              </span>
            </li>
          ),
        )}
        {shown.length === 0 && (
          <li role="presentation" className="problem-empty">
            {query ? 'No problem matches every word.' : 'No problems.'}
          </li>
        )}
      </ul>
      {count != null && (
        <p className="problem-count" aria-live="polite">
          {count}
        </p>
      )}
    </div>
  );
});
