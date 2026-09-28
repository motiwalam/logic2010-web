/**
 * The static record helpers of LPSymbolizer.java: a symbolization problem's statement, its
 * first node's symbol, whether it has work, and the work removed.
 *
 * A problem record: $ name, - English statement (present when the + fields hold work),
 * + one node per tree node in pre-order ("code:English"), = scheme, @ answer keys,
 * g answer group, o original name, % options, ! note, C common name, e/h/t error count,
 * hint count, seconds worked.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import { connSymbol } from './SymbolizationConstants';

export function getProblemStatement(record: TaggedRecord | string): string | null {
  const t = typeof record === 'string' ? new TaggedRecord(record) : record;
  const s = t.valueAt(t.indexOfTag('-'));
  if (s != null) return s;
  const node = t.valueAt(t.indexOfTag('+'));
  if (node == null) return null;
  const d = new DelimitedTokenizer('\\:');
  d.setInput(node);
  d.nextToken();
  return d.getRemaining();
}

export function getProblemSymbol(record: TaggedRecord | string): string | null {
  const t = typeof record === 'string' ? new TaggedRecord(record) : record;
  const s = t.valueAt(t.indexOfTag('+'));
  if (s == null) return t.indexOfTag('-') === -1 ? null : connSymbol[0];
  const d = new DelimitedTokenizer('\\:');
  d.setInput(s);
  const s1 = d.nextToken();
  return d.getRemaining() == null ? null : s1;
}

export function getHintCount(t: TaggedRecord): number {
  return t.intValueAt(t.indexOfTag('h')) ?? 0;
}

export function hasWork(record: TaggedRecord | string): boolean {
  const t = typeof record === 'string' ? new TaggedRecord(record) : record;
  return t.indexOfTag('-') === -1 ? connSymbol[0] !== getProblemSymbol(t) : t.indexOfTag('+') !== -1;
}

export function getWork(t: TaggedRecord): string {
  return t.indexOfTag('-') === -1 && connSymbol[0] === getProblemSymbol(t) ? '' : t.formatFields('+');
}

/** LPSymbolizer.removeWork(TaggedRecord): the record without its tree (and counts). */
export function removeWork(t: TaggedRecord): string {
  let s = TaggedRecord.formatField(t.getName(), '$');
  s += TaggedRecord.formatField(getProblemStatement(t), '-');
  return s + t.formatFields('=@%u!');
}
