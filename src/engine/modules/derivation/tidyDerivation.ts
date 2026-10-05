/**
 * Tidy (web only, not in the desktop program): cleans up a derivation without changing what
 * it proves or how its lines are justified. Unlike Expand, queued justifications stay as they
 * are. The clean-ups, each optional:
 * - blank lines: lines with neither a formula nor a justification go;
 * - unused lines: in a closed box only what its closing line needs is kept (and its
 *   assumption), in a finished derivation only what the conclusion needs; work in progress
 *   (open boxes, and the derivation until it is complete) is kept;
 * - repeated lines: a line or box whose formula is already in reach above it goes, and the
 *   lines citing it cite the earlier one (unless a box rule must cite the line in its box);
 * - notation: formulas as the program writes them, rule names as the rule list writes them
 *   (MP, Adj, ASS CD, T12), PR as the premise it gives (PR2), one blank between the parts of
 *   a justification. Asserted results ("MP[Q]") stay, with their formulas normalized, and so
 *   do answers after a slash ("UI/a") and comments.
 *
 * Unused and repeated lines are only removed from a derivation without errors in its lines,
 * and only lines without errors have their notation normalized. As with Expand, the
 * derivation is checked as Check does (recording each line's steps), tidied, and checked
 * again: a correct derivation must stay correct, and one without line errors must stay so;
 * otherwise it is left as it was.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import type { Expression } from '../../formula/Expression';
import { FormulaParseException, parseFormula } from '../../formula/parseFormula';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { isDigit, isJavaWhitespace } from './chars';
import { DerivationBox } from './DerivationBox';
import type { DerivationLine } from './DerivationLine';
import { DerivationLineChecker } from './DerivationLineChecker';
import type { DerivationNode } from './DerivationNode';
import type { DerivationWorkspace } from './DerivationWorkspace';
import { checkingModule, lineError, RecordingChecker, type Step } from './expandDerivation';
import type { LPDerivation } from './LPDerivation';

export interface TidyOptions {
  blankLines: boolean;
  unusedLines: boolean;
  repeatedLines: boolean;
  notation: boolean;
}

export const ALL_TIDY_OPTIONS: TidyOptions = { blankLines: true, unusedLines: true, repeatedLines: true, notation: true };

export interface TidyResult {
  /** The tidied record (the original if nothing changed or it could not be tidied). */
  record: string;
  changed: boolean;
  /** Lines (not counting the problem line) before and after. */
  linesBefore: number;
  linesAfter: number;
  /** What was done, e.g. ["2 blank lines", "1 unused line"]. */
  done: string[];
  /** Why some clean-ups were not done, or why nothing was (null if all went). */
  note: string | null;
}

// ---- the derivation's nodes ----

/** The body nodes of a box and its boxes, in order (not the Show lines of boxes: the boxes). */
function allNodes(box: DerivationBox, out: DerivationNode[] = []): DerivationNode[] {
  for (const node of box.getNodes().slice(1)) {
    out.push(node);
    if (node instanceof DerivationBox) allNodes(node, out);
  }
  return out;
}

function isLine(node: DerivationNode): node is DerivationLine {
  return !(node instanceof DerivationBox);
}

function formulaOf(node: DerivationNode): Expression | null {
  if (isLine(node) && node.box.cancelLine === node) return null;
  return node.getFormula();
}

/** 2: a line or a closed box; 1: an open box (citable, but not proven). */
function priorityOf(node: DerivationNode): number {
  return node instanceof DerivationBox && node.cancelLine == null ? 1 : 2;
}

function referrersOf(node: DerivationNode) {
  return node instanceof DerivationBox ? node.showLine.referrers : node.referrers;
}

function referencesOf(node: DerivationLine) {
  return node.references ?? [];
}

/** The first node above `node` in reach of it (outer boxes first) with its formula, at least as proven. */
function earlierInReach(node: DerivationNode): DerivationNode | null {
  const e = formulaOf(node);
  if (e == null) return null;
  const chain: [DerivationBox, number][] = [];
  let child: DerivationNode = node;
  for (let box = child.getEnclosingBox(); box != null; child = box, box = box.parentBox) chain.unshift([box, box.indexOfNode(child)]);
  for (const [box, limit] of chain) {
    for (let i = 1; i < limit; i++) {
      const other = box.getNode(i);
      const f = formulaOf(other);
      if (f != null && f.isIdentical(e) && priorityOf(other) >= priorityOf(node)) return other;
    }
  }
  return null;
}

// ---- the clean-ups ----

class Tidier {
  readonly done: string[] = [];

  constructor(
    private readonly m: LPDerivation,
    private readonly log: Map<DerivationLine, Step[]>,
  ) {}

  private isAssumption(node: DerivationNode): boolean {
    if (!isLine(node)) return false;
    const steps = this.log.get(node);
    return steps != null && steps.length > 0 && steps[0].name.startsWith('ASS ');
  }

  private count(n: number, one: string, many = one + 's'): void {
    if (n > 0) this.done.push(n + ' ' + (n === 1 ? one : many));
  }

  removeBlankLines(): void {
    let n = 0;
    for (const node of allNodes(this.m.problem).reverse()) {
      if (!isLine(node) || node.box.cancelLine === node) continue;
      if ((node.getFormulaText(false) ?? '').trim() !== '' || (node.getAnnotationText(false) ?? '').trim() !== '') continue;
      node.deleteNode(false);
      n++;
    }
    this.count(n, 'blank line');
  }

  /** Lines and boxes whose formula is in reach above them: their citations go to the earlier one. */
  removeRepeatedLines(): void {
    let n = 0;
    for (const node of allNodes(this.m.problem)) {
      if (this.isAttached(node) === false) continue;
      if (this.isAssumption(node)) continue;
      const earlier = earlierInReach(node);
      if (earlier == null) continue;
      const referrers = referrersOf(node).slice();
      // a box rule cites a line of its own box
      if (referrers.some((r) => r.source.box.cancelLine === r.source && earlier.getEnclosingBox() !== r.source.box)) continue;
      for (const ref of referrers) {
        ref.target.removeReferrer(ref);
        ref.target = earlier;
        earlier.addReferrer(ref);
      }
      node.deleteNode(true);
      n++;
    }
    this.m.problem.renumberAll();
    this.count(n, 'repeated line');
  }

  /** Whether node is still in the derivation (a box above it may have been removed). */
  private isAttached(node: DerivationNode): boolean {
    let child: DerivationNode = node;
    for (let box = child.getEnclosingBox(); box != null; child = box, box = box.parentBox) {
      if (box.indexOfNode(child) === -1) return false;
    }
    return child === this.m.problem;
  }

  /** What the closed boxes and the conclusion need, and the work in progress. */
  removeUnusedLines(complete: boolean): void {
    const needed = new Set<DerivationNode>();
    const need = (node: DerivationNode): void => {
      if (needed.has(node)) return;
      needed.add(node);
      const parent = node.getEnclosingBox();
      if (parent != null && parent.parentBox != null) need(parent);
      if (node instanceof DerivationBox) needBody(node);
      else for (const ref of referencesOf(node)) need(ref.target);
    };
    const needBody = (box: DerivationBox): void => {
      if (box.cancelLine != null) {
        if (box.getContentCount() > 1 && this.isAssumption(box.getNode(1))) need(box.getNode(1));
        need(box.cancelLine);
      } else {
        for (const node of box.getNodes().slice(1)) need(node);
      }
    };
    const conclusion = this.m.conclusion;
    const root = this.m.problem;
    if (complete && conclusion != null) {
      const node = root.getNodes().slice(1).find((x) => formulaOf(x)?.isIdentical(conclusion));
      if (node != null) need(node);
    } else {
      needBody(root);
    }
    let lines = 0;
    for (const node of allNodes(root).reverse()) {
      if (needed.has(node) || !this.isAttached(node)) continue;
      lines += node.countLines(false);
      node.deleteNode(true);
    }
    this.m.problem.renumberAll();
    this.count(lines, 'unused line');
  }

  /** Formulas, rule names and spacing as the program writes them, in the lines without errors. */
  normalizeNotation(): void {
    let n = 0;
    for (const line of this.m.getLines().slice(1)) {
      if (line.message != null && line.message.isError) continue;
      let changed = false;
      if (line.formulaEditor != null && line.formula != null && line.syntaxOk) {
        const text = line.getFormulaText(false) ?? '';
        const hash = text.indexOf('#');
        const s = String(line.formula) + (hash === -1 ? '' : ' ' + text.substring(hash).trim());
        if (s !== text) {
          line.setFormulaText(s);
          changed = true;
        }
      }
      if (line.annotationEditor != null) {
        const text = line.getAnnotationText(false) ?? '';
        const s = this.normalizeJustification(line, text);
        if (s != null && s !== text) {
          line.setAnnotationText(s);
          line.parseReferences(false);
          changed = true;
        }
      }
      if (changed) n++;
    }
    this.count(n, 'line rewritten', 'lines rewritten');
  }

  /** The justification in normal form, or null to leave it as it is. */
  private normalizeJustification(line: DerivationLine, text: string): string | null {
    const steps = this.log.get(line);
    if (steps == null || steps.length === 0) return null;
    const hash = text.indexOf('#');
    const body = hash === -1 ? text : text.substring(0, hash);
    const parts: string[] = [];
    let k = 0;
    let i = 0;
    const isName = (c: string) => DerivationLineChecker.isNameChar(c) || isDigit(c);
    while (i < body.length) {
      const c = body.charAt(i);
      if (isDigit(c)) {
        let j = i;
        while (j < body.length && isDigit(body.charAt(j))) j++;
        if (j < body.length && DerivationLineChecker.isNameChar(body.charAt(j))) return null;
        parts.push(body.substring(i, j));
        i = j;
      } else if (DerivationLineChecker.isNameChar(c)) {
        let j = i;
        while (j < body.length && isName(body.charAt(j))) j++;
        let word = body.substring(i, j);
        i = j;
        const upper = word.toUpperCase();
        if (upper === 'ASS' || upper === 'SHOW') {
          while (i < body.length && isJavaWhitespace(body.charAt(i))) i++;
          j = i;
          while (j < body.length && isName(body.charAt(j))) j++;
          if (j === i) return null;
          word = word + ' ' + body.substring(i, j);
          i = j;
        }
        const step = steps[k++];
        const slash = word.indexOf('/');
        const name = (slash === -1 ? word : word.substring(0, slash)).toUpperCase();
        if (step == null || step.name !== name) return null;
        let token = step.name === 'PR' ? this.premiseToken(step) : step.stackOp ? step.name : (step.token.split('/')[0] ?? step.name);
        if (slash !== -1) token += word.substring(slash);
        if (step.name === 'PR' && token !== 'PR') this.clearCache(line, k - 1);
        parts.push(token);
      } else if (c === '[') {
        let depth = 0;
        let j = i;
        for (; j < body.length; j++) {
          if (body.charAt(j) === '[') depth++;
          else if (body.charAt(j) === ']' && --depth === 0) break;
        }
        if (j >= body.length || parts.length === 0) return null;
        const inner = body.substring(i + 1, j);
        let e: Expression | null;
        try {
          e = parseFormula(translateSymbols(inner, symbols, maggie));
        } catch (x) {
          if (!(x instanceof FormulaParseException)) throw x;
          return null;
        }
        if (e == null) return null;
        parts[parts.length - 1] += '[' + translateSymbols(String(e), maggie, symbols) + ']';
        i = j + 1;
      } else if (c === ']') {
        return null;
      } else {
        i++;
      }
    }
    if (k !== steps.length) return null;
    let s = parts.join(' ');
    if (hash !== -1) s += (s === '' ? '' : ' ') + text.substring(hash).trim();
    return s;
  }

  /** "PR" (which premise was asked) as the premise it gave, if there is one. */
  private premiseToken(step: Step): string {
    const premises = this.m.premises ?? [];
    if (step.result == null) return 'PR';
    for (let i = 0; i < premises.length; i++) if (step.result.isIdentical(premises[i])) return 'PR' + (i + 1);
    return 'PR';
  }

  private clearCache(line: DerivationLine, stepIndex: number): void {
    // the steps the log has are the ones the check applied: their indexes are the cache's
    const cache = line.justifications;
    if (cache != null && stepIndex < cache.length) cache[stepIndex] = null;
  }
}

// ---- tidying a record ----

function countLines(m: LPDerivation): number {
  return m.getLines().length - 1;
}

/** The record of the module's derivation, with the original's error count and work time. */
function encode(m: LPDerivation, original: TaggedRecord): string {
  let s = m.saveTitle() + m.problem.encodeWork();
  const e = original.valueAt(original.indexOfTag('e'));
  const t = original.valueAt(original.indexOfTag('t'));
  if (e != null) s += e + '`e';
  if (t != null) s += t + '`t';
  return TaggedRecord.toLine(s);
}

/** Tidies the derivation of a work record (a problem's record in the work). */
export async function tidyDerivation(ws: DerivationWorkspace, record: string, options: TidyOptions): Promise<TidyResult> {
  const original = new TaggedRecord(record);
  const m = checkingModule(ws);
  const log = new Map<DerivationLine, Step[]>();
  m.createChecker = (line, interactive) => new RecordingChecker(line, interactive, log);
  m.loadProblem(record);
  const before = m.problem.encodeWork();
  const linesBefore = countLines(m);
  const unchanged = (note: string | null): TidyResult => ({ record, changed: false, linesBefore, linesAfter: linesBefore, done: [], note });
  if ((m.problem.getFormulaText(true) ?? '').trim() === '') return unchanged(null);

  const correct = await m.checkProblem();
  const errors = lineError(m) != null;
  const tidier = new Tidier(m, log);
  let note: string | null = null;
  if (errors && (options.unusedLines || options.repeatedLines)) note = 'It has errors: unused and repeated lines were left in.';
  if (options.blankLines) tidier.removeBlankLines();
  if (!errors && options.repeatedLines) tidier.removeRepeatedLines();
  if (!errors && options.unusedLines) tidier.removeUnusedLines(correct);
  if (options.notation) tidier.normalizeNotation();

  const after = m.problem.encodeWork();
  if (after === before) return unchanged(note);
  const tidied = encode(m, original);

  // it must check as well as before
  const v = checkingModule(ws);
  v.loadProblem(tidied);
  const ok = await v.checkProblem();
  if ((correct && !ok) || (!errors && lineError(v) != null)) return unchanged('It could not be tidied safely, so it was left as it was.');
  return { record: tidied, changed: true, linesBefore, linesAfter: countLines(v), done: tidier.done, note };
}
