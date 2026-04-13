export interface AIModel {
    id: string;
    label: string;
    description?: string;
    provider: 'openai' | 'anthropic' | 'google';
    apiModelId: string; // The actual ID sent to the API
}

export const AVAILABLE_MODELS: AIModel[] = [
    {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        provider: 'google',
        apiModelId: 'gemini-3-flash-preview'
    },
    {
        id: 'gpt-4o-mini',
        label: 'GPT-4o Mini',
        provider: 'openai',
        apiModelId: 'gpt-4o-mini'
    },
    {
        id: 'gpt-5.2',
        label: 'ChatGPT 5.2',
        provider: 'openai',
        apiModelId: 'gpt-4o'
    },
    {
        id: 'gemini-3-pro',
        label: 'Gemini 3 Pro',
        provider: 'google',
        apiModelId: 'gemini-3-flash-preview'
    },
    {
        id: 'claude-opus-4.5',
        label: 'Claude Opus 4.5',
        provider: 'anthropic',
        apiModelId: 'claude-haiku-4-5'
    },
    {
        id: 'claude-opus-4.6',
        label: 'Claude Opus 4.6',
        provider: 'anthropic',
        apiModelId: 'claude-haiku-4-5'
    },
    {
        id: 'claude-sonnet-4.5',
        label: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        apiModelId: 'claude-haiku-4-5'
    },
    {
        id: 'claude-haiku-4.5',
        label: 'Claude Haiku 4.5',
        provider: 'anthropic',
        apiModelId: 'claude-haiku-4-5'
    }
];

export const getModelConfig = (modelId: string): AIModel | undefined => {
    return AVAILABLE_MODELS.find(m => m.id === modelId) ||
        AVAILABLE_MODELS.find(m => m.id === 'gemini-2.5-flash'); // Default to Gemini 2.5 Flash
};
