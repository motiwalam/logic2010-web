// The module plug-in registry. Each module's screen lives in src/ui/modules/<id>/ and its
// index.ts(x) default-exports a ModuleDefinition (see src/ui/README.md). Modules that have not
// registered yet get a placeholder page built from the catalogue below.

import type { ComponentType, ReactNode } from 'react';
import type { WorkSummary } from '../../sync/api';
import type { ModuleId, Notation } from '../../workspace/paths';
import type { WorkSource } from '../../workspace/source';
import type { DialogApi } from '../dialogs/dialogs';

/** What the shell passes to a module's screen. */
export interface ModuleProps {
  /** The work being shown: your own, or someone else's (read-only). */
  work: WorkSource;
  /** True when showing someone else's work: nothing may be saved. */
  readOnly: boolean;
  /** The notation the engine is loaded with. The work file's path is `syntax<n>/<workFile>`. */
  notation: Notation;
  /** The path of the module's work file for this notation, e.g. 'syntax1/derivation.rec'. */
  workPath: string;
  /** The problem named in the URL (null: none chosen). */
  problem: string | null;
  /**
   * Opens a problem (changes the URL). `replace` replaces the history entry (use it when
   * the module picks a problem by itself, e.g. the first one).
   */
  openProblem(name: string | null, opts?: { replace?: boolean }): void;
  /** Dialogs (messages, questions, choices) — the same object as `dialogs` from dialogs.ts. */
  dialogs: DialogApi;
  /** A place in the module bar (before Help and Work file) for module-wide actions; render into it with a portal. */
  barSlot?: HTMLElement | null;
}

export interface ModuleDefinition {
  id: ModuleId;
  /** Shown in navigation, e.g. 'Derivations'. */
  title: string;
  /** One sentence for the home page. */
  description: string;
  /** The module's work file name, e.g. 'derivation.rec'. */
  workFile: string;
  /** Other work files the module writes (e.g. 'symbolization-answers.rec'). */
  extraFiles?: string[];
  /** A short glyph or element for cards and navigation (e.g. '⊢'). */
  icon: ReactNode;
  /** The screen. May be React.lazy(() => import('./Screen')); the shell wraps it in Suspense. */
  component: ComponentType<ModuleProps>;
  /**
   * Progress figures of a work file's text: completed (checked correct), attempted (with
   * work), total (problems counted). Called with the engine loaded for `notation`. Shown on
   * the home page and the People page, and stored on the server with each upload.
   */
  summarize?(fileText: string, ctx: { notation: Notation }): WorkSummary | Promise<WorkSummary>;
  /** links.conf keys of help documents to link from the module (defaults to the catalogue's). */
  helpKeys?: string[];
}

/** Built-in facts about each module, used before (and besides) its registration. */
export interface ModuleInfo {
  id: ModuleId;
  title: string;
  description: string;
  workFile: string;
  extraFiles: string[];
  icon: string;
  /** The desktop's module index (ModuleConstants). */
  index: number;
  /** The link key of the course problem file (also the internal work-file name). */
  problemsKey: string;
  /** The problem record field holding the statement (tag), for the placeholder list. */
  statementTag: string;
}

export const MODULE_CATALOG: readonly ModuleInfo[] = [
  {
    id: 'symbolization',
    title: 'Symbolization',
    description: 'Translate English sentences into the formulas of logic.',
    workFile: 'symbolization.rec',
    extraFiles: ['symbolization-answers.rec'],
    icon: '∀x',
    index: 4,
    problemsKey: 'symwork.txt',
    statementTag: '-',
  },
  {
    id: 'parsing',
    title: 'Parsing',
    description: 'Break formulas down into their parse trees.',
    workFile: 'parsing.rec',
    extraFiles: [],
    icon: '( )',
    index: 2,
    problemsKey: 'parwork.txt',
    statementTag: '=',
  },
  {
    id: 'truth-tables',
    title: 'Truth Tables',
    description: 'Fill in truth tables and decide validity, tautology and consistency.',
    workFile: 'truth-tables.rec',
    extraFiles: [],
    icon: 'TF',
    index: 5,
    problemsKey: 'truwork.txt',
    statementTag: '=',
  },
  {
    id: 'derivation',
    title: 'Derivations',
    description: 'Build natural-deduction proofs, line by line.',
    workFile: 'derivation.rec',
    extraFiles: [],
    icon: '∴',
    index: 0,
    problemsKey: 'derwork.txt',
    statementTag: '-',
  },
  {
    id: 'invalidity',
    title: 'Invalidity',
    description: 'Give interpretations that show arguments invalid.',
    workFile: 'invalidity.rec',
    extraFiles: [],
    icon: '⊭',
    index: 1,
    problemsKey: 'invwork.txt',
    statementTag: '?',
  },
  {
    id: 'recognition',
    title: 'Recognizing Rules',
    description: 'Say which rule of inference an argument is an instance of.',
    workFile: 'recognition.rec',
    extraFiles: [],
    icon: 'MP',
    index: 3,
    problemsKey: 'recwork.txt',
    statementTag: '=',
  },
];

export function moduleInfo(id: string): ModuleInfo | undefined {
  return MODULE_CATALOG.find((m) => m.id === id);
}

// ---- registration ----

const registered = new Map<string, ModuleDefinition>();

/** Registers a module (the default export of src/ui/modules/<id>/index.ts(x) is registered automatically). */
export function registerModule(def: ModuleDefinition): void {
  registered.set(def.id, def);
}

export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}

const discovered = import.meta.glob<{ default?: ModuleDefinition }>('./*/index.{ts,tsx}', { eager: true });
for (const mod of Object.values(discovered)) if (mod.default) registerModule(mod.default);

export function getModule(id: string): ModuleDefinition | undefined {
  return registered.get(id);
}

/** The module a work file belongs to (registered definition, if any, and catalogue entry). */
export function moduleForFile(file: string): { info: ModuleInfo; def: ModuleDefinition | undefined } | undefined {
  const info = MODULE_CATALOG.find((m) => m.workFile === file || m.extraFiles.includes(file));
  return info && { info, def: registered.get(info.id) };
}
