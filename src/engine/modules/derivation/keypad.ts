/**
 * The keys of the derivation's keypad (DerivationLineEditor.showKeypad), as data: for the
 * formula field, the symbols, letters and editing keys; for the justification field, the rule
 * names (fewer in chapters 1 and 2: the chap1 / chap2 options), the SHOW commands and digits.
 * "\l" marks a key shown as a logical symbol. tips are the keyboard shortcuts.
 */
import { operationLetters, predicateLetters, sentenceLetters } from '../../program/symbols';
import type { DerivationLineEditor } from './DerivationLineEditor';

export interface KeypadGridData {
  rows: string[][];
  tips: (string | null)[][] | null;
  /** Keys are whole words (not single characters). */
  words: boolean;
}

const chars = (s: string) => s.split('');

export function keypadFor(editor: DerivationLineEditor): KeypadGridData[] {
  const line = editor.line;
  if (editor === line.formulaEditor) {
    return [
      {
        rows: [
          ['\\l->', '\\l~', '\\l&', '\\l|', '\\l<->', '\\l@', '\\l!', '\\l=', '\\l<>', '\\l%'],
          chars(sentenceLetters),
          ['(', ')', '.', '\\l.:'],
          chars(operationLetters),
          chars(predicateLetters),
          chars('xyzuvw'),
          ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        ],
        tips: [
          ['Ctrl+Shift+C', 'Ctrl+Shift+N', 'Ctrl+Shift+A', 'Ctrl+Shift+O', 'Ctrl+Shift+B', 'Ctrl+Shift+U', 'Ctrl+Shift+E', null, 'Ctrl+Shift+I', 'Ctrl+Shift+D'],
          [],
          [null, null, null, 'Ctrl+Shift+T'],
        ],
        words: false,
      },
      {
        rows: [
          ['space', 'up', 'Show/Unshow', 'enter'],
          ['tab', 'down', 'backspace', 'delete line'],
          ['copy', 'paste'],
        ],
        tips: [
          [null, null, 'Ctrl+Shift+S'],
          [null, null, null, 'Alt+Delete'],
          ['Ctrl+C', 'Ctrl+V'],
        ],
        words: true,
      },
    ];
  }
  if (editor !== line.annotationEditor) return [];
  const chapter = line.box.module.chapter;
  const r1 = ['PR', 'CD', 'ID', 'DD', 'ASS CD', 'ASS ID'];
  const r2 = ['R', 'MP', 'MT', 'DN'];
  const r3 = ['S', 'BC', 'CB', 'MTP', 'ADD', 'ADJ'];
  const r4 = ['DM', 'NC', 'NB', 'CDJ'];
  const r5 = ['UI', 'EI', 'EG', 'QN', 'UD'];
  const rules = chapter === 1 ? [r1, r2] : chapter === 2 ? [r1, r2, r3, r4] : [r1, r2, r3, r4, r5];
  const s1 = ['Show Conc', 'Show Cons', 'Show Ant'];
  const s2 = ['Show Unneg', 'Show NegCons'];
  const s3 = ['Show Corr', 'Show Conj', 'Show Cond'];
  const s4 = ['Show NegDisj'];
  const s5 = ['Show Inst'];
  const t1 = ['Show Conclusion', 'Show Consequent', 'Show Antecedent'];
  const t2 = ['Show Unnegation', 'Show NegConsequent'];
  const t3 = ['Show CorrCond', 'Show Conjunct', 'Show Conditional'];
  const t4 = ['Show NegDisjunct'];
  const t5 = ['Show Instance'];
  const shows = chapter === 1 ? [s1, s2] : chapter === 2 ? [s1, s2, s3, s4] : [s1, s2, s3, s4, s5];
  const showTips = chapter === 1 ? [t1, t2] : chapter === 2 ? [t1, t2, t3, t4] : [t1, t2, t3, t4, t5];
  return [
    { rows: rules, tips: null, words: true },
    { rows: shows, tips: showTips, words: true },
    {
      rows: [
        ['space', 'up', 'Box/Unbox', 'enter'],
        ['tab', 'down', 'backspace', 'delete line'],
        ['copy', 'paste'],
      ],
      tips: [
        [null, null, 'Ctrl+Shift+X'],
        [null, null, null, 'Alt+Delete'],
        ['Ctrl+C', 'Ctrl+V'],
      ],
      words: true,
    },
    { rows: [['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']], tips: null, words: false },
  ];
}
