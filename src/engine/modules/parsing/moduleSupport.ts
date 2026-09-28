/**
 * Pieces the Parsing and Recognition modules share: the questions their dialogs ask, the
 * user-problem check (LogicModule.validateUserProblem), problem naming (XxxDialogs.askProblemName)
 * and the work clock (LPxxx.updateWorkTime).
 */
import { Message, type MessageParams } from '../../program/Message';
import type { ProblemSet } from '../../problems/ProblemSet';
import { javaTrim } from '../../util/java';

/** What the engine asks the user (the desktop's modal dialogs). The UI implements it. */
export interface ModuleDialogs {
  /**
   * "Please supply a name for this problem", with the initial text (the engine checks the
   * answer); null: cancelled.
   */
  askProblemName(initial: string): Promise<string | null>;
  /** Shows a catalogue message with its parameters (MessageDialog.showMessage). */
  showMessage(message: Message, params: MessageParams | null): Promise<void>;
}

/** A clock in milliseconds (Date.now), replaceable for tests. */
export type Clock = () => number;

/**
 * LogicModule.validateUserProblem: a user problem must be one line. Returns the global
 * message id to show (not093), or null if it is fine.
 */
export function validateUserProblem(s: string): string | null {
  return s.includes('\r') || s.includes('\n') ? 'not093' : null;
}

/**
 * XxxDialogs.askProblemName: asks for a name (initial "User") and checks it: blank (not006)
 * or already used (not007, with the parameter "problem name") show a message and give null.
 */
export async function askProblemName(ui: ModuleDialogs, problems: ProblemSet, initial: string | null): Promise<string | null> {
  let s = await ui.askProblemName(initial ?? 'User');
  if (s == null) return null;
  if ((s = javaTrim(s)) === '') {
    await ui.showMessage(Message.get('not006'), null);
    return null;
  }
  if (problems.getRecord(s) != null) {
    await ui.showMessage(Message.get('not007'), Message.params('problem name', s));
    return null;
  }
  return s;
}

/** The work time of an open problem (LPxxx.workTime / loadTime / updateWorkTime), in seconds. */
export class WorkTimer {
  workTime = 0;
  loadTime = 0;

  constructor(readonly clock: Clock) {}

  update(): number {
    const now = Math.trunc((this.clock() + 500) / 1000);
    if (this.loadTime !== 0) this.workTime += now - this.loadTime;
    this.loadTime = now;
    return this.workTime;
  }
}
