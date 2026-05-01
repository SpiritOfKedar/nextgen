import { figmaMcpClient, FigmaMcpTool, FigmaMcpConfig } from './figmaMcpClient';
import { log, errorFields } from '../lib/logger';

export interface ParsedFigmaLink {
    url: string;
    fileKey: string | null;
    nodeId: string | null;
}

export interface FigmaToolContext {
    toolName: string;
    text: string;
}

export interface FigmaDesignContext {
    url: string;
    fileKey: string | null;
    nodeId: string | null;
    fetchedAt: string;
    toolContexts: FigmaToolContext[];
    warnings: string[];
}

type ResolveOptions = {
    requestId?: string;
    userId?: string;
    mcpConfig?: FigmaMcpConfig;
};

const MAX_FIGMA_LINKS = 3;
const MAX_TOOL_TEXT_CHARS = 18_000;
const MAX_TOTAL_CONTEXT_CHARS = 48_000;

const PREFERRED_READ_TOOLS = [
    'get_metadata',
    'get_variable_defs',
    'get_design_context',
    'get_code_connect_map',
];

const getObjectProperties = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object') return {};
    const rec = value as Record<string, unknown>;
    const props = rec.properties;
    return props && typeof props === 'object' ? props as Record<string, unknown> : {};
};

export const parseFigmaUrl = (rawUrl: string): ParsedFigmaLink | null => {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl.trim());
    } catch {
        return null;
    }

    if (!/(^|\.)figma\.com$/i.test(parsed.hostname)) return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    const fileKey = segments.length >= 2 && ['design', 'file', 'proto', 'board'].includes(segments[0])
        ? segments[1]
        : null;
    const nodeIdRaw = parsed.searchParams.get('node-id') || parsed.searchParams.get('node_id');
    const nodeId = nodeIdRaw ? nodeIdRaw.replace(/-/g, ':') : null;

    return {
        url: parsed.toString(),
        fileKey,
        nodeId,
    };
};

const normalizeRawLinks = (raw: unknown): ParsedFigmaLink[] => {
    if (!Array.isArray(raw)) return [];
    const out: ParsedFigmaLink[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        const rawUrl = typeof item === 'string'
            ? item
            : item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string'
                ? String((item as { url: string }).url)
                : '';
        const parsed = rawUrl ? parseFigmaUrl(rawUrl) : null;
        if (!parsed || seen.has(parsed.url)) continue;
        seen.add(parsed.url);
        out.push(parsed);
        if (out.length >= MAX_FIGMA_LINKS) break;
    }
    return out;
};

const hasProp = (props: Record<string, unknown>, names: string[]): string | null => {
    const lowerToActual = new Map(Object.keys(props).map((key) => [key.toLowerCase(), key]));
    for (const name of names) {
        const match = lowerToActual.get(name.toLowerCase());
        if (match) return match;
    }
    return null;
};

const isArrayProp = (prop: unknown): boolean =>
    !!prop && typeof prop === 'object' && (prop as Record<string, unknown>).type === 'array';

const buildToolArguments = (tool: FigmaMcpTool, link: ParsedFigmaLink): Record<string, unknown> => {
    const props = getObjectProperties(tool.inputSchema);
    const args: Record<string, unknown> = {};

    const urlKey = hasProp(props, ['url', 'figmaUrl', 'figma_url', 'link', 'figmaLink']);
    if (urlKey) args[urlKey] = link.url;

    const fileKey = hasProp(props, ['fileKey', 'file_key', 'file']);
    if (fileKey && link.fileKey) args[fileKey] = link.fileKey;

    const nodeKey = hasProp(props, ['nodeId', 'nodeID', 'node_id', 'node']);
    if (nodeKey && link.nodeId) args[nodeKey] = link.nodeId;

    const clientFrameworksKey = hasProp(props, ['clientFrameworks', 'client_frameworks']);
    if (clientFrameworksKey) {
        args[clientFrameworksKey] = isArrayProp(props[clientFrameworksKey]) ? ['React'] : 'React';
    }

    const clientLanguagesKey = hasProp(props, ['clientLanguages', 'client_languages']);
    if (clientLanguagesKey) {
        args[clientLanguagesKey] = isArrayProp(props[clientLanguagesKey]) ? ['TypeScript'] : 'TypeScript';
    }

    const frameworkKey = hasProp(props, ['framework']);
    if (frameworkKey) args[frameworkKey] = 'React';

    const languageKey = hasProp(props, ['language']);
    if (languageKey) args[languageKey] = 'TypeScript';

    // If the server schema is not available, Figma's remote workflow is link-based.
    if (Object.keys(args).length === 0) {
        args.url = link.url;
    }

    return args;
};

const clip = (text: string, maxChars: number): string =>
    text.length > maxChars
        ? `${text.slice(0, maxChars)}\n\n[...truncated ${text.length - maxChars} chars]`
        : text;

class FigmaDesignContextService {
    async resolveDesignContexts(rawLinks: unknown, options: ResolveOptions = {}): Promise<FigmaDesignContext[]> {
        const links = normalizeRawLinks(rawLinks);
        if (links.length === 0) return [];

        const status = figmaMcpClient.getStatus(options.mcpConfig);
        if (!status.enabled) {
            return links.map((link) => ({
                ...link,
                fetchedAt: new Date().toISOString(),
                toolContexts: [],
                warnings: ['Figma MCP is disabled on the backend. Set FIGMA_MCP_ENABLED=true to fetch design context.'],
            }));
        }

        let tools: FigmaMcpTool[];
        try {
            tools = await figmaMcpClient.listTools(options.mcpConfig);
        } catch (error) {
            log.warn('figma.context_list_tools_failed', {
                requestId: options.requestId,
                internalUserId: options.userId,
                ...errorFields(error),
            });
            return links.map((link) => ({
                ...link,
                fetchedAt: new Date().toISOString(),
                toolContexts: [],
                warnings: [`Could not connect to Figma MCP: ${error instanceof Error ? error.message : String(error)}`],
            }));
        }

        const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
        const selectedTools = PREFERRED_READ_TOOLS
            .map((name) => toolMap.get(name))
            .filter((tool): tool is FigmaMcpTool => !!tool);

        if (selectedTools.length === 0) {
            return links.map((link) => ({
                ...link,
                fetchedAt: new Date().toISOString(),
                toolContexts: [],
                warnings: [`Figma MCP connected, but none of the expected read tools were available. Tools: ${tools.map((t) => t.name).join(', ') || 'none'}`],
            }));
        }

        let remainingBudget = MAX_TOTAL_CONTEXT_CHARS;
        const contexts: FigmaDesignContext[] = [];

        for (const link of links) {
            const toolContexts: FigmaToolContext[] = [];
            const warnings: string[] = [];

            for (const tool of selectedTools) {
                if (remainingBudget <= 0) {
                    warnings.push('Figma context budget exhausted; skipped remaining tools.');
                    break;
                }
                try {
                    const result = await figmaMcpClient.callTool(tool.name, buildToolArguments(tool, link), options.mcpConfig);
                    const text = clip(result.text || JSON.stringify(result.raw, null, 2), Math.min(MAX_TOOL_TEXT_CHARS, remainingBudget));
                    if (text.trim()) {
                        toolContexts.push({ toolName: tool.name, text });
                        remainingBudget -= text.length;
                    }
                } catch (error) {
                    warnings.push(`${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`);
                    log.warn('figma.context_tool_failed', {
                        requestId: options.requestId,
                        internalUserId: options.userId,
                        toolName: tool.name,
                        url: link.url,
                        ...errorFields(error),
                    });
                }
            }

            contexts.push({
                ...link,
                fetchedAt: new Date().toISOString(),
                toolContexts,
                warnings,
            });
        }

        log.info('figma.context_resolved', {
            requestId: options.requestId,
            internalUserId: options.userId,
            linkCount: links.length,
            contextCount: contexts.length,
            contextChars: MAX_TOTAL_CONTEXT_CHARS - remainingBudget,
        });

        return contexts;
    }

    async inspectLink(url: string, options: ResolveOptions = {}): Promise<FigmaDesignContext | null> {
        const contexts = await this.resolveDesignContexts([{ url }], options);
        return contexts[0] ?? null;
    }
}

export const figmaDesignContextService = new FigmaDesignContextService();
