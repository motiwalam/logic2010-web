/**
 * Port of DerivationNode.java: what boxes (DerivationBox) and lines (DerivationLine) have in
 * common: text access, messages, navigation, numbering, references, checking and encoding.
 * A box stands for its Show line where a line is expected.
 */
import type { Expression } from '../../formula/Expression';
import type { MessageParams } from '../../program/Message';
import type { DerivationBox } from './DerivationBox';
import type { DerivationLine } from './DerivationLine';
import type { DerivationLineEditor } from './DerivationLineEditor';
import type { LineReference } from './LineReference';

export interface DerivationNodeBase {
  setFormulaText(s: string): void;
  getFormulaText(stripComment: boolean): string | null;
  setAnnotationText(s: string): void;
  getAnnotationText(stripComment: boolean): string | null;
  setMessageText(s: string | null, isError: boolean): void;
  showMessage(id: string, params?: MessageParams | null): void;
  clearMessage(): void;
  getFormulaEditor(): DerivationLineEditor | null;
  getAnnotationEditor(): DerivationLineEditor | null;
  getIndexInBox(): number;
  getEnclosingBox(): DerivationBox | null;
  insertLineAfter(): DerivationLine | null;
  deleteNode(withBody: boolean): void;
  moveIntoPreviousBox(): void;
  moveOutOfBox(): void;
  focusEditor(annotation: boolean): void;
  getNextNode(visibleOnly: boolean): DerivationNode | null;
  getPreviousNode(visibleOnly: boolean): DerivationNode | null;
  getHeadNode(): DerivationNode;
  isShowLine(): boolean;
  isCancelLine(): boolean;
  areEnclosingBoxesExpanded(): boolean;
  expandEnclosingBoxes(): void;
  getLineNumber(): number;
  findLine(n: number): DerivationNode | null;
  renumberLines(n: number): number;
  getMaxBoxDepth(visibleOnly: boolean): number;
  getBoxDepth(): number;
  countLines(visibleOnly: boolean): number;
  addReferrer(r: LineReference): void;
  removeReferrer(r: LineReference): void;
  detachReferrers(): void;
  retargetReferrers(): void;
  checkSyntax(): boolean;
  getFormula(): Expression | null;
  refreshReferenceNumbers(): void;
  verify(): Promise<boolean>;
  encodeWork(): string;
  encodeMessages(): string;
}

export type DerivationNode = DerivationBox | DerivationLine;
