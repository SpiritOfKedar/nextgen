type RecoveryFn = () => void;

/** Hard ceiling on automatic LLM recoveries per thread per session. */
export const MAX_AUTO_RECOVERIES_PER_THREAD = 2;

const BASE_BACKOFF_MS = 1_200;
const MAX_BACKOFF_MS = 20_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Issue keys (threadId:issueCode) that have already been auto-attempted once. */
const attempted = new Set<string>();
/** Total auto recoveries fired per thread, used to enforce the global ceiling. */
const attemptCountByThread = new Map<string, number>();

export type ScheduleOutcome = 'scheduled' | 'already_attempted' | 'ceiling_reached' | 'pending';

/**
 * Schedules a single automatic recovery for an issue with exponential backoff. Refuses to
 * schedule when the same issue was already attempted, when another attempt is pending, or
 * when the per-thread ceiling is reached — preventing the dead-loop that wastes compute.
 */
export function scheduleAutoTerminalRecovery(
    threadId: string,
    issueCode: string,
    run: RecoveryFn,
): ScheduleOutcome {
    const key = `${threadId}:${issueCode}`;
    if (attempted.has(key)) return 'already_attempted';
    if (timers.has(key)) return 'pending';

    const priorAttempts = attemptCountByThread.get(threadId) ?? 0;
    if (priorAttempts >= MAX_AUTO_RECOVERIES_PER_THREAD) return 'ceiling_reached';

    const delayMs = Math.min(BASE_BACKOFF_MS * 2 ** priorAttempts, MAX_BACKOFF_MS);
    timers.set(key, setTimeout(() => {
        timers.delete(key);
        attempted.add(key);
        attemptCountByThread.set(threadId, (attemptCountByThread.get(threadId) ?? 0) + 1);
        run();
    }, delayMs));
    return 'scheduled';
}

/** True once a thread has exhausted its automatic recovery budget. */
export function hasReachedRecoveryCeiling(threadId: string): boolean {
    return (attemptCountByThread.get(threadId) ?? 0) >= MAX_AUTO_RECOVERIES_PER_THREAD;
}

export function clearAutoRecoverySchedule(threadId: string): void {
    for (const [key, timer] of timers) {
        if (key.startsWith(`${threadId}:`)) {
            clearTimeout(timer);
            timers.delete(key);
        }
    }
}

/** Full reset for a thread — call when the user manually rebuilds / re-runs. */
export function resetAutoRecoveryAttempts(threadId: string): void {
    clearAutoRecoverySchedule(threadId);
    attemptCountByThread.delete(threadId);
    for (const key of attempted) {
        if (key.startsWith(`${threadId}:`)) attempted.delete(key);
    }
}
