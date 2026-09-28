import { describe, expect, it } from 'vitest';
import { ApiError, type FileUpload, type User, type WorkFile, type WorkFileMeta } from '../sync/api';
import { MemoryStore } from './storage';
import { SignInCancelled, WorkspaceStore, type MergeItem, type WorkspaceApi } from './WorkspaceStore';

/** An in-memory stand-in for the server's API (same versioning and conflict rules). */
class FakeServer implements WorkspaceApi {
  users = new Map<string, { user: User; password: string; files: Map<string, WorkFile> }>();
  session: string | null = null;
  counter = 0;
  offline = false;
  calls: string[] = [];

  private check(): void {
    if (this.offline) throw new ApiError(0, 'network', 'Could not reach the server');
  }

  private me_(): { user: User; password: string; files: Map<string, WorkFile> } {
    const u = this.session ? this.users.get(this.session) : undefined;
    if (!u) throw new ApiError(401, 'not_signed_in', 'Not signed in');
    return u;
  }

  async register(username: string, password: string): Promise<User> {
    this.check();
    const user = { username, createdAt: 't', updatedAt: 't' };
    this.users.set(username.toLowerCase(), { user, password, files: new Map() });
    this.session = username.toLowerCase();
    return user;
  }

  async login(username: string, password: string): Promise<User> {
    this.check();
    const u = this.users.get(username.toLowerCase());
    if (!u || u.password !== password) throw new ApiError(401, 'wrong_credentials', 'Wrong');
    this.session = username.toLowerCase();
    return u.user;
  }

  async logout(): Promise<void> {
    this.check();
    this.session = null;
  }

  async me(): Promise<User | null> {
    this.check();
    return this.session ? this.users.get(this.session)!.user : null;
  }

  async changePassword(): Promise<void> {}

  async deleteAccount(password: string): Promise<void> {
    this.check();
    const u = this.me_();
    if (u.password !== password) throw new ApiError(403, 'wrong_password', 'Wrong');
    this.users.delete(this.session!);
    this.session = null;
  }

  async getMyWork(): Promise<{ user: User; files: WorkFile[] }> {
    this.check();
    this.calls.push('get');
    const u = this.me_();
    return { user: u.user, files: [...u.files.values()].map((f) => ({ ...f })) };
  }

  async putFiles(files: FileUpload[], options: { force?: boolean } = {}): Promise<WorkFileMeta[]> {
    this.check();
    this.calls.push('put:' + files.map((f) => f.path).join(','));
    const u = this.me_();
    const conflicts = files
      .filter((f) => !options.force && (u.files.get(f.path)?.version ?? 0) !== f.baseVersion)
      .map((f) => ({ path: f.path, current: u.files.get(f.path) ?? null }));
    if (conflicts.length) throw new ApiError(409, 'conflict', 'Conflict', { conflicts });
    return files.map((f) => {
      const file = { path: f.path, content: f.content, version: ++this.counter, updatedAt: 'now', summary: f.summary ?? {} };
      u.files.set(f.path, file);
      const { content: _content, ...meta } = file;
      return meta;
    });
  }

  async deleteFile(path: string, options: { baseVersion?: number }): Promise<void> {
    this.check();
    const u = this.me_();
    const cur = u.files.get(path) ?? null;
    if ((cur?.version ?? 0) !== options.baseVersion) throw new ApiError(409, 'conflict', 'Conflict', { path, current: cur });
    u.files.delete(path);
    this.counter++;
  }

  /** Another device writes a file. */
  otherDeviceWrites(username: string, path: string, content: string): void {
    const u = this.users.get(username.toLowerCase())!;
    u.files.set(path, { path, content, version: ++this.counter, updatedAt: 'later', summary: {} });
  }
}

/** Timers run only when the test says so. */
class ManualTimers {
  private next = 1;
  pending = new Map<number, () => void>();
  set = (fn: () => void): unknown => {
    const id = this.next++;
    this.pending.set(id, fn);
    return id;
  };
  clear = (h: unknown): void => {
    this.pending.delete(h as number);
  };
  async runAll(): Promise<void> {
    for (let round = 0; round < 10 && this.pending.size; round++) {
      const fns = [...this.pending.values()];
      this.pending.clear();
      for (const f of fns) f();
      await settle();
    }
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function makeStore(server: FakeServer, storage = new MemoryStore(), timers = new ManualTimers()) {
  const store = new WorkspaceStore({
    api: server,
    storage,
    setTimer: timers.set,
    clearTimer: timers.clear,
    summarize: (_path, content) => ({ total: content.length }),
  });
  return { store, storage, timers };
}

const P = 'syntax1/derivation.rec';
const Q = 'syntax1/truth-tables.rec';

describe('WorkspaceStore (anonymous)', () => {
  it('saves locally and loads again', async () => {
    const server = new FakeServer();
    const { store, storage, timers } = makeStore(server);
    await store.init();
    expect(store.getSnapshot().sync.state).toBe('local');
    store.setText(P, 'work 1');
    expect(store.getText(P)).toBe('work 1');
    await timers.runAll();
    await store.flush();
    const again = makeStore(server, storage).store;
    await again.init();
    expect(again.getText(P)).toBe('work 1');
    expect(again.getSnapshot().files[P].dirty).toBe(false);
  });

  it('flush writes without waiting for the timer', async () => {
    const { store, storage } = makeStore(new FakeServer());
    await store.init();
    store.setText(P, 'x');
    await store.flush();
    expect(await storage.keys('file:local:')).toEqual(['file:local:' + P]);
  });

  it('keeps replaced content in the backups and restores it', async () => {
    const { store } = makeStore(new FakeServer());
    await store.init();
    store.setText(P, 'mine');
    store.replaceFiles({ [P]: 'imported' }, 'Replaced by an import');
    expect(store.getText(P)).toBe('imported');
    const [b] = store.getSnapshot().backups;
    expect(b).toMatchObject({ path: P, content: 'mine', reason: 'Replaced by an import' });
    store.restoreBackup(b.id);
    expect(store.getText(P)).toBe('mine');
    expect(store.getSnapshot().backups[0].content).toBe('imported');
  });

  it('reset deletes files (and backs them up)', async () => {
    const { store } = makeStore(new FakeServer());
    await store.init();
    store.setText(P, 'a');
    store.replaceFiles({ [P]: null }, 'Started over');
    expect(store.getText(P)).toBeNull();
    expect(store.paths()).toEqual([]);
    expect(store.getSnapshot().backups[0].content).toBe('a');
  });
});

describe('WorkspaceStore (accounts and sync)', () => {
  it('sign-up uploads the local work', async () => {
    const server = new FakeServer();
    const { store, storage } = makeStore(server);
    await store.init();
    store.setText(P, 'local work');
    await store.signUp('alice', 'password1');
    await settle();
    expect(server.users.get('alice')!.files.get(P)?.content).toBe('local work');
    expect(server.users.get('alice')!.files.get(P)?.summary).toEqual({ total: 10 });
    expect(store.getSnapshot().sync.state).toBe('saved');
    expect(store.getSnapshot().account).toEqual({ kind: 'user', username: 'alice' });
    await store.flush();
    expect(await storage.keys('file:local:')).toEqual([]);
  });

  it('autosaves changes after the delay', async () => {
    const server = new FakeServer();
    const { store, timers } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    store.setText(P, 'v1');
    expect(store.getSnapshot().sync.state).toBe('pending');
    expect(server.users.get('alice')!.files.get(P)).toBeUndefined();
    await timers.runAll();
    expect(server.users.get('alice')!.files.get(P)?.content).toBe('v1');
    expect(store.getSnapshot().files[P]).toMatchObject({ dirty: false, version: server.counter });
  });

  it('keeps work while offline and sends it when the server is back', async () => {
    const server = new FakeServer();
    const { store, timers } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    server.offline = true;
    store.setText(P, 'offline work');
    await timers.runAll();
    expect(store.getSnapshot().sync.state).toBe('offline');
    expect(store.getText(P)).toBe('offline work');
    server.offline = false;
    await store.syncNow();
    expect(server.users.get('alice')!.files.get(P)?.content).toBe('offline work');
    expect(store.getSnapshot().sync.state).toBe('saved');
  });

  it('starts offline from the cached account', async () => {
    const server = new FakeServer();
    const { store, storage } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    store.setText(P, 'cached');
    await store.flush();
    server.offline = true;
    const { store: again } = makeStore(server, storage);
    await again.init();
    expect(again.getSnapshot().account).toEqual({ kind: 'user', username: 'alice' });
    expect(again.getSnapshot().sync.state).toBe('offline');
    expect(again.getText(P)).toBe('cached');
  });

  it('pulls changes made on another device', async () => {
    const server = new FakeServer();
    const { store } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    server.otherDeviceWrites('alice', Q, 'from laptop');
    await store.syncNow();
    expect(store.getText(Q)).toBe('from laptop');
  });

  it('reports a conflict and keeps mine on request', async () => {
    const server = new FakeServer();
    const { store, timers } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    store.setText(P, 'base');
    await timers.runAll();
    server.otherDeviceWrites('alice', P, 'theirs');
    store.setText(P, 'mine');
    await store.syncNow({ pull: false });
    const snap = store.getSnapshot();
    expect(snap.sync.state).toBe('conflict');
    expect(snap.conflicts).toHaveLength(1);
    expect(snap.conflicts[0]).toMatchObject({ path: P, mine: 'mine', theirs: { content: 'theirs' } });
    await store.resolveConflict(P, 'mine');
    expect(server.users.get('alice')!.files.get(P)?.content).toBe('mine');
    expect(store.getSnapshot().sync.state).toBe('saved');
  });

  it("takes the server's version on request, backing mine up", async () => {
    const server = new FakeServer();
    const { store, timers } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    store.setText(P, 'base');
    await timers.runAll();
    server.otherDeviceWrites('alice', P, 'theirs');
    store.setText(P, 'mine');
    await store.syncNow(); // the pull finds the conflict
    expect(store.getSnapshot().conflicts).toHaveLength(1);
    await store.resolveConflict(P, 'theirs');
    expect(store.getText(P)).toBe('theirs');
    expect(store.getSnapshot().backups[0].content).toBe('mine');
    expect(server.users.get('alice')!.files.get(P)?.content).toBe('theirs');
  });

  it('sends deletions', async () => {
    const server = new FakeServer();
    const { store, timers } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    store.setText(P, 'x');
    await timers.runAll();
    store.replaceFiles({ [P]: null }, 'Started over');
    await timers.runAll();
    expect(server.users.get('alice')!.files.has(P)).toBe(false);
    expect(store.getSnapshot().files[P]).toBeUndefined();
  });

  it('sign-in merges local work: uploads new files, asks about differing ones', async () => {
    const server = new FakeServer();
    await server.register('bob', 'password1');
    server.otherDeviceWrites('bob', P, 'server P');
    server.session = null;
    const { store } = makeStore(server);
    await store.init();
    store.setText(P, 'local P');
    store.setText(Q, 'local Q');
    let asked: MergeItem[] = [];
    await store.signIn('bob', 'password1', async (items) => {
      asked = items;
      return { [P]: 'local' };
    });
    await settle();
    expect(asked.map((i) => i.path)).toEqual([P]);
    expect(store.getText(P)).toBe('local P');
    expect(store.getText(Q)).toBe('local Q');
    expect(server.users.get('bob')!.files.get(P)?.content).toBe('local P');
    expect(server.users.get('bob')!.files.get(Q)?.content).toBe('local Q');
    expect(store.getSnapshot().backups.some((b) => b.content === 'server P')).toBe(true);
  });

  it("sign-in can keep the account's version (local copy goes to backups)", async () => {
    const server = new FakeServer();
    await server.register('bob', 'password1');
    server.otherDeviceWrites('bob', P, 'server P');
    server.session = null;
    const { store } = makeStore(server);
    await store.init();
    store.setText(P, 'local P');
    await store.signIn('bob', 'password1', async () => ({ [P]: 'server' }));
    expect(store.getText(P)).toBe('server P');
    expect(store.getSnapshot().backups[0]).toMatchObject({ content: 'local P' });
  });

  it('a cancelled sign-in keeps everything as it was', async () => {
    const server = new FakeServer();
    await server.register('bob', 'password1');
    server.otherDeviceWrites('bob', P, 'server P');
    server.session = null;
    const { store } = makeStore(server);
    await store.init();
    store.setText(P, 'local P');
    await expect(store.signIn('bob', 'password1', async () => null)).rejects.toBeInstanceOf(SignInCancelled);
    expect(store.getSnapshot().account.kind).toBe('anonymous');
    expect(store.getText(P)).toBe('local P');
    expect(server.session).toBeNull();
  });

  it('sign-out keeps unsent changes as local work', async () => {
    const server = new FakeServer();
    const { store } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    store.setText(P, 'sent');
    await store.syncNow();
    server.offline = true;
    store.setText(Q, 'unsent');
    const result = await store.signOut();
    expect(result.keptLocally).toEqual([Q]);
    expect(store.getSnapshot().account.kind).toBe('anonymous');
    expect(store.getText(Q)).toBe('unsent');
    expect(store.getText(P)).toBeNull();
  });

  it('a session that ended keeps the work and syncs after signing in again', async () => {
    const server = new FakeServer();
    const { store, storage } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    server.offline = true;
    store.setText(P, 'unsent');
    await store.syncNow();
    await store.flush();
    server.offline = false;
    server.session = null; // signed out elsewhere
    const { store: again } = makeStore(server, storage);
    await again.init();
    expect(again.getSnapshot().sync.state).toBe('session-expired');
    expect(again.getText(P)).toBe('unsent');
    await again.signIn('alice', 'password1', async () => ({}));
    await settle();
    expect(server.users.get('alice')!.files.get(P)?.content).toBe('unsent');
  });

  it('delete account can keep a local copy', async () => {
    const server = new FakeServer();
    const { store } = makeStore(server);
    await store.init();
    await store.signUp('alice', 'password1');
    store.setText(P, 'keep me');
    await store.syncNow();
    await store.deleteAccount('password1', true);
    expect(store.getSnapshot().account.kind).toBe('anonymous');
    expect(store.getText(P)).toBe('keep me');
    expect(server.users.has('alice')).toBe(false);
  });
});
