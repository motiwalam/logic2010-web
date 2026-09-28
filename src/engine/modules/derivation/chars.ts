/** Java's Character tests (Unicode-aware) as the derivation code uses them. */
import { isJavaWhitespace } from '../../rules/TheoremTable';

export { isJavaWhitespace };

/** Character.isDigit. */
export function isDigit(c: string): boolean {
  return /\p{Nd}/u.test(c);
}

/** Character.isLetter. */
export function isJavaLetter(c: string): boolean {
  return /\p{L}/u.test(c);
}

/** Character.isLetterOrDigit. */
export function isJavaLetterOrDigit(c: string): boolean {
  return isJavaLetter(c) || isDigit(c);
}
