/**
 * Expand (web only, not in the desktop program): rewrites a derivation so that no line queues
 * steps. Each line becomes the Show line of a box, an assumption, or the application of exactly
 * one rule; cited lines and premises (PR1, PR2 ...) are references, not steps, and stay in the
 * line that uses them. Theorems get lines of their own; DUP, DROP and SWAP disappear.
 *
 * "2 3 MP 5 SL Adj 4 MP" becomes four lines: "2 3 MP", "5 SL", "-1 -2 Adj" (as line numbers)
 * and "-1 4 MP", the last one keeping the original line's formula.
 *
 * Besides splitting, the result is simplified as someone writing it by hand would:
 * - a formula is not derived twice: a citation goes to the first line in reach that has its
 *   formula (and a premise not on a line of its own is cited as PRn);
 * - a line or box whose formula is already in reach above it is dropped;
 * - in a closed box only what its closing line needs is kept (its assumption always), and in a
 *   finished derivation only what the conclusion needs;
 * - blank lines go.
 * Work in progress (boxes not yet closed, and the derivation itself until it is complete) keeps
 * every line, apart from repeated formulas.
 *
 * How: the derivation is checked as Check does (serial mode), recording for each step of each
 * line its rule, the formulas it took from the stack and its result. A new tree is built from
 * these, citations are resolved by formula, and what is not needed is pruned. The new record is
 * checked again before it is returned: it must be correct if the derivation was, and otherwise
 * free of line errors. A derivation with an error in a line is not expanded.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import type { Expression } from '../../formula/Expression';
import { rob, symbols, translateSymbols } from '../../program/symbols';
import { Theorem } from '../../rules/Rule';
import { DerivationBox } from './DerivationBox';
import type { DerivationLine } from './DerivationLine';
import { DerivationLineChecker } from './DerivationLineChecker';
import { LPDerivation } from './LPDerivation';
import { HeadlessDialogs } from './QueryDialog';
import type { DerivationWorkspace } from './DerivationWorkspace';

const BOX_RULES = ['CD', 'ID', 'DD', 'UD', 'BD'];

/** A formula a step took from the stack, and whether a premise step (PR, PR1 ...) put it there. */
interface Arg {
  formula: Expression;
  fromPremise: boolean;
}

/** One step of a line's justification as the check applied it. */
export interface Step {
  /** The rule name as the checker reads it (upper case: "MP", "ASS CD", "PR1", "T12"). */
  name: string;
  /** The rule as it is written in the expanded line ("Adj", "UI/a"). */
  token: string;
  /** The formulas the step took from the stack, bottom first. */
  args: Arg[];
  result: Expression | null;
  /** The step's cached choices (a `:` field), or null. */
  cache: string | null;
  /** DUP, DROP or SWAP (args and result are then empty). */
  stackOp: boolean;
}

/** Records the steps of every line it checks (serial mode: one checker per line). */
export class RecordingChecker extends DerivationLineChecker {
  readonly steps: Step[] = [];
  private presets: string[] = [];
  /** Parallel to the stack: whether each formula is the result of a premise step. */
  private fromPremise: boolean[] = [];
  private lastWasPremise = false;

  constructor(
    line: DerivationLine,
    interactive: boolean,
    log: Map<DerivationLine, Step[]>,
  ) {
    super(line, interactive);
    log.set(line, this.steps);
  }

  override readNextStep(): boolean {
    const n = this.presetAnswers == null ? 0 : this.presetAnswers.length;
    const pushesResult = this.result != null && this.remaining != null;
    const ok = super.readNextStep();
    this.presets = this.presetAnswers == null ? [] : this.presetAnswers.slice(n);
    // the previous step's result, then the cited lines
    let first = pushesResult;
    while (this.fromPremise.length < this.stack.length) {
      this.fromPremise.push(first && this.lastWasPremise);
      first = false;
    }
    return ok;
  }

  override async checkStep(matchLine: boolean, finalStep = false): Promise<boolean> {
    const name = this.ruleName!;
    const before = this.stack.slice();
    const premises = this.fromPremise.slice();
    const presets = this.presets;
    const ok = await super.checkStep(matchLine, finalStep);
    if (!ok) return ok;
    if (DerivationLineChecker.isStackOperation(name)) {
      const j = premises.length;
      if (name === 'DUP') this.fromPremise.push(premises[j - 1]);
      else if (name === 'DROP') this.fromPremise.length = j - 1;
      else [this.fromPremise[j - 1], this.fromPremise[j - 2]] = [premises[j - 2], premises[j - 1]];
      this.lastWasPremise = false;
      this.steps.push({ name, token: name + presets.map((p) => '/' + p).join(''), args: [], result: null, cache: null, stackOp: true });
      return ok;
    }
    const k = this.stack.length;
    const cached = this.line.justifications == null ? null : this.line.justifications[this.stepIndex];
    this.steps.push({
      name,
      token: this.canonicalName(name) + presets.map((p) => '/' + p).join(''),
      args: before.slice(k).map((formula, i) => ({ formula, fromPremise: premises[k + i] })),
      result: BOX_RULES.includes(name) ? null : this.result,
      cache: cached == null ? null : cached.encode(),
      stackOp: false,
    });
    this.fromPremise.length = k;
    this.lastWasPremise = DerivationLineChecker.parsePremiseNumber(name) !== -1;
    return ok;
  }

  /** The rule's name as the rule list writes it ("Adj"); box rules, assumptions, premises and theorems as read. */
  canonicalName(name: string): string {
    if (BOX_RULES.includes(name) || name.startsWith('ASS ') || DerivationLineChecker.parsePremiseNumber(name) !== -1) return name;
    if (Theorem.parseTheoremNumber(name) != null) return name;
    const rule = this.module.getRule(name);
    return rule == null ? name : rule.name;
  }
}

/** Why a derivation was not expanded. */
export class ExpandError extends Error {
  constructor(
    message: string,
    /** The line to point at, if any. */
    readonly lineNumber: number | null = null,
  ) {
    super(message);
  }
}

export interface ExpandResult {
  /** The expanded derivation as a work record (without the work time and error count). */
  record: string;
  /** Whether it differs from the original. */
  changed: boolean;
  /** The number of lines (not counting the problem line) before and after. */
  linesBefore: number;
  linesAfter: number;
  /** Whether the derivation is correct (Check). */
  correct: boolean;
}

// ---- the new tree ----

type Cite = { node: Node } | { premise: number };

interface Line {
  kind: 'line';
  parent: Box;
  formula: Expression | null;
  /** The formula field as written (an original line keeps its text). */
  formulaText: string;
  cites: Cite[];
  token: string;
  /** The `:` cache of the rule step (after one empty field per premise cited). */
  cache: string | null;
  /** A comment of the original justification ("# ..."), kept on its last step. */
  comment: string | null;
  isAssumption: boolean;
  isCancel: boolean;
  /** Written by the student (not a step split off). */
  original: boolean;
}

interface Box {
  kind: 'box';
  parent: Box | null;
  /** The Show line's fields as the derivation writes them (formula, command log, caches). */
  showFields: string;
  formula: Expression | null;
  canceled: boolean;
  children: Node[];
}

type Node = Line | Box;

function formulaOf(node: Node): Expression | null {
  return node.kind === 'box' ? node.formula : node.isCancel ? null : node.formula;
}

/** 2: a line or a closed box; 1: an open box (citable, but not proven). */
function priorityOf(node: Node): number {
  return node.kind === 'box' && !node.canceled ? 1 : 2;
}

/**
 * The first node in reach of position `index` of `box` whose formula is e: in the box or the
 * boxes around it, above it (outer boxes first). sameBox: only directly in the box (what a
 * box rule may cite). A proven node is preferred to an open box.
 */
function findInReach(e: Expression, box: Box, index: number, sameBox: boolean, accept: (node: Node) => boolean = () => true): Node | null {
  const chain: [Box, number][] = [];
  let b: Box | null = box;
  let limit = index;
  while (b != null) {
    chain.unshift([b, limit]);
    if (b.parent == null) break;
    limit = b.parent.children.indexOf(b);
    b = b.parent;
  }
  let fallback: Node | null = null;
  for (const [b1, n] of sameBox ? [chain[chain.length - 1]] : chain) {
    for (let i = 0; i < n; i++) {
      const node = b1.children[i];
      if (!accept(node)) continue;
      const f = formulaOf(node);
      if (f == null || !f.isIdentical(e)) continue;
      if (priorityOf(node) === 2) return node;
      fallback ??= node;
    }
  }
  return fallback;
}

class Builder {
  constructor(
    private readonly m: LPDerivation,
    private readonly log: Map<DerivationLine, Step[]>,
  ) {}

  build(): Box {
    const root: Box = { kind: 'box', parent: null, showFields: this.m.problem.showLine.encodeWork(), formula: null, canceled: false, children: [] };
    this.fillBox(this.m.problem, root);
    return root;
  }

  private fillBox(source: DerivationBox, box: Box): void {
    for (const node of source.getNodes().slice(1)) {
      if (node instanceof DerivationBox) {
        const child: Box = {
          kind: 'box',
          parent: box,
          showFields: node.showLine.encodeWork(),
          formula: node.getFormula(),
          canceled: node.cancelLine != null,
          children: [],
        };
        box.children.push(child);
        this.fillBox(node, child);
      } else {
        this.expandLine(node, box);
      }
    }
  }

  private premiseIndex(e: Expression): number {
    const premises = this.m.premises ?? [];
    for (let k = 0; k < premises.length; k++) if (e.isIdentical(premises[k])) return k + 1;
    return -1;
  }

  /** The line's steps as lines of the box (the last one is the line itself). */
  private expandLine(source: DerivationLine, box: Box): void {
    const steps = (this.log.get(source) ?? []).filter((step) => !step.stackOp);
    if (steps.length === 0) {
      // a blank line (an error-free line always has a step)
      return;
    }
    const raw = source.getAnnotationText(false) ?? '';
    const hash = raw.indexOf('#');
    const comment = hash === -1 ? null : raw.substring(hash);
    const isCancel = source.box.cancelLine === source;
    steps.forEach((step, i) => {
      const last = i === steps.length - 1;
      // a premise is cited where it is used (unless it is all the line does, or queuing is off)
      if (!last && DerivationLineChecker.parsePremiseNumber(step.name) !== -1 && this.m.queuedMode) return;
      const isBoxRule = BOX_RULES.includes(step.name);
      const line: Line = {
        kind: 'line',
        parent: box,
        formula: last ? (isCancel ? null : source.getFormula()) : step.result,
        formulaText: last ? (source.getFormulaText(false) ?? '') : String(step.result),
        cites: step.args.map((a) => this.cite(a, box, isBoxRule, source)),
        token: step.name === 'PR' ? this.premiseToken(step) : step.token,
        cache: step.name === 'PR' ? null : step.cache,
        comment: last ? comment : null,
        isAssumption: step.name.startsWith('ASS '),
        isCancel: last && isCancel,
        original: last,
      };
      box.children.push(line);
    });
  }

  /** "PR" (which premise was asked) as the premise it gave. */
  private premiseToken(step: Step): string {
    const k = step.result == null ? -1 : this.premiseIndex(step.result);
    return k === -1 ? step.token : 'PR' + k;
  }

  /**
   * How a step cites a formula: a line in reach that has it (for a box rule, one in its box);
   * a premise as the line that states it (if any) or else as PRn.
   */
  private cite(arg: Arg, box: Box, sameBox: boolean, source: DerivationLine): Cite {
    const e = arg.formula;
    const k = this.premiseIndex(e);
    if (arg.fromPremise && k !== -1) {
      const node = findInReach(e, box, box.children.length, sameBox, isPremiseLine);
      if (node != null) return { node };
      if (this.m.queuedMode) return { premise: k };
    }
    const node = findInReach(e, box, box.children.length, sameBox);
    if (node != null) return { node };
    if (k !== -1 && this.m.queuedMode) return { premise: k };
    throw new ExpandError('Line ' + source.getLineNumber() + ' cites a formula that is not in reach.', source.getLineNumber());
  }
}

/** A line that just states a premise ("PR1"). */
function isPremiseLine(node: Node): boolean {
  return node.kind === 'line' && node.cites.length === 0 && DerivationLineChecker.parsePremiseNumber(node.token.toUpperCase()) > 0;
}

// ---- pruning ----

function isDuplicate(node: Node): boolean {
  if (node.kind === 'line' && (node.isAssumption || node.isCancel)) return false;
  const e = formulaOf(node);
  if (e == null) return false;
  const box = node.parent!;
  const other = findInReach(e, box, box.children.indexOf(node), false);
  return other != null && priorityOf(other) >= priorityOf(node);
}

/** The nodes to keep: what the closed boxes and the conclusion need, and the work in progress. */
function neededNodes(root: Box, conclusion: Expression | null, complete: boolean): Set<Node> {
  const needed = new Set<Node>();
  const need = (node: Node): void => {
    if (needed.has(node)) return;
    needed.add(node);
    if (node.parent != null && node.parent.parent != null) need(node.parent);
    if (node.kind === 'line') {
      for (const c of node.cites) if ('node' in c) need(c.node);
    } else {
      needBody(node);
    }
  };
  const needBody = (box: Box): void => {
    if (box.canceled) {
      const first = box.children[0];
      if (first != null && first.kind === 'line' && first.isAssumption) need(first);
      const last = box.children[box.children.length - 1];
      if (last != null && last.kind === 'line' && last.isCancel) need(last);
    } else {
      for (const node of box.children) if ((node.kind === 'box' || node.original) && !isDuplicate(node)) need(node);
    }
  };
  if (complete && conclusion != null) {
    const node = root.children.find((n) => formulaOf(n)?.isIdentical(conclusion));
    if (node != null) need(node);
  } else {
    needBody(root);
  }
  return needed;
}

// ---- writing ----

function encodeTree(root: Box, needed: Set<Node>): { text: string; lines: number } {
  const numbers = new Map<Node, number>();
  let n = 0;
  const number = (box: Box): void => {
    for (const node of box.children) {
      if (!needed.has(node)) continue;
      numbers.set(node, ++n);
      if (node.kind === 'box') number(node);
    }
  };
  number(root);
  const annotation = (line: Line): string => {
    const parts = line.cites.map((c) => ('premise' in c ? 'PR' + c.premise : String(numbers.get(c.node))));
    parts.push(line.token);
    let s = parts.join(' ');
    if (line.comment != null) s += ' ' + line.comment;
    return translateSymbols(s, symbols, rob);
  };
  const caches = (line: Line): string => {
    if (line.cache == null) return '';
    let s = '';
    for (const c of line.cites) if ('premise' in c) s += TaggedRecord.formatField('', ':');
    return s + TaggedRecord.formatField(line.cache, ':');
  };
  const write = (box: Box): string => {
    let s = box.showFields;
    for (const node of box.children) {
      if (!needed.has(node)) continue;
      if (node.kind === 'box') s += write(node);
      else if (node.isCancel) s += TaggedRecord.formatField(annotation(node), '#') + caches(node);
      else s += TaggedRecord.formatField(node.formulaText, '<') + TaggedRecord.formatField(annotation(node), '>') + caches(node);
    }
    if (!box.canceled) s += '`=';
    return s;
  };
  return { text: write(root), lines: n };
}

// ---- checking ----

function countLines(m: LPDerivation): number {
  return m.getLines().length - 1;
}

/** The first line with an error that stops the expansion, or null. */
export function lineError(m: LPDerivation): ExpandError | null {
  if (m.aborted()) return new ExpandError('The check of the derivation was interrupted.');
  if (!m.problem.showLine.syntaxOk) return new ExpandError('The problem line does not parse.', 0);
  for (const line of m.getLines().slice(1)) {
    const n = line.getLineNumber();
    if (line.box.showLine === line) {
      if (!line.syntaxOk) return new ExpandError(`Line ${n} does not parse.`, n);
      continue;
    }
    if (line.message != null && line.message.isError) return new ExpandError(`Line ${n} has an error: fix it first.`, n);
    if (line.formulaEditor != null && line.formula == null && (line.getAnnotationText(true) ?? '').trim() !== '') {
      return new ExpandError(`Line ${n} has a justification but no formula.`, n);
    }
  }
  return null;
}

/** A module that checks like Check, without a window's dialogs. */
export function checkingModule(ws: DerivationWorkspace): LPDerivation {
  return new LPDerivation(ws, { dialogs: new HeadlessDialogs(), hasFrame: true, doSubs: false });
}

/**
 * Expands the derivation of a work record (LPDerivation.saveProblem). Throws ExpandError if
 * it has an error in a line, or if the expansion could not be verified.
 */
export async function expandDerivation(ws: DerivationWorkspace, record: string): Promise<ExpandResult> {
  const m = checkingModule(ws);
  const log = new Map<DerivationLine, Step[]>();
  m.createChecker = (line, interactive) => new RecordingChecker(line, interactive, log);
  m.loadProblem(record);
  if ((m.problem.getFormulaText(true) ?? '').trim() === '') throw new ExpandError('There is no problem to expand.');
  const linesBefore = countLines(m);
  const original = m.problem.encodeWork();
  const correct = await m.checkProblem();
  const error = lineError(m);
  if (error != null) throw error;

  const root = new Builder(m, log).build();
  const needed = neededNodes(root, m.conclusion, correct);
  const tree = encodeTree(root, needed);
  const expanded = TaggedRecord.toLine(m.saveTitle() + tree.text);

  // the result must check as well as the original
  const v = checkingModule(ws);
  v.loadProblem(expanded);
  const ok = await v.checkProblem();
  if ((correct && !ok) || lineError(v) != null) {
    throw new ExpandError('The derivation could not be expanded (the result did not check).');
  }
  return {
    record: expanded,
    changed: tree.text !== original,
    linesBefore,
    linesAfter: tree.lines,
    correct: ok,
  };
}
