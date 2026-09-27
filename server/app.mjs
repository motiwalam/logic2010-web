// The HTTP server: routes requests to the API or the static files, logs them, and turns
// errors into JSON responses.

import { createServer } from 'node:http';
import { createApi } from './api.mjs';
import { Store } from './db.mjs';
import { HttpError, clientIp, sendError } from './http.mjs';
import { createStatic } from './static.mjs';

/**
 * @typedef {import('./api.mjs').ApiConfig & {
 *   dbPath: string,
 *   staticDir: string,
 *   log: (entry: Record<string, unknown>) => void,
 * }} AppConfig
 */

/** Writes one JSON line per log entry to stdout. @param {Record<string, unknown>} entry */
export function logToStdout(entry) {
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
}

/** @param {import('node:http').ServerResponse} res @param {string} location */
function redirect(res, location) {
  res.writeHead(301, { Location: location, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Moved to ${location}\n`);
}

/** @param {import('node:http').ServerResponse} res */
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end('Not found\n');
}

/**
 * Creates (but does not start) the server.
 * @param {AppConfig} config
 */
export function createApp(config) {
  const store = new Store(config.dbPath);
  const api = createApi(config);
  const files = createStatic(config.staticDir);
  const base = config.basePath;
  const apiPrefix = `${base}/api`;

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function route(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (path === apiPrefix || path.startsWith(apiPrefix + '/')) {
      await api.handle(store, req, res, path.slice(apiPrefix.length), url.searchParams);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      throw new HttpError(405, 'method_not_allowed', 'Use GET or HEAD.');
    }
    if (base !== '' && (path === base || path === '/')) {
      redirect(res, `${base}/${url.search}`);
      return;
    }
    if (!path.startsWith(base + '/') || !(await files.serve(req, res, path.slice(base.length + 1)))) {
      notFound(res);
    }
  }

  const server = createServer({ requestTimeout: 60_000, headersTimeout: 30_000 }, async (req, res) => {
    const start = performance.now();
    res.on('finish', () => {
      config.log({
        level: 'info',
        msg: 'request',
        method: req.method,
        path: (req.url ?? '').split('?')[0],
        status: res.statusCode,
        ms: Math.round(performance.now() - start),
        ip: clientIp(req),
      });
    });
    try {
      await route(req, res);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
      } else if (err instanceof HttpError) {
        sendError(res, err);
      } else {
        config.log({ level: 'error', msg: 'unhandled error', path: req.url, error: String(err), stack: /** @type {Error} */ (err)?.stack });
        sendError(res, new HttpError(500, 'internal_error', 'Something went wrong on the server.'));
      }
    }
  });

  // Hourly housekeeping; unref'd so it never keeps the process alive.
  const housekeeping = setInterval(() => {
    try {
      store.deleteExpiredSessions(config.now());
      api.prune();
    } catch (err) {
      config.log({ level: 'error', msg: 'housekeeping failed', error: String(err) });
    }
  }, 60 * 60 * 1000);
  housekeeping.unref();

  /** Stops accepting connections, lets in-flight requests finish (up to `graceMs`), closes the database. */
  async function close(graceMs = 10_000) {
    clearInterval(housekeeping);
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        server.closeAllConnections();
      }, graceMs);
      timer.unref();
      server.close(() => {
        clearTimeout(timer);
        resolve(undefined);
      });
      server.closeIdleConnections();
    });
    store.close();
  }

  return { server, store, close };
}
