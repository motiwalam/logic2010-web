// Every data file through DataFiles into tagged-record lines, and their scrambled legacy form.
import * as DataFiles from '../../src/engine/data/DataFiles';
import { DEFAULT_KEY, ScrambledReader, scramble } from '../../src/engine/data/Scrambler';
import { repoData } from '../support/fsDataSource';
import { coreFixture } from '../support/fixtures';

const files = coreFixture<{ path: string; key: string | null; lines: string[]; scrambled: string[] }[]>('datafiles.json');

beforeAll(() => DataFiles.setWarningHandler(() => {}));

test('there are fixtures for the data files', () => {
  expect(files.length).toBeGreaterThan(30);
});

test.each(files.map((f) => [f.path, f] as const))('%s', async (path, f) => {
  const reader = await DataFiles.open(repoData, path, f.key, DEFAULT_KEY);
  expect(reader).not.toBeNull();
  expect(reader!.readAll()).toEqual(f.lines);
  expect(f.lines.map((l) => scramble(l))).toEqual(f.scrambled);
  // a legacy scrambled file (e.g. ghoul.txt) reads back as the same lines
  const legacy = new ScrambledReader(f.scrambled.join('\r\n') + '\r\n', DEFAULT_KEY);
  expect(legacy.readAll()).toEqual(f.lines);
});
