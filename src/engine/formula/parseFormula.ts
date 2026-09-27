/**
 * Port of LogicProgram.parseFormula (m1008/m1009), the program's formula entry point, with
 * findNumberedPlaceholder / findQuestionVariable checks and error translation.
 *
 * parseFormula(s, allowTerm, allowPlaceholders, allowUnknowns):
 *  - "forall x" / "exists x" are accepted for @x / !x (QuantifierWords);
 *  - a blank string gives null;
 *  - the variables are linked to their binders;
 *  - {n} placeholders are rejected unless allowPlaceholders, ?ABC unknowns unless
 *    allowUnknowns, a term unless allowTerm, and text whose parenthesization is not that of
 *    the formula ("... is not well formed");
 *  - errors with a column are rethrown as "Parse error at position N." or "Lexical error at
 *    position N.", N being the 1-based position in the text as the user sees it (quantifier
 *    words, and the display symbols the program shows for ->, <-> etc.).
 */
import { toSymbols, toSymbolsAt } from '../data/QuantifierWords';
import { parseErrorColumn } from '../program/LogicProgram';
import { findNumberedPlaceholder, findQuestionVariable, maggie, symbols, translateSymbols } from '../program/symbols';
import { javaTrim } from '../util/java';
import { type Expression, Term } from './Expression';
import { FormulaLexerError, FormulaParseException, parseLine } from './FormulaParser';
import { FormulaParseNode } from './FormulaParseNode';

export { FormulaLexerError, FormulaParseException } from './FormulaParser';

export function parseFormula(
  text: string | null,
  allowTerm = false,
  allowPlaceholders = false,
  allowUnknowns = false,
): Expression | null {
  const typed = text;
  const s = toSymbols(text);
  try {
    if (s == null || javaTrim(s) === '') return null;
    const e = parseLine(s + '\n');
    if (e != null) e.linkVariables();
    let found: string | null;
    if (!allowPlaceholders && (found = findNumberedPlaceholder(s)) != null) {
      throw new FormulaParseException('Parse error, column ' + (s.indexOf(found) + 1) + '.');
    }
    if (!allowUnknowns && (found = findQuestionVariable(s)) != null) {
      throw new FormulaParseException('Parse error, column ' + (s.indexOf(found) + 1) + '.');
    }
    const node = new FormulaParseNode(e);
    node.text = s;
    if (!node.isParenthesizationValid()) throw new FormulaParseException(s + ' is not well formed');
    if (!allowTerm && e instanceof Term) throw new FormulaParseException('Syntax error: expected Formula but found Term');
    return e;
  } catch (err) {
    if (err instanceof FormulaParseException) {
      const column = parseErrorColumn(err.javaMessage);
      if (column === -1) throw err;
      throw new FormulaParseException('Parse error at position ' + typedPosition(typed!, column) + '.');
    }
    if (err instanceof FormulaLexerError) {
      const column = parseErrorColumn(err.message);
      if (column === -1) throw new FormulaParseException(err.message);
      throw new FormulaParseException('Lexical error at position ' + typedPosition(typed!, column) + '.');
    }
    throw err;
  }
}

/** The 1-based position in the text as typed and displayed of a column of the parsed text. */
function typedPosition(typed: string, column: number): number {
  const position = [toSymbolsAt(typed, column - 1)[1] + 1];
  translateSymbols(typed, maggie, symbols, position);
  return position[0];
}
