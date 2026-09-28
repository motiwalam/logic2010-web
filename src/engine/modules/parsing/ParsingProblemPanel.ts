/**
 * The content of a parsing problem: the notation choice and the parse tree, loaded from and
 * written to a work record, and checked. Port of ParsingProblemPanel.java, NotationChooser.java
 * and NotationRadioButton.java (their logic; the Swing layout is the UI's).
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { FormulaParseNode } from '../../formula/FormulaParseNode';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import { javaTrim, parseJavaInt } from '../../util/java';
import { ParseTree, type ParseTreeContext, type ParseTreeNode } from './ParseTree';

/** NotationChooser.NOTATION_CODES / NOTATION_LABELS. */
export const NOTATION_CODES = 'OIN';
export const NOTATION_LABELS = ['Official Notation', 'Informal Notation', 'Not Well Formed'] as const;

/** NotationChooser.codeForIndex. */
export function codeForIndex(i: number): string | null {
  return i >= 0 && i < NOTATION_CODES.length ? NOTATION_CODES.substring(i, i + 1) : null;
}

/** NotationChooser.indexForCode. */
export function indexForCode(s: string | null): number {
  return s != null && s.length === 1 ? NOTATION_CODES.indexOf(s) : -1;
}

/** The notation code of a statement: O, I or N (FormulaParseNode.getNotationCode). */
export function notationCodeOf(statement: string | null): string {
  // Java: a null statement (the empty new problem) throws a NullPointerException here; the
  // port treats it as the empty text.
  return new FormulaParseNode(statement ?? '').getNotationCode();
}

/** What ParsingProblemPanel needs of its LPParsing. */
export interface ParsingPanelHost extends ParseTreeContext {
  readonly checkDisabled: boolean;
  noDescent: boolean;
  errorCount: number;
  lastUserProblem: string | null;
  loadTime: number;
  /** titlePanel.setStatus. */
  status: string;
  /** titlePanel.setTitleLabel (the problem name as shown, or null). */
  title: string | null;
  /** titlePanel.setStatement (in display symbols). */
  statementText: string;
  trimTitle(name: string | null): string | null;
}

/** ParsingProblemPanel.checkProblem's ErrorRef: id (null if correct) and the summary parameter. */
export interface ParsingCheckResult {
  /** parerr001 no notation chosen, parerr002 wrong notation, parerr003 tree incomplete, parerr004 wrong main connective. */
  id: string | null;
  /** "Correct", "Incomplete" or "Incorrect". */
  summary: string;
}

/** The outcome of a click on a node's text (ParseTreeFormulaText.mousePressed). */
export interface ParsingClickResult {
  /**
   * ignored: "Not Well Formed" is chosen; expanded: the main connective was hit and the node
   * expanded (the desktop flashes the symbol green); miss: anything else (flashed red with a
   * beep, and the error count goes up); selected: main-connective mode, the symbol was marked.
   */
  kind: 'ignored' | 'expanded' | 'miss' | 'selected';
  /** The symbol clicked ([start, end) of the node's text), or null for a blank or outside the text. */
  symbolRange: number[] | null;
  /** selected: whether it is the main connective. */
  correct?: boolean;
}

export class ParsingProblemPanel {
  problemName: string | null = null;
  statement: string | null = null;
  /** The chosen notation: 0 official, 1 informal, 2 not well formed, -1 none. */
  notationIndex = -1;
  /** NotationChooser.resultLabel. */
  resultText = ' ';
  readonly tree: ParseTree;

  constructor(readonly host: ParsingPanelHost) {
    this.tree = new ParseTree(host);
  }

  getSelectedCode(): string | null {
    return codeForIndex(this.notationIndex);
  }

  clearProblem(): void {
    this.problemName = null;
    this.host.title = 'Problem: ';
    this.statement = null;
    this.host.statementText = '';
    this.host.lastUserProblem = null;
    this.host.loadTime = 0;
    this.tree.setFormula('');
    this.resetWork();
  }

  /** resetWork(true) also clears the notation choice. */
  resetWork(clearNotation = true): void {
    this.host.status = '';
    if (clearNotation) {
      this.notationIndex = -1;
      this.resultText = ' ';
    }
    this.tree.visible = !this.host.checkNow;
    this.tree.setExpanded(this.tree.root, false);
    this.tree.updateStatus();
    this.tree.root.clearHighlight();
  }

  /**
   * The student chooses a notation (a radio button becomes selected; choosing the one already
   * chosen does nothing). NotationRadioButton.fireItemStateChanged: "Not Well Formed" clears
   * the tree; with autoCheck the choice is checked at once and the tree shown only if right.
   */
  selectNotation(i: number): void {
    if (i < 0 || i >= NOTATION_CODES.length || i === this.notationIndex) return;
    this.notationIndex = i;
    if (i === 2) this.resetWork(false);
    if (this.host.checkNow && !this.host.checkDisabled) {
      const s = notationCodeOf(this.statement);
      this.tree.visible = (i === 0 && s === 'O') || (i === 1 && s === 'I');
      this.resultText = s === codeForIndex(i) ? 'Correct' : 'Incorrect';
    }
  }

  /** ParseTreeFormulaText.mousePressed, with the index of the character clicked in the node's text. */
  click(node: ParseTreeNode, i: number): ParsingClickResult {
    if (this.getSelectedCode() === 'N') return { kind: 'ignored', symbolRange: null };
    const range = node.getSymbolRangeAt(i);
    if (this.host.noDescent) {
      node.selectionCorrect = node.hitsMainConnective(i);
      node.selectedRange = range;
      return { kind: 'selected', symbolRange: range, correct: node.selectionCorrect };
    }
    node.selectedRange = range;
    if (!node.expanded && node.hitsMainConnective(i)) {
      this.tree.setExpanded(node, true);
      return { kind: 'expanded', symbolRange: range };
    }
    this.host.errorCount++;
    return { kind: 'miss', symbolRange: range };
  }

  isCorrect(): boolean {
    return this.checkProblem().id == null;
  }

  checkProblem(): ParsingCheckResult {
    let id: string | null = null;
    let summary = 'Correct';
    const i = this.notationIndex;
    const code = notationCodeOf(this.statement);
    if (i === -1) {
      id = 'parerr001';
      summary = 'Incomplete';
    } else if (indexForCode(code) !== i) {
      id = 'parerr002';
      summary = 'Incorrect';
    }
    const show = !this.host.checkDisabled;
    if (show) this.resultText = summary;
    if (i !== 2) {
      if (!this.tree.isComplete()) {
        if (!this.host.noDescent) {
          if (id == null) {
            id = 'parerr003';
            summary = 'Incomplete';
          }
          if (show) this.tree.statusLabel = 'Incomplete';
        } else {
          const r = this.tree.root.selectedRange;
          if (r != null && r.length !== 0) {
            if (id == null || id.toLowerCase() !== 'parerr002') {
              id = 'parerr004';
              summary = 'Incorrect';
            }
            if (show) this.tree.statusLabel = 'Incorrect';
          } else {
            if (id == null) {
              id = 'parerr003';
              summary = 'Incomplete';
            }
            if (show) this.tree.statusLabel = 'Incomplete';
          }
        }
      } else if (show) {
        this.tree.statusLabel = this.host.noDescent ? 'Correct' : 'Complete';
      }
    }
    return { id, summary };
  }

  loadRecord(record: TaggedRecord): void {
    this.clearProblem();
    this.problemName = record.getName();
    this.host.title = this.problemName != null && javaTrim(this.problemName) !== '' ? this.host.trimTitle(this.problemName) : null;
    this.statement = record.valueAt(record.indexOfAnyTag('='));
    this.host.statementText = this.statement == null ? '' : translateSymbols(this.statement, maggie, symbols);
    this.tree.setFormula(this.statement);
    this.tree.restoreExpansion(this.tree.root, record.valueAt(record.indexOfTag(']')));
    // setSelected(true) fires the radio button's item event, as a click does
    const i = indexForCode(record.valueAt(record.indexOfTag('[')));
    if (i >= 0 && i < NOTATION_CODES.length) this.selectNotation(i);
    const s = record.valueAt(record.indexOfTag('*'));
    if (s != null) {
      this.host.noDescent = true;
      // Java: an empty value throws (charAt(0)); the port reads it as not correct
      this.tree.root.selectionCorrect = s.charAt(0) === 'T';
      const values: number[] = [];
      const tokens = new DelimitedTokenizer('\\,');
      tokens.setInput(s.substring(1));
      let n: number | null;
      while ((n = parseJavaInt(tokens.nextToken())) != null) values.push(n);
      this.tree.root.selectedRange = values.length === 0 ? null : values;
    }
  }

  getWorkRecord(): string {
    let s = TaggedRecord.formatField(this.problemName, '$') + TaggedRecord.formatField(this.statement, '=');
    if (this.notationIndex !== -1) s += TaggedRecord.formatField(codeForIndex(this.notationIndex), '[');
    const expansion = this.tree.root.getExpansionString(false);
    if (expansion !== '0') s += TaggedRecord.formatField(expansion, ']');
    if (this.host.noDescent) {
      const r = this.tree.root.selectedRange;
      if (r != null && r.length !== 0) {
        s += TaggedRecord.formatField((this.tree.root.selectionCorrect ? 'T' : 'F') + r.join(','), '*');
      }
    }
    return s;
  }
}
