/**
 * The print lists of LPSymbolizer.java (getStatements, getAnswers, getResults,
 * getPrintProblems) as text, for a printable page. The desktop's logPrint submission log
 * (symdata.txt) is not kept.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { STATE_CODES } from '../../problems/ProblemEntry';
import { expandEscapes } from '../../program/symbols';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import { LPSymbolizer } from './LPSymbolizer';
import type { SymbolizationModule } from './SymbolizationModule';
import { getProblemStatement } from './SymbolizationRecords';

/** Print List: each problem's name, statement and scheme. */
export function getStatements(m: SymbolizationModule, indexes: readonly number[]): string[] {
  return indexes.map((i) => {
    const t = new TaggedRecord(m.problems!.getEntryAt(i)!.name);
    const name = t.getName();
    let scheme = t.valueAt(t.indexOfTag('='));
    if (scheme == null) {
      const e = new TaggedRecord(m.exercises!.getRecord(name));
      scheme = e.valueAt(e.indexOfTag('='));
    }
    if (scheme == null) scheme = 'No Scheme Available';
    return expandEscapes('\\l' + name + ': ' + getProblemStatement(t) + '\n' + scheme);
  });
}

/** Print Answers (instructors): each exercise with its scheme, note and answer formulas. */
export function getAnswers(m: SymbolizationModule, exerciseIndexes: readonly number[]): string[] {
  return exerciseIndexes.map((i) => {
    const record = m.exercises!.getRecordAt(i)!;
    const t = new TaggedRecord(record);
    let s = m.trimTitle(t.getName()) + '\n' + getProblemStatement(t) + '\n';
    const scheme = t.valueAt(t.indexOfTag('='));
    if (scheme != null) s += scheme + '\n';
    const note = t.valueAt(t.indexOfTag('!'));
    if (note != null) s += note + '\n';
    const session = new LPSymbolizer(m, { forPrint: true });
    session.loadProblem(record);
    for (const a of session.problem.answers ?? []) {
      session.loadProblem(a);
      s += session.problem.toString() + '\n';
    }
    return s;
  });
}

export interface PrintedProblem {
  /** The state code shown beside the problem (N, I, C, U). */
  code: string;
  text: string;
  /** The problem as loaded (for drawing its tree; getPrintProblems only). */
  session: LPSymbolizer;
}

function printed(m: SymbolizationModule, indexes: readonly number[], results: boolean): PrintedProblem[] {
  const out: PrintedProblem[] = [];
  for (const i of indexes) {
    const entry = m.problems!.getEntryAt(i)!;
    const t = new TaggedRecord(entry.name);
    const name = t.getName();
    if (m.printIncorrect && entry.state !== 1) continue;
    const exercise = m.exercises!.getRecord(name);
    let scheme: string | null = null;
    if (exercise != null) {
      const e = new TaggedRecord(exercise);
      scheme = e.valueAt(e.indexOfTag('='));
    }
    if (scheme == null) scheme = '';
    const session = new LPSymbolizer(m, { forPrint: true });
    session.loadProblem(t);
    const formula = DelimitedTokenizer.escape(session.problem.toString(), '\\');
    const text = m.trimTitle(name) + ': ' + getProblemStatement(t) + '\\n' + scheme + (results ? '\\n\\l' : '\\n') + formula;
    out.push({ code: STATE_CODES[entry.state], text: expandEscapes(text), session });
  }
  return out;
}

/** Print Results: each problem's state, statement, scheme and formula. */
export function getResults(m: SymbolizationModule, indexes: readonly number[]): PrintedProblem[] {
  return printed(m, indexes, true);
}

/** Print: as Print Results, with the tree. */
export function getPrintProblems(m: SymbolizationModule, indexes: readonly number[]): PrintedProblem[] {
  return printed(m, indexes, false);
}
