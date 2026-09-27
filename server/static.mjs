// Serves the built single-page app (Vite's dist/) under BASE_PATH.
//
// Caching: files under assets/ have content hashes in their names, so they are cached for a
// year; index.html must always be revalidated; everything else (course data, PDFs) is cached
// briefly and revalidated with ETag / Last-Modified. Text files are gzipped when the client
// accepts it. Unknown extensionless paths get index.html so client-side routes work.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.rec': 'text/plain; charset=utf-8',
  '.list': 'text/plain; charset=utf-8',
  '.conf': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
};

const COMPRESSIBLE = /^(text\/|application\/(json|xml|manifest\+json)|image\/svg\+xml)/;
const MIN_GZIP_SIZE = 1024;

/**
 * @param {string} rootDir the static directory (Vite's dist/)
 */
export function createStatic(rootDir) {
  const root = resolve(rootDir);

  /**
   * Resolves a URL path (relative to BASE_PATH/, not decoded) to a file inside `root`,
   * or undefined if it is not a safe path.
   * @param {string} urlPath
   */
  function resolvePath(urlPath) {
    let decoded;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return undefined;
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
    const segments = decoded.split('/').filter((s) => s !== '');
    // No '..' and no dotfiles.
    if (segments.some((s) => s.startsWith('.'))) return undefined;
    const file = join(root, ...segments);
    return file === root || file.startsWith(root + sep) ? { file, segments } : undefined;
  }

  /** @param {string} file */
  async function fileStat(file) {
    try {
      const info = await stat(file);
      return info.isFile() ? info : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Serves `urlPath` (the part after BASE_PATH/). Returns false if nothing matched
   * (the caller then sends 404).
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} urlPath
   */
  async function serve(req, res, urlPath) {
    const resolved = resolvePath(urlPath);
    if (!resolved) return false;
    let { file, segments } = resolved;
    let info = segments.length === 0 ? undefined : await fileStat(file);
    let isIndex = false;
    if (!info) {
      // The app shell, for the root and for client-side routes (extensionless paths).
      const last = segments.at(-1) ?? '';
      if (extname(last) !== '') return false;
      file = join(root, 'index.html');
      info = await fileStat(file);
      if (!info) return false;
      isIndex = true;
    }
    isIndex ||= segments.length === 1 && segments[0] === 'index.html';

    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const gzip =
      COMPRESSIBLE.test(type) && info.size >= MIN_GZIP_SIZE && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}${gzip ? '-gz' : ''}"`;
    const lastModified = info.mtime.toUTCString();
    const cacheControl = isIndex
      ? 'no-cache'
      : segments[0] === 'assets'
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300';

    /** @type {Record<string, string>} */
    const headers = {
      'Content-Type': type,
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': lastModified,
      Vary: 'Accept-Encoding',
    };

    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];
    const notModified = ifNoneMatch
      ? ifNoneMatch.split(',').some((tag) => tag.trim() === etag || tag.trim() === '*')
      : ifModifiedSince !== undefined && Date.parse(ifModifiedSince) >= Math.floor(info.mtimeMs / 1000) * 1000;
    if (notModified) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }

    if (gzip) headers['Content-Encoding'] = 'gzip';
    else headers['Content-Length'] = String(info.size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = createReadStream(file);
    try {
      await (gzip ? pipeline(stream, createGzip(), res) : pipeline(stream, res));
    } catch {
      // Client went away or the file vanished mid-response; nothing more can be sent.
      res.destroy();
    }
    return true;
  }

  return { serve };
}
