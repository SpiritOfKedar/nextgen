import { createHash, randomBytes } from 'crypto';
import { getPool } from '../config/db';
import { log, errorFields } from '../lib/logger';

const SUPABASE_OAUTH_AUTHORIZE_URL = 'https://api.supabase.com/v1/oauth/authorize';
const SUPABASE_OAUTH_TOKEN_URL = 'https://api.supabase.com/v1/oauth/token';
const SUPABASE_MGMT_API = 'https://api.supabase.com/v1';
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

export interface SupabaseOAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

export interface SupabaseOAuthTokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}

export interface SupabaseProjectSummary {
    ref: string;
    name: string;
    id: string;
    region?: string;
}

export interface SupabaseProjectApiKeys {
    anonKey: string;
    projectUrl: string;
    projectRef: string;
}

interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

interface ManagementProject {
    id?: string;
    ref?: string;
    name?: string;
    region?: string;
}

interface ManagementApiKey {
    type?: string;
    api_key?: string;
    name?: string;
}

const getOAuthConfig = (): SupabaseOAuthConfig | null => {
    const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET?.trim();
    const redirectUri = process.env.SUPABASE_OAUTH_REDIRECT_URI?.trim();
    if (!clientId || !clientSecret || !redirectUri) return null;
    return { clientId, clientSecret, redirectUri };
};

export const isSupabaseOAuthConfigured = (): boolean => getOAuthConfig() !== null;

const generateCodeVerifier = (): string => randomBytes(32).toString('base64url');

const generateCodeChallenge = (verifier: string): string =>
    createHash('sha256').update(verifier).digest('base64url');

const basicAuthHeader = (clientId: string, clientSecret: string): string =>
    `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

const parseTokenResponse = (payload: TokenResponse): SupabaseOAuthTokens => {
    if (!payload.access_token || !payload.refresh_token) {
        throw new Error(payload.error_description || payload.error || 'Token response missing access or refresh token');
    }
    const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0
        ? payload.expires_in
        : 3600;
    return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
};

const postTokenRequest = async (body: URLSearchParams): Promise<SupabaseOAuthTokens> => {
    const config = getOAuthConfig();
    if (!config) throw new Error('Supabase OAuth is not configured on the server.');

    const response = await fetch(SUPABASE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            Authorization: basicAuthHeader(config.clientId, config.clientSecret),
        },
        body,
    });

    const payload = await response.json() as TokenResponse;
    if (!response.ok) {
        throw new Error(payload.error_description || payload.error || `Token request failed (${response.status})`);
    }
    return parseTokenResponse(payload);
};

export const createOAuthState = async (userId: string): Promise<{ state: string; authorizeUrl: string }> => {
    const config = getOAuthConfig();
    if (!config) throw new Error('Supabase OAuth is not configured. Set SUPABASE_OAUTH_CLIENT_ID, SUPABASE_OAUTH_CLIENT_SECRET, and SUPABASE_OAUTH_REDIRECT_URI.');

    const state = randomBytes(24).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    await getPool().query(
        `INSERT INTO public.supabase_oauth_states (state, user_id, code_verifier, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [state, userId, codeVerifier],
    );

    const url = new URL(SUPABASE_OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return { state, authorizeUrl: url.toString() };
};

export const consumeOAuthState = async (state: string): Promise<{ userId: string; codeVerifier: string } | null> => {
    const { rows } = await getPool().query<{ user_id: string; code_verifier: string; created_at: Date }>(
        `DELETE FROM public.supabase_oauth_states
         WHERE state = $1 AND created_at > NOW() - INTERVAL '10 minutes'
         RETURNING user_id, code_verifier, created_at`,
        [state],
    );
    const row = rows[0];
    if (!row) return null;
    return { userId: row.user_id, codeVerifier: row.code_verifier };
};

export const exchangeAuthorizationCode = async (code: string, codeVerifier: string): Promise<SupabaseOAuthTokens> => {
    const config = getOAuthConfig();
    if (!config) throw new Error('Supabase OAuth is not configured on the server.');

    return postTokenRequest(new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        code_verifier: codeVerifier,
    }));
};

export const refreshOAuthTokens = async (refreshToken: string): Promise<SupabaseOAuthTokens> =>
    postTokenRequest(new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    }));

export const storeOAuthSession = async (userId: string, tokens: SupabaseOAuthTokens): Promise<void> => {
    await getPool().query(
        `INSERT INTO public.user_supabase_oauth_sessions
           (user_id, access_token, refresh_token, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
        [userId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt.toISOString()],
    );
};

export const loadOAuthSession = async (userId: string): Promise<SupabaseOAuthTokens | null> => {
    const { rows } = await getPool().query<{
        access_token: string;
        refresh_token: string;
        expires_at: Date;
    }>(
        `SELECT access_token, refresh_token, expires_at
         FROM public.user_supabase_oauth_sessions WHERE user_id = $1`,
        [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresAt: new Date(row.expires_at),
    };
};

export const clearOAuthSession = async (userId: string): Promise<void> => {
    await getPool().query(`DELETE FROM public.user_supabase_oauth_sessions WHERE user_id = $1`, [userId]);
};

export const getValidOAuthAccessToken = async (userId: string): Promise<string | null> => {
    const session = await loadOAuthSession(userId);
    if (!session) return null;

    if (session.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
        return session.accessToken;
    }

    try {
        const refreshed = await refreshOAuthTokens(session.refreshToken);
        await storeOAuthSession(userId, refreshed);
        return refreshed.accessToken;
    } catch (error) {
        log.warn('supabase.oauth_refresh_failed', { userId, ...errorFields(error) });
        await clearOAuthSession(userId);
        return null;
    }
};

export interface StoredOAuthConnection {
    connection_source: string;
    mcp_access_token: string | null;
    oauth_refresh_token: string | null;
    oauth_expires_at: Date | null;
}

export const ensureFreshConnectionAccessToken = async (
    userId: string,
    conn: StoredOAuthConnection,
): Promise<string | null> => {
    if (conn.connection_source !== 'oauth') {
        return conn.mcp_access_token;
    }
    if (!conn.oauth_refresh_token) {
        return conn.mcp_access_token;
    }

    const expiresAt = conn.oauth_expires_at ? new Date(conn.oauth_expires_at).getTime() : 0;
    if (expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS && conn.mcp_access_token) {
        return conn.mcp_access_token;
    }

    try {
        const refreshed = await refreshOAuthTokens(conn.oauth_refresh_token);
        await getPool().query(
            `UPDATE public.user_supabase_connections
             SET mcp_access_token = $2,
                 oauth_refresh_token = $3,
                 oauth_expires_at = $4,
                 updated_at = NOW()
             WHERE user_id = $1`,
            [userId, refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt.toISOString()],
        );
        return refreshed.accessToken;
    } catch (error) {
        log.warn('supabase.oauth_connection_refresh_failed', { userId, ...errorFields(error) });
        return conn.mcp_access_token;
    }
};

const mgmtFetch = async (path: string, accessToken: string): Promise<Response> =>
    fetch(`${SUPABASE_MGMT_API}${path}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
    });

export const listProjects = async (accessToken: string): Promise<SupabaseProjectSummary[]> => {
    const response = await mgmtFetch('/projects', accessToken);
    const payload = await response.json();
    if (!response.ok) {
        const err = payload as { message?: string; error?: string };
        throw new Error(err.message || err.error || `Failed to list projects (${response.status})`);
    }
    const projects = Array.isArray(payload) ? payload as ManagementProject[] : [];
    return projects
        .filter((p) => typeof p.ref === 'string' && p.ref.length > 0)
        .map((p) => ({
            ref: p.ref as string,
            name: typeof p.name === 'string' ? p.name : p.ref as string,
            id: typeof p.id === 'string' ? p.id : p.ref as string,
            region: typeof p.region === 'string' ? p.region : undefined,
        }));
};

export const getProjectApiKeys = async (accessToken: string, projectRef: string): Promise<SupabaseProjectApiKeys> => {
    const response = await mgmtFetch(`/projects/${encodeURIComponent(projectRef)}/api-keys?reveal=true`, accessToken);
    const payload = await response.json();
    if (!response.ok) {
        const err = payload as { message?: string; error?: string };
        throw new Error(err.message || err.error || `Failed to fetch API keys (${response.status})`);
    }

    const keys = Array.isArray(payload) ? payload as ManagementApiKey[] : [];
    const publishable = keys.find((k) => k.type === 'publishable' || k.name === 'anon');
    const legacyAnon = keys.find((k) => k.type === 'anon' || k.name === 'anon');
    const anonKey = publishable?.api_key || legacyAnon?.api_key;
    if (!anonKey) {
        throw new Error('No publishable or anon API key found for this project.');
    }

    return {
        anonKey,
        projectRef,
        projectUrl: `https://${projectRef}.supabase.co`,
    };
};

export const getFrontendOAuthRedirectUrl = (params: Record<string, string>): string => {
    const base = process.env.FRONTEND_URL || 'http://localhost:5173';
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
};

export const cleanupExpiredOAuthStates = async (): Promise<void> => {
    await getPool().query(
        `DELETE FROM public.supabase_oauth_states WHERE created_at < NOW() - INTERVAL '10 minutes'`,
    );
};
