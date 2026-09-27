import { type Expression } from '../../src/engine/formula/Expression';
import {
  diffRecord,
  equivalenceRecords,
  formulaFixture,
  formulaRecord,
  type FormulaRecord,
  loadEngine,
} from './formulaOracle';

/**
 * Every formula-like text of the notation's data files, their generated malformed mutations
 * and edge cases: parse results (three flag settings, exact error messages and positions),
 * trees and variable links, every printing mode, FormulaParseNode data, schematic letters,
 * free and bound variables, truth-functional form, quantifier expansion, universal closure,
 * truth tables, self-match; and truth-functional equivalence of consecutive formulas.
 */
export function formulaSuite(syntax: 1 | 2): void {
  const fixture = formulaFixture<{ syntax: number; items: FormulaRecord[]; equivalent: string[] }>(`formula-${syntax}.json`);
  const formulas: Expression[] = [];

  beforeAll(() => loadEngine(syntax));

  test(`formulas and errors match the desktop program (notation ${syntax})`, () => {
    expect(fixture.syntax).toBe(syntax);
    const diffs: string[] = [];
    for (const expected of fixture.items) diffs.push(...diffRecord(expected, formulaRecord(expected.in as string, formulas)));
    expect(diffs.slice(0, 40)).toEqual([]);
    expect(fixture.items.length).toBeGreaterThan(5000);
  });

  test(`truth-functional equivalence matches (notation ${syntax})`, () => {
    expect(equivalenceRecords(formulas)).toEqual(fixture.equivalent);
  });
}
