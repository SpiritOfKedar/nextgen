import { Request, Response } from 'express';
import { getPool } from '../config/db';
import { log, errorFields } from '../lib/logger';
import { createConnectionCache, loadCachedConnection } from '../lib/integrationConnectionCache';
import {
    parseProjectRef,
    validateDatabaseUrl,
    applyMigration,
    listAppliedMigrationIds,
    type MigrationResult,
} from '../services/supabaseMigrationService';
import { fetchSchemaSnapshot, type SchemaSnapshot } from '../services/supabaseSchemaService';
import { supabaseMcpClient } from '../services/supabaseMcpClient';
import { supabaseMcpContextService, type SupabaseContextInput } from '../services/supabaseMcpContextService';
import {
    clearOAuthSession,
    consumeOAuthState,
    createOAuthState,
    ensureFreshConnectionAccessToken,
    exchangeAuthorizationCode,
    getFrontendOAuthRedirectUrl,
    getProjectApiKeys,
    getValidOAuthAccessToken,
    isSupabaseOAuthConfigured,
    listProjects,
    loadOAuthSession,
    storeOAuthSession,
} from '../services/supabaseOAuthService';

interface SupabaseConnectionRow {
    project_url: string;
    anon_key: string;
    service_role_key: string | null;
    database_url: string | null;
    mcp_access_token: string | null;
    project_ref: string | null;
    schema_snapshot: SchemaSnapshot | null;
    enabled: boolean;
    oauth_refresh_token: string | null;
    oauth_expires_at: Date | null;
    connection_source: string;
}

const supabaseConnectionCache = createConnectionCache<SupabaseConnectionRow>();

const CONNECTION_SELECT = `SELECT project_url, anon_key, service_role_key, database_url, mcp_access_token,
    project_ref, schema_snapshot, enabled, oauth_refresh_token, oauth_expires_at, connection_source
    FROM public.user_supabase_connections WHERE user_id = $1`;

const loadUserConnection = async (userId: string): Promise<SupabaseConnectionRow | null> =>
    loadCachedConnection(supabaseConnectionCache, userId, async () => {
        const { rows } = await getPool().query<SupabaseConnectionRow>(CONNECTION_SELECT, [userId]);
        return rows[0] ?? null;
    });

const invalidateSupabaseConnectionCache = (userId: string): void => {
    supabaseConnectionCache.invalidate(userId);
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

const buildStatusPayload = (conn: SupabaseConnectionRow) => {
    const migrationsEnabled = Boolean(conn.database_url);
    const oauthConnected = conn.connection_source === 'oauth' && Boolean(conn.oauth_refresh_token);
    return {
        connected: true,
        connectionMode: migrationsEnabled ? 'database' as const : 'client' as const,
        projectUrl: conn.project_url,
        projectRef: conn.project_ref,
        migrationsEnabled,
        hasServiceRole: Boolean(conn.service_role_key),
        mcpConnected: Boolean(conn.mcp_access_token),
        oauthConnected,
        connectionSource: conn.connection_source === 'oauth' ? 'oauth' as const : 'manual' as const,
        oauthConfigured: isSupabaseOAuthConfigured(),
        tableCount: conn.schema_snapshot?.tables?.length ?? 0,
    };
};

export const supabaseController = {
    async getStatus(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            if (!userId) return res.json({ connected: false, oauthConfigured: isSupabaseOAuthConfigured() });

            const conn = await loadUserConnection(userId);
            if (!conn || !conn.enabled) {
                return res.json({
                    connected: false,
                    connectionMode: 'none',
                    oauthConfigured: isSupabaseOAuthConfigured(),
                    oauthPending: Boolean(await loadOAuthSession(userId)),
                });
            }

            return res.json(buildStatusPayload(conn));
        } catch (error) {
            log.error('supabase.status_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.json({ connected: false, oauthConfigured: isSupabaseOAuthConfigured() });
        }
    },

    async startOAuth(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            if (!isSupabaseOAuthConfigured()) {
                return res.status(503).json({
                    error: 'Supabase OAuth is not configured on the server.',
                    detail: 'Set SUPABASE_OAUTH_CLIENT_ID, SUPABASE_OAUTH_CLIENT_SECRET, and SUPABASE_OAUTH_REDIRECT_URI.',
                });
            }

            const { authorizeUrl } = await createOAuthState(req.user.id);
            return res.json({ authorizeUrl });
        } catch (error) {
            log.error('supabase.oauth_start_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to start Supabase OAuth flow' });
        }
    },

    async oauthCallback(req: Request, res: Response) {
        try {
            const errorParam = typeof req.query.error === 'string' ? req.query.error : '';
            if (errorParam) {
                const description = typeof req.query.error_description === 'string'
                    ? req.query.error_description
                    : errorParam;
                return res.redirect(getFrontendOAuthRedirectUrl({
                    supabase_oauth: 'error',
                    supabase_oauth_detail: description.slice(0, 200),
                }));
            }

            const code = typeof req.query.code === 'string' ? req.query.code : '';
            const state = typeof req.query.state === 'string' ? req.query.state : '';
            if (!code || !state) {
                return res.redirect(getFrontendOAuthRedirectUrl({
                    supabase_oauth: 'error',
                    supabase_oauth_detail: 'Missing authorization code or state.',
                }));
            }

            const consumed = await consumeOAuthState(state);
            if (!consumed) {
                return res.redirect(getFrontendOAuthRedirectUrl({
                    supabase_oauth: 'error',
                    supabase_oauth_detail: 'Invalid or expired OAuth state. Please try again.',
                }));
            }

            const tokens = await exchangeAuthorizationCode(code, consumed.codeVerifier);
            await storeOAuthSession(consumed.userId, tokens);

            log.info('supabase.oauth_callback_success', {
                requestId: req.requestId,
                internalUserId: consumed.userId,
            });

            return res.redirect(getFrontendOAuthRedirectUrl({ supabase_oauth: 'success' }));
        } catch (error) {
            log.error('supabase.oauth_callback_failed', { requestId: req.requestId, ...errorFields(error) });
            const detail = error instanceof Error ? error.message : 'OAuth callback failed';
            return res.redirect(getFrontendOAuthRedirectUrl({
                supabase_oauth: 'error',
                supabase_oauth_detail: detail.slice(0, 200),
            }));
        }
    },

    async listOAuthProjects(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            const accessToken = await getValidOAuthAccessToken(req.user.id);
            if (!accessToken) {
                return res.status(400).json({
                    error: 'No active Supabase OAuth session. Click Connect with Supabase to authorize.',
                });
            }

            const projects = await listProjects(accessToken);
            return res.json({ projects });
        } catch (error) {
            log.error('supabase.oauth_projects_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({
                error: 'Failed to list Supabase projects',
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    },

    async completeOAuth(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            const projectRef = typeof req.body?.projectRef === 'string' ? req.body.projectRef.trim() : '';
            if (!projectRef) {
                return res.status(400).json({ error: 'projectRef is required.' });
            }

            const accessToken = await getValidOAuthAccessToken(req.user.id);
            if (!accessToken) {
                return res.status(400).json({
                    error: 'No active Supabase OAuth session. Click Connect with Supabase to authorize.',
                });
            }

            const { anonKey, projectUrl } = await getProjectApiKeys(accessToken, projectRef);

            try {
                await validateAnonKey(projectUrl, anonKey);
            } catch (error) {
                return res.status(400).json({
                    error: 'Failed to validate the Supabase project with the fetched API key.',
                    detail: error instanceof Error ? error.message : String(error),
                });
            }

            try {
                await supabaseMcpClient.validateAccessToken(accessToken, projectRef);
            } catch (error) {
                return res.status(400).json({
                    error: 'OAuth token could not access Supabase MCP for this project.',
                    detail: error instanceof Error ? error.message : String(error),
                });
            }

            const existing = await loadUserConnection(req.user.id);
            const session = await loadOAuthSession(req.user.id);
            if (!session) {
                return res.status(400).json({ error: 'OAuth session expired. Please reconnect.' });
            }

            let schemaSnapshot: SchemaSnapshot | null = existing?.schema_snapshot ?? null;
            const databaseUrl = existing?.database_url ?? null;
            if (databaseUrl) {
                try {
                    schemaSnapshot = await fetchSchemaSnapshot(databaseUrl, req.requestId);
                } catch {
                    // keep prior snapshot if refresh fails
                }
            }

            await getPool().query(
                `INSERT INTO public.user_supabase_connections
                   (user_id, project_url, anon_key, service_role_key, database_url, mcp_access_token,
                    project_ref, schema_snapshot, enabled, oauth_refresh_token, oauth_expires_at,
                    connection_source, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, 'oauth', NOW(), NOW())
                 ON CONFLICT (user_id) DO UPDATE SET
                   project_url = EXCLUDED.project_url,
                   anon_key = EXCLUDED.anon_key,
                   service_role_key = COALESCE(public.user_supabase_connections.service_role_key, EXCLUDED.service_role_key),
                   database_url = COALESCE(public.user_supabase_connections.database_url, EXCLUDED.database_url),
                   mcp_access_token = EXCLUDED.mcp_access_token,
                   project_ref = EXCLUDED.project_ref,
                   schema_snapshot = COALESCE(EXCLUDED.schema_snapshot, public.user_supabase_connections.schema_snapshot),
                   oauth_refresh_token = EXCLUDED.oauth_refresh_token,
                   oauth_expires_at = EXCLUDED.oauth_expires_at,
                   connection_source = 'oauth',
                   enabled = true,
                   updated_at = NOW()`,
                [
                    req.user.id,
                    projectUrl,
                    anonKey,
                    existing?.service_role_key ?? null,
                    databaseUrl,
                    session.accessToken,
                    projectRef,
                    schemaSnapshot ? JSON.stringify(schemaSnapshot) : null,
                    session.refreshToken,
                    session.expiresAt.toISOString(),
                ],
            );

            invalidateSupabaseConnectionCache(req.user.id);

            log.info('supabase.oauth_complete', {
                requestId: req.requestId,
                internalUserId: req.user.id,
                projectRef,
                migrationsEnabled: Boolean(databaseUrl),
            });

            const conn = await loadUserConnection(req.user.id);
            if (!conn) return res.status(500).json({ error: 'Failed to load connection after OAuth complete' });

            return res.json(buildStatusPayload(conn));
        } catch (error) {
            log.error('supabase.oauth_complete_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({
                error: 'Failed to complete Supabase OAuth connection',
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    },

    async connect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            const projectUrlRaw = typeof req.body?.projectUrl === 'string' ? req.body.projectUrl : '';
            const anonKey = typeof req.body?.anonKey === 'string' ? req.body.anonKey.trim() : '';
            const serviceRoleKey = typeof req.body?.serviceRoleKey === 'string' ? req.body.serviceRoleKey.trim() : '';
            const databaseUrl = typeof req.body?.databaseUrl === 'string' ? req.body.databaseUrl.trim() : '';
            const mcpAccessToken = typeof req.body?.mcpAccessToken === 'string' ? req.body.mcpAccessToken.trim() : '';

            const existing = await loadUserConnection(req.user.id);
            const resolvedProjectUrl = projectUrlRaw.trim()
                ? normalizeProjectUrl(projectUrlRaw)
                : (existing?.project_url ?? '');
            const resolvedAnonKey = anonKey || existing?.anon_key || '';

            if (!resolvedProjectUrl || !resolvedAnonKey) {
                return res.status(400).json({ error: 'A project URL and anon key are required.' });
            }

            const projectUrl = resolvedProjectUrl;
            const projectRef = parseProjectRef(projectUrl);
            if (!projectRef) {
                return res.status(400).json({ error: 'Project URL must look like https://<ref>.supabase.co' });
            }

            try {
                await validateAnonKey(projectUrl, resolvedAnonKey);
            } catch (error) {
                return res.status(400).json({
                    error: 'Failed to validate the Supabase project with the provided anon key.',
                    detail: error instanceof Error ? error.message : String(error),
                });
            }

            const resolvedDatabaseUrl = databaseUrl || existing?.database_url || null;
            const resolvedServiceRoleKey = serviceRoleKey || existing?.service_role_key || null;
            const resolvedMcpToken = mcpAccessToken || existing?.mcp_access_token || null;

            let schemaSnapshot: SchemaSnapshot | null = existing?.schema_snapshot ?? null;
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

            if (mcpAccessToken) {
                try {
                    await supabaseMcpClient.validateAccessToken(mcpAccessToken, projectRef);
                } catch (error) {
                    return res.status(400).json({
                        error: 'Failed to validate the Supabase MCP access token for this project.',
                        detail: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            await getPool().query(
                `INSERT INTO public.user_supabase_connections
                   (user_id, project_url, anon_key, service_role_key, database_url, mcp_access_token, project_ref,
                    schema_snapshot, enabled, oauth_refresh_token, oauth_expires_at, connection_source,
                    created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NULL, NULL, 'manual', NOW(), NOW())
                 ON CONFLICT (user_id) DO UPDATE SET
                   project_url = EXCLUDED.project_url,
                   anon_key = EXCLUDED.anon_key,
                   service_role_key = COALESCE(EXCLUDED.service_role_key, public.user_supabase_connections.service_role_key),
                   database_url = COALESCE(EXCLUDED.database_url, public.user_supabase_connections.database_url),
                   mcp_access_token = COALESCE(EXCLUDED.mcp_access_token, public.user_supabase_connections.mcp_access_token),
                   project_ref = EXCLUDED.project_ref,
                   schema_snapshot = COALESCE(EXCLUDED.schema_snapshot, public.user_supabase_connections.schema_snapshot),
                   oauth_refresh_token = NULL,
                   oauth_expires_at = NULL,
                   connection_source = 'manual',
                   enabled = true,
                   updated_at = NOW()`,
                [
                    req.user.id,
                    projectUrl,
                    resolvedAnonKey,
                    resolvedServiceRoleKey,
                    resolvedDatabaseUrl,
                    resolvedMcpToken,
                    projectRef,
                    schemaSnapshot ? JSON.stringify(schemaSnapshot) : null,
                ],
            );

            invalidateSupabaseConnectionCache(req.user.id);

            log.info('supabase.connected', {
                requestId: req.requestId,
                internalUserId: req.user.id,
                projectRef,
                migrationsEnabled: Boolean(resolvedDatabaseUrl),
                mcpConnected: Boolean(resolvedMcpToken),
                connectionSource: 'manual',
            });

            const conn = await loadUserConnection(req.user.id);
            if (!conn) return res.status(500).json({ error: 'Failed to load connection after connect' });

            return res.json(buildStatusPayload(conn));
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
            await clearOAuthSession(req.user.id);
            invalidateSupabaseConnectionCache(req.user.id);
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
                    invalidateSupabaseConnectionCache(req.user.id);
                }
            }

            return res.json({ results });
        } catch (error) {
            log.error('supabase.apply_migrations_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to apply migrations' });
        }
    },

    async inspect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            const fetchTables = req.body?.fetchTables !== false;
            const fetchAdvisors = req.body?.fetchAdvisors !== false;
            const docsQuery = typeof req.body?.docsQuery === 'string' ? req.body.docsQuery.trim() : undefined;

            const conn = await loadUserConnection(req.user.id);
            const mcpConfig = await getMcpConfigFromConnection(req.user.id, conn);
            if (!mcpConfig) {
                return res.status(400).json({
                    error: 'Supabase MCP is not configured. Connect a project and add a personal access token.',
                });
            }

            const context = await supabaseMcpContextService.inspect(
                { fetchTables, fetchAdvisors, docsQuery },
                { requestId: req.requestId, userId: req.user.id, mcpConfig },
            );

            return res.json({ context });
        } catch (error) {
            log.error('supabase.inspect_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to inspect Supabase MCP context' });
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
    const { context } = await getUserSupabaseIntegration(userId);
    return context;
};

const getMcpConfigFromConnection = async (userId: string, conn: SupabaseConnectionRow | null) => {
    if (!conn?.project_ref) return undefined;

    const accessToken = await ensureFreshConnectionAccessToken(userId, conn);
    if (!accessToken) return undefined;

    if (accessToken !== conn.mcp_access_token) {
        invalidateSupabaseConnectionCache(userId);
    }

    return {
        accessToken,
        projectRef: conn.project_ref,
        enabled: true,
        readOnly: true,
    };
};

export const getUserSupabaseMcpConfig = async (userId: string) => {
    const { mcpConfig } = await getUserSupabaseIntegration(userId);
    return mcpConfig;
};

export type SupabaseMcpConfig = NonNullable<Awaited<ReturnType<typeof getMcpConfigFromConnection>>>;

export interface SupabaseIntegration {
    context: SupabasePromptContext | null;
    mcpConfig: SupabaseMcpConfig | undefined;
}

/** Single load of the Supabase connection row + migrations for chat hot path. */
export const getUserSupabaseIntegration = async (userId: string): Promise<SupabaseIntegration> => {
    const conn = await loadUserConnection(userId);
    if (!conn || !conn.enabled) {
        return { context: null, mcpConfig: undefined };
    }
    const appliedMigrations = await listAppliedMigrationIds(userId);
    return {
        context: {
            projectUrl: conn.project_url,
            projectRef: conn.project_ref,
            migrationsEnabled: Boolean(conn.database_url),
            schema: conn.schema_snapshot,
            appliedMigrations,
        },
        mcpConfig: await getMcpConfigFromConnection(userId, conn),
    };
};

export type { SupabaseContextInput };
