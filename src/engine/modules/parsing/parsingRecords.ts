/**
 * The Parsing module's work records. Port of the static record methods of LPParsing.java
 * (getProblemStatement, hasWork, getWork, removeWork, getProblemState, getProblemState_static).
 *
 * A parsing problem or work line:
 *   $name  =statement  [notation code (O, I or N)  ]expansion (e.g. 2,0,1,0)
 *   *T|F followed by the selected range (main-connective mode)  e errors  t seconds
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { FormulaParseNode } from '../../formula/FormulaParseNode';
import { STATE_CORRECT, STATE_INCORRECT, STATE_NO_WORK } from '../../problems/ProblemEntry';

export const workFileName = 'parwork.txt';
export const logFileName = 'pardata.txt';

export function getProblemStatement(record: TaggedRecord | string | null): string | null {
  const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
  return t.valueAt(t.indexOfAnyTag('='));
}

export function hasWork(record: TaggedRecord | string | null): boolean {
  const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
  return t.indexOfTag('[') !== -1 || t.indexOfTag(']') !== -1 || t.indexOfTag('*') !== -1;
}

export function getWork(record: TaggedRecord): string {
  return record.formatFields('[]*');
}

/** LPParsing.removeWork(TaggedRecord): the record without the student's work. */
export function removeWork(record: TaggedRecord): string {
  return record.formatFields('$=%u!');
}

/** LPParsing.getProblemState(String). */
export function getProblemState(line: string | null): number {
  const t = new TaggedRecord(line);
  return !hasWork(t) ? STATE_NO_WORK : getProblemState_static(t);
}

/**
 * The state of a work record: correct (2) if the notation is right and either the expansion
 * is the whole tree or (main-connective mode) the selection is marked right; otherwise
 * incorrect (1); no work: 0.
 */
export function getProblemState_static(record: TaggedRecord): number {
  if (!hasWork(record)) return STATE_NO_WORK;
  const statement = record.valueAt(record.indexOfTag('=')) ?? '';
  const code = record.valueAt(record.indexOfTag('[')) ?? '';
  const expansion = record.valueAt(record.indexOfTag(']')) ?? '0';
  const selection = record.valueAt(record.indexOfTag('*'));
  const node = new FormulaParseNode(statement);
  if (selection != null) {
    // (Java throws on an empty value; the port reads it as not correct)
    return code === node.getNotationCode() && selection.charAt(0) === 'T' ? STATE_CORRECT : STATE_INCORRECT;
  }
  return code === node.getNotationCode() && expansion === node.getStructureString() ? STATE_CORRECT : STATE_INCORRECT;
}

/** LPParsing.nameVersion: the course database's version column for a problem name. */
export function nameVersion(s: string | null): string {
  return s != null && s.toLowerCase().startsWith('pars') ? '1' : 'NULL';
}
