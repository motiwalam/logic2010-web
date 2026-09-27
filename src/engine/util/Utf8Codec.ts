/**
 * Port of Utf8Codec.java: the program's own UTF-8 coder, limited to 16-bit characters
 * (1 to 3 bytes; a 4-byte sequence is an error). encode writes U+0000 as C0 80 unless
 * told not to, and encodes surrogates one by one (CESU-8), unlike TextEncoder.
 */
export class Utf8Codec {
  private text = '';
  private partialChar = 0;
  private pendingBytes = 0;

  constructor(input?: string | Uint8Array, offset?: number, end?: number) {
    if (typeof input === 'string') this.text = input;
    else if (input) this.decode(input, offset ?? 0, end ?? input.length);
  }

  reset(): void {
    this.text = '';
    this.partialChar = 0;
    this.pendingBytes = 0;
  }

  append(s: string): void {
    if (this.pendingBytes !== 0) throw new Error('IllegalStateException');
    this.text += s;
  }

  /** Decodes bytes[i..end) (Java's decode(bytes, i, j) takes an end index). */
  decode(bytes: Uint8Array, i = 0, end = bytes.length): void {
    while (i < end) {
      const c = bytes[i++];
      if (this.pendingBytes === 0) {
        if (c < 128) {
          this.text += String.fromCharCode(c);
        } else if (c < 192) {
          throw new Error('IllegalArgumentException');
        } else if (c < 224) {
          this.partialChar = (c & 31) << 6;
          this.pendingBytes = 1;
        } else {
          if (c >= 240) throw new Error('IllegalArgumentException');
          this.partialChar = ((c & 15) << 12) & 0xffff;
          this.pendingBytes = 2;
        }
      } else {
        if (c < 128 || c >= 192) throw new Error('IllegalArgumentException');
        if (this.pendingBytes === 1) {
          this.text += String.fromCharCode(this.partialChar | (c & 63));
          this.pendingBytes = 0;
        } else {
          this.partialChar = (this.partialChar | ((c & 63) << 6)) & 0xffff;
          this.pendingBytes = 1;
        }
      }
    }
  }

  encode(modifiedNul = true): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < this.text.length; i++) {
      const c = this.text.charCodeAt(i);
      if (c === 0 && modifiedNul) out.push(0xc0, 0x80);
      else if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | ((c >> 6) & 31), 128 | (c & 63));
      else out.push(224 | ((c >> 12) & 15), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return Uint8Array.from(out);
  }

  toString(): string {
    return this.text;
  }
}
