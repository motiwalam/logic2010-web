// Workspace and dialog flows of the Truth Tables and Invalidity modules (no oracle: these
// follow TruthDialogs / InvalidityDialogs step by step).
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { decodeWorkspace, encodeWorkspace, InvalidityWorkspace, LPInvalidation, loadInvalidityModule } from '../../src/engine/modules/invalidity/LPInvalidation';
import { LPTruthAnalysis, loadTruthModule, TruthWorkspace } from '../../src/engine/modules/truth/LPTruthAnalysis';
import { confirmSaveChanges, deleteAction, deleteMultipleProblems, save, selectNextProblem } from '../../src/engine/modules/truth/ModuleDialogs';
import type { ModuleUi, SaveChoice } from '../../src/engine/modules/truth/ModuleUi';
import { Message } from '../../src/engine/program/Message';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { maggie, symbols, translateSymbols } from '../../src/engine/program/symbols';
import { UserInfo } from '../../src/engine/program/UserInfo';
import { loadRulesAndTheorems } from '../../src/engine/rules/RuleTable';
import { repoData } from '../support/fsDataSource';

function fakeUi(answers: { save?: SaveChoice; name?: string | null; del?: 'work' | 'problem' | null; confirm?: boolean; button?: number }) {
  const log: string[] = [];
  const ui: ModuleUi = {
    async showMessage(m, p) {
      log.push('msg:' + m.id.toLowerCase() + ':' + Message.substitute(m.text, p));
      return answers.button ?? 0;
    },
    async showText(t) {
      log.push('text:' + t);
    },
    async confirmSave() {
      log.push('save?');
      return answers.save ?? 'yes';
    },
    async askProblemName(initial) {
      log.push('name?' + initial);
      return answers.name === undefined ? 'Mine' : answers.name;
    },
    async chooseDeleteWorkOrProblem() {
      log.push('delete?');
      return answers.del ?? 'work';
    },
    async confirm(t) {
      log.push('confirm:' + t);
      return answers.confirm ?? true;
    },
  };
  return { ui, log };
}

beforeAll(async () => {
  await loadProgram(repoData, { syntax: 1, loadRules: (t, r) => {
      loadRulesAndTheorems(t, r);
    } });
  await loadTruthModule();
  await loadInvalidityModule();
});

test('truth: open, work on a problem, save, reopen, delete work', async () => {
  const ws = await TruthWorkspace.open(null, UserInfo.localUser());
  let saves = 0;
  ws.persist = () => {
    saves++;
    return true;
  };
  expect(ws.problems.size()).toBeGreaterThan(40);
  expect(ws.problems.elements().every((e) => e.state === 0)).toBe(true);
  const m = new LPTruthAnalysis(ws);
  expect(ws.newProblem).not.toBeNull();
  let first = 0;
  for (m.loadProblemAt(first); m.completeSetup || m.problem.letterCount !== 2; m.loadProblemAt(++first));
  const p = m.problem;
  expect(p.table.getHeaderLabels()).toEqual(['P', 'Q', 'Form']);
  expect(p.question).toBe('Is this formula a tautology?');
  // fill every row correctly through the trees
  for (let r = 0; r < p.table.rowCount; r++) {
    const cell = p.table.cells[r][0];
    m.clickCell(r, 0);
    const nodes = cell.valueTree.nodes();
    const row = p.table.getRowLabel(r);
    const vals = nodes.map((n) => p.evaluator!.evaluate(n.getExpression(), [row[0] === 'T', row[1] === 'T']));
    for (let k = nodes.length - 1; k >= 0; k--) if (!nodes[k].locked) m.setNodeValue(r, 0, k, vals[k] ? 0 : 1);
    m.commitSelectedCell();
    expect(cell.text).toBe(vals[0] ? 'T' : 'F');
    expect(cell.isWrong).toBe(false);
  }
  m.setAnswer(0);
  expect([m.problem.statement, m.problem.getWorkRecord(), m.checkProblem().status]).toEqual([expect.anything(), expect.anything(), 'Correct']);
  expect(m.errorCount).toBe(0);
  const { ui, log } = fakeUi({});
  expect(await save(m, ui)).toBe(true);
  expect(ws.problems.getEntryAt(first)!.state).toBe(2);
  expect(saves).toBe(1);
  expect(m.getChangedProblem()).toBeNull();
  // a wrong value counts two errors (the desktop's two linked trees)
  m.clickCell(0, 0);
  m.setNodeValue(0, 0, 0, 1);
  expect(m.errorCount).toBe(2);
  m.commitSelectedCell();
  expect(m.checkProblem().message!.message.id.toLowerCase()).toBe('truerr001');
  // leaving: save changes? no
  const flow = fakeUi({ save: 'no' });
  expect(await selectNextProblem(m, flow.ui)).toBe(true);
  expect(flow.log).toEqual(['save?']);
  expect(m.problemIndex).toBe(first + 1);
  m.loadProblemAt(first);
  expect(m.hasWork()).toBe(true);
  const del = fakeUi({});
  expect(await deleteAction(m, del.ui)).toBe(true);
  expect(del.log).toEqual(['confirm:Delete the work on this problem?']);
  expect(ws.problems.getEntryAt(first)!.state).toBe(0);
  expect(m.problemIndex).toBe(first);
  expect(log).toEqual([]);
});

test('truth: user problems', async () => {
  const ws = await TruthWorkspace.open(null);
  const m = new LPTruthAnalysis(ws);
  expect(m.createUserProblem('P→(Q', false)!.message.id.toLowerCase()).toBe('truerr009');
  expect(m.userProblemDefault()).toBe('P→(Q');
  expect(m.createUserProblem('P . Q .: ', false)!.message.id.toLowerCase()).toBe('truerr010');
  expect(m.createUserProblem('a\nb', false)!.message.id.toLowerCase()).toBe('not093');
  expect(m.createUserProblem(translateSymbols('P|~P', maggie, symbols), true)).toBeNull();
  expect(m.assumeTautology).toBe(true);
  expect(m.problem.answerVisible).toBe(false);
  expect(m.saveProblem()).toBe('P|~P`=taut`%');
  const { ui, log } = fakeUi({ name: 'Mine' });
  m.setAnswer(0);
  expect(await confirmSaveChanges(m, ui)).toBe(true);
  expect(log).toEqual(['save?', 'name?User']);
  expect(m.problemIndex).not.toBe(-1);
  expect(TaggedRecord.nameOf(ws.problems.getRecordAt(m.problemIndex))).toBe('Mine');
  const again = fakeUi({ name: 'mine' });
  m.loadProblem('x`$P`=');
  m.setAnswer(1);
  expect(await confirmSaveChanges(m, again.ui)).toBe(false);
  expect(again.log[2]).toMatch(/^msg:not007:/);
  await deleteMultipleProblems(fakeUi({}).ui, ws, [ws.problems.indexOfName('Mine')], 'problems');
  expect(ws.problems.indexOfName('Mine')).toBe(-1);
});

test('invalidity: workspace text, links, user problems, states', async () => {
  const ws = await InvalidityWorkspace.open(null);
  const m = new LPInvalidation(ws);
  expect(m.loadUserProblem('Fa .: Fb')).toBeNull();
  expect(m.symbols!.map(String)).toEqual(['F(1)', 'a(0)', 'b(0)'].filter((s) => s !== 'a(0)' && s !== 'b(0)'));
  expect(m.loadUserProblem('FA .: FB')).toBeNull();
  expect(m.symbols!.map(String)).toEqual(['F(1)', 'A(0)', 'B(0)']);
  m.setSize(2);
  const [F, A, B] = m.symbols!;
  const edF = m.editInterpretation(F);
  if (!('editor' in edF)) throw new Error('editor');
  edF.editor.setChecked(0, 0, true);
  m.applyEditor(edF.editor);
  const edB = m.editInterpretation(B);
  if (!('editor' in edB)) throw new Error('editor');
  edB.editor.setValue(0, 0, 1);
  m.applyEditor(edB.editor);
  expect([A.describeValues(2), m.describeSymbol(F), m.describeSymbol(B)]).toEqual(['0', '{0}', '1']);
  expect(m.check().status).toBe('Correct');
  m.setWorkspaceText('∀x Fx', 0, 5);
  expect(m.expand(false)).toBeNull();
  expect(m.workspaceText).toBe('(Fa0∧Fa1)');
  expect(m.saveProblem()).toBe('FA .: FB`?2`#F(1){0}.A(0).B(0)1`=' + encodeWorkspace('(Fa0∧Fa1)') + '`&');
  expect(decodeWorkspace(encodeWorkspace('(Fa0∧Fa1)'))).toBe('(Fa0∧Fa1)');
  expect(m.derivationLink(true)).toEqual({ record: '@xx=a0 . FA .: FB`-`=' .replace('@xx=a0', '@x(x=a0|x=a1)') });
  expect(m.derivationLink()).toEqual({ record: 'FA .: FB`-`=' });
  m.select(0, 0);
  m.copyStatement();
  expect(m.workspaceText).toBe('FA ∴ FB(Fa0∧Fa1)');
  expect(m.loadUserProblem('Fa')!.message.id.toLowerCase()).toBe('inverr002');
  m.loadProblem(null);
  expect(m.expandAction(false)!.message.id.toLowerCase()).toBe('invnot002');
  expect(m.derivationLink()).toHaveProperty('message');
});
