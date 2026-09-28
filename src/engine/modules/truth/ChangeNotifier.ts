/**
 * Change notification for the module models (no Java counterpart: the desktop's Swing
 * components repaint themselves). A React view subscribes and re-renders on each change;
 * `version` increases with every change, so it can be used with useSyncExternalStore.
 */
export class ChangeNotifier {
  private readonly listeners = new Set<() => void>();
  private versionCount = 0;

  /** Registers a listener; returns the function that removes it. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The number of changes so far (a snapshot value for useSyncExternalStore). */
  getVersion = (): number => this.versionCount;

  /** Tells the listeners that the model changed. */
  notifyChanged(): void {
    this.versionCount++;
    for (const l of [...this.listeners]) l();
  }
}
