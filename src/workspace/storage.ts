// Local persistence: a small async key-value store. IndexedDB in the browser, with
// localStorage as the fallback (private windows, old browsers) and memory for tests or when
// neither works. Values must be structured-clonable and JSON-serializable.

export interface KeyValueStore {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys starting with prefix. */
  keys(prefix?: string): Promise<string[]>;
}

export class MemoryStore implements KeyValueStore {
  readonly kind = 'memory' as const;
  readonly data = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(prefix = ''): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

const LS_PREFIX = 'logic2010:';

export class LocalStorageStore implements KeyValueStore {
  readonly kind = 'localstorage' as const;

  constructor(private readonly storage: Storage) {}

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.storage.getItem(LS_PREFIX + key);
    return v == null ? undefined : (JSON.parse(v) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.storage.setItem(LS_PREFIX + key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.storage.removeItem(LS_PREFIX + key);
  }

  async keys(prefix = ''): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k != null && k.startsWith(LS_PREFIX + prefix)) out.push(k.slice(LS_PREFIX.length));
    }
    return out;
  }
}

const DB_NAME = 'logic2010';
const STORE = 'kv';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbStore implements KeyValueStore {
  readonly kind = 'indexeddb' as const;

  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<IndexedDbStore> {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    return new IndexedDbStore(await promisify(req));
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return (await promisify(this.tx('readonly').get(key))) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const store = this.tx('readwrite');
    await promisify(store.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await promisify(this.tx('readwrite').delete(key));
  }

  async keys(prefix = ''): Promise<string[]> {
    const all = (await promisify(this.tx('readonly').getAllKeys())) as IDBValidKey[];
    return all.map(String).filter((k) => k.startsWith(prefix));
  }
}

/** The best store this browser offers. */
export async function openDefaultStore(): Promise<KeyValueStore> {
  try {
    if (typeof indexedDB !== 'undefined') return await IndexedDbStore.open();
  } catch {
    // fall through (e.g. Firefox private windows in older versions)
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_PREFIX + 'probe', '1');
      localStorage.removeItem(LS_PREFIX + 'probe');
      return new LocalStorageStore(localStorage);
    }
  } catch {
    // storage disabled
  }
  return new MemoryStore();
}
