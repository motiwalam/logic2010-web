// Links, the logic options, and every module's option selectors over every problem name.
import * as LogicProgram from '../../src/engine/program/LogicProgram';
import { loadProgram, readModuleOptions } from '../../src/engine/program/loadProgram';
import { MODULE_OPTION_NAMES } from '../../src/engine/program/moduleOptions';
import { getSyntax, symbols, kaplan2 } from '../../src/engine/program/symbols';
import { repoData } from '../support/fsDataSource';
import { coreFixture } from '../support/fixtures';

interface Options {
  syntax: number;
  links: Record<string, string>;
  logic: Record<string, unknown> & { credentials: Record<string, string> };
  names: string[];
  modules: { class: string; selectors: Record<string, { text: string | null; matches: string }>; flags: Record<string, boolean> }[];
}

describe.each([1, 2] as const)('notation %i', (syntax) => {
  const f = coreFixture<Options>(`options-${syntax}.json`);
  beforeAll(() => loadProgram(repoData, { syntax }));

  test('links and notation', () => {
    expect(getSyntax()).toBe(f.syntax);
    expect(symbols).toBe(kaplan2);
    expect(Object.fromEntries([...LogicProgram.links!].sort(([a], [b]) => (a < b ? -1 : 1)))).toEqual(f.links);
    for (const k of Object.keys(f.links)) expect(LogicProgram.getLink(k.toLowerCase())).toBe(f.links[k]);
  });

  test('logic options', () => {
    const o = LogicProgram.options;
    const { credentials, ...flags } = f.logic;
    expect({
      debug: o.debug, printingEnabled: o.printingEnabled, remote: o.remote, noNetwork: o.noNetwork, altSymbols: o.altSymbols,
      maxBackups: o.maxBackups, backupName: o.backupName, restoreName: o.restoreName, soloPort: o.soloPort,
      noCoreProblems: o.noCoreProblems, hideSensitive: o.hideSensitive,
    }).toEqual(flags);
    for (const [user, text] of Object.entries(credentials)) expect(LogicProgram.getCredentials(user)!.toString()).toBe(text);
  });

  test.each([0, 1, 2, 3, 4, 5])('module %i selectors', async (i) => {
    const expected = f.modules[i];
    const options = await readModuleOptions(i);
    for (const [name, { text, matches }] of Object.entries(expected.selectors)) {
      const known = MODULE_OPTION_NAMES[i].selectors.includes(name);
      const sel = known ? options.selector(name) : null;
      if (!known) {
        // a field the module never sets from the options
        expect(text, `${expected.class}.${name}`).toBeNull();
        continue;
      }
      expect(sel == null ? null : sel.toString(), `${expected.class}.${name}`).toBe(text);
      let got = '';
      for (const n of f.names) got += LogicProgram.selectorMatches(sel, n) ? '1' : '0';
      got += LogicProgram.selectorMatches(sel, null) ? '1' : '0';
      expect(got, `${expected.class}.${name}`).toBe(matches);
    }
    for (const [flag, value] of Object.entries(expected.flags)) expect(options.hasFlag(flag), flag).toBe(value);
    for (const name of MODULE_OPTION_NAMES[i].selectors) expect(Object.keys(expected.selectors)).toContain(name);
  });
});
