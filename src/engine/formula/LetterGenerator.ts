/**
 * Port of LetterGenerator.java: enumerates fresh letters from an alphabet:
 * a b c ... then a0 b0 c0 ... then a1 ...
 */
export class LetterGenerator {
  readonly letters: string | null;
  readonly letterCount: number;
  position = 0;
  suffix = -1;

  constructor(letters: string | null) {
    this.letters = letters;
    this.letterCount = letters == null ? 0 : letters.length;
  }

  hasMoreElements(): boolean {
    return this.letterCount !== 0;
  }

  nextElement(): string | null {
    if (this.letterCount === 0 || this.letters == null) return null;
    while (this.position >= this.letterCount) {
      this.position -= this.letterCount;
      this.suffix++;
    }
    let s = this.letters.charAt(this.position);
    this.position++;
    if (this.suffix >= 0) s += this.suffix;
    return s;
  }
}
