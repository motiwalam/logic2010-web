import { readFileSync } from 'node:fs';
import { JavaHashtable } from '../src/engine/util/java';

test('JavaHashtable iterates like java.util.Hashtable', () => {
  const expected: string[] = JSON.parse(readFileSync('tests/fixtures/hashtable-order.json', 'utf8'));
  const t = new JavaHashtable<string, number>();
  const got: string[] = [];
  for (let i = 0; i < 60; i++) {
    t.put('k' + ((i * 7919) % 101), i);
    if (i % 5 === 4) t.remove('k' + (((i - 2) * 7919) % 101));
    if (i % 10 === 9) got.push([...t.keys()].join(' '));
  }
  expect(got).toEqual(expected);
});
