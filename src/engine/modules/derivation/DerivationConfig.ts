/**
 * The derivation module's program-wide configuration (the desktop's static LPDerivation
 * state that comes from the course data): the box rules table (getDerivationRules), the
 * options of the `derivation` section of options.rec (readOptions: the rule lists d/D/m/M/a/A
 * with their selectors, the selector options and the flags), and the course exercises
 * (readExercises, with the index of which problems prove which rules).
 *
 * Load it once per notation with DerivationConfig.load().
 */
import { readExercises } from '../../problems/LogicModule';
import { IntervalSet } from '../../program/IntervalSet';
import { loadModuleMessages, readModuleOptions } from '../../program/loadProgram';
import { derModule } from '../../program/ModuleConstants';
import type { ProblemSelector } from '../../program/ProblemSelector';
import { Rule, SchematicRule } from '../../rules/Rule';
import { RuleCrossReference } from '../../rules/RuleCrossReference';
import { getRule as getProgramRule, RuleTable } from '../../rules/RuleTable';
import { javaTrim } from '../../util/java';
import { DerivationProblemSet } from './DerivationProblemSet';

/** The selector options of the derivation section (as the desktop names them). */
export const SELECTOR_OPTIONS = [
  'noCommand', 'noQueue', 'chap1', 'chap2', 'addToDB', 'updateDB', 'noCheck', 'noErrMess', 'monoProbs', 'noPrint',
  'noPrintCheck', 'noPrintErr', 'logPrint', 'logSubmit', 'needPrint', 'needSubmit', 'logShowCmd', 'noMixedMode',
] as const;
export type SelectorOption = (typeof SELECTOR_OPTIONS)[number];

/** LPDerivation.getDerivationRules: the box-closing rules and their forms by assumption (CD/C ...). */
export function getDerivationRules(): RuleTable {
  const table = new RuleTable(null);
  for (const name of ['CD', 'DD', 'ID']) {
    const rule = new Rule(name);
    for (const kind of ['C', 'D', 'I']) {
      const form = new SchematicRule(name + '/' + kind);
      rule.addComponent(form);
      table.addRule(form);
    }
    table.addRule(rule);
  }
  table.addRule(new SchematicRule('UD'));
  table.addRule(new SchematicRule('IE'));
  table.addRule(new SchematicRule('CIE'));
  const bd = new Rule('BD');
  const form = new SchematicRule('BD/B');
  bd.addComponent(form);
  table.addRule(form);
  table.addRule(bd);
  return table;
}

export class DerivationConfig {
  derivationRules: RuleTable = getDerivationRules();
  disabledRuleXRefs: RuleCrossReference[] = [];
  manualRuleXRefs: RuleCrossReference[] = [];
  weakAssRuleXRefs: RuleCrossReference[] = [];
  assumedRuleXRefs: RuleCrossReference[] = [];
  readonly selectors = new Map<SelectorOption, ProblemSelector>();
  officialIE = false;
  noUser = false;
  submitExam = false;
  printIncorrect = false;
  exercises: DerivationProblemSet;
  /** Rules the options name that the program does not know (the desktop prints "unknown rule"). */
  readonly unknownRules: string[] = [];

  constructor(exercises?: DerivationProblemSet) {
    this.exercises = exercises ?? new DerivationProblemSet(this, null);
  }

  /** LPDerivation.getExercises: the messages, the options and the course exercises. */
  static async load(): Promise<DerivationConfig> {
    await loadModuleMessages(derModule);
    const config = new DerivationConfig();
    await config.readOptions();
    const exercises = new DerivationProblemSet(config, null);
    exercises.ruleProofIndex = { forms: new Map(), theorems: new Map() };
    await readExercises(exercises, 'derwork.txt');
    config.exercises = exercises;
    return config;
  }

  /** LPDerivation.readOptions (both options files) and logNeeds. */
  async readOptions(): Promise<void> {
    const options = await readModuleOptions(derModule);
    const lister = { listRules: (list: string, names: string[], theorems: IntervalSet, forms: boolean) => this.listRules(list, names, theorems, forms) };
    for (const field of options.fields) {
      const make = (forms: boolean) => new RuleCrossReference(field.value, lister, forms).withPrefix(field.prefix);
      switch (field.tag) {
        case 'd':
          this.disabledRuleXRefs.push(make(false));
          break;
        case 'D':
          this.disabledRuleXRefs.push(make(true));
          break;
        case 'm':
          this.manualRuleXRefs.push(make(false));
          break;
        case 'M':
          this.manualRuleXRefs.push(make(true));
          break;
        case 'a':
          this.weakAssRuleXRefs.push(make(true));
          break;
        case 'A':
          this.assumedRuleXRefs.push(make(true));
          break;
      }
    }
    for (const name of SELECTOR_OPTIONS) {
      const selector = options.selector(name);
      if (selector != null) this.selectors.set(name, selector);
    }
    this.officialIE = options.hasFlag('officialIE');
    this.noUser = options.hasFlag('noUser');
    this.submitExam = options.hasFlag('submitExam');
    this.printIncorrect = options.hasFlag('printIncorrect');
    // logNeeds
    const need = (a: SelectorOption, b: SelectorOption) => {
      const s = this.selectors.get(a);
      if (s != null && !s.isEmpty()) {
        const t = this.selectors.get(b);
        if (t == null) this.selectors.set(b, s.copy());
        else t.union(s);
      }
    };
    need('needPrint', 'logPrint');
    need('needSubmit', 'logSubmit');
  }

  selector(name: SelectorOption): ProblemSelector | null {
    return this.selectors.get(name) ?? null;
  }

  /** The program's rules, then the box rules (LPDerivation.getRule without the user's rules). */
  getRule(name: string): Rule | null {
    return getProgramRule(name) ?? this.derivationRules.getRule(name);
  }

  /**
   * LPDerivation.listRules: theorem sets, theorems, rules (or all their forms), and "UR" (the
   * user's rules).
   */
  listRules(list: string, names: string[], theorems: IntervalSet, forms: boolean, find: (name: string) => Rule | null = (n) => this.getRule(n)): void {
    let rest = javaTrim(list);
    while (rest !== '') {
      const i = rest.indexOf('.');
      let item: string;
      if (i === -1) {
        item = rest;
        rest = '';
      } else {
        item = javaTrim(rest.substring(0, i));
        rest = javaTrim(rest.substring(i + 1));
      }
      if (item === '') continue; // Java: StringIndexOutOfBoundsException (not in the course data)
      if ('~{'.indexOf(item.charAt(0)) !== -1) {
        theorems.union(new IntervalSet(item));
        continue;
      }
      const n = SchematicRule.parseTheoremNumber(item);
      if (n != null) {
        theorems.union(IntervalSet.singleton(n));
        continue;
      }
      const rule = find(item);
      if (rule != null) {
        if (forms) {
          for (const form of rule.getAllForms()) if (!names.includes(form.name)) names.push(form.name);
        } else if (!names.includes(rule.name)) {
          names.push(rule.name);
        }
      } else if (item.toUpperCase() === 'UR') {
        if (!names.includes('UR')) names.push('UR');
      } else {
        this.unknownRules.push(item);
      }
    }
  }
}
