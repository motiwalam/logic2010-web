// The student's workspace: their work files (path -> text) with local persistence and,
// when signed in, synchronization with the server. Independent of React; the UI reads it
// through subscribe/getSnapshot (useSyncExternalStore).
//
// Safety rules:
// - Every change is written to local storage first (write-behind of a few hundred ms,
//   flushed on page hide); the server copy follows (debounced) when signed in.
// - Nothing is dropped silently: content replaced by a choice the user did not type (taking
//   the server's copy, importing, forking, resetting, merging on sign-in) is kept in the
//   backups list first.
// - A failed or offline sync keeps the change marked dirty and retries with backoff.
// - A 409 conflict (another device changed the file) is held until the user chooses:
//   keep mine (overwrite the server) or take the server's (mine goes to backups).

import { ApiError, type User, type WorkFile, type WorkFileMeta, type WorkSummary, type FileUpload } from '../sync/api';
import type { KeyValueStore } from './storage';

export interface FileRecord {
  /** The file's text; null marks a deletion not yet sent to the server. */
  content: string | null;
  /** The server version this content is based on (0: not on the server). */
  version: number;
  /** Changed locally since `version`. */
  dirty: boolean;
  /** ISO time of the last change. */
  updatedAt: string;
  summary?: WorkSummary;
  /** The summary does not describe the current content. */
  summaryStale?: boolean;
}

export type Account = { kind: 'anonymous' } | { kind: 'user'; username: string };

export type SyncState =
  /** Not signed in: work is saved in this browser only. */
  | 'local'
  /** Everything is on the server. */
  | 'saved'
  /** Changes wait to be sent. */
  | 'pending'
  | 'syncing'
  /** The server cannot be reached; retrying. */
  | 'offline'
  /** Another device changed files that were also changed here; a choice is needed. */
  | 'conflict'
  /** The session ended (signed out elsewhere, password changed); sign in again to sync. */
  | 'session-expired'
  /** The server refused the change (e.g. quota); retrying slowly. */
  | 'error';

export interface SyncStatus {
  state: SyncState;
  message?: string;
  lastSyncedAt?: string;
  /** Number of files with changes not on the server. */
  pending: number;
}

export interface ConflictItem {
  path: string;
  /** This browser's content (null: deleted here). */
  mine: string | null;
  /** The server's file (null: deleted there). */
  theirs: WorkFile | null;
}

export interface BackupEntry {
  id: string;
  path: string;
  content: string;
  savedAt: string;
  /** Why it was kept, e.g. "Replaced by the server's copy". */
  reason: string;
  /** Whose workspace it came from ('local' or a username). */
  owner: string;
}

export interface WorkspaceSnapshot {
  ready: boolean;
  account: Account;
  files: Readonly<Record<string, FileRecord>>;
  sync: SyncStatus;
  conflicts: readonly ConflictItem[];
  backups: readonly BackupEntry[];
  storageKind: KeyValueStore['kind'];
  /** Increases with every change. */
  revision: number;
}

/** A file both in this browser (anonymous work) and in the account, with different content. */
export interface MergeItem {
  path: string;
  local: { content: string; updatedAt: string };
  server: { content: string; updatedAt: string; version: number };
}
export type MergeChoice = 'local' | 'server';
export type ChooseMerge = (items: MergeItem[]) => Promise<Record<string, MergeChoice> | null>;

export type WorkspaceApi = {
  register(username: string, password: string): Promise<User>;
  login(username: string, password: string): Promise<User>;
  logout(): Promise<void>;
  me(): Promise<User | null>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  deleteAccount(password: string): Promise<void>;
  getMyWork(): Promise<{ user: User; files: WorkFile[] }>;
  putFiles(files: FileUpload[], options?: { force?: boolean }): Promise<WorkFileMeta[]>;
  deleteFile(path: string, options: { baseVersion?: number; force?: boolean }): Promise<void>;
};

export type Summarizer = (path: string, content: string) => WorkSummary | undefined | Promise<WorkSummary | undefined>;

export interface WorkspaceStoreOptions {
  api: WorkspaceApi;
  storage: KeyValueStore;
  summarize?: Summarizer;
  /** Delay before local changes are sent to the server. */
  pushDelayMs?: number;
  /** Delay before changes are written to local storage. */
  persistDelayMs?: number;
  /** Retry delays after network failures. */
  retryDelaysMs?: number[];
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const MAX_BACKUPS = 40;
const ACCOUNT_KEY = 'account';
const BACKUPS_KEY = 'backups';

function wsId(account: Account): string {
  return account.kind === 'anonymous' ? 'local' : 'user:' + account.username.toLowerCase();
}

function filePrefix(id: string): string {
  return `file:${id}:`;
}

export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in was cancelled.');
  }
}

export class WorkspaceStore {
  private readonly api: WorkspaceApi;
  private readonly storage: KeyValueStore;
  private summarize: Summarizer | undefined;
  private readonly pushDelayMs: number;
  private readonly persistDelayMs: number;
  private readonly retryDelaysMs: number[];
  private readonly now: () => Date;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private snapshot: WorkspaceSnapshot;
  private readonly listeners = new Set<() => void>();

  /** Paths waiting to be written to storage, by workspace id. */
  private readonly unpersisted = new Map<string, Set<string>>();
  private persistTimer: unknown = null;
  private persistChain: Promise<void> = Promise.resolve();
  private pushTimer: unknown = null;
  private retryTimer: unknown = null;
  private retryCount = 0;
  private syncRunning: Promise<void> | null = null;
  private syncAgain = false;

  constructor(opts: WorkspaceStoreOptions) {
    this.api = opts.api;
    this.storage = opts.storage;
    this.summarize = opts.summarize;
    this.pushDelayMs = opts.pushDelayMs ?? 1500;
    this.persistDelayMs = opts.persistDelayMs ?? 250;
    this.retryDelaysMs = opts.retryDelaysMs ?? [2000, 5000, 15000, 30000, 60000];
    this.now = opts.now ?? (() => new Date());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.snapshot = {
      ready: false,
      account: { kind: 'anonymous' },
      files: {},
      sync: { state: 'local', pending: 0 },
      conflicts: [],
      backups: [],
      storageKind: opts.storage.kind,
      revision: 0,
    };
  }

  // ---- observable ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WorkspaceSnapshot => this.snapshot;

  private update(patch: Partial<WorkspaceSnapshot>): void {
    const next = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
    if (!patch.sync) next.sync = { ...next.sync, pending: countPending(next.files) };
    else next.sync = { ...patch.sync, pending: countPending(next.files) };
    this.snapshot = next;
    for (const l of [...this.listeners]) l();
  }

  private setSync(state: SyncState, message?: string, extra: Partial<SyncStatus> = {}): void {
    this.update({ sync: { ...this.snapshot.sync, ...extra, state, message } });
  }

  setSummarizer(summarize: Summarizer | undefined): void {
    this.summarize = summarize;
  }

  // ---- start-up ----

  /** Loads the saved workspace and finds out whether the session is still signed in. */
  async init(): Promise<void> {
    const saved = await this.storage.get<{ username: string } | null>(ACCOUNT_KEY);
    const backups = (await this.storage.get<BackupEntry[]>(BACKUPS_KEY)) ?? [];
    let account: Account = saved?.username ? { kind: 'user', username: saved.username } : { kind: 'anonymous' };
    let files = await this.loadFiles(wsId(account));
    this.update({ account, files, backups });
    let me: User | null = null;
    let reachable = true;
    try {
      me = await this.api.me();
    } catch {
      // network failure or server error: work from the saved copy and retry later
      reachable = false;
    }
    if (reachable && me && (account.kind === 'anonymous' || account.username.toLowerCase() !== me.username.toLowerCase())) {
      // Signed in from another tab (or a different account): show that account's work.
      account = { kind: 'user', username: me.username };
      files = await this.loadFiles(wsId(account));
      await this.storage.set(ACCOUNT_KEY, { username: me.username });
      this.update({ account, files });
    } else if (reachable && me && account.kind === 'user') {
      account = { kind: 'user', username: me.username };
      this.update({ account });
    }
    this.update({ ready: true });
    if (account.kind === 'anonymous') {
      this.setSync('local');
    } else if (!reachable) {
      this.setSync('offline', 'The server cannot be reached. Your work is saved in this browser.');
      this.scheduleRetry();
    } else if (!me) {
      this.setSync('session-expired', 'Your session has ended. Sign in again to sync your work.');
    } else {
      await this.syncNow();
    }
  }

  private async loadFiles(id: string): Promise<Record<string, FileRecord>> {
    const prefix = filePrefix(id);
    const out: Record<string, FileRecord> = {};
    for (const key of await this.storage.keys(prefix)) {
      const rec = await this.storage.get<FileRecord>(key);
      if (rec) out[key.slice(prefix.length)] = rec;
    }
    return out;
  }

  // ---- reading and writing ----

  get account(): Account {
    return this.snapshot.account;
  }

  get readOnly(): false {
    return false;
  }

  getText(path: string): string | null {
    return this.snapshot.files[path]?.content ?? null;
  }

  /** Paths of files with content (not deleted). */
  paths(): string[] {
    return Object.keys(this.snapshot.files).filter((p) => this.snapshot.files[p].content != null);
  }

  /** Saves a file's new content (the modules call this). */
  setText(path: string, content: string): void {
    this.setContent(path, content);
  }

  /** Deletes a file (e.g. deleting all work of a module). */
  deletePath(path: string, reason = 'Deleted'): void {
    const old = this.getText(path);
    if (old == null) return;
    this.backup(path, old, reason);
    this.setContent(path, null);
  }

  private setContent(path: string, content: string | null): void {
    const prev = this.snapshot.files[path];
    if (prev && prev.content === content) return;
    if (!prev && content == null) return;
    const files = { ...this.snapshot.files };
    if (content == null && (!prev || prev.version === 0)) {
      delete files[path]; // never reached the server: nothing to delete there
    } else {
      files[path] = {
        content,
        version: prev?.version ?? 0,
        dirty: this.snapshot.account.kind === 'user' ? true : false,
        updatedAt: this.now().toISOString(),
        summary: prev?.summary,
        summaryStale: true,
      };
    }
    this.update({ files });
    this.markUnpersisted(path);
    if (this.snapshot.account.kind === 'user') {
      if (this.snapshot.sync.state === 'saved') this.setSync('pending');
      this.schedulePush();
    }
  }

  /**
   * Replaces several files at once (import, fork, reset: content null deletes); the old
   * contents go to the backups with the reason.
   */
  replaceFiles(changes: Record<string, string | null>, reason: string): void {
    for (const [path, content] of Object.entries(changes)) {
      const old = this.getText(path);
      if (old != null && old !== content) this.backup(path, old, reason);
      this.setContent(path, content);
    }
  }

  // ---- summaries ----

  /** Computes the summaries that are missing or stale (for progress displays). */
  async ensureSummaries(paths?: string[]): Promise<void> {
    if (!this.summarize) return;
    for (const path of paths ?? Object.keys(this.snapshot.files)) {
      const rec = this.snapshot.files[path];
      if (!rec || rec.content == null || (rec.summary && !rec.summaryStale)) continue;
      const summary = await this.computeSummary(path, rec.content);
      const cur = this.snapshot.files[path];
      if (!cur || cur.content !== rec.content || !summary) continue;
      this.update({ files: { ...this.snapshot.files, [path]: { ...cur, summary, summaryStale: false } } });
      this.markUnpersisted(path);
    }
  }

  private async computeSummary(path: string, content: string): Promise<WorkSummary | undefined> {
    try {
      return this.summarize ? await this.summarize(path, content) : undefined;
    } catch {
      return undefined;
    }
  }

  // ---- backups ----

  private backup(path: string, content: string, reason: string): void {
    const owner = this.snapshot.account.kind === 'user' ? this.snapshot.account.username : 'local';
    const last = this.snapshot.backups.find((b) => b.path === path && b.owner === owner);
    if (last && last.content === content) return;
    const entry: BackupEntry = {
      id: this.now().getTime().toString(36) + Math.random().toString(36).slice(2, 8),
      path,
      content,
      savedAt: this.now().toISOString(),
      reason,
      owner,
    };
    const backups = [entry, ...this.snapshot.backups].slice(0, MAX_BACKUPS);
    this.update({ backups });
    this.enqueuePersist(() => this.storage.set(BACKUPS_KEY, this.snapshot.backups));
  }

  /** Puts a backup's content back (the current content is backed up in turn). */
  restoreBackup(id: string): void {
    const b = this.snapshot.backups.find((x) => x.id === id);
    if (!b) return;
    this.replaceFiles({ [b.path]: b.content }, 'Replaced by restoring an earlier copy');
  }

  deleteBackup(id: string): void {
    this.update({ backups: this.snapshot.backups.filter((b) => b.id !== id) });
    this.enqueuePersist(() => this.storage.set(BACKUPS_KEY, this.snapshot.backups));
  }

  // ---- local persistence ----

  private markUnpersisted(path: string): void {
    const id = wsId(this.snapshot.account);
    let set = this.unpersisted.get(id);
    if (!set) this.unpersisted.set(id, (set = new Set()));
    set.add(path);
    if (this.persistTimer == null) {
      this.persistTimer = this.setTimer(() => {
        this.persistTimer = null;
        void this.flush();
      }, this.persistDelayMs);
    }
  }

  private enqueuePersist(task: () => Promise<void>): Promise<void> {
    this.persistChain = this.persistChain.then(task).catch((err: unknown) => {
      console.error('Could not save to browser storage', err);
    });
    return this.persistChain;
  }

  /** Writes pending changes to local storage now (also called when the page is hidden). */
  flush(): Promise<void> {
    if (this.persistTimer != null) {
      this.clearTimer(this.persistTimer);
      this.persistTimer = null;
    }
    const currentId = wsId(this.snapshot.account);
    const batches = [...this.unpersisted.entries()];
    this.unpersisted.clear();
    for (const [id, paths] of batches) {
      if (id !== currentId) continue; // workspace switched; its records were written on switch
      const records = [...paths].map((p) => [p, this.snapshot.files[p]] as const);
      this.enqueuePersist(async () => {
        for (const [p, rec] of records) {
          if (rec) await this.storage.set(filePrefix(id) + p, rec);
          else await this.storage.delete(filePrefix(id) + p);
        }
      });
    }
    return this.persistChain;
  }

  private async writeWorkspace(id: string, files: Record<string, FileRecord>): Promise<void> {
    await this.enqueuePersist(async () => {
      const prefix = filePrefix(id);
      for (const key of await this.storage.keys(prefix)) {
        if (!(key.slice(prefix.length) in files)) await this.storage.delete(key);
      }
      for (const [p, rec] of Object.entries(files)) await this.storage.set(prefix + p, rec);
    });
  }

  // ---- sync ----

  private schedulePush(): void {
    if (this.pushTimer != null) this.clearTimer(this.pushTimer);
    this.pushTimer = this.setTimer(() => {
      this.pushTimer = null;
      void this.syncNow({ pull: false });
    }, this.pushDelayMs);
  }

  private scheduleRetry(): void {
    if (this.retryTimer != null) return;
    const delay = this.retryDelaysMs[Math.min(this.retryCount, this.retryDelaysMs.length - 1)];
    this.retryCount++;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, delay);
  }

  /**
   * Pulls the server's files and pushes local changes. Safe to call at any time (it runs
   * one sync at a time); does nothing when not signed in.
   */
  syncNow(opts: { pull?: boolean } = {}): Promise<void> {
    if (this.snapshot.account.kind !== 'user' || this.snapshot.sync.state === 'session-expired') return Promise.resolve();
    if (this.syncRunning) {
      this.syncAgain = true;
      return this.syncRunning;
    }
    const run = async () => {
      do {
        this.syncAgain = false;
        await this.syncOnce(opts.pull ?? true);
      } while (this.syncAgain);
    };
    this.syncRunning = run().finally(() => {
      this.syncRunning = null;
    });
    return this.syncRunning;
  }

  private async syncOnce(pull: boolean): Promise<void> {
    const account = this.snapshot.account;
    if (account.kind !== 'user') return;
    if (this.pushTimer != null) {
      this.clearTimer(this.pushTimer);
      this.pushTimer = null;
    }
    this.setSync('syncing');
    try {
      if (pull) await this.pull();
      await this.push();
      if (this.snapshot.account !== account) return;
      this.retryCount = 0;
      if (this.snapshot.conflicts.length > 0) {
        this.setSync('conflict', 'Some files were changed on another device.');
      } else {
        const pending = countPending(this.snapshot.files);
        this.setSync(pending > 0 ? 'pending' : 'saved', undefined, { lastSyncedAt: this.now().toISOString() });
        if (pending > 0) this.schedulePush();
      }
    } catch (err) {
      if (this.snapshot.account !== account) return;
      this.handleSyncError(err);
    }
  }

  private handleSyncError(err: unknown): void {
    if (err instanceof ApiError && err.status === 0) {
      this.setSync('offline', 'The server cannot be reached. Your work is saved in this browser and will be sent later.');
      this.scheduleRetry();
    } else if (err instanceof ApiError && err.code === 'not_signed_in') {
      this.setSync('session-expired', 'Your session has ended. Sign in again to sync your work.');
    } else {
      const message = err instanceof Error ? err.message : String(err);
      this.setSync('error', `Your work could not be saved on the server: ${message} It is saved in this browser.`);
      this.retryCount = Math.max(this.retryCount, this.retryDelaysMs.length - 1);
      this.scheduleRetry();
    }
  }

  /** Brings in the server's files (see the module comment for the rules). */
  private async pull(): Promise<void> {
    const account = this.snapshot.account;
    const work = await this.api.getMyWork();
    if (this.snapshot.account !== account) return;
    const server = new Map(work.files.map((f) => [f.path, f]));
    const files = { ...this.snapshot.files };
    const conflicts = [...this.snapshot.conflicts];
    const changed: string[] = [];
    for (const path of new Set([...server.keys(), ...Object.keys(files)])) {
      const s = server.get(path) ?? null;
      const l = files[path];
      if (conflicts.some((c) => c.path === path)) continue;
      if (!l) {
        if (s) files[path] = fromServer(s);
      } else if (!l.dirty) {
        if (!s) {
          if (l.version > 0) {
            if (l.content != null) this.backup(path, l.content, 'Deleted on another device');
            delete files[path];
          } else continue;
        } else if (s.version !== l.version) {
          files[path] = fromServer(s);
        } else continue;
      } else {
        const sv = s?.version ?? 0;
        if (sv === l.version) continue; // our change is based on the server's current version
        if ((s?.content ?? null) === l.content) {
          if (s) files[path] = fromServer(s);
          else delete files[path];
        } else {
          conflicts.push({ path, mine: l.content, theirs: s });
          continue;
        }
      }
      changed.push(path);
    }
    this.update({ files, conflicts });
    for (const p of changed) this.markUnpersisted(p);
  }

  private async push(): Promise<void> {
    const account = this.snapshot.account;
    for (let round = 0; round < 3; round++) {
      const conflicted = new Set(this.snapshot.conflicts.map((c) => c.path));
      const dirty = Object.entries(this.snapshot.files).filter(([p, r]) => r.dirty && !conflicted.has(p));
      if (dirty.length === 0) return;
      const uploads: FileUpload[] = [];
      const sent = new Map<string, string>();
      for (const [path, rec] of dirty) {
        if (rec.content == null) continue;
        const summary = rec.summary && !rec.summaryStale ? rec.summary : await this.computeSummary(path, rec.content);
        uploads.push({ path, content: rec.content, summary: summary ?? {}, baseVersion: rec.version });
        sent.set(path, rec.content);
      }
      let conflictsFound = false;
      if (uploads.length > 0) {
        try {
          const metas = await this.api.putFiles(uploads);
          if (this.snapshot.account !== account) return;
          const files = { ...this.snapshot.files };
          for (const meta of metas) {
            const cur = files[meta.path];
            if (!cur) continue;
            const same = cur.content === sent.get(meta.path);
            files[meta.path] = {
              ...cur,
              version: meta.version,
              dirty: same ? false : cur.dirty,
              summary: same ? meta.summary : cur.summary,
              summaryStale: same ? false : cur.summaryStale,
            };
            this.markUnpersisted(meta.path);
          }
          this.update({ files });
        } catch (err) {
          if (!(err instanceof ApiError) || !err.isConflict) throw err;
          this.recordConflicts(err.conflicts.map((c) => ({ path: c.path, current: c.current })));
          conflictsFound = true;
        }
      }
      for (const [path, rec] of dirty) {
        if (rec.content != null) continue;
        try {
          await this.api.deleteFile(path, { baseVersion: rec.version });
          const files = { ...this.snapshot.files };
          if (files[path]?.content == null) delete files[path];
          this.update({ files });
          this.markUnpersisted(path);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'invalid_path') continue;
          if (!(err instanceof ApiError) || !err.isConflict) throw err;
          this.recordConflicts(err.conflicts.map((c) => ({ path: c.path, current: c.current })));
          conflictsFound = true;
        }
      }
      if (!conflictsFound) return;
    }
  }

  private recordConflicts(items: { path: string; current: WorkFile | null }[]): void {
    const files = { ...this.snapshot.files };
    const conflicts = [...this.snapshot.conflicts];
    for (const { path, current } of items) {
      const l = files[path];
      if (!l) continue;
      if ((current?.content ?? null) === l.content) {
        // the same change reached the server from elsewhere
        if (current) files[path] = fromServer(current);
        else delete files[path];
        this.markUnpersisted(path);
      } else if (!conflicts.some((c) => c.path === path)) {
        conflicts.push({ path, mine: l.content, theirs: current });
      }
    }
    this.update({ files, conflicts });
  }

  /**
   * Settles a conflict: 'mine' sends this browser's version over the server's; 'theirs'
   * takes the server's (this browser's goes to the backups).
   */
  async resolveConflict(path: string, choice: 'mine' | 'theirs'): Promise<void> {
    const c = this.snapshot.conflicts.find((x) => x.path === path);
    if (!c) return;
    const files = { ...this.snapshot.files };
    const cur = files[path];
    if (choice === 'mine') {
      if (cur) files[path] = { ...cur, version: c.theirs?.version ?? 0, dirty: true };
    } else {
      if (cur?.content != null) this.backup(path, cur.content, "Replaced by the server's copy (conflict)");
      if (c.theirs) files[path] = fromServer(c.theirs);
      else delete files[path];
    }
    this.update({ files, conflicts: this.snapshot.conflicts.filter((x) => x.path !== path) });
    this.markUnpersisted(path);
    await this.syncNow({ pull: false });
  }

  async resolveAllConflicts(choice: 'mine' | 'theirs'): Promise<void> {
    for (const c of [...this.snapshot.conflicts]) await this.resolveConflict(c.path, choice);
  }

  // ---- accounts ----

  /** Paths with changes that have not reached the server. */
  unsyncedPaths(): string[] {
    return Object.entries(this.snapshot.files)
      .filter(([, r]) => r.dirty)
      .map(([p]) => p);
  }

  private async switchTo(account: Account, files: Record<string, FileRecord>): Promise<void> {
    await this.flush();
    this.clearSyncTimers();
    await this.writeWorkspace(wsId(account), files);
    await this.storage.set(ACCOUNT_KEY, account.kind === 'user' ? { username: account.username } : null);
    this.update({
      account,
      files,
      conflicts: [],
      sync: { state: account.kind === 'user' ? 'pending' : 'local', pending: 0 },
    });
  }

  private clearSyncTimers(): void {
    for (const t of [this.pushTimer, this.retryTimer]) if (t != null) this.clearTimer(t);
    this.pushTimer = this.retryTimer = null;
    this.retryCount = 0;
  }

  /** Creates an account; the work in this browser becomes the account's first upload. */
  async signUp(username: string, password: string): Promise<User> {
    const user = await this.api.register(username, password);
    const files: Record<string, FileRecord> = {};
    for (const [path, rec] of Object.entries(this.localFiles())) {
      if (rec.content != null) files[path] = { ...rec, version: 0, dirty: true };
    }
    await this.switchTo({ kind: 'user', username: user.username }, files);
    await this.writeWorkspace('local', {});
    await this.syncNow({ pull: false });
    return user;
  }

  private localFiles(): Record<string, FileRecord> {
    return this.snapshot.account.kind === 'anonymous' ? this.snapshot.files : {};
  }

  /**
   * Signs in. The account's work is loaded; work done in this browser without an account is
   * carried into the account: files the account lacks are uploaded, and for files that
   * differ, `chooseMerge` asks which to keep (the other goes to the backups). If it returns
   * null, the sign-in is undone (SignInCancelled).
   */
  async signIn(username: string, password: string, chooseMerge: ChooseMerge): Promise<User> {
    const user = await this.api.login(username, password);
    const anonymous = this.snapshot.account.kind === 'anonymous' ? { ...this.snapshot.files } : await this.loadFiles('local');
    const account: Account = { kind: 'user', username: user.username };
    const cached = await this.loadFiles(wsId(account));
    let work: { files: WorkFile[] };
    try {
      work = await this.api.getMyWork();
    } catch (err) {
      await this.api.logout().catch(() => undefined);
      throw err;
    }
    // Start from the cached copy (it may hold changes not yet sent), then apply the server's.
    const files: Record<string, FileRecord> = { ...cached };
    const conflicts: ConflictItem[] = [];
    const server = new Map(work.files.map((f) => [f.path, f]));
    for (const path of new Set([...server.keys(), ...Object.keys(files)])) {
      const s = server.get(path) ?? null;
      const l = files[path];
      if (!l) {
        if (s) files[path] = fromServer(s);
      } else if (!l.dirty) {
        if (s) files[path] = fromServer(s);
        else if (l.version > 0) delete files[path];
      } else if ((s?.version ?? 0) !== l.version) {
        if ((s?.content ?? null) === l.content) {
          if (s) files[path] = fromServer(s);
          else delete files[path];
        } else conflicts.push({ path, mine: l.content, theirs: s });
      }
    }
    const items: MergeItem[] = [];
    const backups: [string, string, string][] = [];
    for (const [path, rec] of Object.entries(anonymous)) {
      if (rec.content == null) continue;
      const cur = files[path];
      if (!cur || cur.content == null) {
        files[path] = { ...rec, version: cur?.version ?? 0, dirty: true, summaryStale: true };
      } else if (cur.content !== rec.content) {
        items.push({
          path,
          local: { content: rec.content, updatedAt: rec.updatedAt },
          server: { content: cur.content, updatedAt: cur.updatedAt, version: cur.version },
        });
      }
    }
    if (items.length > 0) {
      const choices = await chooseMerge(items);
      if (!choices) {
        await this.api.logout().catch(() => undefined);
        throw new SignInCancelled();
      }
      for (const item of items) {
        if (choices[item.path] === 'local') {
          backups.push([item.path, item.server.content, 'Replaced by the work in this browser when signing in']);
          const cur = files[item.path];
          files[item.path] = { ...cur, content: item.local.content, dirty: true, updatedAt: item.local.updatedAt, summaryStale: true };
        } else {
          backups.push([item.path, item.local.content, "Replaced by the account's copy when signing in"]);
        }
      }
    }
    await this.switchTo(account, files);
    for (const [path, content, reason] of backups) this.backup(path, content, reason);
    this.update({ conflicts });
    await this.writeWorkspace('local', {});
    await this.syncNow({ pull: false });
    return user;
  }

  /**
   * Signs out. Changes that could not be sent are moved into this browser's local work
   * (so nothing is lost); returns their paths. The account's copy in this browser is removed.
   */
  async signOut(): Promise<{ keptLocally: string[]; serverSignedOut: boolean }> {
    const account = this.snapshot.account;
    if (account.kind !== 'user') return { keptLocally: [], serverSignedOut: true };
    if (this.snapshot.sync.state !== 'session-expired') await this.syncNow({ pull: false }).catch(() => undefined);
    const keep: Record<string, FileRecord> = {};
    for (const [path, rec] of Object.entries(this.snapshot.files)) {
      if (rec.dirty && rec.content != null) keep[path] = { ...rec, version: 0, dirty: false };
    }
    for (const c of this.snapshot.conflicts) {
      if (c.mine != null) keep[c.path] = { content: c.mine, version: 0, dirty: false, updatedAt: this.now().toISOString(), summaryStale: true };
    }
    let serverSignedOut = true;
    try {
      await this.api.logout();
    } catch {
      serverSignedOut = false;
    }
    const oldId = wsId(account);
    await this.switchTo({ kind: 'anonymous' }, { ...(await this.loadFiles('local')), ...keep });
    await this.writeWorkspace(oldId, {});
    return { keptLocally: Object.keys(keep), serverSignedOut };
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.api.changePassword(currentPassword, newPassword);
  }

  /**
   * Deletes the account and its work on the server. With keepCopy, the work is kept in
   * this browser as local work.
   */
  async deleteAccount(password: string, keepCopy: boolean): Promise<void> {
    const account = this.snapshot.account;
    if (account.kind !== 'user') return;
    await this.api.deleteAccount(password);
    const keep: Record<string, FileRecord> = {};
    if (keepCopy) {
      for (const [path, rec] of Object.entries(this.snapshot.files)) {
        if (rec.content != null) keep[path] = { ...rec, version: 0, dirty: false };
      }
    }
    const oldId = wsId(account);
    await this.switchTo({ kind: 'anonymous' }, { ...(await this.loadFiles('local')), ...keep });
    await this.writeWorkspace(oldId, {});
  }

  /** Stops timers (tests, hot reload). */
  dispose(): void {
    this.clearSyncTimers();
    if (this.persistTimer != null) this.clearTimer(this.persistTimer);
    this.persistTimer = null;
  }
}

function fromServer(f: WorkFile): FileRecord {
  return { content: f.content, version: f.version, dirty: false, updatedAt: f.updatedAt, summary: f.summary };
}

function countPending(files: Readonly<Record<string, FileRecord>>): number {
  let n = 0;
  for (const r of Object.values(files)) if (r.dirty) n++;
  return n;
}
