/**
 * MD5 (RFC 1321), synchronous and without dependencies, for the digests the desktop program
 * computes with java.security.MessageDigest. Port of Md5OutputStream.java (an OutputStream
 * that feeds MessageDigest and counts bytes).
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;

/** Incremental MD5. */
export class Md5 {
  private readonly state = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]);
  private readonly buffer = new Uint8Array(64);
  private buffered = 0;
  private total = 0;
  private readonly words = new Int32Array(16);

  update(data: Uint8Array, offset = 0, length = data.length - offset): this {
    this.total += length;
    let i = offset;
    const end = offset + length;
    while (i < end) {
      const n = Math.min(64 - this.buffered, end - i);
      this.buffer.set(data.subarray(i, i + n), this.buffered);
      this.buffered += n;
      i += n;
      if (this.buffered === 64) {
        this.block(this.buffer);
        this.buffered = 0;
      }
    }
    return this;
  }

  /** The 16-byte digest. The object must not be updated afterwards. */
  digest(): Uint8Array {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.buffered < 56 ? 56 : 120) - this.buffered) + 8);
    pad[0] = 0x80;
    const p = pad.length - 8;
    const lo = bits >>> 0;
    const hi = Math.floor(bits / 0x100000000) >>> 0;
    for (let i = 0; i < 4; i++) {
      pad[p + i] = (lo >>> (8 * i)) & 0xff;
      pad[p + 4 + i] = (hi >>> (8 * i)) & 0xff;
    }
    const total = this.total;
    this.update(pad);
    this.total = total;
    const out = new Uint8Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) out[i * 4 + j] = (this.state[i] >>> (8 * j)) & 0xff;
    }
    return out;
  }

  private block(b: Uint8Array): void {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      w[i] = b[i * 4] | (b[i * 4 + 1] << 8) | (b[i * 4 + 2] << 16) | (b[i * 4 + 3] << 24);
    }
    let a = this.state[0];
    let bb = this.state[1];
    let c = this.state[2];
    let d = this.state[3];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (bb & c) | (~bb & d);
        g = i;
      } else if (i < 32) {
        f = (d & bb) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = bb ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (bb | ~d);
        g = (7 * i) & 15;
      }
      const t = d;
      d = c;
      c = bb;
      const x = (a + f + K[i] + w[g]) | 0;
      bb = (bb + ((x << S[i]) | (x >>> (32 - S[i])))) | 0;
      a = t;
    }
    this.state[0] = (this.state[0] + a) | 0;
    this.state[1] = (this.state[1] + bb) | 0;
    this.state[2] = (this.state[2] + c) | 0;
    this.state[3] = (this.state[3] + d) | 0;
  }
}

/** Md5OutputStream: MD5 of the bytes written, and their count. */
export class Md5OutputStream {
  private readonly md5 = new Md5();
  private digestBytes: Uint8Array | null = null;
  private byteCount = 0;

  write(bytes: Uint8Array, offset = 0, length = bytes.length - offset): void {
    this.md5.update(bytes, offset, length);
    this.byteCount += length;
  }

  writeByte(b: number): void {
    this.write(new Uint8Array([b & 0xff]));
  }

  digest(): Uint8Array {
    if (this.digestBytes == null) this.digestBytes = this.md5.digest();
    return this.digestBytes;
  }

  getByteCount(): number {
    return this.byteCount;
  }
}

/** MD5 of the bytes. */
export function md5(bytes: Uint8Array): Uint8Array {
  return new Md5().update(bytes).digest();
}
