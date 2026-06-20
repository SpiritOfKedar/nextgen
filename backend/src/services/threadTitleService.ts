import Anthropic from '@anthropic-ai/sdk';
import { log, errorFields } from '../lib/logger';
import * as threadsRepo from '../repositories/threads';
import { PROMPT_ENHANCEMENT_API_MODEL } from './promptEnhancementService';

export const THREAD_TITLE_MAX_LENGTH = 60;
export const THREAD_TITLE_FALLBACK = 'New project';

const TITLE_SYSTEM_PROMPT = `You name projects in NextGen, an AI app builder.

Given the user's first message, output a short project title:
- 3–6 words, title case
- Describes the app/product (e.g. "Flipkart Store Clone", "Team Todo Board")
- Do NOT paste or truncate the user's prompt
- No quotes, no trailing punctuation, no markdown
- Return ONLY the title text`;

export function fallbackThreadTitle(prompt: string): string {
    const cleaned = prompt.trim().replace(/\s+/g, ' ');
    if (!cleaned) return THREAD_TITLE_FALLBACK;
    if (cleaned.length <= THREAD_TITLE_MAX_LENGTH) return cleaned;
    return `${cleaned.slice(0, THREAD_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

export function normalizeThreadTitle(raw: string): string {
    let text = raw.trim();
    if (!text) return THREAD_TITLE_FALLBACK;

    if (
        (text.startsWith('"') && text.endsWith('"'))
        || (text.startsWith("'") && text.endsWith("'"))
        || (text.startsWith('“') && text.endsWith('”'))
    ) {
        text = text.slice(1, -1).trim();
    }

    const fenceMatch = text.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenceMatch) {
        text = fenceMatch[1].trim();
    }

    text = text
        .replace(/^title:?\s*/i, '')
        .replace(/^project:?\s*/i, '')
        .replace(/[.!?]+$/g, '')
        .trim();

    if (text.length > THREAD_TITLE_MAX_LENGTH) {
        text = `${text.slice(0, THREAD_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
    }

    return text || THREAD_TITLE_FALLBACK;
}

export class ThreadTitleService {
    private anthropic: Anthropic | null = null;

    constructor() {
        const key = process.env.ANTHROPIC_API_KEY;
        if (key && key.length > 10 && !key.endsWith('...')) {
            this.anthropic = new Anthropic({ apiKey: key });
        }
    }

    async generate(prompt: string, mode: 'plan' | 'build'): Promise<string> {
        const trimmed = prompt.trim();
        if (!trimmed) return THREAD_TITLE_FALLBACK;

        if (!this.anthropic) {
            return fallbackThreadTitle(trimmed);
        }

        const excerpt = trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
        const response = await this.anthropic.messages.create({
            model: PROMPT_ENHANCEMENT_API_MODEL,
            max_tokens: 32,
            temperature: 0.3,
            system: TITLE_SYSTEM_PROMPT,
            messages: [{
                role: 'user',
                content: `Mode: ${mode}\n\nUser message:\n${excerpt}`,
            }],
        });

        const textBlock = response.content.find((block) => block.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
            throw new Error('Model returned an empty title');
        }

        const title = normalizeThreadTitle(textBlock.text);
        if (!title || title.length < 2) {
            throw new Error('Model returned an invalid title');
        }

        return title;
    }
}

export async function updateThreadTitleFromPrompt(
    service: ThreadTitleService,
    threadId: string,
    prompt: string,
    mode: 'plan' | 'build',
): Promise<void> {
    try {
        const title = await service.generate(prompt, mode);
        await threadsRepo.updateTitle(threadId, title);
        log.info('thread_title.updated', {
            threadId,
            mode,
            titleLength: title.length,
        });
    } catch (error) {
        log.warn('thread_title.generation_failed', {
            threadId,
            mode,
            ...errorFields(error),
        });
    }
}
