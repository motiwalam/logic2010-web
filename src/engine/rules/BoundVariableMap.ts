/**
 * Port of BoundVariableMap.java: maps a rule schema's bound variables (by name) to the names
 * of the instance's bound variables, and detects variable capture.
 *
 * A java.util.Hashtable whose order is observable (encode() is saved in derivation work), so
 * a JavaHashtable of Strings.
 *
 * renameBinders asks the user to name bound variables it cannot infer when the derivation
 * checker calls it; here that part is renameBindersAsync with a BinderNaming interface that
 * the derivation module implements. Without one (Java: no checker) it names them {1}, {2}, ...
 */
import type { MessageParams } from '../program/Message';
import { IntervalSet } from '../program/IntervalSet';
import { JavaHashtable, javaTrim } from '../util/java';
import { BinderMap } from '../formula/BinderMap';
import type { BoundVariableNames } from '../formula/BoundVariableNames';
import type { Expression, Mislink } from '../formula/Expression';
import { params } from '../formula/messages';
import { SchematicLetter, TermLetter } from '../formula/SchematicLetter';
import { SchemeInstantiation } from '../formula/SchemeInstantiation';
import { SimpleTerm } from '../formula/Expression';

/** What renameBindersAsync needs from the derivation checker (the Java dialog code). */
export interface BinderNaming {
  /**
   * Serial mode without preset answers: the checker reports dererr064, marks the module
   * incomplete and renaming fails (return true to stop).
   */
  refuseDialog(): boolean;
  /**
   * Asks for symbols for the fresh bound variables: "Given the expression <expressionText>
   * please choose symbols for the following bound variables", `pending` holding the letters
   * {1}..{n} (highlights: one layer per letter). Resolves to the instantiation the user
   * entered (TermLetter {i} -> SimpleTerm), or null if cancelled or invalid (the implementation
   * has shown the message: dererr028 and abort on cancel, the panel's error otherwise).
   */
  askNames(expressionText: string, highlights: IntervalSet[], pending: SchemeInstantiation): Promise<SchemeInstantiation | null>;
  /** Shows an error message on the line (dererr060 with <variable name>, dererr061). */
  showError(id: string, params: MessageParams | null): void;
}

export class BoundVariableMap {
  private table = new JavaHashtable<string, string>();
  clashes: Mislink[] | null = null;
  freshCount = 0;

  clone(): BoundVariableMap {
    const copy = new BoundVariableMap();
    copy.table = this.table.clone();
    return copy;
  }

  get size(): number {
    return this.table.size;
  }

  keys(): string[] {
    return [...this.table.keys()];
  }

  lookup(name: string): string | null {
    return this.table.get(name) ?? null;
  }

  /** Maps name to value if value is a simple term (placeholders allowed if the flag is set). */
  assign(name: string, value: string, placeholders = false): boolean {
    if (!SimpleTerm.isSimpleTerm(value, placeholders)) return false;
    this.table.put(name, value);
    return true;
  }

  matchBinders(pattern: Expression, instance: Expression | null, correspondence: BinderMap | number[][]): boolean {
    if (instance == null) return true;
    const corr = Array.isArray(correspondence)
      ? correspondence
      : correspondence.getBinderCorrespondence(pattern, instance);
    const binders = pattern.getBinders();
    const instanceBinders = instance.getBinders();
    for (let j = 0; j < binders.length; j++) {
      const list = corr[j] ?? [];
      for (const l of list) {
        const s = binderVariable(instanceBinders, l);
        const name = binderVariable(binders, j)!;
        const old = this.lookup(name);
        if (old == null) this.assign(name, s);
        else if (old !== s) return false;
      }
    }
    return true;
  }

  /**
   * Names the binders of instance (an instantiation of pattern) from the map; binders with no
   * name get {1}, {2}, ... (freshCount of them). Then checks for variable capture (clashes).
   */
  renameBinders(pattern: Expression, instance: Expression, correspondence: BinderMap | number[][]): boolean {
    const corr = Array.isArray(correspondence) ? correspondence : correspondence.getBinderCorrespondence(pattern, instance);
    const { names } = this.assignNames(pattern, instance, corr);
    return this.finishRename(instance, names, null);
  }

  /** renameBinders as the derivation checker runs it, asking for names it cannot infer. */
  async renameBindersAsync(
    pattern: Expression,
    instance: Expression,
    correspondence: BinderMap | number[][],
    naming: BinderNaming,
  ): Promise<boolean> {
    const corr = Array.isArray(correspondence) ? correspondence : correspondence.getBinderCorrespondence(pattern, instance);
    const binders = pattern.getBinders();
    const patternNames = binders.map((_, j) => binderVariable(binders, j)!);
    for (;;) {
      const { names } = this.assignNames(pattern, instance, corr);
      if (this.freshCount === 0) return this.finishRename(instance, names, naming);
      if (naming.refuseDialog()) return false;
      const pending = new SchemeInstantiation();
      const letters: TermLetter[] = [];
      for (let j = 0; j < this.freshCount; j++) {
        const letter = new TermLetter(SchematicLetter.placeholder(j));
        letters.push(letter);
        pending.addPendingLetter(letter);
      }
      const shown = instance.copy();
      shown.renameBoundVariables(names);
      const text = shown.toString();
      const answer = await naming.askNames(text, BoundVariableMap.highlightLetters(text, 0, this.freshCount), pending);
      if (answer == null) return false;
      this.freshCount = 0;
      for (let k = 0; k < binders.length; k++) {
        if (corr[k] != null && corr[k].length !== 0 && this.lookup(patternNames[k]) == null) {
          const r = answer.getReplacement(letters[this.freshCount++]);
          if (r != null && !this.assign(patternNames[k], r.replacement.symbol)) {
            naming.showError('dererr060', params('variable name', '\\l' + r.replacement.symbol + '\\l'));
            return false;
          }
        }
      }
    }
  }

  private assignNames(pattern: Expression, instance: Expression, corr: number[][]): { names: BoundVariableNames } {
    const binders = pattern.getBinders();
    const names: BoundVariableNames = new Array<string | null>(instance.getBinders().length).fill(null);
    this.freshCount = 0;
    const trial = this.clone();
    for (let i = 0; i < binders.length; i++) {
      const variable = binderVariable(binders, i)!;
      let s = trial.lookup(variable);
      if (s == null) {
        s = SchematicLetter.placeholder(this.freshCount++);
        trial.assign(variable, s, true);
      }
      for (const l of corr[i] ?? []) {
        if (l < 0 || l >= names.length) throw new RangeError('ArrayIndexOutOfBoundsException: ' + l);
        names[l] = s;
      }
    }
    return { names };
  }

  private finishRename(instance: Expression, names: BoundVariableNames, naming: BinderNaming | null): boolean {
    instance.renameBoundVariables(names);
    this.clashes = instance.findMislinkedVariables();
    if (this.clashes != null) {
      if (naming != null) naming.showError('dererr061', null);
      return false;
    }
    return true;
  }

  /** Whether the instantiated pattern (renamed by this map) is identical to instance. */
  matches(pattern: Expression, instance: Expression | null, inst: SchemeInstantiation): boolean {
    const binderMap = new BinderMap();
    const instantiated = pattern.instantiate(inst, binderMap);
    const corr = binderMap.getBinderCorrespondence(pattern, instantiated);
    if (!this.matchBinders(pattern, instance, corr)) return false;
    if (!this.renameBinders(pattern, instantiated, corr)) return false;
    return instantiated.isIdentical(instance);
  }

  /** One layer per placeholder {i+1}..{i+n}: its occurrences in s. */
  static highlightLetters(s: string, from: number, n: number): IntervalSet[] {
    const layers: IntervalSet[] = [];
    for (let k = 0; k < n; k++) {
      const set = new IntervalSet();
      const p = SchematicLetter.placeholder(from + k);
      let l = -1;
      while ((l = s.indexOf(p, l + 1)) !== -1) set.toggleBoundary(l).toggleBoundary(l + p.length);
      layers.push(set);
    }
    return layers;
  }

  coversBinders(e: Expression): boolean {
    const binders = e.getBinders();
    for (let j = 0; j < binders.length; j++) {
      if (this.lookup(binderVariable(binders, j)!) == null) return false;
    }
    return true;
  }

  /** "x:y.z:w" in Hashtable order (saved in work files). */
  encode(): string {
    let s = '';
    let first = true;
    for (const [k, v] of this.table.entries()) {
      s += (first ? '' : '.') + k + ':' + v;
      first = false;
    }
    return s;
  }

  static decode(s: string): BoundVariableMap {
    const map = new BoundVariableMap();
    while (s !== '') {
      const i = s.indexOf('.');
      let part: string;
      if (i === -1) {
        part = s;
        s = '';
      } else {
        part = s.substring(0, i);
        s = s.substring(i + 1);
      }
      const j = part.indexOf(':');
      if (j !== -1) map.assign(javaTrim(part.substring(0, j)), javaTrim(part.substring(j + 1)));
    }
    return map;
  }
}

/** The variable symbol of the i-th binder (Vector.elementAt: an index out of range throws). */
export function binderVariable(binders: readonly Expression[], i: number): string {
  if (i < 0 || i >= binders.length) throw new RangeError('ArrayIndexOutOfBoundsException: ' + i);
  return binders[i].getChild(0)!.getSymbol();
}
