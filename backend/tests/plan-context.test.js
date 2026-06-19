const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractSupabasePlanExcerpt,
    normalizePlanContext,
    MAX_PLAN_CONTEXT_CHARS,
} = require('../dist/lib/planContext');

test('extractSupabasePlanExcerpt pulls SQL blocks and schema sections', () => {
    const text = `
## Executive summary
Build an app.

## Database schema & migrations
create table public.posts (id uuid primary key);

\`\`\`sql
create table public.comments (id uuid primary key);
alter table public.comments enable row level security;
\`\`\`
`;
    const excerpt = extractSupabasePlanExcerpt(text);
    assert.ok(excerpt);
    assert.match(excerpt, /create table public\.comments/i);
    assert.match(excerpt, /Database schema/i);
});

test('normalizePlanContext preserves supabase excerpt separately', () => {
    const body = '## Executive summary\n' + 'A'.repeat(500);
    const sql = '```sql\ncreate table public.todos (id uuid primary key);\n```';
    const normalized = normalizePlanContext(`${body}\n\n## Data model\n${sql}`);
    assert.ok(normalized);
    assert.ok(normalized.planContext.length <= MAX_PLAN_CONTEXT_CHARS);
    assert.ok(normalized.supabaseExcerpt);
    assert.match(normalized.supabaseExcerpt, /create table public\.todos/i);
});
