import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as DataFiles from '../engine/data/DataFiles';
import { UserInfo } from '../engine/program/UserInfo';
import { detectWorkFile, isLegacyText, toReadableWork } from './fileTypes';
import { ReadOnlyWorkspace } from './source';
import { exportEntries, forkChanges, planImport, resetChanges } from './transfer';
import { crc32, createZip, readStoredZip, readZip } from './zip';

const dataDir = join(__dirname, '..', '..', 'data');
const read = (p: string) => readFileSync(join(dataDir, p), 'utf8');

/** A readable work file with a valid digest for the local user, made from course problems. */
function workFrom(problemFile: string, internal: string, count = 5): string {
  const reader = DataFiles.openText(problemFile, read(problemFile), internal, null);
  const records = reader.readAll().filter((l) => !l.startsWith('#') && l.trim() !== '').slice(0, count);
  const canonical = DataFiles.canonicalRecords(records, DataFiles.schemaForKey(internal));
  return DataFiles.writeWork(internal, canonical, UserInfo.localUser().computeDigest(canonical, '1'));
}

describe('detectWorkFile', () => {
  const cases: [string, string, string][] = [
    ['syntax1/derivation-problems.rec', 'derwork.txt', 'derivation.rec'],
    ['syntax1/invalidity-problems.rec', 'invwork.txt', 'invalidity.rec'],
    ['syntax1/parsing-problems.rec', 'parwork.txt', 'parsing.rec'],
    ['syntax1/recognition-problems.rec', 'recwork.txt', 'recognition.rec'],
    ['syntax1/symbolization-problems.rec', 'symwork.txt', 'symbolization.rec'],
    ['syntax1/truth-table-problems.rec', 'truwork.txt', 'truth-tables.rec'],
    ['syntax1/symbolization-answers.rec', 'keywork.txt', 'symbolization-answers.rec'],
  ];

  it.each(cases)('recognizes %s by header, name and fields', (problems, internal, file) => {
    const text = workFrom(problems, internal);
    expect(detectWorkFile('upload.rec', text)).toMatchObject({ info: { file }, by: 'header', format: 'readable' });
    const noHeader = text.split('\n').filter((l) => !l.startsWith('#')).join('\n');
    expect(detectWorkFile(file, noHeader)).toMatchObject({ info: { file }, by: 'name' });
    expect(detectWorkFile('download (3).rec', noHeader)).toMatchObject({ info: { file }, by: 'fields' });
    expect(detectWorkFile(internal, 'anything')).toMatchObject({ info: { file }, format: 'legacy', by: 'name' });
  });

  it('recognizes renamed copies', () => {
    expect(detectWorkFile('Derivation (1).rec', '')?.info.file).toBe('derivation.rec');
    expect(detectWorkFile('my-truth-tables-backup.rec', '')?.info.file).toBe('truth-tables.rec');
    expect(detectWorkFile('notes.rec', 'hello: world')).toBeNull();
  });

  it('tells the formats apart', () => {
    expect(isLegacyText('Deriv 1.001`$~Q .: (P->Q)->~P`-\n# digest')).toBe(true);
    expect(isLegacyText('problem: Deriv 1.001\nstatement: x\n')).toBe(false);
  });
});

describe('legacy work files', () => {
  it('converts derwork.txt to derivation.rec keeping the digest valid', () => {
    const readable = workFrom('syntax1/derivation-problems.rec', 'derwork.txt', 8);
    const legacy = DataFiles.legacyWorkText('derivation.rec', readable, 'derwork.txt');
    const detected = detectWorkFile('derwork.txt', legacy)!;
    expect(detected.format).toBe('legacy');
    const converted = toReadableWork(detected, 'derwork.txt', legacy);
    expect(converted.digestOk).toBe(true);
    expect(converted.text).toBe(readable);
  });

  it('keeps a bad digest (the module then refuses the file, as the desktop does)', () => {
    const readable = workFrom('syntax1/truth-table-problems.rec', 'truwork.txt');
    const legacy = DataFiles.legacyWorkText('truth-tables.rec', readable, 'truwork.txt').replace(/# (\S+)\n$/, '# bogus\n');
    const converted = toReadableWork(detectWorkFile('truwork.txt', legacy)!, 'truwork.txt', legacy);
    expect(converted.digestOk).toBe(false);
    expect(converted.text).toContain('# digest: bogus');
  });
});

describe('import, export, fork, reset', () => {
  const other = new ReadOnlyWorkspace('carol', [
    { path: 'syntax1/derivation.rec', content: 'D1', version: 3, updatedAt: '', summary: {} },
    { path: 'syntax2/parsing.rec', content: 'P2', version: 4, updatedAt: '', summary: {} },
  ]);

  it('plans an import', () => {
    const d = workFrom('syntax1/derivation-problems.rec', 'derwork.txt');
    const plan = planImport(
      [
        { name: 'derivation.rec', text: d },
        { name: 'user.txt', text: '2\nfirstName:Logic' },
        { name: 'random.rec', text: 'foo: bar' },
      ],
      1,
      other,
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ path: 'syntax1/derivation.rec', replaces: true, digestOk: true });
    expect(plan.rejected.map((r) => r.source)).toEqual(['user.txt', 'random.rec']);
  });

  it('exports, forks and resets per notation', () => {
    expect(exportEntries(other, 1)).toEqual([{ name: 'derivation.rec', data: 'D1' }]);
    expect(forkChanges(other, 2)).toEqual({ 'syntax2/parsing.rec': 'P2' });
    expect(forkChanges(other, 'all')).toEqual({ 'syntax1/derivation.rec': 'D1', 'syntax2/parsing.rec': 'P2' });
    expect(resetChanges(other, 1)).toEqual({ 'syntax1/derivation.rec': null });
  });
});

describe('zip', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes archives that read back', async () => {
    const zip = createZip([
      { name: 'derivation.rec', data: 'problem: Deriv 1.001\n' },
      { name: 'ünïcode.rec', data: 'x∀y' },
    ]);
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    const back = readStoredZip(zip);
    expect(back.map((e) => e.name)).toEqual(['derivation.rec', 'ünïcode.rec']);
    expect(new TextDecoder().decode(back[1].data)).toBe('x∀y');
    expect((await readZip(zip)).length).toBe(2);
  });

  it('reads deflated entries', async () => {
    // "hello hello hello" deflated (raw), in a one-entry archive built by hand
    const data = new TextEncoder().encode('hello hello hello');
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const deflated = new Uint8Array(await new Response(stream).arrayBuffer());
    const zip = createZip([{ name: 'a.rec', data: deflated }]);
    // mark the entry as deflated (method 8) in the local and central headers
    const v = new DataView(zip.buffer);
    v.setUint16(8, 8, true);
    const central = zip.length - 22 - (46 + 5);
    v.setUint16(central + 10, 8, true);
    const [entry] = await readZip(zip);
    expect(new TextDecoder().decode(entry.data)).toBe('hello hello hello');
  });
});
