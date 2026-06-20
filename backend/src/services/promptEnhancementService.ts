import Anthropic from '@anthropic-ai/sdk';
import { log, errorFields } from '../lib/logger';

export const PROMPT_ENHANCEMENT_MODEL_ID = 'claude-haiku-4.5';
export const PROMPT_ENHANCEMENT_API_MODEL = 'claude-haiku-4-5';

export type PromptEnhancementMode = 'plan' | 'build';

const META_RESPONSE_PATTERNS = [
    /\bI need (?:the )?original prompt\b/i,
    /\b(?:please|could you) (?:paste|share|provide|send)(?: me)?(?: the| your)? prompt\b/i,
    /\bshare what you(?:'d| would) like to build\b/i,
    /\b(?:paste|share) your prompt\b/i,
    /\bwaiting for (?:your|the) prompt\b/i,
    /\bonce you (?:do|paste|share)\b/i,
];

export function buildEnhancementSystemPrompt(mode: PromptEnhancementMode, strict = false): string {
    const modeHint = mode === 'plan'
        ? 'The user will use this in PLAN mode — optimize for a clear product spec and implementation outline, not code.'
        : 'The user will use this in BUILD mode — optimize for actionable build instructions an AI coder can execute (React + Vite + TypeScript + Tailwind).';

    const strictBlock = strict
        ? `
CRITICAL: The user's prompt is already provided below the instruction. Never ask for it again.
Never respond with questions, clarifications, or instructions to paste a prompt.
If the prompt is short, infer reasonable defaults and expand it — do not refuse.`
        : `
The user's prompt is always provided in the user message. Never ask them to paste, share, or provide the prompt again.`;

    return `You rewrite user prompts for NextGen, an AI app builder that generates full-stack web apps in a browser sandbox.

${modeHint}
${strictBlock}

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
- Never ask questions or tell the user what you will do — just output the rewritten prompt.
- Target roughly 80–400 words unless the original prompt is already long and detailed.`.trim();
}

export function buildEnhancementUserMessage(prompt: string, options?: { strict?: boolean }): string {
    const trimmed = prompt.trim();
    if (options?.strict) {
        return [
            'Rewrite the prompt between the markers. Output ONLY the rewritten prompt — no questions, no preamble.',
            '',
            '--- PROMPT START ---',
            trimmed,
            '--- PROMPT END ---',
        ].join('\n');
    }

    return [
        'Rewrite this app-builder prompt. The text below IS the full prompt — do not ask for more input.',
        '',
        trimmed,
    ].join('\n');
}

export function isMetaEnhancementResponse(text: string): boolean {
    const normalized = text.trim();
    if (!normalized) return true;
    return META_RESPONSE_PATTERNS.some((pattern) => pattern.test(normalized));
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
        /^I need the original prompt[^.]*\.?\s*/i,
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

    private async callModel(
        mode: PromptEnhancementMode,
        userMessage: string,
        temperature: number,
        strict: boolean,
    ): Promise<string> {
        if (!this.anthropic) {
            throw new Error('Anthropic API key is not configured');
        }

        const response = await this.anthropic.messages.create({
            model: PROMPT_ENHANCEMENT_API_MODEL,
            max_tokens: 2048,
            temperature,
            system: buildEnhancementSystemPrompt(mode, strict),
            messages: [{ role: 'user', content: userMessage }],
        });

        const textBlock = response.content.find((block) => block.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
            throw new Error('Model returned an empty enhancement');
        }

        return normalizeEnhancedPrompt(textBlock.text);
    }

    async enhance(prompt: string, mode: PromptEnhancementMode): Promise<string> {
        const trimmed = prompt.trim();
        if (!trimmed) {
            throw new Error('Prompt is required');
        }

        let enhanced = await this.callModel(
            mode,
            buildEnhancementUserMessage(trimmed),
            0.4,
            false,
        );

        if (!enhanced || isMetaEnhancementResponse(enhanced)) {
            log.warn('prompt_enhancement.meta_response_retry', {
                mode,
                inputLength: trimmed.length,
            });
            enhanced = await this.callModel(
                mode,
                buildEnhancementUserMessage(trimmed, { strict: true }),
                0.2,
                true,
            );
        }

        if (!enhanced) {
            throw new Error('Model returned an empty enhancement');
        }

        if (isMetaEnhancementResponse(enhanced)) {
            throw new Error('Enhancement did not produce a valid prompt. Try again with a clearer app idea.');
        }

        log.info('prompt_enhancement.completed', {
            mode,
            model: PROMPT_ENHANCEMENT_MODEL_ID,
            inputLength: trimmed.length,
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
