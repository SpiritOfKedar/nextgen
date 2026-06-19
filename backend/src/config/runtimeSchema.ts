import type { Pool } from 'pg';
import { log } from '../lib/logger';

let applied = false;

/**
 * Runs lightweight DDL once at boot. Previously this ran on the chat hot path
 * (first insert / first plan read) and could hit statement_timeout
 * while holding locks — especially under concurrent requests.
 */
export const ensureRuntimeSchema = async (pool: Pool): Promise<void> => {
    if (applied) return;

    await pool.query(`
        ALTER TABLE public.threads
        ADD COLUMN IF NOT EXISTS last_mode TEXT NULL
    `);
    await pool.query(`
        ALTER TABLE public.threads
        ADD COLUMN IF NOT EXISTS plan_context_updated_at TIMESTAMPTZ NULL
    `);

    await pool.query(`
        ALTER TABLE public.messages
        ADD COLUMN IF NOT EXISTS conversation_mode TEXT NULL
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_messages_thread_mode_seq
        ON public.messages(thread_id, conversation_mode, seq)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_messages_thread_status_seq
        ON public.messages(thread_id, status, seq DESC)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_messages_thread_seq
        ON public.messages(thread_id, seq)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.thread_plan_contexts (
            thread_id UUID PRIMARY KEY REFERENCES public.threads(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
            plan_context TEXT NOT NULL,
            source_message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_thread_plan_contexts_user_updated
            ON public.thread_plan_contexts(user_id, updated_at DESC)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.user_figma_connections (
            user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
            access_token TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.user_stitch_connections (
            user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
            api_key TEXT NOT NULL,
            default_project_id TEXT NULL,
            enabled BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.user_supabase_connections (
            user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
            project_url TEXT NOT NULL,
            anon_key TEXT NOT NULL,
            service_role_key TEXT NULL,
            database_url TEXT NULL,
            mcp_access_token TEXT NULL,
            project_ref TEXT NULL,
            schema_snapshot JSONB NULL,
            enabled BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE public.user_supabase_connections
        ADD COLUMN IF NOT EXISTS mcp_access_token TEXT NULL
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.user_supabase_migrations (
            user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
            migration_id TEXT NOT NULL,
            sql_hash TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, migration_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.user_github_connections (
            user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
            access_token TEXT NOT NULL,
            github_login TEXT NULL,
            enabled BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.thread_github_links (
            thread_id UUID PRIMARY KEY REFERENCES public.threads(id) ON DELETE CASCADE,
            owner TEXT NOT NULL,
            repo TEXT NOT NULL,
            default_branch TEXT NOT NULL DEFAULT 'main',
            last_pushed_sha TEXT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.thread_collaborators (
            thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'editor',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (thread_id, user_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.sandbox_snapshots (
            fingerprint TEXT PRIMARY KEY,
            payload BYTEA NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE public.sandbox_snapshots
        ADD COLUMN IF NOT EXISTS storage_path TEXT NULL
    `);
    await pool.query(`
        ALTER TABLE public.sandbox_snapshots
        ADD COLUMN IF NOT EXISTS byte_size BIGINT NULL
    `);
    await pool.query(`
        ALTER TABLE public.sandbox_snapshots
        ALTER COLUMN payload DROP NOT NULL
    `);
    await pool.query(`
        ALTER TABLE public.code_blobs
        ADD COLUMN IF NOT EXISTS storage_path TEXT NULL
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_file_versions_thread_path_version
        ON public.file_versions(thread_id, file_path, version DESC)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_file_versions_thread_message
        ON public.file_versions(thread_id, message_id)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_users_clerk_id
        ON public.users(clerk_id)
    `);

    applied = true;
    log.info('db.runtime_schema_ready');
};
