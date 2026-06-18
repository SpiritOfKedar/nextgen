import { Request, Response } from 'express';
import { getPool } from '../config/db';
import { log, errorFields } from '../lib/logger';
import {
    parseProjectRef,
    validateDatabaseUrl,
    applyMigration,
    listAppliedMigrationIds,
    type MigrationResult,
} from '../services/supabaseMigrationService';
import { fetchSchemaSnapshot, type SchemaSnapshot } from '../services/supabaseSchemaService';

interface SupabaseConnectionRow {
    project_url: string;
    anon_key: string;
    service_role_key: string | null;
    database_url: string | null;
    project_ref: string | null;
    schema_snapshot: SchemaSnapshot | null;
    enabled: boolean;
}

const loadUserConnection = async (userId: string): Promise<SupabaseConnectionRow | null> => {
    const { rows } = await getPool().query(
        `SELECT project_url, anon_key, service_role_key, database_url, project_ref, schema_snapshot, enabled
         FROM public.user_supabase_connections WHERE user_id = $1`,
        [userId],
    );
    return rows[0] ?? null;
};

const normalizeProjectUrl = (raw: string): string => raw.trim().replace(/\/+$/, '');

/** Probe PostgREST with the anon key. 200 means reachable + valid key. */
const validateAnonKey = async (projectUrl: string, anonKey: string): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
        const res = await fetch(`${projectUrl}/rest/v1/`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
            signal: controller.signal,
        });
        if (res.status === 401 || res.status === 403) {
            throw new Error('Supabase rejected the anon key (unauthorized).');
        }
        if (!res.ok && res.status >= 500) {
            throw new Error(`Supabase project returned ${res.status}.`);
        }
    } finally {
        clearTimeout(timer);
    }
};

export const supabaseController = {
    async getStatus(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            if (!userId) return res.json({ connected: false });

            const conn = await loadUserConnection(userId);
            if (!conn || !conn.enabled) return res.json({ connected: false });

            return res.json({
                connected: true,
                projectUrl: conn.project_url,
                projectRef: conn.project_ref,
                migrationsEnabled: Boolean(conn.database_url),
                hasServiceRole: Boolean(conn.service_role_key),
                tableCount: conn.schema_snapshot?.tables?.length ?? 0,
            });
        } catch (error) {
            log.error('supabase.status_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.json({ connected: false });
        }
    },

    async connect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            const projectUrlRaw = typeof req.body?.projectUrl === 'string' ? req.body.projectUrl : '';
            const anonKey = typeof req.body?.anonKey === 'string' ? req.body.anonKey.trim() : '';
            const serviceRoleKey = typeof req.body?.serviceRoleKey === 'string' ? req.body.serviceRoleKey.trim() : '';
            const databaseUrl = typeof req.body?.databaseUrl === 'string' ? req.body.databaseUrl.trim() : '';

            if (!projectUrlRaw.trim() || !anonKey) {
                return res.status(400).json({ error: 'A project URL and anon key are required.' });
            }

            const projectUrl = normalizeProjectUrl(projectUrlRaw);
            const projectRef = parseProjectRef(projectUrl);
            if (!projectRef) {
                return res.status(400).json({ error: 'Project URL must look like https://<ref>.supabase.co' });
            }

            try {
                await validateAnonKey(projectUrl, anonKey);
            } catch (error) {
                return res.status(400).json({
                    error: 'Failed to validate the Supabase project with the provided anon key.',
                    detail: error instanceof Error ? error.message : String(error),
                });
            }

            let schemaSnapshot: SchemaSnapshot | null = null;
            if (databaseUrl) {
                try {
                    await validateDatabaseUrl(databaseUrl);
                } catch (error) {
                    return res.status(400).json({
                        error: 'Failed to connect to the database URL. Check the connection string (use the Session pooler URI).',
                        detail: error instanceof Error ? error.message : String(error),
                    });
                }
                schemaSnapshot = await fetchSchemaSnapshot(databaseUrl, req.requestId);
            }

            await getPool().query(
                `INSERT INTO public.user_supabase_connections
                   (user_id, project_url, anon_key, service_role_key, database_url, project_ref, schema_snapshot, enabled, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
                 ON CONFLICT (user_id) DO UPDATE SET
                   project_url = EXCLUDED.project_url,
                   anon_key = EXCLUDED.anon_key,
                   service_role_key = EXCLUDED.service_role_key,
                   database_url = EXCLUDED.database_url,
                   project_ref = EXCLUDED.project_ref,
                   schema_snapshot = EXCLUDED.schema_snapshot,
                   enabled = true,
                   updated_at = NOW()`,
                [
                    req.user.id,
                    projectUrl,
                    anonKey,
                    serviceRoleKey || null,
                    databaseUrl || null,
                    projectRef,
                    schemaSnapshot ? JSON.stringify(schemaSnapshot) : null,
                ],
            );

            log.info('supabase.connected', {
                requestId: req.requestId,
                internalUserId: req.user.id,
                projectRef,
                migrationsEnabled: Boolean(databaseUrl),
            });

            return res.json({
                connected: true,
                projectUrl,
                projectRef,
                migrationsEnabled: Boolean(databaseUrl),
                hasServiceRole: Boolean(serviceRoleKey),
                tableCount: schemaSnapshot?.tables?.length ?? 0,
            });
        } catch (error) {
            log.error('supabase.connect_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to connect Supabase project' });
        }
    },

    async disconnect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            await getPool().query(
                `DELETE FROM public.user_supabase_connections WHERE user_id = $1`,
                [req.user.id],
            );
            return res.json({ connected: false });
        } catch (error) {
            log.error('supabase.disconnect_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to disconnect Supabase project' });
        }
    },

    /** Returns ONLY the browser-safe client env (project URL + anon key). */
    async getEnv(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const conn = await loadUserConnection(req.user.id);
            if (!conn || !conn.enabled) return res.json({ connected: false });
            return res.json({
                connected: true,
                url: conn.project_url,
                anonKey: conn.anon_key,
            });
        } catch (error) {
            log.error('supabase.get_env_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to load Supabase env' });
        }
    },

    async getSchema(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const conn = await loadUserConnection(req.user.id);
            if (!conn || !conn.enabled) return res.json({ connected: false });
            const appliedMigrations = await listAppliedMigrationIds(req.user.id);
            return res.json({
                connected: true,
                schema: conn.schema_snapshot,
                appliedMigrations,
            });
        } catch (error) {
            log.error('supabase.get_schema_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to load Supabase schema' });
        }
    },

    async applyMigrations(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            const rawMigrations = Array.isArray(req.body?.migrations) ? req.body.migrations : [];
            const allowDestructive = req.body?.allowDestructive === true;

            const migrations = rawMigrations
                .map((m: unknown) => {
                    const obj = (m ?? {}) as Record<string, unknown>;
                    return {
                        migrationId: typeof obj.migrationId === 'string' ? obj.migrationId : '',
                        sql: typeof obj.sql === 'string' ? obj.sql : '',
                    };
                })
                .filter((m: { migrationId: string; sql: string }) => m.migrationId && m.sql);

            if (migrations.length === 0) {
                return res.status(400).json({ error: 'No migrations provided.' });
            }

            const conn = await loadUserConnection(req.user.id);
            if (!conn || !conn.enabled) {
                return res.status(400).json({ error: 'No Supabase project connected.' });
            }
            if (!conn.database_url) {
                return res.status(400).json({
                    error: 'Database URL is required to apply migrations. Add it in the Supabase connect panel.',
                });
            }

            const results: MigrationResult[] = [];
            for (const migration of migrations) {
                const result = await applyMigration(
                    req.user.id,
                    conn.database_url,
                    migration,
                    { allowDestructive, requestId: req.requestId },
                );
                results.push(result);
                if (result.status === 'failed') break;
            }

            const applied = results.some((r) => r.status === 'applied');
            if (applied) {
                const schemaSnapshot = await fetchSchemaSnapshot(conn.database_url, req.requestId);
                if (schemaSnapshot) {
                    await getPool().query(
                        `UPDATE public.user_supabase_connections SET schema_snapshot = $2, updated_at = NOW() WHERE user_id = $1`,
                        [req.user.id, JSON.stringify(schemaSnapshot)],
                    );
                }
            }

            return res.json({ results });
        } catch (error) {
            log.error('supabase.apply_migrations_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to apply migrations' });
        }
    },
};

/** Prompt-context helper for chatService — never exposes keys. */
export interface SupabasePromptContext {
    projectUrl: string;
    projectRef: string | null;
    migrationsEnabled: boolean;
    schema: SchemaSnapshot | null;
    appliedMigrations: string[];
}

export const getUserSupabaseContext = async (userId: string): Promise<SupabasePromptContext | null> => {
    const conn = await loadUserConnection(userId);
    if (!conn || !conn.enabled) return null;
    const appliedMigrations = await listAppliedMigrationIds(userId);
    return {
        projectUrl: conn.project_url,
        projectRef: conn.project_ref,
        migrationsEnabled: Boolean(conn.database_url),
        schema: conn.schema_snapshot,
        appliedMigrations,
    };
};
