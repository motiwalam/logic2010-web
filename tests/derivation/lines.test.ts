/**
 * Interactive and non-interactive re-checks of single lines with variants of their
 * justifications (asserted results, wrong rule names, preset answers, DUP/DROP/SWAP, shifted
 * and relative citations, a cleared formula, a wrong formula), answering the dialogs from a
 * script, against the desktop program: the line's message, the other lines' messages, the
 * dialogs opened (kind, texts, buttons), and the re-encoded work.
 */
import { describe, expect, test } from 'vitest';
import { md5Base64 } from '../../src/engine/data/Scrambler';
import { DerivationBox } from '../../src/engine/modules/derivation/DerivationBox';
import type { DerivationLine } from '../../src/engine/modules/derivation/DerivationLine';
import type { LPDerivation } from '../../src/engine/modules/derivation/LPDerivation';
import { javaErrorName, derivationFixture, encode, lineRecord, loadDerivation, RecordingDialogs, windowModule, type DialogRecord, type LineRecord } from './support';

interface LinesFixture {
  lines: {
    name: string;
    n: number;
    text: string;
    mode: string;
    script: string;
    ok: boolean;
    ready: boolean;
    error: string | null;
    aborted: boolean;
    errors: number;
    line: LineRecord;
    work: string;
    messages: [number, string, string][];
    dialogs: DialogRecord[];
    saved: string;
  }[];
}

function lineAt(m: LPDerivation, n: number): DerivationLine {
  const node = m.problem.findLine(n)!;
  return node instanceof DerivationBox ? node.showLine : node;
}


for (const syntax of [1, 2] as const) {
  for (const student of [false, true]) {
    const name = `lines-${student ? 'student-' : ''}${syntax}.json`;
    describe(name, () => {
      test('line checks match the desktop program', async () => {
        const fixture = derivationFixture<LinesFixture>(name);
        const ws = await loadDerivation(syntax, student);
        const dialogs = new RecordingDialogs();
        for (const c of fixture.lines) {
          const i = ws.problems.indexOfName(c.name);
          const m = windowModule(ws, dialogs);
          m.loadProblem(ws.problems.getRecordAt(i));
          m.problemIndex = i;
          const l = lineAt(m, c.n);
          l.setAnnotationText(c.text);
          if (c.mode === 'c') {
            l.setFormulaText('');
            l.parseFormula();
          } else if (c.mode === 'p') {
            l.setFormulaText('P');
            l.parseFormula();
          }
          dialogs.reset(c.script === '' ? [] : c.script.split(/\|(?=[a-z]+:)/));
          const interactive = c.mode === 'i' || c.mode === 'c';
          let error: string | null = null;
          let ok = false;
          let ready = false;
          try {
            m.abort(false);
            m.resetVarNames();
            l.justifications = null;
            l.parseReferences();
            ok = await l.checkLine(interactive);
            ready = l.readyToCancel;
            if (interactive && ok && ready) await l.toggleBoxAndCancel();
          } catch (e) {
            error = javaErrorName(e);
          }
          const messages = m
            .getLines()
            .filter((x) => x !== l && x.message != null)
            .map((x) => [x.getLineNumber(), x.message!.id.toLowerCase(), x.getShownMessage()] as [number, string, string]);
          const actual = {
            ...c,
            ok,
            ready,
            error,
            aborted: m.aborted(),
            errors: m.errorCount,
            line: lineRecord(l, false),
            work: l.encodeWork(),
            messages,
            dialogs: dialogs.log,
            saved: md5Base64(encode(m)),
          };
          expect(actual, `${c.name} line ${c.n}: ${c.text} (${c.mode})`).toEqual(c);
        }
      }, 600000);
    });
  }
}
