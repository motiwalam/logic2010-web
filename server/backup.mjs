#!/usr/bin/env node
// Backs up the database with SQLite's online backup API (safe while the server runs) and
// deletes backups older than the retention period.
//
//   node server/backup.mjs [database] [backup directory] [days to keep]
//
// Defaults: $LOGIC2010_DB (./server/data/logic2010.db), <database dir>/backups, 14.
// Backups are named logic2010-YYYY-MM-DD.db (one per day; a second run replaces it).

import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dbPath = process.argv[2] ?? process.env.LOGIC2010_DB ?? './server/data/logic2010.db';
const backupDir = process.argv[3] ?? join(dirname(dbPath), 'backups');
const keepDays = Number(process.argv[4] ?? 14);
const NAME = /^logic2010-\d{4}-\d{2}-\d{2}\.db$/;

/** @param {Record<string, unknown>} entry */
const log = (entry) => process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');

mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const target = join(backupDir, `logic2010-${new Date().toISOString().slice(0, 10)}.db`);
const partial = `${target}.partial`;
rmSync(partial, { force: true });

const source = new DatabaseSync(dbPath, { readOnly: true });
try {
  const pages = await backup(source, partial);
  // Make the copy self-contained (no -wal file) and check it before replacing the old one.
  const copy = new DatabaseSync(partial);
  copy.exec('PRAGMA journal_mode = DELETE');
  const check = /** @type {any} */ (copy.prepare('PRAGMA integrity_check').get());
  copy.close();
  if (Object.values(check)[0] !== 'ok') throw new Error(`integrity check failed: ${JSON.stringify(check)}`);
  renameSync(partial, target);
  log({ level: 'info', msg: 'backup written', file: target, pages, bytes: statSync(target).size });
} finally {
  source.close();
}

const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
for (const name of readdirSync(backupDir)) {
  const file = join(backupDir, name);
  if (NAME.test(name) && statSync(file).mtimeMs < cutoff) {
    rmSync(file);
    log({ level: 'info', msg: 'old backup deleted', file });
  }
}
