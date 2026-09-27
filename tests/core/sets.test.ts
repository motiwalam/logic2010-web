// ProblemSelector and IntervalSet operations (OracleCore sets).
import { IntervalSet } from '../../src/engine/program/IntervalSet';
import { ProblemSelector } from '../../src/engine/program/ProblemSelector';
import { coreFixture } from '../support/fixtures';

const f = coreFixture<{
  selectors: [string, string, string, string, string, string, string, boolean, number, boolean][];
  pool: string[];
  intervals: [string, string, string, string, string, number[], string, number][];
}>('sets.json');

test('ProblemSelector parse, union/intersect/subtract, contains, flags', () => {
  for (const [a, b, op, sa, sb, result, bits, empty, hash, eq] of f.selectors) {
    const pa = new ProblemSelector(a);
    const pb = new ProblemSelector(b);
    expect(pa.toString()).toBe(sa);
    expect(pb.toString()).toBe(sb);
    const r = op === 'union' ? pa.union(pb) : op === 'intersect' ? pa.intersect(pb) : pa.subtract(pb);
    expect(r.toString(), `${a} ${op} ${b}`).toBe(result);
    let got = '';
    for (const n of f.pool) got += r.contains(n) ? '1' : '0';
    for (const c of 'uvx') got += r.hasFlag(c) ? '1' : '0';
    expect(got).toBe(bits);
    expect(r.isEmpty()).toBe(empty);
    expect(r.hashCode()).toBe(hash);
    expect(new ProblemSelector(a).equals(new ProblemSelector(b))).toBe(eq);
  }
});

test('IntervalSet', () => {
  for (const [a, b, op, result, bits, elements, chars, hash] of f.intervals) {
    const pa = new IntervalSet(a);
    const pb = new IntervalSet(b);
    const r = op === 'union' ? pa.union(pb) : op === 'intersect' ? pa.intersect(pb) : pa.subtract(pb);
    expect(r.toString(), `${a} ${op} ${b}`).toBe(result);
    let got = '';
    for (let n = -2; n < 14; n++) got += r.contains(n) ? '1' : '0';
    expect(got).toBe(bits);
    expect([...r.elements()].slice(0, 40)).toEqual(elements);
    expect(r.selectChars('abcdefghijkl')).toBe(chars);
    expect(r.hashCode()).toBe(hash);
  }
});
