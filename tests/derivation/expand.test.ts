/**
 * Expand (web only): every correct derivation of the worked examples and of a real student's
 * work, in both notations, expands to a correct derivation with one rule per line; and some
 * hand-made cases.
 */
import { describe, expect, test } from 'vitest';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { expandDerivation, ExpandError } from '../../src/engine/modules/derivation/expandDerivation';
import { LPDerivation } from '../../src/engine/modules/derivation/LPDerivation';
import { HeadlessDialogs } from '../../src/engine/modules/derivation/QueryDialog';
import type { DerivationWorkspace } from '../../src/engine/modules/derivation/DerivationWorkspace';
import { DerivationLineChecker } from '../../src/engine/modules/derivation/DerivationLineChecker';
import { hasWork } from '../../src/engine/modules/derivation/DerivationProblemSet';
import { loadDerivation } from './support';

/** The lines of a record as "formula | justification" (cancel lines "# justification"), indented by box. */
function lines(ws: DerivationWorkspace, record: string): string[] {
  const m = new LPDerivation(ws, { dialogs: new HeadlessDialogs() });
  m.loadProblem(record);
  return m.getLines().slice(1).map((l) => {
    const indent = '  '.repeat(l.getBoxDepth() - 1);
    if (l.box.showLine === l) return `${indent}${l.getLineNumber()} Show ${l.getFormulaText(true)}`;
    if (l.box.cancelLine === l) return `${indent}${l.getLineNumber()} # ${l.getAnnotationText(true)}`;
    return `${indent}${l.getLineNumber()} ${l.getFormulaText(true)} | ${l.getAnnotationText(true)}`;
  });
}

/** The rule steps of a justification (not cited lines or premises). */
function ruleTokens(annotation: string): string[] {
  return annotation
    .replace(/^ASS /i, 'ASS_')
    .split(/\s+/)
    .filter((t) => t !== '' && !/^\d+$/.test(t) && DerivationLineChecker.parsePremiseNumber(t.toUpperCase()) === -1);
}

function userRecord(argument: string, body: string): string {
  return TaggedRecord.toLine(TaggedRecord.formatField(argument, '-') + body + '`=');
}

for (const syntax of [1, 2] as const) {
  for (const student of [false, true]) {
    describe(`expand: ${student ? 'student work' : 'worked examples'}, notation ${syntax}`, () => {
      test('every correct derivation expands to a correct one with one rule per line', async () => {
        const ws = await loadDerivation(syntax, student);
        let expanded = 0;
        let changed = 0;
        for (const entry of ws.problems.elements()) {
          const record = ws.problems.getRecordAt(ws.problems.indexOf(entry))!;
          if (!hasWork(new TaggedRecord(record))) continue;
          const m = new LPDerivation(ws, { dialogs: new HeadlessDialogs() });
          m.loadProblem(record);
          if (!(await m.checkProblem())) continue;
          const r = await expandDerivation(ws, record);
          expect(r.correct, entry.name).toBe(true);
          expanded++;
          if (r.changed) changed++;
          for (const l of lines(ws, r.record)) {
            if (/^\s*\d+ Show /.test(l)) continue;
            const annotation = l.includes(' | ') ? l.substring(l.indexOf(' | ') + 3) : l.substring(l.indexOf('# ') + 2);
            const tokens = ruleTokens(annotation);
            // one rule, or just a premise
            if (tokens.length === 0) expect(annotation, `${entry.name}: ${l}`).toMatch(/^PR\d+$/i);
            else expect(tokens.length, `${entry.name}: ${l}`).toBe(1);
            for (const t of tokens) expect(['DUP', 'DROP', 'SWAP']).not.toContain(t.toUpperCase());
          }
          // expanding again changes nothing
          const again = await expandDerivation(ws, r.record);
          expect(again.changed, entry.name).toBe(false);
        }
        expect(expanded).toBeGreaterThan(40);
        expect(changed).toBeGreaterThan(10);
      }, 300000);
    });
  }
}

describe('expand', () => {
  test('splits a queued line, one rule per line', async () => {
    const ws = await loadDerivation(1, false);
    const record = userRecord(
      'P->Q . P . R&S . (Q&R)->T .: T',
      'T`-P`<PR2`>P->Q`<PR1`>(Q&R)->T`<PR4`>R&S`<PR3`>T`<2 3 mp 5 sl adj[Q&R] 4 mp`>6 dd`#',
    );
    const r = await expandDerivation(ws, record);
    expect(lines(ws, r.record)).toEqual([
      '1 Show T',
      '  2 P | PR2',
      '  3 P->Q | PR1',
      '  4 (Q&R)->T | PR4',
      '  5 R&S | PR3',
      '  6 Q | 2 3 MP',
      '  7 R | 5 SL',
      '  8 Q&R | 6 7 Adj',
      '  9 T | 8 4 MP',
      '  10 # 9 DD',
    ]);
    expect(r.correct).toBe(true);
    expect([r.linesBefore, r.linesAfter]).toEqual([7, 10]);
  });

  test('cites premises where they are used, gives theorems a line, reuses lines and drops what is not needed', async () => {
    const ws = await loadDerivation(1, false);
    // line 3 derives Q again; line 4 is not used; DUP and SWAP rearrange the stack
    const record = userRecord(
      'P->Q . P .: Q&Q',
      'Q&Q`-Q`<pr2 pr1 mp`>Q`<pr1 pr2 swap mp`>P|R`<pr2 addr`>Q`<pr2 pr1 mp`>Q&Q`<5 dup adj`>6 dd`#',
    );
    const r = await expandDerivation(ws, record);
    expect(lines(ws, r.record)).toEqual(['1 Show Q&Q', '  2 Q | PR2 PR1 MP', '  3 Q&Q | 2 2 Adj', '  4 # 3 DD']);
  });

  test('a box rule cites lines in its box', async () => {
    const ws = await loadDerivation(1, false);
    // Q is on line 2, outside the box, but DD must cite a line in the box
    const record = userRecord('P->Q . P .: Q&(P->Q)', 'Q&(P->Q)`-Q`<pr2 pr1 mp`>P->Q`-P`<ass cd`>pr2 pr1 mp cd`#Q&(P->Q)`<2 3 adj`>6 dd`#');
    const r = await expandDerivation(ws, record);
    expect(lines(ws, r.record)).toEqual([
      '1 Show Q&(P->Q)',
      '  2 Q | PR2 PR1 MP',
      '  3 Show P->Q',
      '    4 P | ASS CD',
      '    5 Q | PR2 PR1 MP',
      '    6 # 5 CD',
      '  7 Q&(P->Q) | 2 3 Adj',
      '  8 # 7 DD',
    ]);
  });

  test('a theorem instance is a line of its own', async () => {
    const ws = await loadDerivation(1, false);
    const record = userRecord('P . P->Q .: Q', 'Q`-t3[P->((P->Q)->Q)] pr1 mp pr2 mp dd`#');
    const m = new LPDerivation(ws, { dialogs: new HeadlessDialogs() });
    m.loadProblem(record);
    const ok = await m.checkProblem();
    const r = await expandDerivation(ws, record);
    expect(ok && r.correct).toBe(true);
    expect(lines(ws, r.record)).toEqual(['1 Show Q', '  2 P->((P->Q)->Q) | T3', '  3 (P->Q)->Q | 2 PR1 MP', '  4 Q | 3 PR2 MP', '  5 # 4 DD']);
  });

  test('a line with an error stops it', async () => {
    const ws = await loadDerivation(1, false);
    const record = userRecord('P->Q . P .: Q', '`Q`-Q`<pr1 mt`>2 dd`#');
    await expect(expandDerivation(ws, record)).rejects.toBeInstanceOf(ExpandError);
  });
});
