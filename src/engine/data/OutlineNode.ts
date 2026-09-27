/**
 * The derivation tips outline (derivation-tips.rec) as a tree. Port of the data model of
 * OutlineNode.parseOutline (OutlineNode.java).
 *
 * The file is read as one record. `$` (text) fields accumulate the text of the next entry;
 * `+` (entry, collapsed) and `-` (expanded-entry) create an entry with that text, titled by
 * the field's value, as a child of the most recently created entry; `=` (end) makes the
 * current entry's parent the current one. The first entry is the root.
 */
import type { ScrambledReader } from './Scrambler';
import { TaggedRecord } from './TaggedRecord';
import { expandEscapes } from '../program/symbols';

export interface OutlineNode {
  /** The entry's title, with escapes expanded (as shown). */
  title: string;
  /** The entry's text, with escapes expanded. */
  text: string;
  /** The title and text as in the file. */
  rawTitle: string;
  rawText: string;
  /** Initially expanded ('-' entries). */
  expanded: boolean;
  children: OutlineNode[];
  parent: OutlineNode | null;
}

/** OutlineNode.readOutline: the outline's root, or null (no reader, or no entries). */
export function readOutline(reader: ScrambledReader | null): OutlineNode | null {
  return reader == null ? null : parseOutline(TaggedRecord.fromReader(reader));
}

export function parseOutline(record: TaggedRecord): OutlineNode | null {
  let root: OutlineNode | null = null;
  let current: OutlineNode | null = null;
  let text = '';
  for (let k = 0; k < record.getFieldCount(); k++) {
    const tag = record.tagAt(k);
    const value = record.values[k];
    if (tag === '$') {
      text += value;
    } else if (tag === '+' || tag === '-') {
      const node: OutlineNode = {
        title: expandEscapes(value),
        text: expandEscapes(text),
        rawTitle: value,
        rawText: text,
        expanded: tag === '-',
        children: [],
        parent: current,
      };
      if (root == null) root = node;
      else current!.children.push(node);
      current = node;
      text = '';
    } else if (tag === '=' && current != null && current.parent != null) {
      current = current.parent;
    }
  }
  return root;
}
