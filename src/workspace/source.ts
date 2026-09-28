// What a module screen sees of a workspace: its files by path, and (unless read-only) a way to
// save them. The student's own workspace (WorkspaceStore) and another user's published work
// (ReadOnlyWorkspace) both provide it.

import type { WorkFile } from '../sync/api';
import type { WorkspaceStore } from './WorkspaceStore';

export interface WorkSource {
  readonly readOnly: boolean;
  /** The owner's username, or null for your own work. */
  readonly ownerName: string | null;
  /** A file's text, e.g. getFile('syntax1/derivation.rec'); null if there is none. */
  getFile(path: string): string | null;
  /** Saves a file. Throws on a read-only source. */
  saveFile(path: string, text: string): void;
  /** Paths with content. */
  paths(): string[];
  subscribe(listener: () => void): () => void;
  /** Changes whenever any file changes (for useSyncExternalStore). */
  getRevision(): number;
}

export class ReadOnlyError extends Error {
  constructor(owner: string | null) {
    super(`This is ${owner ?? 'another user'}'s work; it cannot be changed here.`);
  }
}

/** Your own workspace as a WorkSource. */
export function storeSource(store: WorkspaceStore): WorkSource {
  return {
    readOnly: false,
    ownerName: null,
    getFile: (path) => store.getText(path),
    saveFile: (path, text) => store.setText(path, text),
    paths: () => store.paths(),
    subscribe: (l) => store.subscribe(l),
    getRevision: () => store.getSnapshot().revision,
  };
}

/** Another user's work, as published on the server. */
export class ReadOnlyWorkspace implements WorkSource {
  readonly readOnly = true;
  private readonly files: Map<string, WorkFile>;

  constructor(
    readonly ownerName: string,
    files: readonly WorkFile[],
  ) {
    this.files = new Map(files.map((f) => [f.path, f]));
  }

  getFile(path: string): string | null {
    return this.files.get(path)?.content ?? null;
  }

  fileInfo(path: string): WorkFile | undefined {
    return this.files.get(path);
  }

  saveFile(): void {
    throw new ReadOnlyError(this.ownerName);
  }

  paths(): string[] {
    return [...this.files.keys()];
  }

  subscribe(): () => void {
    return () => undefined;
  }

  getRevision(): number {
    return 0;
  }
}
