import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads tests/fixtures/core/<name>. */
export function coreFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, '../fixtures/core', name), 'utf8')) as T;
}

export function coreFixtureText(name: string): string {
  return readFileSync(join(__dirname, '../fixtures/core', name), 'utf8');
}
