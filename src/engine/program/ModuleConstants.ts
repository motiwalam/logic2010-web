/**
 * Module indexes and names. Port of ModuleConstants.java, plus the per-module static
 * names the desktop reaches by reflection (LPxxx.workFileName, digestVersKey, and the
 * linkName of each module's Message subclass).
 */

export const derModule = 0;
export const invModule = 1;
export const parModule = 2;
export const recModule = 3;
export const symModule = 4;
export const truModule = 5;

export const moduleAbbrs = ['Deriv', 'Inval', 'Pars', 'Recog', 'Symb', 'TruTb'] as const;
export const moduleNames = ['Derivation', 'Invalidity', 'Parsing', 'Recognizing Rules', 'Symbolization', 'Truth Tables'] as const;
/** Each module's internal work file name, which is also the link key of its course problem file. */
export const moduleWorks = ['derwork.txt', 'invwork.txt', 'parwork.txt', 'recwork.txt', 'symwork.txt', 'truwork.txt'] as const;
/** LPxxx.digestVersKey: the user field that holds the digest version of the module's work file. */
export const moduleDigestVersKeys = [
  'derDigestVers', 'invDigestVers', 'parDigestVers', 'recDigestVers', 'symDigestVers', 'truDigestVers',
] as const;
/** The link key of each module's message catalogue (its Message subclass's linkName). */
export const moduleMessageLinks = ['derMessages', 'invMessages', 'parMessages', 'recMessages', 'symMessages', 'truMessages'] as const;
/** The section name of each module's records in options.rec. */
export const moduleOptionSections = ['derivation', 'invalidation', 'parsing', 'recognition', 'symbolization', 'truth'] as const;
