// SQLite storage: users, sessions and work files.
//
// The schema version is kept in SQLite's `user_version` pragma; MIGRATIONS[i] upgrades a
// database from version i to i + 1. Only append to MIGRATIONS, never edit a released one.
// The schema avoids features newer than SQLite 3.26 (e.g. STRICT tables) so that the system
// `sqlite3` shell on the production server can open the database for inspection.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,  -- ms since epoch
    updated_at    INTEGER NOT NULL,  -- last change to the user's work (created_at if none)
    revision      INTEGER NOT NULL DEFAULT 0  -- last file version handed out for this user
  );
  CREATE INDEX users_updated_at ON users (updated_at);

  CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,  -- hex SHA-256 of the cookie token
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user_id ON sessions (user_id);
  CREATE INDEX sessions_expires_at ON sessions (expires_at);

  CREATE TABLE files (
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    path       TEXT    NOT NULL,     -- e.g. 'syntax1/derivation.rec'
    content    TEXT    NOT NULL,
    summary    TEXT    NOT NULL,     -- JSON object supplied by the client
    size       INTEGER NOT NULL,     -- UTF-8 bytes of content
    version    INTEGER NOT NULL,     -- from users.revision; never reused for this user
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, path)
  );
  `,
];

/**
 * @typedef {{ id: number, username: string, passwordHash: string, createdAt: number, updatedAt: number }} UserRow
 * @typedef {{ path: string, version: number, updatedAt: number, summary: Record<string, unknown> }} FileMeta
 * @typedef {FileMeta & { content: string }} FileRow
 * @typedef {{ path: string, content: string, summary: Record<string, unknown> }} FileWrite
 */

/** @param {any} row @returns {UserRow} */
function toUser(row) {
  return {
    id: Number(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** @param {any} row @returns {FileRow} */
function toFile(row) {
  return {
    path: String(row.path),
    content: String(row.content ?? ''),
    version: Number(row.version),
    updatedAt: Number(row.updated_at),
    summary: JSON.parse(String(row.summary)),
  };
}

export class Store {
  /** @param {string} file database path, or ':memory:' */
  constructor(file) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.migrate();
  }

  migrate() {
    const current = Number(/** @type {any} */ (this.db.prepare('PRAGMA user_version').get()).user_version);
    if (current > MIGRATIONS.length) {
      throw new Error(`Database schema version ${current} is newer than this server (${MIGRATIONS.length}).`);
    }
    for (let version = current; version < MIGRATIONS.length; version++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[version]);
        this.db.exec(`PRAGMA user_version = ${version + 1}`);
      });
    }
  }

  get schemaVersion() {
    return Number(/** @type {any} */ (this.db.prepare('PRAGMA user_version').get()).user_version);
  }

  /**
   * Runs `fn` in a write transaction (all or nothing).
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    if (this.db.isOpen) this.db.close();
  }

  // --- users ---

  /** @param {string} username @returns {UserRow | undefined} */
  findUser(username) {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    return row ? toUser(row) : undefined;
  }

  /** @param {number} id @returns {UserRow | undefined} */
  getUser(id) {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return row ? toUser(row) : undefined;
  }

  /**
   * Creates a user; returns undefined if the name is taken (case-insensitively).
   * @param {string} username @param {string} passwordHash @param {number} now
   * @returns {UserRow | undefined}
   */
  createUser(username, passwordHash, now) {
    try {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(username, passwordHash, now, now);
      return this.getUser(Number(lastInsertRowid));
    } catch (err) {
      if (/UNIQUE constraint failed/.test(String(/** @type {Error} */ (err).message))) return undefined;
      throw err;
    }
  }

  /** @param {number} userId @param {string} passwordHash */
  setPassword(userId, passwordHash) {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
  }

  /** Deletes a user with their sessions and files. @param {number} userId */
  deleteUser(userId) {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  /**
   * Users whose name contains `query` (case-insensitive), most recently active first,
   * each with the metadata of their files.
   * @param {{ query?: string, limit: number, offset: number }} options
   */
  listUsers({ query = '', limit, offset }) {
    const pattern = `%${query.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const users = this.db
      .prepare(
        `SELECT * FROM users WHERE username LIKE ? ESCAPE '\\'
         ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(pattern, limit, offset)
      .map(toUser);
    const total = Number(
      /** @type {any} */ (this.db.prepare(`SELECT count(*) AS n FROM users WHERE username LIKE ? ESCAPE '\\'`).get(pattern)).n,
    );
    const filesOf = this.db.prepare(
      'SELECT path, version, updated_at, summary FROM files WHERE user_id = ? ORDER BY path',
    );
    return {
      total,
      users: users.map((user) => ({
        user,
        files: filesOf.all(user.id).map((row) => {
          const { content: _, ...meta } = toFile(row);
          return /** @type {FileMeta} */ (meta);
        }),
      })),
    };
  }

  // --- sessions ---

  /** @param {string} tokenHash @param {number} userId @param {number} now @param {number} expiresAt */
  createSession(tokenHash, userId, now, expiresAt) {
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, now, expiresAt);
  }

  /**
   * The unexpired session with this token hash and its user.
   * @param {string} tokenHash @param {number} now
   * @returns {{ user: UserRow, expiresAt: number } | undefined}
   */
  findSession(tokenHash, now) {
    const row = /** @type {any} */ (
      this.db
        .prepare(
          `SELECT users.*, sessions.expires_at AS session_expires_at
           FROM sessions JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
        )
        .get(tokenHash, now)
    );
    return row ? { user: toUser(row), expiresAt: Number(row.session_expires_at) } : undefined;
  }

  /** @param {string} tokenHash @param {number} expiresAt */
  extendSession(tokenHash, expiresAt) {
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expiresAt, tokenHash);
  }

  /** @param {string} tokenHash */
  deleteSession(tokenHash) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  /** Deletes all of a user's sessions except `keepTokenHash`. @param {number} userId @param {string} keepTokenHash */
  deleteOtherSessions(userId, keepTokenHash) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, keepTokenHash);
  }

  /** @param {number} now */
  deleteExpiredSessions(now) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }

  // --- files ---

  /** @param {number} userId @returns {FileRow[]} */
  listFiles(userId) {
    return this.db.prepare('SELECT * FROM files WHERE user_id = ? ORDER BY path').all(userId).map(toFile);
  }

  /** @param {number} userId @param {string} path @returns {FileRow | undefined} */
  getFile(userId, path) {
    const row = this.db.prepare('SELECT * FROM files WHERE user_id = ? AND path = ?').get(userId, path);
    return row ? toFile(row) : undefined;
  }

  /** @param {number} userId */
  usage(userId) {
    const row = /** @type {any} */ (
      this.db.prepare('SELECT count(*) AS files, coalesce(sum(size), 0) AS bytes FROM files WHERE user_id = ?').get(userId)
    );
    return { files: Number(row.files), bytes: Number(row.bytes) };
  }

  /**
   * Writes a file with a new version number. Call inside `transaction`.
   * @param {number} userId @param {FileWrite} file @param {number} now
   * @returns {FileMeta}
   */
  writeFile(userId, file, now) {
    const { revision } = /** @type {any} */ (
      this.db
        .prepare('UPDATE users SET revision = revision + 1, updated_at = ? WHERE id = ? RETURNING revision')
        .get(now, userId)
    );
    const version = Number(revision);
    this.db
      .prepare(
        `INSERT INTO files (user_id, path, content, summary, size, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, path) DO UPDATE SET
           content = excluded.content, summary = excluded.summary, size = excluded.size,
           version = excluded.version, updated_at = excluded.updated_at`,
      )
      .run(userId, file.path, file.content, JSON.stringify(file.summary), Buffer.byteLength(file.content), version, now);
    return { path: file.path, version, updatedAt: now, summary: file.summary };
  }

  /** @param {number} userId @param {string} path @param {number} now */
  deleteFile(userId, path, now) {
    const { changes } = this.db.prepare('DELETE FROM files WHERE user_id = ? AND path = ?').run(userId, path);
    if (changes > 0) this.db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(now, userId);
    return changes > 0;
  }
}
