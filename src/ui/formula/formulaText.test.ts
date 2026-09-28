import { beforeAll, describe, expect, it } from 'vitest';
import { setSyntax } from '../../engine/program/symbols';
import { fromValue, insertText, keypadRows, normalize, selectEnclosingBrackets, toDisplay, toValue } from './formulaText';

beforeAll(() => setSyntax(1));

/** Types text character by character at the caret, normalizing after each, as the field does. */
function type(start: string, text: string) {
  let st = fromValue(start);
  for (const c of text) {
    const raw = st.display.slice(0, st.selStart) + c + st.display.slice(st.selEnd);
    st = normalize(raw, st.selStart + 1, st.selStart + 1);
  }
  return st;
}

describe('formula text', () => {
  it('translates between maggie and display symbols', () => {
    expect(toDisplay('@x(Fx->~Gx)&!yHy')).toBe('∀x(Fx→∼Gx)∧∃yHy');
    expect(toValue('∀x(Fx→∼Gx)∧∃yHy')).toBe('@x(Fx->~Gx)&!yHy');
    expect(toDisplay('P.:Q|R<->S')).toBe('P∴Q∨R↔S');
    expect(toDisplay('a<>b')).toBe('a≠b');
  });

  it('translates typed ASCII as it is typed, keeping the caret after it', () => {
    const st = type('', 'P->Q');
    expect(st).toEqual({ display: 'P→Q', value: 'P->Q', selStart: 3, selEnd: 3 });
    expect(type('', '(P<->Q)&~R').display).toBe('(P↔Q)∧∼R');
  });

  it('keeps the caret in the middle of the text', () => {
    // "P→Q", caret after P: type "&R"
    let st = fromValue('P->Q');
    st = { ...st, selStart: 1, selEnd: 1 };
    for (const c of '&R') {
      const raw = st.display.slice(0, st.selStart) + c + st.display.slice(st.selEnd);
      st = normalize(raw, st.selStart + 1, st.selStart + 1);
    }
    expect(st.display).toBe('P∧R→Q');
    expect(st.selStart).toBe(3);
  });

  it('accepts quantifier words', () => {
    const st = type('', 'forall x Fx');
    expect(st.value).toBe('@x Fx');
    expect(st.display).toBe('∀x Fx');
    expect(st.selStart).toBe(5);
    const pasted = normalize('forall x Fx', 11, 11);
    expect(pasted).toMatchObject({ value: '@xFx', display: '∀xFx', selStart: 4 });
    expect(type('', 'exists y').value).toBe('!y');
    expect(type('', 'fora').value).toBe('fora');
  });

  it('accepts pasted variants', () => {
    expect(normalize('¬P ⊃ (Q ≡ R)', 0, 0).value).toBe('~P -> (Q <-> R)');
  });

  it('inserts at the caret', () => {
    const st = insertText({ ...fromValue('PQ'), selStart: 1, selEnd: 1 }, '->');
    expect(st).toMatchObject({ display: 'P→Q', value: 'P->Q', selStart: 2 });
    const all = insertText({ ...fromValue('PQ'), selStart: 0, selEnd: 2 }, '~');
    expect(all.display).toBe('∼');
  });

  it('selects enclosing brackets (Ctrl+B)', () => {
    const s = '(P→(Q∧R))';
    expect(selectEnclosingBrackets(s, 5, 5)).toEqual([3, 8]);
    expect(selectEnclosingBrackets(s, 3, 8)).toEqual([0, 9]);
    expect(selectEnclosingBrackets(s, 0, 9)).toBeNull();
    expect(selectEnclosingBrackets('(P]', 1, 1)).toBeNull();
  });

  it('builds the keypad for the notation', () => {
    const rows = keypadRows({ sentence: 'PQ', operation: 'AB', predicate: 'FG' });
    expect(rows[0].keys[0]).toMatchObject({ insert: '->', label: '→', shortcut: 'C' });
    expect(rows[1].keys.map((k) => k.label)).toEqual(['P', 'Q']);
  });
});
