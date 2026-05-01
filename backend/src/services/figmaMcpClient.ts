import { log, errorFields } from '../lib/logger';

export interface FigmaMcpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

export interface FigmaMcpToolCallResult {
    toolName: string;
    text: string;
    raw: unknown;
}

export interface FigmaMcpStatus {
    enabled: boolean;
    endpoint: string;
    authConfigured: boolean;
}

/**
 * Per-request configuration that can override env-level defaults.
 * When a user has a stored Figma token in the DB, the controller
 * passes it here so the MCP client uses the user's own credentials.
 */
export interface FigmaMcpConfig {
    accessToken?: string;
    enabled?: boolean;
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

const DEFAULT_FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const MCP_PROTOCOL_VERSION = '2025-11-25';

const parseTimeoutMs = (raw: string | undefined, fallback: number): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const parseHeadersJson = (raw: string | undefined): Record<string, string> => {
    if (!raw?.trim()) return {};
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string' && key.trim()) headers[key] = value;
        }
        return headers;
    } catch {
        log.warn('figma.mcp_headers_json_invalid');
        return {};
    }
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
            // Keep looking for the last parseable event.
        }
    }
    throw new Error('MCP server returned an SSE response without JSON data');
};

/**
 * Resolve the effective access token: per-user override > env var.
 */
const resolveAccessToken = (config?: FigmaMcpConfig): string | undefined => {
    return config?.accessToken || process.env.FIGMA_MCP_ACCESS_TOKEN || undefined;
};

/**
 * Resolve whether Figma MCP is enabled: per-user override > env var.
 */
const resolveEnabled = (config?: FigmaMcpConfig): boolean => {
    if (config?.enabled !== undefined) return config.enabled;
    if (config?.accessToken) return true; // user has a token → enabled
    return process.env.FIGMA_MCP_ENABLED === 'true';
};

class FigmaMcpClient {
    private requestCounter = 0;
    private initialized = false;
    private sessionId: string | null = null;
    private toolsCache: FigmaMcpTool[] | null = null;

    getStatus(config?: FigmaMcpConfig): FigmaMcpStatus {
        const token = resolveAccessToken(config);
        const enabled = resolveEnabled(config);
        return {
            enabled,
            endpoint: process.env.FIGMA_MCP_URL || DEFAULT_FIGMA_MCP_URL,
            authConfigured: !!token || !!process.env.FIGMA_MCP_HEADERS_JSON,
        };
    }

    private nextId(): number {
        this.requestCounter += 1;
        return this.requestCounter;
    }

    private getRequestHeaders(config?: FigmaMcpConfig): Record<string, string> {
        const token = resolveAccessToken(config);
        return {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...parseHeadersJson(process.env.FIGMA_MCP_HEADERS_JSON),
            ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        };
    }

    private async postJsonRpc(requestPayload: Record<string, unknown>, method: string, config?: FigmaMcpConfig): Promise<unknown> {
        const status = this.getStatus(config);
        if (!status.enabled) {
            throw new Error('Figma MCP is disabled. Set FIGMA_MCP_ENABLED=true or connect your Figma account to enable it.');
        }

        const controller = new AbortController();
        const timeoutMs = parseTimeoutMs(process.env.FIGMA_MCP_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
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
                throw new Error(`Figma MCP ${method} failed (${response.status}): ${responseText || response.statusText}`);
            }

            if (!responseText.trim()) return null;

            const contentType = response.headers.get('content-type') || '';
            const responsePayload = contentType.includes('text/event-stream')
                ? parseSseJson(responseText)
                : JSON.parse(responseText) as JsonRpcResponse;

            if (responsePayload.error) {
                throw new Error(`Figma MCP ${method} error: ${responsePayload.error.message || responsePayload.error.code || 'unknown error'}`);
            }
            return responsePayload.result;
        } catch (error) {
            log.warn('figma.mcp_rpc_failed', {
                method,
                endpoint: status.endpoint,
                ...errorFields(error),
            });
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    private async rpc(method: string, params?: unknown, config?: FigmaMcpConfig): Promise<unknown> {
        return this.postJsonRpc({
            jsonrpc: '2.0',
            id: this.nextId(),
            method,
            params,
        }, method, config);
    }

    private async notify(method: string, params?: unknown, config?: FigmaMcpConfig): Promise<void> {
        await this.postJsonRpc({
            jsonrpc: '2.0',
            method,
            ...(typeof params === 'undefined' ? {} : { params }),
        }, method, config);
    }

    private async initialize(config?: FigmaMcpConfig): Promise<void> {
        if (this.initialized) return;
        await this.rpc('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
                name: 'nextgen',
                version: '1.0.0',
            },
        }, config);
        try {
            await this.notify('notifications/initialized', undefined, config);
        } catch {
            // Some servers reject JSON-RPC notifications over request-only transports.
        }
        this.initialized = true;
    }

    async listTools(config?: FigmaMcpConfig): Promise<FigmaMcpTool[]> {
        await this.initialize(config);
        if (this.toolsCache) return this.toolsCache;
        const result = await this.rpc('tools/list', undefined, config);
        const tools = result && typeof result === 'object' && Array.isArray((result as { tools?: unknown[] }).tools)
            ? (result as { tools: FigmaMcpTool[] }).tools
            : [];
        this.toolsCache = tools;
        return tools;
    }

    async callTool(name: string, args: Record<string, unknown>, config?: FigmaMcpConfig): Promise<FigmaMcpToolCallResult> {
        await this.initialize(config);
        const result = await this.rpc('tools/call', { name, arguments: args }, config);
        return {
            toolName: name,
            text: stringifyToolContent(result),
            raw: result,
        };
    }

    /**
     * Validate a token by attempting to initialize and list tools.
     * Returns the tool count on success, throws on failure.
     */
    async validateToken(accessToken: string): Promise<{ toolCount: number }> {
        // Use a temporary state — don't pollute the main client's session
        const tempClient = new FigmaMcpClient();
        const config: FigmaMcpConfig = { accessToken, enabled: true };
        const tools = await tempClient.listTools(config);
        return { toolCount: tools.length };
    }

    resetCache(): void {
        this.toolsCache = null;
    }
}

export const figmaMcpClient = new FigmaMcpClient();
