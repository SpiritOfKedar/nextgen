import { log, errorFields } from '../lib/logger';

export interface SupabaseMcpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

export interface SupabaseMcpToolCallResult {
    toolName: string;
    text: string;
    raw: unknown;
}

export interface SupabaseMcpStatus {
    enabled: boolean;
    endpoint: string;
    authConfigured: boolean;
    projectRef: string | null;
}

export interface SupabaseMcpConfig {
    accessToken?: string;
    projectRef?: string | null;
    enabled?: boolean;
    /** When true, scopes MCP to read-only SQL (recommended for prompt context). */
    readOnly?: boolean;
}

type JsonRpcResponse = {
    jsonrpc?: string;
    id?: string | number | null;
    result?: unknown;
    error?: {
        code?: number;
        message?: string;
        data?: unknown;
    };
};

const DEFAULT_SUPABASE_MCP_URL = 'https://mcp.supabase.com/mcp';
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const MCP_PROTOCOL_VERSION = '2025-11-25';

const parseTimeoutMs = (raw: string | undefined, fallback: number): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const stringifyToolContent = (result: unknown): string => {
    const rec = result && typeof result === 'object' ? result as Record<string, unknown> : null;
    const content = Array.isArray(rec?.content) ? rec.content : [];
    if (content.length === 0) return JSON.stringify(result, null, 2);

    const parts = content.map((item) => {
        if (!item || typeof item !== 'object') return String(item);
        const block = item as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') return block.text;
        if (block.type === 'image') {
            const mimeType = typeof block.mimeType === 'string' ? block.mimeType : 'image';
            return `[${mimeType} omitted from prompt context]`;
        }
        return JSON.stringify(block, null, 2);
    });
    return parts.filter(Boolean).join('\n\n').trim();
};

const parseSseJson = (body: string): JsonRpcResponse => {
    const dataLines = body
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .filter((line) => line && line !== '[DONE]');

    for (let i = dataLines.length - 1; i >= 0; i -= 1) {
        try {
            return JSON.parse(dataLines[i]) as JsonRpcResponse;
        } catch {
            // keep looking
        }
    }
    throw new Error('Supabase MCP server returned an SSE response without JSON data');
};

const resolveAccessToken = (config?: SupabaseMcpConfig): string | undefined =>
    config?.accessToken || process.env.SUPABASE_MCP_ACCESS_TOKEN || undefined;

const resolveEnabled = (config?: SupabaseMcpConfig): boolean => {
    if (config?.enabled !== undefined) return config.enabled;
    if (config?.accessToken) return true;
    return process.env.SUPABASE_MCP_ENABLED === 'true';
};

const buildEndpoint = (config?: SupabaseMcpConfig): string => {
    const base = process.env.SUPABASE_MCP_URL || DEFAULT_SUPABASE_MCP_URL;
    const projectRef = config?.projectRef || process.env.SUPABASE_MCP_PROJECT_REF || null;
    const readOnly = config?.readOnly !== false;
    const features = process.env.SUPABASE_MCP_FEATURES || 'database,docs,debugging';

    const url = new URL(base);
    if (projectRef) url.searchParams.set('project_ref', projectRef);
    if (readOnly) url.searchParams.set('read_only', 'true');
    if (features) url.searchParams.set('features', features);
    return url.toString();
};

class SupabaseMcpClient {
    private requestCounter = 0;
    private initialized = false;
    private sessionId: string | null = null;
    private toolsCache: SupabaseMcpTool[] | null = null;
    private cacheKey: string | null = null;

    getStatus(config?: SupabaseMcpConfig): SupabaseMcpStatus {
        const token = resolveAccessToken(config);
        const enabled = resolveEnabled(config);
        return {
            enabled,
            endpoint: buildEndpoint(config),
            authConfigured: !!token,
            projectRef: config?.projectRef ?? process.env.SUPABASE_MCP_PROJECT_REF ?? null,
        };
    }

    private nextId(): number {
        this.requestCounter += 1;
        return this.requestCounter;
    }

    private getRequestHeaders(config?: SupabaseMcpConfig): Record<string, string> {
        const token = resolveAccessToken(config);
        return {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        };
    }

    private async postJsonRpc(
        requestPayload: Record<string, unknown>,
        method: string,
        config?: SupabaseMcpConfig,
    ): Promise<unknown> {
        const status = this.getStatus(config);
        if (!status.enabled) {
            throw new Error('Supabase MCP is disabled. Connect a Supabase access token to enable it.');
        }
        if (!status.authConfigured) {
            throw new Error('Supabase MCP access token is not configured.');
        }
        if (!status.projectRef) {
            throw new Error('Supabase MCP requires a project ref. Connect your Supabase project first.');
        }

        const controller = new AbortController();
        const timeoutMs = parseTimeoutMs(process.env.SUPABASE_MCP_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(status.endpoint, {
                method: 'POST',
                headers: this.getRequestHeaders(config),
                body: JSON.stringify(requestPayload),
                signal: controller.signal,
            });

            const nextSessionId = response.headers.get('mcp-session-id');
            if (nextSessionId) this.sessionId = nextSessionId;

            const responseText = await response.text();
            if (!response.ok) {
                throw new Error(`Supabase MCP ${method} failed (${response.status}): ${responseText || response.statusText}`);
            }
            if (!responseText.trim()) return null;

            const contentType = response.headers.get('content-type') || '';
            const responsePayload = contentType.includes('text/event-stream')
                ? parseSseJson(responseText)
                : JSON.parse(responseText) as JsonRpcResponse;

            if (responsePayload.error) {
                throw new Error(
                    `Supabase MCP ${method} error: ${responsePayload.error.message || responsePayload.error.code || 'unknown error'}`,
                );
            }
            return responsePayload.result;
        } catch (error) {
            log.warn('supabase.mcp_rpc_failed', {
                method,
                endpoint: status.endpoint,
                ...errorFields(error),
            });
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    private async rpc(method: string, params?: unknown, config?: SupabaseMcpConfig): Promise<unknown> {
        return this.postJsonRpc({
            jsonrpc: '2.0',
            id: this.nextId(),
            method,
            params,
        }, method, config);
    }

    private async notify(method: string, params?: unknown, config?: SupabaseMcpConfig): Promise<void> {
        await this.postJsonRpc({
            jsonrpc: '2.0',
            method,
            ...(typeof params === 'undefined' ? {} : { params }),
        }, method, config);
    }

    private async initialize(config?: SupabaseMcpConfig): Promise<void> {
        const key = `${config?.projectRef || ''}:${config?.accessToken?.slice(0, 8) || 'env'}`;
        if (this.initialized && this.cacheKey === key) return;
        this.initialized = false;
        this.toolsCache = null;
        this.cacheKey = key;

        await this.rpc('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'nextgen', version: '1.0.0' },
        }, config);
        try {
            await this.notify('notifications/initialized', undefined, config);
        } catch {
            // optional notification
        }
        this.initialized = true;
    }

    async listTools(config?: SupabaseMcpConfig): Promise<SupabaseMcpTool[]> {
        await this.initialize(config);
        if (this.toolsCache) return this.toolsCache;
        const result = await this.rpc('tools/list', undefined, config);
        const tools = result && typeof result === 'object' && Array.isArray((result as { tools?: unknown[] }).tools)
            ? (result as { tools: SupabaseMcpTool[] }).tools
            : [];
        this.toolsCache = tools;
        return tools;
    }

    async callTool(
        name: string,
        args: Record<string, unknown>,
        config?: SupabaseMcpConfig,
    ): Promise<SupabaseMcpToolCallResult> {
        await this.initialize(config);
        const result = await this.rpc('tools/call', { name, arguments: args }, config);
        return {
            toolName: name,
            text: stringifyToolContent(result),
            raw: result,
        };
    }

    async validateAccessToken(accessToken: string, projectRef: string): Promise<{ toolCount: number }> {
        const tempClient = new SupabaseMcpClient();
        const config: SupabaseMcpConfig = { accessToken, projectRef, enabled: true, readOnly: true };
        const tools = await tempClient.listTools(config);
        return { toolCount: tools.length };
    }
}

export const supabaseMcpClient = new SupabaseMcpClient();
