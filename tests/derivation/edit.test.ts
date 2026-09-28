/**
 * Editing operations (typing, Enter in command mode, Show lines, boxing and canceling,
 * deleting lines, indenting, collapsing, navigating, relative references) applied by the same
 * scripts (tests/fixtures/derivation/edit-scripts.txt) in the desktop program and here: the
 * lines, the focus and the saved work after every step.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DerivationBox } from '../../src/engine/modules/derivation/DerivationBox';
import type { DerivationLine } from '../../src/engine/modules/derivation/DerivationLine';
import type { DerivationLineEditor } from '../../src/engine/modules/derivation/DerivationLineEditor';
import type { LPDerivation } from '../../src/engine/modules/derivation/LPDerivation';
import { derivationFixture, encode, javaErrorName, loadDerivation, RecordingDialogs, windowModule, type DialogRecord } from './support';

interface Step {
  op: string[];
  result: string | null;
  dialogs: DialogRecord[];
  state: { focus: string | null; lines: [number, string, string | null, string | null, string | null, number, boolean | null][] };
}

function scripts(): string[][][] {
  const text = readFileSync(join(__dirname, '../fixtures/derivation/edit-scripts.txt'), 'utf8');
  const out: string[][][] = [];
  let cur: string[][] | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    if (line.trim() === '') {
      cur = null;
      continue;
    }
    if (cur == null) out.push((cur = []));
    cur.push(line.split('\t'));
  }
  return out;
}

function lineAt(m: LPDerivation, n: number): DerivationLine {
  const node = n === 0 ? m.problem : m.problem.findLine(n)!;
  return node instanceof DerivationBox ? node.showLine : node;
}

function focus(m: LPDerivation, e: DerivationLineEditor | null): void {
  if (m.focus === e) return;
  if (m.focus != null) m.focus.focusLost();
  if (e != null && m.focus !== e) e.focusGained();
}

function state(m: LPDerivation): Step['state'] {
  const e = m.focus;
  const f = e == null ? null : e.line.getLineNumber() + ':' + (e === e.line.annotationEditor ? 'a' : e === e.line.formulaEditor ? 'f' : '?');
  return {
    focus: f,
    lines: m.getLines().map((l) => [
      l.getLineNumber(),
      l.box.showLine === l ? (l.box.parentBox == null ? 'P' : 'S') : l.box.cancelLine === l ? 'C' : 'L',
      l.formulaEditor == null ? null : l.formulaEditor.getText(),
      l.annotationEditor == null ? null : l.annotationEditor.getText(),
      l.message == null ? null : l.message.id.toLowerCase(),
      l.box.getBoxDepth(),
      l.box.showLine === l ? l.box.isExpanded() : null,
    ]),
  };
}

describe('edit-1.json', () => {
  test('editing operations match the desktop program', async () => {
    const fixture = derivationFixture<{ scripts: { steps: Step[]; saved: string }[] }>('edit-1.json');
    const ws = await loadDerivation(1, false);
    const all = scripts();
    expect(all.length).toBe(fixture.scripts.length);
    for (let s = 0; s < all.length; s++) {
      const dialogs = new RecordingDialogs();
      const m = windowModule(ws, dialogs);
      const steps: Step[] = [];
      for (const op of all[s]) {
        let result: string | null = null;
        try {
          switch (op[0]) {
            case 'load': {
              const i = ws.problems.indexOfName(op[1]);
              m.loadProblem(ws.problems.getRecordAt(i));
              m.problemIndex = i;
              break;
            }
            case 'user':
              await m.loadUserProblem(op[1]);
              break;
            case 'focus': {
              const l = lineAt(m, Number(op[1]));
              focus(m, op[2] === 'a' ? l.annotationEditor : l.formulaEditor);
              break;
            }
            case 'blur':
              focus(m, null);
              break;
            case 'text':
              m.focus!.edit(op[1]);
              break;
            case 'caret':
              m.focus!.setCaretPosition(Number(op[1]));
              break;
            case 'key':
              result = String(await m.focus!.handleKeyTyped(String.fromCharCode(Number(op[1])), Number(op[2])));
              break;
            case 'press':
              result = String(m.focus!.handleKeyPressed(Number(op[1]), Number(op[2])));
              break;
            case 'check':
              result = String(await m.checkProblem());
              break;
            case 'record':
              m.loadProblem(op[1]);
              break;
            case 'answers':
              dialogs.reset(op[1] === '' ? [] : op[1].split(/\|(?=[a-z]+:)/));
              break;
            case 'checkline': {
              const l = lineAt(m, Number(op[1]));
              m.abort(false);
              m.resetVarNames();
              l.justifications = null;
              l.parseReferences();
              result = String(await l.checkLine(op[2] === 'i'));
              break;
            }
            case 'save':
              result = encode(m);
              break;
          }
        } catch (e) {
          result = 'X:' + javaErrorName(e);
        }
        // the desktop moves the focus with Swing events, which the scripts do explicitly
        m.pendingFocus = null;
        m.focusLostPending = false;
        steps.push({ op, result, state: state(m), dialogs: dialogs.log });
        dialogs.log = [];
      }
      expect({ steps, saved: encode(m) }, 'script ' + (s + 1)).toEqual(fixture.scripts[s]);
    }
  }, 60000);
});
