import { formulaFixture, loadEngine } from './formulaOracle';
import { type RulesFixture, rulesRecord } from './rulesOracle';

/**
 * The rule and theorem tables (names, forms, headings, properties, converses, RT rules of
 * every theorem, findRule), ArgumentParser.matchRule for every recognition argument x every
 * rule (codes, instantiations, bound variables, results, highlighted displays, encode/decode
 * round trips), decoding the instantiations saved in the data files, PermutationIterator.
 */
export function rulesSuite(syntax: 1 | 2): void {
  const fixture = formulaFixture<RulesFixture>(`rules-${syntax}.json`);
  let actual: RulesFixture;
  beforeAll(async () => {
    await loadEngine(syntax);
    actual = rulesRecord(syntax);
  });
  for (const key of ['rules', 'theorems', 'converseRules', 'converseTheorems', 'find', 'recognition', 'instantiations', 'permutations', 'schemes', 'cases'] as const) {
    test(`${key} match the desktop program (notation ${syntax})`, () => {
      expect(actual[key]).toEqual(fixture[key]);
    });
  }
}
