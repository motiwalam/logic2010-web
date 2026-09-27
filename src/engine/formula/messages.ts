/**
 * The message helpers the formula and rules engine uses: Message.params / Message.putParam
 * and ErrorRef, from the core's Message port.
 */
import { Message, type MessageParams } from '../program/Message';

export { ErrorRef, type MessageParams } from '../program/Message';

/** Message.putParam: keys are lower-cased; a null value becomes "". */
export function putParam(table: MessageParams | null, key: string, value: string | null): MessageParams {
  return Message.putParam(table, key, value);
}

/** Message.params(k1, v1, k2, v2, ...). */
export function params(...pairs: (string | null)[]): MessageParams {
  return Message.params(...pairs);
}
