import Anthropic from '@anthropic-ai/sdk';
import { log, errorFields } from '../lib/logger';

export const PROMPT_ENHANCEMENT_MODEL_ID = 'claude-haiku-4.5';
export const PROMPT_ENHANCEMENT_API_MODEL = 'claude-haiku-4-5';

export type PromptEnhancementMode = 'plan' | 'build';

export function buildEnhancementSystemPrompt(mode: PromptEnhancementMode): string {
    const modeHint = mode === 'plan'
        ? 'The user will use this in PLAN mode — optimize for a clear product spec and implementation outline, not code.'
        : 'The user will use this in BUILD mode — optimize for actionable build instructions an AI coder can execute (React + Vite + TypeScript + Tailwind).';

    return `You rewrite user prompts for NextGen, an AI app builder that generates full-stack web apps in a browser sandbox.

${modeHint}

Your job:
- Preserve the user's core intent, constraints, and tone.
- Turn vague ideas into specific, well-scoped requests.
- Add helpful structure (features, UI, data model, interactions) only when the user left gaps — do not invent unrelated features.
- Keep the result as a single prompt the user would send — not a meta explanation.
- Use clear, direct language. Prefer short paragraphs or bullet lists when it improves clarity.
- Do not mention NextGen, Haiku, or that you enhanced the prompt.

Output rules:
- Return ONLY the enhanced prompt text.
- No markdown fences, no quotes around the whole answer, no preamble like "Here is...".
- Target roughly 80–400 words unless the original prompt is already long and detailed.`.trim();
}

export function normalizeEnhancedPrompt(raw: string): string {
    let text = raw.trim();
    if (!text) return '';

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

    const preamblePatterns = [
        /^here(?:'s| is) (?:the |your )?enhanced prompt:?\s*/i,
        /^enhanced prompt:?\s*/i,
    ];
    for (const pattern of preamblePatterns) {
        text = text.replace(pattern, '').trim();
    }

    return text;
}

export class PromptEnhancementService {
    private anthropic: Anthropic | null = null;

    constructor() {
        const key = process.env.ANTHROPIC_API_KEY;
        if (key && key.length > 10 && !key.endsWith('...')) {
            this.anthropic = new Anthropic({ apiKey: key });
        }
    }

    async enhance(prompt: string, mode: PromptEnhancementMode): Promise<string> {
        if (!this.anthropic) {
            throw new Error('Anthropic API key is not configured');
        }

        const response = await this.anthropic.messages.create({
            model: PROMPT_ENHANCEMENT_API_MODEL,
            max_tokens: 2048,
            temperature: 0.4,
            system: buildEnhancementSystemPrompt(mode),
            messages: [{ role: 'user', content: prompt }],
        });

        const textBlock = response.content.find((block) => block.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
            throw new Error('Model returned an empty enhancement');
        }

        const enhanced = normalizeEnhancedPrompt(textBlock.text);
        if (!enhanced) {
            throw new Error('Model returned an empty enhancement');
        }

        log.info('prompt_enhancement.completed', {
            mode,
            model: PROMPT_ENHANCEMENT_MODEL_ID,
            inputLength: prompt.length,
            outputLength: enhanced.length,
        });

        return enhanced;
    }
}

export async function enhanceUserPrompt(
    service: PromptEnhancementService,
    prompt: string,
    mode: PromptEnhancementMode,
): Promise<string> {
    try {
        return await service.enhance(prompt, mode);
    } catch (error) {
        log.error('prompt_enhancement.failed', {
            mode,
            model: PROMPT_ENHANCEMENT_MODEL_ID,
            ...errorFields(error),
        });
        throw error;
    }
}
