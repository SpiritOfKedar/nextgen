import { createHash } from 'crypto';
import { redisGet, redisSet } from './redis';

const DEFAULT_TTL_SECONDS = 15 * 60;

const hashKey = (parts: string[]): string =>
    createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex');

export const getCachedJson = async <T>(namespace: string, keyParts: string[]): Promise<T | null> => {
    const raw = await redisGet(`${namespace}:${hashKey(keyParts)}`);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
};

export const setCachedJson = async (
    namespace: string,
    keyParts: string[],
    value: unknown,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> => {
    await redisSet(`${namespace}:${hashKey(keyParts)}`, JSON.stringify(value), ttlSeconds);
};
