/** Port of DerivationConstants.java: checking phases, assumption kinds, failure kinds. */

/** Phases (LPDerivation.setPhase): a line's message is replaced only by one of a lower phase. */
export const EXPR_PARSE = 1;
export const JUST_PARSE = 2;
export const JUST_CHECK = 3;
export const COMP_CHECK = 4;

/** Which kind of assumption opened a box (DerivationBox.assumptionType). */
export const ASS_DD = 0;
export const ASS_ID = 1;
export const ASS_CD = 2;
export const ASS_BD = 3;
export const ASS_STR: readonly string[] = ['D', 'I', 'C', 'B'];
export const BD_ASS: readonly string[] = ['ASS BDL', 'ASS BDR', 'ASS BD'];

/** RuleApplication.failureKind: why the conclusion check of a match failed. */
export const SCHEME_FAILED = 1;
export const SCHEME_INCOMP = 2;
export const VAR_VIOLATION = 3;
export const IMPROPER_SUB = 4;
export const SUB_ERROR = 5;
