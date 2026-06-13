import { Redis } from '@upstash/redis';
import { log } from './logger';

const stripEnv = (value: string | undefined): string =>
    (value || '').replace(/^["']|["']$/g, '').trim();

let client: Redis | null | undefined;
let loggedDisabled = false;

const getClient = (): Redis | null => {
    if (client !== undefined) return client;

    const url = stripEnv(process.env.UPSTASH_REDIS_REST_URL);
    const token = stripEnv(process.env.UPSTASH_REDIS_REST_TOKEN);

    if (!url || !token) {
        client = null;
        if (!loggedDisabled) {
            loggedDisabled = true;
            log.info('redis.disabled', { reason: 'UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN missing' });
        }
        return null;
    }

    client = new Redis({ url, token });
    log.info('redis.enabled', { url: url.replace(/\/\/.*@/, '//***@') });
    return client;
};

export const isRedisEnabled = (): boolean => getClient() !== null;

export const redisGet = async (key: string): Promise<string | null> => {
    const redis = getClient();
    if (!redis) return null;
    try {
        const value = await redis.get<string>(key);
        return value ?? null;
    } catch (error) {
        log.warn('redis.get_failed', { key, error: error instanceof Error ? error.message : String(error) });
        return null;
    }
};

export const redisSet = async (key: string, value: string, ttlSeconds?: number): Promise<void> => {
    const redis = getClient();
    if (!redis) return;
    try {
        if (ttlSeconds && ttlSeconds > 0) {
            await redis.set(key, value, { ex: ttlSeconds });
        } else {
            await redis.set(key, value);
        }
    } catch (error) {
        log.warn('redis.set_failed', { key, error: error instanceof Error ? error.message : String(error) });
    }
};

export const redisMGet = async (keys: string[]): Promise<(string | null)[]> => {
    const redis = getClient();
    if (!redis || keys.length === 0) return keys.map(() => null);
    try {
        const values = await redis.mget<(string | null)[]>(...keys);
        return values.map((v) => (typeof v === 'string' ? v : v === null ? null : JSON.stringify(v)));
    } catch (error) {
        log.warn('redis.mget_failed', { keyCount: keys.length, error: error instanceof Error ? error.message : String(error) });
        return keys.map(() => null);
    }
};

export const redisDel = async (...keys: string[]): Promise<void> => {
    const redis = getClient();
    if (!redis || keys.length === 0) return;
    try {
        await redis.del(...keys);
    } catch (error) {
        log.warn('redis.del_failed', { keyCount: keys.length, error: error instanceof Error ? error.message : String(error) });
    }
};
