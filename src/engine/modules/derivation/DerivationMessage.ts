/**
 * Port of DerivationMessage.java: the derivation module's message catalogue (derMessages,
 * loaded with loadModuleMessages(derModule)) and its formatting: <param> substitution from the
 * given parameters, then the checker and the line (MessageParamSource), unless the module
 * does not substitute (a hidden module: doSubs false).
 */
import { derModule } from '../../program/ModuleConstants';
import { Message, type MessageParams, type MessageParamSource } from '../../program/Message';
import type { DerivationLine } from './DerivationLine';

/** DerivationMessage.get: the message, or the "bad error id" message. */
export function getDerivationMessage(id: string): Message {
  return Message.getModule(derModule, id);
}

export function getDerivationText(id: string): string {
  return getDerivationMessage(id).text;
}

/** What format needs of a checker (DerivationLineChecker). */
export interface CheckerParamSource extends MessageParamSource {
  line: DerivationLine;
}

/**
 * DerivationMessage.format(s, params, checker, line): with a checker, line is the checker's
 * line unless given.
 */
export function formatDerivationMessage(
  s: string,
  params: MessageParams | null,
  checker: CheckerParamSource | null,
  line: DerivationLine | null = checker == null ? null : checker.line,
): string {
  if (line != null && !line.box.module.doSubs) return s;
  return Message.substitute(s, params, [checker, line]);
}
