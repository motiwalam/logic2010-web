/**
 * Formula search in the problem lists (a web addition; the desktop's search is by name and
 * by what a problem proves only, ProblemListView.setFilter).
 *
 * A query is split into terms at blanks (a "quoted" part may contain blanks); every term must
 * match. A term is:
 *   - `concl:F` / `conclusion:F`: F occurs in the conclusion;
 *   - `premise:F` / `prem:F`: F occurs in some premise;
 *   - anything else: matched as before (name, what the problem proves; see matchesTerm),
 *     and, when it is a formula, also where it occurs in a premise or the conclusion.
 * A whole query without tags that is one formula containing blanks ("forall x Fx") is one term.
 *
 * "Occurs" means F is a subformula, compared structurally up to the renaming of the variables
 * F binds itself (alphaKey): `exists y Gy` finds `~exists x Gx`, and `Fx` finds the Fx in
 * `forall x (Fx -> Gx)`. Formulas are read in the current notation, typed in ASCII (P->Q), in
 * the display symbols (P→Q) or with quantifier words. A problem that is a single formula
 * (a tautology, a formula to parse) has it as its conclusion; a set of formulas (consistency)
 * has them as premises.
 *
 * A tagged term whose formula does not parse matches everything and gives a hint instead.
 */
import { Expression, Formula, QuantifiedFormula, DescriptionTerm, SimpleTerm } from '../formula/Expression';
import { FormulaParseException, parseFormula } from '../formula/parseFormula';
import { ArgumentParser } from '../rules/ArgumentParser';
import { kaplan1, kaplan2, kaplan3, kaplan4, maggie, symbols, translateSymbols } from '../program/symbols';

/** Other characters people type or paste for the connectives, and their maggie forms. */
const VARIANTS: readonly [string, string][] = [
  ['¬', '~'],
  ['⊃', '->'],
  ['≡', '<->'],
  ['⇒', '->'],
  ['⇔', '<->'],
  ['·', '&'],
  ['∈', '[m]'],
];

export type SearchPlace = 'any' | 'premise' | 'conclusion';

export type SearchTerm =
  | { kind: 'text'; text: string }
  | { kind: 'formula'; place: SearchPlace; key: string; formula: string; /** the term as text, for untagged terms */ text: string | null };

export interface ParsedQuery {
  terms: SearchTerm[];
  /** Why part of the query was ignored (a tagged term that is not a formula), or null. */
  hint: string | null;
}

const TAGS: Readonly<Record<string, SearchPlace>> = {
  concl: 'conclusion',
  conclusion: 'conclusion',
  premise: 'premise',
  prem: 'premise',
  premises: 'premise',
};

/** The formula text in maggie notation (display symbols and common variants translated). */
export function toMaggie(s: string): string {
  let t = s;
  for (const [from, to] of VARIANTS) if (t.includes(from)) t = t.split(from).join(to);
  for (const table of [symbols, kaplan2, kaplan1, kaplan3, kaplan4]) t = translateSymbols(t, table.slice(0, 11), maggie.slice(0, 11));
  return t;
}

/** The formula, or the parse error's message. */
export function parseSearchFormula(text: string): Expression | string {
  try {
    const e = parseFormula(toMaggie(text));
    return e ?? 'empty';
  } catch (err) {
    if (err instanceof FormulaParseException) return err.message;
    return String(err);
  }
}

/**
 * A string that is equal for alpha-equivalent formulas: the tree's symbols, with each
 * variable bound inside e written as the distance to its binder, and every other variable
 * (free, or bound outside e) by name.
 */
export function alphaKey(e: Expression): string {
  const binders: Expression[] = [];
  const walk = (x: Expression): string => {
    if (x instanceof SimpleTerm) {
      const b = x.getBinder();
      const i = b == null ? -1 : binders.lastIndexOf(b);
      return i === -1 ? 'v' + x.getSymbol() : '#' + (binders.length - 1 - i);
    }
    const binds = x instanceof QuantifiedFormula || x instanceof DescriptionTerm;
    if (binds) binders.push(x);
    let s = x.getKind() + ':' + x.getSymbol() + '(';
    for (let i = binds ? 1 : 0; i < x.getChildCount(); i++) s += (i > (binds ? 1 : 0) ? '\u0001' : '') + walk(x.getChild(i)!);
    if (binds) binders.pop();
    return s + ')';
  };
  return walk(e);
}

/** The keys of every subformula of e (e included). */
export function subformulaKeys(e: Expression, into: Set<string> = new Set()): Set<string> {
  if (e instanceof Formula) into.add(alphaKey(e));
  for (let i = 0; i < e.getChildCount(); i++) {
    const c = e.getChild(i);
    if (c != null) subformulaKeys(c, into);
  }
  return into;
}

/** The subformulas of a problem's premises and conclusion. */
export interface ProblemFormulas {
  premises: Set<string>;
  conclusion: Set<string>;
}

/** Indexes a problem statement (an argument "P . Q .: R", a single formula, or formulas). */
export function indexStatement(statement: string | null): ProblemFormulas {
  const out: ProblemFormulas = { premises: new Set(), conclusion: new Set() };
  if (statement == null) return out;
  let parser: ArgumentParser;
  try {
    parser = new ArgumentParser(statement);
  } catch {
    return out;
  }
  for (const p of parser.premises) if (p != null) subformulaKeys(p, out.premises);
  if (parser.conclusion != null) subformulaKeys(parser.conclusion, out.conclusion);
  return out;
}

/** Splits at blanks, keeping "quoted parts" (quotes removed) together. */
export function splitQuery(query: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let started = false;
  for (const c of query) {
    if (c === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(c)) {
      if (started) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

/** Parses a search query into terms (see the header). */
export function parseSearchQuery(query: string): ParsedQuery {
  const q = query.trim();
  const terms: SearchTerm[] = [];
  const hints: string[] = [];
  if (q === '') return { terms, hint: null };
  // a whole untagged query that is one formula with blanks, e.g. "forall x (Fx -> Gx)"
  if (/\s/.test(q) && !q.includes('"') && !/(^|\s)[a-z]+:/i.test(q)) {
    const e = parseSearchFormula(q);
    if (e instanceof Expression) return { terms: [{ kind: 'formula', place: 'any', key: alphaKey(e), formula: q, text: null }], hint: null };
  }
  for (const token of splitQuery(q)) {
    const m = /^([A-Za-z]+):(.*)$/s.exec(token);
    const place = m ? TAGS[m[1].toLowerCase()] : undefined;
    if (m && place) {
      const f = m[2].trim();
      if (f === '') {
        hints.push(`Type a formula after ${m[1]}:`);
        continue;
      }
      const e = parseSearchFormula(f);
      if (e instanceof Expression) terms.push({ kind: 'formula', place, key: alphaKey(e), formula: f, text: null });
      else hints.push(`${m[1]}:${f} is not a formula (${e.replace(/\.$/, '')}).`);
      continue;
    }
    const text = token.toLowerCase();
    const e = /[A-Za-z]/.test(token) ? parseSearchFormula(token) : null;
    terms.push(e instanceof Expression ? { kind: 'formula', place: 'any', key: alphaKey(e), formula: token, text } : { kind: 'text', text });
  }
  return { terms, hint: hints.length === 0 ? null : hints.join(' ') };
}

/** Whether a problem's formulas contain the term's formula where the term says. */
export function formulaTermMatches(term: Extract<SearchTerm, { kind: 'formula' }>, f: ProblemFormulas): boolean {
  if (term.place !== 'conclusion' && f.premises.has(term.key)) return true;
  return term.place !== 'premise' && f.conclusion.has(term.key);
}

/** The search syntax, for the list's help tip. */
export const FORMULA_SEARCH_HELP: readonly [string, string][] = [
  ['T2   MC1   1.7', 'a problem name, or a rule it proves'],
  ['P->Q   or   P→Q', 'problems where the formula occurs'],
  ['concl:Q', 'the formula occurs in the conclusion'],
  ['premise:~P   (or prem:)', 'the formula occurs in a premise'],
  ['concl:"forall x Fx"', 'quote a formula with blanks'],
];
