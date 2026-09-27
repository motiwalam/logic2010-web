/**
 * Port of ArgumentParser.java: splits "P . Q .: R" into premises and a conclusion (each
 * parsed with parseFormula), and matches rules against the argument (matchRule, used by the
 * Recognition module).
 *
 * Java records the matches as RuleApplication objects (a derivation Justification); here they
 * are RuleMatch records with the same parts (form, premise order, instantiation, bound
 * variables), from which the derivation module can build its RuleApplications.
 */
import type { Expression } from '../formula/Expression';
import { ConnectiveFormula, Formula, SimpleTerm } from '../formula/Expression';
import { FormulaParseException, parseFormula } from '../formula/parseFormula';
import { SchemeInstantiation } from '../formula/SchemeInstantiation';
import { javaTrim } from '../util/java';
import { BoundVariableMap } from './BoundVariableMap';
import { PermutationIterator } from './PermutationIterator';
import type { Rule, SchematicRule } from './Rule';

/** A rule form applied to the argument: premise i of the argument is form.premises[premiseOrder[i]]. */
export interface RuleMatch {
  form: SchematicRule;
  premiseOrder: number[];
  instantiation: SchemeInstantiation;
  boundVariables: BoundVariableMap;
}

function tryParse(s: string, allowTerm = false, allowPlaceholders = false, allowUnknowns = false): Expression | null | undefined {
  try {
    return parseFormula(s, allowTerm, allowPlaceholders, allowUnknowns);
  } catch (e) {
    if (e instanceof FormulaParseException) return undefined;
    throw e;
  }
}

export class ArgumentParser {
  static readonly ERROR_MESSAGES = ['no error', 'no conclusion', 'no premises or conclusion'];

  source: string | null;
  premiseTexts: string[] = [];
  conclusionText: string | null = null;
  /** The premises (null where one does not parse). */
  premises: (Expression | null)[] = [];
  conclusion: Expression | null = null;
  conclusionOnly = false;
  premiseMatches: RuleMatch[] | null = null;
  fullMatches: RuleMatch[] | null = null;

  /** allowUnknowns: ?ABC unknowns are allowed in the conclusion. */
  constructor(s: string | null, allowUnknowns = false) {
    this.source = s;
    if (s == null) return;
    if ((this.conclusionOnly = s.indexOf('.') === -1)) s = '.:' + s;
    const i = s.indexOf('.:');
    if (i !== -1) {
      this.conclusionText = javaTrim(s.substring(i + 2));
      this.conclusion = tryParse(this.conclusionText, false, false, allowUnknowns) ?? null;
      s = s.substring(0, i);
    }
    const texts: string[] = [];
    const premises: (Expression | null)[] = [];
    while (s.length > 0) {
      const j = s.indexOf('.');
      const text = javaTrim(j === -1 ? s : s.substring(0, j));
      s = j === -1 ? '' : s.substring(j + 1);
      const e = tryParse(text);
      if (e === undefined) {
        texts.push(text);
        premises.push(null);
      } else if (e != null) {
        texts.push(text);
        premises.push(e);
      }
    }
    this.premiseTexts = texts;
    this.premises = premises;
  }

  static parse(s: string | null): ArgumentParser | null {
    return s == null ? null : new ArgumentParser(s);
  }

  /** Collapses runs of dots (". ." to ".") and drops a leading and a trailing dot. */
  static normalizeDots(s: string | null): string | null {
    if (s == null) return null;
    let t = s;
    let before: string;
    do {
      before = t;
      t = t.replace(/\.( *\.)/g, '$1');
    } while (t !== before);
    return t.replace(/^ *\.(.*)\. *$/, '$1');
  }

  getUnparsedText(): string | null {
    for (let j = 0; j < this.premises.length; j++) {
      if (this.premises[j] == null) return this.premiseTexts[j];
    }
    return this.conclusion == null && this.conclusionText != null && this.conclusionText !== '' ? this.conclusionText : null;
  }

  /** 0 no error, 1 no conclusion, 2 no premises or conclusion; conclusionOnly counts as 1 unless allowed. */
  getErrorCode(allowConclusionOnly = true): number {
    if (this.source == null || (this.conclusionText != null && this.conclusionText !== '')) {
      return !allowConclusionOnly && this.conclusionOnly ? 1 : 0;
    }
    return this.premises.length === 0 ? 2 : 1;
  }

  static describeError(parser: ArgumentParser | null, nullIfFine: boolean, allowConclusionOnly: boolean): string | null {
    if (parser == null) return ArgumentParser.ERROR_MESSAGES[2];
    const unparsed = parser.getUnparsedText();
    if (unparsed != null) return 'could not parse "' + unparsed + '"';
    const code = parser.getErrorCode(allowConclusionOnly);
    return code === 0 && nullIfFine ? null : ArgumentParser.ERROR_MESSAGES[code];
  }

  describeError(nullIfFine: boolean, allowConclusionOnly: boolean): string | null {
    return ArgumentParser.describeError(this, nullIfFine, allowConclusionOnly);
  }

  /**
   * Matches the rule's forms against the argument, in every order of the premises.
   * Returns 0 if no form's premises match, 1 if premises match but no conclusion does, 2 for
   * a full match (premiseMatches / fullMatches hold the matches). An EI match counts only if
   * the instantiated term is a simple term.
   */
  matchRule(rule: Rule | null): number {
    if (rule == null || this.describeError(true, true) != null) {
      this.premiseMatches = null;
      this.fullMatches = null;
      return 0;
    }
    const n = this.premises.length;
    const premises = this.premises as Expression[];
    const full: RuleMatch[] = [];
    const partial: RuleMatch[] = [];
    for (const form of rule.getAllForms()) {
      if ((form.premises == null ? 0 : form.premises.length) !== n) continue;
      const conclusionInst = new SchemeInstantiation();
      const conclusionMatches = form.conclusion!.match(this.conclusion, conclusionInst);
      const permutations = new PermutationIterator(n);
      do {
        const order = permutations.current();
        const inst = new SchemeInstantiation();
        const bound = new BoundVariableMap();
        this.matchPermutation(form, order, premises, inst, bound, conclusionMatches, conclusionInst, partial, full);
      } while (permutations.next());
    }
    this.premiseMatches = partial.length === 0 ? null : partial;
    this.fullMatches = full.length === 0 ? null : full;
    return this.premiseMatches == null ? 0 : this.fullMatches == null ? 1 : 2;
  }

  private matchPermutation(
    form: SchematicRule,
    order: number[],
    premises: Expression[],
    inst: SchemeInstantiation,
    bound: BoundVariableMap,
    conclusionMatches: boolean,
    conclusionInst: SchemeInstantiation,
    partial: RuleMatch[],
    full: RuleMatch[],
  ): void {
    const n = premises.length;
    let deferred = false;
    if (n > 0) {
      const insts: SchemeInstantiation[] = [];
      for (let l = 0; l < n; l++) {
        insts[l] = new SchemeInstantiation();
        if (!form.premises[order[l]].match(premises[l], insts[l])) return;
      }
      for (let k = 0; k < n; k++) {
        if (!inst.mergeFrom(insts[k])) return;
      }
      if (inst.hasNoDeferredMatches()) {
        for (let l = 0; l < n; l++) {
          if (!bound.matches(form.premises[order[l]], premises[l], inst)) return;
        }
      } else {
        deferred = true;
      }
    }
    if (!deferred) partial.push({ form, premiseOrder: order, instantiation: inst.clone(), boundVariables: bound.clone() });
    if (!(conclusionMatches && inst.mergeFrom(conclusionInst) && inst.hasNoDeferredMatches())) return;
    if (deferred) {
      for (let j = 0; j < n; j++) {
        if (!bound.matches(form.premises[order[j]], premises[j], inst)) return;
      }
      partial.push({ form, premiseOrder: order, instantiation: inst.clone(), boundVariables: bound.clone() });
    }
    if (bound.matches(form.conclusion!, this.conclusion, inst)) {
      if (form.name.toUpperCase() === 'EI') {
        const term = form.getConclusion()!.getChild(0)!.instantiate(inst);
        if (!(term instanceof SimpleTerm)) return;
      }
      full.push({ form, premiseOrder: order, instantiation: inst, boundVariables: bound });
    }
  }

  /** The argument as one formula: premise1 & premise2 & ... -> conclusion (null if not possible). */
  toConditional(): Expression | null {
    if (this.getUnparsedText() != null || this.getErrorCode() !== 0) return null;
    if (this.premises.length === 0) return this.conclusion!.copy();
    let e: Expression = this.premises[0]!.copy();
    if (!(e instanceof Formula) || !(this.conclusion instanceof Formula)) return null;
    for (let j = 1; j < this.premises.length; j++) {
      if (!(this.premises[j] instanceof Formula)) return null;
      const c = new ConnectiveFormula('&');
      c.setLeft(e as Formula);
      c.setRight(this.premises[j]!.copy() as Formula);
      e = c;
    }
    const c = new ConnectiveFormula('->');
    c.setLeft(e as Formula);
    c.setRight(this.conclusion.copy() as Formula);
    return c;
  }

  toString(): string {
    return this.format('.', '.:');
  }

  format(separator: string, therefore: string): string {
    if (this.conclusionOnly) return String(this.conclusionText);
    let s = '';
    for (let j = 0; j < this.premises.length; j++) s += (j === 0 ? '' : separator) + this.premiseTexts[j];
    if (this.conclusionText != null) s += therefore + this.conclusionText;
    return s;
  }
}
