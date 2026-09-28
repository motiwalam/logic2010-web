/**
 * Change notification for the module models (no Java counterpart: the desktop's Swing
 * components repaint themselves). A React screen subscribes with useSyncExternalStore,
 * using getVersion() as the snapshot.
 */
export class ChangeNotifier {
  private readonly listeners = new Set<() => void>();
  private version = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Increases with every change. */
  getVersion(): number {
    return this.version;
  }

  /** Tells the subscribers that the model changed. */
  notifyChanged(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }
}
