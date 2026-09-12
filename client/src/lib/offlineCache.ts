// Minimal IndexedDB helper. Every transaction owns and closes its connection.
type StoreName = 'pairings' | 'stats';
type PairingCacheRecord = { key: string; data: any; updatedAt: number };
const DB_NAME = 'pbs-cache-v2';
const DB_VERSION = 4;
const CURRENT_SCHEMA_VERSION = '2.0.0';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['pairings', 'stats']) {
        const store = db.objectStoreNames.contains(name)
          ? request.transaction!.objectStore(name)
          : db.createObjectStore(name, { keyPath: 'key' });
        if (!store.indexNames.contains('updatedAt'))
          store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('metadata'))
        db.createObjectStore('metadata', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (abandoned) db.close();
      else resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      abandoned = true;
      reject(
        new Error(
          'Offline cache upgrade is blocked. Close older app tabs and retry.'
        )
      );
    };
  });
}

async function withStore<T>(
  name: StoreName,
  mode: 'readonly' | 'readwrite',
  operation: (store: IDBObjectStore) => ReturnType<IDBObjectStore['get']>
): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error('Cache transaction aborted'));
      const request = operation(tx.objectStore(name));
      request.onsuccess = () => {
        result = request.result;
      };
    });
  } finally {
    db.close();
  }
}

function put(store: StoreName, key: string, data: any): Promise<void> {
  return withStore(store, 'readwrite', target =>
    target.put({ key, data, updatedAt: Date.now() })
  );
}
async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  const record = await withStore<PairingCacheRecord | undefined>(
    store,
    'readonly',
    target => target.get(key)
  );
  return record?.data as T | undefined;
}

export function cacheKeyForPairings(
  bidPackageId?: number,
  filters?: Record<string, any>,
  userId?: string | number
): string {
  const userPrefix = userId !== undefined ? `user:${userId}:` : '';
  const prefix = `${userPrefix}pairings:v2:${bidPackageId ?? 'default'}`;
  const {
    sortBy,
    sortOrder,
    page,
    limit,
    bidPackageId: _,
    ...rest
  } = filters ?? {};
  const cleaned = Object.fromEntries(
    Object.entries(rest).filter(
      ([, value]) => value !== undefined && value !== null && value !== ''
    )
  );
  if (Object.keys(cleaned).length === 0) return `${prefix}:all`;
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)])
      );
    return value;
  };
  return `${prefix}:${JSON.stringify(canonical(cleaned))}`;
}

export async function savePairingsCache(key: string, data: any): Promise<void> {
  return put('pairings', key, data);
}
export async function loadPairingsCache<T>(
  key: string
): Promise<T | undefined> {
  return get<T>('pairings', key);
}
export async function saveStatsCache(key: string, data: any): Promise<void> {
  return put('stats', key, data);
}
export async function loadStatsCache<T>(key: string): Promise<T | undefined> {
  return get<T>('stats', key);
}
export async function saveFullPairingsCache(
  key: string,
  data: any[]
): Promise<void> {
  return put('pairings', `full:${key}`, data);
}
export async function loadFullPairingsCache<T = any[]>(
  key: string
): Promise<T | undefined> {
  return get<T>('pairings', `full:${key}`);
}
export async function hasFullPairingsCache(key: string): Promise<boolean> {
  return (await loadFullPairingsCache(key)) !== undefined;
}
export async function getAllCacheKeys(store: StoreName): Promise<string[]> {
  return withStore(store, 'readonly', target => target.getAllKeys());
}
export async function deleteCache(
  store: StoreName,
  key: string
): Promise<void> {
  return withStore(store, 'readwrite', target => target.delete(key));
}

export async function purgeUserCache(userId: string | number): Promise<void> {
  const prefix = `user:${userId}:`;
  for (const store of ['pairings', 'stats'] as const) {
    const keys = (await getAllCacheKeys(store)).filter(
      key => key.startsWith(prefix) || key.startsWith(`full:${prefix}`)
    );
    await withStore(store, 'readwrite', target => {
      for (const key of keys) target.delete(key);
      return target.count();
    });
  }
}

export async function clearAllCache(): Promise<void> {
  await Promise.all(
    (['pairings', 'stats'] as const).map(store =>
      withStore(store, 'readwrite', target => target.clear())
    )
  );
}

export async function getCacheInfo(): Promise<{
  schemaVersion: string;
  dbVersion: number;
  totalEntries: number;
  userCacheStats: Record<string, number>;
  lastUpdated: Date | null;
}> {
  // Read only keys and the timestamp index; diagnostics must not deserialize
  // every cached dataset on startup or when opening profile settings.
  const [keys, newest] = await Promise.all([
    getAllCacheKeys('pairings'),
    withStore<{ key: number } | null>('pairings', 'readonly', target =>
      target.index('updatedAt').openKeyCursor(null, 'prev')
    ),
  ]);
  const userCacheStats: Record<string, number> = {};
  for (const key of keys) {
    const user = key.match(/^(?:full:)?user:(\d+):/)?.[1] ?? 'no-user';
    userCacheStats[user] = (userCacheStats[user] ?? 0) + 1;
  }
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    dbVersion: DB_VERSION,
    totalEntries: keys.length,
    userCacheStats,
    lastUpdated: newest ? new Date(Number(newest.key)) : null,
  };
}

export async function migrateOldCacheFormat(): Promise<void> {
  // Versioned cache keys isolate older formats; no user data needs migration.
}
