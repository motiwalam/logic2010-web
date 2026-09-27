// Small HTTP helpers shared by the API and the static file server.

/** An error with an HTTP status and a stable machine-readable code, sent to the client as JSON. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details] extra fields for the error object
   * @param {Record<string, string>} [headers] extra response headers
   */
  constructor(status, code, message, details, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

/**
 * Sends a JSON response. API responses are never cached.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers = {}) {
  const data = status === 204 ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(status === 204 ? {} : { 'Content-Length': String(Buffer.byteLength(data)) }),
    ...headers,
  });
  res.end(data);
}

/**
 * Sends an error as `{ "error": { "code", "message", ...details } }`.
 * @param {import('node:http').ServerResponse} res
 * @param {HttpError} err
 */
export function sendError(res, err) {
  sendJson(res, err.status, { error: { code: err.code, message: err.message, ...err.details } }, err.headers);
}

/**
 * Reads and parses a JSON request body of at most `limit` bytes.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<unknown>}
 */
export async function readJson(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (declared > limit) throw tooLarge(limit);
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw tooLarge(limit);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json', 'Request body is not valid JSON.');
  }
}

/** @param {number} limit */
function tooLarge(limit) {
  // The rest of the body is not read, so the connection cannot be reused.
  return new HttpError(413, 'too_large', `Request body is larger than ${limit} bytes.`, undefined, { Connection: 'close' });
}

/**
 * Parses the Cookie header.
 * @param {string | undefined} header
 * @returns {Map<string, string>}
 */
export function parseCookies(header) {
  const cookies = new Map();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(eq + 1).trim());
  }
  return cookies;
}

/**
 * The client's IP address. `X-Forwarded-For` is trusted only from the local reverse proxy
 * (Apache on the same machine), which appends the real client address last.
 * @param {import('node:http').IncomingMessage} req
 */
export function clientIp(req) {
  const remote = req.socket.remoteAddress ?? '';
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const forwarded = req.headers['x-forwarded-for'];
  if (local && typeof forwarded === 'string' && forwarded.trim() !== '') {
    const last = forwarded.split(',').pop()?.trim();
    if (last) return last;
  }
  return remote;
}
