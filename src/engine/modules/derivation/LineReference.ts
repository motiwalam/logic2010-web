/**
 * Port of LineReference.java: a line number cited in a line's justification, tracked so it can
 * be renumbered. offset is the distance from the end of the previous reference, length the
 * length of the digits.
 */
import type { DerivationLine } from './DerivationLine';
import type { DerivationNode } from './DerivationNode';

export class LineReference {
  constructor(
    public offset: number,
    public length: number,
    public target: DerivationNode,
    public source: DerivationLine,
  ) {}
}
