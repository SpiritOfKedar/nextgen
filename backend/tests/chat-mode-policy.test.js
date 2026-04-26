const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeMode,
    resolveModelForMode,
    buildEnhancedSystemPrompt,
    normalizePlanContext,
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
    const big = `${'A'.repeat(200)}${'B'.repeat(20000)}`;
    const normalized = normalizePlanContext(big);
    assert.ok(normalized);
    assert.ok(normalized.length <= 12000);
});
