import { Message } from '../models/Message';
import { Thread } from '../models/Thread';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { SYSTEM_PROMPT } from '../prompts/systemPrompt';
import { getModelConfig } from '../config/models';

dotenv.config();

export class ChatService {
    private openai: OpenAI | null = null;
    private anthropic: Anthropic | null = null;
    private gemini: GoogleGenerativeAI | null = null;

    private isValidKey(key: string | undefined): boolean {
        // Reject missing, empty, or placeholder keys like "sk-..."
        return !!key && key.length > 10 && !key.endsWith('...');
    }

    constructor() {
        if (this.isValidKey(process.env.OPENAI_API_KEY)) {
            this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            console.log('[ChatService] OpenAI client initialized');
        }
        if (this.isValidKey(process.env.ANTHROPIC_API_KEY)) {
            this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            console.log('[ChatService] Anthropic client initialized');
        }
        if (this.isValidKey(process.env.GEMINI_API_KEY)) {
            this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        }
    }

    async generateResponse(messageContent: string, threadId: string | null, userId: string, model: string = 'gpt-4o'): Promise<{ stream: AsyncGenerator<string>, threadId: string }> {
        // 1. Create Thread if not exists
        if (!threadId) {
            const title = messageContent.substring(0, 50) + (messageContent.length > 50 ? '...' : '');
            const thread = await Thread.create({
                userId,
                title,
            });
            threadId = thread._id.toString();
        }

        // 2. Save User Message
        await Message.create({
            content: messageContent,
            role: 'user',
            threadId
        });

        // 3. Update Thread timestamp
        await Thread.findByIdAndUpdate(threadId, { updatedAt: new Date() });

        // 4. Fetch Conversation History
        const messages = await Message.find({ threadId }).sort({ createdAt: 1 });

        // 5. Generate AI Response
        let stream;
        try {
            const modelConfig = getModelConfig(model);
            if (!modelConfig) {
                stream = this.mockStream(`Unknown model: ${model}. Using mock.`, threadId!);
            } else {
                switch (modelConfig.provider) {
                    case 'openai':
                        stream = await this.streamOpenAI(messages, modelConfig.apiModelId);
                        break;
                    case 'anthropic':
                        stream = await this.streamAnthropic(messages, modelConfig.apiModelId);
                        break;
                    case 'google':
                        stream = await this.streamGemini(messages, modelConfig.apiModelId);
                        break;
                    default:
                        stream = this.mockStream(`Unknown provider: ${modelConfig.provider}. Using mock.`, threadId!);
                }
            }
        } catch (error) {
            console.error(`Error with model ${model}:`, error);
            stream = this.mockStream(`Error with ${model}: ${error instanceof Error ? error.message : 'Unknown error'}. Falling back to mock.`, threadId!);
        }

        return { stream: this.saveStreamToDb(stream, threadId!), threadId: threadId! };
    }

    private async *saveStreamToDb(stream: AsyncGenerator<string>, threadId: string) {
        let fullResponse = '';
        for await (const chunk of stream) {
            fullResponse += chunk;
            yield chunk;
        }

        await Message.create({
            content: fullResponse.trim(),
            role: 'assistant',
            threadId
        });
    }

    private async *streamOpenAI(messages: any[], apiModelId: string) {
        if (!this.openai) throw new Error('OpenAI API Key not configured');

        const formattedMessages = messages.map(m => ({
            role: m.role,
            content: m.content
        }));

        const stream = await this.openai.chat.completions.create({
            model: apiModelId,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                ...formattedMessages
            ],
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) yield content;
        }
    }

    private async *streamAnthropic(messages: any[], apiModelId: string) {
        if (!this.anthropic) throw new Error('Anthropic API Key not configured');

        const formattedMessages = messages.map(m => ({
            role: m.role,
            content: m.content
        }));

        const stream = await this.anthropic.messages.create({
            model: apiModelId,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            messages: formattedMessages,
            stream: true,
        });

        for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                yield chunk.delta.text;
            }
        }
    }

    private async *streamGemini(messages: any[], apiModelId: string) {
        if (!this.gemini) throw new Error('Gemini API Key not configured');
        const model = this.gemini.getGenerativeModel({
            model: apiModelId,
            systemInstruction: SYSTEM_PROMPT
        });

        // Gemini history format (exclude last message which is the new user prompt)
        const history = messages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        const chat = model.startChat({
            history: history
        });

        const lastMessage = messages[messages.length - 1];
        const result = await chat.sendMessageStream(lastMessage.content);

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            yield chunkText;
        }
    }

    private async *mockStream(message: string, threadId: string) {
        const responseText = `(Mock Response) You said: ${message}. Using mock because API failed or not selected.`;
        const chunks = responseText.split(' ');

        for (const chunk of chunks) {
            const token = chunk + ' ';
            yield token;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    async getUserThreads(userId: string) {
        return Thread.find({ userId }).sort({ updatedAt: -1 });
    }

    async getThreadMessages(threadId: string, userId: string) {
        const thread = await Thread.findOne({ _id: threadId, userId });
        if (!thread) {
            throw new Error('Thread not found or unauthorized');
        }
        return Message.find({ threadId }).sort({ createdAt: 1 });
    }
}
