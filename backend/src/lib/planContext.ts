export const MAX_PLAN_CONTEXT_CHARS = 24_000;
export const MAX_SUPABASE_PLAN_EXCERPT_CHARS = 16_000;
export const PLAN_CONTEXT_MIN_CHARS = 80;

const SUPABASE_SECTION_KEYWORDS = [
    'supabase',
    'migration',
    'database schema',
    'data model',
    'row level security',
    'rls',
    'postgres',
    'auth.users',
    'profiles',
];

const looksLikeSupabaseSql = (sql: string): boolean =>
    /create\s+table|alter\s+table|create\s+policy|enable\s+row\s+level|references\s+auth\.users/i.test(sql);

/** Pull SQL blocks and Supabase-related markdown sections from a plan response. */
export function extractSupabasePlanExcerpt(text: string): string | null {
    const parts: string[] = [];

    for (const match of text.matchAll(/```(?:sql)?\s*([\s\S]*?)```/gi)) {
        const block = match[1].trim();
        if (block && looksLikeSupabaseSql(block)) {
            parts.push(block);
        }
    }

    const lines = text.split('\n');
    let capturing = false;
    let sectionLines: string[] = [];

    const flushSection = () => {
        if (sectionLines.length > 0) {
            const chunk = sectionLines.join('\n').trim();
            if (chunk.length > 40) parts.push(chunk);
        }
        sectionLines = [];
        capturing = false;
    };

    for (const line of lines) {
        const heading = line.match(/^##\s+(.+)$/i);
        if (heading) {
            flushSection();
            const title = heading[1].toLowerCase();
            capturing = SUPABASE_SECTION_KEYWORDS.some((kw) => title.includes(kw));
            if (capturing) sectionLines.push(line);
            continue;
        }
        if (capturing) {
            if (/^##\s+/.test(line)) {
                flushSection();
                const title = line.replace(/^##\s+/, '').toLowerCase();
                capturing = SUPABASE_SECTION_KEYWORDS.some((kw) => title.includes(kw));
                if (capturing) sectionLines.push(line);
            } else {
                sectionLines.push(line);
            }
        }
    }
    flushSection();

    const combined = [...new Set(parts)].join('\n\n---\n\n').trim();
    if (!combined) return null;
    if (combined.length <= MAX_SUPABASE_PLAN_EXCERPT_CHARS) return combined;
    return `${combined.slice(0, MAX_SUPABASE_PLAN_EXCERPT_CHARS)}\n\n[Supabase plan excerpt truncated]`;
}

const smartTruncatePlanBody = (text: string, maxChars: number): string => {
    if (text.length <= maxChars) return text;
    const marker = '\n\n[...plan middle truncated — Supabase backend details preserved separately...]\n\n';
    const headSize = Math.floor((maxChars - marker.length) * 0.45);
    const tailSize = maxChars - marker.length - headSize;
    return `${text.slice(0, headSize)}${marker}${text.slice(-tailSize)}`;
};

export type NormalizedPlanContext = {
    planContext: string;
    supabaseExcerpt: string | null;
};

export function normalizePlanContext(responseText: string): NormalizedPlanContext | null {
    const stripped = responseText.trim();
    if (stripped.length < PLAN_CONTEXT_MIN_CHARS) return null;

    const supabaseExcerpt = extractSupabasePlanExcerpt(stripped);
    const planContext = smartTruncatePlanBody(stripped, MAX_PLAN_CONTEXT_CHARS);

    return { planContext, supabaseExcerpt };
}
