/**
 * Port of ChildRecordSnapshot.java: keeps the children's work (their type and serialized
 * subtree) when the student changes a node's connective, and puts back those whose type
 * still fits the new argument slots.
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import type { SymbolizationNode } from './SymbolizationNode';

export class ChildRecordSnapshot {
  childTypes: number[] = [];
  childRecords: string[] = [];

  constructor(node?: SymbolizationNode) {
    if (node) this.capture(node);
  }

  capture(node: SymbolizationNode): void {
    const n = node.argTypes.length;
    this.childTypes = [];
    this.childRecords = [];
    for (let j = 0; j < n; j++) {
      const c = node.getChildNode(j);
      // (an atomic node with argument types has no child nodes; the desktop fails here)
      this.childTypes.push(c == null ? 2 : c.outType);
      this.childRecords.push(c == null ? '' : c.toRecord(false));
    }
  }

  restore(node: SymbolizationNode): void {
    const types = node.argTypes;
    const n = Math.min(types.length, this.childTypes.length);
    for (let j = 0; j < n; j++) {
      if (types[j] === 2 || this.childTypes[j] === 2 || this.childTypes[j] === types[j]) {
        node.getChildNode(j)?.loadRecord(new TaggedRecord(this.childRecords[j]), false);
      }
    }
  }
}
