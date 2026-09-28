/**
 * Port of SymbolInterpretation.java, PredicateInterpretation.java and
 * OperationInterpretation.java (in one file: SymbolInterpretation.parse creates the
 * subclasses): the interpretation of a predicate (its extension) or of an operation or name
 * (its value table) over the universe {0 .. size-1}.
 *
 * Text form (encode / parse), entries separated by '.' in the `=` field:
 * - predicate `F(1){0}{2}` (true of 0 and 2); `P(0){}` true, `P(0)` false;
 * - operation `f(1)1{0}{2};0` (0 and 2 map to 1, everything else to 0); name `a(0)2`.
 * Two interpretations are equal when their names and arities are (whatever their kinds).
 */
import { ExpressionPath } from '../../formula/ExpressionPath';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import { JavaHashtable, javaTrim, parseJavaInt, stringHash } from '../../util/java';

/** A value of the model checker: a truth value, an element, or null (undefined). */
export type InterpretationValue = boolean | number | null;

export abstract class SymbolInterpretation {
  constructor(
    public name: string,
    public arity: number,
  ) {}

  abstract clearValues(): void;
  /** Drops what mentions elements outside {0 .. size-1} (the universe shrank). */
  abstract restrictToUniverse(size: number): void;
  /** The value at the arguments (null for arity 0); throws for the wrong number of arguments. */
  abstract getValue(args: readonly number[] | null): boolean | number;
  /** The text shown next to the symbol's button. */
  abstract describeValues(size: number): string;
  abstract copy(): SymbolInterpretation;

  /** SymbolInterpretation.parse: one entry of the `=` field, or null if it does not parse. */
  static parse(s: string): SymbolInterpretation | null {
    let i = s.indexOf('(');
    if (i === -1) return null;
    const name = s.substring(0, i);
    const s2 = s.substring(i + 1);
    i = s2.indexOf(')');
    if (i === -1) return null;
    const arity = parseJavaInt(s2.substring(0, i));
    if (arity == null) return null;
    s = s2.substring(i + 1);
    const d = new DelimitedTokenizer('\\{,');
    d.setInput(s);
    if (javaTrim(d.nextToken()!) === '') {
      const p = new PredicateInterpretation(name, arity);
      if (p.parseExtension(s)) return p;
    } else {
      const o = new OperationInterpretation(name, arity);
      if (o.parseValueTable(s)) return o;
    }
    return null;
  }

  encode(): string {
    return this.getSignature();
  }

  toString(): string {
    return this.encode();
  }

  getSignature(): string {
    return this.name + '(' + this.arity + ')';
  }

  equals(other: unknown): boolean {
    return other instanceof SymbolInterpretation && other.name === this.name && other.arity === this.arity;
  }

  hashCode(): number {
    return ((this.name == null ? 0 : stringHash(this.name)) + Math.imul(this.arity, 40503)) | 0;
  }

  protected checkArity(args: readonly number[] | null): void {
    if (!(args == null ? this.arity === 0 : args.length === this.arity)) throw new Error('IllegalArgumentException');
  }
}

export class PredicateInterpretation extends SymbolInterpretation {
  /** The tuples the predicate is true of (null: none given). */
  extension: ExpressionPath[] | null = null;

  clearValues(): void {
    this.extension = null;
  }

  copy(): PredicateInterpretation {
    const p = new PredicateInterpretation(this.name, this.arity);
    p.extension = this.extension == null ? null : this.extension.map((e) => e.clone());
    return p;
  }

  parseExtension(s: string): boolean {
    const d = new DelimitedTokenizer('\\{');
    d.setInput(s);
    while (d.getRemaining() != null) {
      const s1 = d.nextToken()!;
      if (javaTrim(s1) !== '') return false;
      while (d.getDelimiter() === '{') {
        const path = ExpressionPath.fromArray(ExpressionPath.parse('{' + d.nextToken()));
        if (path == null || path.depth !== this.arity) return false;
        if (this.extension == null) this.extension = [];
        if (!this.extension.some((e) => e.equals(path))) this.extension.push(path);
      }
    }
    return true;
  }

  restrictToUniverse(size: number): void {
    if (this.extension == null) return;
    this.extension = this.extension.filter((p) => p.toArray().every((k) => k < size));
  }

  override encode(): string {
    return super.encode() + this.encodeExtension();
  }

  encodeExtension(): string {
    return (this.extension ?? []).map(String).join('');
  }

  describeValues(size: number): string {
    if (size === 0) return '';
    if (this.arity === 0) return this.extension != null && this.extension.length !== 0 ? 'True' : 'False';
    const ext = this.extension ?? [];
    let s = '{';
    if (this.arity === 1) {
      ext.forEach((p, j) => (s += (j === 0 ? '' : ', ') + p.toArray()[0]));
    } else {
      ext.forEach((p, j) => {
        const a = p.toArray();
        let t = (j === 0 ? '' : ', ') + '(';
        for (let l = 0; l < this.arity; l++) t += (l === 0 ? '' : ',') + a[l];
        s += t + ')';
      });
    }
    return s + '}';
  }

  getValue(args: readonly number[] | null): boolean {
    this.checkArity(args);
    if (this.extension == null || this.extension.length === 0) return false;
    if (this.arity === 0) return true;
    const p = new ExpressionPath(args!);
    return this.extension.some((e) => e.equals(p));
  }
}

function newValueTable(): JavaHashtable<ExpressionPath, number> {
  return new JavaHashtable<ExpressionPath, number>({ hash: (p) => p.hashCode(), equals: (a, b) => a.equals(b) });
}

export class OperationInterpretation extends SymbolInterpretation {
  /** Tuple -> value (a java.util.Hashtable: its order decides the encoding's order). */
  valueTable: JavaHashtable<ExpressionPath, number> | null = null;
  /** The value of every tuple not in the table (0 when null). */
  defaultValue: number | null = null;

  clearValues(): void {
    this.valueTable = null;
    this.defaultValue = null;
  }

  copy(): OperationInterpretation {
    const o = new OperationInterpretation(this.name, this.arity);
    o.valueTable = this.valueTable == null ? null : this.valueTable.clone();
    o.defaultValue = this.defaultValue;
    return o;
  }

  parseValueTable(s: string): boolean {
    const d = new DelimitedTokenizer('\\{;');
    d.setInput(s);
    while (d.getRemaining() != null) {
      const s1 = d.nextToken()!;
      const value = parseJavaInt(javaTrim(s1));
      if (value == null) return false;
      if (d.getDelimiter() === '{' || this.defaultValue != null) {
        while (d.getDelimiter() === '{') {
          const path = ExpressionPath.fromArray(ExpressionPath.parse('{' + d.nextToken()));
          if (path == null || path.depth !== this.arity) return false;
          if (this.valueTable == null) this.valueTable = newValueTable();
          this.valueTable.put(path, value);
        }
      } else {
        this.defaultValue = value;
      }
    }
    return true;
  }

  restrictToUniverse(size: number): void {
    if (this.defaultValue != null && this.defaultValue >= size) this.defaultValue = null;
    if (this.valueTable == null) return;
    const table = newValueTable();
    for (const [path, value] of this.valueTable) {
      if (value < size && path.toArray().every((k) => k < size)) table.put(path, value);
    }
    this.valueTable = table;
  }

  override encode(): string {
    return super.encode() + this.encodeValueTable();
  }

  encodeValueTable(): string {
    let s = '';
    let any = false;
    if (this.valueTable != null) {
      for (const [value, paths] of OperationInterpretation.groupByValue(this.valueTable)) {
        s += (any ? ';' : '') + value;
        any = true;
        for (const p of paths) s += p.toString();
      }
    }
    if (this.defaultValue != null) s += (any ? ';' : '') + this.defaultValue;
    return s;
  }

  /** groupByValue: value -> its tuples (a Hashtable, in the source table's order). */
  static groupByValue(table: JavaHashtable<ExpressionPath, number>): JavaHashtable<number, ExpressionPath[]> {
    const out = new JavaHashtable<number, ExpressionPath[]>();
    for (const [path, value] of table) {
      let v = out.get(value);
      if (v === undefined) out.put(value, (v = []));
      v.push(path);
    }
    return out;
  }

  describeValues(size: number): string {
    if (size === 0) return '';
    if (this.arity === 0) return this.defaultValue == null ? '0' : String(this.defaultValue);
    let any = false;
    let s = '';
    const a = new Array<number>(this.arity).fill(0);
    let k: number;
    do {
      let t = s + (any ? '; ' : '') + this.name + '(';
      any = true;
      for (let l = 0; l < this.arity; l++) t += (l === 0 ? '' : ',') + a[l];
      s = t + ')=' + this.getValue(a);
      for (k = 0; k < this.arity && ++a[k] === size; k++) a[k] = 0;
    } while (k !== this.arity);
    return s;
  }

  getValue(args: readonly number[] | null): number {
    this.checkArity(args);
    if (this.arity !== 0 && this.valueTable != null) {
      const v = this.valueTable.get(new ExpressionPath(args!));
      return v === undefined ? (this.defaultValue ?? 0) : v;
    }
    return this.defaultValue ?? 0;
  }
}
