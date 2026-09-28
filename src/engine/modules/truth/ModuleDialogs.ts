/**
 * Port of TruthDialogs.java and InvalidityDialogs.java (copy-paste twins on the desktop): the
 * modules' dialog flows (save changes, name a problem, delete work or problems, next problem,
 * user and submitted problems), with the questions asked through a ModuleUi. Problem lists
 * (choose, submit, print) are the UI's own; these flows take the chosen indexes.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { STATE_NO_WORK } from '../../problems/ProblemEntry';
import type { ProblemSet } from '../../problems/ProblemSet';
import { Message } from '../../program/Message';
import { javaTrim } from '../../util/java';
import type { ModuleUi } from './ModuleUi';

/** The student's problem sets of a module (TruthWorkspace, InvalidityWorkspace). */
export interface DialogWorkspace {
  problems: ProblemSet;
  isExercise(name: string | null): boolean;
  isExample(name: string | null): boolean;
  saveProblems(): Promise<boolean>;
}

/** An open problem of a module (LPTruthAnalysis, LPInvalidation). */
export interface DialogModule {
  readonly workspace: DialogWorkspace | null;
  problemIndex: number;
  dontChange: boolean;
  getChangedProblem(): string | null;
  saveProblem(): string;
  /** The problem's name (TruthProblemPanel.problemName, LPInvalidation.title). */
  getProblemName(): string | null;
  setProblemTitle(s: string): void;
  loadProblem(record: string | null): void;
  loadProblemAt(i: number): void;
  newProblem(): void;
  /** Truth: any work; Invalidity: a universe size. */
  hasWork(): boolean;
  /** Delete Work (TruthProblemPanel.clearWork, LPInvalidation.removeWork). */
  clearWork(): void;
  /** Whether a problem is loaded (the "Delete this problem?" question is asked). */
  hasStatement(): boolean;
  notifyChanged(): void;
}

/** askProblemName: the name for a new problem, or null (cancelled, empty: not006, taken: not007). */
export async function askProblemName(m: DialogModule, ui: ModuleUi, initial: string | null): Promise<string | null> {
  let s = await ui.askProblemName(initial ?? 'User');
  if (s == null) return null;
  if ((s = javaTrim(s)) === '') {
    await ui.showMessage(Message.get('not006'), null);
    return null;
  }
  if (m.workspace!.problems.getRecord(s) != null) {
    await ui.showMessage(Message.get('not007'), Message.params('problem name', s));
    return null;
  }
  return s;
}

/** saveProblems(record, rename): stores the record (a new problem is named and inserted first). */
export async function saveProblemsAs(m: DialogModule, ui: ModuleUi, s: string | null, rename: boolean): Promise<boolean> {
  if (s == null) return true;
  const ws = m.workspace!;
  const problems = ws.problems;
  let old: string | null = null;
  if (m.problemIndex === -1) {
    const name = await askProblemName(m, ui, rename ? m.getProblemName() : null);
    if (name == null) return false;
    m.setProblemTitle(name);
    const entry = problems.createEntry(TaggedRecord.withName(s, name), false);
    let i = problems.registerEntry(entry, false);
    i = i === -1 ? problems.size() : i + 1;
    m.problemIndex = i;
    problems.insertElementAt(entry, i);
  } else {
    old = problems.getRecordAt(m.problemIndex);
    problems.replaceProblem(s, m.problemIndex);
  }
  if (!(await ws.saveProblems())) {
    if (old == null) {
      problems.removeProblem(m.problemIndex);
      m.problemIndex = -1;
    } else {
      problems.replaceProblem(old, m.problemIndex);
    }
    m.notifyChanged();
    return false;
  }
  m.notifyChanged();
  return true;
}

/** saveRenamed (Save with a different name, and saving an example). */
export async function saveRenamed(m: DialogModule, ui: ModuleUi, s: string | null): Promise<boolean> {
  if (s == null) return true;
  const name = m.getProblemName();
  const i = m.problemIndex;
  m.problemIndex = -1;
  if (!(await saveProblemsAs(m, ui, s, true))) {
    m.problemIndex = i;
    m.setProblemTitle(name as string); // (a null name as in Java)
    return false;
  }
  return true;
}

/** saveProblems(record): an example is saved under a new name. */
export async function saveProblems(m: DialogModule, ui: ModuleUi, s: string | null): Promise<boolean> {
  return m.dontChange ? saveRenamed(m, ui, s) : saveProblemsAs(m, ui, s, false);
}

/** The Save button (Ctrl+S); right click: saveRenamed(m, ui, m.saveProblem()). */
export async function save(m: DialogModule, ui: ModuleUi): Promise<boolean> {
  const s = m.getChangedProblem();
  return s == null ? m.workspace!.saveProblems() : saveProblems(m, ui, s);
}

/** confirmSaveChanges: before leaving a changed problem; false: stay (cancelled or not saved). */
export async function confirmSaveChanges(m: DialogModule, ui: ModuleUi): Promise<boolean> {
  const s = m.getChangedProblem();
  if (s == null) return true;
  const choice = await ui.confirmSave();
  if (choice === 'yes' && !(await saveProblems(m, ui, s))) return false;
  return choice === 'yes' || choice === 'no';
}

/** saveDeletedWork: makes a Delete Work stick in the saved problems (not for examples). */
async function saveDeletedWork(m: DialogModule): Promise<void> {
  if (m.problemIndex === -1) return;
  const ws = m.workspace!;
  const entry = ws.problems.getEntryAt(m.problemIndex);
  if (entry != null && !ws.isExample(new TaggedRecord(entry.name).getName())) {
    entry.name = ws.problems.removeWork(new TaggedRecord(entry.name))!;
    entry.state = STATE_NO_WORK;
    const i = m.problemIndex;
    m.loadProblem(entry.name);
    m.problemIndex = i;
    await ws.saveProblems();
  }
}

/** deleteWork: "Delete the work on this problem?" */
export async function deleteWork(m: DialogModule, ui: ModuleUi): Promise<boolean> {
  if (!m.hasWork()) return false;
  if (!(await ui.confirm('Delete the work on this problem?'))) return false;
  m.clearWork();
  await saveDeletedWork(m);
  return true;
}

/** deleteProblemOrWork: for a problem that is not an exercise. */
export async function deleteProblemOrWork(m: DialogModule, ui: ModuleUi): Promise<boolean> {
  const ws = m.workspace!;
  if (m.hasWork()) {
    const choice = await ui.chooseDeleteWorkOrProblem();
    if (choice == null) return false;
    if (choice === 'work') {
      m.clearWork();
      await saveDeletedWork(m);
      return true;
    }
  } else if (m.problemIndex !== -1 || (m.hasStatement())) {
    if (!(await ui.confirm('Delete this problem?'))) return false;
  }
  if (m.problemIndex !== -1) {
    ws.problems.removeProblem(m.problemIndex);
    await ws.saveProblems();
  }
  m.newProblem();
  return true;
}

/** The Delete button: exercises can only have their work deleted. */
export async function deleteAction(m: DialogModule, ui: ModuleUi): Promise<boolean> {
  return m.workspace!.isExercise(m.getProblemName()) ? deleteWork(m, ui) : deleteProblemOrWork(m, ui);
}

/**
 * deleteMultipleProblems: "Delete Work" (not091) or "Delete Problems" (not090, user problems
 * only) for the chosen indexes. current: the open problem, reloaded if affected.
 */
export async function deleteMultipleProblems(
  ui: ModuleUi,
  ws: DialogWorkspace,
  indices: readonly number[],
  what: 'work' | 'problems',
  current: DialogModule | null = null,
): Promise<void> {
  if (indices.length === 0) return;
  const message = Message.get(what === 'work' ? 'not091' : 'not090');
  const choice = await ui.showMessage(message, null);
  if (choice === 0) {
    for (let k = indices.length - 1; k >= 0; k--) {
      const l = indices[k];
      const entry = ws.problems.getEntryAt(l);
      if (entry == null) continue;
      const t = new TaggedRecord(entry.name);
      if (what === 'work') {
        if (ws.isExample(t.getName())) continue;
        entry.name = ws.problems.removeWork(t)!;
        entry.state = STATE_NO_WORK;
        if (current != null && current.problemIndex === l) {
          current.loadProblem(entry.name);
          current.problemIndex = l;
        }
      } else if (!ws.isExercise(t.getName())) {
        const open = current != null && current.problemIndex === l;
        ws.problems.removeProblem(l);
        if (current != null && current.problemIndex > l) current.problemIndex--;
        if (open) current!.newProblem();
      }
    }
  }
  await ws.saveProblems();
  current?.notifyChanged();
}

/**
 * selectNextProblem: the problem after the current one; returns false when there is none
 * (the desktop then shows the problem list: choose one and call m.loadProblemAt).
 */
export async function selectNextProblem(m: DialogModule, ui: ModuleUi): Promise<boolean | 'choose'> {
  if (!(await confirmSaveChanges(m, ui))) return false;
  const i = m.problemIndex + 1;
  const s = i === 0 ? null : m.workspace!.problems.getRecordAt(i);
  if (s == null) return 'choose';
  m.loadProblemAt(i);
  return true;
}

/** chooseProblem, after the student picked index i from the list (confirmSaveChanges first). */
export async function chooseProblem(m: DialogModule, ui: ModuleUi, i: number): Promise<boolean> {
  if (!(await confirmSaveChanges(m, ui))) return false;
  if (i === -1) return false;
  m.loadProblemAt(i);
  return true;
}

/** enterSubmittedProblem: an instructor pastes a raw record. */
export function enterSubmittedProblem(m: DialogModule, record: string): void {
  m.loadProblem(record);
}

/** LogicModule.validateUserProblem: one line only (not093). */
export function validateUserProblem(s: string): boolean {
  return !s.includes('\r') && !s.includes('\n');
}
