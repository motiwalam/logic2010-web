/**
 * Helpers that reproduce Java library behavior the desktop program relies on.
 *
 * Use these only where the Java behavior is observable: e.g. where the iteration order of a
 * java.util.Hashtable ends up in saved work, in a message, or decides which of several
 * matches is taken. Elsewhere use plain Map/Set/arrays.
 */

/** java.lang.String.hashCode. */
export function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** java.lang.Integer.hashCode / Character.hashCode: the value itself. */
export function intHash(n: number): number {
  return n | 0;
}

interface Entry<K, V> {
  hash: number;
  key: K;
  value: V;
  next: Entry<K, V> | null;
}

/**
 * java.util.Hashtable, including its iteration order (keys()/elements()/entrySet()), which
 * depends on the keys' hash codes, the insertion history and the rehash points.
 *
 * Keys are compared with `equals` and hashed with `hash`, which must behave like the Java
 * key class's equals/hashCode. Defaults: strings and numbers as java.lang.String/Integer.
 */
export class JavaHashtable<K, V> {
  private table: (Entry<K, V> | null)[];
  private count = 0;
  private threshold: number;
  private readonly hash: (k: K) => number;
  private readonly equals: (a: K, b: K) => boolean;

  constructor(
    options: { initialCapacity?: number; hash?: (k: K) => number; equals?: (a: K, b: K) => boolean } = {},
  ) {
    let capacity = options.initialCapacity ?? 11;
    if (capacity === 0) capacity = 1;
    this.table = new Array(capacity).fill(null);
    this.threshold = Math.floor(capacity * 0.75);
    this.hash = options.hash ?? defaultHash;
    this.equals = options.equals ?? ((a, b) => a === b);
  }

  get size(): number {
    return this.count;
  }

  private indexFor(hash: number, length: number): number {
    return (hash & 0x7fffffff) % length;
  }

  get(key: K): V | undefined {
    const h = this.hash(key);
    for (let e = this.table[this.indexFor(h, this.table.length)]; e; e = e.next) {
      if (e.hash === h && this.equals(e.key, key)) return e.value;
    }
    return undefined;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /** Hashtable.put: returns the previous value. A replaced key keeps its position. */
  put(key: K, value: V): V | undefined {
    const h = this.hash(key);
    let index = this.indexFor(h, this.table.length);
    for (let e = this.table[index]; e; e = e.next) {
      if (e.hash === h && this.equals(e.key, key)) {
        const old = e.value;
        e.value = value;
        return old;
      }
    }
    if (this.count >= this.threshold) {
      this.rehash();
      index = this.indexFor(h, this.table.length);
    }
    this.table[index] = { hash: h, key, value, next: this.table[index] };
    this.count++;
    return undefined;
  }

  remove(key: K): V | undefined {
    const h = this.hash(key);
    const index = this.indexFor(h, this.table.length);
    let prev: Entry<K, V> | null = null;
    for (let e = this.table[index]; e; prev = e, e = e.next) {
      if (e.hash === h && this.equals(e.key, key)) {
        if (prev) prev.next = e.next;
        else this.table[index] = e.next;
        this.count--;
        return e.value;
      }
    }
    return undefined;
  }

  clear(): void {
    this.table.fill(null);
    this.count = 0;
  }

  private rehash(): void {
    const old = this.table;
    const capacity = old.length * 2 + 1;
    const table: (Entry<K, V> | null)[] = new Array(capacity).fill(null);
    this.threshold = Math.floor(capacity * 0.75);
    for (let i = old.length; i-- > 0; ) {
      for (let e = old[i]; e; ) {
        const next: Entry<K, V> | null = e.next;
        const index = this.indexFor(e.hash, capacity);
        e.next = table[index];
        table[index] = e;
        e = next;
      }
    }
    this.table = table;
  }

  /** Entries in Java's enumeration order: buckets from the last to the first, each chain in order. */
  *entries(): IterableIterator<[K, V]> {
    const table = this.table;
    for (let i = table.length; i-- > 0; ) {
      for (let e = table[i]; e; e = e.next) yield [e.key, e.value];
    }
  }

  *keys(): IterableIterator<K> {
    for (const [k] of this.entries()) yield k;
  }

  *values(): IterableIterator<V> {
    for (const [, v] of this.entries()) yield v;
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}

function defaultHash(k: unknown): number {
  if (typeof k === 'string') return stringHash(k);
  if (typeof k === 'number') return intHash(k);
  if (k && typeof (k as { hashCode?: unknown }).hashCode === 'function') {
    return (k as { hashCode(): number }).hashCode();
  }
  throw new Error('JavaHashtable: no hash function for key ' + String(k));
}
