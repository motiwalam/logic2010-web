/**
 * Test support for the derivation module: loading the engine and a workspace as the oracle
 * does (tools/oracle/derivation/.../OracleDerivation.java setup), recording dialogs as
 * OracleDialogs does, and the lines of a derivation as the oracle writes them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProgram } from '../../src/engine/program/loadProgram';
import { expandEscapes, translateSymbols } from '../../src/engine/program/symbols';
import { loadRulesAndTheorems } from '../../src/engine/rules/RuleTable';
import { DerivationConfig } from '../../src/engine/modules/derivation/DerivationConfig';
import { DerivationWorkspace } from '../../src/engine/modules/derivation/DerivationWorkspace';
import type { DerivationLine } from '../../src/engine/modules/derivation/DerivationLine';
import { LPDerivation } from '../../src/engine/modules/derivation/LPDerivation';
import type { DerivationDialogs, QueryDialog } from '../../src/engine/modules/derivation/QueryDialog';
import { repoData } from '../support/fsDataSource';

export function derivationFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, '../fixtures/derivation', name), 'utf8')) as T;
}

export async function loadDerivation(syntax: 1 | 2, student: boolean): Promise<DerivationWorkspace> {
  await loadProgram(repoData, { syntax, loadRules: (t, r) => void loadRulesAndTheorems(t, r) });
  const config = await DerivationConfig.load();
  const work = student
    ? { fileName: 'derivation.rec', text: readFileSync(join(__dirname, '../fixtures/core/student-derivation.rec'), 'utf8') }
    : null;
  const ws = await DerivationWorkspace.open(config, work);
  ws.clock = () => 0;
  return ws;
}

export interface DialogRecord {
  kind: string;
  title: string;
  texts: string[];
  buttons: string[];
  answer: string;
  refused?: boolean;
  placed?: string;
  closed: boolean;
  selected: number;
}

/** The dialog's content as OracleDialogs scrapes the Swing components. */
export function scrape(d: QueryDialog): string[] {
  const out: string[] = [];
  for (const b of d.blocks) {
    switch (b.type) {
      case 'text':
        for (const line of expandEscapes(b.text).split('\n')) out.push(line);
        break;
      case 'formula':
        out.push(translateSymbols(b.text));
        break;
      case 'choices':
        for (const o of b.options) {
          if (!o.enabled) continue;
          if (o.highlight != null) {
            out.push('( )');
            out.push(translateSymbols(o.text));
          } else {
            out.push('( ) ' + o.text);
          }
        }
        break;
      case 'field':
        out.push(b.field.text);
        break;
      case 'substitution':
        for (const r of b.rows) {
          out.push(r.label);
          out.push(r.field.text);
        }
        break;
      case 'selector':
        out.push(b.selector.text);
        b.selector.values.forEach((v, i) => {
          out.push('{' + (i + 1) + '}: ');
          out.push(v ?? '');
        });
        break;
    }
  }
  return out;
}

/** Records the dialogs and answers them from a script (as OracleDialogs). */
export class RecordingDialogs implements DerivationDialogs {
  log: DialogRecord[] = [];
  answers: string[] = [];

  reset(script: string[] = []): void {
    this.log = [];
    this.answers = script.slice();
  }

  async show(d: QueryDialog): Promise<void> {
    const texts = d.kind === 'message' ? [expandEscapes((d.blocks[0] as { text: string }).text)] : scrape(d);
    const answer = this.answers.length === 0 ? 'cancel' : this.answers.shift()!;
    const rec: DialogRecord = { kind: d.kind, title: d.title, texts, buttons: d.buttons.slice(), answer, closed: true, selected: -1 };
    this.log.push(rec);
    rec.closed = await this.apply(d, answer, rec);
    rec.selected = d.selectedButton;
  }

  private async apply(d: QueryDialog, answer: string, rec: DialogRecord): Promise<boolean> {
    const press = async (i: number) => {
      const ok = await d.press(i);
      if (!ok) {
        rec.refused = true;
        d.close();
      }
      return ok;
    };
    if (answer.startsWith('choice:')) {
      d.choice = Number(answer.substring(7));
      return press(0);
    }
    if (answer.startsWith('text:')) {
      const values = answer.substring(5).split('|');
      const fields = d.blocks.flatMap((b) =>
        b.type === 'field' ? (b.field.editable ? [b.field] : []) : b.type === 'substitution' ? b.rows.map((r) => r.field).filter((f) => f.editable) : [],
      );
      values.forEach((v, i) => fields[i]?.setText(v));
      return press(0);
    }
    if (answer.startsWith('select:')) {
      const [s, e] = answer.substring(7).split(',').map(Number);
      const fields = d.blocks.flatMap((b) => (b.type === 'field' ? [b.field] : []));
      fields[fields.length - 1].select(s, e);
      return press(0);
    }
    if (answer.startsWith('place:')) {
      const nums = answer.substring(6).split(',').map(Number);
      const block = d.blocks.find((b) => b.type === 'selector');
      const selector = block != null && block.type === 'selector' ? block.selector : null;
      for (let i = 0; i + 1 < nums.length; i += 2) await selector!.insertPlaceholder(0, nums[i], nums[i + 1]);
      rec.placed = selector!.text;
      return press(0);
    }
    if (answer.startsWith('button:')) return press(Number(answer.substring(7)));
    d.close();
    return true;
  }
}

/** A module with a window, recording its dialogs. */
export function windowModule(ws: DerivationWorkspace, dialogs: RecordingDialogs): LPDerivation {
  return new LPDerivation(ws, { dialogs, hasFrame: true, doSubs: true });
}

export interface LineRecord {
  n: number;
  k: string;
  f: string | null;
  a: string | null;
  id: string | null;
  text: string;
  phase: number;
  open?: boolean;
  x?: string;
}

export function lineRecord(l: DerivationLine, withExplanation = true): LineRecord {
  const kind = l.box.showLine === l ? (l.box.parentBox == null ? 'P' : 'S') : l.box.cancelLine === l ? 'C' : 'L';
  const r: LineRecord = {
    n: l.getLineNumber(),
    k: kind,
    f: l.getFormulaText(false),
    a: l.getAnnotationText(false),
    id: l.message == null ? null : l.message.id.toLowerCase(),
    text: l.getShownMessage(),
    phase: l.messagePhase,
  };
  if (l.box.showLine === l && l.box.parentBox != null) r.open = l.box.isExpanded();
  if (withExplanation && l.messageButtonVisible) r.x = l.messageButton.explanation;
  return r;
}

export function treeRecord(m: LPDerivation): LineRecord[] {
  return m.getLines().map((l) => lineRecord(l));
}

export function encode(m: LPDerivation): string {
  m.loadTime = 0;
  return m.saveProblem();
}

export function javaErrorName(e: unknown): string {
  if (e instanceof TypeError) return 'NullPointerException';
  if (e instanceof RangeError) return 'ArrayIndexOutOfBoundsException';
  return e instanceof Error ? e.message.split(':')[0] : String(e);
}
