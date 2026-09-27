/**
 * Port of RuleTable.java: the rules by upper-case name, their names in file order, the
 * headings ("#-" lines, stored under the next rule's name), the rule properties (converses),
 * and the rules RT<n>... derived from theorems (made on demand and cached).
 *
 * Read from the lines of the rules file as DataFiles gives them (legacy format: name, blanks,
 * definition). The program-wide table (LogicProgram.ruleTable) is `ruleTable` here, set by
 * loadRulesAndTheorems / setRuleTable; getRule and getTheorem are LogicProgram.getRule /
 * getTheorem.
 */
import { TaggedRecord } from '../data/TaggedRecord';
import { Rule, SchematicRule, type Theorem } from './Rule';
import { RuleProperties } from './RuleProperties';
import { splitNameLine, TheoremTable } from './TheoremTable';

export class RuleTable {
  readonly theorems: TheoremTable | null;
  readonly rules = new Map<string, Rule>();
  readonly ruleNames: string[] = [];
  readonly theoremRuleCache = new Map<number, Rule>();
  readonly headings = new Map<string, string[]>();
  readonly properties = new RuleProperties();
  /** What Java prints on standard output while reading (bad or repeated rules). */
  readonly problems: string[] = [];

  constructor(theorems: TheoremTable | null) {
    this.theorems = theorems;
  }

  addRuleLine(s: string, headings: string[] | null): void {
    const [name, body] = splitNameLine(s);
    if (this.getRule(name) != null) {
      this.report('redefinition of rule ' + name);
      return;
    }
    const rule = body.indexOf('.:') === -1 ? Rule.fromList(name, body, this) : new SchematicRule(name, body);
    const error = rule.getError();
    if (error != null) {
      this.report('error in rule ' + name + ': ' + error);
      return;
    }
    this.properties.registerConverses(rule);
    if (headings != null) this.headings.set(name, headings);
    this.addRule(rule);
  }

  private report(message: string): void {
    this.problems.push(message);
    console.log(message);
  }

  /** Reads the lines of the rules file (legacy format, unscrambled). */
  static read(lines: readonly string[] | null, theorems: TheoremTable | null): RuleTable | null {
    if (lines == null) return null;
    const table = new RuleTable(theorems);
    let headings: string[] | null = null;
    for (const s of lines) {
      if (TaggedRecord.isBlankOrComment(s)) {
        if (s.indexOf('#-') === 0) (headings ??= []).push(s.substring(2));
      } else {
        table.addRuleLine(s, headings);
        headings = null;
      }
    }
    return table;
  }

  addRule(rule: Rule): void {
    this.rules.set(rule.name.toUpperCase(), rule);
    this.ruleNames.push(rule.name);
  }

  getRule(name: string): Rule | null {
    return this.rules.get(name.toUpperCase()) ?? null;
  }

  getTheorem(n: number | null): Theorem | null {
    return this.theorems == null ? null : this.theorems.getTheorem(n);
  }

  /** T<n>: the theorem; RT<n>...: the theorem's rule (or its form); otherwise the named rule. */
  findRule(name: string): Rule | null {
    let n = Rule.parseTheoremNumber(name);
    if (n != null) return this.getTheorem(n);
    n = Rule.parseTheoremRuleNumber(name);
    if (n != null) {
      let rule = this.theoremRuleCache.get(n) ?? null;
      if (rule == null) {
        rule = Rule.fromTheorem(this.getTheorem(n));
        if (rule == null) return null;
        this.theoremRuleCache.set(n, rule);
      }
      return rule.findComponent(name);
    }
    return this.getRule(name);
  }

  removeRule(rule: Rule): void {
    this.rules.delete(rule.name.toUpperCase());
    const i = this.ruleNames.indexOf(rule.name);
    if (i !== -1) this.ruleNames.splice(i, 1);
  }

  get size(): number {
    return this.rules.size;
  }
}

/** The program's rule table (LogicProgram.ruleTable). */
export let ruleTable: RuleTable | null = null;

export function setRuleTable(table: RuleTable | null): void {
  ruleTable = table;
}

/** Reads the theorems and rules (LogicProgram.loadRulesAndTheorems); a RulesLoader for loadProgram. */
export function loadRulesAndTheorems(theoremLines: readonly string[], ruleLines: readonly string[]): RuleTable | null {
  const theorems = TheoremTable.read(theoremLines);
  ruleTable = RuleTable.read(ruleLines, theorems);
  return ruleTable;
}

/** LogicProgram.getRule: the rule (or theorem) of that name. */
export function getRule(name: string): Rule | null {
  return ruleTable == null ? null : ruleTable.findRule(name);
}

/** LogicProgram.getTheorem. */
export function getTheorem(n: number | null): Theorem | null {
  return ruleTable == null ? null : ruleTable.getTheorem(n);
}
