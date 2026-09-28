import { useEffect, useState } from 'react';
import { api } from '../../sync/api';
import { workPath } from '../../workspace/paths';
import { ReadOnlyWorkspace } from '../../workspace/source';
import { apiErrorText } from '../app/accountFlows';
import { summaryText, useServices } from '../app/context';
import { useNotation } from '../app/notation';
import { exportAll, forkFlow } from '../app/workActions';
import { MODULE_CATALOG } from '../modules/registry';
import { Link } from '../router';
import { ModulePage } from './ModulePage';
import { relativeTime } from './PeoplePage';

const cache = new Map<string, { at: number; ws: ReadOnlyWorkspace; createdAt: string; updatedAt: string }>();

export function PersonPage({ username, moduleId, problem }: { username: string; moduleId: string | null; problem: string | null }) {
  const key = username.toLowerCase();
  const cached = cache.get(key);
  const [data, setData] = useState(cached && Date.now() - cached.at < 60000 ? cached : null);
  const [error, setError] = useState<string | null>(null);
  const services = useServices();
  const notation = useNotation();

  useEffect(() => {
    let live = true;
    if (data && data.ws.ownerName.toLowerCase() === key) return;
    setData(null);
    setError(null);
    api
      .getUserWork(username)
      .then((w) => {
        const entry = { at: Date.now(), ws: new ReadOnlyWorkspace(w.user.username, w.files), createdAt: w.user.createdAt, updatedAt: w.user.updatedAt };
        cache.set(key, entry);
        if (live) setData(entry);
      })
      .catch((err: unknown) => live && setError(apiErrorText(err)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (error) {
    return (
      <main id="main" className="page">
        <h1>{username}</h1>
        <p className="field-error" role="alert">
          {error}
        </p>
        <Link to={{ name: 'people', query: '' }}>All people</Link>
      </main>
    );
  }
  if (!data) {
    return (
      <main id="main" className="page">
        <p className="muted" aria-busy="true">
          Loading {username}’s work…
        </p>
      </main>
    );
  }
  const ws = data.ws;
  if (moduleId) return <ModulePage key={ws.ownerName + moduleId} moduleId={moduleId} problem={problem} source={ws} owner={ws.ownerName} />;

  return (
    <main id="main" className="page person">
      <div className="readonly-banner" role="note">
        <span>
          You are viewing <strong>{ws.ownerName}</strong>’s work. It is read-only.
        </span>
      </div>
      <div className="page-head">
        <h1>{ws.ownerName}</h1>
        <p className="muted">
          Joined {new Date(data.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}; last active {relativeTime(data.updatedAt)}.
        </p>
      </div>
      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={() => void forkFlow(services.store, services.own, ws, notation)}>
          Fork into my workspace
        </button>
        <button type="button" className="btn" onClick={() => exportAll(ws, notation)}>
          Export notation {notation} work (zip)
        </button>
      </div>
      <h2 className="section-title">Notation {notation}</h2>
      <ul className="module-grid">
        {MODULE_CATALOG.map((m) => {
          const f = ws.fileInfo(workPath(notation, m.workFile));
          return (
            <li key={m.id} className={'module-card' + (f ? '' : ' is-empty')}>
              <Link to={{ name: 'person', username: ws.ownerName, module: m.id, problem: null }} className="module-card-link">
                <span className="module-card-glyph" aria-hidden="true">
                  {m.icon}
                </span>
                <span className="module-card-body">
                  <span className="module-card-title">{m.title}</span>
                  <span className="module-card-progress">{f ? `${summaryText(f.summary) ?? 'Work saved'}, ${relativeTime(f.updatedAt)}` : 'No work'}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
