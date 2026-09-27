/**
 * Port of DelimitedTokenizer.java. The delimiter string's first character is the escape
 * character (usually a backslash); the others end tokens. nextToken returns the text up
 * to the next unescaped delimiter, and getDelimiter which delimiter ended it (the escape
 * character at the end of the input).
 */
export class DelimitedTokenizer {
  private delimiter: string;
  private remaining: string | null = null;
  private readonly delimiters: string;

  constructor(delimiters: string | null) {
    if (delimiters == null || delimiters.length === 0) delimiters = '\\';
    this.delimiters = delimiters;
    this.delimiter = delimiters.charAt(0);
  }

  setInput(s: string | null): void {
    this.delimiter = this.delimiters.charAt(0);
    this.remaining = s;
  }

  getRemaining(): string | null {
    return this.remaining;
  }

  getDelimiter(): string {
    return this.delimiter;
  }

  /** The next token, or null at the end. keepEscapes: keep the escape characters in it. */
  nextToken(keepEscapes = false): string | null {
    if (this.remaining == null) return null;
    const n = this.delimiters.length;
    let s = '';
    for (;;) {
      const rem: string = this.remaining;
      let j = -1;
      let k = -1;
      for (let l = 0; l < n; l++) {
        const i1 = rem.indexOf(this.delimiters.charAt(l));
        if (i1 !== -1 && (j === -1 || i1 < j)) {
          j = i1;
          k = l;
        }
      }
      if (k === -1) {
        s += rem;
        this.delimiter = this.delimiters.charAt(0);
        this.remaining = null;
        return s;
      }
      let s1 = s + rem.substring(0, j);
      if (k !== 0) {
        this.delimiter = rem.charAt(j);
        this.remaining = rem.substring(j + 1);
        return s1;
      }
      if (keepEscapes) s1 += this.delimiters.charAt(0);
      if (j >= rem.length - 1) {
        this.delimiter = this.delimiters.charAt(0);
        this.remaining = null;
        return s1;
      }
      s = s1 + rem.charAt(j + 1);
      this.remaining = rem.substring(j + 2);
    }
  }

  escape(s: string | null, keepEscaped = false): string | null {
    return DelimitedTokenizer.escape(s, this.delimiters, keepEscaped);
  }

  /**
   * Puts the escape character before each delimiter in s. keepEscaped: an escape character
   * already in s escapes the character after it, which is copied unchanged.
   */
  static escape(s: string | null, delimiters: string | null, keepEscaped = false): string | null {
    if (s == null) return null;
    if (delimiters == null || delimiters.length === 0) delimiters = '\\';
    const c0 = delimiters.charAt(0);
    let out = '';
    for (;;) {
      let j = -1;
      for (let k = 0; k < delimiters.length; k++) {
        const l = s.indexOf(delimiters.charAt(k));
        if (l !== -1 && (j === -1 || l < j)) j = l;
      }
      if (j === -1) return out + s;
      if (keepEscaped && s.charAt(j) === c0) {
        if (j + 1 < s.length) j++;
        out += s.substring(0, j + 1);
        s = s.substring(j + 1);
      } else {
        out += s.substring(0, j) + c0 + s.charAt(j);
        s = s.substring(j + 1);
      }
    }
  }
}
