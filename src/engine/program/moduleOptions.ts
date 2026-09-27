/**
 * The modules' option records, read the way every LPxxx.readOptions reads its section of
 * options.rec (and of local/options.rec).
 *
 * In a record of the module's section:
 * - `+` (set) fields are flags (e.g. noUser, officialIE);
 * - `?` (option) fields are "name:selector"; each named selector accumulates the union of
 *   its occurrences, with the current prefix added to every name; "prefix:P" sets the prefix
 *   and "termprefix:P" sets "institution.term.[ident.]P" (the prefix lasts to the end of the
 *   file being read, across records);
 * - other tags (the derivation's d/D/m/M/a/A rule lists, recognition's a) are returned in
 *   order with the prefix in force, for the module to interpret (RuleCrossReference).
 */
import type { ScrambledReader } from '../data/Scrambler';
import { TaggedRecord } from '../data/TaggedRecord';
import { equalsIgnoreCase, javaTrim } from '../util/java';
import { getLink } from './LogicProgram';
import { ProblemSelector } from './ProblemSelector';

export interface ModuleOptionField {
  tag: string;
  value: string;
  prefix: string;
}

export class ModuleOptions {
  /** Selectors by the option name as the module spells it (only those named). */
  readonly selectors = new Map<string, ProblemSelector>();
  /** The flags that were set, as the module spells them. */
  readonly flags = new Set<string>();
  readonly fields: ModuleOptionField[] = [];

  /**
   * section: the record's section name; selectorNames / flagNames: the options the module
   * knows (matched ignoring case); fieldTags: the other tags it reads.
   */
  constructor(
    readonly section: string,
    readonly selectorNames: readonly string[],
    readonly flagNames: readonly string[],
    readonly fieldTags = '',
  ) {}

  selector(name: string): ProblemSelector | null {
    return this.selectors.get(name) ?? null;
  }

  hasFlag(name: string): boolean {
    return this.flags.has(name);
  }

  /** Reads one options file (the base file, then the local one). */
  read(reader: ScrambledReader | null): void {
    if (reader == null) return;
    const record = TaggedRecord.fromReader(reader, true);
    let prefix = '';
    while (record.readNext()) {
      const name = record.getName();
      if (name == null || !equalsIgnoreCase(javaTrim(name), this.section)) continue;
      for (const i of record.indexesOfAnyTag(this.fieldTags + '+?')) {
        const tag = record.tagAt(i);
        const value = record.values[i];
        if (tag === '+') {
          const flag = this.flagNames.find((f) => equalsIgnoreCase(value, f));
          if (flag !== undefined) this.flags.add(flag);
        } else if (tag === '?') {
          const k = value.indexOf(':');
          if (k === -1) continue;
          const option = javaTrim(value.substring(0, k));
          const selectorName = this.selectorNames.find((s) => equalsIgnoreCase(option, s));
          if (selectorName !== undefined) {
            let selector = this.selectors.get(selectorName);
            if (selector === undefined) this.selectors.set(selectorName, (selector = new ProblemSelector()));
            selector.union(new ProblemSelector(value.substring(k + 1)).addPrefix(prefix));
          } else if (equalsIgnoreCase(option, 'prefix')) {
            prefix = value.substring(k + 1);
          } else if (equalsIgnoreCase(option, 'termprefix')) {
            const ident = getLink('ident', '')!;
            let p = javaTrim(getLink('institution', '')!) + '.' + javaTrim(getLink('term', '')!) + '.';
            if (javaTrim(ident).length > 0) p += javaTrim(ident) + '.';
            prefix = p + value.substring(k + 1);
          }
        } else {
          this.fields.push({ tag, value, prefix });
        }
      }
    }
    record.close();
  }
}

/** The selector and flag options each module reads (LPxxx.readOptions), by module index. */
export const MODULE_OPTION_NAMES: readonly { section: string; selectors: readonly string[]; flags: readonly string[]; fieldTags: string }[] = [
  {
    section: 'derivation',
    selectors: [
      'noCommand', 'noQueue', 'chap1', 'chap2', 'addToDB', 'updateDB', 'noCheck', 'noErrMess', 'monoProbs', 'noPrint',
      'noPrintCheck', 'noPrintErr', 'logPrint', 'logSubmit', 'needPrint', 'needSubmit', 'logShowCmd', 'noMixedMode',
    ],
    flags: ['officialIE', 'noUser', 'submitExam', 'printIncorrect'],
    fieldTags: 'dDmMaA',
  },
  {
    section: 'invalidation',
    selectors: [
      'addToDB', 'updateDB', 'noPrint', 'noCheck', 'noPrintCheck', 'monoProbs', 'logPrint', 'logSubmit', 'needPrint',
      'needSubmit', 'noExpand', 'fullExpand',
    ],
    flags: ['noUser', 'submitExam', 'printIncorrect'],
    fieldTags: '',
  },
  {
    section: 'parsing',
    selectors: [
      'autoCheck', 'addToDB', 'updateDB', 'noPrint', 'noCheck', 'noPrintCheck', 'monoProbs', 'logPrint', 'logSubmit',
      'needPrint', 'needSubmit', 'mainOnly',
    ],
    flags: ['noUser', 'submitExam', 'printIncorrect'],
    fieldTags: '',
  },
  {
    section: 'recognition',
    selectors: [
      'noErrMess', 'noCheck', 'noPrint', 'noPrintCheck', 'noPrintErr', 'monoProbs', 'addToDB', 'updateDB', 'logPrint',
      'logSubmit', 'needPrint', 'needSubmit',
    ],
    flags: ['noUser', 'submitExam', 'printIncorrect'],
    fieldTags: 'a',
  },
  {
    section: 'symbolization',
    selectors: [
      'noDirect', 'noErrMess', 'noHints', 'noCheck', 'noPrint', 'noPrintCheck', 'noPrintErr', 'monoProbs', 'equCounts',
      'chap1', 'chap2', 'chap3', 'chap4', 'chap5', 'addToDB', 'updateDB', 'logPrint', 'logSubmit', 'needPrint', 'needSubmit',
    ],
    flags: ['noUser', 'submitExam', 'printIncorrect'],
    fieldTags: '',
  },
  {
    section: 'truth',
    selectors: [
      'addToDB', 'updateDB', 'noCheck', 'noTreeErr', 'noTableErr', 'noSetupErr', 'noPrintCheck', 'noPrintTreeErr',
      'noPrintTableErr', 'noPrintSetupErr', 'noCheckMess', 'noPrint', 'monoProbs', 'doAllRows', 'doAllWffs', 'doSetUp',
      'logPrint', 'logSubmit', 'needPrint', 'needSubmit', 'doAllNodes',
    ],
    flags: ['noUser', 'submitExam', 'printIncorrect'],
    fieldTags: '',
  },
];
