import { LRUCache } from 'lru-cache';

const DEFAULT_TTL_MS = 45_000;

const parseTtlMs = (raw: string | undefined): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1_000) return DEFAULT_TTL_MS;
    return Math.min(Math.floor(parsed), 120_000);
};

const INTEGRATION_CONNECTION_CACHE_TTL_MS = parseTtlMs(process.env.INTEGRATION_CONNECTION_CACHE_TTL_MS);

export type ConnectionCache<T> = {
    getCached: (userId: string) => T | null | undefined;
    setCached: (userId: string, value: T | null) => void;
    invalidate: (userId: string) => void;
};

/** Short-lived in-process cache for integration connection rows (per user). */
export const createConnectionCache = <T>(): ConnectionCache<T> => {
    const cache = new LRUCache<string, { v: T | null }>({
        max: 10_000,
        ttl: INTEGRATION_CONNECTION_CACHE_TTL_MS,
    });

    return {
        getCached(userId: string): T | null | undefined {
            const entry = cache.get(userId);
            if (entry === undefined) return undefined;
            return entry.v;
        },
        setCached(userId: string, value: T | null): void {
            cache.set(userId, { v: value });
        },
        invalidate(userId: string): void {
            cache.delete(userId);
        },
    };
};

export const loadCachedConnection = async <T>(
    cache: ConnectionCache<T>,
    userId: string,
    loader: () => Promise<T | null>,
): Promise<T | null> => {
    const hit = cache.getCached(userId);
    if (hit !== undefined) return hit;
    const row = await loader();
    cache.setCached(userId, row);
    return row;
};
