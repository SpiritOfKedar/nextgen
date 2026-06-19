const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeMode,
    resolveModelForMode,
    resolveAutoModel,
    buildEnhancedSystemPrompt,
    normalizePlanContext,
    MAX_PLAN_CONTEXT_CHARS,
    AUTO_MODEL_ID,
} = require('../dist/services/chatService');

test('normalizeMode falls back to build for invalid mode', () => {
    assert.equal(normalizeMode('plan'), 'plan');
    assert.equal(normalizeMode('build'), 'build');
    assert.equal(normalizeMode('invalid'), 'build');
});

test('resolveModelForMode preserves requested model', () => {
    assert.equal(resolveModelForMode('gpt-4o-mini', 'build'), 'gpt-4o-mini');
    assert.equal(resolveModelForMode('gemini-2.5-flash', 'plan'), 'gemini-2.5-flash');
});

test('resolveAutoModel picks model by context', () => {
    assert.equal(resolveAutoModel({ mode: 'plan' }), 'gemini-2.5-flash');
    assert.equal(resolveAutoModel({ mode: 'build' }), 'gpt-4o-mini');
    assert.equal(resolveAutoModel({ mode: 'build', hasFigma: true }), 'gemini-3-pro');
    assert.equal(resolveAutoModel({ mode: 'build', messageLength: 3000 }), 'claude-sonnet-4.5');
});

test('resolveModelForMode resolves auto', () => {
    assert.equal(resolveModelForMode(AUTO_MODEL_ID, 'plan'), 'gemini-2.5-flash');
    assert.equal(
        resolveModelForMode(AUTO_MODEL_ID, 'build', { hasAttachments: true }),
        'gemini-3-pro',
    );
});

test('buildEnhancedSystemPrompt injects plan context only in build mode', () => {
    const promptWithPlan = buildEnhancedSystemPrompt(
        'BASE',
        [{ filePath: 'src/App.tsx', content: 'export default function App() {}' }],
        'build',
        'Saved plan context',
    );
    assert.match(promptWithPlan, /APPROVED PLAN CONTEXT/);
    assert.match(promptWithPlan, /CURRENT PROJECT FILES/);

    const planModePrompt = buildEnhancedSystemPrompt('BASE', [], 'plan', 'ignored');
    assert.doesNotMatch(planModePrompt, /APPROVED PLAN CONTEXT/);
    assert.match(planModePrompt, /PLAN MODE/);
});

test('normalizePlanContext rejects tiny plans and trims large content', () => {
    assert.equal(normalizePlanContext('short'), null);
    const big = `${'A'.repeat(200)}${'B'.repeat(30000)}`;
    const normalized = normalizePlanContext(big);
    assert.ok(normalized);
    assert.ok(normalized.planContext.length <= MAX_PLAN_CONTEXT_CHARS);
});

test('buildEnhancedSystemPrompt includes supabase plan excerpt in build mode', () => {
    const prompt = buildEnhancedSystemPrompt(
        'BASE',
        [],
        'build',
        'Main plan body',
        [],
        null,
        { projectUrl: 'https://x.supabase.co', projectRef: 'x', migrationsEnabled: true, schema: null, appliedMigrations: [] },
        null,
        'create table public.posts (id uuid primary key);',
    );
    assert.match(prompt, /APPROVED SUPABASE BACKEND PLAN/);
    assert.match(prompt, /create table public\.posts/i);
});
