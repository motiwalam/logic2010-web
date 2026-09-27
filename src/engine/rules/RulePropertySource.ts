/**
 * Port of RulePropertySource.java: answers property and proof queries about rules and
 * theorems. Implemented by RuleProperties (the structural properties) and by the derivation
 * module (disabled, manual, manualOrDisabled, weakAss, assumed; proofs).
 *
 * Java overloads hasProperty and getProofs for a Rule and for a theorem number (Integer);
 * here the theorem-number versions are hasTheoremProperty and getTheoremProofs.
 */
import type { Rule, SchematicRule } from './Rule';

export interface RulePropertySource {
  hasProperty(rule: Rule, prop: string): boolean;
  hasTheoremProperty(theorem: number, prop: string): boolean;
  /** The names of the problems that prove the form, or null if it needs no proof. */
  getProofs(rule: SchematicRule): string[] | null;
  getTheoremProofs(theorem: number): string[] | null;
  /** The problem whose own proof does not count (the one being worked on). */
  excludedProof(): string | null;
  /** Whether a proof problem is solved. */
  checkProof(problem: string): boolean;
}
