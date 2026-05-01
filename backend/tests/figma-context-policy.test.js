const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEnhancedSystemPrompt } = require('../dist/services/chatService');
const { parseFigmaUrl } = require('../dist/services/figmaDesignContextService');

test('parseFigmaUrl extracts file key and node id from design links', () => {
    const parsed = parseFigmaUrl('https://www.figma.com/design/abc123/My-File?node-id=12-34&t=token');

    assert.ok(parsed);
    assert.equal(parsed.fileKey, 'abc123');
    assert.equal(parsed.nodeId, '12:34');
});

test('buildEnhancedSystemPrompt injects Figma context with prompt-injection guardrails', () => {
    const prompt = buildEnhancedSystemPrompt(
        'BASE',
        [],
        'build',
        null,
        [{
            url: 'https://www.figma.com/design/abc123/My-File?node-id=12-34',
            fileKey: 'abc123',
            nodeId: '12:34',
            fetchedAt: '2026-05-01T00:00:00.000Z',
            warnings: [],
            toolContexts: [
                { toolName: 'get_design_context', text: 'Use a 2-column card layout with 16px spacing.' },
            ],
        }],
    );

    assert.match(prompt, /FIGMA DESIGN CONTEXT/);
    assert.match(prompt, /get_design_context/);
    assert.match(prompt, /untrusted content/);
    assert.match(prompt, /nodeId="12:34"/);
});
