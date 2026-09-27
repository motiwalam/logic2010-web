// Passwords, session tokens, and rate limiting.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.mjs';

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** scrypt cost parameters for new hashes; stored in each hash so they can be raised later. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/**
 * @param {string} password @param {Buffer} salt
 * @param {{ N: number, r: number, p: number, keylen: number }} params
 * @returns {Promise<Buffer>}
 */
function derive(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, keylen, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Hashes a password as `scrypt$N$r$p$<salt base64>$<hash base64>`.
 * @param {string} password
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** A valid hash of a random password, checked when a user does not exist so logins take the same time. */
const dummyHash = hashPassword(randomBytes(16).toString('hex'));

/**
 * Checks a password against a stored hash (or against a dummy hash if `stored` is undefined).
 * @param {string} password @param {string | undefined} stored
 */
export async function verifyPassword(password, stored) {
  const parts = (stored ?? (await dummyHash)).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const expected = Buffer.from(parts[5], 'base64');
  const key = await derive(password, Buffer.from(parts[4], 'base64'), { N, r, p, keylen: expected.length });
  return timingSafeEqual(key, expected) && stored !== undefined;
}

/** @param {unknown} username */
export function checkUsername(username) {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    throw new HttpError(
      400,
      'invalid_username',
      'Usernames are 3 to 32 characters: letters, digits, and the characters _ . -',
    );
  }
  return username;
}

/** @param {unknown} password @param {string} [field] */
export function checkPassword(password, field = 'password') {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new HttpError(
      400,
      'invalid_password',
      `Passwords are ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`,
      { field },
    );
  }
  return password;
}

/** A new random session token (sent to the browser) and its hash (stored). */
export function newSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** @param {string} token */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Fixed-window rate limiter keyed by e.g. client IP. In memory: limits reset on restart,
 * which is fine for slowing down password guessing from one address.
 */
export class RateLimiter {
  /** @param {number} max requests allowed per window @param {number} windowMs */
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    /** @type {Map<string, { count: number, resetAt: number }>} */
    this.hits = new Map();
  }

  /**
   * Counts a request; throws 429 if the key is over its limit.
   * @param {string} key @param {number} now
   */
  hit(key, now) {
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > this.max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      throw new HttpError(
        429,
        'rate_limited',
        'Too many attempts. Please wait and try again.',
        { retryAfter },
        { 'Retry-After': String(retryAfter) },
      );
    }
  }

  /** Forgets expired windows. @param {number} now */
  prune(now) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
