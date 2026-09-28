// Account dialogs: sign in / create account (with the choice of what to keep when this
// browser and the account both have work), sync conflicts, password change, sign out and
// account deletion.

import { useState, type FormEvent } from 'react';
import { ApiError } from '../../sync/api';
import { parseWorkPath, workFileInfo } from '../../workspace/paths';
import { SignInCancelled, type MergeChoice, type MergeItem, type WorkspaceStore } from '../../workspace/WorkspaceStore';
import { DialogButtons, dialogs } from '../dialogs/dialogs';

/** A user-facing sentence for an API failure. */
export function apiErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : String(err);
  switch (err.code) {
    case 'network':
      return 'The server cannot be reached. Check your connection and try again.';
    case 'invalid_username':
      return 'Usernames are 3 to 32 letters, digits, dots, dashes or underscores.';
    case 'invalid_password':
      return 'Passwords are 8 to 200 characters long.';
    case 'username_taken':
      return 'That username is taken. Choose another one.';
    case 'wrong_credentials':
      return 'The username or password is not right.';
    case 'wrong_password':
      return 'The password is not right.';
    case 'rate_limited':
      return `Too many attempts. Try again in ${Math.ceil((err.retryAfter ?? 60) / 60)} minute(s).`;
    case 'no_such_user':
      return 'There is no user with that name.';
    case 'not_signed_in':
      return 'You are not signed in any more. Sign in again.';
    case 'quota_exceeded':
    case 'too_large':
    case 'file_too_large':
      return 'Your work is larger than the server accepts for an account.';
    default:
      return err.message;
  }
}

/** "Derivations (notation 1)" for a work path. */
export function describePath(path: string): string {
  const p = parseWorkPath(path);
  if (!p) return path;
  const info = workFileInfo(p.file);
  return `${info ? info.title : p.file} (notation ${p.notation})`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Asks, for each file both here and in the account, which copy to keep. */
export function chooseMerge(items: MergeItem[]): Promise<Record<string, MergeChoice> | null> {
  return dialogs.open<Record<string, MergeChoice> | null>((done) => <MergeBody items={items} done={done} />, {
    title: 'Which work do you want to keep?',
    dismissValue: null,
    size: 'medium',
  });
}

function MergeBody({ items, done }: { items: MergeItem[]; done: (v: Record<string, MergeChoice> | null) => void }) {
  const [choices, setChoices] = useState<Record<string, MergeChoice>>(() => Object.fromEntries(items.map((i) => [i.path, 'server' as MergeChoice])));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        done(choices);
      }}
    >
      <p className="dialog-text">
        This browser has work that you did without signing in, and your account has different work in the same {items.length === 1 ? 'file' : 'files'}.
        Choose which to keep. The other copy is not lost: it is kept under Settings › Earlier copies, where you can restore or download it.
      </p>
      {items.map((item) => (
        <fieldset key={item.path} className="merge-item">
          <legend>{describePath(item.path)}</legend>
          <label className="choice">
            <input type="radio" name={item.path} checked={choices[item.path] === 'server'} onChange={() => setChoices({ ...choices, [item.path]: 'server' })} />
            <span className="choice-label">
              Your account's work
              <span className="choice-description">saved {when(item.server.updatedAt)}</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name={item.path} checked={choices[item.path] === 'local'} onChange={() => setChoices({ ...choices, [item.path]: 'local' })} />
            <span className="choice-label">
              The work in this browser
              <span className="choice-description">changed {when(item.local.updatedAt)}</span>
            </span>
          </label>
        </fieldset>
      ))}
      <DialogButtons>
        <button type="button" className="btn" onClick={() => done(null)}>
          Cancel sign-in
        </button>
        <button type="submit" className="btn btn-primary">
          Keep the chosen work
        </button>
      </DialogButtons>
    </form>
  );
}

/** The sign-in / create-account dialog. Resolves true when signed in. */
export function openSignIn(store: WorkspaceStore, mode: 'sign-in' | 'sign-up' = 'sign-in'): Promise<boolean> {
  return dialogs.open<boolean>((done) => <SignInBody store={store} initialMode={mode} done={done} />, {
    title: mode === 'sign-in' ? 'Sign in' : 'Create an account',
    dismissValue: false,
    size: 'small',
  });
}

function SignInBody({ store, initialMode, done }: { store: WorkspaceStore; initialMode: 'sign-in' | 'sign-up'; done: (v: boolean) => void }) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasLocalWork = store.getSnapshot().account.kind === 'anonymous' && store.paths().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'sign-up' && password !== password2) {
      setError('The two passwords are different.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'sign-up') {
        const user = await store.signUp(username.trim(), password);
        dialogs.notify(`Account ${user.username} created.${hasLocalWork ? ' The work in this browser is now saved to it.' : ''}`, { tone: 'success' });
      } else {
        const user = await store.signIn(username.trim(), password, chooseMerge);
        dialogs.notify(`Signed in as ${user.username}.`, { tone: 'success' });
      }
      done(true);
    } catch (err) {
      if (err instanceof SignInCancelled) setError('Sign-in cancelled. Nothing was changed.');
      else setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="account-form">
      <div className="segmented" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={mode === 'sign-in'} className={mode === 'sign-in' ? 'is-on' : ''} onClick={() => setMode('sign-in')}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === 'sign-up'} className={mode === 'sign-up' ? 'is-on' : ''} onClick={() => setMode('sign-up')}>
          Create account
        </button>
      </div>
      <p className="dialog-text small">
        {mode === 'sign-up'
          ? 'An account saves your work on this site so you can continue on another computer. No email is needed. Your saved work is public: anyone can view it on the People page.'
          : 'Signing in brings your saved work to this browser.'}
        {hasLocalWork && (mode === 'sign-up' ? ' The work in this browser becomes your account’s work.' : ' Work you did here without an account is added to the account.')}
      </p>
      <div className="field">
        <label htmlFor="acct-user">Username</label>
        <input id="acct-user" className="input" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.\-]+" />
      </div>
      <div className="field">
        <label htmlFor="acct-pass">Password</label>
        <input
          id="acct-pass"
          className="input"
          type="password"
          autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === 'sign-up' ? 8 : 1}
        />
        {mode === 'sign-up' && <p className="field-hint">At least 8 characters. There is no email, so the password cannot be reset: keep it somewhere safe.</p>}
      </div>
      {mode === 'sign-up' && (
        <div className="field">
          <label htmlFor="acct-pass2">Password again</label>
          <input id="acct-pass2" className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <DialogButtons>
        <button type="button" className="btn" onClick={() => done(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
        </button>
      </DialogButtons>
    </form>
  );
}

/** Lets the user settle each sync conflict. */
export function openConflicts(store: WorkspaceStore): Promise<void> {
  return dialogs.open<void>((done) => <ConflictBody store={store} done={done} />, {
    title: 'Your work changed on another device',
    dismissValue: undefined,
    size: 'medium',
  });
}

function ConflictBody({ store, done }: { store: WorkspaceStore; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState(store.getSnapshot().conflicts);
  const act = async (path: string | null, choice: 'mine' | 'theirs') => {
    setBusy(true);
    if (path) await store.resolveConflict(path, choice);
    else await store.resolveAllConflicts(choice);
    setBusy(false);
    const left = store.getSnapshot().conflicts;
    setConflicts(left);
    if (left.length === 0) done();
  };
  return (
    <div>
      <p className="dialog-text">
        These files were saved from another browser or computer after this browser last synced, and they were also changed here. Keep this browser’s
        version (it replaces the server’s), or take the server’s (this browser’s version is kept under Settings › Earlier copies).
      </p>
      <ul className="conflict-list">
        {conflicts.map((c) => (
          <li key={c.path} className="conflict-item">
            <div>
              <strong>{describePath(c.path)}</strong>
              <div className="muted small">
                {c.theirs ? `Server copy saved ${when(c.theirs.updatedAt)}` : 'Deleted on the other device'}
                {c.mine == null ? '; deleted here' : ''}
              </div>
            </div>
            <div className="conflict-actions">
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => act(c.path, 'mine')}>
                Keep mine
              </button>
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => act(c.path, 'theirs')}>
                Take server’s
              </button>
            </div>
          </li>
        ))}
      </ul>
      {conflicts.length > 1 && (
        <DialogButtons>
          <button type="button" className="btn" disabled={busy} onClick={() => act(null, 'theirs')}>
            Take all from server
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(null, 'mine')}>
            Keep all mine
          </button>
        </DialogButtons>
      )}
    </div>
  );
}

export async function signOutFlow(store: WorkspaceStore): Promise<void> {
  const unsynced = store.unsyncedPaths();
  if (unsynced.length > 0) {
    const ok = await dialogs.confirm({
      title: 'Sign out?',
      body: (
        <>
          <p>Some changes have not reached the server yet:</p>
          <ul>
            {unsynced.map((p) => (
              <li key={p}>{describePath(p)}</li>
            ))}
          </ul>
          <p>If they still cannot be sent, they are kept in this browser as work without an account.</p>
        </>
      ),
      confirmLabel: 'Sign out',
    });
    if (!ok) return;
  }
  const result = await store.signOut();
  dialogs.notify(
    result.keptLocally.length > 0
      ? `Signed out. ${result.keptLocally.length} unsent file(s) were kept in this browser.`
      : result.serverSignedOut
        ? 'Signed out.'
        : 'Signed out here. The server could not be reached; the session ends when it expires.',
    { tone: 'info' },
  );
}

export function changePasswordFlow(store: WorkspaceStore): Promise<void> {
  return dialogs.open<void>((done) => <PasswordBody store={store} done={done} />, { title: 'Change password', dismissValue: undefined, size: 'small' });
}

function PasswordBody({ store, done }: { store: WorkspaceStore; done: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (next !== again) return setError('The two new passwords are different.');
        setBusy(true);
        try {
          await store.changePassword(current, next);
          dialogs.notify('Password changed. Other devices are signed out.', { tone: 'success' });
          done();
        } catch (err) {
          setError(apiErrorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="pw-cur">Current password</label>
        <input id="pw-cur" className="input" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="pw-new">New password</label>
        <input id="pw-new" className="input" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="pw-again">New password again</label>
        <input id="pw-again" className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <DialogButtons>
        <button type="button" className="btn" onClick={done}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Change password
        </button>
      </DialogButtons>
    </form>
  );
}

export function deleteAccountFlow(store: WorkspaceStore): Promise<void> {
  return dialogs.open<void>((done) => <DeleteBody store={store} done={done} />, { title: 'Delete your account', dismissValue: undefined, tone: 'danger', size: 'small' });
}

function DeleteBody({ store, done }: { store: WorkspaceStore; done: () => void }) {
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await store.deleteAccount(password, keep);
          dialogs.notify(keep ? 'Account deleted. Your work stays in this browser.' : 'Account and work deleted.', { tone: 'info' });
          done();
        } catch (err) {
          setError(apiErrorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="dialog-text">This deletes the account and all its work on the server. It cannot be undone.</p>
      <label className="check">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        Keep a copy of the work in this browser
      </label>
      <div className="field">
        <label htmlFor="del-pw">Password</label>
        <input id="del-pw" className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <DialogButtons>
        <button type="button" className="btn" onClick={done}>
          Cancel
        </button>
        <button type="submit" className="btn btn-danger" disabled={busy}>
          Delete account
        </button>
      </DialogButtons>
    </form>
  );
}
