const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildEnhancementSystemPrompt,
    normalizeEnhancedPrompt,
    PROMPT_ENHANCEMENT_MODEL_ID,
    PROMPT_ENHANCEMENT_API_MODEL,
} = require('../dist/services/promptEnhancementService');

test('prompt enhancement always targets Haiku 4.5', () => {
    assert.equal(PROMPT_ENHANCEMENT_MODEL_ID, 'claude-haiku-4.5');
    assert.equal(PROMPT_ENHANCEMENT_API_MODEL, 'claude-haiku-4-5');
});

test('buildEnhancementSystemPrompt differs by mode', () => {
    const plan = buildEnhancementSystemPrompt('plan');
    const build = buildEnhancementSystemPrompt('build');
    assert.match(plan, /PLAN mode/i);
    assert.match(build, /BUILD mode/i);
    assert.doesNotMatch(plan, /BUILD mode — optimize for actionable build instructions/);
});

test('normalizeEnhancedPrompt strips fences and preamble', () => {
    assert.equal(
        normalizeEnhancedPrompt('```\nBuild a todo app with dark mode\n```'),
        'Build a todo app with dark mode',
    );
    assert.equal(
        normalizeEnhancedPrompt('Here is the enhanced prompt:\n\nBuild a CRM dashboard'),
        'Build a CRM dashboard',
    );
    assert.equal(
        normalizeEnhancedPrompt('"A weather app with geolocation"'),
        'A weather app with geolocation',
    );
});
