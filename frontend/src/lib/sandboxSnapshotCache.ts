export type DependencySnapshotRecord = {
  depFingerprint: string;
  toolchainVersion: string;
  createdAt: number;
  tarBase64: string;
};

const DB_NAME = 'boltly-sandbox-cache';
const STORE_NAME = 'dep-snapshots';
const DB_VERSION = 1;
const MAX_SNAPSHOTS = 3;

const reqToPromise = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

const openDb = async (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'depFingerprint' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const result = await run(tx.objectStore(STORE_NAME));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    return result;
  } finally {
    db.close();
  }
};

const trimOldSnapshots = async (): Promise<void> => {
  await withStore('readwrite', async (store) => {
    const all = (await reqToPromise(store.getAll())) as DependencySnapshotRecord[];
    if (all.length <= MAX_SNAPSHOTS) return;
    all.sort((a, b) => b.createdAt - a.createdAt);
    for (const entry of all.slice(MAX_SNAPSHOTS)) {
      await reqToPromise(store.delete(entry.depFingerprint));
    }
  });
};

export const loadDependencySnapshot = async (
  depFingerprint: string,
): Promise<DependencySnapshotRecord | null> => {
  try {
    return await withStore('readonly', async (store) => {
      const record = (await reqToPromise(store.get(depFingerprint))) as
        | DependencySnapshotRecord
        | undefined;
      return record ?? null;
    });
  } catch {
    return null;
  }
};

export const saveDependencySnapshot = async (record: DependencySnapshotRecord): Promise<void> => {
  try {
    await withStore('readwrite', async (store) => {
      await reqToPromise(store.put(record));
    });
    await trimOldSnapshots();
  } catch {
    // best-effort cache
  }
};

