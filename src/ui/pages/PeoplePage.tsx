import { useEffect, useState } from 'react';
import { api, type UserListing, type WorkFileMeta } from '../../sync/api';
import { parseWorkPath } from '../../workspace/paths';
import { apiErrorText } from '../app/accountFlows';
import { useWorkspace } from '../app/context';
import { MODULE_CATALOG } from '../modules/registry';
import { Link, navigate } from '../router';

const PAGE = 50;

export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = (Date.now() - t) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (s < 60) return 'just now';
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), 'day');
  return new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** Per-module progress from a user's file list (both notations added up). */
export function progressByModule(files: readonly WorkFileMeta[]) {
  return MODULE_CATALOG.map((m) => {
    let completed = 0;
    let total = 0;
    let has = false;
    let known = false;
    for (const f of files) {
      const p = parseWorkPath(f.path);
      if (!p || p.file !== m.workFile) continue;
      has = true;
      if (typeof f.summary.completed === 'number') {
        completed += f.summary.completed;
        known = true;
      }
      if (typeof f.summary.total === 'number') total += f.summary.total;
    }
    return { module: m, has, completed: known ? completed : null, total };
  });
}

export function PeoplePage({ query }: { query: string }) {
  const [text, setText] = useState(query);
  const [users, setUsers] = useState<UserListing[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const ws = useWorkspace();
  const me = ws.account.kind === 'user' ? ws.account.username.toLowerCase() : null;

  useEffect(() => {
    let live = true;
    setError(null);
    const t = setTimeout(
      () => {
        api
          .listUsers({ query, limit: PAGE })
          .then((r) => {
            if (!live) return;
            setUsers(r.users);
            setTotal(r.total);
          })
          .catch((err: unknown) => live && setError(apiErrorText(err)));
      },
      users == null ? 0 : 150,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const r = await api.listUsers({ query, limit: PAGE, offset: users?.length ?? 0 });
      setUsers([...(users ?? []), ...r.users]);
      setTotal(r.total);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <main id="main" className="page people">
      <div className="page-head">
        <h1>People</h1>
        <p className="muted">Everyone’s saved work is public. Open someone’s work to see how they solved a problem, or fork it into your own workspace.</p>
      </div>
      <div className="people-search">
        <label htmlFor="people-q" className="visually-hidden">
          Search by username
        </label>
        <input
          id="people-q"
          type="search"
          className="input"
          placeholder="Search by username"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            navigate({ name: 'people', query: e.target.value.trim() }, { replace: true });
          }}
        />
        {users && <span className="muted small">{total === 1 ? '1 person' : `${total} people`}</span>}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!users && !error && <p className="muted" aria-busy="true">Loading…</p>}
      {users && users.length === 0 && <p className="muted">{query ? `Nobody’s username contains “${query}”.` : 'Nobody has saved work yet.'}</p>}
      {users && users.length > 0 && (
        <ul className="people-list">
          {users.map((u) => {
            const progress = progressByModule(u.files).filter((p) => p.has);
            return (
              <li key={u.username} className="person-row">
                <Link to={{ name: 'person', username: u.username, module: null, problem: null }} className="person-link">
                  <span className="person-name">
                    {u.username}
                    {me === u.username.toLowerCase() && <span className="tag">you</span>}
                  </span>
                  <span className="person-when muted small">active {relativeTime(u.updatedAt)}</span>
                  <span className="person-progress">
                    {progress.length === 0 && <span className="muted small">No work yet</span>}
                    {progress.map((p) => (
                      <span key={p.module.id} className="progress-chip" title={p.module.title}>
                        <span className="chip-glyph" aria-hidden="true">
                          {p.module.icon}
                        </span>
                        <span className="visually-hidden">{p.module.title}: </span>
                        {p.completed != null && p.total > 0 ? `${p.completed}/${p.total}` : 'started'}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {users && users.length < total && (
        <button type="button" className="btn" onClick={more} disabled={loadingMore}>
          Show more
        </button>
      )}
    </main>
  );
}
