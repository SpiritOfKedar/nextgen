/**
 * Structured application logging.
 *
 * Env:
 * - LOG_LEVEL: debug | info | warn | error (default: info)
 * - LOG_FORMAT: text | json (default: text)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const parseLevel = (raw: string | undefined): LogLevel => {
    const v = (raw || 'info').toLowerCase();
    if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
    return 'info';
};

const activeLevel = (): LogLevel => parseLevel(process.env.LOG_LEVEL);

const shouldLog = (level: LogLevel): boolean =>
    LEVEL_RANK[level] >= LEVEL_RANK[activeLevel()];

const isJson = (): boolean => (process.env.LOG_FORMAT || 'text').toLowerCase() === 'json';

/** Normalize unknown throwables for structured logs (never log raw API keys). */
export const errorFields = (error: unknown): Record<string, string | undefined> => {
    if (error instanceof Error) {
        return {
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack,
        };
    }
    return { errorMessage: String(error) };
};

const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (!shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const base = { timestamp, level, message, ...fields };

    if (isJson()) {
        const line = JSON.stringify(base);
        if (level === 'error') console.error(line);
        else if (level === 'warn') console.warn(line);
        else console.log(line);
        return;
    }

    const parts = Object.entries(fields || {})
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => {
            if (typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
            return `${k}=${String(v)}`;
        });
    const suffix = parts.length ? ` | ${parts.join(' ')}` : '';
    const line = `[${timestamp}] ${level.toUpperCase()} ${message}${suffix}`;

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
};

export const log = {
    debug(message: string, fields?: Record<string, unknown>) {
        emit('debug', message, fields);
    },
    info(message: string, fields?: Record<string, unknown>) {
        emit('info', message, fields);
    },
    warn(message: string, fields?: Record<string, unknown>) {
        emit('warn', message, fields);
    },
    error(message: string, fields?: Record<string, unknown>) {
        emit('error', message, fields);
    },
};
