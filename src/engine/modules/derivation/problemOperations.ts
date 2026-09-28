/**
 * The problem-level operations of the derivation window (the desktop's toolbar and menu
 * actions and the problem dialogs of DerivationDialogs.java): open a problem or the next one,
 * save (asking for a name when the problem has none), delete the work or the problem, enter a
 * user problem. The UI asks the questions (which problem, what name, "save changes?"); these
 * functions validate the answers and change the derivation and the workspace. Writing the work
 * file is the workspace owner's job (DerivationWorkspace.write), after an operation returns
 * true for `saved`.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { STATE_NO_WORK } from '../../problems/ProblemEntry';
import { ErrorRef, Message, type MessageParams } from '../../program/Message';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { javaTrim } from '../../util/java';
import { DerivationProblemEntry, removeWork, UserRule } from './DerivationProblemSet';
import type { LPDerivation } from './LPDerivation';
import { QueryDialog } from './QueryDialog';

/** confirmSaveChanges: whether the derivation differs from its saved record (then the UI asks). */
export function hasUnsavedChanges(m: LPDerivation): boolean {
  return m.getChangedProblem() != null;
}

/**
 * chooseProblem / openNextProblem: opens problem i of the work (its record replaced by the
 * derivation as loaded, and its state recomputed as the desktop's replaceProblem does).
 */
export async function openProblem(m: LPDerivation, i: number): Promise<void> {
  const ws = m.workspace;
  m.loadProblem(ws.problems.getRecordAt(i));
  m.problemIndex = i;
  ws.problems.replaceProblem(m.saveProblem(), i);
  await ws.updateState(ws.problems.getEntryAt(i)!);
}

/** openNextProblem: the index of the problem after the current one, or -1 (then the desktop shows the problem list). */
export function nextProblemIndex(m: LPDerivation): number {
  const i = m.problemIndex + 1;
  if (i === 0) return -1;
  return m.workspace.problems.getRecordAt(i) == null ? -1 : i;
}

/**
 * askProblemName: a name for a problem that has none (default "User"): not006 if blank, not007
 * if a problem of that name exists. Returns the trimmed name or the error.
 */
export function validateProblemName(m: LPDerivation, name: string): string | ErrorRef {
  const s = javaTrim(name);
  if (s === '') return new ErrorRef('not006');
  if (m.workspace.problems.getRecord(s) != null) return new ErrorRef('not007', Message.params('problem name', s));
  return s;
}

/** The name the name dialog proposes (askProblemName): the title when saving under another name, else "User". */
export function proposedProblemName(m: LPDerivation, rename: boolean): string {
  return rename && m.problemTitle != null ? m.problemTitle : 'User';
}

/**
 * saveProblems(record, rename): stores the derivation in the work. A problem without an index
 * (a new user problem, or one saved under another name) needs `name` (validated with
 * validateProblemName). Also updates the user rule of a problem named UR... Returns false if
 * the name is missing.
 */
export async function saveProblemRecord(m: LPDerivation, record: string, name: string | null = null): Promise<boolean> {
  const ws = m.workspace;
  const problems = ws.problems;
  if (m.problemIndex === -1) {
    if (name == null) return false;
    m.setProblemTitle(name);
    const entry = new DerivationProblemEntry(TaggedRecord.withName(record, m.problemTitle!), false, ws.workProblemNames);
    let i = problems.registerEntry(entry, false);
    i = i === -1 ? problems.size() : i + 1;
    m.problemIndex = i;
    problems.insertElementAt(entry, i);
  } else {
    problems.replaceProblem(record, m.problemIndex);
  }
  await ws.updateState(problems.getEntryAt(m.problemIndex)!);
  if (m.problemTitle != null && m.problemTitle.toUpperCase().startsWith('UR') && ws.userRules != null) {
    const existing = ws.userRules.getRule(m.problemTitle);
    if (existing == null) {
      const rule = new UserRule(problems, m.problemTitle);
      if (rule.error == null) ws.userRules.addRule(rule);
    } else if (existing instanceof UserRule) {
      existing.loadFromProblem(problems, m.problemTitle);
      if (existing.error != null) ws.userRules.removeRule(existing);
    }
  }
  return true;
}

/**
 * The Save button: an unchanged problem has its state recomputed; a changed one is stored (a
 * worked example, which may not change, only under a new name: saveRenamed).
 * needsName: the problem has no index yet (or is an example): pass the name the user chose.
 */
export function saveNeedsName(m: LPDerivation): boolean {
  return m.getChangedProblem() != null && (m.problemIndex === -1 || m.dontChange);
}

export async function save(m: LPDerivation, name: string | null = null): Promise<boolean> {
  const record = m.getChangedProblem();
  const ws = m.workspace;
  if (record == null) {
    if (m.problemIndex !== -1) await ws.updateState(ws.problems.getEntryAt(m.problemIndex)!);
    return true;
  }
  return m.dontChange ? saveRenamed(m, record, name) : saveProblemRecord(m, record, name);
}

/** saveRenamed (right-click Save): the derivation as a new problem named name. */
export async function saveRenamed(m: LPDerivation, record: string | null = m.saveProblem(), name: string | null = null): Promise<boolean> {
  if (record == null) return true;
  const title = m.problemTitle;
  const index = m.problemIndex;
  m.problemIndex = -1;
  if (!(await saveProblemRecord(m, record, name))) {
    m.problemIndex = index;
    m.setProblemTitle(title);
    return false;
  }
  return true;
}

/** Whether Delete deletes the work (an exercise) or the problem (the desktop's toolbar Delete). */
export function deleteKind(m: LPDerivation): 'work' | 'problem' {
  return m.workspace.isExercise(m.problemTitle) ? 'work' : 'problem';
}

/** confirmDeleteWork: only when there is work. */
export function hasWork(m: LPDerivation): boolean {
  return m.problem.getContentCount() !== 1;
}

/**
 * deleteWorkAndSave: removes the work of the current problem (an example's only from the
 * window, not from the saved work). Returns whether the work changed (and should be written).
 */
export function deleteWork(m: LPDerivation): boolean {
  const ws = m.workspace;
  const entry = m.problemIndex === -1 ? null : ws.problems.getEntryAt(m.problemIndex);
  if (entry == null || ws.isExample(new TaggedRecord(entry.name).getName())) {
    while (m.problem.getContentCount() > 1) m.problem.removeNode(m.problem.getNode(1));
    m.problem.focusEditor(false);
    return false;
  }
  entry.name = removeWork(new TaggedRecord(entry.name));
  entry.state = STATE_NO_WORK;
  m.loadProblem(entry.name);
  return true;
}

/** confirmDeleteProblem's deletion: the problem goes from the work; the window shows a new problem. */
export function deleteProblem(m: LPDerivation): boolean {
  const changed = m.problemIndex !== -1;
  if (changed) m.workspace.problems.removeProblem(m.problemIndex);
  m.newProblem();
  return changed;
}

/**
 * deleteProblemsDialog: "Delete Work" (not the examples') or "Delete Problems" (not the
 * exercises) of the problems at the indexes. Open windows showing them are the caller's.
 */
export function deleteProblems(m: LPDerivation, indexes: number[], work: boolean): void {
  const ws = m.workspace;
  for (let k = indexes.length - 1; k >= 0; k--) {
    const i = indexes[k];
    const entry = ws.problems.getEntryAt(i);
    if (entry == null) continue;
    const t = new TaggedRecord(entry.name);
    if (work) {
      if (!ws.isExample(t.getName())) {
        entry.name = removeWork(t);
        entry.state = STATE_NO_WORK;
      }
    } else if (!ws.isExercise(t.getName())) {
      ws.problems.removeProblem(i);
    }
  }
}

/**
 * enterUserProblem: a problem the user typed (display symbols): not093 if it has line breaks;
 * otherwise loaded (errors dererr082/083 shown). Returns whether it was loaded.
 */
export async function enterUserProblem(m: LPDerivation, text: string): Promise<boolean> {
  if (text.includes('\r') || text.includes('\n')) {
    await m.showDialog(globalMessage('not093'));
    return false;
  }
  m.lastUserProblem = translateSymbols(text, symbols, maggie);
  return m.loadUserProblem(m.lastUserProblem);
}

/** The text the User dialog starts with: the last user problem (display symbols). */
export function lastUserProblemText(m: LPDerivation): string {
  return m.lastUserProblem == null ? '' : translateSymbols(m.lastUserProblem, maggie, symbols);
}


/** A message window of the global catalogue (MessageDialog.showMessage(Message.get(id), params)). */
export function globalMessage(id: string, params: MessageParams | null = null): QueryDialog {
  const message = Message.get(id);
  const text = params == null ? message.text : Message.substitute(message.text, params);
  const d = new QueryDialog('message', message.id, [{ type: 'text', text }], ['OK']);
  d.messageId = message.id;
  d.isError = message.isError;
  return d;
}

/** The problems the list may show: the monoProbs selector (the desktop's createProblemList). */
export function listSelector(m: LPDerivation) {
  return m.config.selector('monoProbs');
}

/** The selector of problems that may not be printed (chooseProblemsToPrint). */
export function printSelector(m: LPDerivation) {
  return m.config.selector('noPrint');
}
