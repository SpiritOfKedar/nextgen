const test = require('node:test');
const assert = require('node:assert/strict');

const {
    fallbackThreadTitle,
    normalizeThreadTitle,
    THREAD_TITLE_FALLBACK,
    THREAD_TITLE_MAX_LENGTH,
} = require('../dist/services/threadTitleService');

test('fallbackThreadTitle truncates long prompts', () => {
    const long = 'build a comprehensive blog platform with markdown editor and comments section';
    const title = fallbackThreadTitle(long);
    assert.ok(title.length <= THREAD_TITLE_MAX_LENGTH);
    assert.match(title, /…$/);
});

test('normalizeThreadTitle strips quotes and labels', () => {
    assert.equal(normalizeThreadTitle('"Flipkart Store Clone"'), 'Flipkart Store Clone');
    assert.equal(normalizeThreadTitle('Title: Team Todo Board.'), 'Team Todo Board');
    assert.equal(normalizeThreadTitle('```\nReddit Social App\n```'), 'Reddit Social App');
});

test('normalizeThreadTitle falls back for empty output', () => {
    assert.equal(normalizeThreadTitle(''), THREAD_TITLE_FALLBACK);
    assert.equal(normalizeThreadTitle('   '), THREAD_TITLE_FALLBACK);
});
