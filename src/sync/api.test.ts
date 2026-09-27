// The API client against a real server (server/app.mjs) on a random port.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module
import { createApp } from '../../server/app.mjs';
import { ApiClient, ApiError } from './api';

const tmp = mkdtempSync(join(tmpdir(), 'logic2010-sync-test-'));
let app: { server: import('node:http').Server; close: () => Promise<void> };
let baseUrl = '';

beforeAll(async () => {
  mkdirSync(join(tmp, 'dist'));
  writeFileSync(join(tmp, 'dist', 'index.html'), '<!doctype html>');
  app = createApp({
    basePath: '/logic2010',
    dbPath: join(tmp, 'sync.db'),
    staticDir: join(tmp, 'dist'),
    secureCookies: false,
    sessionDays: 180,
    bodyLimit: 1_000_000,
    fileLimit: 500_000,
    userFilesLimit: 20,
    userBytesLimit: 1_000_000,
    loginRate: { max: 100, windowMs: 60_000 },
    registerRate: { max: 100, windowMs: 60_000 },
    now: Date.now,
    log: () => {},
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}/logic2010/api/`;
});

afterAll(async () => {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** A client whose fetch keeps the session cookie, as a browser would. */
function browserClient() {
  let cookie = '';
  const cookieFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set('Cookie', cookie);
    const res = await fetch(input, { ...init, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = /Max-Age=0\b/.test(setCookie) ? '' : setCookie.split(';')[0];
    return res;
  };
  return new ApiClient({ baseUrl, fetch: cookieFetch });
}

describe('ApiClient', () => {
  it('derives the API root from the Vite base URL by default', () => {
    const viteBase = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    expect(new ApiClient().baseUrl).toBe(viteBase.replace(/\/*$/, '/') + 'api');
    expect(new ApiClient({ baseUrl: 'http://x/y/api/' }).baseUrl).toBe('http://x/y/api');
  });

  it('covers the account, work and listing calls', async () => {
    const api = browserClient();
    expect(await api.me()).toBeNull();
    const user = await api.register('client_user', 'password123');
    expect(user.username).toBe('client_user');
    expect((await api.me())?.username).toBe('client_user');

    const meta = await api.putFile('syntax1/derivation.rec', 'one', { baseVersion: 0, summary: { completed: 1 } });
    expect(meta.version).toBe(1);
    const conflict = await api.putFile('syntax1/derivation.rec', 'two', { baseVersion: 0 }).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(ApiError);
    const err = conflict as ApiError;
    expect(err.status).toBe(409);
    expect(err.isConflict).toBe(true);
    expect(err.conflicts).toEqual([{ path: 'syntax1/derivation.rec', current: expect.objectContaining({ content: 'one', version: 1 }) }]);

    const bulk = await api.putFiles([
      { path: 'syntax1/derivation.rec', content: 'two', baseVersion: 1 },
      { path: 'syntax2/parsing.rec', content: 'p', baseVersion: 0 },
    ]);
    expect(bulk.map((f) => f.version)).toEqual([2, 3]);
    const bulkConflict = (await api.putFiles([{ path: 'syntax2/parsing.rec', content: 'q', baseVersion: 1 }]).catch((e: unknown) => e)) as ApiError;
    expect(bulkConflict.conflicts.map((c) => c.path)).toEqual(['syntax2/parsing.rec']);

    await api.deleteFile('syntax2/parsing.rec', { baseVersion: 3 });
    expect((await api.getMyWork()).files.map((f) => f.content)).toEqual(['two']);

    const anon = browserClient();
    expect((await anon.getUserWork('Client_User')).files[0].content).toBe('two');
    const list = await anon.listUsers({ query: 'client' });
    expect(list.users[0].files[0].summary).toEqual({});
    await expect(anon.getMyWork()).rejects.toMatchObject({ status: 401, code: 'not_signed_in' });

    await api.changePassword('password123', 'password456');
    await api.logout();
    expect(await api.me()).toBeNull();
    await expect(api.login('client_user', 'password123')).rejects.toMatchObject({ code: 'wrong_credentials' });
    await api.login('client_user', 'password456');
    await api.deleteAccount('password456');
    await expect(anon.getUserWork('client_user')).rejects.toMatchObject({ status: 404, code: 'no_such_user' });
  });

  it('reports network failures as ApiError', async () => {
    const api = new ApiClient({ baseUrl: 'http://127.0.0.1:1/api' });
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: 'network' });
  });
});
