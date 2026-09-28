/** Justification.decode (Justification.java): a cached step from its `:` field. */
import { InterchangeJustification } from './InterchangeJustification';
import { IndirectAssumptionJustification, type Justification, parseIntStrict, PremiseJustification } from './Justification';
import type { LPDerivation } from './LPDerivation';
import { RuleApplication } from './RuleApplication';

/** Types 1-4; null otherwise (type 5, ASS BD, is not read back). Throws on a malformed type. */
export function decodeJustification(s: string, module: LPDerivation): Justification | null {
  const i = s.indexOf(':');
  if (i === -1) return null;
  const j = parseIntStrict(s.substring(0, i));
  if (j === 1) return RuleApplication.decode(s, (name) => module.getRule(name));
  if (j === 2) return PremiseJustification.decode(s);
  if (j === 3) return IndirectAssumptionJustification.decode(s);
  return j === 4 ? InterchangeJustification.decodeInterchange(s, module) : null;
}
