/**
 * Port of PreferencesFile.java and OverrideSettings.java: tables of "key:value" lines
 * (prefs.txt, override.txt). Lines starting with '#' are skipped; the value is the rest of
 * the line after the first ':' (not trimmed).
 *
 * PreferencesFile looks keys up in upper case (trimmed) and remembers each key's spelling
 * for saving. Its save order is java.util.Hashtable's.
 */
import { JavaHashtable } from '../util/java';
import { javaTrim } from '../util/java';

export class PreferencesFile {
  private readonly table = new JavaHashtable<string, string>();
  private readonly originalKeys = new Map<string, string>();

  getPref(key: string): string | null {
    return this.table.get(javaTrim(key).toUpperCase()) ?? null;
  }

  putPref(key: string, value: string): void {
    const k = javaTrim(key).toUpperCase();
    this.originalKeys.set(k, key);
    this.table.put(k, value);
  }

  removeKey(key: string): void {
    const k = javaTrim(key).toUpperCase();
    this.originalKeys.delete(k);
    this.table.remove(k);
  }

  load(text: string | null): void {
    if (text == null) return;
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (line.startsWith('#')) continue;
      const i = line.indexOf(':');
      if (i !== -1) this.putPref(line.substring(0, i), line.substring(i + 1));
    }
  }

  isEmpty(): boolean {
    return this.table.size === 0;
  }

  /** The file's text as PreferencesFile.save writes it ("\n" line ends), or null if empty. */
  save(): string | null {
    if (this.isEmpty()) return null;
    let out = '';
    for (const [k, v] of this.table) out += this.originalKeys.get(k) + ':' + v + '\n';
    return out;
  }
}

export class OverrideSettings {
  private readonly table = new Map<string, string>();

  lookup(key: string, fallback: string): string {
    return this.table.get(key) ?? fallback;
  }

  get(key: string): string | null {
    return this.table.get(key) ?? null;
  }

  load(text: string | null): void {
    if (text == null) return;
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (line.startsWith('#')) continue;
      const i = line.indexOf(':');
      if (i !== -1) this.table.set(line.substring(0, i), line.substring(i + 1));
    }
  }
}
