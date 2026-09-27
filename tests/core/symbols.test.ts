// Notation tables and symbol helpers (translateSymbols and expandEscapes are compared with the
// desktop on every message text in messages.test.ts).
import * as S from '../../src/engine/program/symbols';

test('setSyntax selects the letter sets', () => {
  S.setSyntax(2);
  expect([S.getSyntax(), S.predicateLetters, S.operationLetters, S.variableLetters, S.encodedSymbols]).toEqual([
    2, 'FGHIJKLMNOABCDE', 'abcdefgh', 'ijklmnopqrstuvwxyz', S.kaplan6,
  ]);
  expect(S.variableLetter(-1)).toBe('z');
  expect(S.isPredicateLetter('A')).toBe(true);
  S.setSyntax(7); // ignored: keeps notation 2
  expect(S.getSyntax()).toBe(2);
  S.setSyntax(1);
  expect([S.predicateLetters, S.operationLetters, S.sentenceLetter(11), S.defaultVariable(7)]).toEqual(['FGHIJKLMNO', 'ABCDE', 'P', 'y']);
  expect(S.isPredicateLetter('A')).toBe(false);
});

test('translateSymbols skips {n} placeholders and shifts positions', () => {
  const pos = [0, 2, 3, 6, 9];
  expect(S.translateSymbols('P->{12}->@x', S.maggie, S.symbols, pos)).toBe('P→{12}→∀x');
  expect(pos).toEqual([0, 1, 2, 5, 7]);
  expect(S.findNumberedPlaceholder('a{0}{3}')).toBe('{3}');
  expect(S.findQuestionVariable('F?AB c')).toBe('?AB');
});

test('expandEscapes', () => {
  expect(S.expandEscapes('a\\nb \\lP->Q\\l ->')).toBe('a\nb P→Q ->');
  expect(S.expandEscapes('ab\\')).toBe('abab\\'); // as in Java
});

test('altsymbols', () => {
  S.setAltSymbols();
  expect(S.symbols).toBe(S.kaplan1);
  S.setSyntax(1);
  expect(S.symbols).toBe(S.kaplan2);
});
