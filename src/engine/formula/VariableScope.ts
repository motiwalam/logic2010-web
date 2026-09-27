/**
 * Port of VariableScope.java: a table from variable symbol to binder whose push/pop shadow
 * and restore older bindings (used while linking variables to their quantifiers).
 */
export class VariableScope<V> {
  private readonly table = new Map<string, V>();
  private shadowed: VariableScope<V> | null = null;

  get(key: string): V | null {
    return this.table.get(key) ?? null;
  }

  push(key: string, value: V): void {
    const old = this.table.get(key);
    this.table.set(key, value);
    if (old !== undefined) {
      if (this.shadowed == null) this.shadowed = new VariableScope<V>();
      this.shadowed.push(key, old);
    }
  }

  pop(key: string): V | null {
    const old = this.table.get(key);
    this.table.delete(key);
    if (old !== undefined && this.shadowed != null) {
      const outer = this.shadowed.pop(key);
      if (outer != null) this.table.set(key, outer);
    }
    return old ?? null;
  }

  getShadowed(key: string, depth: number): V | null {
    if (depth === 0) return this.get(key);
    return this.shadowed == null ? null : this.shadowed.getShadowed(key, depth - 1);
  }
}
