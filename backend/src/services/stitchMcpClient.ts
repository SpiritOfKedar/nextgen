import { log, errorFields } from '../lib/logger';

export interface StitchMcpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

export interface StitchMcpToolCallResult {
    toolName: string;
    text: string;
    raw: unknown;
}

export interface StitchMcpStatus {
    enabled: boolean;
    endpoint: string;
    authConfigured: boolean;
}

export interface StitchMcpConfig {
    apiKey?: string;
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

const DEFAULT_STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';
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
    throw new Error('MCP server returned an SSE response without JSON data');
};

const resolveApiKey = (config?: StitchMcpConfig): string | undefined =>
    config?.apiKey || process.env.STITCH_MCP_API_KEY || undefined;

const resolveEnabled = (config?: StitchMcpConfig): boolean => {
    if (config?.enabled !== undefined) return config.enabled;
    if (config?.apiKey) return true;
    return process.env.STITCH_MCP_ENABLED === 'true';
};

class StitchMcpClient {
    private requestCounter = 0;
    private initialized = false;
    private sessionId: string | null = null;
    private toolsCache: StitchMcpTool[] | null = null;

    getStatus(config?: StitchMcpConfig): StitchMcpStatus {
        const apiKey = resolveApiKey(config);
        const enabled = resolveEnabled(config);
        return {
            enabled,
            endpoint: process.env.STITCH_MCP_URL || DEFAULT_STITCH_MCP_URL,
            authConfigured: !!apiKey,
        };
    }

    private nextId(): number {
        this.requestCounter += 1;
        return this.requestCounter;
    }

    private getRequestHeaders(config?: StitchMcpConfig): Record<string, string> {
        const apiKey = resolveApiKey(config);
        return {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            ...(apiKey ? { 'X-Goog-Api-Key': apiKey } : {}),
            ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        };
    }

    private async postJsonRpc(requestPayload: Record<string, unknown>, method: string, config?: StitchMcpConfig): Promise<unknown> {
        const status = this.getStatus(config);
        if (!status.enabled) {
            throw new Error('Stitch MCP is disabled. Connect your Stitch API key to enable it.');
        }
        if (!status.authConfigured) {
            throw new Error('Stitch MCP API key is not configured.');
        }

        const controller = new AbortController();
        const timeoutMs = parseTimeoutMs(process.env.STITCH_MCP_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
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
                throw new Error(`Stitch MCP ${method} failed (${response.status}): ${responseText || response.statusText}`);
            }
            if (!responseText.trim()) return null;

            const contentType = response.headers.get('content-type') || '';
            const responsePayload = contentType.includes('text/event-stream')
                ? parseSseJson(responseText)
                : JSON.parse(responseText) as JsonRpcResponse;

            if (responsePayload.error) {
                throw new Error(`Stitch MCP ${method} error: ${responsePayload.error.message || responsePayload.error.code || 'unknown error'}`);
            }
            return responsePayload.result;
        } catch (error) {
            log.warn('stitch.mcp_rpc_failed', {
                method,
                endpoint: status.endpoint,
                ...errorFields(error),
            });
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    private async rpc(method: string, params?: unknown, config?: StitchMcpConfig): Promise<unknown> {
        return this.postJsonRpc({
            jsonrpc: '2.0',
            id: this.nextId(),
            method,
            params,
        }, method, config);
    }

    private async notify(method: string, params?: unknown, config?: StitchMcpConfig): Promise<void> {
        await this.postJsonRpc({
            jsonrpc: '2.0',
            method,
            ...(typeof params === 'undefined' ? {} : { params }),
        }, method, config);
    }

    private async initialize(config?: StitchMcpConfig): Promise<void> {
        if (this.initialized) return;
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

    async listTools(config?: StitchMcpConfig): Promise<StitchMcpTool[]> {
        await this.initialize(config);
        if (this.toolsCache) return this.toolsCache;
        const result = await this.rpc('tools/list', undefined, config);
        const tools = result && typeof result === 'object' && Array.isArray((result as { tools?: unknown[] }).tools)
            ? (result as { tools: StitchMcpTool[] }).tools
            : [];
        this.toolsCache = tools;
        return tools;
    }

    async callTool(name: string, args: Record<string, unknown>, config?: StitchMcpConfig): Promise<StitchMcpToolCallResult> {
        await this.initialize(config);
        const result = await this.rpc('tools/call', { name, arguments: args }, config);
        return {
            toolName: name,
            text: stringifyToolContent(result),
            raw: result,
        };
    }

    async validateApiKey(apiKey: string): Promise<{ toolCount: number }> {
        const tempClient = new StitchMcpClient();
        const config: StitchMcpConfig = { apiKey, enabled: true };
        const tools = await tempClient.listTools(config);
        return { toolCount: tools.length };
    }
}

export const stitchMcpClient = new StitchMcpClient();
