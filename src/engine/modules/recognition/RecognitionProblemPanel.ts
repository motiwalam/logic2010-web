/**
 * A recognition problem: the argument, the student's answer (a rule name or "None") and the
 * verdict. Port of RecognitionProblemPanel.java (its logic; the Swing layout is the UI's).
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { Message } from '../../program/Message';
import { recModule } from '../../program/ModuleConstants';
import { expandEscapes, maggie, symbols, translateSymbols } from '../../program/symbols';
import { ArgumentParser } from '../../rules/ArgumentParser';
import type { Rule } from '../../rules/Rule';
import { getRule } from '../../rules/RuleTable';
import { equalsIgnoreCase, javaTrim } from '../../util/java';
import { parseRuleList } from './recognitionRecords';

/** RecognitionMessage.getText. */
export function recognitionMessageText(id: string): string {
  return Message.getModule(recModule, id).text;
}

/** What RecognitionProblemPanel needs of its LPRecognition. */
export interface RecognitionPanelHost {
  setProblemTitle(name: string | null): void;
  /** titlePanel.setStatement (in display symbols). */
  statementText: string;
  /** The course exercise record of a problem name (LPRecognition.exercises.getRecord). */
  getExerciseRecord(name: string | null): string | null;
  ruleActive(rule: Rule): boolean;
  activeRulesRule(): Rule;
}

/** The outcome of checkAnswer, with what the panel shows. */
export interface RecognitionVerdict {
  correct: boolean;
  /** The message behind the comment (recnot00x), or null for a correct answer (the success comment). */
  messageId: string | null;
  /** The message's parameters (ruleName, thisPremise). */
  params: Record<string, string> | null;
}

export class RecognitionProblemPanel {
  argument: ArgumentParser | null = null;
  problemName: string | null = null;
  statement: string | null = null;
  correctRules: string[] | null = null;
  nearMissRules: string[] | null = null;
  successComment: string | null = null;
  /** The answer as last read from the rule field (null: empty). */
  answer: string | null = null;
  /** The rule field's text, as typed. */
  ruleText = '';
  /** The verdict label: "Correct", "Incorrect" or "". */
  verdict = '';
  /** The comment below the verdict. */
  comment = '';
  /** The premises and conclusion as shown (display symbols). */
  premiseLabels: string[] = [];
  conclusionLabel = '';

  constructor(readonly host: RecognitionPanelHost) {}

  /** The prompt above the rule field (recnot005). */
  static getPromptText(): string {
    return expandEscapes(Message.getModule(recModule, 'recnot005').text);
  }

  clear(): void {
    this.argument = null;
    this.problemName = null;
    this.statement = null;
    this.correctRules = null;
    this.nearMissRules = null;
    this.successComment = null;
    this.answer = null;
    this.premiseLabels = [];
    this.conclusionLabel = '';
    this.ruleText = '';
    this.verdict = '';
    this.comment = '';
  }

  loadProblem(record: TaggedRecord): void {
    this.clear();
    this.host.setProblemTitle(record.getName());
    this.statement = record.valueAt(record.indexOfTag('='));
    this.host.statementText = this.statement == null ? '' : translateSymbols(this.statement, maggie, symbols);
    this.argument = ArgumentParser.parse(this.statement);
    this.answer = record.valueAt(record.indexOfTag('*'));
    const exercise = new TaggedRecord(this.host.getExerciseRecord(this.problemName));
    this.correctRules = parseRuleList(exercise.valueAt(exercise.indexOfTag('@')));
    this.nearMissRules = parseRuleList(exercise.valueAt(exercise.indexOfTag('~')));
    this.successComment = exercise.valueAt(exercise.indexOfTag('&'));
    if (this.argument != null) {
      this.premiseLabels = this.argument.premiseTexts.map((t) => translateSymbols(t, maggie, symbols));
      this.conclusionLabel = translateSymbols(this.argument.conclusionText, maggie, symbols) ?? '';
    }
    if (this.answer != null) this.ruleText = this.answer;
  }

  readAnswer(): void {
    const a = javaTrim(this.ruleText);
    this.answer = a.length === 0 ? null : a;
  }

  getWorkRecord(): string {
    this.readAnswer();
    return TaggedRecord.formatField(this.problemName, '$') + TaggedRecord.formatField(this.statement, '=') + TaggedRecord.formatField(this.answer, '*');
  }

  clearAnswer(): void {
    this.answer = null;
    this.ruleText = '';
    this.verdict = '';
    this.comment = '';
  }

  private showVerdict(correct: boolean, s: string | null): boolean {
    this.verdict = correct ? 'Correct' : 'Incorrect';
    this.comment = s == null ? (correct ? 'Congratulations!' : 'Try Again.') : expandEscapes(javaTrim(s));
    return correct;
  }

  /** "this premise" or "these premises". */
  private thisPremise(): string {
    // Java: a near miss with no argument throws a NullPointerException here
    return this.argument!.premises.length === 1 ? 'this premise' : 'these premises';
  }

  private showMessage(correct: boolean, id: string, params: Record<string, string> | null): RecognitionVerdict {
    let text = recognitionMessageText(id);
    if (params != null) text = Message.substitute(text, Message.params(...Object.entries(params).flat()));
    this.showVerdict(correct, text);
    return { correct, messageId: id, params };
  }

  private success(): RecognitionVerdict {
    this.showVerdict(true, this.successComment);
    return { correct: true, messageId: null, params: null };
  }

  /** RecognitionProblemPanel.checkAnswer, with the reason. */
  checkAnswerVerdict(): RecognitionVerdict {
    this.readAnswer();
    const answer = this.answer;
    if (answer == null) return this.showMessage(false, 'recnot001', null);
    const upper = answer.toUpperCase();
    if (this.correctRules != null && this.correctRules.includes(upper)) return this.success();
    if (this.nearMissRules != null && this.nearMissRules.includes(upper)) {
      return this.showMessage(false, 'recnot006', { ruleName: answer, thisPremise: this.thisPremise() });
    }
    if (upper === 'NONE') {
      return this.correctRules == null && (this.argument == null || this.argument.matchRule(this.host.activeRulesRule()) !== 2)
        ? this.success()
        : this.showMessage(false, 'recnot001', null);
    }
    const rule = getRule(answer);
    if (rule == null) return this.showMessage(false, 'recnot002', { ruleName: answer });
    if (!this.host.ruleActive(rule)) return this.showMessage(false, 'recnot007', { ruleName: rule.name });
    if (this.argument == null) return this.showMessage(false, 'recnot004', null);
    const i = this.argument.matchRule(rule);
    if (i === 2) return this.success();
    if (i !== 1 && !this.isLenientSinglePremiseRule(rule)) {
      return this.showMessage(false, 'recnot003', { ruleName: rule.name, thisPremise: this.thisPremise() });
    }
    return this.showMessage(false, 'recnot006', { ruleName: rule.name, thisPremise: this.thisPremise() });
  }

  checkAnswer(): boolean {
    return this.checkAnswerVerdict().correct;
  }

  /** EG, AV and AV3 with one premise: "applicable but wrong conclusion" instead of "not applicable". */
  isLenientSinglePremiseRule(rule: Rule): boolean {
    if (this.argument!.premises.length !== 1) return false;
    return ['EG', 'AV', 'AV3'].some((n) => equalsIgnoreCase(rule.name, n));
  }
}
