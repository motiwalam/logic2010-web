/**
 * Tidy (web only): every derivation of the worked examples and of a real student's work, in
 * both notations, tidies without losing its verdict, and tidying again changes nothing; and
 * some hand-made cases.
 */
import { describe, expect, test } from 'vitest';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { hasWork } from '../../src/engine/modules/derivation/DerivationProblemSet';
import type { DerivationWorkspace } from '../../src/engine/modules/derivation/DerivationWorkspace';
import { LPDerivation } from '../../src/engine/modules/derivation/LPDerivation';
import { HeadlessDialogs } from '../../src/engine/modules/derivation/QueryDialog';
import { ALL_TIDY_OPTIONS, tidyDerivation } from '../../src/engine/modules/derivation/tidyDerivation';
import { loadDerivation } from './support';

function lines(ws: DerivationWorkspace, record: string): string[] {
  const m = new LPDerivation(ws, { dialogs: new HeadlessDialogs() });
  m.loadProblem(record);
  return m.getLines().slice(1).map((l) => {
    const indent = '  '.repeat(l.getBoxDepth() - 1);
    if (l.box.showLine === l) return `${indent}${l.getLineNumber()} Show ${l.getFormulaText(false)}`;
    if (l.box.cancelLine === l) return `${indent}${l.getLineNumber()} # ${l.getAnnotationText(false)}`;
    return `${indent}${l.getLineNumber()} ${l.getFormulaText(false)} | ${l.getAnnotationText(false)}`;
  });
}

function userRecord(argument: string, body: string): string {
  return TaggedRecord.toLine(TaggedRecord.formatField(argument, '-') + body + '`=');
}

async function state(ws: DerivationWorkspace, record: string): Promise<boolean> {
  const m = new LPDerivation(ws, { dialogs: new HeadlessDialogs() });
  m.loadProblem(record);
  return m.checkProblem();
}

for (const syntax of [1, 2] as const) {
  for (const student of [false, true]) {
    describe(`tidy: ${student ? 'student work' : 'worked examples'}, notation ${syntax}`, () => {
      test('every derivation tidies and keeps its verdict; tidying again changes nothing', async () => {
        const ws = await loadDerivation(syntax, student);
        let changed = 0;
        for (const entry of ws.problems.elements()) {
          const record = ws.problems.getRecordAt(ws.problems.indexOf(entry))!;
          if (!hasWork(new TaggedRecord(record))) continue;
          const correct = await state(ws, record);
          const r = await tidyDerivation(ws, record, ALL_TIDY_OPTIONS);
          expect(r.note ?? '', entry.name).not.toMatch(/could not be tidied/);
          if (!r.changed) continue;
          changed++;
          if (correct) expect(await state(ws, r.record), entry.name).toBe(true);
          const again = await tidyDerivation(ws, r.record, ALL_TIDY_OPTIONS);
          expect(again.changed, `${entry.name}: ${again.done.join(', ')}`).toBe(false);
        }
        expect(changed).toBeGreaterThan(10);
      }, 300000);
    });
  }
}

describe('tidy', () => {
  test('normalizes notation, keeping queued steps, assertions (normalized) and answers', async () => {
    const ws = await loadDerivation(1, false);
    const record = userRecord('P->Q . P . R&S . (Q&R)->T .: T', 'T`-P`<pr`>(Q & R) -> T`<pr4`>T`<2 pr1 mp  pr3 sl adj[ (Q & R) ] 3 mp # done`>4 dd`#');
    const r = await tidyDerivation(ws, record, { blankLines: false, unusedLines: false, repeatedLines: false, notation: true });
    expect(lines(ws, r.record)).toEqual(['1 Show T', '  2 P | PR2', '  3 Q&R->T | PR4', '  4 T | 2 PR1 MP PR3 SL Adj[Q∧R] 3 MP # done', '  5 # 4 DD']);
    expect(r.done).toEqual(['4 lines rewritten']);
  });

  test('removes blank, repeated and unused lines, renumbering the citations', async () => {
    const ws = await loadDerivation(1, false);
    const record = userRecord(
      'P->Q . P .: Q',
      'Q`-P`<PR2`>`<`>P`<PR2`>R|P`<2 ADDL`>Q`<4 PR1 MP`>6 DD`#',
    );
    const r = await tidyDerivation(ws, record, ALL_TIDY_OPTIONS);
    expect(lines(ws, r.record)).toEqual(['1 Show Q', '  2 P | PR2', '  3 Q | 2 PR1 MP', '  4 # 3 DD']);
    expect(r.done).toEqual(['1 blank line', '1 repeated line', '1 unused line']);
  });

  test('keeps work in progress and leaves a derivation with errors structurally alone', async () => {
    const ws = await loadDerivation(1, false);
    const open = userRecord('P->Q . P .: Q', 'Q`-P`<PR2`>R|P`<2 ADDL`>`<`>');
    const r = await tidyDerivation(ws, open, ALL_TIDY_OPTIONS);
    expect(lines(ws, r.record)).toEqual(['1 Show Q', '  2 P | PR2', '  3 R|P | 2 AddL']);
    const wrong = userRecord('P->Q . P .: Q', 'Q`-P`<PR2`>P`<pr2`>Q`<2 mt`>`<`>');
    const w = await tidyDerivation(ws, wrong, ALL_TIDY_OPTIONS);
    expect(lines(ws, w.record)).toEqual(['1 Show Q', '  2 P | PR2', '  3 P | PR2', '  4 Q | 2 mt']);
    expect(w.note).toMatch(/errors/);
  });
});
