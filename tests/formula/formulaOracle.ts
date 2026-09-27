/**
 * The TypeScript side of tools/oracle/.../OracleFormula.java: computes the same record for an
 * input, so the tests can compare it with the fixture field by field.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeBoundVariableNames } from '../../src/engine/formula/BoundVariableNames';
import { type Expression, Formula, SimpleTerm } from '../../src/engine/formula/Expression';
import { ExpressionPath } from '../../src/engine/formula/ExpressionPath';
import { FormulaParseNode } from '../../src/engine/formula/FormulaParseNode';
import { FormulaParseException, parseFormula } from '../../src/engine/formula/parseFormula';
import { SchemeInstantiation } from '../../src/engine/formula/SchemeInstantiation';
import { TruthTableEvaluator } from '../../src/engine/formula/TruthTableEvaluator';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { variableLetter } from '../../src/engine/program/symbols';
import { loadRulesAndTheorems } from '../../src/engine/rules/RuleTable';
import { repoData } from '../support/fsDataSource';

export function formulaFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, '../fixtures/formula', name), 'utf8')) as T;
}

export async function loadEngine(syntax: 1 | 2): Promise<void> {
  await loadProgram(repoData, {
    syntax,
    loadRules: (theorems, rules) => {
      loadRulesAndTheorems(theorems, rules);
    },
  });
}

/** An error as the oracle writes it: "E:<message>" for a FormulaParseException, else "X:...". */
export function err(e: unknown): string {
  if (e instanceof FormulaParseException) return 'E:' + e.javaMessage;
  if (e instanceof TypeError) return 'X:NullPointerException';
  if (e instanceof RangeError && e.message.startsWith('ArrayIndexOutOfBoundsException')) return 'X:ArrayIndexOutOfBoundsException';
  return 'X:' + (e instanceof Error ? e.name + ': ' + e.message : String(e));
}

function parse(s: string, a: boolean, b: boolean, c: boolean): [string, Expression | null] {
  try {
    const e = parseFormula(s, a, b, c);
    return [e == null ? 'N' : 'OK:' + e, e];
  } catch (e) {
    return [err(e), null];
  }
}

function find(e: Expression, target: Expression, p: ExpressionPath): ExpressionPath | null {
  if (e === target) return p.clone();
  for (let i = 0; i < e.getChildCount(); i++) {
    p.push(i);
    const r = find(e.getChild(i)!, target, p);
    p.depth--;
    if (r != null) return r;
  }
  return null;
}

function path(root: Expression, target: Expression | null): string {
  if (target == null) return '-';
  const p = find(root, target, new ExpressionPath());
  return p == null ? '?' : p.toString();
}

export function tree(root: Expression, e: Expression): string {
  let s = e.getKind() + ':' + e.getSymbol();
  if (e.displayAsInequality) s += '!';
  if (e instanceof SimpleTerm) s += '^' + path(root, e.getBinder());
  if (e.getChildCount() > 0) {
    s += '(' + e.children.map((c) => tree(root, c)).join(' ') + ')';
  }
  return s;
}

export function safe(f: () => unknown): string {
  try {
    const o = f();
    return o == null ? 'null' : String(o);
  } catch (e) {
    return err(e);
  }
}

function range(r: number[] | null): string {
  return r == null ? 'null' : r[0] + '-' + r[1];
}

function nodes(n: FormulaParseNode, out: string[]): void {
  out.push(
    [
      safe(() => range(n.getTextRange())),
      safe(() => n.toString()),
      safe(() => n.getNotationCode()),
      n.offset + ',' + n.length,
      safe(() => n.getOperatorRanges().toString()),
      safe(() => n.getPath().toString()),
    ].join(';'),
  );
  for (let i = 0; i < n.getChildCount(); i++) nodes(n.getChild(i)!, out);
}

function nodeData(n: FormulaParseNode): string {
  if (n.expression == null) return 'noexpr;' + safe(() => n.isParenthesizationValid());
  const out: string[] = [];
  nodes(n, out);
  return n.getStructureString() + '#' + safe(() => n.isParenthesizationValid()) + '#' + out.join('|');
}

function truth(e: Expression): string {
  const t = new TruthTableEvaluator(e);
  return t.sentenceLetters.map((l) => l + ',').join('') + '=' + t.rowResults.map((r) => (r ? '1' : '0')).join('');
}

export type FormulaRecord = Record<string, string | string[]>;

export function formulaRecord(s: string, formulas: Expression[] | null): FormulaRecord {
  const [p0] = parse(s, false, false, false);
  const [p1] = parse(s, true, false, false);
  const [p2, e] = parse(s, true, true, true);
  const r: FormulaRecord = { in: s, p0, p1, p2 };
  if (e == null) return r;
  if (formulas && e instanceof Formula && formulas.length < 3000) formulas.push(e);
  r.tree = tree(e, e);
  r.fmt = [e.toString(), e.formatFull(0), e.formatMinimal(-1), e.formatFull(-1), e.formatMinimal(1), e.toFullyParenthesizedString(), e.toCanonicalString()];
  r.nodeText = safe(() => nodeData(new FormulaParseNode(s)));
  r.nodeFmt = safe(() => nodeData(new FormulaParseNode(e, true, 0)));
  r.nodeFull = safe(() => nodeData(new FormulaParseNode(e, false, -1)));
  r.letters = safe(() => e.getSchematicLetters().join(','));
  r.free = safe(() => e.getFreeVariables().join(','));
  r.bound = safe(() => encodeBoundVariableNames(e.getBoundVariableNames()));
  r.tf = safe(() => e.toTruthFunctionalForm());
  r.ex = safe(() => e.expandQuantifiers(2, variableLetter(0)));
  r.ex3 = safe(() => e.expandQuantifiers(3, 'n'));
  r.exo = safe(() => e.expandOutermostQuantifier(2, variableLetter(0)));
  r.uc = safe(() => e.universalClosure());
  r.tt = safe(() => truth(e));
  r.ttf = safe(() => truth(e.toTruthFunctionalForm()));
  r.mis = safe(() => (e.findMislinkedVariables() == null ? 'none' : 'some'));
  r.self = safe(() => {
    const inst = new SchemeInstantiation();
    const ok = e.match(e.copy(), inst);
    return ok + ';' + inst.encode() + ';' + inst.pendingLettersToString() + ';' + inst.errorId;
  });
  return r;
}

export function equivalenceRecords(formulas: Expression[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < formulas.length; i++) {
    const a = formulas[i];
    const b = formulas[i + 1];
    out.push(
      safe(
        () =>
          TruthTableEvaluator.areEquivalent(a, b) +
          ',' +
          TruthTableEvaluator.areEquivalent(a.toTruthFunctionalForm(), b.toTruthFunctionalForm()) +
          ',' +
          TruthTableEvaluator.areEquivalent(a, a.toTruthFunctionalForm()),
      ),
    );
  }
  return out;
}

/** Compares a record with the oracle's; an "X:" (non-parse exception) matches any exception. */
export function diffRecord(expected: FormulaRecord, actual: FormulaRecord): string[] {
  const diffs: string[] = [];
  for (const k of Object.keys(expected)) {
    const x = JSON.stringify(expected[k]);
    const y = JSON.stringify(actual[k]);
    if (x === y) continue;
    if (typeof expected[k] === 'string' && (expected[k] as string).startsWith('X:') && String(actual[k]).startsWith('X:')) continue;
    diffs.push(`${JSON.stringify(expected.in)} ${k}: expected ${x} got ${y}`);
  }
  for (const k of Object.keys(actual)) if (!(k in expected)) diffs.push(`${JSON.stringify(expected.in)} extra ${k}: ${JSON.stringify(actual[k])}`);
  return diffs;
}
