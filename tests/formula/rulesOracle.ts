/** The TypeScript side of tools/oracle/.../OracleRules.java. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BinderMap } from '../../src/engine/formula/BinderMap';
import type { Expression } from '../../src/engine/formula/Expression';
import { ExpressionPath } from '../../src/engine/formula/ExpressionPath';
import { parseFormula } from '../../src/engine/formula/parseFormula';
import { SchemeInstantiation } from '../../src/engine/formula/SchemeInstantiation';
import { ArgumentParser } from '../../src/engine/rules/ArgumentParser';
import { BoundVariableMap } from '../../src/engine/rules/BoundVariableMap';
import type { HighlightedText } from '../../src/engine/rules/HighlightedText';
import { PermutationIterator } from '../../src/engine/rules/PermutationIterator';
import { type Rule, type SchematicRule } from '../../src/engine/rules/Rule';
import { RuleApplicationDisplay, type DisplayableApplication } from '../../src/engine/rules/RuleApplicationDisplay';
import { RuleProperties } from '../../src/engine/rules/RuleProperties';
import { ruleTable } from '../../src/engine/rules/RuleTable';
import { err, safe } from './formulaOracle';

/** Java's TreeMap.toString of message parameters. */
function params(m: Map<string, string> | null): string {
  if (m == null) return '';
  const keys = [...m.keys()].sort();
  return '{' + keys.map((k) => k + '=' + m.get(k)).join(', ') + '}';
}

function list(v: readonly unknown[] | null | undefined): string {
  return v == null ? 'null' : v.map(String).join('|');
}

function forms(r: Rule | null): string {
  if (r == null) return 'null';
  const p = ruleTable!.properties;
  return r
    .getAllForms()
    .map((f) => {
      let b = f.name + '=' + f.format('.', '.:');
      b +=
        ' [' +
        (p.hasProperty(f, 'notConditional') ? 'nc ' : '') +
        (p.hasProperty(f, 'notConditionalBC') ? 'ncbc ' : '') +
        (p.hasProperty(f, 'biconditional') ? 'bic ' : '') +
        (p.hasProperty(f, 'hasConverse') ? 'conv ' : '') +
        list(p.getConverses(f)) +
        ']';
      b += ' from=' + RuleProperties.getFromSide(f, false) + ' to=' + RuleProperties.getToSide(f, false);
      b += ' rfrom=' + safe(() => RuleProperties.getFromSide(f, true));
      b += ' cfrom=' + safe(() => RuleProperties.getConditionalFromSide(f, true, false));
      b += ' cto=' + safe(() => RuleProperties.getConditionalToSide(f, false, true));
      b += ' copy=' + safe(() => f.copyRule().format('.', '.:'));
      return b;
    })
    .join(' ; ');
}

function className(r: Rule): string {
  return r.constructor.name;
}

function rule(r: Rule | null): string {
  if (r == null) return 'null';
  const p = ruleTable!.properties;
  return [
    className(r),
    r.name,
    r.toString(),
    r.sourceTheorem == null ? '-' : r.sourceTheorem.name,
    r.testProperty(p, 'hasConverse', true),
    r.testProperty(p, 'biconditional', false),
    forms(r),
  ].join(':');
}

/** The derivation module's RuleApplication, as far as the display needs it. */
class Application implements DisplayableApplication {
  constructor(
    readonly form: SchematicRule,
    readonly premiseOrder: number[],
    public instantiation: SchemeInstantiation,
    public boundVariables: BoundVariableMap,
  ) {}

  clone(): Application {
    return new Application(this.form, this.premiseOrder.slice(), this.instantiation.clone(), this.boundVariables.clone());
  }

  getPremiseCount(): number {
    return this.form.premises.length;
  }

  private inst(e: Expression): Expression {
    const binders = new BinderMap();
    const result = e.instantiate(this.instantiation, binders);
    this.boundVariables.renameBinders(e, result, binders);
    return result;
  }

  getPremise(i: number): Expression {
    return this.inst(this.form.premises[this.premiseOrder[i]]);
  }

  getConclusion(): Expression {
    return this.inst(this.form.conclusion!);
  }
}

function text(h: HighlightedText): string {
  let b = h.text ?? 'null';
  for (const l of h.layers ?? []) b += ' ' + String(l);
  return b;
}

function display(a: Application): string {
  return text(new RuleApplicationDisplay(a).toHighlightedText()) + ' / ' + text(new RuleApplicationDisplay(a).toHighlightedText(false));
}

function readInputs(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as string);
}

export interface RulesFixture {
  syntax: number;
  rules: string[];
  theorems: string[];
  converseRules: string;
  converseTheorems: string;
  find: string[];
  recognition: string[];
  instantiations: string[];
  permutations: string[];
  cases: string[];
  schemes: string[];
}

export function rulesRecord(syntax: number): RulesFixture {
  const table = ruleTable!;
  const theorems = table.theorems!;
  const dir = join(__dirname, '../fixtures/formula');
  const out: RulesFixture = {
    syntax,
    rules: table.ruleNames.map((n) => rule(table.getRule(n)) + ' H=' + list(table.headings.get(n))),
    theorems: theorems.numbers().map((n) => {
      const t = theorems.getTheorem(n)!;
      let b = n + ':' + t + ':H=' + list(theorems.headings.get(n));
      for (const suffix of ['', 'L', 'LF', 'R', 'RF', 'X']) b += ' || RT' + n + suffix + '=' + rule(table.findRule('RT' + n + suffix));
      b += ' || T=' + rule(table.findRule('t' + n));
      return b;
    }),
    converseRules: list(table.properties.getRulesWithConverse(table)),
    converseTheorems: table.properties.getTheoremsWithConverse(theorems).toString(),
    find: ['dn', 'DN', 'T0', 'T01', 't2', 'RT0', 'RT01', 'rt2', 'RT2L', 'RT99999', 'T99999', 'XYZ', 'RT1x', 'Mp', 'S'].map(
      (n) => n + '=' + rule(table.findRule(n)),
    ),
    recognition: [],
    instantiations: [],
    permutations: [],
    schemes: [],
    cases: [],
  };
  const names = [...table.ruleNames];
  for (let i = 1; i <= 60; i += 7) names.push('T' + i);
  names.push('RT4', 'RT32L');
  for (const argument of readInputs(join(dir, `recognition-args-${syntax}.txt`))) {
    const p = new ArgumentParser(ArgumentParser.normalizeDots(argument));
    let b = argument + ' => ' + p + ' err=' + p.describeError(true, true) + ' cond=' + p.toConditional();
    for (const n of names) {
      let code: number;
      try {
        code = p.matchRule(table.findRule(n));
      } catch (e) {
        b += ' || ' + n + '=' + err(e);
        continue;
      }
      if (code === 0) continue;
      b += ' || ' + n + '=' + code + ' pm=' + p.premiseMatches!.length;
      for (const m of p.premiseMatches!) {
        const a = new Application(m.form, m.premiseOrder, m.instantiation, m.boundVariables);
        b += ' {' + m.form.name + ExpressionPath.format(m.premiseOrder) + m.instantiation.encode();
        b += ' pend=' + m.instantiation.pendingLettersToString() + ' d=' + safe(() => display(a)) + '}';
      }
      for (const m of p.fullMatches ?? []) {
        const a = new Application(m.form, m.premiseOrder, m.instantiation, m.boundVariables);
        b += ' [' + m.form.name + ExpressionPath.format(m.premiseOrder) + m.instantiation.encode() + ',' + m.boundVariables.encode();
        b += ' pend=' + m.instantiation.pendingLettersToString();
        b += ' c=' + safe(() => a.getConclusion());
        b += ' d=' + safe(() => display(a));
        b +=
          ' dec=' +
          safe(() => {
            const d = SchemeInstantiation.decode(m.instantiation.encode());
            return d == null ? 'null' : d.encode() + '/' + BoundVariableMap.decode(m.boundVariables.encode()).encode();
          });
        b += ']';
      }
    }
    out.recognition.push(b);
  }
  for (const s of readInputs(join(dir, `instantiations-${syntax}.txt`))) {
    const r = safe(() => {
      const d = SchemeInstantiation.decode(s);
      if (d == null) return 'null';
      let b = d.encode();
      for (const l of d.keys()) b += ' ' + l + '->' + d.getReplacement(l)!.replacement;
      const c = d.clone();
      c.addReplacement('Z', '~Z');
      return b + ' clone=' + c.encode() + ' err=' + c.errorId;
    });
    out.instantiations.push(s + ' => ' + r);
  }
  const sample: Expression[] = [];
  let k = 0;
  for (const s of readInputs(join(dir, `formula-inputs-${syntax}.txt`))) {
    try {
      const e = parseFormula(s);
      if (e != null && k++ % 9 === 0 && sample.length < 120) sample.push(e);
    } catch {
      // not a formula
    }
  }
  for (const name of table.ruleNames) {
    for (const f of table.getRule(name)!.getAllForms()) {
      if (f.premises.length === 0) continue;
      let b = f.name;
      for (const e of sample) {
        const inst = new SchemeInstantiation();
        let ok: boolean;
        try {
          ok = f.premises[0].match(e, inst);
        } catch (x) {
          b += ' | ' + e + ' ' + err(x);
          continue;
        }
        const extra = safe(() => {
          const c = new SchemeInstantiation();
          const r1 = f.conclusion!.match(e, c);
          let r = r1 + ':' + c.errorId + params(c.errorParams) + ':' + c.encode() + ':' + c.pendingLettersToString();
          if (f.premises.length > 1 && sample.indexOf(e) % 8 === 0) {
            for (let j = 0; j < sample.length; j += 5) {
              const d = new SchemeInstantiation();
              const d2 = new SchemeInstantiation();
              const a1 = f.premises[0].match(e, d);
              const a2 = a1 && f.premises[1].match(sample[j], d2) && d.mergeFrom(d2);
              if (a2 || d.errorId != null) {
                r += ' two' + j + '=' + a1 + a2 + ':' + d.errorId + params(d.errorParams) + ':' + d.encode() + ':' + d.pendingLettersToString();
              }
            }
          }
          return r;
        });
        if (!extra.startsWith('false:null:') || extra.includes('true')) b += ' x=' + extra;
        if (!ok && inst.errorId == null) continue;
        b += ' | ' + e + ' ' + ok + ' ' + inst.errorId + params(inst.errorParams);
        if (ok) {
          b += ' ' + inst.encode() + ' pend=' + inst.pendingLettersToString();
          b += ' c=' + safe(() => f.conclusion!.instantiate(inst));
          b += ' full=' + safe(() => f.conclusion!.isFullyInstantiated(inst));
          b +=
            ' fresh=' +
            safe(() => {
              const c = inst.clone();
              const fr = c.assignFreshLetters(f.conclusion);
              return fr.pendingLettersToString() + '/' + c.encode() + '/' + f.conclusion!.instantiate(c);
            });
        }
      }
      out.schemes.push(b);
    }
  }
  for (const r of ["F{1}:G{1}", "F({1}{1}):G{1}", "F(a):Ga", "a:Fa", "A:Fa", "P:a", "F{1}:{1}", "@xFx:P", "P&Q:R", "x:y", "noColon", "F{1}:G{2}", "A({1}):B({1}{1})", "a:A(b)", "P:(", "{1}:a", "F({1}{2}):G({2}{1})", "P:?A", "F{1}:@x(Fx&G{1})"]) {
    const d = new SchemeInstantiation();
    const ok = d.parseReplacement(r);
    out.cases.push(r + ' ' + ok + ' ' + d.errorId + params(d.errorParams) + ' ' + d.encode());
  }
  for (const [p0, p1] of [["@xFA", "@yGy"], ["@x@yF(xx)", "@x@yG(xy)"], ["@x@yF(xy)", "@x@yG(xx)"], ["@xFx", "@y(Gy&P)"], ["Fa", "Gb"], ["a=A", "b=c"], ["@x(Fx&Fx)", "@y(Gy&Hy)"], ["@x(Fx->P)", "@y(Gy->Q)"], ["@xF(xA)", "@yG(yb)"], ["!x(Fx&Gx)", "!y(Hy&Iy)"], ["@xFx", "@yFA"], ["%xFx=a", "%yGy=b"], ["@x(Fx&P)", "@y(Gy&y=y)"], ["F(A)", "P&Q"], ["@x@yF(xy)", "@z@wG(wz)"], ["@xFx", "@y@zG(yz)"], ["@x(Fx&Gx)", "@y(Hy&Hy)"], ["@xA(x)=a", "@yb(y)=c"], ["@x!yF(xy)", "@z!wG(zw)"], ["@xFx", "@y!zG(yz)"]]) {
    out.cases.push(
      p0 + ' ~ ' + p1 + ' ' +
        safe(() => {
          const a = parseFormula(p0, true, true)!;
          const b = parseFormula(p1, true, true)!;
          const d = new SchemeInstantiation();
          const bm = new BinderMap();
          const ok = a.match(b, d, bm);
          const bv = new BoundVariableMap();
          return (
            ok + ' ' + d.errorId + params(d.errorParams) + ' ' + d.encode() + ' pend=' + d.pendingLettersToString() +
            ' nodef=' + d.hasNoDeferredMatches() + ' inst=' + safe(() => a.instantiate(d)) + ' bv=' + bv.matchBinders(a, b, bm) + ':' + bv.encode() +
            ' vm=' + safe(() => new BoundVariableMap().matches(a, b, d))
          );
        }),
    );
  }
  for (let n = 0; n <= 4; n++) {
    const it = new PermutationIterator(n);
    let b = '';
    do b += it.toString() + ExpressionPath.format(it.getCounters() ?? []);
    while (it.next());
    b += ' end ' + it;
    out.permutations.push(b);
  }
  return out;
}
