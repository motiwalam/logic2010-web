import { useEffect } from 'react';
import { workPath } from '../../workspace/paths';
import { openSignIn } from '../app/accountFlows';
import { summaryText, useServices, useWorkspace } from '../app/context';
import { exportAll, importFlow } from '../app/workActions';
import { useNotation } from '../app/notation';
import { toDisplay } from '../formula/formulaText';
import { useEngine } from '../engine/engine';
import { getModule, MODULE_CATALOG } from '../modules/registry';
import { Link } from '../router';
import { lastVisited } from './ModulePage';

/** Deriv 1.001, the first problem of the course. */
const HERO_ARGUMENT = '~Q .: (P->Q)->~P';

export function HomePage() {
  const ws = useWorkspace();
  const { store, own } = useServices();
  const notation = useNotation();
  const engine = useEngine();
  const last = lastVisited();
  const lastInfo = last && MODULE_CATALOG.find((m) => m.id === last.module);

  useEffect(() => {
    if (ws.ready && engine.status === 'ready') void store.ensureSummaries();
  }, [ws.ready, ws.revision, engine.status, engine.notation, store]);

  const [premise, conclusion] = toDisplay(HERO_ARGUMENT).split('∴');

  return (
    <main id="main" className="page home">
      <section className="hero" aria-labelledby="hero-title">
        <p className="hero-formula" aria-label="Example argument: not Q, therefore if P then Q, then not P">
          <span>{premise.trim()}</span>
          <span className="hero-therefore">∴</span>
          <span>{conclusion.trim()}</span>
        </p>
        <h1 id="hero-title" className="hero-title">
          Practice formal logic, one problem at a time.
        </h1>
        <p className="hero-lede">
          The exercises of UCLA’s Logic 2010 course, checked as you work: symbolization, parsing, truth tables, derivations, invalidity and rule
          recognition. Start solving now; your work is saved in this browser, and an account to sync it is optional.
        </p>
        <div className="hero-actions">
          {last && lastInfo ? (
            <Link to={{ name: 'module', module: lastInfo.id, problem: last.problem }} className="btn btn-primary btn-large">
              Continue {lastInfo.title.toLowerCase()}
              {last.problem ? ` at ${last.problem}` : ''}
            </Link>
          ) : (
            <Link to={{ name: 'module', module: 'derivation', problem: null }} className="btn btn-primary btn-large">
              Start with derivations
            </Link>
          )}
          <Link to={{ name: 'help' }} className="btn btn-large btn-quiet">
            How the program works
          </Link>
        </div>
      </section>

      <section className="modules" aria-labelledby="modules-title">
        <div className="section-head">
          <h2 id="modules-title">Exercises</h2>
          <p className="muted">Notation {notation}. Your work in each notation is kept separately.</p>
        </div>
        <ul className="module-grid">
          {MODULE_CATALOG.map((m) => {
            const rec = ws.files[workPath(notation, m.workFile)];
            const s = rec?.content != null ? rec.summary : undefined;
            const text = rec?.content != null ? (summaryText(s) ?? 'Work saved') : 'Not started';
            const pct = s && typeof s.completed === 'number' && typeof s.total === 'number' && s.total > 0 ? Math.round((100 * s.completed) / s.total) : null;
            const def = getModule(m.id);
            return (
              <li key={m.id} className="module-card">
                <Link to={{ name: 'module', module: m.id, problem: null }} className="module-card-link">
                  <span className="module-card-glyph" aria-hidden="true">
                    {m.icon}
                  </span>
                  <span className="module-card-body">
                    <span className="module-card-title">{m.title}</span>
                    <span className="module-card-desc">{m.description}</span>
                    <span className="module-card-progress">
                      {pct != null && (
                        <span className="meter" aria-hidden="true">
                          <span style={{ width: pct + '%' }} />
                        </span>
                      )}
                      <span>{def ? text : text === 'Not started' ? 'Browse the problems' : text}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="home-work" aria-labelledby="work-title">
        <h2 id="work-title">Your work</h2>
        {ws.account.kind === 'anonymous' ? (
          <p>
            Saved in this browser only. <button type="button" className="link-btn" onClick={() => void openSignIn(store, 'sign-up')}>Create an account</button> to
            keep it on the server and continue on another computer; your work so far comes with you.
          </p>
        ) : (
          <p>
            Signed in as <strong>{ws.account.username}</strong>. Your work is saved to your account as you go, and anyone can view it on the{' '}
            <Link to={{ name: 'people', query: '' }}>People</Link> page.
          </p>
        )}
        <div className="button-row">
          <button type="button" className="btn" onClick={() => void importFlow(store, own, notation)}>
            Import work files…
          </button>
          <button type="button" className="btn" onClick={() => exportAll(own, notation)}>
            Export all (zip)
          </button>
          <Link to={{ name: 'settings', section: 'work' }} className="btn btn-quiet">
            More in Settings
          </Link>
        </div>
      </section>
    </main>
  );
}
