/**
 * The running-key cipher of the original data files, and the MD5 helpers.
 * Port of Scrambler.java, ScrambledReader.java and PlainRecordReader.java.
 *
 * The scrambled files are line-oriented text over a 96-character alphabet (TAB, space and
 * ASCII 0x21-0x7E); other characters pass through unchanged. Each output character depends
 * on the key and on the previous ciphertext character; the state restarts with each line.
 *
 * ScramblingWriter.java is not ported: nothing uses it (and it loses what it writes: its
 * scramblePendingLine writes the scrambled line through its own overridden write, which
 * only appends to the pending line that it then clears).
 */
import { Base64Codec } from '../util/Base64Codec';
import { HexEncoder } from '../util/HexEncoder';
import { md5 } from '../util/Md5';
import { readerLines, utf8Bytes } from '../util/java';

export const ALPHABET =
  '\t !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
export const ALPHABET_SIZE = ALPHABET.length;
export const DEFAULT_KEY = 'the Logic Program is protected by international copyright law';

function alphabetIndex(c: string): number {
  return ALPHABET.indexOf(c);
}

export function scramble(s: string, key?: string | null): string;
export function scramble(s: string | null, key?: string | null): string | null;
export function scramble(s: string | null, key: string | null = DEFAULT_KEY): string | null {
  if (s == null || key == null) return s;
  let out = '';
  let k = 0;
  for (let l = 0; l < s.length; l++) {
    const c = s.charAt(l);
    if (key.length !== 0) {
      const ki = alphabetIndex(key.charAt(l % key.length));
      if (ki !== -1) k += ki;
    }
    const ci = alphabetIndex(c);
    if (ci !== -1) {
      k = (k + ci) % ALPHABET_SIZE;
      out += ALPHABET.charAt(k);
    } else {
      out += c;
    }
  }
  return out;
}

export function unscramble(s: string, key?: string | null): string;
export function unscramble(s: string | null, key?: string | null): string | null;
export function unscramble(s: string | null, key: string | null = DEFAULT_KEY): string | null {
  if (s == null || key == null) return s;
  let out = '';
  let k = 0;
  for (let l = 0; l < s.length; l++) {
    const c = s.charAt(l);
    if (key.length !== 0) {
      const ki = alphabetIndex(key.charAt(l % key.length));
      if (ki !== -1) k += ki;
    }
    const ci = alphabetIndex(c);
    if (ci !== -1) {
      out += ALPHABET.charAt(ALPHABET_SIZE - 1 - ((k - ci + ALPHABET_SIZE - 1) % ALPHABET_SIZE));
      k = ci;
    } else {
      out += c;
    }
  }
  return out;
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? utf8Bytes(data) : data;
}

/** Scrambler.md5Base64: MD5 in base64 (with padding). The string is encoded as UTF-8. */
export function md5Base64(data: string | Uint8Array): string;
export function md5Base64(data: string | Uint8Array | null): string | null;
export function md5Base64(data: string | Uint8Array | null): string | null {
  return data == null ? null : new Base64Codec(md5(toBytes(data))).toString();
}

/** Scrambler.md5Hex: MD5 in hex, lower case unless lowerCase is false. */
export function md5Hex(data: string | Uint8Array, lowerCase?: boolean): string;
export function md5Hex(data: string | Uint8Array | null, lowerCase?: boolean): string | null;
export function md5Hex(data: string | Uint8Array | null, lowerCase = true): string | null {
  return data == null ? null : new HexEncoder(md5(toBytes(data))).toHexString(lowerCase);
}

/**
 * ScrambledReader: reads the lines of a text, unscrambling each with the key (none if the
 * key is null). `plain` marks a PlainRecordReader: the reader of a student's work file.
 */
export class ScrambledReader {
  private readonly lines: string[];
  private position = 0;

  constructor(
    text: string,
    readonly key: string | null,
    readonly plain = false,
  ) {
    this.lines = readerLines(text);
  }

  readLine(): string | null {
    if (this.position >= this.lines.length) return null;
    return unscramble(this.lines[this.position++], this.key);
  }

  /** All remaining lines. */
  readAll(): string[] {
    const out: string[] = [];
    let line: string | null;
    while ((line = this.readLine()) != null) out.push(line);
    return out;
  }

  close(): void {
    this.position = this.lines.length;
  }
}

/** PlainRecordReader: an unscrambled reader of a work file. */
export function plainRecordReader(text: string): ScrambledReader {
  return new ScrambledReader(text, null, true);
}
