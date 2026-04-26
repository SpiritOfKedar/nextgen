import { getPool } from '../config/db';

export type TerminalEventType = 'input' | 'output' | 'status' | 'command';

export interface TerminalEventInput {
  threadId: string;
  userId: string;
  eventType: TerminalEventType;
  payload: string;
  cwd?: string | null;
  exitCode?: number | null;
  createdAt?: string;
}

export interface RecoveryAttemptInput {
  threadId: string;
  userId: string;
  triggerSource: 'manual' | 'auto';
  issueCode: string;
  plannedCommands: string[];
  executedCommands: string[];
  status: 'resolved' | 'failed';
  detail?: string;
}

let tablesEnsured = false;

const ensureTables = async (): Promise<void> => {
  if (tablesEnsured) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.terminal_events (
      id BIGSERIAL PRIMARY KEY,
      thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      cwd TEXT NULL,
      exit_code INT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_terminal_events_thread_created
      ON public.terminal_events(thread_id, created_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.terminal_recovery_audits (
      id BIGSERIAL PRIMARY KEY,
      thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      trigger_source TEXT NOT NULL,
      issue_code TEXT NOT NULL,
      planned_commands JSONB NOT NULL,
      executed_commands JSONB NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_terminal_recovery_thread_created
      ON public.terminal_recovery_audits(thread_id, created_at DESC);
  `);
  tablesEnsured = true;
};

export const insertTerminalEvents = async (events: TerminalEventInput[]): Promise<void> => {
  if (events.length === 0) return;
  await ensureTables();
  const pool = getPool();
  const values: string[] = [];
  const params: unknown[] = [];
  events.forEach((e, i) => {
    const offset = i * 7;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, COALESCE($${offset + 7}::timestamptz, NOW()))`);
    params.push(e.threadId, e.userId, e.eventType, e.payload, e.cwd ?? null, e.exitCode ?? null, e.createdAt ?? null);
  });
  await pool.query(
    `INSERT INTO public.terminal_events (thread_id, user_id, event_type, payload, cwd, exit_code, created_at)
     VALUES ${values.join(', ')}`,
    params,
  );
};

export const listTerminalEventsForThread = async (threadId: string, userId: string, limit = 500) => {
  await ensureTables();
  const pool = getPool();
  const result = await pool.query(
    `SELECT event_type, payload, cwd, exit_code, created_at
     FROM public.terminal_events
     WHERE thread_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [threadId, userId, limit],
  );
  return result.rows.reverse();
};

export const insertRecoveryAudit = async (input: RecoveryAttemptInput): Promise<void> => {
  await ensureTables();
  const pool = getPool();
  await pool.query(
    `INSERT INTO public.terminal_recovery_audits
      (thread_id, user_id, trigger_source, issue_code, planned_commands, executed_commands, status, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    [
      input.threadId,
      input.userId,
      input.triggerSource,
      input.issueCode,
      JSON.stringify(input.plannedCommands),
      JSON.stringify(input.executedCommands),
      input.status,
      input.detail ?? null,
    ],
  );
};

export const listRecoveryAuditsForThread = async (threadId: string, userId: string, limit = 50) => {
  await ensureTables();
  const pool = getPool();
  const result = await pool.query(
    `SELECT trigger_source, issue_code, planned_commands, executed_commands, status, detail, created_at
     FROM public.terminal_recovery_audits
     WHERE thread_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [threadId, userId, limit],
  );
  return result.rows;
};

