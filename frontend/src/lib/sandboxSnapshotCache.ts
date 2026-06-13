export type DependencySnapshotRecord = {
  depFingerprint: string;
  toolchainVersion: string;
  createdAt: number;
  /** gzip-compressed archive bytes, base64-encoded */
  archiveBase64: string;
  archiveFormat: 'tar.gz' | 'zip';
  /** When true, archiveBase64 is raw (legacy records before gzip) */
  compressed?: boolean;
  /** Package names present when snapshot was created (for ancestor delta installs) */
  depNames?: string[];
  threadId?: string;
  packageJsonSnapshot?: string;
};

const DB_NAME = 'boltly-sandbox-cache';
const STORE_NAME = 'dep-snapshots';
const DB_VERSION = 2;
const MAX_SNAPSHOTS = 10;

const bytesToBase64 = (input: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < input.length; i += chunkSize) {
    const chunk = input.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const gzipBytes = async (input: Uint8Array): Promise<Uint8Array> => {
  if (typeof CompressionStream === 'undefined') return input;
  const stream = new Blob([Uint8Array.from(input)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const gunzipBytes = async (input: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'undefined') return input;
  const stream = new Blob([Uint8Array.from(input)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const decodeArchivePayload = async (record: DependencySnapshotRecord): Promise<Uint8Array> => {
  const raw = base64ToBytes(record.archiveBase64);
  if (record.compressed === false) return raw;
  try {
    return await gunzipBytes(raw);
  } catch {
    return raw;
  }
};

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
        store.createIndex('threadId', 'threadId', { unique: false });
      } else {
        const tx = req.transaction!;
        const store = tx.objectStore(STORE_NAME);
        if (!store.indexNames.contains('createdAt')) {
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!store.indexNames.contains('threadId')) {
          store.createIndex('threadId', 'threadId', { unique: false });
        }
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

const trimOldSnapshots = async (protectThreadId?: string): Promise<void> => {
  await withStore('readwrite', async (store) => {
    const all = (await reqToPromise(store.getAll())) as DependencySnapshotRecord[];
    if (all.length <= MAX_SNAPSHOTS) return;
    all.sort((a, b) => b.createdAt - a.createdAt);
    const protectedEntries = protectThreadId
      ? all.filter((e) => e.threadId === protectThreadId)
      : [];
    const toEvict = all.filter(
      (e) => !protectedEntries.some((p) => p.depFingerprint === e.depFingerprint),
    );
    const excess = all.length - MAX_SNAPSHOTS;
    for (const entry of toEvict.slice(-excess)) {
      await reqToPromise(store.delete(entry.depFingerprint));
    }
  });
};

export const listDependencySnapshots = async (): Promise<DependencySnapshotRecord[]> => {
  try {
    return await withStore('readonly', async (store) =>
      reqToPromise(store.getAll()) as Promise<DependencySnapshotRecord[]>,
    );
  } catch {
    return [];
  }
};

export const loadDependencySnapshot = async (
  depFingerprint: string,
): Promise<
  | { status: 'hit'; record: DependencySnapshotRecord; archiveBytes: Uint8Array }
  | { status: 'miss' }
  | { status: 'corrupt' }
> => {
  try {
    const result = await withStore('readonly', async (store) => {
      const record = (await reqToPromise(store.get(depFingerprint))) as
        | DependencySnapshotRecord
        | undefined;
      return record;
    });
    if (!result) return { status: 'miss' };
    if (!result.archiveBase64 || !result.archiveFormat) return { status: 'corrupt' };
    const archiveBytes = await decodeArchivePayload(result);
    return { status: 'hit', record: result, archiveBytes };
  } catch {
    return { status: 'corrupt' };
  }
};

export const saveDependencySnapshot = async (
  record: DependencySnapshotRecord,
  options?: { protectThreadId?: string },
): Promise<'ok' | 'quota_exceeded' | 'failed'> => {
  try {
    const rawBytes = base64ToBytes(record.archiveBase64);
    const compressed = await gzipBytes(rawBytes);
    const stored: DependencySnapshotRecord = {
      ...record,
      archiveBase64: bytesToBase64(compressed),
      compressed: compressed.length < rawBytes.length,
    };
    await withStore('readwrite', async (store) => {
      await reqToPromise(store.put(stored));
    });
    await trimOldSnapshots(options?.protectThreadId);
    return 'ok';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return 'quota_exceeded';
    }
    return 'failed';
  }
};
