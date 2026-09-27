# Logic 2010 server

A small Node server (Node ≥ 24, **no npm dependencies**) that

- serves the built app (`dist/`) under `BASE_PATH` (default `/logic2010/`), and
- provides an optional account system (username and password) that stores each user's
  work files, which anyone can read.

Solving problems needs no account: the browser keeps work locally. An account only adds
saving and syncing through this server.

## Running

```sh
npm run build          # builds dist/
npm run server         # node server/server.mjs → http://127.0.0.1:8710/logic2010/
npx vitest run server  # tests (they start their own servers on random ports)
npx tsc -p server      # type-checks the JavaScript (JSDoc types)
```

During development, `npm run dev` (Vite) proxies `/logic2010/api` to `127.0.0.1:8710`, so
run `npm run server` alongside it.

| Variable                   | Default                      |                                              |
| -------------------------- | ---------------------------- | -------------------------------------------- |
| `PORT`                     | `8710`                       |                                              |
| `HOST`                     | `127.0.0.1`                  | only the local reverse proxy should connect  |
| `BASE_PATH`                | `/logic2010`                 | URL prefix; `''` serves at the root          |
| `LOGIC2010_DB`             | `./server/data/logic2010.db` | SQLite database (created if missing)         |
| `LOGIC2010_STATIC`         | `./dist`                     | the built app                                |
| `LOGIC2010_SECURE_COOKIES` | `1`                          | `0` drops `Secure` from the session cookie, for plain-HTTP testing on a host other than `localhost` (browsers accept `Secure` cookies from `http://localhost`) |

`node server/backup.mjs [db] [dir] [days]` writes a consistent copy of the database
(SQLite online backup) to `dir/logic2010-YYYY-MM-DD.db` and deletes copies older than
`days` (default 14). Production runs it daily (see `deploy/`).

## Files

| File          |                                                                  |
| ------------- | ---------------------------------------------------------------- |
| `server.mjs`  | entry point: configuration from the environment, signals          |
| `app.mjs`     | HTTP server: routing between API and static files, logging, errors |
| `api.mjs`     | the JSON API                                                     |
| `auth.mjs`    | scrypt password hashes, session tokens, rate limiter              |
| `db.mjs`      | SQLite schema, migrations and queries (`node:sqlite`)             |
| `static.mjs`  | static files: content types, caching, gzip, SPA fallback          |
| `http.mjs`    | small helpers (JSON responses, body parsing, cookies, client IP)  |
| `backup.mjs`  | database backup script                                           |

## Static files

- `GET /logic2010` redirects (301) to `/logic2010/`.
- `assets/*` (content-hashed by Vite): `Cache-Control: public, max-age=31536000, immutable`.
- `index.html`: `no-cache`. Other files (course `data/`, PDFs): `max-age=300`. All have
  `ETag` and `Last-Modified` and answer conditional requests with 304.
- Text types are gzipped when the client accepts gzip (files ≥ 1 KB).
- `.rec`, `.list`, `.conf` are `text/plain; charset=utf-8`; `.pdf` is `application/pdf`.
- A missing path **without** an extension gets `index.html` (client-side routes); a missing
  file with an extension is 404. Dotfiles and paths outside the directory are 404.

## API

All endpoints are under `<BASE_PATH>/api` (`/logic2010/api`). Responses are JSON with
`Cache-Control: no-store`. Times are ISO 8601 strings.

**Every request other than GET/HEAD** must send `Content-Type: application/json` and
`X-Logic2010: 1` (CSRF defense; otherwise 415 / 403), and a JSON object body (`{}` if
there is nothing to send). Bodies are limited to 10 MB, each work file to 5 MB, and an
account to 64 files and 50 MB.

Errors look like `{ "error": { "code": "conflict", "message": "…", …details } }`.

### Types

```ts
User        = { username, createdAt, updatedAt }   // updatedAt: last change to the user's work
FileMeta    = { path, version, updatedAt, summary }
File        = FileMeta & { content }
path        = /^syntax[12]\/[a-z-]+\.rec$/         // e.g. "syntax1/derivation.rec"
summary     = JSON object ≤ 4096 chars, stored as given, e.g. { completed, attempted, total }
version     = integer > 0; each write gets a new version from a per-user counter, so a
              version is never reused (even after a delete). 0 means "no such file".
```

### Accounts and sessions

| Request | Body | Success |
| --- | --- | --- |
| `POST /account` (register) | `{ username, password }` | `201 { user }`, signed in |
| `GET /session` (who am I) | | `200 { user }` or `200 { user: null }` |
| `POST /session` (sign in) | `{ username, password }` | `200 { user }` |
| `DELETE /session` (sign out) | `{}` | `204` |
| `PUT /account/password` | `{ currentPassword, newPassword }` | `204`; the user's other sessions are signed out |
| `DELETE /account` | `{ password }` | `204`; the user, sessions and files are deleted |

- Usernames: 3–32 characters `[A-Za-z0-9_.-]`, unique ignoring case, shown as registered;
  sign-in ignores case. Passwords: 8–200 characters.
- Errors: `400 invalid_username | invalid_password`, `409 username_taken`,
  `401 wrong_credentials` (same for unknown user and wrong password),
  `401 not_signed_in`, `403 wrong_password`,
  `429 rate_limited` (with `retryAfter` seconds and a `Retry-After` header).
- Rate limits per client IP: 30 password checks (sign-in, password change, account
  deletion) per 5 minutes; 10 registrations per hour. `X-Forwarded-For` is trusted only
  from 127.0.0.1 (Apache).
- The session is a random 32-byte token in the cookie `logic2010_session`
  (`HttpOnly; Secure; SameSite=Lax; Path=/logic2010`, 180 days, extended when used);
  the database stores only its SHA-256. Passwords are hashed with scrypt
  (N=16384, r=8, p=1, 16-byte salt).

### Public work

| Request | Success |
| --- | --- |
| `GET /users?q=&limit=&offset=` | `200 { total, users: [User & { files: FileMeta[] }] }` |
| `GET /users/:username` | `200 { user, files: File[] }`; `404 no_such_user` |

`/users` is sorted by last activity (newest first); `q` filters by a case-insensitive
substring of the username; `limit` defaults to 100 (max 500).

### Own work (signed in)

| Request | Body | Success |
| --- | --- | --- |
| `GET /work` | | `200 { user, files: File[] }` |
| `PUT /work/:path` | `{ content, summary?, baseVersion?, force? }` | `200 { file: FileMeta }` |
| `DELETE /work/:path` | `{ baseVersion?, force? }` | `204` |
| `PUT /work` (bulk) | `{ files: [{ path, content, summary?, baseVersion? }], force? }` | `200 { files: FileMeta[] }` |

Optimistic concurrency: `baseVersion` is the version the client last saw (0 for a file it
believes does not exist) and is required unless `force: true`. If the server's version
differs, nothing is written and the answer is

```
409 { error: { code: "conflict", message, path, current: File | null } }            // one file
409 { error: { code: "conflict", message, conflicts: [{ path, current: File | null }] } }  // bulk
```

`force: true` overwrites (or deletes) regardless. A bulk upload is all or nothing (one
transaction). Other errors: `400 invalid_path | invalid_content | invalid_summary |
invalid_base_version | duplicate_path | invalid_request | bad_json`, `413 file_too_large |
too_large | quota_exceeded`.

### Other

`GET /health` → `{ ok: true, schemaVersion }`. Unknown endpoints: `404 not_found`; wrong
method: `405 method_not_allowed` with `Allow`. Unexpected errors are logged (one JSON line
on stdout) and answered with `500 internal_error`, without details.

## Database

SQLite in WAL mode with foreign keys; tables `users`, `sessions`, `files`. The schema
version is `PRAGMA user_version`; `MIGRATIONS` in `db.mjs` upgrades it on start (append
new migrations; never edit released ones). The schema stays compatible with SQLite 3.26
so the server's `sqlite3` shell can inspect it.
