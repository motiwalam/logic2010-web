/**
 * User problems, schemes and the Answer Manager (the desktop's dialogs driven headless).
 */
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { UserInfo } from '../../src/engine/program/UserInfo';
import {
  LPSymbolizer,
  menuItems,
  performMenuItem,
  SymbolizationModule,
  type SavedFile,
  type SymbolizationNotice,
} from '../../src/engine/modules/symbolization';
import { repoData } from '../support/fsDataSource';

let m: SymbolizationModule;
const saved: SavedFile[][] = [];
const notices: SymbolizationNotice[] = [];

beforeAll(async () => {
  await loadProgram(repoData, { syntax: 2, loadRules: false });
  m = await SymbolizationModule.load({ work: null, userKey: null, user: UserInfo.localUser() });
  m.persist = (files) => saved.push(files);
});

function session(): LPSymbolizer {
  const lp = new LPSymbolizer(m, {
    now: () => 0,
    ui: { askForSymbol: async () => 'x', askProblemName: async () => 'My problem' },
  });
  lp.onNotice = (n) => notices.push(n);
  return lp;
}

function lastNoticeId(): string | null {
  const n = notices[notices.length - 1];
  return n?.kind === 'message' ? n.message.id.toLowerCase() : null;
}

test('a user problem with a scheme and answers', async () => {
  const lp = session();
  expect(lp.createUserProblem('two\nlines')).toBe(false);
  expect(lastNoticeId()).toBe('not093');
  expect(lp.createUserProblem('Pat sings and Kit dances')).toBe(true);
  expect(lp.problem.statement).toBe('Pat sings and Kit dances');
  const editor = lp.createScheme();
  expect(editor.rows).toEqual([{ symbol: '', english: '' }]);
  editor.rows = [
    { symbol: 'P', english: 'Pat sings.' },
    { symbol: 'Q', english: 'Kit dances' },
  ];
  lp.acceptScheme(editor);
  expect(lp.problem.scheme).toBe('P:Pat sings\\..Q:Kit dances');
  expect(lp.schemeRows.map((r) => r.english)).toEqual(['Pat sings.', 'Kit dances']);

  lp.enterDirectSymbolization('P & Q');
  expect(lp.symbolization).toBe('(P ∧ Q)');
  const manager = lp.openAnswerManager()!;
  expect(manager.buttonSpec).toContain('Add:add');
  await manager.perform('add', []);
  expect(lp.problem.problemName).toBe('My problem');
  expect(lp.problem.answerKeys).toBe('My problem-1');
  expect(m.userKey!.get('My problem-1')).toContain('+');
  expect(manager.items).toEqual(['(P ∧ Q)']);
  // the saved work and user key
  const files = saved.flat().map((f) => f.fileName);
  expect(files).toContain('symbolization.rec');
  expect(files).toContain('symbolization-answers.rec');

  lp.checkProblem();
  expect(lp.status).toBe('Correct');
  await manager.perform('add', []);
  expect(lp.problem.answerKeys).toBe('My problem-1.My problem-2');
  await manager.perform('delete', [0]);
  expect(lp.problem.answerKeys).toBe('My problem-2');
  expect(m.userKey!.get('My problem-1')).toBeUndefined();
  expect(manager.items.length).toBe(1);
});

test('exercises cannot be edited; the menu follows the chapter', async () => {
  const lp = session();
  const i = m.problems!.indexOfName('Symb 1.004');
  lp.selectProblem(i);
  expect(lp.editScheme()).toBeNull();
  expect(lastNoticeId()).toBe('symnot012');
  expect(lp.openAnswerManager()).toBeNull();
  expect(lastNoticeId()).toBe('symnot005');
  expect(lp.chapter).toBe(1);
  const labels = menuItems(lp, lp.problem).map((it) => it.label);
  expect(labels).toEqual(['Truncate', 'Negation', 'Conditional', 'Atomic', 'Hint', 'Cut', 'Copy', 'Paste', 'Select All', 'Clear']);
  const r = await performMenuItem(lp, lp.problem, 'Conditional');
  expect(r.kind).toBe('focus');
  expect(lp.problem.toString()).toContain('→');
});

test('restricted generalization menu items keep the children', async () => {
  const lp = session();
  lp.loadUserProblem('Every dog barks');
  await lp.setConnective(lp.problem, 3, null);
  lp.problem.getChildNode(0)!.setText('it is a dog');
  await performMenuItem(lp, lp.problem, 'Rest Univ');
  expect(lp.problem.getNodeCode()).toBe('@x');
  expect(lp.problem.getChildNode(0)!.getNodeCode()).toBe('->');
  expect(lp.problem.getChildNode(0)!.getChildNode(0)!.text).toBe('it is a dog');
  await performMenuItem(lp, lp.problem, 'Unrest');
  expect(lp.problem.getNodeCode()).toBe('->');
  expect(new TaggedRecord(lp.saveProblem()).indexesOfTag('+').length).toBe(3);
});
