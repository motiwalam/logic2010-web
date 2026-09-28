/**
 * Port of DerivationProblemSet.java, DerivationProblemEntry.java and UserRule.java, and of the
 * static record helpers of LPDerivation.java (getProblemStatement, countProblemLines, hasWork,
 * getWork, removeWork, getProblemRuleProven).
 *
 * The course exercises index which problems prove which rule forms and theorems (their `p`
 * field; ruleProofIndex). The student's work (a DerivationWorkspace's problems) has the user
 * rules: a solved problem named UR... is a rule whose form is its argument.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { ProblemEntry, STATE_UNCHECKED, type ProblemNameSet } from '../../problems/ProblemEntry';
import { ProblemSet } from '../../problems/ProblemSet';
import { IntervalSet } from '../../program/IntervalSet';
import { derModule } from '../../program/ModuleConstants';
import { type Rule, SchematicRule } from '../../rules/Rule';
import { getTheorem, ruleTable } from '../../rules/RuleTable';
import { javaTrim } from '../../util/java';
import type { DerivationConfig } from './DerivationConfig';
import type { DerivationWorkspace } from './DerivationWorkspace';

// ---- record helpers (LPDerivation's statics) ----

export function getProblemStatement(record: TaggedRecord | string | null): string | null {
  const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
  return t.valueAt(t.indexOfAnyTag('-+'));
}

/** The number of lines of the derivation (up to the end of the root box). */
export function countProblemLines(record: TaggedRecord | string): number {
  const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
  let j = 0;
  let k = 0;
  for (let l = 0; l < t.getFieldCount(); l++) {
    const c = t.tagAt(l);
    if (c === '-' || c === '+') {
      j++;
      k++;
    } else if (c === '<') {
      j++;
    } else if (c === '#') {
      j++;
      if (--k === 0) break;
    } else if (c === '=') {
      if (--k === 0) break;
    }
  }
  return j;
}

export function hasWork(record: TaggedRecord | string): boolean {
  return countProblemLines(record) > 1;
}

export function getWork(record: TaggedRecord): string {
  return record.formatFields('-+<#=');
}

/** The record without its work: title, statement, and the %, u and ! fields. */
export function removeWork(record: TaggedRecord): string {
  let s = TaggedRecord.formatField(record.getName(), '$');
  s += TaggedRecord.formatField(getProblemStatement(record), '-') + '`=';
  return s + record.formatFields('%u!');
}

/** The rules and theorems the problem proves (its p field). */
export function getProblemRuleProven(record: TaggedRecord | string): string | null {
  const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
  return t.valueAt(t.indexOfTag('p'));
}

/** String.split with a regex, as Java does it (trailing empty strings removed). */
function javaSplit(s: string, re: RegExp): string[] {
  const parts = s.split(re);
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// ---- entries ----

/**
 * DerivationProblemEntry. The desktop computes the state of a new entry at once (replaying the
 * work); here an entry that is not left unchecked starts STATE_UNCHECKED and its owner computes
 * the state (DerivationWorkspace.updateState), because checking is asynchronous.
 */
export class DerivationProblemEntry extends ProblemEntry {
  constructor(record: string, unchecked: boolean, listed: ProblemNameSet | null) {
    super(record, unchecked, listed);
  }

  computeState(_record: string): number {
    return STATE_UNCHECKED;
  }
}

// ---- user rules ----

/** UserRule: the rule form of a user problem named UR...: its argument. */
export class UserRule extends SchematicRule {
  problemName: string | null = null;

  constructor(problems: ProblemSet, problem: string, name: string = problem) {
    super(name);
    this.loadFromProblem(problems, problem);
  }

  getSourceProblems(): string[] | null {
    return this.problemName == null ? null : [this.problemName];
  }

  loadFromProblem(problems: ProblemSet, problem: string): void {
    const t = new TaggedRecord(problems.getRecord(problem));
    this.problemName = t.getName();
    this.parseForm(getProblemStatement(t) as string);
  }
}

// ---- the set ----

export interface RuleProofIndex {
  /** Form name -> the problems that prove it. */
  forms: Map<string, string[]>;
  /** Theorem number -> the problems that prove it. */
  theorems: Map<number, string[]>;
}

export class DerivationProblemSet extends ProblemSet {
  ruleProofIndex: RuleProofIndex | null = null;

  constructor(
    readonly config: DerivationConfig,
    readonly workspace: DerivationWorkspace | null,
  ) {
    super();
  }

  /** indexRuleProofs: records which forms and theorems the problem proves. */
  indexRuleProofs(record: TaggedRecord): void {
    const name = record.getName();
    const proven = getProblemRuleProven(record);
    if (name == null || proven == null) return;
    const names: string[] = [];
    const theorems = new IntervalSet();
    this.config.listRules(proven, names, theorems, false);
    if (this.ruleProofIndex == null) this.ruleProofIndex = { forms: new Map(), theorems: new Map() };
    for (const n of names) {
      const rule = ruleTable!.getRule(n);
      if (rule == null) continue;
      for (const form of rule.getAllForms()) {
        const list = this.ruleProofIndex.forms.get(form.name);
        if (list == null) this.ruleProofIndex.forms.set(form.name, [name]);
        else if (!list.includes(name)) list.push(name);
      }
    }
    for (const n of intervalElements(theorems)) {
      const theorem = getTheorem(n);
      if (theorem == null) continue;
      let list = this.ruleProofIndex.theorems.get(theorem.number);
      if (list == null) this.ruleProofIndex.theorems.set(theorem.number, (list = [name]));
      if (!list.includes(name)) list.push(name);
    }
  }

  override addProblem(line: string, headings: string[] | null, sorted: boolean): number {
    const record = new TaggedRecord(line);
    const i = this.addProblemRecord(record, headings, sorted);
    if (i !== -1 && this.ruleProofIndex != null) this.indexRuleProofs(record);
    return i;
  }

  async restateProblems(): Promise<void> {
    if (this.workspace != null) await this.workspace.restateProblems();
  }

  /**
   * removeProblem. (The desktop means to drop a user rule UR... from the user rules here, but
   * compares the whole name with "UR", so only a problem named exactly UR is dropped.)
   */
  override removeProblem(i: number): void {
    const name = TaggedRecord.nameOf(this.getRecordAt(i));
    if (name != null && name.toUpperCase() === 'UR' && this.workspace?.userRules != null) {
      const rule = this.workspace.userRules.getRule(name);
      if (rule != null) this.workspace.userRules.removeRule(rule);
    }
    super.removeProblem(i);
  }

  /** "proves MC1, T2 (...forms)" from the p field: what the problem list searches and shows on hover. */
  override getSearchNote(record: TaggedRecord): string | null {
    const s = getProblemRuleProven(record);
    if (s == null || javaTrim(s) === '') return null;
    let out = 'proves ';
    const parts = javaSplit(javaTrim(s), /\s*\.\s*/);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) out += ', ';
      out += parts[i];
      const rule: Rule | null = SchematicRule.parseTheoremNumber(parts[i]) == null ? this.findRule(parts[i]) : null;
      if (rule != null) {
        const forms = rule.getAllForms();
        if (forms.length > 1 || (forms.length === 1 && forms[0].name !== parts[i])) {
          out += ' (' + forms.map((f) => f.name).join(', ') + ')';
        }
      }
    }
    return out;
  }

  /** LPDerivation.getRule: with the user's rules of the workspace, if any. */
  findRule(name: string): Rule | null {
    return this.workspace != null ? this.workspace.getRule(name) : this.config.getRule(name);
  }

  createEntry(record: string, unchecked: boolean): ProblemEntry {
    return new DerivationProblemEntry(record, unchecked, this.workspace?.workProblemNames ?? null);
  }

  hasWork(record: TaggedRecord): boolean {
    return hasWork(record);
  }

  getWork(record: TaggedRecord): string | null {
    return getWork(record);
  }

  removeWork(record: TaggedRecord): string | null {
    return removeWork(record);
  }

  getProblemStatement(record: TaggedRecord): string | null {
    return getProblemStatement(record);
  }

  getModuleIndex(): number {
    return derModule;
  }
}

/** The integers of a (finite) IntervalSet in increasing order. */
export function intervalElements(set: IntervalSet): number[] {
  const out: number[] = [];
  const b = set.boundaries;
  if (set.inverted) return out;
  for (let i = 0; i + 1 < b.length; i += 2) for (let n = b[i]; n < b[i + 1]; n++) out.push(n);
  return out;
}
