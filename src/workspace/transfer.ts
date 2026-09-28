// Moving work in and out of a workspace: importing uploaded files (plain or zipped), exporting
// files (one, or all as a zip), forking someone's work, and starting over.

import { detectWorkFile, toReadableWork, type DetectedFile } from './fileTypes';
import { parseWorkPath, workPath, WORK_FILES, type Notation } from './paths';
import type { WorkSource } from './source';
import { createZip, readZip } from './zip';

export interface UploadedFile {
  name: string;
  text: string;
}

export interface ImportItem {
  /** The uploaded file's name (inside a zip: "archive.zip/derivation.rec"). */
  source: string;
  detected: DetectedFile;
  /** Where it goes, e.g. 'syntax1/derivation.rec'. */
  path: string;
  text: string;
  digestOk: boolean;
  /** The workspace already has work there (it will be replaced). */
  replaces: boolean;
}

export interface ImportPlan {
  items: ImportItem[];
  /** Files that are not work files (with the reason). */
  rejected: { source: string; reason: string }[];
}

/** Reads uploaded File objects (zip archives are opened) as texts. */
export async function readUploads(files: Iterable<File>): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  const dec = new TextDecoder('utf-8');
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (f.name.toLowerCase().endsWith('.zip')) {
      for (const e of await readZip(bytes)) {
        const base = e.name.substring(e.name.lastIndexOf('/') + 1);
        if (base === '' || base.startsWith('.')) continue;
        out.push({ name: `${f.name}/${e.name}`, text: dec.decode(e.data) });
      }
    } else {
      out.push({ name: f.name, text: dec.decode(bytes) });
    }
  }
  return out;
}

/**
 * Works out what importing the files into the notation would do. Only one file per work
 * file is taken (the last one wins, and the others are listed as rejected).
 */
export function planImport(files: readonly UploadedFile[], notation: Notation, current: WorkSource | null): ImportPlan {
  const byPath = new Map<string, ImportItem>();
  const rejected: ImportPlan['rejected'] = [];
  for (const f of files) {
    const base = f.name.substring(f.name.lastIndexOf('/') + 1);
    if (/^(user|prefs)\.txt$/i.test(base) || /data\.txt$/i.test(base)) {
      rejected.push({ source: f.name, reason: 'Not a work file (user information, preferences or a log).' });
      continue;
    }
    const detected = detectWorkFile(base, f.text);
    if (!detected) {
      rejected.push({ source: f.name, reason: 'Not recognized as the work of any module.' });
      continue;
    }
    let converted;
    try {
      converted = toReadableWork(detected, base, f.text);
    } catch (err) {
      rejected.push({ source: f.name, reason: `Could not be read: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    const path = workPath(notation, detected.info.file);
    const earlier = byPath.get(path);
    if (earlier) rejected.push({ source: earlier.source, reason: `Replaced by ${f.name} (both hold ${detected.info.title.toLowerCase()}).` });
    byPath.set(path, {
      source: f.name,
      detected,
      path,
      text: converted.text,
      digestOk: converted.digestOk,
      replaces: current?.getFile(path) != null,
    });
  }
  return { items: [...byPath.values()], rejected };
}

/** The files of a notation, as zip entries named like the desktop's work files. */
export function exportEntries(source: WorkSource, notation: Notation): { name: string; data: string }[] {
  const out: { name: string; data: string }[] = [];
  for (const w of WORK_FILES) {
    const text = source.getFile(workPath(notation, w.file));
    if (text != null) out.push({ name: w.file, data: text });
  }
  return out;
}

export function exportZip(source: WorkSource, notation: Notation): Uint8Array {
  return createZip(exportEntries(source, notation));
}

/** The name for an exported archive, e.g. "logic2010-notation1-work.zip" or "...-alice-...". */
export function exportZipName(notation: Notation, owner: string | null): string {
  return `logic2010-${owner ? owner + '-' : ''}notation${notation}-work.zip`;
}

/**
 * The changes that copy someone's work into yours: each of their files in the notation(s)
 * replaces yours; your files for modules they have no work in are kept.
 */
export function forkChanges(from: WorkSource, notation: Notation | 'all'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of from.paths()) {
    const p = parseWorkPath(path);
    if (!p || (notation !== 'all' && p.notation !== notation)) continue;
    const text = from.getFile(path);
    if (text != null) out[path] = text;
  }
  return out;
}

/** The changes that start a notation's work over (all its files deleted). */
export function resetChanges(current: WorkSource, notation: Notation, files?: readonly string[]): Record<string, null> {
  const out: Record<string, null> = {};
  for (const path of current.paths()) {
    const p = parseWorkPath(path);
    if (p && p.notation === notation && (!files || files.includes(p.file))) out[path] = null;
  }
  return out;
}

/** Offers bytes or text to the user as a download. */
export function download(name: string, data: string | Uint8Array, type = 'application/octet-stream'): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
