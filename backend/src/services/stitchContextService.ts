import { stitchMcpClient, StitchMcpTool, StitchMcpConfig } from './stitchMcpClient';
import { log, errorFields } from '../lib/logger';
import { getCachedJson, setCachedJson } from '../lib/cacheJson';

export interface StitchContextInput {
    projectId?: string;
    prompt?: string;
    screenId?: string;
}

export interface StitchToolContext {
    toolName: string;
    text: string;
}

export interface StitchDesignContext {
    projectId: string | null;
    prompt: string | null;
    screenId: string | null;
    fetchedAt: string;
    toolContexts: StitchToolContext[];
    warnings: string[];
}

type ResolveOptions = {
    requestId?: string;
    userId?: string;
    mcpConfig?: StitchMcpConfig;
    defaultProjectId?: string | null;
};

const MAX_TOOL_TEXT_CHARS = 18_000;
const MAX_TOTAL_CONTEXT_CHARS = 48_000;
const STITCH_CONTEXT_CACHE_TTL = 15 * 60;
const STITCH_CACHE_NS = 'mcp:stitch';

const PREFERRED_READ_TOOLS = [
    'get_design_context',
    'get_project',
    'list_screens',
    'get_screen',
    'generate_screen_from_text',
    'get_metadata',
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
    tool: StitchMcpTool,
    input: StitchContextInput,
    defaultProjectId?: string | null,
): Record<string, unknown> => {
    const props = getObjectProperties(tool.inputSchema);
    const args: Record<string, unknown> = {};

    const projectKey = hasProp(props, ['projectId', 'project_id', 'project']);
    const projectId = input.projectId || defaultProjectId;
    if (projectKey && projectId) args[projectKey] = projectId;

    const promptKey = hasProp(props, ['prompt', 'text', 'description', 'query']);
    if (promptKey && input.prompt) args[promptKey] = input.prompt;

    const screenKey = hasProp(props, ['screenId', 'screen_id', 'screen']);
    if (screenKey && input.screenId) args[screenKey] = input.screenId;

    return args;
};

const truncate = (text: string, max: number): string => {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n[...truncated ${text.length - max} chars]`;
};

export const stitchContextService = {
    async resolveContext(
        input: StitchContextInput,
        options: ResolveOptions = {},
    ): Promise<StitchDesignContext> {
        const context: StitchDesignContext = {
            projectId: input.projectId || options.defaultProjectId || null,
            prompt: input.prompt || null,
            screenId: input.screenId || null,
            fetchedAt: new Date().toISOString(),
            toolContexts: [],
            warnings: [],
        };

        const status = stitchMcpClient.getStatus(options.mcpConfig);
        if (!status.enabled || !status.authConfigured) {
            context.warnings.push('Stitch MCP is not connected.');
            return context;
        }

        const cacheKeyParts = [
            options.userId || 'anon',
            input.projectId || options.defaultProjectId || '',
            input.prompt || '',
            input.screenId || '',
        ];
        const cached = await getCachedJson<StitchDesignContext>(STITCH_CACHE_NS, cacheKeyParts);
        if (cached) return cached;

        try {
            const tools = await stitchMcpClient.listTools(options.mcpConfig);
            if (tools.length === 0) {
                context.warnings.push('Stitch MCP returned no tools.');
                return context;
            }

            const selectedTools = PREFERRED_READ_TOOLS
                .map((name) => tools.find((t) => t.name === name))
                .filter(Boolean) as StitchMcpTool[];

            const toolsToCall = selectedTools.length > 0 ? selectedTools : tools.slice(0, 3);
            let totalChars = 0;

            for (const tool of toolsToCall) {
                const args = buildToolArguments(tool, input, options.defaultProjectId);
                if (Object.keys(args).length === 0 && !input.prompt) continue;

                try {
                    const result = await stitchMcpClient.callTool(tool.name, args, options.mcpConfig);
                    const bounded = truncate(result.text, MAX_TOOL_TEXT_CHARS);
                    if (totalChars + bounded.length > MAX_TOTAL_CONTEXT_CHARS) {
                        context.warnings.push(`Context budget reached; skipped remaining Stitch tools.`);
                        break;
                    }
                    totalChars += bounded.length;
                    context.toolContexts.push({ toolName: tool.name, text: bounded });
                } catch (error) {
                    context.warnings.push(`Tool ${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        } catch (error) {
            log.warn('stitch.context_resolve_failed', {
                requestId: options.requestId,
                userId: options.userId,
                ...errorFields(error),
            });
            context.warnings.push(`Stitch MCP error: ${error instanceof Error ? error.message : String(error)}`);
        }

        if (context.toolContexts.length > 0) {
            await setCachedJson(STITCH_CACHE_NS, cacheKeyParts, context, STITCH_CONTEXT_CACHE_TTL);
        }

        return context;
    },

    async inspect(input: StitchContextInput, options: ResolveOptions = {}): Promise<StitchDesignContext> {
        return this.resolveContext(input, options);
    },
};
