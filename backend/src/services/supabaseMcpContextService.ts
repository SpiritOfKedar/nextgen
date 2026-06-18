import { supabaseMcpClient, SupabaseMcpTool, SupabaseMcpConfig } from './supabaseMcpClient';
import { log, errorFields } from '../lib/logger';
import { getCachedJson, setCachedJson } from '../lib/cacheJson';

export interface SupabaseContextInput {
    fetchTables?: boolean;
    fetchAdvisors?: boolean;
    docsQuery?: string;
}

export interface SupabaseToolContext {
    toolName: string;
    text: string;
}

export interface SupabaseMcpDesignContext {
    projectRef: string | null;
    fetchedAt: string;
    toolContexts: SupabaseToolContext[];
    warnings: string[];
}

type ResolveOptions = {
    requestId?: string;
    userId?: string;
    mcpConfig?: SupabaseMcpConfig;
};

const MAX_TOOL_TEXT_CHARS = 18_000;
const MAX_TOTAL_CONTEXT_CHARS = 48_000;
const SUPABASE_CONTEXT_CACHE_TTL = 5 * 60;
const SUPABASE_CACHE_NS = 'mcp:supabase';

const PREFERRED_READ_TOOLS = [
    'list_tables',
    'list_migrations',
    'get_advisors',
    'search_docs',
    'generate_typescript_types',
];

const getObjectProperties = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object') return {};
    const rec = value as Record<string, unknown>;
    const props = rec.properties;
    return props && typeof props === 'object' ? props as Record<string, unknown> : {};
};

const hasProp = (props: Record<string, unknown>, names: string[]): string | null => {
    const lowerToActual = new Map(Object.keys(props).map((key) => [key.toLowerCase(), key]));
    for (const name of names) {
        const match = lowerToActual.get(name.toLowerCase());
        if (match) return match;
    }
    return null;
};

const buildToolArguments = (
    tool: SupabaseMcpTool,
    input: SupabaseContextInput,
): Record<string, unknown> | null => {
    const props = getObjectProperties(tool.inputSchema);
    const args: Record<string, unknown> = {};

    if (tool.name === 'list_tables') {
        const schemaKey = hasProp(props, ['schemas', 'schema']);
        if (schemaKey) args[schemaKey] = ['public'];
        return args;
    }

    if (tool.name === 'get_advisors') {
        const typeKey = hasProp(props, ['type', 'advisor_type', 'category']);
        if (typeKey) args[typeKey] = 'security';
        return args;
    }

    if (tool.name === 'search_docs') {
        if (!input.docsQuery?.trim()) return null;
        const queryKey = hasProp(props, ['query', 'search', 'text', 'prompt']);
        if (queryKey) args[queryKey] = input.docsQuery.trim();
        return Object.keys(args).length > 0 ? args : { query: input.docsQuery.trim() };
    }

    if (tool.name === 'list_migrations' || tool.name === 'generate_typescript_types') {
        return args;
    }

    return null;
};

const shouldCallTool = (toolName: string, input: SupabaseContextInput): boolean => {
    if (toolName === 'list_tables' || toolName === 'list_migrations' || toolName === 'generate_typescript_types') {
        return input.fetchTables !== false;
    }
    if (toolName === 'get_advisors') return input.fetchAdvisors !== false;
    if (toolName === 'search_docs') return Boolean(input.docsQuery?.trim());
    return false;
};

const truncate = (text: string, max: number): string => {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n[...truncated ${text.length - max} chars]`;
};

export const supabaseMcpContextService = {
    async resolveContext(
        input: SupabaseContextInput,
        options: ResolveOptions = {},
    ): Promise<SupabaseMcpDesignContext> {
        const context: SupabaseMcpDesignContext = {
            projectRef: options.mcpConfig?.projectRef ?? null,
            fetchedAt: new Date().toISOString(),
            toolContexts: [],
            warnings: [],
        };

        const status = supabaseMcpClient.getStatus(options.mcpConfig);
        if (!status.enabled || !status.authConfigured) {
            context.warnings.push('Supabase MCP is not connected. Add a Supabase personal access token in the connect panel.');
            return context;
        }
        if (!status.projectRef) {
            context.warnings.push('Supabase MCP requires a connected project with a valid project ref.');
            return context;
        }

        const cacheKeyParts = [
            options.userId || 'anon',
            status.projectRef,
            input.fetchTables !== false ? 'tables' : '',
            input.fetchAdvisors !== false ? 'advisors' : '',
            input.docsQuery || '',
        ];
        const cached = await getCachedJson<SupabaseMcpDesignContext>(SUPABASE_CACHE_NS, cacheKeyParts);
        if (cached) return cached;

        try {
            const tools = await supabaseMcpClient.listTools(options.mcpConfig);
            if (tools.length === 0) {
                context.warnings.push('Supabase MCP returned no tools.');
                return context;
            }

            const selectedTools = PREFERRED_READ_TOOLS
                .map((name) => tools.find((t) => t.name === name))
                .filter((t): t is SupabaseMcpTool => !!t && shouldCallTool(t.name, input));

            let totalChars = 0;
            for (const tool of selectedTools) {
                const args = buildToolArguments(tool, input);
                if (args === null) continue;

                try {
                    const result = await supabaseMcpClient.callTool(tool.name, args, options.mcpConfig);
                    const bounded = truncate(result.text, MAX_TOOL_TEXT_CHARS);
                    if (totalChars + bounded.length > MAX_TOTAL_CONTEXT_CHARS) {
                        context.warnings.push('Context budget reached; skipped remaining Supabase MCP tools.');
                        break;
                    }
                    totalChars += bounded.length;
                    context.toolContexts.push({ toolName: tool.name, text: bounded });
                } catch (error) {
                    context.warnings.push(
                        `Tool ${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }
        } catch (error) {
            log.warn('supabase.mcp_context_resolve_failed', {
                requestId: options.requestId,
                userId: options.userId,
                ...errorFields(error),
            });
            context.warnings.push(`Supabase MCP error: ${error instanceof Error ? error.message : String(error)}`);
        }

        if (context.toolContexts.length > 0) {
            await setCachedJson(SUPABASE_CACHE_NS, cacheKeyParts, context, SUPABASE_CONTEXT_CACHE_TTL);
        }

        return context;
    },

    async inspect(input: SupabaseContextInput, options: ResolveOptions = {}): Promise<SupabaseMcpDesignContext> {
        return this.resolveContext(input, options);
    },
};
