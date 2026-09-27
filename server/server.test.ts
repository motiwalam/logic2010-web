// End-to-end tests: start the server on a random port with a temporary database and static
// directory, and exercise every endpoint over HTTP.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module
import { createApp } from './app.mjs';

const BASE = '/logic2010';
const tmp = mkdtempSync(join(tmpdir(), 'logic2010-server-test-'));
const staticDir = join(tmp, 'dist');
const INDEX = '<!doctype html><title>Logic 2010</title>';
const BIG_DATA = 'P>Q\n'.repeat(2000);

let clock = Date.parse('2026-01-01T00:00:00Z');
const logs: Record<string, unknown>[] = [];
let app: { server: import('node:http').Server; close: () => Promise<void> };
let origin = '';

function makeStatic() {
  mkdirSync(join(staticDir, 'assets'), { recursive: true });
  mkdirSync(join(staticDir, 'data'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), INDEX);
  writeFileSync(join(staticDir, 'assets', 'index-abc123.js'), 'console.log(1);\n'.repeat(200));
  writeFileSync(join(staticDir, 'data', 'problems.rec'), BIG_DATA);
  writeFileSync(join(staticDir, 'data', 'book.pdf'), '%PDF-1.4 fake');
  writeFileSync(join(staticDir, 'data', 'logic.conf'), 'a=b\n');
  writeFileSync(join(staticDir, 'data', 'files.list'), 'x\n');
  writeFileSync(join(staticDir, '.secret'), 'hidden');
  writeFileSync(join(tmp, 'outside.txt'), 'outside');
  const old = new Date('2025-01-01T00:00:00Z');
  utimesSync(join(staticDir, 'data', 'problems.rec'), old, old);
}

beforeAll(async () => {
  makeStatic();
  app = createApp({
    basePath: BASE,
    dbPath: join(tmp, 'db', 'test.db'),
    staticDir,
    secureCookies: true,
    sessionDays: 180,
    bodyLimit: 200_000,
    fileLimit: 100_000,
    userFilesLimit: 5,
    userBytesLimit: 150_000,
    loginRate: { max: 1000, windowMs: 60_000 },
    registerRate: { max: 1000, windowMs: 60_000 },
    now: () => clock,
    log: (entry: Record<string, unknown>) => logs.push(entry),
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** A browser-like client with a cookie jar for the session cookie. */
class Client {
  cookie = '';
  lastSetCookie = '';

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = {
      method,
      headers: {
        ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-Logic2010': '1' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      redirect: 'manual',
    };
    if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
    else if (method !== 'GET') init.body = '{}';
    const res = await fetch(origin + BASE + '/api' + path, init);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.lastSetCookie = setCookie;
      const pair = setCookie.split(';')[0];
      this.cookie = /Max-Age=0\b/.test(setCookie) ? '' : pair;
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : undefined };
  }

  static async registered(username: string, password = 'password123') {
    const client = new Client();
    const res = await client.call('POST', '/account', { username, password });
    expect(res.status).toBe(201);
    return client;
  }
}

describe('accounts and sessions', () => {
  it('registers, signs in and out', async () => {
    const c = new Client();
    expect((await c.call('GET', '/session')).json).toEqual({ user: null });

    const reg = await c.call('POST', '/account', { username: 'Alice.B', password: 'correct horse' });
    expect(reg.status).toBe(201);
    expect(reg.json.user.username).toBe('Alice.B');
    expect(reg.json.user.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(c.lastSetCookie).toMatch(/^logic2010_session=[\w-]{43}; Path=\/logic2010; Max-Age=15552000; HttpOnly; SameSite=Lax; Secure$/);

    expect((await c.call('GET', '/session')).json.user.username).toBe('Alice.B');

    expect((await c.call('DELETE', '/session')).status).toBe(204);
    expect(c.cookie).toBe('');
    expect((await c.call('GET', '/session')).json).toEqual({ user: null });

    // Usernames are case-insensitive for sign-in and uniqueness.
    const login = await c.call('POST', '/session', { username: 'alice.b', password: 'correct horse' });
    expect(login.status).toBe(200);
    expect(login.json.user.username).toBe('Alice.B');
    const dup = await new Client().call('POST', '/account', { username: 'ALICE.b', password: 'whatever12' });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe('username_taken');
  });

  it('only a logged-out token is invalidated', async () => {
    const a = await Client.registered('multi');
    const b = new Client();
    await b.call('POST', '/session', { username: 'multi', password: 'password123' });
    await a.call('DELETE', '/session');
    expect((await b.call('GET', '/session')).json.user.username).toBe('multi');
  });

  it('validates usernames and passwords', async () => {
    const c = new Client();
    for (const username of ['ab', 'a'.repeat(33), 'has space', 'ümlaut', 42]) {
      const res = await c.call('POST', '/account', { username, password: 'password123' });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('invalid_username');
    }
    for (const password of ['short', 'x'.repeat(201), null]) {
      const res = await c.call('POST', '/account', { username: 'valid_name', password });
      expect(res.json.error.code).toBe('invalid_password');
    }
    expect((await c.call('POST', '/account', { username: 'a-b_c.9', password: 'x'.repeat(200) })).status).toBe(201);
  });

  it('rejects wrong credentials without revealing which part was wrong', async () => {
    await Client.registered('bob');
    const c = new Client();
    const wrongPassword = await c.call('POST', '/session', { username: 'bob', password: 'nope-nope' });
    const noUser = await c.call('POST', '/session', { username: 'nobody', password: 'nope-nope' });
    expect(wrongPassword.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPassword.json).toEqual(noUser.json);
    expect(c.cookie).toBe('');
    expect((await c.call('POST', '/session', {})).status).toBe(401);
  });

  it('ignores forged or expired session cookies, and slides the expiry', async () => {
    const c = await Client.registered('carol');
    const forged = new Client();
    forged.cookie = 'logic2010_session=' + 'A'.repeat(43);
    expect((await forged.call('GET', '/session')).json.user).toBeNull();
    expect((await forged.call('GET', '/work')).status).toBe(401);

    // Used after 100 days: extended to 180 days from then.
    clock += 100 * 86400_000;
    const used = await c.call('GET', '/session');
    expect(used.json.user.username).toBe('carol');
    expect(used.headers.get('set-cookie')).toMatch(/Max-Age=15552000/);
    clock += 179 * 86400_000;
    expect((await c.call('GET', '/session')).json.user.username).toBe('carol');
    clock += 181 * 86400_000;
    expect((await c.call('GET', '/session')).json.user).toBeNull();
    clock = Date.parse('2026-01-01T00:00:00Z');
  });

  it('changes the password and signs out other sessions', async () => {
    const a = await Client.registered('dave', 'first-password');
    const b = new Client();
    await b.call('POST', '/session', { username: 'dave', password: 'first-password' });

    const wrong = await a.call('PUT', '/account/password', { currentPassword: 'bad-password', newPassword: 'second-password' });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error.code).toBe('wrong_password');
    const invalid = await a.call('PUT', '/account/password', { currentPassword: 'first-password', newPassword: 'short' });
    expect(invalid.json.error.code).toBe('invalid_password');

    expect((await a.call('PUT', '/account/password', { currentPassword: 'first-password', newPassword: 'second-password' })).status).toBe(204);
    expect((await a.call('GET', '/session')).json.user.username).toBe('dave');
    expect((await b.call('GET', '/session')).json.user).toBeNull();
    expect((await new Client().call('POST', '/session', { username: 'dave', password: 'first-password' })).status).toBe(401);
    expect((await new Client().call('POST', '/session', { username: 'dave', password: 'second-password' })).status).toBe(200);
    expect((await new Client().call('PUT', '/account/password', { currentPassword: 'x', newPassword: 'yyyyyyyyy' })).status).toBe(401);
  });

  it('deletes an account with its work, given the password', async () => {
    const c = await Client.registered('erin');
    await c.call('PUT', '/work/syntax1/derivation.rec', { content: 'x', baseVersion: 0 });
    expect((await c.call('DELETE', '/account', { password: 'wrong-password' })).status).toBe(403);
    expect((await c.call('DELETE', '/account', {})).status).toBe(403);
    expect((await c.call('DELETE', '/account', { password: 'password123' })).status).toBe(204);
    expect(c.cookie).toBe('');
    expect((await c.call('GET', '/users/erin')).status).toBe(404);
    // The name is free again.
    expect((await new Client().call('POST', '/account', { username: 'Erin', password: 'password123' })).status).toBe(201);
    expect((await new Client().call('DELETE', '/account', { password: 'password123' })).status).toBe(401);
  });
});

describe('work files', () => {
  it('saves, reads, and publishes work with optimistic concurrency', async () => {
    const c = await Client.registered('frank');
    const path = '/work/syntax1/derivation.rec';

    const first = await c.call('PUT', path, { content: 'v1', summary: { completed: 1, total: 300 }, baseVersion: 0 });
    expect(first.status).toBe(200);
    expect(first.json.file).toEqual({ path: 'syntax1/derivation.rec', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', summary: { completed: 1, total: 300 } });

    clock += 1000;
    const second = await c.call('PUT', path, { content: 'v2', summary: { completed: 2 }, baseVersion: 1 });
    expect(second.json.file.version).toBe(2);

    // A second device still at version 1 gets the current file back.
    const stale = await c.call('PUT', path, { content: 'other', baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('conflict');
    expect(stale.json.error.current).toMatchObject({ path: 'syntax1/derivation.rec', content: 'v2', version: 2, summary: { completed: 2 } });

    // Creating a file that exists is a conflict too.
    expect((await c.call('PUT', path, { content: 'new', baseVersion: 0 })).status).toBe(409);
    // force overwrites.
    const forced = await c.call('PUT', path, { content: 'forced', force: true });
    expect(forced.status).toBe(200);
    expect(forced.json.file.version).toBe(3);

    await c.call('PUT', '/work/syntax2/truth-tables.rec', { content: 'tt', baseVersion: 0 });

    const own = await c.call('GET', '/work');
    expect(own.json.user.username).toBe('frank');
    expect(own.json.files.map((f: { path: string; content: string }) => [f.path, f.content])).toEqual([
      ['syntax1/derivation.rec', 'forced'],
      ['syntax2/truth-tables.rec', 'tt'],
    ]);

    // Anyone can read it.
    const pub = await new Client().call('GET', '/users/FRANK');
    expect(pub.status).toBe(200);
    expect(pub.json).toEqual(own.json);
    expect(pub.headers.get('cache-control')).toBe('no-store');
  });

  it('deletes files, with concurrency checks, and never reuses versions', async () => {
    const c = await Client.registered('grace');
    const path = '/work/syntax2/parsing.rec';
    await c.call('PUT', path, { content: 'a', baseVersion: 0 });
    expect((await c.call('DELETE', path, { baseVersion: 7 })).status).toBe(409);
    expect((await c.call('DELETE', path, {})).status).toBe(400);
    expect((await c.call('DELETE', path, { baseVersion: 1 })).status).toBe(204);
    expect((await c.call('GET', '/work')).json.files).toEqual([]);
    // Deleting a missing file with force is fine.
    expect((await c.call('DELETE', path, { force: true })).status).toBe(204);
    // Old version 1 cannot overwrite the new file (versions are per user and only increase).
    const again = await c.call('PUT', path, { content: 'b', baseVersion: 0 });
    expect(again.json.file.version).toBe(2);
    const stale = await c.call('PUT', path, { content: 'c', baseVersion: 1 });
    expect(stale.status).toBe(409);
  });

  it('bulk-uploads all or nothing', async () => {
    const c = await Client.registered('heidi');
    const bulk = await c.call('PUT', '/work', {
      files: [
        { path: 'syntax1/derivation.rec', content: 'd', summary: { completed: 3 }, baseVersion: 0 },
        { path: 'syntax1/symbolization-answers.rec', content: 's', baseVersion: 0 },
      ],
    });
    expect(bulk.status).toBe(200);
    expect(bulk.json.files.map((f: { path: string; version: number }) => [f.path, f.version])).toEqual([
      ['syntax1/derivation.rec', 1],
      ['syntax1/symbolization-answers.rec', 2],
    ]);

    const conflict = await c.call('PUT', '/work', {
      files: [
        { path: 'syntax1/derivation.rec', content: 'd2', baseVersion: 1 },
        { path: 'syntax1/symbolization-answers.rec', content: 's2', baseVersion: 1 },
        { path: 'syntax2/recognition.rec', content: 'r', baseVersion: 0 },
      ],
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.conflicts).toEqual([
      { path: 'syntax1/symbolization-answers.rec', current: expect.objectContaining({ content: 's', version: 2 }) },
    ]);
    // Nothing was written.
    const work = await c.call('GET', '/work');
    expect(work.json.files.map((f: { content: string }) => f.content)).toEqual(['d', 's']);

    const forced = await c.call('PUT', '/work', {
      force: true,
      files: [{ path: 'syntax1/symbolization-answers.rec', content: 's3' }],
    });
    expect(forced.json.files[0].version).toBe(3);

    expect((await c.call('PUT', '/work', { files: [{ path: 'syntax1/derivation.rec', content: 'x' }] })).status).toBe(400);
    const dup = await c.call('PUT', '/work', {
      force: true,
      files: [
        { path: 'syntax1/derivation.rec', content: 'x' },
        { path: 'syntax1/derivation.rec', content: 'y' },
      ],
    });
    expect(dup.json.error.code).toBe('duplicate_path');
    expect((await c.call('PUT', '/work', { files: 'nope' })).status).toBe(400);
  });

  it('validates paths, contents and summaries', async () => {
    const c = await Client.registered('ivan');
    for (const path of ['syntax3/derivation.rec', 'syntax1/Derivation.rec', 'syntax1/../x.rec', 'syntax1/derivation.txt', 'x.rec']) {
      const res = await c.call('PUT', '/work/' + path, { content: 'x', force: true });
      expect([400, 404]).toContain(res.status);
    }
    expect((await c.call('PUT', '/work/syntax1%2Fparsing.rec', { content: 'x', force: true })).status).toBe(200);
    const bulkBad = await c.call('PUT', '/work', { force: true, files: [{ path: '../etc/passwd', content: 'x' }] });
    expect(bulkBad.json.error.code).toBe('invalid_path');
    expect((await c.call('PUT', '/work/syntax1/parsing.rec', { content: 5, force: true })).json.error.code).toBe('invalid_content');
    for (const summary of [[1], 'text', null, { big: 'x'.repeat(5000) }]) {
      const res = await c.call('PUT', '/work/syntax1/parsing.rec', { content: 'x', summary, force: true });
      expect(res.json.error.code).toBe('invalid_summary');
    }
    expect((await c.call('PUT', '/work/syntax1/parsing.rec', { content: 'x', baseVersion: -1 })).json.error.code).toBe('invalid_base_version');
    expect((await c.call('PUT', '/work/syntax1/parsing.rec', { content: 'x' })).json.error.code).toBe('invalid_base_version');
    expect((await c.call('PUT', '/work/syntax1/parsing.rec', [1, 2])).json.error.code).toBe('invalid_request');
  });

  it('enforces file, body and account size limits', async () => {
    const c = await Client.registered('judy');
    const tooBig = await c.call('PUT', '/work/syntax1/derivation.rec', { content: 'x'.repeat(100_001), force: true });
    expect(tooBig.status).toBe(413);
    expect(tooBig.json.error.code).toBe('file_too_large');
    // Multi-byte characters count as their UTF-8 size.
    expect((await c.call('PUT', '/work/syntax1/derivation.rec', { content: '∀'.repeat(40_000), force: true })).status).toBe(413);

    const body = await c.call('PUT', '/work', { force: true, files: [{ path: 'syntax1/a.rec', content: 'x'.repeat(250_000) }] });
    expect(body.status).toBe(413);
    expect(body.json.error.code).toBe('too_large');

    // 150 000 bytes per account.
    for (const name of ['a', 'b']) {
      expect((await c.call('PUT', `/work/syntax1/${name}.rec`, { content: 'x'.repeat(60_000), force: true })).status).toBe(200);
    }
    const quota = await c.call('PUT', '/work/syntax1/c.rec', { content: 'x'.repeat(60_000), force: true });
    expect(quota.status).toBe(413);
    expect(quota.json.error.code).toBe('quota_exceeded');
    // Replacing a file within the quota works.
    expect((await c.call('PUT', '/work/syntax1/a.rec', { content: 'y'.repeat(60_000), force: true })).status).toBe(200);
    // 5 files per account.
    for (const name of ['c', 'd', 'e']) await c.call('PUT', `/work/syntax2/${name}.rec`, { content: 'x', force: true });
    expect((await c.call('PUT', '/work/syntax2/f.rec', { content: 'x', force: true })).json.error.code).toBe('quota_exceeded');
    expect((await c.call('GET', '/work')).json.files).toHaveLength(5);
  });

  it('requires a session to write', async () => {
    const anon = new Client();
    expect((await anon.call('GET', '/work')).status).toBe(401);
    expect((await anon.call('PUT', '/work/syntax1/derivation.rec', { content: 'x', force: true })).status).toBe(401);
    expect((await anon.call('PUT', '/work', { files: [] })).status).toBe(401);
    expect((await anon.call('DELETE', '/work/syntax1/derivation.rec', { force: true })).json.error.code).toBe('not_signed_in');
  });
});

describe('user listing', () => {
  it('lists users by last activity, with summaries, filtered by name', async () => {
    clock = Date.parse('2026-06-01T00:00:00Z');
    const k = await Client.registered('kim_list');
    clock += 1000;
    await Client.registered('lee_list');
    clock += 1000;
    await k.call('PUT', '/work/syntax1/derivation.rec', { content: 'x', summary: { completed: 12, attempted: 20, total: 300 }, baseVersion: 0 });

    const all = await new Client().call('GET', '/users?q=_LIST');
    expect(all.json.total).toBe(2);
    expect(all.json.users).toEqual([
      {
        username: 'kim_list',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:02.000Z',
        files: [{ path: 'syntax1/derivation.rec', version: 1, updatedAt: '2026-06-01T00:00:02.000Z', summary: { completed: 12, attempted: 20, total: 300 } }],
      },
      { username: 'lee_list', createdAt: '2026-06-01T00:00:01.000Z', updatedAt: '2026-06-01T00:00:01.000Z', files: [] },
    ]);
    expect(JSON.stringify(all.json)).not.toMatch(/content|password|hash/i);

    const page = await new Client().call('GET', '/users?q=_list&limit=1&offset=1');
    expect(page.json.users.map((u: { username: string }) => u.username)).toEqual(['lee_list']);
    // LIKE wildcards in the query are literal.
    expect((await new Client().call('GET', '/users?q=%25')).json.total).toBe(0);
    expect((await new Client().call('GET', '/users?q=_')).json.total).toBeGreaterThan(2);
    expect((await new Client().call('GET', '/users/nobody-here')).status).toBe(404);
  });
});

describe('protocol and security', () => {
  it('rejects mutating requests without the CSRF header or JSON content type', async () => {
    const res = await fetch(`${origin}${BASE}/api/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'csrf_user', password: 'password123' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('missing_header');

    const form = await fetch(`${origin}${BASE}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Logic2010': '1' },
      body: 'username=a&password=b',
    });
    expect(form.status).toBe(415);

    const c = await Client.registered('mallory');
    const noHeader = await fetch(`${origin}${BASE}/api/work/syntax1/derivation.rec`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: c.cookie },
      body: JSON.stringify({ content: 'x', force: true }),
    });
    expect(noHeader.status).toBe(403);
    expect((await c.call('GET', '/work')).json.files).toEqual([]);
  });

  it('returns JSON errors for bad JSON, unknown routes and wrong methods', async () => {
    const c = new Client();
    const bad = await c.call('POST', '/session', '{nope');
    expect(bad.status).toBe(400);
    expect(bad.json.error).toEqual({ code: 'bad_json', message: 'Request body is not valid JSON.' });
    const missing = await c.call('GET', '/nothing');
    expect(missing.status).toBe(404);
    expect(missing.json.error.code).toBe('not_found');
    const method = await c.call('PATCH', '/session');
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET, POST, DELETE');
    expect((await c.call('GET', '/users/%E0%A4%A')).status).toBe(400);
    expect((await c.call('GET', '/health')).json).toEqual({ ok: true, schemaVersion: 1 });
  });

  it('logs one structured line per request, without secrets', () => {
    const request = logs.find((e) => e.msg === 'request' && e.path === `${BASE}/api/session`);
    expect(request).toMatchObject({ level: 'info', method: expect.any(String), status: expect.any(Number), ip: '127.0.0.1' });
    expect(JSON.stringify(logs)).not.toMatch(/password123|logic2010_session=/);
  });
});

describe('rate limiting', () => {
  let limited: typeof app;
  let limitedOrigin = '';
  beforeAll(async () => {
    limited = createApp({
      basePath: BASE,
      dbPath: join(tmp, 'limited.db'),
      staticDir,
      secureCookies: false,
      sessionDays: 180,
      bodyLimit: 1000,
      fileLimit: 1000,
      userFilesLimit: 5,
      userBytesLimit: 5000,
      loginRate: { max: 3, windowMs: 60_000 },
      registerRate: { max: 2, windowMs: 60_000 },
      now: () => clock,
      log: () => {},
    });
    await new Promise<void>((resolve) => limited.server.listen(0, '127.0.0.1', resolve));
    const address = limited.server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    limitedOrigin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(() => limited.close());

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${limitedOrigin}${BASE}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Logic2010': '1', ...headers },
      body: JSON.stringify(body),
    });

  it('limits registrations and logins per client IP, trusting X-Forwarded-For from localhost', async () => {
    const reg1 = await post('/account', { username: 'rate1', password: 'password123' });
    expect(reg1.status).toBe(201);
    expect(reg1.headers.get('set-cookie')).not.toMatch(/Secure/);
    expect((await post('/account', { username: 'rate2', password: 'password123' })).status).toBe(201);
    const third = await post('/account', { username: 'rate3', password: 'password123' });
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('60');
    expect((await third.json()).error.code).toBe('rate_limited');
    // Another client behind the reverse proxy is not affected.
    expect((await post('/account', { username: 'rate3', password: 'password123' }, { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(201);

    for (let i = 0; i < 3; i++) expect((await post('/session', { username: 'rate1', password: 'wrong-pass' })).status).toBe(401);
    expect((await post('/session', { username: 'rate1', password: 'password123' })).status).toBe(429);
    expect((await post('/session', { username: 'rate1', password: 'password123' }, { 'X-Forwarded-For': 'spoofed, 198.51.100.7' })).status).toBe(200);

    // The window resets.
    clock += 61_000;
    expect((await post('/session', { username: 'rate1', password: 'password123' })).status).toBe(200);
  });
});

describe('static files', () => {
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    fetch(origin + path, { headers, redirect: 'manual', method });

  it('redirects the bare base path', async () => {
    const res = await get(`${BASE}?x=1`);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${BASE}/?x=1`);
    expect((await get('/')).headers.get('location')).toBe(`${BASE}/`);
  });

  it('serves index.html uncached, and for client-side routes', async () => {
    for (const path of [`${BASE}/`, `${BASE}/index.html`, `${BASE}/users/alice`, `${BASE}/derivation/3.4`.replace('3.4', 'x')]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toBe(INDEX);
    }
    // Missing files with an extension and unknown API routes are not the app shell.
    expect((await get(`${BASE}/missing.js`)).status).toBe(404);
    expect((await get(`${BASE}/api/users/x/y`)).headers.get('content-type')).toMatch(/json/);
    expect((await get('/elsewhere')).status).toBe(404);
  });

  it('caches hashed assets forever and gzips text', async () => {
    const res = await get(`${BASE}/assets/index-abc123.js`, { 'Accept-Encoding': 'gzip' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    // fetch decompresses transparently; check the raw bytes with node:http.
    const raw = await new Promise<{ headers: import('node:http').IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      httpRequest(`${origin}${BASE}/data/problems.rec`, { headers: { 'Accept-Encoding': 'gzip, deflate' } }, (r) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => resolve({ headers: r.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject).end();
    });
    expect(raw.headers['content-encoding']).toBe('gzip');
    expect(raw.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(raw.headers['vary']).toBe('Accept-Encoding');
    expect(gunzipSync(raw.body).toString()).toBe(BIG_DATA);
  });

  it('uses the right content types and short caching elsewhere, with 304s', async () => {
    const types: Record<string, string> = {
      'data/book.pdf': 'application/pdf',
      'data/logic.conf': 'text/plain; charset=utf-8',
      'data/files.list': 'text/plain; charset=utf-8',
    };
    for (const [file, type] of Object.entries(types)) {
      const res = await get(`${BASE}/${file}`);
      expect(res.headers.get('content-type')).toBe(type);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    }
    const first = await get(`${BASE}/data/problems.rec`, { 'Accept-Encoding': 'identity' });
    const etag = first.headers.get('etag')!;
    expect(first.headers.get('content-length')).toBe(String(BIG_DATA.length));
    expect(first.headers.get('last-modified')).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
    expect((await get(`${BASE}/data/problems.rec`, { 'If-None-Match': etag, 'Accept-Encoding': 'identity' })).status).toBe(304);
    expect((await get(`${BASE}/data/problems.rec`, { 'If-Modified-Since': 'Wed, 01 Jan 2025 00:00:00 GMT' })).status).toBe(304);
    expect((await get(`${BASE}/data/problems.rec`, { 'If-Modified-Since': 'Tue, 31 Dec 2024 00:00:00 GMT' })).status).toBe(200);
    const head = await get(`${BASE}/data/book.pdf`, {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('does not serve files outside the static directory or dotfiles', async () => {
    const paths = [
      `${BASE}/../outside.txt`,
      `${BASE}/%2e%2e/outside.txt`,
      `${BASE}/data/%2e%2e%2f%2e%2e%2foutside.txt`,
      `${BASE}/..%5coutside.txt`,
      `${BASE}/.secret`,
      `${BASE}/data/%00.rec`,
      `${BASE}/%E0%A4%A.txt`,
    ];
    for (const path of paths) {
      // Send the raw path (fetch would normalize '..').
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: new URL(origin).port, path, method: 'GET' }, (r) => {
          r.resume();
          resolve(r.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
      expect(status, path).toBe(404);
    }
    expect((await fetch(origin + BASE + '/', { method: 'POST' })).status).toBe(405);
  });
});

describe('server process', () => {
  it('starts from environment variables and shuts down cleanly on SIGTERM', async () => {
    const child = spawn(process.execPath, [join(import.meta.dirname, 'server.mjs')], {
      env: {
        ...process.env,
        PORT: '0',
        HOST: '127.0.0.1',
        LOGIC2010_DB: join(tmp, 'proc', 'proc.db'),
        LOGIC2010_STATIC: staticDir,
        BASE_PATH: '/logic2010/',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    const url = await new Promise<string>((resolve, reject) => {
      child.stdout.on('data', () => {
        const m = /"url":"([^"]+)"/.exec(out);
        if (m) resolve(m[1]);
      });
      child.on('exit', (code) => reject(new Error(`exited ${code}: ${out}`)));
    });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/logic2010\/$/);
    const health = await fetch(url + 'api/health');
    expect(await health.json()).toEqual({ ok: true, schemaVersion: 1 });
    const exit = new Promise<number | null>((resolve) => child.on('exit', resolve));
    child.kill('SIGTERM');
    expect(await exit).toBe(0);
    expect(out).toMatch(/"msg":"stopped"/);
  });
});
