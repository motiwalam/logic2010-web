// The JSON API under <BASE_PATH>/api. See server/README.md for the endpoints.

import { HttpError, clientIp, parseCookies, readJson, sendJson } from './http.mjs';
import {
  RateLimiter,
  checkPassword,
  checkUsername,
  hashPassword,
  hashToken,
  newSessionToken,
  verifyPassword,
} from './auth.mjs';

/** @typedef {import('./db.mjs').Store} Store */
/** @typedef {import('./db.mjs').UserRow} UserRow */
/** @typedef {import('./db.mjs').FileRow} FileRow */
/** @typedef {import('./db.mjs').FileMeta} FileMeta */
/** @typedef {import('./db.mjs').FileWrite} FileWrite */
/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */

/**
 * @typedef {object} ApiConfig
 * @property {string} basePath        e.g. '/logic2010' ('' to serve at the root)
 * @property {boolean} secureCookies  mark the session cookie Secure (turn off only for plain-HTTP development)
 * @property {number} sessionDays     sliding session lifetime
 * @property {number} bodyLimit       max request body bytes
 * @property {number} fileLimit       max bytes of one work file
 * @property {number} userFilesLimit  max number of files per user
 * @property {number} userBytesLimit  max total bytes of a user's files
 * @property {{ max: number, windowMs: number }} loginRate     password checks per IP
 * @property {{ max: number, windowMs: number }} registerRate  account creations per IP
 * @property {() => number} now
 */

export const COOKIE_NAME = 'logic2010_session';
export const WORK_PATH_PATTERN = /^syntax[12]\/[a-z-]+\.rec$/;
const SUMMARY_LIMIT = 4096;
const DAY = 24 * 60 * 60 * 1000;

/** @param {number} ms */
const iso = (ms) => new Date(ms).toISOString();

/** @param {UserRow} user */
const publicUser = (user) => ({ username: user.username, createdAt: iso(user.createdAt), updatedAt: iso(user.updatedAt) });

/** @param {FileMeta} file */
const publicMeta = (file) => ({ path: file.path, version: file.version, updatedAt: iso(file.updatedAt), summary: file.summary });

/** @param {FileRow} file */
const publicFile = (file) => ({ ...publicMeta(file), content: file.content });

/** @param {unknown} value @returns {Record<string, unknown>} */
function asObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_request', 'Request body must be a JSON object.');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} path */
function checkWorkPath(path) {
  if (typeof path !== 'string' || !WORK_PATH_PATTERN.test(path)) {
    throw new HttpError(400, 'invalid_path', 'Work file paths look like "syntax1/derivation.rec".', { path });
  }
  return path;
}

/** @param {unknown} summary @returns {Record<string, unknown>} */
function checkSummary(summary) {
  if (summary === undefined) return {};
  if (
    typeof summary !== 'object' || summary === null || Array.isArray(summary) ||
    JSON.stringify(summary).length > SUMMARY_LIMIT
  ) {
    throw new HttpError(400, 'invalid_summary', `A summary is a JSON object of at most ${SUMMARY_LIMIT} characters.`);
  }
  return /** @type {Record<string, unknown>} */ (summary);
}

/** @param {unknown} value */
function checkBaseVersion(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0) {
    throw new HttpError(400, 'invalid_base_version', 'baseVersion must be a non-negative integer (0 for a new file).');
  }
  return /** @type {number} */ (value);
}

/** @param {ApiConfig} config */
export function createApi(config) {
  const sessionMs = config.sessionDays * DAY;
  const cookiePath = config.basePath || '/';
  const loginLimiter = new RateLimiter(config.loginRate.max, config.loginRate.windowMs);
  const registerLimiter = new RateLimiter(config.registerRate.max, config.registerRate.windowMs);

  /** @param {string} value @param {number} maxAgeSeconds */
  function cookie(value, maxAgeSeconds) {
    return [
      `${COOKIE_NAME}=${value}`,
      `Path=${cookiePath}`,
      `Max-Age=${maxAgeSeconds}`,
      'HttpOnly',
      'SameSite=Lax',
      ...(config.secureCookies ? ['Secure'] : []),
    ].join('; ');
  }

  /**
   * Starts a session for `user` and sets its cookie on the response.
   * @param {Store} store @param {Response} res @param {UserRow} user
   */
  function startSession(store, res, user) {
    const now = config.now();
    const { token, hash } = newSessionToken();
    store.createSession(hash, user.id, now, now + sessionMs);
    res.setHeader('Set-Cookie', cookie(token, Math.floor(sessionMs / 1000)));
  }

  /**
   * The signed-in user, if any. Sessions slide: using one extends it (at most once a day).
   * @param {Store} store @param {Request} req @param {Response} res
   * @returns {{ user: UserRow, tokenHash: string } | undefined}
   */
  function currentSession(store, req, res) {
    const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
    if (!token) return undefined;
    const tokenHash = hashToken(token);
    const now = config.now();
    const session = store.findSession(tokenHash, now);
    if (!session) return undefined;
    if (session.expiresAt - now < sessionMs - DAY) {
      store.extendSession(tokenHash, now + sessionMs);
      res.setHeader('Set-Cookie', cookie(token, Math.floor(sessionMs / 1000)));
    }
    return { user: session.user, tokenHash };
  }

  /** @param {Store} store @param {Request} req @param {Response} res */
  function requireSession(store, req, res) {
    const session = currentSession(store, req, res);
    if (!session) throw new HttpError(401, 'not_signed_in', 'You are not signed in.');
    return session;
  }

  /**
   * Checks a signed-in user's password (for sensitive account changes).
   * @param {Request} req @param {UserRow} user @param {unknown} password
   */
  async function confirmPassword(req, user, password) {
    loginLimiter.hit(clientIp(req), config.now());
    if (typeof password !== 'string' || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(403, 'wrong_password', 'The password is not correct.');
    }
  }

  /**
   * Throws 409 if the file's current version is not `baseVersion` (0 = file must not exist).
   * @param {Store} store @param {number} userId @param {string} path @param {number | undefined} baseVersion
   */
  function conflictFor(store, userId, path, baseVersion) {
    const current = store.getFile(userId, path);
    if ((current?.version ?? 0) === baseVersion) return undefined;
    return { path, current: current ? publicFile(current) : null };
  }

  /** @param {Store} store @param {number} userId */
  function checkQuota(store, userId) {
    const usage = store.usage(userId);
    if (usage.files > config.userFilesLimit || usage.bytes > config.userBytesLimit) {
      throw new HttpError(
        413,
        'quota_exceeded',
        `An account may store at most ${config.userFilesLimit} files and ${config.userBytesLimit} bytes.`,
      );
    }
  }

  /** @param {Record<string, unknown>} body @param {string} path @returns {FileWrite} */
  function fileWrite(body, path) {
    if (typeof body.content !== 'string') {
      throw new HttpError(400, 'invalid_content', 'content must be a string.', { path });
    }
    if (Buffer.byteLength(body.content) > config.fileLimit) {
      throw new HttpError(413, 'file_too_large', `A work file may be at most ${config.fileLimit} bytes.`, { path });
    }
    return { path, content: body.content, summary: checkSummary(body.summary) };
  }

  /**
   * @typedef {object} RouteContext
   * @property {Store} store
   * @property {Request} req
   * @property {Response} res
   * @property {string[]} params  path segments matched by '*' (joined for a trailing '**')
   * @property {URLSearchParams} query
   * @property {Record<string, unknown>} body  parsed JSON body (mutating requests only)
   */

  /** @type {Array<[method: string, pattern: string, handler: (ctx: RouteContext) => Promise<void> | void]>} */
  const routes = [
    ['GET', 'health', ({ store, res }) => sendJson(res, 200, { ok: true, schemaVersion: store.schemaVersion })],

    // --- account and session ---

    ['POST', 'account', async ({ store, req, res, body }) => {
      registerLimiter.hit(clientIp(req), config.now());
      const username = checkUsername(body.username);
      const password = checkPassword(body.password);
      const taken = () => new HttpError(409, 'username_taken', 'That username is taken.');
      if (store.findUser(username)) throw taken();
      const user = store.createUser(username, await hashPassword(password), config.now());
      if (!user) throw taken();
      startSession(store, res, user);
      sendJson(res, 201, { user: publicUser(user) });
    }],

    ['DELETE', 'account', async ({ store, req, res, body }) => {
      const { user } = requireSession(store, req, res);
      await confirmPassword(req, user, body.password);
      store.deleteUser(user.id);
      res.setHeader('Set-Cookie', cookie('', 0));
      sendJson(res, 204, null);
    }],

    ['PUT', 'account/password', async ({ store, req, res, body }) => {
      const { user, tokenHash } = requireSession(store, req, res);
      const newPassword = checkPassword(body.newPassword, 'newPassword');
      await confirmPassword(req, user, body.currentPassword);
      store.setPassword(user.id, await hashPassword(newPassword));
      store.deleteOtherSessions(user.id, tokenHash);
      sendJson(res, 204, null);
    }],

    ['GET', 'session', ({ store, req, res }) => {
      const session = currentSession(store, req, res);
      sendJson(res, 200, { user: session ? publicUser(session.user) : null });
    }],

    ['POST', 'session', async ({ store, req, res, body }) => {
      loginLimiter.hit(clientIp(req), config.now());
      const username = typeof body.username === 'string' ? body.username : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const user = username.length <= 32 ? store.findUser(username) : undefined;
      if (!(await verifyPassword(password.slice(0, 1000), user?.passwordHash)) || !user) {
        throw new HttpError(401, 'wrong_credentials', 'The username or password is not correct.');
      }
      startSession(store, res, user);
      sendJson(res, 200, { user: publicUser(user) });
    }],

    ['DELETE', 'session', ({ store, req, res }) => {
      const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
      if (token) store.deleteSession(hashToken(token));
      res.setHeader('Set-Cookie', cookie('', 0));
      sendJson(res, 204, null);
    }],

    // --- public listings ---

    ['GET', 'users', ({ store, res, query }) => {
      const limit = Math.min(Math.max(Number.parseInt(query.get('limit') ?? '100', 10) || 100, 1), 500);
      const offset = Math.max(Number.parseInt(query.get('offset') ?? '0', 10) || 0, 0);
      const { total, users } = store.listUsers({ query: (query.get('q') ?? '').trim().slice(0, 64), limit, offset });
      sendJson(res, 200, {
        total,
        users: users.map(({ user, files }) => ({ ...publicUser(user), files: files.map(publicMeta) })),
      });
    }],

    ['GET', 'users/*', ({ store, res, params }) => {
      const user = store.findUser(params[0]);
      if (!user) throw new HttpError(404, 'no_such_user', 'There is no user with that name.');
      sendJson(res, 200, { user: publicUser(user), files: store.listFiles(user.id).map(publicFile) });
    }],

    // --- own work ---

    ['GET', 'work', ({ store, req, res }) => {
      const { user } = requireSession(store, req, res);
      sendJson(res, 200, { user: publicUser(user), files: store.listFiles(user.id).map(publicFile) });
    }],

    ['PUT', 'work', ({ store, req, res, body }) => {
      const { user } = requireSession(store, req, res);
      const force = body.force === true;
      if (!Array.isArray(body.files) || body.files.length > config.userFilesLimit) {
        throw new HttpError(400, 'invalid_request', `files must be an array of at most ${config.userFilesLimit} files.`);
      }
      const seen = new Set();
      const writes = body.files.map((entry) => {
        const item = asObject(entry);
        const path = checkWorkPath(item.path);
        if (seen.has(path)) throw new HttpError(400, 'duplicate_path', `${path} appears twice.`, { path });
        seen.add(path);
        const baseVersion = checkBaseVersion(item.baseVersion);
        if (!force && baseVersion === undefined) {
          throw new HttpError(400, 'invalid_base_version', 'Each file needs a baseVersion (0 for a new file) unless force is set.', { path });
        }
        return { file: fileWrite(item, path), baseVersion };
      });
      const written = store.transaction(() => {
        if (!force) {
          const conflicts = writes.flatMap(({ file, baseVersion }) => conflictFor(store, user.id, file.path, baseVersion) ?? []);
          if (conflicts.length > 0) {
            throw new HttpError(409, 'conflict', 'Some files were changed elsewhere.', { conflicts });
          }
        }
        const now = config.now();
        const metas = writes.map(({ file }) => store.writeFile(user.id, file, now));
        checkQuota(store, user.id);
        return metas;
      });
      sendJson(res, 200, { files: written.map(publicMeta) });
    }],

    ['PUT', 'work/**', ({ store, req, res, params, body }) => {
      const { user } = requireSession(store, req, res);
      const path = checkWorkPath(params[0]);
      const force = body.force === true;
      const baseVersion = checkBaseVersion(body.baseVersion);
      if (!force && baseVersion === undefined) {
        throw new HttpError(400, 'invalid_base_version', 'baseVersion is required (0 for a new file) unless force is set.');
      }
      const file = fileWrite(body, path);
      const meta = store.transaction(() => {
        const conflict = force ? undefined : conflictFor(store, user.id, path, baseVersion);
        if (conflict) throw new HttpError(409, 'conflict', 'This file was changed elsewhere.', conflict);
        const written = store.writeFile(user.id, file, config.now());
        checkQuota(store, user.id);
        return written;
      });
      sendJson(res, 200, { file: publicMeta(meta) });
    }],

    ['DELETE', 'work/**', ({ store, req, res, params, body }) => {
      const { user } = requireSession(store, req, res);
      const path = checkWorkPath(params[0]);
      const force = body.force === true;
      const baseVersion = checkBaseVersion(body.baseVersion);
      if (!force && baseVersion === undefined) {
        throw new HttpError(400, 'invalid_base_version', 'baseVersion is required unless force is set.');
      }
      store.transaction(() => {
        const conflict = force ? undefined : conflictFor(store, user.id, path, baseVersion);
        if (conflict) throw new HttpError(409, 'conflict', 'This file was changed elsewhere.', conflict);
        store.deleteFile(user.id, path, config.now());
      });
      sendJson(res, 204, null);
    }],
  ];

  /**
   * Matches `segments` against a route pattern: '*' matches one segment, a trailing '**'
   * matches one or more segments (joined with '/').
   * @param {string} pattern @param {string[]} segments
   * @returns {string[] | undefined}
   */
  function match(pattern, segments) {
    const parts = pattern.split('/');
    /** @type {string[]} */
    const params = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '**') {
        if (segments.length <= i) return undefined;
        params.push(segments.slice(i).join('/'));
        return params;
      }
      if (i >= segments.length) return undefined;
      if (parts[i] === '*') params.push(segments[i]);
      else if (parts[i] !== segments[i]) return undefined;
    }
    return segments.length === parts.length ? params : undefined;
  }

  /**
   * Handles a request for `<BASE_PATH>/api/<apiPath>`.
   * @param {Store} store @param {Request} req @param {Response} res @param {string} apiPath @param {URLSearchParams} query
   */
  async function handle(store, req, res, apiPath, query) {
    let segments;
    try {
      segments = apiPath.split('/').filter((s) => s !== '').map(decodeURIComponent);
    } catch {
      throw new HttpError(400, 'bad_path', 'The request path is not valid.');
    }
    const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
    const matching = routes.flatMap(([m, pattern, handler]) => {
      const params = match(pattern, segments);
      return params ? [{ m, handler, params }] : [];
    });
    if (matching.length === 0) throw new HttpError(404, 'not_found', 'There is no such API endpoint.');
    const route = matching.find((r) => r.m === method);
    if (!route) {
      const allow = [...new Set(matching.map((r) => r.m))].join(', ');
      throw new HttpError(405, 'method_not_allowed', `Use ${allow}.`, undefined, { Allow: allow });
    }

    /** @type {Record<string, unknown>} */
    let body = {};
    if (method !== 'GET') {
      // CSRF defense: a cross-site form cannot send a custom header or a JSON content type,
      // and cross-origin scripts cannot send either without a CORS preflight, which fails.
      if (req.headers['x-logic2010'] !== '1') {
        throw new HttpError(403, 'missing_header', 'Requests that change data need the header "X-Logic2010: 1".');
      }
      if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
        throw new HttpError(415, 'unsupported_media_type', 'Request bodies must be application/json.');
      }
      body = asObject(await readJson(req, config.bodyLimit));
    }
    await route.handler({ store, req, res, params: route.params, query, body });
  }

  /** Housekeeping: forget old rate-limit windows. */
  function prune() {
    loginLimiter.prune(config.now());
    registerLimiter.prune(config.now());
  }

  return { handle, prune };
}
