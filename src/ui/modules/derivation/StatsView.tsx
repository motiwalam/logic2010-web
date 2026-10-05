// The Statistics view of the Derivations screen: for each derivation with work, its length as
// entered and expanded (one rule per line), its depth (the most formulas on the stack of any
// justification) and its number of Show lines. Sortable by any column; a row opens its problem.

import { useMemo, useState } from 'react';
import type { DerivationStats } from '../../../engine/modules/derivation/expandDerivation';

export interface StatsRow {
  index: number;
  name: string;
  /** "1.001: ~Q ∴ (P→Q)→~P" */
  label: string;
  example: boolean;
  /** The problem's state in the work (STATE_CORRECT ...). */
  correct: boolean;
  stats: DerivationStats | null | undefined;
}

type Key = 'index' | 'lines' | 'expanded' | 'depth' | 'shows';

const COLUMNS: { key: Key; label: string; about: string }[] = [
  { key: 'lines', label: 'Lines', about: 'Lines as entered (not counting the problem line or blank lines)' },
  { key: 'expanded', label: 'Expanded', about: 'Lines with one rule per line (Expand); — if the derivation has errors' },
  { key: 'depth', label: 'Depth', about: 'The most formulas on the stack of any justification' },
  { key: 'shows', label: 'Shows', about: 'Show lines (not counting the problem line)' },
];

function value(r: StatsRow, key: Key): number | null {
  if (key === 'index') return r.index;
  const s = r.stats;
  if (s == null) return null;
  if (key === 'lines') return s.lines;
  if (key === 'expanded') return s.expandedLines;
  return key === 'depth' ? s.depth : s.shows;
}

function average(rows: StatsRow[], key: Key): string {
  const values = rows.map((r) => value(r, key)).filter((v): v is number => v != null);
  if (values.length === 0) return '—';
  return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
}

export function StatsView({ rows, pending, onOpen, onClose }: { rows: StatsRow[]; pending: number; onOpen: (name: string) => void; onClose: () => void }) {
  const [sort, setSort] = useState<{ key: Key; down: boolean }>({ key: 'index', down: false });
  const [completedOnly, setCompletedOnly] = useState(false);
  const [examples, setExamples] = useState(false);

  const shown = useMemo(() => {
    const list = rows.filter((r) => (examples || !r.example) && (!completedOnly || r.correct));
    const sign = sort.down ? -1 : 1;
    return list.sort((a, b) => {
      const x = value(a, sort.key);
      const y = value(b, sort.key);
      // no value (still measuring, or errors) sorts last either way
      if (x == null || y == null) return x == null && y == null ? a.index - b.index : x == null ? 1 : -1;
      return x !== y ? sign * (x - y) : a.index - b.index;
    });
  }, [rows, sort, completedOnly, examples]);

  const header = (key: Key, label: string, about: string, numeric = true) => {
    const active = sort.key === key;
    return (
      <th scope="col" className={numeric ? 'num' : undefined} aria-sort={active ? (sort.down ? 'descending' : 'ascending') : 'none'} title={about}>
        <button
          type="button"
          className="dl-stats-sort"
          // numbers first sort longest first; the problem order from the top
          onClick={() => setSort(active ? { key, down: !sort.down } : { key, down: key !== 'index' })}
        >
          {label}
          <span aria-hidden="true" className="dl-stats-arrow">
            {active ? (sort.down ? '▼' : '▲') : ''}
          </span>
        </button>
      </th>
    );
  };

  return (
    <section className="dl-stats" aria-label="Derivation statistics">
      <div className="dl-stats-head">
        <h2>Statistics</h2>
        <label>
          <input type="checkbox" checked={completedOnly} onChange={() => setCompletedOnly(!completedOnly)} /> Completed only
        </label>
        <label>
          <input type="checkbox" checked={examples} onChange={() => setExamples(!examples)} /> Worked examples
        </label>
        {pending > 0 && <span className="muted small">Measuring… {pending} to go</span>}
        <button type="button" className="btn btn-small" onClick={onClose}>
          Close
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="muted">{rows.length === 0 ? 'No derivations with work yet.' : 'No derivations match.'}</p>
      ) : (
        <div className="dl-stats-scroll">
          <table className="dl-stats-table">
            <thead>
              <tr>
                {header('index', 'Problem', 'In the order of the problem list', false)}
                {COLUMNS.map((c) => header(c.key, c.label, c.about))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.index} className={r.correct ? 'is-correct' : undefined}>
                  <th scope="row">
                    <button type="button" className="linklike dl-stats-name" onClick={() => onOpen(r.name)}>
                      {r.correct && <span aria-label="completed">✓ </span>}
                      {r.label}
                    </button>
                  </th>
                  {COLUMNS.map((c) => {
                    const v = value(r, c.key);
                    return (
                      <td key={c.key} className="num">
                        {r.stats === undefined ? '…' : v == null ? '—' : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Average of {shown.length}</th>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="num">
                    {average(shown, c.key)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
