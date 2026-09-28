// The Parsing and Recognition module flows (select, save with a name, changed detection,
// delete, user problems, work file round trip, printouts), following the desktop code.
import type { WrittenWork } from '../../src/engine/problems/LogicModule';
import type { ModuleDialogs } from '../../src/engine/modules/parsing/moduleSupport';
import { ParsingModule } from '../../src/engine/modules/parsing/LPParsing';
import { RecognitionModule } from '../../src/engine/modules/recognition/LPRecognition';
import type { Message } from '../../src/engine/program/Message';
import { UserInfo } from '../../src/engine/program/UserInfo';
import { loadEngine } from '../formula/formulaOracle';

function dialogs(names: (string | null)[]): ModuleDialogs & { shown: string[] } {
  const shown: string[] = [];
  return {
    shown,
    askProblemName: async () => names.shift() ?? null,
    showMessage: async (m: Message) => {
      shown.push(m.id.toLowerCase());
    },
  };
}

describe('parsing module', () => {
  let saved: WrittenWork | null = null;
  let module: ParsingModule;
  const user = UserInfo.localUser();
  beforeAll(async () => {
    await loadEngine(1);
    module = (await ParsingModule.load({ work: null, user, persist: (w) => void (saved = w), clock: () => 5_000_000 })).module!;
  });

  test('solving a problem, saving it and reading the work back', async () => {
    const w = module.open();
    expect(w.getChangedProblem()).toBeNull();
    const i = module.problems.indexOfName('Pars 1.002');
    w.selectProblem(i);
    expect(w.problem.statement).toBe('P->Q');
    w.selectNotation(1);
    const root = w.problem.tree.root;
    expect(root.text).toBe('P→Q');
    expect(w.click(root, 0).kind).toBe('miss');
    expect(w.click(root, 1).kind).toBe('expanded');
    expect(w.check()).toEqual({ id: null, summary: 'Correct' });
    expect(w.errorCount).toBe(1);
    const changed = w.getChangedProblem();
    expect(changed).toBe('Pars 1.002`$P->Q`=I`[2,0,0`]1`e');
    expect(await w.saveChanges(changed!, dialogs([]))).toBe(true);
    expect(module.problems.getEntryAt(i)!.state).toBe(2);
    expect(saved).not.toBeNull();
    const again = (await ParsingModule.load({ work: { fileName: saved!.fileName, text: saved!.text }, user })).module!;
    expect(again.problems.getRecordAt(i)).toBe(changed);
    expect(again.problems.getEntryAt(i)!.state).toBe(2);
  });

  test('a user problem is named when saved; names are checked', async () => {
    const w = module.open();
    expect(w.createUserProblem('P∧Q\nR')).toBe('not093');
    expect(w.createUserProblem('P∧Q')).toBeNull();
    expect(w.problem.statement).toBe('P&Q');
    // as on the desktop, loading the problem clears lastUserProblem
    expect(w.getUserProblemText()).toBe('');
    w.selectNotation(0);
    const ui = dialogs(['  ', 'Pars 1.002', 'Mine']);
    expect(await w.save(ui)).toBe(false);
    expect(ui.shown).toEqual(['not006']);
    expect(await w.save(ui)).toBe(false);
    expect(ui.shown).toEqual(['not006', 'not007']);
    expect(await w.save(ui)).toBe(true);
    expect(w.problemIndex).toBe(module.problems.size() - 1);
    expect(module.problems.getRecordAt(w.problemIndex)).toBe('Mine`$P&Q`=O`[');
    expect(w.getDeleteChoice()).toBe('workOrProblem');
    w.deleteProblem();
    expect(module.problems.indexOfName('Mine')).toBe(-1);
  });

  test('printouts', () => {
    const [item] = module.getStatements([0]);
    expect(item.text).toBe('Pars 1.001: Z');
    expect(module.getResults([0])[0].stateCode).toBe('N');
  });
});

describe('recognition module', () => {
  let module: RecognitionModule;
  beforeAll(async () => {
    await loadEngine(1);
    module = (await RecognitionModule.load({ work: null, user: UserInfo.localUser(), clock: () => 5_000_000 })).module!;
  });

  test('checking an answer and saving it', async () => {
    const w = module.open();
    const i = module.problems.indexOfName('Recog 1.003');
    w.selectProblem(i);
    w.setRuleText('MT');
    const r = w.check();
    expect(r).toMatchObject({ disabled: false, correct: true, messageId: null });
    expect(w.status).toBe('Correct');
    const changed = w.getChangedProblem()!;
    expect(await w.saveChanges(changed, dialogs([]))).toBe(true);
    expect(module.problems.getEntryAt(i)!.state).toBe(2);
    w.setRuleText('MP');
    expect(w.check()).toMatchObject({ correct: false, messageId: 'recnot003', params: { ruleName: 'MP', thisPremise: 'these premises' } });
    // deleting the work reloads the problem, which detaches it from the list, as on the desktop
    w.deleteWork();
    expect(module.problems.getEntryAt(i)!.state).toBe(0);
    expect(w.problemIndex).toBe(-1);
  });

  test('user problems', () => {
    const w = module.open();
    expect(w.createUserProblem('P → Q . P ∴ Q')).toBeNull();
    expect(w.problem.statement).toBe('P -> Q . P .: Q');
    expect(w.lastUserProblem).toBeNull();
    expect(w.createUserProblem('P . Q')?.id).toBe('recerr002');
    expect(w.createUserProblem('P . Q))) .: R')?.id).toBe('recerr001');
  });

  test('printouts', () => {
    const items = module.getPrintProblems([0, 1]);
    expect(items[0].text).toMatch(/^Recog 1\.001: /);
    expect(items[0].stateCode).toBe('N');
  });
});
