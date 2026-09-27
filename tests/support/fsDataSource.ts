import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from '../../src/engine/data/DataSource';

/** Reads the repository's data/ directory (for tests). */
export const repoData: DataSource = {
  async readText(path: string) {
    try {
      return await readFile(join(__dirname, '../../data', path), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
};
