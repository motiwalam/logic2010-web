// Message catalogues: fields, substitution, escapes, symbol translation, button specs.
import { loadModuleMessages, loadProgram } from '../../src/engine/program/loadProgram';
import { Message, globalMessages, type MessageParams } from '../../src/engine/program/Message';
import { DialogHandler } from '../../src/engine/program/DialogHandler';
import { expandEscapes, maggie, symbols, translateSymbols } from '../../src/engine/program/symbols';
import { repoData } from '../support/fsDataSource';
import { coreFixture } from '../support/fixtures';

interface Entry {
  key: string; id: string; title: string; text: string; buttons: string | null; isError: boolean;
  params1: Record<string, string>; sub1: string; sub2: string; subNull: string; expand: string; translated: string;
  positions: number[]; labels: string[]; actions: (string | null)[]; default: number;
}
const LINKS = ['messages', 'derMessages', 'invMessages', 'parMessages', 'recMessages', 'symMessages', 'truMessages'];

describe.each([1, 2] as const)('notation %i', (syntax) => {
  const f = coreFixture<{ catalogues: Record<string, Entry[]>; unknown: { global: object; module: object } }>(`messages-${syntax}.json`);
  beforeAll(() => loadProgram(repoData, { syntax }));

  test.each(LINKS)('%s', async (link) => {
    const table = link === 'messages' ? globalMessages! : await loadModuleMessages(LINKS.indexOf(link) - 1);
    const expected = f.catalogues[link];
    expect([...table.keys()].sort()).toEqual(expected.map((e) => e.key));
    for (const e of expected) {
      const m = table.get(e.key)!;
      expect({ id: m.id, title: m.title, text: m.text, buttons: m.buttons, isError: m.isError }).toEqual({
        id: e.id, title: e.title, text: e.text, buttons: e.buttons, isError: e.isError,
      });
      const p1: MessageParams = new Map(Object.entries(e.params1).filter(([k]) => k !== 'n' && k !== 's'));
      const p2 = new Map(p1);
      p1.set('n', '1');
      p2.set('n', ' Three ');
      expect(Message.substitute(m.text, p1)).toBe(e.sub1);
      expect(Message.substitute(m.text, p2)).toBe(e.sub2);
      expect(Message.substitute(m.text, null)).toBe(e.subNull);
      expect(expandEscapes(m.text)).toBe(e.expand);
      const pos = Array.from({ length: m.text.length + 1 }, (_, k) => k);
      expect(translateSymbols(m.text, maggie, symbols, pos)).toBe(e.translated);
      expect(pos).toEqual(e.positions);
      const dh = new DialogHandler(m.buttons);
      expect([dh.labels, dh.actions, dh.defaultIndex]).toEqual([e.labels, e.actions, e.default]);
    }
  });

  test('unknown ids', () => {
    const pick = (m: Message) => ({ id: m.id, title: m.title, text: m.text, buttons: m.buttons, isError: m.isError });
    expect(pick(Message.get('no-such-id'))).toEqual(f.unknown.global);
    expect(pick(Message.getModule(0, 'No-Such-Id'))).toEqual(f.unknown.module);
  });
});
