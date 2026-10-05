// Tidy: clean up many derivations at once (web only). The dialog asks which clean-ups and which
// derivations (all of both by default), works out what would change, and shows that for
// confirmation; it resolves with the results to apply, or null.

import { useMemo, useState } from 'react';
import { ALL_TIDY_OPTIONS, type TidyOptions, type TidyResult } from '../../../engine/modules/derivation/tidyDerivation';
import { dialogs, DialogButtons } from '../../dialogs/dialogs';

export interface TidyCandidate {
  index: number;
  name: string;
  /** "Deriv 1.001: P->Q . P ∴ Q" */
  text: string;
}

export interface TidyOutcome {
  candidate: TidyCandidate;
  result: TidyResult;
}

const CLEANUPS: { key: keyof TidyOptions; label: string; about: string }[] = [
  { key: 'blankLines', label: 'Remove blank lines', about: 'Lines with neither a formula nor a justification.' },
  {
    key: 'unusedLines',
    label: 'Remove unused lines',
    about: 'Lines and boxes that a closed box, or the finished derivation, does not need. Work in progress is kept.',
  },
  {
    key: 'repeatedLines',
    label: 'Remove repeated lines',
    about: 'A line or box whose formula is already available above it; the lines citing it cite the earlier one.',
  },
  {
    key: 'notation',
    label: 'Normalize notation',
    about: 'Formulas as the program writes them, rule names as in the rules list (MP, Adj, ASS CD), PR as the premise it gives, single spaces. Asserted results […] (normalized), answers after / and comments are kept.',
  },
];

export function tidyDialog(candidates: TidyCandidate[], tidy: (c: TidyCandidate, options: TidyOptions) => Promise<TidyResult>): Promise<TidyOutcome[] | null> {
  return dialogs.open<TidyOutcome[] | null>((done) => <TidyBody candidates={candidates} tidy={tidy} done={done} />, {
    title: 'Tidy derivations',
    dismissValue: null,
    size: 'large',
  });
}

type Step = { kind: 'choose' } | { kind: 'working'; done: number; total: number } | { kind: 'review'; outcomes: TidyOutcome[] };

function TidyBody({
  candidates,
  tidy,
  done,
}: {
  candidates: TidyCandidate[];
  tidy: (c: TidyCandidate, options: TidyOptions) => Promise<TidyResult>;
  done: (v: TidyOutcome[] | null) => void;
}) {
  const [options, setOptions] = useState<TidyOptions>({ ...ALL_TIDY_OPTIONS });
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(candidates.map((c) => c.index)));
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'choose' });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? candidates : candidates.filter((c) => c.text.toLowerCase().includes(q));
  }, [candidates, query]);
  const anyOption = Object.values(options).some(Boolean);

  const toggle = (i: number) => {
    const next = new Set(chosen);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setChosen(next);
  };
  const setShown = (on: boolean) => {
    const next = new Set(chosen);
    for (const c of shown) {
      if (on) next.add(c.index);
      else next.delete(c.index);
    }
    setChosen(next);
  };

  const review = async () => {
    const list = candidates.filter((c) => chosen.has(c.index));
    const outcomes: TidyOutcome[] = [];
    setStep({ kind: 'working', done: 0, total: list.length });
    for (let k = 0; k < list.length; k++) {
      outcomes.push({ candidate: list[k], result: await tidy(list[k], options) });
      if (k % 5 === 4) {
        setStep({ kind: 'working', done: k + 1, total: list.length });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    setStep({ kind: 'review', outcomes });
  };

  if (step.kind === 'working') {
    return (
      <div className="dl-tidy" aria-busy="true">
        <p>
          Working out the changes… {step.done} of {step.total}
        </p>
        <progress max={step.total} value={step.done} />
      </div>
    );
  }

  if (step.kind === 'review') {
    const changed = step.outcomes.filter((o) => o.result.changed);
    const unchanged = step.outcomes.filter((o) => !o.result.changed);
    const noted = unchanged.filter((o) => o.result.note != null);
    return (
      <div className="dl-tidy">
        <p className="dialog-text">
          {changed.length === 0
            ? 'Nothing to tidy: the chosen derivations are tidy already.'
            : `${changed.length} of ${step.outcomes.length} derivation${step.outcomes.length === 1 ? '' : 's'} will change. Each still checks as it did. This changes your saved work.`}
        </p>
        {changed.length > 0 && (
          <ul className="dl-tidy-list" aria-label="Derivations that change">
            {changed.map((o) => (
              <li key={o.candidate.index}>
                <span className="dl-tidy-name">{o.candidate.text}</span>
                <span className="muted small">
                  {o.result.linesBefore === o.result.linesAfter ? `${o.result.linesAfter} lines` : `${o.result.linesBefore} → ${o.result.linesAfter} lines`}
                  {o.result.done.length > 0 ? ' · ' + o.result.done.join(', ') : ''}
                  {o.result.note ? ' · ' + o.result.note : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {noted.length > 0 && (
          <details>
            <summary className="small">Left as they are, with a note ({noted.length})</summary>
            <ul className="dl-tidy-list">
              {noted.map((o) => (
                <li key={o.candidate.index}>
                  <span className="dl-tidy-name">{o.candidate.text}</span>
                  <span className="muted small">{o.result.note}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <DialogButtons>
          <button type="button" className="btn" onClick={() => setStep({ kind: 'choose' })}>
            Back
          </button>
          <button type="button" className="btn" onClick={() => done(null)}>
            {changed.length === 0 ? 'Close' : 'Cancel'}
          </button>
          {changed.length > 0 && (
            <button type="button" className="btn btn-primary" autoFocus onClick={() => done(changed)}>
              Tidy {changed.length} derivation{changed.length === 1 ? '' : 's'}
            </button>
          )}
        </DialogButtons>
      </div>
    );
  }

  return (
    <div className="dl-tidy">
      <fieldset className="dl-tidy-options">
        <legend>Clean-ups</legend>
        {CLEANUPS.map((c) => (
          <label key={c.key} className="dl-tidy-option">
            <input type="checkbox" checked={options[c.key]} onChange={() => setOptions({ ...options, [c.key]: !options[c.key] })} />
            <span>
              <strong>{c.label}</strong>
              <span className="muted small"> {c.about}</span>
            </span>
          </label>
        ))}
        <p className="muted small">Unused and repeated lines are only removed from derivations without errors.</p>
      </fieldset>
      <fieldset className="dl-tidy-problems">
        <legend>Derivations</legend>
        <div className="dl-tidy-tools">
          <input className="input" type="search" placeholder="Search derivations" aria-label="Search derivations" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className="btn btn-small" onClick={() => setShown(true)}>
            Choose all shown
          </button>
          <button type="button" className="btn btn-small" onClick={() => setShown(false)}>
            Clear shown
          </button>
        </div>
        <div className="dl-tidy-rows" role="group" aria-label="Derivations">
          {shown.map((c) => (
            <label key={c.index} className="dl-tidy-row">
              <input type="checkbox" checked={chosen.has(c.index)} onChange={() => toggle(c.index)} />
              <span>{c.text}</span>
            </label>
          ))}
        </div>
        <p className="muted small">
          {chosen.size} of {candidates.length} derivation{candidates.length === 1 ? '' : 's'} with work chosen (worked examples are not included).
        </p>
      </fieldset>
      <DialogButtons>
        <button type="button" className="btn" onClick={() => done(null)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!anyOption || chosen.size === 0} onClick={() => void review()}>
          Review changes
        </button>
      </DialogButtons>
    </div>
  );
}
