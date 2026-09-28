/**
 * Port of SymbolizationNode.java (and the model parts of SymbolizationConnectivePanel.java
 * and SymbolizationTextPanel.java): one node of a symbolization tree.
 *
 * A node holds a piece of English (`text`, what its text pane shows) and a connective
 * (`connective`, one of the SymbolizationConstants kinds). The connective decides the
 * node's children (the parts the student fills in) and its connective panel (the symbol,
 * with a bound variable or an atomic expression as its `label`, and the "Error" buttons a
 * check puts there). The root node also carries the problem's metadata (name, statement,
 * scheme, answer keys, answers, answer group).
 *
 * The node is a plain model. A UI drives it through setConnective / setText / normalizeText
 * and listens to its host (LPSymbolizer), which every change notifies (treeChanged).
 * Where the desktop asks the user for a symbol (a bound variable, an atomic expression),
 * setConnective takes an `ask` callback; symbolPrompt tells beforehand whether it will ask,
 * so a UI can ask asynchronously and pass the answer (see LPSymbolizer.applyConnective).
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { BinderMap } from '../../formula/BinderMap';
import { ConnectiveFormula, type Expression, Formula, QuantifiedFormula, SimpleTerm, Term } from '../../formula/Expression';
import { ExpressionPath } from '../../formula/ExpressionPath';
import { FormulaParseException, parseFormula } from '../../formula/parseFormula';
import { TruthTableEvaluator } from '../../formula/TruthTableEvaluator';
import { Message, type MessageParams } from '../../program/Message';
import { symModule } from '../../program/ModuleConstants';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import type { ProblemEntry } from '../../problems/ProblemEntry';
import { STATE_CORRECT, STATE_INCORRECT } from '../../problems/ProblemEntry';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import type { JavaHashtable } from '../../util/java';
import { javaTrim, parseJavaInt } from '../../util/java';
import type { AnswerSet } from './AnswerSet';
import { ChildRecordSnapshot } from './ChildRecordSnapshot';
import {
  connArgTypes,
  connOutTypes,
  connSymbol,
  connWords,
  expTypes,
  isBinderKind,
  SYMBOLIC,
  TYPE_ANY,
  TYPE_TERM,
} from './SymbolizationConstants';
import { SymbolizationError } from './SymbolizationError';
import { getProblemStatement, hasWork } from './SymbolizationRecords';
import { collapseWhitespace, escapeEnglish, unescapeEnglish } from './SymbolizationText';

/** Something the engine tells the user (a message dialog on the desktop). */
export type SymbolizationNotice =
  /** A message of the symbolization catalogue (SymbolizationDialogs.showMessage). */
  | { kind: 'message'; message: Message; params: MessageParams | null }
  /** A plain message (MessageDialog.showMessage(title, text)); text may hold \l and \n escapes. */
  | { kind: 'text'; title: string; text: string };

/** The problem set as the node uses it (SymbolizationProblemSet). */
export interface SymbolizationProblemSetLike {
  getRecord(name: string | null): string | null;
  getEntry(name: string | null): ProblemEntry | null;
  answerGroups: Map<string, AnswerSet[]> | null;
}

/** The module's tables (LPSymbolizer's static fields): per workspace. */
export interface SymbolizationData {
  exercises: SymbolizationProblemSetLike | null;
  problems: SymbolizationProblemSetLike | null;
  /** The official answer table (symbolization-answers.rec), by answer key. */
  answers: Map<string, string> | null;
  /** The answers of user problems (the work file symbolization-answers.rec), by key. */
  userKey: JavaHashtable<string, string> | null;
  /** equCounts: whether an equivalent answer counts as correct for the problem. */
  equivalentCounts(problemName: string | null): boolean;
  /** Messages shown by nodes that belong to no open problem. */
  notify(notice: SymbolizationNotice): void;
}

/** The open problem a tree belongs to (the LPSymbolizer of the desktop). */
export interface SymbolizationHost {
  readonly data: SymbolizationData;
  errorMessagesDisabled: boolean;
  errorCount: number;
  hintCount: number;
  problem: SymbolizationNode;
  notify(notice: SymbolizationNotice): void;
  /** Called after every change of the tree (updateSymbolization / repaintTree). */
  treeChanged(): void;
}

/** A node's connective panel: the connective symbol, its label, and error buttons. */
export class ConnectivePanel {
  /** The error button the panel knows (clearError removes it). */
  errorButton: SymbolizationError | null = null;
  /** Every error button shown on the panel, in order (hint errors are not cleared). */
  readonly buttons: SymbolizationError[] = [];

  constructor(
    readonly connective: number,
    readonly label: string | null,
  ) {}

  /** The connective as displayed (the program's symbols). */
  get symbolText(): string | null {
    return this.connective === SYMBOLIC ? null : translateSymbols(connSymbol[this.connective], maggie, symbols);
  }

  /** The label as displayed. */
  get labelText(): string | null {
    return translateSymbols(this.label, maggie, symbols);
  }

  addButton(button: SymbolizationError, known: boolean): void {
    this.buttons.push(button);
    if (known) this.errorButton = button;
  }

  clearError(): void {
    if (this.errorButton != null) {
      const i = this.buttons.indexOf(this.errorButton);
      if (i !== -1) this.buttons.splice(i, 1);
      this.errorButton = null;
    }
  }
}

/** Listener of matchTree (NodeMatchListener.java). */
export interface NodeMatchListener {
  nodeMatched(node: SymbolizationNode, answer: SymbolizationNode, binders: string[], answerBinders: string[]): void;
  nodeMismatched(node: SymbolizationNode, answer: SymbolizationNode, binders: string[], answerBinders: string[]): void;
}

let nextNodeId = 0;

export class SymbolizationNode {
  /** A unique id (for UI keys). */
  readonly id = ++nextNodeId;
  host: SymbolizationHost | null;
  data: SymbolizationData | null;
  parent: SymbolizationNode | null = null;
  /** 1: shows "(" before the text (left operand), -1: ")" after it (right operand), 0: neither. */
  readonly parenSide: number;
  /** The text pane's text. */
  text: string;
  connective = 0;
  outType: number;
  argTypes: number[];
  children: SymbolizationNode[] = [];
  panel: ConnectivePanel | null = null;
  problemName: string | null = null;
  originalName: string | null = null;
  scheme: string | null = null;
  answerKeys: string | null = null;
  statement: string | null = null;
  answers: string[] | null = null;
  answerGroup: AnswerSet[] | null = null;
  userAnswerKey = true;

  constructor(host: SymbolizationHost | null, data: SymbolizationData | null = host?.data ?? null, parenSide = 0) {
    this.host = host;
    this.data = data;
    this.parenSide = parenSide;
    this.outType = connOutTypes[0];
    this.argTypes = [...connArgTypes[0]];
    this.text = collapseWhitespace('');
  }

  private changed(): void {
    this.host?.treeChanged();
  }

  private notify(notice: SymbolizationNotice): void {
    if (this.host != null) this.host.notify(notice);
    else this.data?.notify(notice);
  }

  private showMessage(id: string, params: MessageParams | null = null): void {
    this.notify({ kind: 'message', message: Message.getModule(symModule, id), params });
  }

  // ---- text ----

  /** textPane.setText: the text as typed (not collapsed). */
  setText(s: string): void {
    this.text = s;
    this.changed();
  }

  /** SymbolizationTextPanel.normalizeText: collapses the text's whitespace (moving the selection). */
  normalizeText(selection: number[] | null = null): void {
    this.text = collapseWhitespace(this.text, selection);
    this.changed();
  }

  /** setEnglishText: the English of a record ("\n" escapes a newline), collapsed. */
  setEnglishText(s: string | null): void {
    this.setText(collapseWhitespace(unescapeEnglish(s)));
  }

  /** getEnglishText: the collapsed text with newline and backslash escaped, as records hold it. */
  getEnglishText(): string {
    return escapeEnglish(this.text);
  }

  isModified(): boolean {
    return this.connective !== 0 ? true : this.getEnglishText() !== collapseWhitespace(this.statement);
  }

  // ---- structure ----

  getConnectivePanel(): ConnectivePanel | null {
    return this.panel;
  }

  getLabel(): string | null {
    return this.panel == null ? null : this.panel.label;
  }

  getChildNode(i: number): SymbolizationNode | null {
    return this.children[i] ?? null;
  }

  indexOfChildNode(node: SymbolizationNode): number {
    return this.children.indexOf(node);
  }

  getParentNode(): SymbolizationNode | null {
    return this.parent;
  }

  getConnective(): number {
    return this.connective;
  }

  getNodeCode(): string {
    let s = connSymbol[this.connective];
    const i = '*@!%'.indexOf(s);
    if (i !== -1) s += this.getConnectivePanel()!.label;
    if (i === 0) s = DelimitedTokenizer.escape(s, '\\{') + ExpressionPath.format(this.argTypes) + this.outType;
    return s;
  }

  /** The nodes of the tree in pre-order. */
  preorder(out: SymbolizationNode[] = []): SymbolizationNode[] {
    out.push(this);
    for (const c of this.children) c.preorder(out);
    return out;
  }

  /** The child indexes from the root to this node. */
  path(): number[] {
    const out: number[] = [];
    let n: SymbolizationNode = this;
    while (n.parent != null) {
      out.unshift(n.parent.children.indexOf(n));
      n = n.parent;
    }
    return out;
  }

  nodeAt(path: readonly number[]): SymbolizationNode | null {
    let n: SymbolizationNode | null = this;
    for (const i of path) n = n?.getChildNode(i) ?? null;
    return n;
  }

  clearNode(): void {
    this.setConnective(0, null, false);
    this.problemName = null;
    this.originalName = null;
    this.scheme = null;
    this.answerKeys = null;
    this.statement = null;
    this.answers = null;
    this.answerGroup = null;
    this.userAnswerKey = true;
    this.text = '';
    this.normalizeText();
  }

  /**
   * The prompt setConnective would show to ask for the symbol ("Bound Variable:" or
   * "Atomic Expression:"), or null if it would not ask.
   */
  symbolPrompt(kind: number, label: string | null): string | null {
    if (label != null) return null;
    if (isBinderKind(kind)) {
      return kind !== this.connective && this.suggestBoundVariable() != null ? null : 'Bound Variable:';
    }
    return kind === SYMBOLIC ? 'Atomic Expression:' : null;
  }

  /**
   * setConnective(kind, label, showErrors): makes the node a node of the kind. For a binder
   * the label is the bound variable (a fresh one is suggested when the kind changes); for an
   * atomic node it is the expression, optionally with an explicit "{argTypes}outType"
   * (a '{' of the expression itself is escaped with a backslash). ask supplies the symbol
   * when the desktop would ask the user (returning null cancels); the answer is as typed,
   * in the program's display symbols.
   *
   * Returns the node to focus next: the first child (or the node), this node if nothing
   * changed, null when the kind was refused (symnot010 / symnot011, shown if showErrors) or
   * when the old children were restored.
   */
  setConnective(
    i: number,
    s: string | null,
    flag: boolean,
    ask: (prompt: string) => string | null = () => null,
  ): SymbolizationNode | null {
    let j: number;
    let aint: number[];
    switch (i) {
      case 6:
      case 7:
      case 8:
        if (i !== this.connective && s == null) s = this.suggestBoundVariable();
        if (s == null) s = askForSymbol(ask, 'Bound Variable:');
        if (s == null || s === '' || (this.connective === i && s === this.getLabel())) return this;
        s = javaTrim(s);
        j = connOutTypes[i];
        aint = [...connArgTypes[i]];
        break;
      case 11: {
        const d = new DelimitedTokenizer('\\{');
        if (s == null) s = d.escape(askForSymbol(ask, 'Atomic Expression:'));
        if (s != null) s = javaTrim(s);
        if (s == null || s === '' || (this.connective === i && s === this.getLabel())) return this;
        d.setInput(s);
        s = javaTrim(d.nextToken()!);
        j = 0;
        let typed: number[] | null = null;
        if (d.getDelimiter() === '{') {
          const s1 = '{' + d.getRemaining();
          const k = s1.indexOf('}');
          if (k !== -1) {
            const n = parseJavaInt(s1.substring(k + 1));
            if (n != null) {
              j = n;
              typed = ExpressionPath.parse(s1.substring(0, k + 1));
            }
          }
        }
        if (typed == null) {
          try {
            const e = parseFormula(s, true, false);
            j = e instanceof Term ? 1 : 0;
          } catch (err) {
            if (!(err instanceof FormulaParseException)) throw err;
            if (flag) this.showMessage('symnot010', Message.putParam(null, 'source', s));
            return null;
          }
          aint = [...connArgTypes[i]];
        } else {
          aint = typed;
        }
        break;
      }
      default:
        if (this.connective === i) return this;
        j = connOutTypes[i];
        aint = [...connArgTypes[i]];
    }

    if (j !== TYPE_ANY) {
      const parent = this.getParentNode();
      if (parent != null) {
        const l = parent.argTypes.length;
        let j1: number;
        for (j1 = 0; j1 < l; j1++) {
          if (parent.getChildNode(j1) === this) {
            if (parent.argTypes[j1] !== j) {
              let s2 = 'Formula or term';
              if (parent.argTypes[j1] < expTypes.length) s2 = expTypes[parent.argTypes[j1]];
              if (flag) this.showMessage('symnot011', Message.putParam(null, 'type', s2.toLowerCase()));
              return null;
            }
            break;
          }
        }
        if (j1 === l) this.showMessage('could not find child');
      }
    }

    const snapshot = this.argTypes.length !== 0 && aint.length !== 0 ? new ChildRecordSnapshot(this) : null;
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.panel = null;
    let next: SymbolizationNode | null = this;
    this.outType = j;
    this.argTypes = aint;
    this.connective = i;
    const child = (parenSide = 0): SymbolizationNode => {
      const c = new SymbolizationNode(this.host, this.data, parenSide);
      c.parent = this;
      this.children.push(c);
      return c;
    };
    switch (i) {
      case 0:
        this.text = collapseWhitespace(this.text);
        break;
      case 1:
        this.panel = new ConnectivePanel(i, null);
        next = child();
        break;
      case 2:
      case 3:
      case 4:
      case 5:
        next = child(1);
        this.panel = new ConnectivePanel(i, null);
        child(-1);
        break;
      case 6:
      case 7:
      case 8:
        this.panel = new ConnectivePanel(i, s);
        next = child();
        break;
      case 9:
      case 10:
        next = child();
        this.panel = new ConnectivePanel(i, null);
        child();
        break;
      case 11:
        this.panel = new ConnectivePanel(i, s);
        // (an atomic node never has child nodes, whatever its argument types say)
        next = this.argTypes.length === 0 ? this : this.getChildNode(0);
        this.text = collapseWhitespace(this.text);
        break;
    }
    if (snapshot != null) {
      snapshot.restore(this);
      next = null;
    }
    this.changed();
    return next;
  }

  /**
   * The first of xyzuvwlmnopqrst that no enclosing binder uses; null when a child already
   * contains a binder (or none is left).
   */
  suggestBoundVariable(): string | null {
    for (let j = 0; j < this.argTypes.length; j++) {
      if (this.getChildNode(j)?.containsBinder()) return null;
    }
    let s1 = 'xyzuvwlmnopqrst';
    let n: SymbolizationNode | null = this;
    while ((n = n.getParentNode()) != null) {
      if (n.isBinder()) {
        const k = s1.indexOf(n.getLabel()!);
        if (k !== -1) s1 = s1.substring(0, k) + s1.substring(k + 1);
      }
    }
    return s1.length === 0 ? null : s1.substring(0, 1);
  }

  containsBinder(): boolean {
    if (this.isBinder()) return true;
    for (let j = 0; j < this.argTypes.length; j++) {
      if (this.getChildNode(j)?.containsBinder()) return true;
    }
    return false;
  }

  isBinder(): boolean {
    return isBinderKind(this.connective);
  }

  static isBinder(kind: number): boolean {
    return isBinderKind(kind);
  }

  isLowercaseTerm(): boolean {
    if (this.connective === 11 && this.outType === 1 && this.argTypes.length === 0) {
      const s = this.getLabel();
      return s != null && s.length !== 0 ? s === s.toLowerCase() : false;
    }
    return false;
  }

  // ---- the formula built so far ----

  /** The formula built so far, in the program's symbols (English for unanalysed parts). */
  toString(): string {
    const symbol = translateSymbols(connSymbol[this.connective], maggie, symbols);
    const label = translateSymbols(this.getLabel(), maggie, symbols);
    const c = (k: number): string => String(this.getChildNode(k));
    switch (this.connective) {
      case 0:
        return this.getEnglishText();
      case 1:
        return symbol + c(0);
      case 2:
      case 3:
      case 4:
      case 5:
        return '(' + c(0) + ' ' + symbol + ' ' + c(1) + ')';
      case 6:
      case 7:
      case 8:
        return symbol + label + ' ' + c(0);
      case 9:
      case 10:
        return c(0) + ' ' + symbol + ' ' + c(1);
      case 11: {
        const n = this.argTypes.length;
        const parens = n > 1 || (this.outType === 1 && n > 0);
        let s = parens ? label + '(' : String(label);
        for (let j = 0; j < n; j++) s += c(j);
        if (parens) s += ')';
        return s;
      }
      default:
        return '';
    }
  }

  toExpression(): Expression | null {
    if (this.isIncomplete()) return null;
    try {
      return parseFormula(translateSymbols(this.toString(), symbols, maggie));
    } catch (err) {
      if (err instanceof FormulaParseException) return null;
      throw err;
    }
  }

  // ---- records ----

  /** toRecord(asProblem): the node's fields; asProblem adds the problem's metadata. */
  toRecord(flag: boolean): string {
    let s = '';
    const s1 = this.getEnglishText();
    if (flag) {
      s += TaggedRecord.formatField(this.problemName, '$');
      s += TaggedRecord.formatField(this.statement, '-');
      s += TaggedRecord.formatField(this.originalName, 'o');
      if (this.userAnswerKey && this.originalName == null) {
        s += TaggedRecord.formatField(this.scheme, '=');
        s += TaggedRecord.formatField(this.answerKeys, '@');
      }
    }
    if (!flag || this.connective !== 0 || s1 !== collapseWhitespace(this.statement)) {
      s += TaggedRecord.formatField(DelimitedTokenizer.escape(this.getNodeCode(), '\\:') + ':' + s1, '+');
    }
    const n = connArgTypes[this.connective].length;
    for (let j = 0; j < n; j++) s += this.getChildNode(j)!.toRecord(false);
    return s;
  }

  /** loadRecord(record, asProblem = true, clear = true). */
  loadRecord(t: TaggedRecord, flag = true, flag1 = true): void {
    if (flag1) this.clearNode();
    this.statement = getProblemStatement(t);
    let indexes = t.indexesOfTag('+');
    if (flag) {
      if (indexes.length === 0 && this.statement != null) {
        const i = t.getFieldCount();
        t.insertField('+', DelimitedTokenizer.escape(connSymbol[0], '\\:') + ':' + this.statement, i);
        indexes = [i];
      }
      this.problemName = t.getName();
      this.originalName = t.valueAt(t.indexOfTag('o'));
    }
    this.readNodes(indexes, 0, t);
    const data = this.data;
    if (flag && data != null && (data.exercises != null || data.problems != null) && (this.problemName != null || this.originalName != null)) {
      const name = this.originalName == null ? this.problemName : this.originalName;
      let s2: string | null = null;
      let groups: Map<string, AnswerSet[]> | null = null;
      if (data.exercises != null) {
        s2 = data.exercises.getRecord(name);
        groups = data.exercises.answerGroups;
        if (s2 != null) this.userAnswerKey = false;
      }
      if (s2 == null && data.problems != null) {
        s2 = data.problems.getRecord(name);
        groups = data.problems.answerGroups;
        if (s2 == null) s2 = t.toString();
      }
      if (s2 != null) {
        const r = new TaggedRecord(s2);
        let s: string | null;
        if (this.originalName == null || ((s = getProblemStatement(r)) != null && s === this.statement)) {
          this.scheme = r.valueAt(r.indexOfTag('='));
          this.answerKeys = r.valueAt(r.indexOfTag('@'));
          this.answers = lookupAnswers(data, this.answerKeys, this.userAnswerKey);
          if (groups != null) {
            const g = r.valueAt(r.indexOfTag('g'));
            if (g != null) this.answerGroup = groups.get(g) ?? null;
          }
        } else {
          this.originalName = null;
        }
      }
    }
    this.changed();
  }

  readNodes(indexes: number[] | null, i: number, t: TaggedRecord): number {
    if (indexes == null || indexes.length === 0) return -1;
    let s1: string | null = null;
    this.outType = 0;
    if (i >= indexes.length) {
      console.log('invalid symbolization node index: ' + i);
      return -1;
    }
    const s = t.valueAt(indexes[i++])!;
    const d = new DelimitedTokenizer('\\:');
    d.setInput(s);
    let s2 = javaTrim(d.nextToken()!);
    if (s2 === '') {
      console.log('blank symbolization connective');
      return -1;
    }
    if ('*@!%'.indexOf(s2.charAt(0)) !== -1) {
      s1 = javaTrim(s2.substring(1));
      s2 = s2.substring(0, 1);
    }
    const j = connSymbol.indexOf(s2);
    if (j === -1) {
      console.log('unknown symbolization connective: ' + s2);
      return -1;
    }
    this.setConnective(j, s1, false);
    this.setEnglishText(d.getRemaining());
    this.normalizeText();
    const k = connArgTypes[j].length;
    for (let l = 0; l < k; l++) {
      const c = this.getChildNode(l);
      if (c == null) return -1;
      i = c.readNodes(indexes, i, t);
      if (i === -1) break;
    }
    return i;
  }

  // ---- direct entry ----

  /** buildFromText: rebuilds the tree from a typed formula (internal symbols). */
  buildFromText(s: string): void {
    let e: Expression | null;
    try {
      e = parseFormula(s);
    } catch (err) {
      if (!(err instanceof FormulaParseException)) throw err;
      this.notify({ kind: 'text', title: 'Badly Formed Expression', text: '\\l' + s + '\\l is not a well formed expression' });
      return;
    }
    this.setConnective(0, null, false);
    this.buildFromExpression(e);
  }

  buildFromExpression(e: Expression | null): void {
    if (e == null) return;
    let s: string | null = null;
    let n = e.childCount;
    let j = connSymbol.indexOf(e.symbol);
    if (isBinderKind(j)) {
      this.setConnective(j, e.getChild(0)!.symbol, true);
      this.getChildNode(0)?.buildFromExpression(e.getChild(1));
    } else {
      if (j === -1) {
        j = 11;
        s = DelimitedTokenizer.escape(e.toString(), '\\{');
        n = 0;
      }
      this.setConnective(j, s, true);
      for (let k = 0; k < n; k++) this.getChildNode(k)?.buildFromExpression(e.getChild(k));
    }
  }

  /** copyTextFrom(answer): copies the answer's English into the nodes, renaming bound variables. */
  copyTextFrom(answer: SymbolizationNode | null, binders: string[] = [], answerBinders: string[] = []): void {
    if (answer == null || this.connective !== answer.connective) return;
    if (this.isBinder()) {
      binders.push(this.getLabel()!);
      answerBinders.push(answer.getLabel()!);
    }
    for (let j = 0; j < this.argTypes.length; j++) {
      const c = this.getChildNode(j);
      const a = answer.getChildNode(j);
      if (c == null || a == null) continue;
      c.text = substituteVariables(a.text, answerBinders, binders);
      c.copyTextFrom(a, binders, answerBinders);
    }
    if (this.isBinder()) {
      binders.pop();
      answerBinders.pop();
    }
    this.changed();
  }

  // ---- answers and checking ----

  getAnswerSets(): AnswerSet[] {
    if (this.answerGroup != null) return this.answerGroup;
    return [{ problemName: this.problemName, answers: this.answers }];
  }

  /** An answer record as a tree (for comparison). */
  private loadAnswer(record: string): SymbolizationNode {
    const a = new SymbolizationNode(null, this.data);
    a.loadRecord(new TaggedRecord(record));
    return a;
  }

  findMatchingAnswer(): number {
    const sets = this.getAnswerSets();
    if (sets.length === 0 || this.isIncomplete()) return -1;
    for (let j = 0; j < sets.length; j++) {
      for (const record of sets[j].answers ?? []) {
        const a = this.loadAnswer(record);
        if (a.isIncomplete()) console.log(a.problemName + ' is incomplete.');
        else if (this.matchTree(a, null)) return j;
      }
    }
    return -1;
  }

  findEquivalentAnswer(): number {
    const sets = this.getAnswerSets();
    const e = this.toExpression();
    if (sets.length === 0 || e == null) return -1;
    for (let j = 0; j < sets.length; j++) {
      for (const record of sets[j].answers ?? []) {
        const a = this.loadAnswer(record);
        if (a.isIncomplete()) {
          console.log(a.problemName + ' is incomplete.');
        } else {
          const e1 = a.toExpression();
          if (e1 == null) console.log(a.problemName + ' could not be parsed.');
          else if (SymbolizationNode.areEquivalent(e, e1)) return j;
        }
      }
    }
    return -1;
  }

  countAnswers(): number {
    const sets = this.getAnswerSets();
    let n = 0;
    for (let k = 0; k < sets.length; k++) {
      if (this.findDuplicateSolution(k, this.data?.problems ?? null) === -1) n += sets[k].answers?.length ?? 0;
    }
    return n;
  }

  /** The answer (not solved elsewhere in the group) with the most nodes matching this tree. */
  findClosestAnswer(): SymbolizationNode | null {
    const sets = this.getAnswerSets();
    let best: SymbolizationNode | null = null;
    let bestCount = 0;
    for (let k = 0; k < sets.length; k++) {
      if (this.findDuplicateSolution(k, this.data?.problems ?? null) !== -1) continue;
      for (const record of sets[k].answers ?? []) {
        const a = this.loadAnswer(record);
        const n = this.countMatchingNodes(a);
        if (best == null || n > bestCount) {
          best = a;
          bestCount = n;
        }
      }
    }
    return best;
  }

  /** Truth-functional equivalence (quantified parts compared as opaque letters). */
  static areEquivalent(a: Expression, b: Expression): boolean {
    if (!(a instanceof Formula) || !(b instanceof Formula)) return false;
    const c = new ConnectiveFormula('<->');
    c.addChild(a);
    c.addChild(b);
    return new TruthTableEvaluator(c.toTruthFunctionalForm()).isAllTrue();
  }

  isIncomplete(): boolean {
    if (this.connective === 0) return true;
    for (let j = 0; j < this.argTypes.length; j++) {
      if (this.getChildNode(j)?.isIncomplete()) return true;
    }
    return false;
  }

  static getAnswerSetName(i: number, sets: AnswerSet[] | null): string | null {
    return sets != null && i >= 0 && i < sets.length ? sets[i].problemName : null;
  }

  static indexOfAnswerSet(name: string | null, sets: AnswerSet[] | null): number {
    if (name == null || sets == null) return -1;
    return sets.findIndex((s) => name === s.problemName);
  }

  /**
   * The index (in the answer group) of another problem already solved correctly with answer
   * set i, or -1.
   */
  findDuplicateSolution(i: number, set: SymbolizationProblemSetLike | null): number {
    const j = SymbolizationNode.indexOfAnswerSet(this.problemName, this.answerGroup);
    if (set == null || j === -1) return -1;
    const group = this.answerGroup!;
    for (let l = 0; l < group.length; l++) {
      if (l === j) continue;
      const entry = set.getEntry(group[l].problemName) as (ProblemEntry & { answerIndex?: number }) | null;
      if (entry != null && entry.state === STATE_CORRECT && entry.answerIndex === i) return l;
    }
    return -1;
  }

  countMatchingNodes(answer: SymbolizationNode): number {
    let count = 0;
    this.matchTree(answer, [], [], {
      nodeMatched: () => count++,
      nodeMismatched: () => {},
    });
    return count;
  }

  /**
   * Compares this tree with an answer tree node by node. A node matches when it is still
   * unanalysed (NONE) or has the answer's connective (and, for atomic nodes, the same
   * expression up to the renaming of bound variables). Without a listener, stops at the
   * first mismatch. binders / answerBinders: the variables bound above, in each tree.
   */
  matchTree(
    answer: SymbolizationNode,
    listener: NodeMatchListener | null,
    binders?: string[],
    answerBinders?: string[],
  ): boolean;
  matchTree(answer: SymbolizationNode, binders: string[], answerBinders: string[], listener: NodeMatchListener | null): boolean;
  matchTree(
    answer: SymbolizationNode,
    a: string[] | NodeMatchListener | null,
    b?: string[],
    c?: string[] | NodeMatchListener | null,
  ): boolean {
    if (Array.isArray(a)) return this.matchTreeAt(answer, a, b!, (c ?? null) as NodeMatchListener | null);
    return this.matchTreeAt(answer, b ?? [], (c as string[] | undefined) ?? [], a);
  }

  private matchTreeAt(answer: SymbolizationNode, v: string[], v1: string[], listener: NodeMatchListener | null): boolean {
    if ((this.connective === 0 || this.connective === answer.connective) && (this.connective !== 11 || this.atomicMatches(answer, v, v1))) {
      listener?.nodeMatched(this, answer, v, v1);
      if (this.isBinder()) {
        v.push(this.getLabel()!);
        v1.push(answer.getLabel()!);
      }
      let ok = true;
      for (let j = 0; j < this.argTypes.length; j++) {
        if (!this.getChildNode(j)!.matchTreeAt(answer.getChildNode(j)!, v, v1, listener)) {
          if (listener == null) return false;
          ok = false;
        }
      }
      if (this.isBinder()) {
        v.length = v.length - 1;
        v1.length = v1.length - 1;
      }
      return ok;
    }
    listener?.nodeMismatched(this, answer, v, v1);
    return false;
  }

  atomicMatches(answer: SymbolizationNode, v: string[], v1: string[]): boolean {
    if (this.outType !== answer.outType) return false;
    const n = this.argTypes.length;
    if (answer.argTypes.length !== n) return false;
    for (let j = 0; j < n; j++) if (this.argTypes[j] !== answer.argTypes[j]) return false;
    return this.atomsEquivalent(this.getLabel(), answer.getLabel(), v, v1);
  }

  atomsEquivalent(s: string | null, s1: string | null, v: string[], v1: string[]): boolean {
    let e: Expression | null;
    let e1: Expression | null;
    try {
      e = parseFormula(s, true);
      e1 = parseFormula(s1, true);
    } catch (err) {
      if (!(err instanceof FormulaParseException)) throw err;
      e = null;
      e1 = null;
    }
    e1 = translateExpression(e1, v1, v, null);
    return e1 == null ? s === s1 : e1.isAlphaEquivalent(e, new BinderMap());
  }

  describeType(v: string[] | null = null, v1: string[] | null = null): string {
    if (this.connective === 11) return 'the atomic expression \\l' + translateExpressionText(this.getLabel(), v, v1) + '\\l';
    return connWords[this.connective];
  }

  clearErrors(): void {
    this.panel?.clearError();
    for (let j = 0; j < this.argTypes.length; j++) this.getChildNode(j)?.clearErrors();
    this.changed();
  }

  /**
   * evaluateWork: the state of a problem record for the problem list (without a UI): the
   * index of the answer set it matches (structurally, else by equivalence when equCounts
   * covers it) in entry.answerIndex, and state 2 (correct, not a duplicate) or 1.
   */
  evaluateWork(t: TaggedRecord, set: SymbolizationProblemSetLike | null, entry: ProblemEntry & { answerIndex: number; resetState(): void }): void {
    if (!hasWork(t)) {
      entry.resetState();
      return;
    }
    this.loadRecord(t);
    if (this.isIncomplete()) {
      entry.answerIndex = -1;
    } else if ((entry.answerIndex = this.findMatchingAnswer()) === -1 && (this.data?.equivalentCounts(this.problemName) ?? false)) {
      entry.answerIndex = this.findEquivalentAnswer();
    }
    entry.state = entry.answerIndex !== -1 && this.findDuplicateSolution(entry.answerIndex, set) === -1 ? STATE_CORRECT : STATE_INCORRECT;
  }
}

function askForSymbol(ask: (prompt: string) => string | null, prompt: string): string | null {
  const typed = ask(prompt);
  return typed == null ? null : translateSymbols(typed, symbols, maggie);
}

/** lookupAnswers(keys, userKey): the answer records of the dot-separated keys. */
export function lookupAnswers(data: SymbolizationData | null, keys: string | null, userKey: boolean): string[] | null {
  if (keys == null || data == null) return null;
  const table = userKey ? data.userKey : data.answers;
  if (table == null) return null;
  const d = new DelimitedTokenizer('\\.');
  d.setInput(keys);
  const out: string[] = [];
  let key: string | null;
  while ((key = d.nextToken()) != null) {
    if (key === '') continue;
    const record = table.get(key);
    if (record != null) out.push(record);
  }
  return out;
}

/**
 * translateVariable: the name in the second list of the variable bound at the same depth
 * as s in the first; null if it cannot be translated (pushes the depth of the conflicting
 * binder onto path).
 */
export function translateVariable(s: string, v: string[] | null, v1: string[] | null, path: ExpressionPath | null = null): string | null {
  let s1 = s;
  const i = v == null ? -1 : v.lastIndexOf(s);
  if (i !== -1) {
    if (v1 == null || v!.length !== v1.length) return null;
    s1 = v1[i];
  }
  if (v1 != null && v1.lastIndexOf(s1) !== i) {
    path?.push(v1.lastIndexOf(s1));
    return null;
  }
  return s1;
}

/** translateExpression(String, ...): text that does not parse is returned as it is. */
export function translateExpressionText(s: string | null, v: string[] | null, v1: string[] | null, path: ExpressionPath | null = null): string | null {
  let e: Expression | null;
  try {
    e = parseFormula(s, true, false);
  } catch (err) {
    if (!(err instanceof FormulaParseException)) throw err;
    return s;
  }
  e = translateExpression(e, v, v1, path);
  return e == null ? null : e.toString();
}

/**
 * translateExpression: renames the variables of e bound by the binders v (outermost first)
 * to the names v1. Wraps e in universal quantifiers for v, links, renames and unwraps;
 * null when a variable would be captured (the depths of the capturing binders are pushed
 * onto path). e itself is changed.
 */
export function translateExpression(e: Expression | null, v: string[] | null, v1: string[] | null, path: ExpressionPath | null): Expression | null {
  if (e == null) return null;
  const j = v == null ? 0 : v.length;
  if (!(v1 == null ? j === 0 : v1.length === j)) return null;
  let object: Expression = e;
  for (let i = j - 1; i >= 0; i--) {
    const q = new QuantifiedFormula('@');
    q.addChild(new SimpleTerm(v![i]));
    q.addChild(object);
    object = q;
  }
  object.linkVariables();
  object.renameBoundVariables(v1);
  if (hasBindingConflicts(object, path)) return null;
  for (let k = 0; k < j; k++) object = object.getChild(1)!;
  return object.copy();
}

export function hasBindingConflicts(e: Expression, path: ExpressionPath | null): boolean {
  const mislinks = e.findMislinkedVariables();
  if (mislinks == null) return false;
  if (path != null) {
    for (const [binder] of mislinks) {
      let k = 0;
      for (let e1: Expression | null = e; e1 instanceof QuantifiedFormula; e1 = e1.getChild(1)) {
        if (e1 === binder) {
          path.push(k);
          break;
        }
        k++;
      }
    }
  }
  return true;
}

/**
 * SymbolizationErrorButton.substituteVariables: replaces each <x> in the English by the
 * variable at the same binding depth in the other list (where both are the innermost use).
 */
export function substituteVariables(s: string, v: string[], v1: string[]): string {
  const table: MessageParams = new Map();
  for (let j = 0; j < v.length; j++) {
    const s1 = v[j];
    const s2 = v1[j];
    if (v.lastIndexOf(s1) === j && v1.lastIndexOf(s2) === j) table.set(s1, s2);
  }
  return Message.substitute(s, table, null);
}
