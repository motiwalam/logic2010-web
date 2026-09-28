import { useEffect } from 'react';
import { download } from '../../workspace/transfer';
import { parseWorkPath, WORK_FILES, workPath } from '../../workspace/paths';
import { changePasswordFlow, deleteAccountFlow, describePath, openSignIn, signOutFlow } from '../app/accountFlows';
import { summaryText, useServices, useWorkspace } from '../app/context';
import { useNotation } from '../app/notation';
import { exportAll, exportModule, importFlow, resetFlow } from '../app/workActions';
import { NotationSwitch } from '../components/NotationSwitch';
import { dialogs } from '../dialogs/dialogs';
import { useEngine } from '../engine/engine';
import { setPrefs, TEXT_SCALES, usePrefs, type Theme } from '../prefs';
import { useRoute } from '../router';

export function SettingsPage() {
  const route = useRoute();
  const section = route.name === 'settings' ? route.section : null;
  useEffect(() => {
    if (section) document.getElementById('settings-' + section)?.scrollIntoView();
  }, [section]);
  return (
    <main id="main" className="page settings">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <DisplaySettings />
      <NotationSettings />
      <AccountSettings />
      <WorkSettings />
      <Backups />
    </main>
  );
}

function DisplaySettings() {
  const prefs = usePrefs();
  return (
    <section id="settings-display" className="settings-section" aria-labelledby="set-display">
      <h2 id="set-display">Display</h2>
      <div className="setting">
        <span className="setting-label" id="theme-label">
          Theme
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={prefs.theme === t} className={prefs.theme === t ? 'is-on' : ''} onClick={() => setPrefs({ theme: t })}>
              {t === 'system' ? 'Like the system' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <span className="setting-label" id="size-label">
          Text size
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="size-label">
          {TEXT_SCALES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={prefs.textScale === s} className={prefs.textScale === s ? 'is-on' : ''} onClick={() => setPrefs({ textScale: s })}>
              <span style={{ fontSize: `${0.8 * s}rem` }}>A</span>
              <span className="visually-hidden">{Math.round(s * 100)}%</span>
            </button>
          ))}
        </div>
      </div>
      <label className="setting check">
        <input type="checkbox" checked={prefs.highContrast} onChange={(e) => setPrefs({ highContrast: e.target.checked })} />
        <span>
          High contrast
          <span className="setting-hint">Stronger colours and borders, for projectors and bright rooms (the desktop program’s “overhead” colours).</span>
        </span>
      </label>
      <label className="setting check">
        <input type="checkbox" checked={prefs.keypadOpen} onChange={(e) => setPrefs({ keypadOpen: e.target.checked })} />
        <span>
          Show the symbol keypad under formula fields
          <span className="setting-hint">Otherwise it opens with the ∀→ button at the end of a field, or a right-click.</span>
        </span>
      </label>
    </section>
  );
}

function NotationSettings() {
  const engine = useEngine();
  const prefs = usePrefs();
  return (
    <section id="settings-notation" className="settings-section" aria-labelledby="set-notation">
      <h2 id="set-notation">Notation</h2>
      <p>
        Logic 2010 has two formula notations. Notation 2 is the one of the current textbook (Parsons, <i>An Exposition of Symbolic Logic</i>), whose
        chapters are linked from the Help page in notation 2. Your work is kept separately for each notation.
      </p>
      <div className="setting">
        <NotationSwitch />
        {prefs.notation != null && engine.defaultNotation != null && prefs.notation !== engine.defaultNotation && (
          <button type="button" className="link-btn" onClick={() => setPrefs({ notation: null })}>
            Use the course default (notation {engine.defaultNotation})
          </button>
        )}
      </div>
    </section>
  );
}

function AccountSettings() {
  const ws = useWorkspace();
  const { store } = useServices();
  return (
    <section id="settings-account" className="settings-section" aria-labelledby="set-account">
      <h2 id="set-account">Account</h2>
      {ws.account.kind === 'anonymous' ? (
        <>
          <p>
            You are not signed in. Your work is saved in this browser only. An account (username and password, no email) keeps it on the server so you can
            work from any computer; your work in this browser goes into the new account.
          </p>
          <div className="button-row">
            <button type="button" className="btn btn-primary" onClick={() => void openSignIn(store, 'sign-up')}>
              Create an account
            </button>
            <button type="button" className="btn" onClick={() => void openSignIn(store, 'sign-in')}>
              Sign in
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            Signed in as <strong>{ws.account.username}</strong>.{' '}
            {ws.sync.state === 'saved' && ws.sync.lastSyncedAt ? `All work saved to the server (${new Date(ws.sync.lastSyncedAt).toLocaleTimeString()}).` : ws.sync.message}
          </p>
          <div className="button-row">
            <button type="button" className="btn" onClick={() => void store.syncNow()}>
              Sync now
            </button>
            <button type="button" className="btn" onClick={() => void changePasswordFlow(store)}>
              Change password
            </button>
            <button type="button" className="btn" onClick={() => void signOutFlow(store)}>
              Sign out
            </button>
            <button type="button" className="btn btn-danger-quiet" onClick={() => void deleteAccountFlow(store)}>
              Delete account…
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function WorkSettings() {
  const ws = useWorkspace();
  const { store, own } = useServices();
  const notation = useNotation();
  const engine = useEngine();
  useEffect(() => {
    if (ws.ready && engine.status === 'ready') void store.ensureSummaries();
  }, [ws.ready, ws.revision, engine.status, engine.notation, store]);
  const storageNote =
    ws.storageKind === 'indexeddb' ? 'this browser’s storage' : ws.storageKind === 'localstorage' ? 'this browser’s local storage' : 'memory only (lost when the tab closes)';
  return (
    <section id="settings-work" className="settings-section" aria-labelledby="set-work">
      <h2 id="set-work">Your work in notation {notation}</h2>
      <p className="muted small">
        Saved in {storageNote}
        {ws.account.kind === 'user' ? ' and in your account' : ''}. The files are the desktop program’s work files: an exported file opens in the desktop
        program, and its files can be imported here (also the older derwork.txt-style files, or a zip of them).
      </p>
      <table className="files-table">
        <thead>
          <tr>
            <th scope="col">Work file</th>
            <th scope="col">Progress</th>
            <th scope="col">Changed</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {WORK_FILES.map((w) => {
            const rec = ws.files[workPath(notation, w.file)];
            const has = rec?.content != null;
            return (
              <tr key={w.file}>
                <th scope="row">
                  {w.title}
                  <div className="muted small mono-ish">{w.file}</div>
                </th>
                <td>{has ? (summaryText(rec.summary) ?? 'Saved') : <span className="muted">None</span>}</td>
                <td>
                  {has ? new Date(rec.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                  {rec?.dirty && <span className="tag tone-warn">not synced</span>}
                </td>
                <td className="row-actions">
                  {has && (
                    <button type="button" className="btn btn-small" onClick={() => exportModule(own, notation, w.module)}>
                      Export
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="button-row">
        <button type="button" className="btn" onClick={() => void importFlow(store, own, notation)}>
          Import work files…
        </button>
        <button type="button" className="btn" onClick={() => exportAll(own, notation)}>
          Export all (zip)
        </button>
        <button type="button" className="btn btn-danger-quiet" onClick={() => void resetFlow(store, own, notation)}>
          Start over…
        </button>
      </div>
    </section>
  );
}

function Backups() {
  const ws = useWorkspace();
  const { store } = useServices();
  const owner = ws.account.kind === 'user' ? ws.account.username : 'local';
  const list = ws.backups.filter((b) => b.owner === owner);
  return (
    <section id="settings-backups" className="settings-section" aria-labelledby="set-backups">
      <h2 id="set-backups">Earlier copies</h2>
      <p className="muted small">
        When work is replaced by something you did not type (an import, a fork, starting over, or the server’s copy after a conflict), the replaced
        version is kept here, in this browser. The last {40} are kept.
      </p>
      {list.length === 0 ? (
        <p className="muted">No earlier copies.</p>
      ) : (
        <ul className="backup-list">
          {list.map((b) => (
            <li key={b.id} className="backup-item">
              <div>
                <strong>{describePath(b.path)}</strong>
                <div className="muted small">
                  {b.reason}, {new Date(b.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </div>
              <div className="row-actions">
                <button type="button" className="btn btn-small" onClick={() => download(parseWorkPath(b.path)?.file ?? 'work.rec', b.content, 'text/plain;charset=utf-8')}>
                  Download
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={async () => {
                    const ok = await dialogs.confirm({
                      title: 'Restore this copy?',
                      body: `It replaces your current ${describePath(b.path)}; the current version becomes an earlier copy.`,
                      confirmLabel: 'Restore',
                    });
                    if (ok) store.restoreBackup(b.id);
                  }}
                >
                  Restore
                </button>
                <button type="button" className="btn btn-small btn-quiet" onClick={() => store.deleteBackup(b.id)} aria-label={`Forget this copy of ${describePath(b.path)}`}>
                  Forget
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
