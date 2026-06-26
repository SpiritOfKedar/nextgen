export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'auto';

export interface ModelOption {
    id: string;
    label: string;
    description: string;
    provider: ModelProvider;
}

export const AUTO_MODEL_ID = 'auto';
export const DEFAULT_RECOVERY_MODEL = 'claude-haiku-4.5';

export const isGeminiModel = (modelId: string): boolean =>
    modelId.startsWith('gemini-');

/** Terminal recovery: honor explicit user selection; never default to Gemini. */
export const resolveRecoveryModel = (requestedModel?: string | null): string => {
    const model = requestedModel?.trim();
    if (model && model !== AUTO_MODEL_ID) {
        return model;
    }
    return DEFAULT_RECOVERY_MODEL;
};

export const MODELS: ModelOption[] = [
    {
        id: AUTO_MODEL_ID,
        label: 'Auto',
        description: 'Best model for the task',
        provider: 'auto',
    },
    {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Fast & Cheap',
        provider: 'google',
    },
    {
        id: 'gpt-4o-mini',
        label: 'GPT-4o Mini',
        description: 'Fast & Cheap',
        provider: 'openai',
    },
    {
        id: 'gpt-5.2',
        label: 'ChatGPT 5.2',
        description: 'Reasoning',
        provider: 'openai',
    },
    {
        id: 'codex-5.3',
        label: 'Codex 5.3',
        description: 'Agentic Coding',
        provider: 'openai',
    },
    {
        id: 'gemini-3-pro',
        label: 'Gemini 3 Pro',
        description: 'Multimodal',
        provider: 'google',
    },
    {
        id: 'claude-opus-4.5',
        label: 'Claude Opus 4.5',
        description: 'High Intelligence',
        provider: 'anthropic',
    },
    {
        id: 'claude-opus-4.6',
        label: 'Claude Opus 4.6',
        description: 'Experimental',
        provider: 'anthropic',
    },
    {
        id: 'claude-sonnet-4.5',
        label: 'Claude Sonnet 4.5',
        description: 'Balanced',
        provider: 'anthropic',
    },
    {
        id: 'claude-haiku-4.5',
        label: 'Claude Haiku 4.5',
        description: 'Fast',
        provider: 'anthropic',
    },
];

export const getModelById = (id: string): ModelOption | undefined =>
    MODELS.find((m) => m.id === id);

export const getProviderForModel = (id: string): ModelProvider =>
    getModelById(id)?.provider ?? 'anthropic';

export const isAutoModel = (id: string): boolean => id === AUTO_MODEL_ID;
