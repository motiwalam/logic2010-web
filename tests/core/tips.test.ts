// The derivation tips outline.
import { loadProgram, loadTips } from '../../src/engine/program/loadProgram';
import type { OutlineNode } from '../../src/engine/data/OutlineNode';
import { repoData } from '../support/fsDataSource';
import { coreFixture } from '../support/fixtures';

interface Node { title: string; text: string; expanded: boolean; children: Node[] }
const plain = (n: OutlineNode): Node => ({ title: n.title, text: n.text, expanded: n.expanded, children: n.children.map(plain) });

test('tips outline', async () => {
  await loadProgram(repoData, { syntax: 1 });
  expect(plain((await loadTips())!)).toEqual(coreFixture<Node>('tips.json'));
});
