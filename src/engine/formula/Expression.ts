/**
 * The expression tree. Port of Expression.java, Formula.java, Term.java, AtomicFormula.java,
 * QuantifiedFormula.java, ConnectiveFormula.java, SimpleTerm.java, OperationTerm.java,
 * DescriptionTerm.java, IdentityFormula.java and MembershipFormula.java (one module, because
 * the base class creates and tests for its subclasses).
 *
 * Every node stores its own symbol ("&", "@", "F", "x", "=", ...) and its children. A
 * SimpleTerm does not know by its name whether it is bound: its `binder` points at the
 * quantifier or description that binds it (or, inside a LetterReplacement, at the letter
 * application whose argument placeholder {i} it is).
 *
 * Printing: formatMinimal drops the parentheses that precedence allows, formatFull puts them
 * around every binary connective. The mode argument controls ~(a=b): -1 (toCanonicalString)
 * always prints a<>b, 0 prints a<>b only if the formula was written that way
 * (displayAsInequality), anything else prints ~a=b.
 */
import {
  defaultVariable,
  findNumberedPlaceholder as findNumberedPlaceholderOf,
  isPredicateLetter,
  operationLetter,
  predicateLetter,
} from '../program/symbols';
import { BinderMap } from './BinderMap';
import { ExpressionPath } from './ExpressionPath';
import type { FormulaParseNode } from './FormulaParseNode';
import { LetterReplacement } from './LetterReplacement';
import { ErrorRef, params, putParam } from './messages';
import { FormulaParseException, parseFormula } from './parseFormula';
import {
  OperationLetter,
  PredicateLetter,
  type SchematicLetter,
  TermLetter,
  indexOfLetter,
  SchematicLetter as SchematicLetterClass,
} from './SchematicLetter';
import { SchemeInstantiation } from './SchemeInstantiation';
import { TruthTableEvaluator } from './TruthTableEvaluator';
import { VariableScope } from './VariableScope';

let nextExpressionId = 0;

/** A pair [expected binder, term] reported by findMislinkedVariables. */
export type Mislink = [Expression | null, SimpleTerm];

export abstract class Expression {
  /** A unique number per node (for identity-keyed tables such as BinderMap). */
  readonly id = ++nextExpressionId;
  symbol: string;
  children: Expression[] = [];
  displayAsInequality = false;

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  /** The kind code (ExpressionKinds). */
  abstract get kind(): number;

  get childCount(): number {
    return this.children.length;
  }

  toString(): string {
    return this.format(true, 0);
  }

  format(minimal: boolean, mode: number): string {
    return minimal ? this.formatMinimal(mode) : this.formatFull(mode);
  }

  toCanonicalString(): string {
    return this.formatMinimal(-1);
  }

  abstract formatMinimal(mode: number): string;

  toFullyParenthesizedString(): string {
    return this.formatFull(1);
  }

  abstract formatFull(mode: number): string;

  usesArgumentParens(): boolean {
    return false;
  }

  layoutDisplayTree(node: FormulaParseNode): void {
    node.children = this.childCount === 0 ? null : [];
    for (let i = 0; i < this.childCount; i++) {
      const child = node.createChild(this.getChild(i)!);
      child.parent = node;
      node.children!.push(child);
    }
  }

  getKind(): number {
    return this.kind;
  }

  getSymbol(): string {
    return this.symbol;
  }

  addChild(e: Expression): void {
    this.children.push(e);
  }

  getChildCount(): number {
    return this.childCount;
  }

  getChild(i: number): Expression | null {
    return i >= 0 && i < this.childCount ? this.children[i] : null;
  }

  indexOfChildSymbol(s: string, from = 0): number {
    let j = from;
    while (j < this.childCount && s !== this.getChild(j)!.symbol) j++;
    return j === this.childCount ? -1 : j;
  }

  /** The subexpression at path; binders (if given) collects the binders passed on the way. */
  getSubexpression(path: ExpressionPath | null, binders: Expression[] | null = null): Expression | null {
    return path == null ? null : this.getSubexpressionAt(path.indexes, 0, path.depth, binders);
  }

  getSubexpressionAt(indexes: readonly number[], i: number, depth: number, binders: Expression[] | null): Expression | null {
    if (i === depth) return this;
    const child = this.getChild(indexes[i]);
    return child == null ? null : child.getSubexpressionAt(indexes, i + 1, depth, binders);
  }

  findOccurrences(e: Expression): ExpressionPath[] {
    const found: ExpressionPath[] = [];
    this.findOccurrencesAt(e, new ExpressionPath(), found);
    return found;
  }

  findOccurrencesAt(e: Expression, path: ExpressionPath, found: ExpressionPath[]): void {
    if (this.isIdentical(e)) {
      found.push(path.clone());
      return;
    }
    for (let i = 0; i < this.childCount; i++) {
      path.push(i);
      this.getChild(i)!.findOccurrencesAt(e, path, found);
      path.depth--;
    }
  }

  findLetterOccurrences(letter: SchematicLetter | null): ExpressionPath[] {
    const found: ExpressionPath[] = [];
    this.findLetterOccurrencesAt(letter, new ExpressionPath(), found);
    return found;
  }

  findLetterOccurrencesAt(letter: SchematicLetter | null, path: ExpressionPath, found: ExpressionPath[]): void {
    if (letter == null) return;
    if (letter.equals(this.getSchematicLetter())) found.push(path.clone());
    for (let i = 0; i < this.childCount; i++) {
      path.push(i);
      this.getChild(i)!.findLetterOccurrencesAt(letter, path, found);
      path.depth--;
    }
  }

  findSymbolOccurrences(s: string): ExpressionPath[] {
    const found: ExpressionPath[] = [];
    this.findSymbolOccurrencesAt(s, new ExpressionPath(), found);
    return found;
  }

  findSymbolOccurrencesAt(s: string, path: ExpressionPath, found: ExpressionPath[]): void {
    if (s === this.symbol) found.push(path.clone());
    for (let i = 0; i < this.childCount; i++) {
      path.push(i);
      this.getChild(i)!.findSymbolOccurrencesAt(s, path, found);
      path.depth--;
    }
  }

  findBoundVariableOccurrences(s: string | null): ExpressionPath[] {
    const found: ExpressionPath[] = [];
    this.findBoundVariableOccurrencesAt(s, new ExpressionPath(), found);
    return found;
  }

  findBoundVariableOccurrencesAt(s: string | null, path: ExpressionPath, found: ExpressionPath[]): void {
    if (s == null) return;
    for (let i = 0; i < this.childCount; i++) {
      path.push(i);
      this.getChild(i)!.findBoundVariableOccurrencesAt(s, path, found);
      path.depth--;
    }
  }

  /** The smallest subtree containing every difference between this and e (null if none). */
  getDifferencePath(e: Expression | null): ExpressionPath | null {
    return this.commonPathPrefix(this.findDifferences(e));
  }

  commonPathPrefix(paths: ExpressionPath[] | null): ExpressionPath | null {
    const n = paths == null ? 0 : paths.length;
    if (n === 0) return null;
    const prefix = paths![0];
    for (let j = 1; j < n; j++) prefix.depth = prefix.commonPrefixLength(paths![j]);
    return prefix;
  }

  findDifferences(e: Expression | null): ExpressionPath[] {
    const found: ExpressionPath[] = [];
    this.findDifferencesAt(e, new ExpressionPath(), found);
    return found;
  }

  private findDifferencesAt(e: Expression | null, path: ExpressionPath, found: ExpressionPath[]): void {
    if (e != null && this.symbol === e.symbol && this.childCount === e.childCount) {
      for (let i = 0; i < this.childCount; i++) {
        path.push(i);
        this.getChild(i)!.findDifferencesAt(e.getChild(i), path, found);
        path.depth--;
      }
    } else {
      found.push(path.clone());
    }
  }

  /** Same symbols and shape (variable links are ignored). */
  isIdentical(e: Expression | null): boolean {
    if (e == null || this.symbol !== e.symbol || this.childCount !== e.childCount) return false;
    for (let i = 0; i < this.childCount; i++) {
      if (!this.getChild(i)!.isIdentical(e.getChild(i))) return false;
    }
    return true;
  }

  isAlphaEquivalent(e: Expression | null, binderMap: BinderMap | null): boolean {
    if (e == null || this.symbol !== e.symbol || this.childCount !== e.childCount) return false;
    for (let i = 0; i < this.childCount; i++) {
      if (!this.getChild(i)!.isAlphaEquivalent(e.getChild(i), binderMap)) return false;
    }
    return true;
  }

  copy(): Expression {
    return this.instantiate(null, null, new BinderMap(), []);
  }

  /**
   * A copy with the letters replaced as inst says (inst null: a plain copy).
   * With context (a letter node whose replacement this is), argument placeholders are
   * replaced by the context's arguments; stack holds the placeholders being expanded.
   */
  instantiate(inst: SchemeInstantiation | null, binderMap?: BinderMap): Expression;
  instantiate(
    context: Expression | null,
    inst: SchemeInstantiation | null,
    binderMap: BinderMap,
    stack: SimpleTerm[],
  ): Expression;
  instantiate(
    a: Expression | SchemeInstantiation | null,
    b?: SchemeInstantiation | BinderMap | null,
    c?: BinderMap,
    d?: SimpleTerm[],
  ): Expression {
    if (d === undefined) {
      return this.instantiateIn(null, a as SchemeInstantiation | null, (b as BinderMap | undefined) ?? new BinderMap(), []);
    }
    return this.instantiateIn(a as Expression | null, b as SchemeInstantiation | null, c!, d);
  }

  abstract instantiateIn(
    context: Expression | null,
    inst: SchemeInstantiation | null,
    binderMap: BinderMap,
    stack: SimpleTerm[],
  ): Expression;

  /** Names the bound variables in binder order (null or "" keeps a name). */
  renameBoundVariables(names: readonly (string | null | undefined)[] | null): void {
    if (names != null) this.renameBoundVariablesFrom(names, 0);
  }

  renameBoundVariablesFrom(names: readonly (string | null | undefined)[], i: number): number {
    for (let j = 0; j < this.childCount; j++) i = this.getChild(j)!.renameBoundVariablesFrom(names, i);
    return i;
  }

  /** The quantifiers and descriptions, in prefix order. */
  getBinders(): Expression[] {
    return this.collectBinders([]);
  }

  collectBinders(binders: Expression[]): Expression[] {
    for (let i = 0; i < this.childCount; i++) this.getChild(i)!.collectBinders(binders);
    return binders;
  }

  getSchematicLetters(): SchematicLetter[] {
    const letters: SchematicLetter[] = [];
    this.collectSchematicLetters(letters);
    return letters;
  }

  collectSchematicLetters(letters: SchematicLetter[]): void {
    for (let i = 0; i < this.childCount; i++) this.getChild(i)!.collectSchematicLetters(letters);
  }

  abstractQuantifiers(used: SchematicLetter[], depth: number, inst: SchemeInstantiation): Expression {
    for (let j = 0; j < this.childCount; j++) {
      this.children[j] = this.getChild(j)!.abstractQuantifiers(used, depth, inst);
    }
    return this;
  }

  /**
   * Replaces each quantified formula or description by a fresh sentence or predicate letter
   * (operation letter for descriptions); subtrees that are truth-functionally equivalent get
   * the same letter.
   */
  toTruthFunctionalForm(): Expression {
    return this.copy().abstractQuantifiers(this.getSchematicLetters(), 0, new SchemeInstantiation());
  }

  expandOutermostQuantifier(size: number, prefix: string): Expression {
    return this.copy().expandQuantifiersIn(size, prefix, false);
  }

  /** For a domain of `size` objects named prefix0, prefix1, ...: @ becomes &, ! becomes |. */
  expandQuantifiers(size: number, prefix: string, all?: boolean): Expression {
    if (all === undefined) return this.copy().expandQuantifiersIn(size, prefix, true);
    return this.expandQuantifiersIn(size, prefix, all);
  }

  expandQuantifiersIn(size: number, prefix: string, all: boolean): Expression {
    if (all) {
      for (let j = 0; j < this.childCount; j++) {
        this.children[j] = this.getChild(j)!.expandQuantifiersIn(size, prefix, true);
      }
    }
    return this;
  }

  containsVariableBoundBy(binder: Expression): boolean {
    for (let i = 0; i < this.childCount; i++) {
      if (this.getChild(i)!.containsVariableBoundBy(binder)) return true;
    }
    return false;
  }

  collectTermSymbols(all: string[] | null, free: string[] | null): void {
    for (let i = 0; i < this.childCount; i++) this.getChild(i)!.collectTermSymbols(all, free);
  }

  getBoundVariableNames(): string[] {
    return this.getBinders().map((b) => b.getChild(0)!.getSymbol());
  }

  isNegationOf(e: Expression | null): boolean {
    return this.kind === 2 && this.symbol === '~' && this.getChild(0)!.isIdentical(e);
  }

  negate(): ConnectiveFormula {
    const negation = new ConnectiveFormula('~');
    negation.addChild(this);
    return negation;
  }

  /** Points each variable at the quantifier or description that binds it. */
  linkVariables(scope?: VariableScope<Expression>): this {
    this.linkVariablesIn(scope ?? new VariableScope<Expression>());
    return this;
  }

  linkVariablesIn(scope: VariableScope<Expression>): void {
    for (let i = 0; i < this.childCount; i++) this.getChild(i)!.linkVariablesIn(scope);
  }

  /** The [expected binder, term] pairs whose link differs from the scoping; null if none. */
  findMislinkedVariables(): Mislink[] | null {
    const found: Mislink[] = [];
    this.findMislinkedVariablesIn(new VariableScope<Expression>(), found);
    return found.length === 0 ? null : found;
  }

  findMislinkedVariablesIn(scope: VariableScope<Expression>, found: Mislink[]): void {
    for (let i = 0; i < this.childCount; i++) this.getChild(i)!.findMislinkedVariablesIn(scope, found);
  }

  isArgumentPlaceholder(): boolean {
    return false;
  }

  isBoundVariable(): boolean {
    return false;
  }

  bindsArguments(): boolean {
    return false;
  }

  linkArgumentPlaceholders(pattern: Expression): void {
    for (let i = 0; i < this.childCount; i++) this.getChild(i)!.linkArgumentPlaceholders(pattern);
  }

  hasUndeclaredPlaceholder(pattern: Expression | null): boolean {
    for (let i = 0; i < this.childCount; i++) {
      if (this.getChild(i)!.hasUndeclaredPlaceholder(pattern)) return true;
    }
    return false;
  }

  /**
   * Matches this pattern against an instance, extending inst. With a context (a letter node
   * whose replacement this is), argument placeholders match the context's arguments. A null
   * instance matches anything (used for letters not determined yet).
   */
  match(instance: Expression | null, inst: SchemeInstantiation, binderMap?: BinderMap): boolean;
  match(
    context: Expression | null,
    instance: Expression | null,
    inst: SchemeInstantiation,
    binderMap: BinderMap,
    stack: SimpleTerm[],
  ): boolean;
  match(
    a: Expression | null,
    b: Expression | SchemeInstantiation | null,
    c?: SchemeInstantiation | BinderMap,
    d?: BinderMap,
    e?: SimpleTerm[],
  ): boolean {
    if (e === undefined) {
      return this.matchIn(null, a, b as SchemeInstantiation, (c as BinderMap | undefined) ?? new BinderMap(), []);
    }
    return this.matchIn(a, b as Expression | null, c as SchemeInstantiation, d!, e);
  }

  matchIn(
    context: Expression | null,
    instance: Expression | null,
    inst: SchemeInstantiation,
    binderMap: BinderMap,
    stack: SimpleTerm[],
  ): boolean {
    if (
      instance == null ||
      (this.kind === instance.kind && this.symbol === instance.symbol && this.childCount === instance.childCount)
    ) {
      for (let i = 0; i < this.childCount; i++) {
        if (!this.getChild(i)!.matchIn(context, instance == null ? null : instance.getChild(i), inst, binderMap, stack)) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  matchLetter(instance: Expression | null, inst: SchemeInstantiation, binderMap: BinderMap, stack: SimpleTerm[]): boolean {
    const letter = this.getSchematicLetter();
    let replacement = inst.getReplacement(letter);
    if (replacement != null) return replacement.replacement.matchIn(this, instance, inst, binderMap, stack);
    if (instance != null) {
      replacement = this.buildReplacement(instance, binderMap, stack);
      if (replacement.error == null) return inst.putReplacement(letter!, replacement);
      const table = replacement.error.params;
      if (table == null || table.get('addMissingKey') == null) {
        inst.errorId = replacement.error.id;
        inst.errorParams = table;
        return false;
      }
    }
    const error = this.checkReplacementType(instance);
    if (error != null) {
      inst.errorId = error.id;
      inst.errorParams = error.params;
      return false;
    }
    return this.addPendingLetters(inst) && inst.deferMatch(this, instance, binderMap, stack);
  }

  checkReplacementType(_replacement: Expression | null): ErrorRef | null {
    return null;
  }

  /**
   * The replacement of this letter node (whose arguments must be bound variables) that gives
   * instance: F(x) with x bound matching G(y)&H(y) gives F({1}) -> G({1})&H({1}).
   */
  buildReplacement(instance: Expression, binderMap: BinderMap, stack: SimpleTerm[]): LetterReplacement {
    const argumentMap = new SchemeInstantiation();
    const instanceMap = new SchemeInstantiation();
    const table = params('pattern', '\\l' + this + '\\l', 'replacement', '\\l' + instance + '\\l');
    for (let i = 0; i < this.childCount; i++) {
      const arg = this.getChild(i)!;
      if (!arg.isBoundVariable()) {
        putParam(table, 'n', i + 1 + '');
        // Java puts this key directly (not lower-cased): Hashtable.put("addMissingKey", "")
        table.set('addMissingKey', '');
        return new LetterReplacement(new ErrorRef('dererr065', table));
      }
      const binder = (arg as SimpleTerm).getBinder()!;
      const counterpart = binderMap.getCounterpart(null, binder, stack)!.getChild(0)!;
      const placeholder = new SimpleTerm(SchematicLetterClass.placeholder(i));
      if (!argumentMap.addReplacement(new SimpleTerm(arg.symbol), placeholder)) {
        putParam(table, 'n', i + 1 + '');
        table.set('addMissingKey', '');
        return new LetterReplacement(new ErrorRef('dererr066', table));
      }
      instanceMap.addReplacement(new SimpleTerm(counterpart.symbol), placeholder);
    }
    const pattern = this.instantiate(argumentMap);
    const replacementExpr = instance.instantiate(instanceMap);
    const replacement = new LetterReplacement(pattern, replacementExpr);
    if (replacement.error == null) {
      putParam(table, 'dummy pattern', pattern + '');
      putParam(table, 'dummy replacement', replacementExpr + '');
      if (instanceMap.getPendingLetters().length !== 0) {
        replacement.error = new ErrorRef('dererr061');
      } else if (replacementExpr.findMislinkedVariables() != null) {
        replacement.error = new ErrorRef('dererr061');
      }
    }
    return replacement;
  }

  getSchematicLetter(): SchematicLetter | null {
    return null;
  }

  /** Adds the letters of this expression to inst's pending letters (all of them, even after a failure). */
  addPendingLetters(inst: SchemeInstantiation): boolean {
    let ok = true;
    for (let i = 0; i < this.childCount; i++) {
      if (!this.getChild(i)!.addPendingLetters(inst)) ok = false;
    }
    return ok;
  }

  isFullyInstantiated(inst: SchemeInstantiation): boolean {
    for (let i = 0; i < this.childCount; i++) {
      if (!this.getChild(i)!.isFullyInstantiated(inst)) return false;
    }
    return true;
  }

  universalClosure(): Expression | null {
    return null;
  }

  getFreeVariables(): string[] {
    const found: string[] = [];
    this.collectFreeVariables(found);
    return found;
  }

  collectFreeVariables(found: string[]): void {
    for (let i = 0; i < this.childCount; i++) this.getChild(i)!.collectFreeVariables(found);
  }
}

export abstract class Formula extends Expression {
  override universalClosure(): Expression {
    let e: Expression = this.copy();
    for (const v of this.getFreeVariables()) {
      const q = new QuantifiedFormula('@');
      q.addChild(new SimpleTerm(v));
      q.addChild(e);
      e = q;
    }
    e.linkVariables();
    return e;
  }
}

export abstract class Term extends Expression {}

/** Children format together; used by AtomicFormula and OperationTerm. */
function formatApplication(e: Expression, format: (child: Expression) => string): string {
  let s = e.symbol;
  const parens = e.childCount > 1 || (e.childCount > 0 && e.usesArgumentParens());
  if (parens) s += '(';
  for (let j = 0; j < e.childCount; j++) s += format(e.getChild(j)!);
  if (parens) s += ')';
  return s;
}

function layoutApplication(e: Expression, node: FormulaParseNode): void {
  node.length = e.symbol.length;
  const n = node.getChildCount();
  for (let j = 0; j < n; j++) {
    const child = node.getChild(j)!;
    child.offset = node.length;
    node.length += child.length;
  }
}

/** Layout of a node shown as child0 symbol child1 (binary connectives, =, [m]). */
function layoutInfix(node: FormulaParseNode, symbolLength: number): void {
  const left = node.getChild(0)!;
  const right = node.getChild(1)!;
  left.offset = 0;
  right.offset = left.offset + left.length + symbolLength;
  node.length = right.offset + right.length;
}

/** Layout of a quantifier or description: symbol variable body. */
function layoutBinder(e: Expression, node: FormulaParseNode): void {
  const variable = node.getChild(0)!;
  const body = node.getChild(1)!;
  variable.offset = e.symbol.length;
  body.offset = variable.offset + variable.length;
  node.length = body.offset + body.length;
}

export class AtomicFormula extends Formula {
  get kind(): number {
    return 0;
  }

  addArgument(t: Term): void {
    this.children.push(t);
  }

  instantiateIn(context: Expression | null, inst: SchemeInstantiation | null, binderMap: BinderMap, stack: SimpleTerm[]): Expression {
    if (context == null && inst != null) {
      const r = inst.getReplacement(this.getSchematicLetter());
      if (r != null) return r.replacement.instantiateIn(this, inst, binderMap, stack);
    }
    const copy = new AtomicFormula(this.symbol);
    for (let i = 0; i < this.childCount; i++) copy.addChild(this.getChild(i)!.instantiateIn(context, inst, binderMap, stack));
    return copy;
  }

  override matchIn(context: Expression | null, instance: Expression | null, inst: SchemeInstantiation, binderMap: BinderMap, stack: SimpleTerm[]): boolean {
    return context != null
      ? super.matchIn(context, instance, inst, binderMap, stack)
      : this.matchLetter(instance, inst, binderMap, stack);
  }

  override checkReplacementType(replacement: Expression | null): ErrorRef | null {
    return replacement != null && !(replacement instanceof Formula)
      ? new ErrorRef('dererr068', params('pattern', '\\l' + this + '\\l', 'replacement', '\\l' + replacement + '\\l'))
      : null;
  }

  override collectSchematicLetters(letters: SchematicLetter[]): void {
    const letter = this.getSchematicLetter();
    if (indexOfLetter(letters, letter) === -1) letters.push(letter);
    super.collectSchematicLetters(letters);
  }

  override getSchematicLetter(): SchematicLetter {
    return new PredicateLetter(this);
  }

  override addPendingLetters(inst: SchemeInstantiation): boolean {
    const a = inst.addPendingLetter(this as Expression);
    const b = super.addPendingLetters(inst);
    return a && b;
  }

  override isFullyInstantiated(inst: SchemeInstantiation): boolean {
    return inst.getReplacement(this.getSchematicLetter()) == null ? false : super.isFullyInstantiated(inst);
  }

  override bindsArguments(): boolean {
    return true;
  }

  static isPredicateLetter(s: string): boolean {
    return isPredicateLetter(s);
  }

  override usesArgumentParens(): boolean {
    return !isPredicateLetter(this.symbol);
  }

  formatMinimal(mode: number): string {
    return formatApplication(this, (c) => c.formatMinimal(mode));
  }

  formatFull(mode: number): string {
    return formatApplication(this, (c) => c.formatFull(mode));
  }

  override layoutDisplayTree(node: FormulaParseNode): void {
    super.layoutDisplayTree(node);
    layoutApplication(this, node);
  }
}

export class QuantifiedFormula extends Formula {
  get kind(): number {
    return 1;
  }

  setVariable(t: SimpleTerm): void {
    this.children.push(t);
  }

  setBody(f: Formula): void {
    this.children.push(f);
  }

  getVariable(): SimpleTerm {
    return this.getChild(0) as SimpleTerm;
  }

  getBody(): Formula {
    return this.getChild(1) as Formula;
  }

  override getSubexpressionAt(indexes: readonly number[], i: number, depth: number, binders: Expression[] | null): Expression | null {
    if (i === depth) return this;
    if (binders != null) binders.push(this);
    const child = this.getChild(indexes[i]);
    return child == null ? null : child.getSubexpressionAt(indexes, i + 1, depth, binders);
  }

  override isAlphaEquivalent(e: Expression | null, binderMap: BinderMap | null): boolean {
    return binderIsAlphaEquivalent(this, e, binderMap);
  }

  instantiateIn(context: Expression | null, inst: SchemeInstantiation | null, binderMap: BinderMap, stack: SimpleTerm[]): Expression {
    const copy = new QuantifiedFormula(this.symbol);
    binderMap.putCounterpart(context, this, stack, copy);
    for (let i = 0; i < this.childCount; i++) copy.addChild(this.getChild(i)!.instantiateIn(context, inst, binderMap, stack));
    return copy;
  }

  override abstractQuantifiers(used: SchematicLetter[], depth: number, inst: SchemeInstantiation): Expression {
    if (!this.getChild(1)!.containsVariableBoundBy(this)) return this.getChild(1)!.abstractQuantifiers(used, depth, inst);
    (this.getChild(0) as SimpleTerm).symbol = SchematicLetterClass.placeholder(depth);
    super.abstractQuantifiers(used, depth + 1, inst);
    let body = this.getChild(1)!;
    let negated = false;
    if (this.symbol === '!') {
      body = body.symbol === '~' ? body.getChild(0)! : body.negate();
      this.children[1] = body;
      this.symbol = '@';
      negated = true;
    }
    let letter: SchematicLetter | null = null;
    body = body.copy();
    for (const key of inst.keys()) {
      if (key instanceof PredicateLetter) {
        const r = inst.getReplacement(key)!;
        if (TruthTableEvaluator.areEquivalent(body, r.replacement.getChild(1)!.copy())) {
          letter = key;
          break;
        }
      }
    }
    if (letter == null) {
      letter = PredicateLetter.freshPredicateLetter(false, depth, used)!;
      if (!inst.addReplacement(letter.toExpression(), this)) throw new Error('could not predicate a quantifier');
    }
    return negated ? letter.toExpression().negate() : letter.toExpression();
  }

  override expandQuantifiersIn(size: number, prefix: string, all: boolean): Expression {
    super.expandQuantifiersIn(size, prefix, all);
    const pattern = new QuantifiedFormula(this.symbol);
    pattern.setVariable(new SimpleTerm(defaultVariable(0)));
    let application = new AtomicFormula(predicateLetter(0));
    application.addArgument(new SimpleTerm(defaultVariable(0)));
    pattern.setBody(application);
    pattern.linkVariables();
    application = new AtomicFormula(predicateLetter(0));
    application.addArgument(new OperationTerm(operationLetter(0)));
    const connective = this.symbol === '!' ? '|' : '&';
    const inst = new SchemeInstantiation();
    pattern.match(this.copy(), inst);
    inst.addReplacement(operationLetter(0), prefix + 0);
    const name = inst.getReplacement(new OperationLetter(operationLetter(0), 0))!;
    let result: Expression = application.instantiate(inst);
    for (let j = 1; j < size; j++) {
      name.replacement.symbol = prefix + j;
      const left = result;
      const right = application.instantiate(inst);
      const c = new ConnectiveFormula(connective);
      c.setLeft(left as Formula);
      c.setRight(right as Formula);
      result = c;
    }
    result.linkVariables();
    return result;
  }

  override collectBinders(binders: Expression[]): Expression[] {
    binders.push(this);
    return super.collectBinders(binders);
  }

  override linkVariablesIn(scope: VariableScope<Expression>): void {
    scope.push(this.getChild(0)!.symbol, this);
    super.linkVariablesIn(scope);
    scope.pop(this.getChild(0)!.symbol);
  }

  override findMislinkedVariablesIn(scope: VariableScope<Expression>, found: Mislink[]): void {
    scope.push(this.getChild(0)!.symbol, this);
    super.findMislinkedVariablesIn(scope, found);
    scope.pop(this.getChild(0)!.symbol);
  }

  override matchIn(context: Expression | null, instance: Expression | null, inst: SchemeInstantiation, binderMap: BinderMap, stack: SimpleTerm[]): boolean {
    return binderMatch(this, context, instance, inst, binderMap, stack);
  }

  formatScope(e: Expression, mode: number): string {
    return e instanceof ConnectiveFormula && e.childCount > 1 ? '(' + e.formatMinimal(mode) + ')' : e.formatMinimal(mode);
  }

  formatMinimal(mode: number): string {
    return this.symbol + this.getChild(0)!.toString() + this.formatScope(this.getChild(1)!, mode);
  }

  formatFull(mode: number): string {
    return this.symbol + this.getChild(0)!.toString() + this.getChild(1)!.formatFull(mode);
  }

  override layoutDisplayTree(node: FormulaParseNode): void {
    super.layoutDisplayTree(node);
    layoutBinder(this, node);
  }
}

function binderIsAlphaEquivalent(self: Expression, e: Expression | null, binderMap: BinderMap | null): boolean {
  if (e == null) return false;
  if (self.kind !== e.kind || self.symbol !== e.symbol || self.childCount !== e.childCount) return false;
  if (binderMap != null) binderMap.putCounterpart(self, e);
  for (let i = 0; i < self.childCount; i++) {
    if (!self.getChild(i)!.isAlphaEquivalent(e.getChild(i), binderMap)) return false;
  }
  return true;
}

function binderMatch(
  self: Expression,
  context: Expression | null,
  instance: Expression | null,
  inst: SchemeInstantiation,
  binderMap: BinderMap,
  stack: SimpleTerm[],
): boolean {
  if (instance != null) {
    if (self.kind !== instance.kind || self.symbol !== instance.symbol || self.childCount !== instance.childCount) return false;
    binderMap.putCounterpart(context, self, stack, instance);
  }
  for (let i = 0; i < self.childCount; i++) {
    if (!self.getChild(i)!.matchIn(context, instance == null ? null : instance.getChild(i), inst, binderMap, stack)) return false;
  }
  return true;
}

export class ConnectiveFormula extends Formula {
  get kind(): number {
    return 2;
  }

  setLeft(f: Formula): void {
    this.children.push(f);
  }

  setRight(f: Formula): void {
    this.children.push(f);
  }

  getLeft(): Formula {
    return this.getChild(0) as Formula;
  }

  getRight(): Formula {
    return this.getChild(1) as Formula;
  }

  instantiateIn(context: Expression | null, inst: SchemeInstantiation | null, binderMap: BinderMap, stack: SimpleTerm[]): Expression {
    const copy = new ConnectiveFormula(this.symbol);
    copy.displayAsInequality = this.displayAsInequality;
    for (let i = 0; i < this.childCount; i++) copy.addChild(this.getChild(i)!.instantiateIn(context, inst, binderMap, stack));
    return copy;
  }

  formatOperand(f: Expression, right: boolean, mode: number): string {
    const s = f.formatMinimal(mode);
    if (!(f instanceof ConnectiveFormula) || f.childCount === 1) return s;
    if (this.childCount !== 1 && this.symbol !== '&' && this.symbol !== '|') {
      return f.symbol !== '->' && f.symbol !== '<->' ? s : '(' + s + ')';
    }
    return !right && this.symbol === f.symbol ? s : '(' + s + ')';
  }

  private showsInequality(mode: number): boolean {
    return (mode === -1 || (mode === 0 && this.displayAsInequality)) && this.symbol === '~' && this.getChild(0)!.symbol === '=';
  }

  formatMinimal(mode: number): string {
    const left = this.getChild(0)!;
    if (this.showsInequality(mode)) {
      return left.getChild(0)!.formatMinimal(mode) + '<>' + left.getChild(1)!.formatMinimal(mode);
    }
    if (this.childCount === 1) return this.symbol + this.formatOperand(left, true, mode);
    return this.formatOperand(left, false, mode) + this.symbol + this.formatOperand(this.getChild(1)!, true, mode);
  }

  formatFull(mode: number): string {
    const left = this.getChild(0)!;
    if (this.showsInequality(mode)) {
      return left.getChild(0)!.formatFull(mode) + '<>' + left.getChild(1)!.formatFull(mode);
    }
    if (this.childCount === 1) return this.symbol + left.formatFull(mode);
    return '(' + left.formatFull(mode) + this.symbol + this.getChild(1)!.formatFull(mode) + ')';
  }

  override layoutDisplayTree(node: FormulaParseNode): void {
    super.layoutDisplayTree(node);
    if (this.displayAsInequality && this.symbol === '~' && this.getChild(0)!.symbol === '=') {
      node.children = node.getChild(0)!.children;
      node.getChild(0)!.parent = node;
      node.getChild(1)!.parent = node;
      layoutInfix(node, '<>'.length);
    } else if (this.childCount === 1) {
      const operand = node.getChild(0)!;
      operand.offset = this.symbol.length;
      node.length = operand.offset + operand.length;
    } else {
      layoutInfix(node, this.symbol.length);
    }
  }

  markAsInequality(): this {
    this.displayAsInequality = true;
    return this;
  }
}

export class SimpleTerm extends Term {
  private binder: Expression | null = null;

  get kind(): number {
    return 3;
  }

  setBinder(e: Expression | null): void {
    this.binder = e;
  }

  hasBinder(): boolean {
    return this.binder != null;
  }

  getBinder(): Expression | null {
    return this.binder;
  }

  override isAlphaEquivalent(e: Expression | null, binderMap: BinderMap | null): boolean {
    if (!(e instanceof SimpleTerm)) return false;
    const otherBinder = e.binder;
    if (this.binder != null) {
      if (otherBinder == null) return false;
      const placeholder = this.isArgumentPlaceholder();
      if (placeholder !== e.isArgumentPlaceholder()) return false;
      if (placeholder) return this.binder.indexOfChildSymbol(this.symbol) === otherBinder.indexOfChildSymbol(e.symbol);
      if (binderMap != null) return binderMap.getCounterpart(this.binder) === otherBinder;
    } else if (otherBinder != null) {
      return false;
    }
    return this.symbol === e.symbol;
  }

  instantiateIn(context: Expression | null, inst: SchemeInstantiation | null, binderMap: BinderMap, stack: SimpleTerm[]): Expression {
    const counterpart = this.binder == null ? null : binderMap.getCounterpart(context, this.binder, stack);
    if (inst != null && context == null && counterpart == null) {
      const letter = new TermLetter(this);
      const r = inst.getReplacement(letter);
      if (r != null) return r.replacement.instantiateIn(this, inst, binderMap, stack);
      if (this.binder != null) inst.addPendingLetter(letter);
    }
    if (this.isArgumentPlaceholder() && context != null) {
      stack.push(this);
      const argument = context.getChild(this.binder!.indexOfChildSymbol(this.symbol))!;
      const result = argument.instantiateIn(null, inst, binderMap, stack);
      stack.pop();
      return result;
    }
    const copy = new SimpleTerm(this.symbol);
    copy.binder = counterpart;
    return copy;
  }

  override findBoundVariableOccurrencesAt(s: string | null, path: ExpressionPath, found: ExpressionPath[]): void {
    if (s != null && this.isBoundVariable() && s === this.symbol) found.push(path.clone());
  }

  override renameBoundVariablesFrom(names: readonly (string | null | undefined)[], i: number): number {
    if (this.binder != null) {
      const variable = this.binder.getChild(0)!;
      if (this === variable && i < names.length) {
        const name = names[i];
        if (name != null && name !== '') this.symbol = name;
        i++;
      } else {
        this.symbol = variable.symbol;
      }
    }
    return i;
  }

  override linkVariablesIn(scope: VariableScope<Expression>): void {
    this.binder = scope.get(this.symbol);
  }

  override findMislinkedVariablesIn(scope: VariableScope<Expression>, found: Mislink[]): void {
    const expected = scope.get(this.symbol);
    if (this.binder !== expected) found.push([expected, this]);
  }

  override linkArgumentPlaceholders(pattern: Expression): void {
    if (this.binder == null && pattern.indexOfChildSymbol(this.symbol) !== -1) this.binder = pattern;
  }

  override hasUndeclaredPlaceholder(pattern: Expression | null): boolean {
    return (
      this.symbol === findNumberedPlaceholderOf(this.symbol) &&
      (pattern == null || pattern.indexOfChildSymbol(this.symbol) === -1)
    );
  }

  override isArgumentPlaceholder(): boolean {
    return this.binder != null && this.binder.bindsArguments();
  }

  override isBoundVariable(): boolean {
    return this.binder != null && !this.binder.bindsArguments();
  }

  /** Whether s parses as a simple term (flag: placeholders allowed). */
  static isSimpleTerm(s: string, placeholders = false): boolean {
    let e: Expression | null;
    try {
      e = parseFormula(s, true, placeholders);
    } catch (err) {
      if (err instanceof FormulaParseException) return false;
      throw err;
    }
    return e instanceof SimpleTerm;
  }

  override collectTermSymbols(all: string[] | null, free: string[] | null): void {
    if (all != null && !all.includes(this.symbol)) all.push(this.symbol);
    if (!this.isBoundVariable() && free != null && !free.includes(this.symbol)) free.push(this.symbol);
  }

  override collectFreeVariables(found: string[]): void {
    if (!this.isBoundVariable() && !found.includes(this.symbol)) found.push(this.symbol);
  }

  override matchIn(context: Expression | null, instance: Expression | null, inst: SchemeInstantiation, binderMap: BinderMap, stack: SimpleTerm[]): boolean {
    if (this.binder == null) {
      if (instance != null) {
        return context == null ? inst.addReplacement(this, instance) : super.matchIn(context, instance, inst, binderMap, stack);
      }
      return context != null || (inst.addPendingLetter(this as Expression) && inst.deferMatch(this, null, binderMap, stack));
    }
    if (this.isArgumentPlaceholder()) {
      stack.push(this);
      const ok = context!.getChild(this.binder.indexOfChildSymbol(this.symbol))!.matchIn(null, instance, inst, binderMap, stack);
      stack.pop();
      return ok;
    }
    return instance == null || (instance instanceof SimpleTerm && instance.getBinder() === binderMap.getCounterpart(context, this.binder, stack));
  }

  override abstractQuantifiers(_used: SchematicLetter[], _depth: number, _inst: SchemeInstantiation): Expression {
    if (this.isBoundVariable()) this.symbol = this.binder!.getChild(0)!.symbol;
    return this;
  }

  override containsVariableBoundBy(binder: Expression): boolean {
    return this.binder === binder;
  }

  override collectSchematicLetters(letters: SchematicLetter[]): void {
    const letter = this.getSchematicLetter();
    if (letter != null && indexOfLetter(letters, letter) === -1) letters.push(letter);
  }

  override getSchematicLetter(): SchematicLetter | null {
    return this.isBoundVariable() ? null : new TermLetter(this);
  }

  override addPendingLetters(inst: SchemeInstantiation): boolean {
    return this.isBoundVariable() ? true : inst.addPendingLetter(this as Expression);
  }

  override isFullyInstantiated(inst: SchemeInstantiation): boolean {
    return this.isBoundVariable() || inst.getReplacement(this.getSchematicLetter()) != null;
  }

  override usesArgumentParens(): boolean {
    return true;
  }

  formatMinimal(_mode: number): string {
    return this.symbol;
  }

  formatFull(_mode: number): string {
    return this.symbol;
  }

  override layoutDisplayTree(node: FormulaParseNode): void {
    super.layoutDisplayTree(node);
    node.length = this.symbol.length;
  }
}

export class OperationTerm extends Term {
  get kind(): number {
    return 4;
  }

  addArgument(t: Term): void {
    this.children.push(t);
  }

  instantiateIn(context: Expression | null, inst: SchemeInstantiation | null, binderMap: BinderMap, stack: SimpleTerm[]): Expression {
    if (context == null && inst != null) {
      const r = inst.getReplacement(this.getSchematicLetter());
      if (r != null) return r.replacement.instantiateIn(this, inst, binderMap, stack);
    }
    const copy = new OperationTerm(this.symbol);
    for (let i = 0; i < this.childCount; i++) copy.addChild(this.getChild(i)!.instantiateIn(context, inst, binderMap, stack));
    return copy;
  }

  override matchIn(context: Expression | null, instance: Expression | null, inst: SchemeInstantiation, binderMap: BinderMap, stack: SimpleTerm[]): boolean {
    return context != null
      ? super.matchIn(context, instance, inst, binderMap, stack)
      : this.matchLetter(instance, inst, binderMap, stack);
  }

  override checkReplacementType(replacement: Expression | null): ErrorRef | null {
    return replacement != null && (!(replacement instanceof Term) || replacement.isBoundVariable())
      ? new ErrorRef('dererr070', params('pattern', '\\l' + this + '\\l', 'replacement', '\\l' + replacement + '\\l'))
      : null;
  }

  override collectSchematicLetters(letters: SchematicLetter[]): void {
    const letter = this.getSchematicLetter();
    if (indexOfLetter(letters, letter) === -1) letters.push(letter);
    super.collectSchematicLetters(letters);
  }

  override getSchematicLetter(): SchematicLetter {
    return new OperationLetter(this);
  }

  override addPendingLetters(inst: SchemeInstantiation): boolean {
    const a = inst.addPendingLetter(this as Expression);
    const b = super.addPendingLetters(inst);
    return a && b;
  }

  override isFullyInstantiated(inst: SchemeInstantiation): boolean {
    return inst.getReplacement(this.getSchematicLetter()) == null ? false : super.isFullyInstantiated(inst);
  }

  override bindsArguments(): boolean {
    return true;
  }

  override usesArgumentParens(): boolean {
    return true;
  }

  formatMinimal(mode: number): string {
    return formatApplication(this, (c) => c.formatMinimal(mode));
  }

  formatFull(mode: number): string {
    return formatApplication(this, (c) => c.formatFull(mode));
  }

  override layoutDisplayTree(node: FormulaParseNode): void {
    super.layoutDisplayTree(node);
    layoutApplication(this, node);
  }
}

export class DescriptionTerm extends Term {
  get kind(): number {
    return 5;
  }

  setVariable(t: SimpleTerm): void {
    this.children.push(t);
  }

  setBody(f: Formula): void {
    this.children.push(f);
  }

  getVariable(): SimpleTerm {
    return this.getChild(0) as SimpleTerm;
  }

  getBody(): Formula {
    return this.getChild(1) as Formula;
  }

  override getSubexpressionAt(indexes: readonly number[], i: number, depth: number, binders: Expression[] | null): Expression | null {
    if (i === depth) return this;
    if (binders != null) binders.push(this);
    const child = this.getChild(indexes[i]);
    return child == null ? null : child.getSubexpressionAt(indexes, i + 1, depth, binders);
  }

  override isAlphaEquivalent(e: Expression | null, binderMap: BinderMap | null): boolean {
    return binderIsAlphaEquivalent(this, e, binderMap);
  }

  instantiateIn(context: Expression | null, inst: SchemeInstantiation | null, binderMap: BinderMap, stack: SimpleTerm[]): Expression {
    const copy = new DescriptionTerm(this.symbol);
    binderMap.putCounterpart(context, this, stack, copy);
    for (let i = 0; i < this.childCount; i++) copy.addChild(this.getChild(i)!.instantiateIn(context, inst, binderMap, stack));
    return copy;
  }

  override abstractQuantifiers(used: SchematicLetter[], depth: number, inst: SchemeInstantiation): Expression {
    if (!this.getChild(1)!.containsVariableBoundBy(this)) return this.getChild(1)!.abstractQuantifiers(used, depth, inst);
    (this.getChild(0) as SimpleTerm).symbol = SchematicLetterClass.placeholder(depth);
    super.abstractQuantifiers(used, depth + 1, inst);
    let letter: SchematicLetter | null = null;
    const body = this.getChild(1)!.copy();
    for (const key of inst.keys()) {
      if (key instanceof OperationLetter) {
        const r = inst.getReplacement(key)!;
        if (TruthTableEvaluator.areEquivalent(body, r.replacement.getChild(1)!.copy())) {
          letter = key;
          break;
        }
      }
    }
    if (letter == null) {
      letter = OperationLetter.freshOperationLetter(depth, used)!;
      if (!inst.addReplacement(letter.toExpression(), this)) throw new Error('could not terminate a descriptive');
    }
    return letter.toExpression();
  }

  override expandQuantifiersIn(size: number, prefix: string, all: boolean): Expression {
    if (all) super.expandQuantifiersIn(size, prefix, true).linkVariables();
    return this;
  }

  override collectBinders(binders: Expression[]): Expression[] {
    binders.push(this);
    return super.collectBinders(binders);
  }

  override linkVariablesIn(scope: VariableScope<Expression>): void {
    scope.push(this.getChild(0)!.symbol, this);
    super.linkVariablesIn(scope);
    scope.pop(this.getChild(0)!.symbol);
  }

  override findMislinkedVariablesIn(scope: VariableScope<Expression>, found: Mislink[]): void {
    scope.push(this.getChild(0)!.symbol, this);
    super.findMislinkedVariablesIn(scope, found);
    scope.pop(this.getChild(0)!.symbol);
  }

  override matchIn(context: Expression | null, instance: Expression | null, inst: SchemeInstantiation, binderMap: BinderMap, stack: SimpleTerm[]): boolean {
    return binderMatch(this, context, instance, inst, binderMap, stack);
  }

  formatScope(e: Expression, mode: number): string {
    return e instanceof ConnectiveFormula && e.childCount > 1 ? '(' + e.formatMinimal(mode) + ')' : e.formatMinimal(mode);
  }

  formatMinimal(mode: number): string {
    return this.symbol + this.getChild(0)!.toString() + this.formatScope(this.getChild(1)!, mode);
  }

  formatFull(mode: number): string {
    return this.symbol + this.getChild(0)!.toString() + this.getChild(1)!.formatFull(mode);
  }

  override layoutDisplayTree(node: FormulaParseNode): void {
    super.layoutDisplayTree(node);
    layoutBinder(this, node);
  }
}

export class IdentityFormula extends Formula {
  get kind(): number {
    return 6;
  }

  setLeft(t: Term): void {
    this.children.push(t);
  }

  setRight(t: Term): void {
    this.children.push(t);
  }

  /** Sorts the two sides by their canonical strings (identity is symmetric here). */
  override abstractQuantifiers(used: SchematicLetter[], depth: number, inst: SchemeInstantiation): Expression {
    super.abstractQuantifiers(used, depth, inst);
    const left = this.getChild(0)!;
    const right = this.getChild(1)!;
    if (left.toCanonicalString() > right.toCanonicalString()) {
      this.children[1] = left;
      this.children[0] = right;
    }
    return this;
  }

  instantiateIn(context: Expression | null, inst: SchemeInstantiation | null, binderMap: BinderMap, stack: SimpleTerm[]): Expression {
    const copy = new IdentityFormula(this.symbol);
    for (let i = 0; i < this.childCount; i++) copy.addChild(this.getChild(i)!.instantiateIn(context, inst, binderMap, stack));
    return copy;
  }

  formatMinimal(mode: number): string {
    return this.getChild(0)!.formatMinimal(mode) + this.symbol + this.getChild(1)!.formatMinimal(mode);
  }

  formatFull(mode: number): string {
    return this.getChild(0)!.formatFull(mode) + this.symbol + this.getChild(1)!.formatFull(mode);
  }

  override layoutDisplayTree(node: FormulaParseNode): void {
    super.layoutDisplayTree(node);
    layoutInfix(node, this.symbol.length);
  }
}

export class MembershipFormula extends Formula {
  get kind(): number {
    return 7;
  }

  setElement(t: Term): void {
    this.children.push(t);
  }

  setSet(t: Term): void {
    this.children.push(t);
  }

  instantiateIn(context: Expression | null, inst: SchemeInstantiation | null, binderMap: BinderMap, stack: SimpleTerm[]): Expression {
    const copy = new MembershipFormula(this.symbol);
    for (let i = 0; i < this.childCount; i++) copy.addChild(this.getChild(i)!.instantiateIn(context, inst, binderMap, stack));
    return copy;
  }

  formatMinimal(mode: number): string {
    return this.getChild(0)!.formatMinimal(mode) + this.symbol + this.getChild(1)!.formatMinimal(mode);
  }

  formatFull(mode: number): string {
    return this.getChild(0)!.formatFull(mode) + this.symbol + this.getChild(1)!.formatFull(mode);
  }

  override layoutDisplayTree(node: FormulaParseNode): void {
    super.layoutDisplayTree(node);
    layoutInfix(node, this.symbol.length);
  }
}
