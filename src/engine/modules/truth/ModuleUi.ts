/**
 * The questions the Truth Tables and Invalidity modules ask the student (the Swing dialogs of
 * TruthDialogs.java / InvalidityDialogs.java and MessageDialog), as async methods the UI
 * implements. The engine's dialog flows (TruthDialogs.ts, InvalidityDialogs.ts) await them.
 */
import type { Message, MessageParams } from '../../program/Message';

export type SaveChoice = 'yes' | 'no' | 'cancel';

export interface ModuleUi {
  /**
   * Shows a catalogue message (Message.text with <param> substitution; its `buttons` spec, if
   * any, lists the buttons). Resolves to the index of the button chosen (0 for OK).
   */
  showMessage(message: Message, params: MessageParams | null): Promise<number>;
  /** A message with a hard-coded title and text (e.g. "Feature Disabled"). */
  showText(title: string, text: string): Promise<void>;
  /** "Do you wish to save the current problem?" with Yes, No, Cancel. */
  confirmSave(): Promise<SaveChoice>;
  /** "Please supply a name for this problem", starting from `initial`; null when cancelled. */
  askProblemName(initial: string): Promise<string | null>;
  /**
   * The radio choice "Delete the work on this problem?" / "Delete this problem?" (the first
   * preselected) with OK and Cancel; null when cancelled.
   */
  chooseDeleteWorkOrProblem(): Promise<'work' | 'problem' | null>;
  /** A question with OK and Cancel, e.g. "Delete this problem?". */
  confirm(text: string): Promise<boolean>;
}

/** A module message to show (id looked up in the module's catalogue), as the engine reports it. */
export interface ModuleMessage {
  message: Message;
  params: MessageParams | null;
}
