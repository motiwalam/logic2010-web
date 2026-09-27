/**
 * The program's start-up, as the desktop runs it headless (LogicProgram.initialize and
 * loadRulesAndTheorems; see tools/oracle/.../Oracle.java init()): core info, links and
 * notation, the global messages, the options and local options, the directories, and the
 * theorems and rules. Also loads the module message catalogues, the tips outline, and the
 * modules' problem files.
 */
import type { DataSource } from '../data/DataSource';
import { readOutline, type OutlineNode } from '../data/OutlineNode';
import type { ScrambledReader } from '../data/Scrambler';
import { loadRulesAndTheorems } from '../rules/RuleTable';
import * as LogicProgram from './LogicProgram';
import { Message, moduleMessages, setGlobalMessages } from './Message';
import { moduleMessageLinks } from './ModuleConstants';
import { ModuleOptions, MODULE_OPTION_NAMES } from './moduleOptions';

/**
 * Loads the theorems and rules from their files' tagged lines. The default is the rules
 * port's loadRulesAndTheorems (src/engine/rules/RuleTable.ts: TheoremTable.read, then
 * RuleTable.read, kept as the program's rule table, LogicProgram.ruleTable).
 */
export type RulesLoader = (theoremLines: string[], ruleLines: string[]) => void | Promise<void>;

export interface LoadProgramOptions {
  /** The notation (overrides links.conf's syntax:, as `run.sh --local --syntax N` does). */
  syntax?: 1 | 2;
  /** Loads the theorems and rules (see RulesLoader); false: do not load them. */
  loadRules?: RulesLoader | false;
}

export class ProgramLoadError extends Error {}

/** Loads the program-wide configuration from the data files. */
export async function loadProgram(source: DataSource, opts: LoadProgramOptions = {}): Promise<void> {
  LogicProgram.setDataSource(source);
  if ((await LogicProgram.readCoreInfo(source)) == null) throw new ProgramLoadError('Could not read core information file.');
  if ((await LogicProgram.readLinks(source, opts.syntax)) == null) throw new ProgramLoadError('Could not read link file.');
  const messages = Message.parseMessages(await LogicProgram.openDataFile('messages'));
  if (messages == null) throw new ProgramLoadError('Could not open the program messages file.');
  setGlobalMessages(messages);
  moduleMessages.clear();
  LogicProgram.resetOptions();
  const optionsReader = await LogicProgram.openDataFile('options');
  if (optionsReader == null) throw new ProgramLoadError('Could not read option file.');
  LogicProgram.readOptions(optionsReader);
  LogicProgram.readOptions(await LogicProgram.openLocalFile('options'));
  const loadRules = opts.loadRules ?? ((t: string[], r: string[]) => void loadRulesAndTheorems(t, r));
  if (loadRules) {
    const theorems = await LogicProgram.openDataFile('theorems');
    const rules = await LogicProgram.openDataFile('rules');
    if (theorems == null || rules == null) throw new ProgramLoadError('Could not read the rules and theorems.');
    await loadRules(theorems.readAll(), rules.readAll());
  }
}

/** Message.loadModuleMessages / XxxMessage.loadMessages: the module's catalogue (cached). */
export async function loadModuleMessages(moduleIndex: number): Promise<Map<string, Message>> {
  const loaded = moduleMessages.get(moduleIndex);
  if (loaded) return loaded;
  const table = Message.parseMessages(await LogicProgram.openDataFile(moduleMessageLinks[moduleIndex]));
  if (table == null) throw new ProgramLoadError('Could not read the messages of module ' + moduleIndex);
  moduleMessages.set(moduleIndex, table);
  return table;
}

/** The derivation tips (the `tips` link), as an outline. */
export async function loadTips(): Promise<OutlineNode | null> {
  return readOutline(await LogicProgram.openDataFile('tips'));
}

/** Both options files (options.rec, then local/options.rec) as readers, for a module's readOptions. */
export async function openOptionFiles(): Promise<(ScrambledReader | null)[]> {
  return [await LogicProgram.openDataFile('options'), await LogicProgram.openLocalFile('options')];
}

/** A module's options (its section of the base and local options files). */
export async function readModuleOptions(moduleIndex: number): Promise<ModuleOptions> {
  const names = MODULE_OPTION_NAMES[moduleIndex];
  const options = new ModuleOptions(names.section, names.selectors, names.flags, names.fieldTags);
  for (const reader of await openOptionFiles()) options.read(reader);
  return options;
}
