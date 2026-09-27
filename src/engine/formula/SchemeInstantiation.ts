/**
 * Port of SchemeInstantiation.java: a table from SchematicLetter to LetterReplacement (the
 * values of a rule schema's letters), the letters still pending (not determined yet, with the
 * matches deferred until they are), and the last error.
 *
 * The table is a java.util.Hashtable in Java and its order is observable: encode() is saved
 * in derivation work, and several loops take the first letter that fits. So it is a
 * JavaHashtable keyed by the letter's String hash.
 */
import { JavaHashtable } from '../util/java';
import type { BinderMap } from './BinderMap';
import { BinderKey } from './BinderMap';
import { containsMatch, DeferredMatch } from './DeferredMatch';
import { Expression, Formula, SimpleTerm, Term } from './Expression';
import { LetterReplacement } from './LetterReplacement';
import { ErrorRef, type MessageParams, params, putParam } from './messages';
import { FormulaParseException, parseFormula } from './parseFormula';
import { indexOfLetter, type SchematicLetter } from './SchematicLetter';

function newTable(): JavaHashtable<SchematicLetter, LetterReplacement> {
  return new JavaHashtable<SchematicLetter, LetterReplacement>({
    hash: (k) => k.hashCode(),
    equals: (a, b) => a.equals(b),
  });
}

export class SchemeInstantiation {
  private table = newTable();
  pendingLetters: SchematicLetter[] = [];
  errorId: string | null = null;
  errorParams: MessageParams | null = null;

  constructor(other?: SchemeInstantiation) {
    if (other) this.mergeFrom(other);
  }

  /** Hashtable.clone: the same letters and replacement objects; no error. */
  clone(): SchemeInstantiation {
    const copy = new SchemeInstantiation();
    copy.table = this.table.clone();
    copy.pendingLetters = this.pendingLetters.slice();
    return copy;
  }

  get size(): number {
    return this.table.size;
  }

  isEmpty(): boolean {
    return this.table.size === 0;
  }

  /** The letters, in Java's Hashtable order. */
  keys(): SchematicLetter[] {
    return [...this.table.keys()];
  }

  /** The replacements, in Java's Hashtable order. */
  elements(): LetterReplacement[] {
    return [...this.table.values()];
  }

  containsKey(letter: SchematicLetter): boolean {
    return this.table.has(letter);
  }

  get(letter: SchematicLetter | null): LetterReplacement | null {
    return letter == null ? null : (this.table.get(letter) ?? null);
  }

  put(letter: SchematicLetter, replacement: LetterReplacement): void {
    this.table.put(letter, replacement);
  }

  remove(letter: SchematicLetter): LetterReplacement | null {
    return this.table.remove(letter) ?? null;
  }

  mergeFrom(other: SchemeInstantiation | null): boolean {
    let errorId: string | null = null;
    let errorParams: MessageParams | null = null;
    if (other != null) {
      for (const letter of other.keys()) {
        const replacement = other.getReplacement(letter)!;
        if (!this.putReplacement(letter, replacement) && errorId == null) {
          errorId = this.errorId;
          errorParams = this.errorParams;
        }
      }
      const pending = other.pendingLetters;
      for (let k = 0; k < pending.length; k++) {
        const letter = pending[k];
        if (!this.checkDeferredMatches(letter.getDeferredMatches(false)) && errorId == null) {
          errorId = this.errorId;
          errorParams = this.errorParams;
        }
        this.addPendingLetter(letter);
      }
    }
    this.errorId = errorId;
    this.errorParams = errorParams;
    return this.errorId == null;
  }

  clear(): void {
    this.table.clear();
    this.pendingLetters.length = 0;
    this.errorId = null;
    this.errorParams = null;
  }

  getReplacement(letter: SchematicLetter | null): LetterReplacement | null {
    return this.get(letter);
  }

  checkDeferredMatches(matches: DeferredMatch[] | null): boolean {
    if (matches == null) return true;
    // a live loop, like Java's Vector enumeration
    for (let k = 0; k < matches.length; k++) {
      const m = matches[k];
      if (!m.pattern.match(null, m.instance, this, m.binderMap, BinderKey.toVector(m.contextTerms))) {
        this.errorId = 'dererr062';
        this.errorParams = params('pattern', '\\l' + m.pattern + '\\l', 'instance', '\\l' + String(m.instance) + '\\l');
        return false;
      }
    }
    return true;
  }

  putReplacement(letter: SchematicLetter, replacement: LetterReplacement): boolean {
    const old = this.getReplacement(letter);
    if (old == null) {
      let deferred: DeferredMatch[] | null = null;
      const i = indexOfLetter(this.pendingLetters, letter);
      if (i !== -1) {
        deferred = this.pendingLetters[i].getDeferredMatches(false);
        this.pendingLetters.splice(i, 1);
      }
      this.put(letter, replacement);
      if (!this.checkDeferredMatches(deferred)) return false;
    } else if (!old.sameReplacementAs(replacement)) {
      this.errorId = 'dererr073';
      this.errorParams = params(
        'pattern',
        '\\l' + replacement.pattern + '\\l',
        'new replacement',
        '\\l' + replacement.replacement + '\\l',
        'old replacement',
        '\\l' + old.replacement + '\\l',
      );
      return false;
    }
    return true;
  }

  /** Adds pattern -> replacement; the strings are parsed (placeholders allowed). */
  addReplacement(pattern: Expression, replacement: Expression): boolean;
  addReplacement(pattern: string, replacement: string): boolean;
  addReplacement(pattern: Expression | string, replacement: Expression | string): boolean {
    if (typeof pattern === 'string' || typeof replacement === 'string') {
      let text: string | null = null;
      let p: Expression | null;
      let r: Expression | null;
      try {
        text = pattern as string;
        p = parseFormula(pattern as string, true, true);
        text = replacement as string;
        r = parseFormula(replacement as string, true, true);
      } catch (e) {
        if (!(e instanceof FormulaParseException)) throw e;
        this.errorId = 'dererr059';
        this.errorParams = params('parser error', text);
        return false;
      }
      // Java: a blank string parses as null and fails below with a NullPointerException
      return this.addReplacement(p!, r!);
    }
    const lr = new LetterReplacement(pattern, replacement);
    if (lr.error != null) {
      this.errorId = lr.error.id;
      this.errorParams = lr.error.params;
      return false;
    }
    return this.putReplacement(pattern.getSchematicLetter()!, lr);
  }

  /** "pattern:replacement" */
  parseReplacement(s: string): boolean {
    const i = s.indexOf(':');
    if (i === -1) {
      this.errorId = 'dererr059';
      this.errorParams = params('parser error', 'scheme map needs pattern:replacement');
      return false;
    }
    return this.addReplacement(s.substring(0, i), s.substring(i + 1));
  }

  static validateReplacement(pattern: Expression, replacement: Expression): ErrorRef | null {
    const table = params('pattern', '\\l' + pattern + '\\l', 'replacement', '\\l' + replacement + '\\l');
    if (pattern.kind !== 0 && pattern.kind !== 4) {
      if (pattern instanceof SimpleTerm && pattern.isBoundVariable()) return new ErrorRef('dererr067', table);
    } else {
      for (let i = 0; i < pattern.childCount; i++) {
        const arg = pattern.getChild(i);
        if (!(arg instanceof SimpleTerm) || arg.isBoundVariable()) {
          return new ErrorRef('dererr094', putParam(table, 'n', i + 1 + ''));
        }
      }
    }
    switch (pattern.kind) {
      case 0:
        return replacement instanceof Formula ? null : new ErrorRef('dererr068', table);
      case 3:
      case 4:
        if (replacement instanceof SimpleTerm && replacement.isBoundVariable()) return new ErrorRef('dererr069', table);
        return replacement instanceof Term ? null : new ErrorRef('dererr070', table);
      default:
        return new ErrorRef('dererr071', table);
    }
  }

  /** Adds the letter of an expression to the pending letters (false if it has none). */
  addPendingLetter(e: Expression): boolean;
  addPendingLetter(letter: SchematicLetter | null): void;
  addPendingLetter(x: Expression | SchematicLetter | null): boolean | void {
    if (x instanceof Expression) {
      const letter = x.getSchematicLetter();
      if (letter != null) {
        this.addPendingLetter(letter);
        return true;
      }
      if (x instanceof SimpleTerm && x.isBoundVariable()) {
        this.errorId = 'dererr067';
        this.errorParams = params('pattern', '\\l' + x + '\\l');
      } else {
        this.errorId = 'dererr071';
        this.errorParams = params('pattern', '\\l' + x + '\\l');
      }
      return false;
    }
    const letter = x;
    if (letter == null || this.containsKey(letter)) return;
    const i = indexOfLetter(this.pendingLetters, letter);
    if (i === -1) {
      this.pendingLetters.push(letter);
      return;
    }
    const matches = letter.getDeferredMatches(false);
    if (matches != null) {
      const target = this.pendingLetters[i].getDeferredMatches(true)!;
      for (const m of matches) {
        if (!containsMatch(target, m)) target.push(m);
      }
    }
  }

  deferMatch(pattern: Expression, instance: Expression | null, binderMap: BinderMap, contextTerms: SimpleTerm[]): boolean;
  deferMatch(match: DeferredMatch): boolean;
  deferMatch(a: Expression | DeferredMatch, instance?: Expression | null, binderMap?: BinderMap): boolean {
    if (a instanceof Expression) return this.deferMatch(new DeferredMatch(a, instance ?? null, binderMap!));
    const match = a;
    const letter = match.pattern.getSchematicLetter();
    if (letter == null) return false;
    const i = indexOfLetter(this.pendingLetters, letter);
    if (i !== -1) {
      const list = this.pendingLetters[i].getDeferredMatches(true)!;
      if (!containsMatch(list, match)) list.push(match);
    }
    return true;
  }

  getPendingLetters(): SchematicLetter[] {
    return this.pendingLetters;
  }

  hasNoDeferredMatches(): boolean {
    return this.pendingLetters.every((l) => l.getDeferredMatches(false) == null);
  }

  pendingLettersToString(): string {
    let s = '';
    for (const letter of this.pendingLetters) {
      s += (s === '' ? '' : '.') + letter;
      const matches = letter.getDeferredMatches(false);
      if (matches != null && matches.length > 0) s += '[' + matches.map(String).join(', ') + ']';
    }
    return s;
  }

  /** The letters used in e and in the replacements (pending-letter order). */
  collectUsedLetters(e: Expression | null): SchematicLetter[] {
    const used = new SchemeInstantiation();
    if (e != null) e.addPendingLetters(used);
    for (const r of this.elements()) r.replacement.addPendingLetters(used);
    return used.pendingLetters;
  }

  /**
   * Gives each pending letter that has deferred matches a fresh letter; returns an
   * instantiation whose pending letters are the fresh letters.
   *
   * As in Java, the loop looks at the first pending letter each time (pendingLetters[0], not
   * [j]); a replaced letter leaves the list, so this works through the list unless the first
   * letter has no deferred matches.
   */
  assignFreshLetters(e: Expression | null): SchemeInstantiation {
    const used = this.collectUsedLetters(e);
    const n = this.pendingLetters.length;
    const fresh = new SchemeInstantiation();
    for (let j = 0; j < n; j++) {
      const letter = this.pendingLetters[0];
      if (letter.getDeferredMatches(false) != null) {
        const freshLetter = letter.freshLetter(used);
        fresh.addPendingLetter(freshLetter);
        this.addReplacement(letter.toExpression(), freshLetter!.toExpression());
      }
    }
    return fresh;
  }

  getErrorId(): string | null {
    return this.errorId;
  }

  getErrorParams(): MessageParams | null {
    return this.errorParams;
  }

  /** "pattern:replacement.pattern:replacement..." in Hashtable order (saved in work files). */
  encode(): string {
    let s = '';
    let first = true;
    for (const [, r] of this.table.entries()) {
      s += (first ? '' : '.') + r;
      first = false;
    }
    return s;
  }

  static decode(s: string): SchemeInstantiation | null {
    const inst = new SchemeInstantiation();
    while (s !== '') {
      let part: string;
      const i = s.indexOf('.');
      if (i === -1) {
        part = s;
        s = '';
      } else {
        part = s.substring(0, i);
        s = s.substring(i + 1);
      }
      if (!inst.parseReplacement(part)) return null;
    }
    return inst;
  }
}
