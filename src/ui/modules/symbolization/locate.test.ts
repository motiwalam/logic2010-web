// The formula-so-far highlight: locate() finds each node's part of root.toString().
import { TaggedRecord } from '../../../engine/data/TaggedRecord';
import { SymbolizationNode } from '../../../engine/modules/symbolization';
import { loadProgram } from '../../../engine/program/loadProgram';
import { repoData } from '../../../../tests/support/fsDataSource';
import { locate } from './SymbolizationTree';
import { loadModule, summarizeSet } from './support';

test('every node of every answer is found in the formula', async () => {
  await loadProgram(repoData, { syntax: 2, loadRules: false });
  const m = await loadModule(null, null);
  let checked = 0;
  for (const record of m.answers!.values()) {
    const root = new SymbolizationNode(null, m);
    root.loadRecord(new TaggedRecord(record));
    const s = root.toString();
    for (const n of root.preorder()) {
      const span = locate(root, n);
      expect(span).not.toBeNull();
      expect(s.substring(span![0], span![1])).toBe(n.toString());
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(3000);
  const summary = summarizeSet(m.problems!);
  expect(summary.completed).toBe(0);
  expect(summary.total).toBeGreaterThan(300);
});
