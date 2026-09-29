// Formula search in the problem lists (formulaSearch.ts, ProblemListModel.formulaSearch).
import { BinderMap } from '../../src/engine/formula/BinderMap';
import type { Expression } from '../../src/engine/formula/Expression';
import { parseFormula } from '../../src/engine/formula/parseFormula';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { alphaKey, indexStatement, parseSearchQuery, splitQuery, toMaggie } from '../../src/engine/problems/formulaSearch';
import { readExercises, readWork } from '../../src/engine/problems/LogicModule';
import { ProblemCounts, ProblemListModel } from '../../src/engine/problems/ProblemList';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { ArgumentParser } from '../../src/engine/rules/ArgumentParser';
import { repoData } from '../support/fsDataSource';
import { TestProblemSet } from '../support/coreModules';

async function list(module: number, key: string) {
  const ex = new TestProblemSet(module);
  await readExercises(ex, key);
  const set = new TestProblemSet(module);
  await readWork(set, key, null);
  set.exercises = ex;
  const model = new ProblemListModel(set, ex, {});
  model.formulaSearch = true;
  return { set, model, ex };
}

function shown(model: ProblemListModel, set: TestProblemSet, query: string): string[] {
  model.setFilter(query);
  return model.rowToProblem.filter((k) => k >= 0).map((k) => TaggedRecord.nameOf(set.getRecordAt(k))!);
}

describe('query parser', () => {
  beforeAll(() => loadProgram(repoData, { syntax: 1, loadRules: false }));

  test('splitting and quotes', () => {
    expect(splitQuery(' a  concl:"forall x Fx" "b c" ')).toEqual(['a', 'concl:forall x Fx', 'b c']);
    expect(splitQuery('""')).toEqual(['']);
  });

  test('terms', () => {
    const q = parseSearchQuery('T2 1.7 concl:Q prem:~P premise:"P -> Q" mc1');
    expect(q.hint).toBeNull();
    expect(q.terms.map((t) => [t.kind, t.kind === 'formula' ? t.place : '', t.text])).toEqual([
      ['formula', 'any', 't2'], // T2 is a sentence letter too: a name or a formula
      ['text', '', '1.7'],
      ['formula', 'conclusion', null],
      ['formula', 'premise', null],
      ['formula', 'premise', null],
      ['text', '', 'mc1'],
    ]);
    const f = parseSearchQuery('P->Q');
    expect(f.terms).toEqual([{ kind: 'formula', place: 'any', key: alphaKey(parseFormula('P->Q')!), formula: 'P->Q', text: 'p->q' }]);
  });

  test('a whole query that is one formula with blanks', () => {
    const q = parseSearchQuery('forall x (Fx -> Gx)');
    expect(q.terms.length).toBe(1);
    expect(q.terms[0]).toMatchObject({ kind: 'formula', place: 'any', key: alphaKey(parseFormula('@y(Fy->Gy)')!) });
  });

  test('symbols and variants are read as formulas', () => {
    expect(toMaggie('∀x(Fx→Gx)∧¬P')).toBe('@x(Fx->Gx)&~P');
    expect(toMaggie('P ⊃ Q ≡ R')).toBe('P -> Q <-> R');
    expect(parseSearchQuery('concl:P→Q').terms[0]).toMatchObject({ key: alphaKey(parseFormula('P->Q')!) });
  });

  test('hints for tagged terms that are not formulas; they do not filter', () => {
    expect(parseSearchQuery('concl:P->').hint).toMatch(/^concl:P-> is not a formula \(Parse error at position \d+\)\.$/);
    expect(parseSearchQuery('concl:P->').terms).toEqual([]);
    expect(parseSearchQuery('prem:').hint).toBe('Type a formula after prem:');
    // an untagged term that is not a formula is text
    expect(parseSearchQuery('P->').terms).toEqual([{ kind: 'text', text: 'p->' }]);
  });
});

describe('alpha-equivalence', () => {
  beforeAll(() => loadProgram(repoData, { syntax: 1, loadRules: false }));
  const k = (s: string) => alphaKey(parseFormula(s)!);

  test('bound variables are renamed, free ones are not', () => {
    expect(k('@xFx')).toBe(k('@yFy'));
    expect(k('@x@yF(xy)')).toBe(k('@y@xF(yx)'));
    expect(k('@x@yF(xy)')).not.toBe(k('@x@yF(yx)'));
    expect(k('Fx')).not.toBe(k('Fy'));
    expect(k('@x(Fx->!xGx)')).toBe(k('@z(Fz->!wGw)'));
    expect(k('P<>Q'.replace('<>', '->'))).toBe(k('P -> Q'));
  });

  test('agrees with the engine on the closed formulas of the course (both notations)', async () => {
    for (const syntax of [1, 2] as const) {
      await loadProgram(repoData, { syntax, loadRules: false });
      const set = new TestProblemSet(0);
      await readExercises(set, 'derwork.txt');
      const formulas: Expression[] = [];
      for (const r of set.records()) {
        const a = new ArgumentParser(set.getProblemStatement(new TaggedRecord(r)));
        for (const e of [...a.premises, a.conclusion]) if (e != null && e.getFreeVariables().length === 0) formulas.push(e);
      }
      expect(formulas.length).toBeGreaterThan(1000);
      const byKey = new Map<string, Expression[]>();
      for (const e of formulas) byKey.set(alphaKey(e), [...(byKey.get(alphaKey(e)) ?? []), e]);
      for (const group of byKey.values()) for (const e of group) expect(group[0].isAlphaEquivalent(e, new BinderMap())).toBe(true);
      // formulas with different keys are not alpha-equivalent (a sample of neighbours)
      for (let i = 0; i + 1 < formulas.length; i++) {
        const [a, b] = [formulas[i], formulas[i + 1]];
        if (alphaKey(a) !== alphaKey(b)) expect(a.isAlphaEquivalent(b, new BinderMap())).toBe(false);
      }
    }
  });
});

describe.each([1, 2] as const)('problem lists, notation %i', (syntax) => {
  beforeAll(() => loadProgram(repoData, { syntax }));

  test('derivations: premises, conclusion, anywhere; names and text as before', async () => {
    const { set, model, ex } = await list(0, 'derwork.txt');
    const counts = new ProblemCounts(set, ex, model);
    // Deriv 1.001: ~Q .: (P->Q)->~P
    const concl = shown(model, set, 'concl:"(P->Q)->~P"');
    expect(concl).toContain('Deriv 1.001');
    for (const n of concl) {
      const a = indexStatement(set.getStatement(set.getRecord(n)!));
      expect(a.conclusion.has(alphaKey(parseFormula('(P->Q)->~P')!))).toBe(true);
    }
    expect(shown(model, set, 'premise:~Q concl:"(P->Q)->~P"')).toContain('Deriv 1.001');
    expect(shown(model, set, 'prem:"(P->Q)->~P" concl:"(P->Q)->~P"')).not.toContain('Deriv 1.001');
    // anywhere: the premises' and the conclusion's matches together
    const any = shown(model, set, 'P->Q');
    expect(new Set(any)).toEqual(new Set([...shown(model, set, 'prem:P->Q'), ...shown(model, set, 'concl:P->Q')]));
    expect(any).toEqual(shown(model, set, 'P→Q'));
    expect(any.length).toBeGreaterThan(20);
    expect(counts.label('P->Q')).toMatch(/\(matches: \d+, \d+ of \d+ completed\)$/);
    // quantified formulas, up to renaming of bound variables
    const q1 = shown(model, set, 'concl:"forall y Gy"');
    expect(q1.length).toBeGreaterThan(0);
    expect(q1).toEqual(shown(model, set, 'concl:"forall z Gz"'));
    expect(q1).toEqual(shown(model, set, 'concl:@wGw'));
    expect(shown(model, set, 'forall x (Fx -> Gx)')).toEqual(shown(model, set, '"forall z (Fz -> Gz)"'));
    // the desktop's search is unchanged
    const plain = new ProblemListModel(set, ex, {});
    for (const q of ['t2', '1.7', 'deriv 1.', 'dist', 'zzz', 'MC1 T2']) {
      plain.setFilter(q);
      model.setFilter(q);
      expect(model.rowToProblem, q).toEqual(plain.rowToProblem);
    }
    // an invalid tagged term: a hint, and no filtering by it
    model.setFilter('concl:P-> 1.00');
    expect(model.searchHint).toMatch(/not a formula/);
    plain.setFilter('1.00');
    expect(model.rowToProblem).toEqual(plain.rowToProblem);
  });

  test('truth tables: a single formula is the conclusion', async () => {
    const { set, model } = await list(5, 'truwork.txt');
    // TruTb 2.000: (P->Q)|(Q->P)
    expect(shown(model, set, 'concl:"(P->Q)|(Q->P)"')).toContain('TruTb 2.000');
    expect(shown(model, set, 'prem:"(P->Q)|(Q->P)"')).not.toContain('TruTb 2.000');
    expect(shown(model, set, 'Q->P')).toContain('TruTb 2.000');
  });

  test('every module with formulas is searchable, and the index is fast', async () => {
    for (const [module, key, query] of [
      [1, 'invwork.txt', 'P'],
      [2, 'parwork.txt', 'P'],
      [3, 'recwork.txt', 'P'],
      [0, 'derwork.txt', 'P'],
    ] as const) {
      const { set, model } = await list(module, key);
      const t0 = performance.now();
      const found = shown(model, set, query);
      const first = performance.now() - t0;
      expect(found.length, key).toBeGreaterThan(0);
      const t1 = performance.now();
      shown(model, set, 'concl:' + query);
      expect(performance.now() - t1, key).toBeLessThan(Math.max(50, first));
    }
  });
});
