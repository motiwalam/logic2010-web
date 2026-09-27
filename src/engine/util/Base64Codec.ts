/** Port of Base64Codec.java: base64 encoding and lenient decoding (non-alphabet characters are skipped). */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PADDING = ['', '==', '='];

export class Base64Codec {
  private bytes: number[] = [];
  private decodeState = 0;
  private pendingBits = 0;

  /** From bytes, or from base64 text. */
  constructor(input?: Uint8Array | string | null) {
    if (typeof input === 'string') this.addBase64String(input);
    else if (input) this.addBytes(input);
  }

  get length(): number {
    return this.bytes.length;
  }

  reset(): void {
    this.bytes = [];
    this.decodeState = 0;
    this.pendingBits = 0;
  }

  addBytes(bytes: Uint8Array | null, offset = 0, length = bytes ? bytes.length - offset : 0): void {
    if (!bytes) return;
    for (let i = 0; i < length; i++) this.bytes.push(bytes[offset + i]);
  }

  getBytes(reset = false): Uint8Array {
    const out = Uint8Array.from(this.bytes);
    if (reset) this.bytes = [];
    return out;
  }

  addBase64Char(c: string): void {
    const i = ALPHABET.indexOf(c);
    if (i === -1 || c.length !== 1) return;
    switch (this.decodeState) {
      case 0:
        this.pendingBits = (i << 2) & 0xff;
        this.decodeState = 1;
        break;
      case 1:
        this.bytes.push((this.pendingBits | (i >> 4)) & 0xff);
        this.pendingBits = (i << 4) & 0xff;
        this.decodeState = 2;
        break;
      case 2:
        this.bytes.push((this.pendingBits | (i >> 2)) & 0xff);
        this.pendingBits = (i << 6) & 0xff;
        this.decodeState = 3;
        break;
      default:
        this.bytes.push((this.pendingBits | i) & 0xff);
        this.decodeState = 0;
    }
  }

  addBase64String(s: string | null): void {
    if (s == null) return;
    for (let j = 0; j < s.length; j++) this.addBase64Char(s.charAt(j));
  }

  toString(): string {
    return this.encode(false, true);
  }

  encodeAll(pad: boolean): string {
    return this.encode(false, pad);
  }

  encodeChunk(chunk: boolean): string {
    return this.encode(chunk, true);
  }

  /**
   * The base64 text. chunk: encode only whole 3-byte groups and keep the rest for later;
   * pad: add "=" padding.
   */
  encode(chunk: boolean, pad: boolean): string {
    let out = '';
    let state = 0;
    const n = chunk ? Math.trunc(this.bytes.length / 3) * 3 : this.bytes.length;
    let bits = 0;
    for (let i = 0; i < n; i++) {
      const k = this.bytes[i];
      if (state === 0) {
        out += ALPHABET.charAt(k >> 2);
        bits = (k << 4) & 63;
        state = 1;
      } else if (state === 1) {
        out += ALPHABET.charAt(bits | (k >> 4));
        bits = (k << 2) & 63;
        state = 2;
      } else {
        out += ALPHABET.charAt(bits | (k >> 6));
        out += ALPHABET.charAt(k & 63);
        state = 0;
      }
    }
    if (state !== 0) {
      out += ALPHABET.charAt(bits);
      if (pad) out += PADDING[state];
    }
    if (chunk) this.bytes = this.bytes.slice(n);
    return out;
  }
}
