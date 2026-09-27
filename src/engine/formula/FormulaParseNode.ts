/**
 * Port of FormulaParseNode.java: a display tree parallel to an expression, recording each
 * node's offset (relative to its parent) and length in the formula text with parentheses and
 * blanks removed ("stripped" text). With the text itself it maps nodes to character ranges in
 * the text as written (getTextRange), checks that the text's parentheses are exactly those the
 * formula needs (isParenthesizationValid), and finds nodes for positions (Parsing, Truth-table
 * and Symbolization modules, rule displays).
 */
import { IntervalSet } from '../program/IntervalSet';
import { translateSymbols } from '../program/symbols';
import { javaTrim } from '../util/java';
import type { BoundVariableMap } from '../rules/BoundVariableMap';
import { HighlightedText } from '../rules/HighlightedText';
import { ConnectiveFormula, type Expression, SimpleTerm } from './Expression';
import { ExpressionPath } from './ExpressionPath';
import { FormulaParseException, parseFormula } from './parseFormula';
import { SchematicLetter } from './SchematicLetter';

const STRIPPED_STRINGS: readonly string[] = ['(', ')', ' '];
const EMPTY_STRINGS: readonly string[] = ['', '', ''];

export class FormulaParseNode {
  parent: FormulaParseNode | null = null;
  expression: Expression | null;
  informal = false;
  identityStyle = 0;
  children: FormulaParseNode[] | null = null;
  offset = 0;
  length = 0;
  text: string | null = null;
  letterRanges: (IntervalSet | null)[] | null = null;
  strippedIndex: number[] | null = null;
  parenDepth: number[] | null = null;

  /**
   * The display tree of an expression (informal: minimal parentheses; identityStyle: the
   * inequality mode of the text, see Expression.format), or of a text, which is parsed
   * (terms allowed; null expression if it does not parse).
   */
  constructor(e: Expression | string | null, informal = false, identityStyle = 0) {
    if (typeof e === 'string') {
      this.expression = FormulaParseNode.parseFormula(e);
      if (this.expression != null) this.expression.layoutDisplayTree(this);
      this.text = e;
      return;
    }
    this.expression = e;
    this.informal = informal;
    this.identityStyle = identityStyle;
    if (e != null) e.layoutDisplayTree(this);
  }

  /** The node for a child expression (used by Expression.layoutDisplayTree). */
  createChild(e: Expression): FormulaParseNode {
    return new FormulaParseNode(e);
  }

  static parseFormula(s: string | null): Expression | null {
    if (s == null) return null;
    try {
      return parseFormula(s, true, false);
    } catch (e) {
      if (e instanceof FormulaParseException) return null;
      throw e;
    }
  }

  getParent(): FormulaParseNode | null {
    return this.parent;
  }

  getExpression(): Expression | null {
    return this.expression;
  }

  getChildCount(): number {
    return this.children == null ? 0 : this.children.length;
  }

  getChild(i: number): FormulaParseNode | null {
    return i >= 0 && this.children != null && i < this.children.length ? this.children[i] : null;
  }

  /** [start, end) of this node in the root's text (null if it cannot be found). */
  getTextRange(): number[] | null {
    const root = this.getRoot(true);
    if (this.expression == null) return [0, this.text!.length];
    return FormulaParseNode.findDisplayRange(
      root.strippedIndex!,
      root.parenDepth!,
      this.getAbsoluteOffset(),
      this.length,
      this.expression instanceof ConnectiveFormula && this.expression.getChildCount() > 1,
    );
  }

  /** One highlight layer per letter: the ranges of the letter's symbol in the text. */
  addLetterRanges(letters: readonly SchematicLetter[] | null): void {
    const n = letters == null ? 0 : letters.length;
    if (n > 0 && this.letterRanges == null) this.letterRanges = [];
    for (let j = 0; j < n; j++) this.letterRanges!.push(FormulaParseNode.rangesOf(this.findLetterNodes(letters![j])));
  }

  /** One highlight layer per fresh bound variable {1}, {2}, ... of the map. */
  addTermRanges(map: BoundVariableMap | null): void {
    const n = map == null ? 0 : map.freshCount;
    if (n > 0 && this.letterRanges == null) this.letterRanges = [];
    for (let j = 0; j < n; j++) {
      this.letterRanges!.push(FormulaParseNode.rangesOf(this.findTermNodes(SchematicLetter.placeholder(j))));
    }
  }

  static rangesOf(nodes: readonly FormulaParseNode[]): IntervalSet {
    const set = new IntervalSet();
    for (const node of nodes) {
      const range = node.getTextRange()!;
      range[1] = range[0] + node.expression!.symbol.length;
      set.toggleBoundaries(range);
    }
    return set;
  }

  toString(): string {
    const range = this.getTextRange()!;
    return this.getRoot().text!.substring(range[0], range[1]);
  }

  toStyledText(): HighlightedText {
    const root = this.getRoot(true);
    const range = this.getTextRange()!;
    return new HighlightedText(root.text, root.letterRanges).substring(range[0], range[1]);
  }

  /** "O" if the node's text is written with the official parentheses, "I" if not, "N" if it does not parse. */
  getNotationCode(): string {
    const s = translateSymbols(this.toString(), [' '], ['']);
    if (s === '') return 'O';
    if (this.expression == null) return 'N';
    return s === this.expression.toFullyParenthesizedString() ? 'O' : 'I';
  }

  /** The tree shape: the child count, then each child's structure, comma-separated. */
  getStructureString(): string {
    if (this.expression == null) return '0';
    const n = this.getChildCount();
    let s = '' + n;
    for (let j = 0; j < n; j++) s += ',' + this.getChild(j)!.getStructureString();
    return s;
  }

  getAbsoluteOffset(): number {
    return this.offset + (this.parent == null ? 0 : this.parent.getAbsoluteOffset());
  }

  getLength(): number {
    return this.length;
  }

  getRange(): IntervalSet {
    return IntervalSet.range(this.getAbsoluteOffset(), this.length);
  }

  /** The node's range in the stripped text minus its children's: its operator symbols. */
  getOperatorRanges(): IntervalSet {
    let set = this.getRange();
    const n = this.children == null ? 0 : this.children.length;
    for (let j = 0; j < n; j++) set = set.subtract(this.getChild(j)!.getRange());
    return set;
  }

  getRoot(prepare = false): FormulaParseNode {
    let node: FormulaParseNode = this;
    while (node.parent != null) node = node.parent;
    if (prepare) node.prepareText();
    return node;
  }

  findNode(e: Expression): FormulaParseNode | null {
    if (this.expression === e) return this;
    const n = this.getChildCount();
    for (let j = 0; j < n; j++) {
      const found = this.getChild(j)!.findNode(e);
      if (found != null) return found;
    }
    return null;
  }

  getPath(): ExpressionPath {
    if (this.parent == null) return new ExpressionPath();
    const path = this.parent.getPath();
    path.push(this.parent.children!.indexOf(this));
    return path;
  }

  findLetterNodes(letter: SchematicLetter): FormulaParseNode[] {
    const found: FormulaParseNode[] = [];
    this.collectLetterNodes(letter, found);
    return found;
  }

  collectLetterNodes(letter: SchematicLetter, found: FormulaParseNode[]): void {
    if (letter.equals(this.expression!.getSchematicLetter())) found.push(this);
    const n = this.getChildCount();
    for (let j = 0; j < n; j++) this.getChild(j)!.collectLetterNodes(letter, found);
  }

  findTermNodes(symbol: string): FormulaParseNode[] {
    const found: FormulaParseNode[] = [];
    this.collectTermNodes(symbol, found);
    return found;
  }

  collectTermNodes(symbol: string, found: FormulaParseNode[]): void {
    if (this.expression instanceof SimpleTerm && this.expression.isBoundVariable() && symbol === this.expression.symbol) {
      found.push(this);
    }
    const n = this.getChildCount();
    for (let j = 0; j < n; j++) this.getChild(j)!.collectTermNodes(symbol, found);
  }

  /** The node for the range [start, end) of the text s (with parentheses and blanks). */
  findNodeForDisplayRange(s: string, start: number, end: number): FormulaParseNode {
    const range = [start, end];
    translateSymbols(s, STRIPPED_STRINGS, EMPTY_STRINGS, range);
    return this.findNodeForRange(range[0], range[1]);
  }

  /** The deepest node containing [start, end) of the stripped text (relative to this node). */
  findNodeForRange(start: number, end: number): FormulaParseNode {
    const n = this.getChildCount();
    for (let l = 0; l < n; l++) {
      const child = this.getChild(l)!;
      if (start >= child.offset && end <= child.offset + child.length) {
        return child.findNodeForRange(start - child.offset, end - child.offset);
      }
    }
    return this;
  }

  /** The deepest node whose text range contains [start, end) (proper: not equal to it). */
  findNodeContaining(start: number, end: number, proper = false): FormulaParseNode {
    const n = this.getChildCount();
    for (let l = 0; l < n; l++) {
      const child = this.getChild(l)!;
      const range = child.getTextRange()!;
      if (range[0] <= start && end <= range[1] && (!proper || range[0] !== start || end !== range[1])) {
        return child.findNodeContaining(start, end, proper);
      }
    }
    return this;
  }

  prepareText(): void {
    if (this.text == null) this.text = this.expression == null ? '' : this.expression.format(this.informal, this.identityStyle);
    if (this.strippedIndex == null) this.strippedIndex = FormulaParseNode.computeStrippedIndex(this.text);
    if (this.parenDepth == null) this.parenDepth = FormulaParseNode.computeParenDepth(this.text);
  }

  /** For each position of s (and its end), the position in s without parentheses and blanks. */
  static computeStrippedIndex(s: string): number[] {
    const n = s.length + 1;
    const index: number[] = [];
    for (let j = 0; j < n; j++) index.push(j);
    translateSymbols(s, STRIPPED_STRINGS, EMPTY_STRINGS, index);
    return index;
  }

  /** For each position of s (and its end), the parenthesis depth before it. */
  static computeParenDepth(s: string): number[] {
    const n = s.length + 1;
    const depth = [0];
    for (let j = 1; j < n; j++) {
      const k = '()'.indexOf(s.charAt(j - 1));
      depth.push(k === 0 ? depth[j - 1] + 1 : k === 1 ? depth[j - 1] - 1 : depth[j - 1]);
    }
    return depth;
  }

  /**
   * The range [start, end) of the text for the stripped range [offset, offset + length), at
   * one parenthesis depth; widened to the enclosing parentheses if `widen`. Null if there is
   * no such range.
   */
  static findDisplayRange(s: string, offset: number, length: number, widen: boolean): number[] | null;
  static findDisplayRange(
    stripped: readonly number[],
    depth: readonly number[],
    offset: number,
    length: number,
    widen: boolean,
  ): number[] | null;
  static findDisplayRange(
    a: string | readonly number[],
    b: readonly number[] | number,
    c: number | boolean,
    d?: number | boolean,
    e?: boolean,
  ): number[] | null {
    if (typeof a === 'string') {
      return FormulaParseNode.findDisplayRange(
        FormulaParseNode.computeStrippedIndex(a),
        FormulaParseNode.computeParenDepth(a),
        b as number,
        c as number,
        d as boolean,
      );
    }
    const stripped = a;
    const depth = b as readonly number[];
    const start = c as number;
    const end = start + (d as number);
    let k = stripped.length;
    let j1 = 1;
    while (j1 < k && stripped[j1] <= start) j1++;
    j1--;
    k--;
    let k1 = j1;
    while (k1 < k && stripped[k1] < end) k1++;
    let min = depth[j1];
    for (let i = j1 + 1; i <= k1; i++) if (depth[i] < min) min = depth[i];
    while (j1 > 0 && depth[j1] > min) j1--;
    while (k1 < k && depth[k1] > min) k1++;
    if (depth[j1] === min && depth[k1] === min && stripped[j1] === start && stripped[k1] === end) {
      const range = [j1, k1];
      if (e) FormulaParseNode.widenToParens(stripped, depth, range);
      return range;
    }
    return null;
  }

  static convertRanges(stripped: readonly number[], depth: readonly number[], set: IntervalSet, widen: boolean): void {
    if (set.inverted) return;
    for (let i = 0; i < set.count - 1; i += 2) {
      const range = FormulaParseNode.findDisplayRange(stripped, depth, set.boundaries[i], set.boundaries[i + 1] - set.boundaries[i], widen);
      if (range != null) {
        set.boundaries[i] = range[0];
        set.boundaries[i + 1] = range[1];
      }
    }
  }

  /**
   * Widens range to take in the parentheses around it; returns how many pairs it took in.
   * (Java: a null range throws a NullPointerException; so does this.)
   */
  static widenToParens(stripped: readonly number[], depth: readonly number[], range: number[] | null): number {
    let i = range![0];
    let j = range![1];
    const k = stripped.length - 1;
    const l = stripped[i];
    const i1 = stripped[j];
    const j1 = depth[i];
    let k1 = j1;
    for (;;) {
      while (i > 0 && depth[i - 1] === k1 && stripped[i - 1] === l) i--;
      while (j < k && depth[j + 1] === k1 && stripped[j + 1] === i1) j++;
      if (k1 <= 0 || i <= 0 || depth[i - 1] !== k1 - 1 || j >= k || depth[j + 1] !== k1 - 1) {
        while (i < j && depth[i + 1] === k1 && stripped[i + 1] === l) i++;
        while (j > i && depth[j - 1] === k1 && stripped[j - 1] === i1) j--;
        range![0] = i;
        range![1] = j;
        return j1 - k1;
      }
      i--;
      j++;
      k1--;
    }
  }

  /** Whether the text's parentheses are exactly those the formula needs (blank text: yes). */
  isParenthesizationValid(): boolean {
    if (this.text == null || javaTrim(this.text) === '') return true;
    this.prepareText();
    return this.checkParenthesization(this.strippedIndex!, this.parenDepth!);
  }

  checkParenthesization(stripped: readonly number[], depth: readonly number[]): boolean {
    if (this.expression == null) return this.text == null || javaTrim(this.text) === '';
    let pairs = FormulaParseNode.widenToParens(
      stripped,
      depth,
      FormulaParseNode.findDisplayRange(stripped, depth, this.getAbsoluteOffset(), this.length, false),
    );
    const parent = this.parent;
    if (parent != null && parent.expression!.usesArgumentParens() && parent.getChildCount() === 1) pairs--;
    if (pairs < 0) return false;
    const symbol = this.expression.symbol;
    if (symbol === '->' || symbol === '<->') {
      if (parent == null ? pairs > 1 : pairs !== 1) return false;
    } else if (symbol === '&' || symbol === '|') {
      if (parent == null) {
        if (pairs > 1) return false;
      } else if (parent.expression!.symbol === '->' || parent.expression!.symbol === '<->') {
        if (pairs > 1) return false;
      } else if (parent.expression!.symbol === symbol && parent.getChild(0) === this) {
        if (pairs > 1) return false;
      } else if (pairs !== 1) {
        return false;
      }
    } else if (pairs !== 0) {
      return false;
    }
    const n = this.getChildCount();
    for (let k = 0; k < n; k++) {
      if (!this.getChild(k)!.checkParenthesization(stripped, depth)) return false;
    }
    return true;
  }
}
