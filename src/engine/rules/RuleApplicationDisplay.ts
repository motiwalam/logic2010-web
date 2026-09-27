/**
 * Port of RuleApplicationDisplay.java (as data): "premises .: conclusion" of a rule
 * application with its instantiated schematic letters and fresh bound variables highlighted,
 * one layer per letter. The disambiguation and rule-choice dialogs show it.
 */
import { FormulaParseNode } from '../formula/FormulaParseNode';
import type { Expression } from '../formula/Expression';
import type { SchemeInstantiation } from '../formula/SchemeInstantiation';
import type { BoundVariableMap } from './BoundVariableMap';
import { HighlightedText } from './HighlightedText';

/** What the display needs of a rule application (the derivation module's RuleApplication). */
export interface DisplayableApplication {
  instantiation: SchemeInstantiation;
  boundVariables: BoundVariableMap;
  clone(): DisplayableApplication;
  getPremiseCount(): number;
  getPremise(i: number): Expression;
  getConclusion(): Expression;
}

export class RuleApplicationDisplay {
  application: DisplayableApplication;
  displayInstantiation: SchemeInstantiation;
  premiseDisplays: FormulaParseNode[];
  conclusionDisplay: FormulaParseNode;

  constructor(application: DisplayableApplication) {
    this.application = application.clone();
    this.displayInstantiation = this.application.instantiation.assignFreshLetters(null);
    this.premiseDisplays = [];
    for (let j = 0; j < this.application.getPremiseCount(); j++) {
      this.premiseDisplays.push(this.createDisplay(this.application.getPremise(j)));
    }
    this.conclusionDisplay = this.createDisplay(this.application.getConclusion());
  }

  createDisplay(e: Expression): FormulaParseNode {
    const node = new FormulaParseNode(e, true, -1);
    node.addLetterRanges(this.displayInstantiation.pendingLetters);
    node.addTermRanges(this.application.boundVariables);
    return node;
  }

  /** The display; with conclusionOnlyIfUnrelated, just the conclusion when it shares no highlight with the premises. */
  toHighlightedText(conclusionOnlyIfUnrelated = true): HighlightedText {
    const text = new HighlightedText();
    for (let j = 0; j < this.application.getPremiseCount(); j++) {
      if (j !== 0) text.append('.');
      text.append(this.premiseDisplays[j].toStyledText());
    }
    const conclusion = this.conclusionDisplay.toStyledText();
    if (conclusionOnlyIfUnrelated && !text.sharesHighlightLayer(conclusion)) return conclusion;
    text.append('.:');
    text.append(conclusion);
    return text;
  }
}
