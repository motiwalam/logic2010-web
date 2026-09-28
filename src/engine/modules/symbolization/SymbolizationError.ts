/**
 * Ports of SymbolizationErrorButton.java, SymbolizationHint.java and NodeMessageHandler.java:
 * the explanation of a node that does not match the closest answer (symerr001..003), the
 * hint for a node that does (symnot001), and the dialog's actions (Up, Text, Symb).
 */
import { DialogHandler } from '../../program/DialogHandler';
import { Message, type MessageParams } from '../../program/Message';
import { symModule } from '../../program/ModuleConstants';
import { maggie, symbols, translateSymbols } from '../../program/symbols';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import type { SymbolizationNode } from './SymbolizationNode';
import { substituteVariables, translateExpressionText, translateVariable } from './SymbolizationNode';

function symMessage(id: string): Message {
  return Message.getModule(symModule, id);
}

/** An "Error" button on a node's connective panel. */
export class SymbolizationError {
  readonly targetBinders: string[];
  readonly answerBinders: string[];

  constructor(
    readonly target: SymbolizationNode,
    readonly answer: SymbolizationNode,
    targetBinders: readonly string[],
    answerBinders: readonly string[],
  ) {
    this.targetBinders = [...targetBinders];
    this.answerBinders = [...answerBinders];
  }

  /** The message the button shows (buildMessage), with its actions. */
  buildMessage(): NodeMessage {
    const message = SymbolizationError.chooseErrorMessage(this.target, this.answer, this.targetBinders, this.answerBinders);
    const text = Message.substitute(message.text, SymbolizationError.errorParams(this.target, this.answer, this.targetBinders, this.answerBinders));
    return new NodeMessage(message, text, this.target, this.answer, this.targetBinders, this.answerBinders);
  }

  static errorParams(target: SymbolizationNode, answer: SymbolizationNode, v: string[], v1: string[]): MessageParams {
    const params = Message.params(
      'wrong statement',
      target.getEnglishText(),
      'wrong type',
      target.describeType(),
      'right statement',
      substituteVariables(answer.getEnglishText(), v1, v),
      'right type',
      answer.describeType(v1, v),
    );
    if (target.isBinder()) Message.putParam(params, 'bound var', target.getLabel());
    return params;
  }

  static chooseErrorMessage(target: SymbolizationNode, answer: SymbolizationNode, v: string[], v1: string[]): Message {
    if (answer.connective === 11 && target.connective === 11) {
      const s = target.getLabel();
      let s1: string | null = answer.getLabel();
      s1 = answer.isLowercaseTerm() ? translateVariable(s1!, v1, v) : translateExpressionText(s1, v1, v);
      if (s1 == null) return symMessage('symerr003');
      return s1 === s ? symMessage('symerr002') : symMessage('symerr001');
    }
    if (answer.connective === target.connective && answer.isBinder()) return symMessage('symerr002');
    return symMessage('symerr001');
  }
}

/** A hint for a node that lines up with the closest answer (SymbolizationHint). */
export class SymbolizationHint {
  readonly targetBinders: string[];
  readonly answerBinders: string[];

  constructor(
    readonly target: SymbolizationNode,
    readonly answer: SymbolizationNode,
    targetBinders: readonly string[],
    answerBinders: readonly string[],
  ) {
    this.targetBinders = [...targetBinders];
    this.answerBinders = [...answerBinders];
  }

  buildMessage(): NodeMessage {
    const message = symMessage('symnot001');
    const text = Message.substitute(message.text, SymbolizationHint.hintParams(this.answer, this.targetBinders, this.answerBinders));
    return new NodeMessage(message, text, this.target, this.answer, this.targetBinders, this.answerBinders);
  }

  static hintParams(answer: SymbolizationNode, v: string[], v1: string[]): MessageParams {
    return Message.params('right statement', substituteVariables(answer.getEnglishText(), v1, v), 'right type', answer.describeType(v1, v));
  }
}

/** The result of a NodeMessage action. */
export interface NodeActionResult {
  /** The dialog closes (OK, or an unknown action). */
  close: boolean;
  /** The desktop beeps (Up at the root). */
  beep?: boolean;
}

/**
 * An error or hint message about a node, with its buttons (from the catalogue's button
 * spec) and the state its actions work on (NodeMessageHandler's properties): the target
 * node, the answer node and the two binder lists. Up moves both to their parents and
 * replaces the text by the parent's hint; Text copies the answer's English into the target;
 * Symb gives the target the answer's connective (or atomic expression).
 */
export class NodeMessage {
  readonly id: string;
  readonly title: string;
  readonly isError: boolean;
  readonly handler: DialogHandler;
  /** The text shown (with the catalogue's \n, \l escapes; LogicProgram.expandEscapes renders it). */
  text: string;
  target: SymbolizationNode;
  answer: SymbolizationNode;
  targetBinders: string[];
  answerBinders: string[];

  constructor(message: Message, text: string, target: SymbolizationNode, answer: SymbolizationNode, targetBinders: string[], answerBinders: string[]) {
    this.id = message.id;
    this.title = message.id;
    this.isError = message.isError;
    this.handler = new DialogHandler(message.buttons);
    this.text = text;
    this.target = target;
    this.answer = answer;
    this.targetBinders = [...targetBinders];
    this.answerBinders = [...answerBinders];
  }

  get labels(): string[] {
    return this.handler.getLabels();
  }

  /** The node whose symbol Symb would set, and whether it will ask for a symbol (see perform). */
  symbPrompt(): string | null {
    return this.target.symbolPrompt(this.answer.connective, this.symbLabel());
  }

  private symbLabel(): string | null {
    const shown = this.answer.connective === 11 ? translateSymbols(this.answer.getLabel(), maggie, symbols) : null;
    return DelimitedTokenizer.escape(translateExpressionText(translateSymbols(shown, symbols, maggie), this.answerBinders, this.targetBinders), '\\{');
  }

  /**
   * NodeMessageHandler.handleChoice for the button's action ("up", "ok", "text", "symb").
   * ask answers setConnective's question for Symb (see SymbolizationNode.setConnective).
   */
  perform(action: string | null, ask: (prompt: string) => string | null = () => null): NodeActionResult {
    if (action == null) return { close: true };
    const a = action.toLowerCase();
    if (a === 'up') {
      const parent = this.target.getParentNode();
      const answerParent = this.answer.getParentNode();
      if (parent == null || answerParent == null) return { close: false, beep: true };
      this.target = parent;
      this.answer = answerParent;
      if (parent.isBinder()) this.targetBinders.length = this.targetBinders.length - 1;
      if (answerParent.isBinder()) this.answerBinders.length = this.answerBinders.length - 1;
      this.text = Message.substitute(symMessage('symnot001').text, SymbolizationHint.hintParams(answerParent, this.targetBinders, this.answerBinders));
      return { close: false };
    }
    if (a === 'ok') return { close: true };
    if (a === 'text') {
      this.target.setText(substituteVariables(this.answer.text, this.answerBinders, this.targetBinders));
      return { close: false };
    }
    if (a === 'symb') {
      this.target.setConnective(this.answer.connective, this.symbLabel(), true, ask);
      return { close: false };
    }
    return { close: true };
  }
}
