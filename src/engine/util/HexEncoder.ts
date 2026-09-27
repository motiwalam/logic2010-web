/** Port of HexEncoder.java: bytes to and from hexadecimal text. */

const HEX_DIGITS = '0123456789ABCDEF';

export class HexEncoder {
  private bytes: number[] = [];
  private nibbleState = 0;
  private pendingNibble = 0;

  constructor(input?: Uint8Array | string) {
    if (typeof input === 'string') this.addHexString(input);
    else if (input) this.addBytes(input);
  }

  reset(): void {
    this.bytes = [];
    this.nibbleState = 0;
    this.pendingNibble = 0;
  }

  addBytes(bytes: Uint8Array, offset = 0, length = bytes.length - offset): void {
    for (let i = 0; i < length; i++) this.bytes.push(bytes[offset + i]);
  }

  getBytes(reset = false): Uint8Array {
    const out = Uint8Array.from(this.bytes);
    if (reset) this.bytes = [];
    return out;
  }

  /** Adds a hex digit (either case); other characters are ignored. */
  addHexChar(c: string): void {
    const i = HEX_DIGITS.indexOf(c.toUpperCase());
    if (i === -1) return;
    if (this.nibbleState === 0) {
      this.pendingNibble = i << 4;
      this.nibbleState = 1;
    } else {
      this.bytes.push(this.pendingNibble | i);
      this.nibbleState = 0;
    }
  }

  addHexString(s: string | null): void {
    if (s == null) return;
    for (const c of s) this.addHexChar(c);
  }

  toString(): string {
    return this.toHexString(false, false);
  }

  /** Upper-case hex, or lower-case if lowerCase; reset empties the encoder. */
  toHexString(reset: boolean, lowerCase: boolean): string;
  toHexString(lowerCase: boolean): string;
  toHexString(a: boolean, b?: boolean): string {
    const reset = b === undefined ? false : a;
    const lowerCase = b === undefined ? a : b;
    let s = '';
    for (const byte of this.bytes) s += HEX_DIGITS.charAt(byte >> 4) + HEX_DIGITS.charAt(byte & 15);
    if (reset) this.bytes = [];
    return lowerCase ? s.toLowerCase() : s;
  }
}
