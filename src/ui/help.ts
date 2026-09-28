// The help documents (data/docs/*.pdf, named by links.conf keys as the desktop's buttons
// open them) and, in notation 2, the textbook chapters (data/syntax2/text/).

import type { ModuleId, Notation } from '../workspace/paths';
import { dataUrl, docUrl } from './engine/engine';

export interface HelpDoc {
  /** links.conf key. */
  key: string;
  title: string;
  /** One line on what it is for. */
  about: string;
  module: ModuleId | null;
}

export const HELP_DOCS: readonly HelpDoc[] = [
  { key: 'using', title: 'Using the Logic Program', about: 'How the program works, module by module.', module: null },
  { key: 'menuHelp', title: 'Menu help', about: 'The main menu and what each part does.', module: null },
  { key: 'about', title: 'About Logic 2010', about: 'The workbook and its authors.', module: null },
  { key: 'derStart', title: 'Getting started: derivations', about: 'A first walk through a derivation.', module: 'derivation' },
  { key: 'derHelp', title: 'Derivation help', about: 'Every command, rule and key of the derivation module.', module: 'derivation' },
  { key: 'derTips', title: 'Strategic advice', about: 'How to find a derivation.', module: 'derivation' },
  { key: 'derFAQ', title: 'Frequently asked questions', about: 'Common questions about derivations.', module: 'derivation' },
  { key: 'truHelp', title: 'Truth table help', about: 'How to fill in and check truth tables.', module: 'truth-tables' },
  { key: 'truRefs', title: 'References for truth tables', about: 'The truth-value rules of the connectives.', module: 'truth-tables' },
  { key: 'invHelp', title: 'Invalidity help', about: 'How to give interpretations.', module: 'invalidity' },
  { key: 'invRefs', title: 'Invalidity methods', about: 'Three ways to approach invalidity problems.', module: 'invalidity' },
  { key: 'parHelp', title: 'Parsing help', about: 'How to break a formula into its parse tree.', module: 'parsing' },
  { key: 'symHelp', title: 'Symbolization help', about: 'How to build a symbolization.', module: 'symbolization' },
  { key: 'symSamp', title: 'Symbolization examples', about: 'Worked examples with explanations, by chapter.', module: 'symbolization' },
  { key: 'recHelp', title: 'Recognizing rules help', about: 'How the rule-recognition exercises work.', module: 'recognition' },
  { key: 'recRefs', title: 'Inference rules', about: 'The rules, by chapter.', module: 'recognition' },
];

export interface Chapter {
  title: string;
  url: string;
}

const CHAPTERS: readonly [number, string][] = [
  [0, 'Preface and introduction'],
  [1, "Sentential logic with 'if' and 'not'"],
  [2, "Sentential logic with 'and', 'or', 'if-and-only-if'"],
  [3, 'Name letters, predicates, variables and quantifiers'],
  [4, 'Many-place predicates'],
  [5, 'Identity and operation symbols'],
  [6, 'Definite descriptions'],
];

/** The textbook chapters (notation 2 only, as the desktop's Logic Text button). */
export function textbookChapters(notation: Notation): Chapter[] {
  if (notation !== 2) return [];
  return CHAPTERS.map(([n, title]) => ({
    title: n === 0 ? title : `Chapter ${n}: ${title}`,
    url: dataUrl(`syntax2/text/LogicText Chap ${n} Aug 2013.pdf`),
  }));
}

/** The documents for a module (or the general ones for null), with their URLs. */
export function helpFor(module: ModuleId | null): (HelpDoc & { url: string })[] {
  const out: (HelpDoc & { url: string })[] = [];
  for (const d of HELP_DOCS) {
    if (d.module !== module) continue;
    const url = docUrl(d.key);
    if (url) out.push({ ...d, url });
  }
  return out;
}
