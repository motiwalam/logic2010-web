/**
 * Port of SchematicLetter.java, TermLetter.java, OperationLetter.java and
 * PredicateLetter.java: the keys of a scheme instantiation, a letter plus its arity.
 *
 * A letter object also carries the matches deferred until the letter gets a value
 * (getDeferredMatches); SchemeInstantiation keeps the pending letter objects for that.
 */
import { isPredicateLetter, operationLetters, predicateLetters, sentenceLetters, variableLetters } from '../program/symbols';
import { stringHash } from '../util/java';
import type { DeferredMatch } from './DeferredMatch';
import { AtomicFormula, type Expression, OperationTerm, SimpleTerm } from './Expression';
import { LetterGenerator } from './LetterGenerator';

export abstract class SchematicLetter {
  readonly letter: string;
  deferredMatches: DeferredMatch[] | null = null;

  constructor(letter: string) {
    this.letter = letter;
  }

  /** As in Java: the letter's String hash (the arity is not part of it). */
  hashCode(): number {
    return stringHash(this.letter);
  }

  abstract equals(other: unknown): boolean;
  abstract toString(): string;
  abstract getArity(): number;
  abstract freshLetter(used: SchematicLetter[]): SchematicLetter | null;
  abstract toExpression(): Expression;

  getLetter(): string {
    return this.letter;
  }

  getDeferredMatches(create: boolean): DeferredMatch[] | null {
    if (create && this.deferredMatches == null) this.deferredMatches = [];
    return this.deferredMatches;
  }

  static placeholder(i: number): string {
    return '{' + (i + 1) + '}';
  }

  static placeholders(from: number, count: number): string {
    let s = '';
    for (let k = 0; k < count; k++) s += SchematicLetter.placeholder(from + k);
    return s;
  }
}

/** Vector.indexOf with equals. */
export function indexOfLetter(letters: readonly SchematicLetter[], letter: SchematicLetter | null): number {
  if (letter == null) return -1;
  for (let i = 0; i < letters.length; i++) {
    if (letter.equals(letters[i])) return i;
  }
  return -1;
}

export class TermLetter extends SchematicLetter {
  constructor(letter: string | SimpleTerm) {
    super(typeof letter === 'string' ? letter : letter.symbol);
  }

  equals(other: unknown): boolean {
    return other instanceof TermLetter && this.letter === other.letter;
  }

  toString(): string {
    return this.letter;
  }

  getArity(): number {
    return 0;
  }

  toExpression(): Expression {
    return new SimpleTerm(this.letter);
  }

  freshLetter(used: SchematicLetter[]): SchematicLetter | null {
    return TermLetter.freshTermLetter(used);
  }

  static freshTermLetter(used: SchematicLetter[]): SchematicLetter | null {
    const generator = new LetterGenerator(variableLetters);
    while (generator.hasMoreElements()) {
      const letter = new TermLetter(generator.nextElement()!);
      if (indexOfLetter(used, letter) === -1) {
        used.push(letter);
        return letter;
      }
    }
    return null;
  }
}

export class OperationLetter extends SchematicLetter {
  readonly arity: number;

  constructor(letter: string | OperationTerm, arity?: number) {
    super(typeof letter === 'string' ? letter : letter.symbol);
    this.arity = typeof letter === 'string' ? arity! : letter.childCount;
  }

  equals(other: unknown): boolean {
    return other instanceof OperationLetter && this.letter === other.letter && this.arity === other.arity;
  }

  toString(): string {
    return this.arity === 0 ? this.letter : this.letter + '(' + SchematicLetter.placeholders(0, this.arity) + ')';
  }

  getArity(): number {
    return this.arity;
  }

  toExpression(): Expression {
    const term = new OperationTerm(this.letter);
    for (let i = 0; i < this.arity; i++) term.addChild(new SimpleTerm(SchematicLetter.placeholder(i)));
    return term;
  }

  freshLetter(used: SchematicLetter[]): SchematicLetter | null {
    return OperationLetter.freshOperationLetter(this.arity, used);
  }

  static freshOperationLetter(arity: number, used: SchematicLetter[]): SchematicLetter | null {
    const generator = new LetterGenerator(reverse(operationLetters));
    while (generator.hasMoreElements()) {
      const letter = new OperationLetter(generator.nextElement()!, arity);
      if (indexOfLetter(used, letter) === -1) {
        used.push(letter);
        return letter;
      }
    }
    return null;
  }
}

export class PredicateLetter extends SchematicLetter {
  readonly arity: number;

  constructor(letter: string | AtomicFormula, arity?: number) {
    super(typeof letter === 'string' ? letter : letter.symbol);
    this.arity = typeof letter === 'string' ? arity! : letter.childCount;
  }

  equals(other: unknown): boolean {
    return other instanceof PredicateLetter && this.letter === other.letter && this.arity === other.arity;
  }

  toString(): string {
    if (this.arity === 0) return this.letter;
    return this.arity === 1 && isPredicateLetter(this.letter)
      ? this.letter + SchematicLetter.placeholder(0)
      : this.letter + '(' + SchematicLetter.placeholders(0, this.arity) + ')';
  }

  getArity(): number {
    return this.arity;
  }

  toExpression(): Expression {
    const formula = new AtomicFormula(this.letter);
    for (let i = 0; i < this.arity; i++) formula.addChild(new SimpleTerm(SchematicLetter.placeholder(i)));
    return formula;
  }

  freshLetter(used: SchematicLetter[]): SchematicLetter | null {
    return PredicateLetter.freshPredicateLetter(!isPredicateLetter(this.letter), this.arity, used);
  }

  /**
   * A letter from the end of the predicate letters (or of the sentence letters, for arity 0
   * or when `sentence` is set) that is not in `used`; it is added to `used`.
   */
  static freshPredicateLetter(sentence: boolean, arity: number, used: SchematicLetter[]): SchematicLetter | null {
    const generator = new LetterGenerator(reverse(arity !== 0 && !sentence ? predicateLetters : sentenceLetters));
    while (generator.hasMoreElements()) {
      const letter = new PredicateLetter(generator.nextElement()!, arity);
      if (indexOfLetter(used, letter) === -1) {
        used.push(letter);
        return letter;
      }
    }
    return null;
  }
}

/** LogicProgram.reverse. */
export function reverse(s: string): string {
  let r = '';
  for (let i = s.length - 1; i >= 0; i--) r += s.charAt(i);
  return r;
}
