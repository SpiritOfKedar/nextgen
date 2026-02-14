import { Message } from '../models/Message';
import { Thread } from '../models/Thread';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { SYSTEM_PROMPT } from '../prompts/systemPrompt';
import { getModelConfig } from '../config/models';

dotenv.config();

// ── Helpers to extract bolt protocol actions from raw AI text ──

interface ExtractedFile {
    filePath: string;
    content: string;
}

/**
 * Extract all <boltAction type="file" filePath="...">...</boltAction> from raw text.
 */
function extractFilesFromRaw(raw: string): ExtractedFile[] {
    const files: ExtractedFile[] = [];
    // Handles attributes in either order
    const regex = /<boltAction\s+[^>]*?type="file"[^>]*?filePath="([^"]+)"[^>]*>([\s\S]*?)<\/boltAction>/g;
    let m;
    while ((m = regex.exec(raw)) !== null) {
        files.push({ filePath: m[1], content: m[2] });
    }
    // Reverse attribute order
    const regex2 = /<boltAction\s+[^>]*?filePath="([^"]+)"[^>]*?type="file"[^>]*>([\s\S]*?)<\/boltAction>/g;
    while ((m = regex2.exec(raw)) !== null) {
        if (!files.some(f => f.filePath === m![1])) {
            files.push({ filePath: m[1], content: m[2] });
        }
    }
    return files;
}

/**
 * Extract shell commands from raw text.
 */
function extractShellCommands(raw: string): string[] {
    const cmds: string[] = [];
    const regex = /<boltAction\s+[^>]*?type="shell"[^>]*>([\s\S]*?)<\/boltAction>/g;
    let m;
    while ((m = regex.exec(raw)) !== null) {
        cmds.push(m[1].trim());
    }
    return cmds;
}

/**
 * Strip bolt XML tags from raw content for display-friendly text.
 */
function stripBoltTags(raw: string): string {
    return raw
        .replace(/<boltAction[^>]*>[\s\S]*?<\/boltAction>/g, '')
        .replace(/<boltArtifact[^>]*>/g, '')
        .replace(/<\/boltArtifact>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim() || 'Generated code.';
}

// Built-in Node/browser modules and local paths — never add these to package.json
const BUILTIN_MODULES = new Set([
    'react', 'react-dom', 'react/jsx-runtime',
    'fs', 'path', 'os', 'url', 'util', 'crypto', 'stream', 'events', 'http', 'https',
    'child_process', 'assert', 'buffer', 'querystring', 'zlib', 'net', 'tls',
]);

/**
 * Scan all generated source files for import statements and compare against
 * the package.json dependencies. If any third-party packages are imported but
 * not listed, patch the package.json to include them.
 */
function patchMissingDeps(files: ExtractedFile[]): ExtractedFile[] {
    const pkgFile = files.find(f => f.filePath === 'package.json');
    if (!pkgFile) return files;

    let pkg: any;
    try { pkg = JSON.parse(pkgFile.content); } catch { return files; }

    const allDeps = new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
    ]);

    // Scan every .ts/.tsx/.js/.jsx file for imports
    const importRegex = /(?:import\s+[\s\S]*?from\s+['"]([^'"./][^'"]*?)['"]|require\s*\(\s*['"]([^'"./][^'"]*?)['"]\s*\))/g;
    const missingPackages = new Set<string>();

    for (const f of files) {
        if (!/\.(tsx?|jsx?|mts|cts)$/.test(f.filePath)) continue;
        let match;
        // Reset lastIndex for each file
        importRegex.lastIndex = 0;
        const content = f.content;
        while ((match = importRegex.exec(content)) !== null) {
            const raw = match[1] || match[2];
            if (!raw) continue;
            // Get the package name (handle scoped packages like @foo/bar)
            const pkgName = raw.startsWith('@')
                ? raw.split('/').slice(0, 2).join('/')
                : raw.split('/')[0];
            if (!allDeps.has(pkgName) && !BUILTIN_MODULES.has(pkgName)) {
                missingPackages.add(pkgName);
            }
        }
    }

    if (missingPackages.size === 0) return files;

    console.log('[ChatService] Auto-patching missing deps:', [...missingPackages]);

    // Add missing packages with "latest" version
    if (!pkg.dependencies) pkg.dependencies = {};
    for (const p of missingPackages) {
        pkg.dependencies[p] = 'latest';
    }

    // Replace the package.json in the files list
    return files.map(f =>
        f.filePath === 'package.json'
            ? { ...f, content: JSON.stringify(pkg, null, 2) }
            : f
    );
}

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

        // Extract files and shell commands from the raw response
        const extractedFiles = extractFilesFromRaw(fullResponse);
        const shellCommands = extractShellCommands(fullResponse);
        const displayContent = stripBoltTags(fullResponse);

        // Save message with both raw and display content + extracted files
        await Message.create({
            content: displayContent,
            rawContent: fullResponse.trim(),
            role: 'assistant',
            threadId,
            files: extractedFiles,
            shellCommands,
        });

        // Update thread's consolidated file snapshot
        // (merge new files on top of existing ones — later files overwrite earlier ones)
        if (extractedFiles.length > 0) {
            const thread = await Thread.findById(threadId);
            if (thread) {
                const fileMap = new Map<string, string>();
                // Start with existing thread files
                for (const f of (thread.files || [])) {
                    fileMap.set(f.filePath, f.content);
                }
                // Overlay new files
                for (const f of extractedFiles) {
                    fileMap.set(f.filePath, f.content);
                }
                const consolidatedFiles = Array.from(fileMap.entries()).map(([filePath, content]) => ({ filePath, content }));
                await Thread.findByIdAndUpdate(threadId, {
                    updatedAt: new Date(),
                    files: consolidatedFiles,
                });
            }
        }
    }

    /**
     * For conversation history, use rawContent for assistant messages (preserves bolt XML)
     * so the AI has full context of what code was previously generated.
     * Falls back to content for user messages or older messages without rawContent.
     */
    private getMessageContent(m: any): string {
        if (m.role === 'assistant' && m.rawContent) {
            return m.rawContent;
        }
        return m.content;
    }

    private async *streamOpenAI(messages: any[], apiModelId: string) {
        if (!this.openai) throw new Error('OpenAI API Key not configured');

        const formattedMessages = messages.map(m => ({
            role: m.role,
            content: this.getMessageContent(m)
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
            content: this.getMessageContent(m)
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

        // Import the safety settings types
        const { HarmCategory, HarmBlockThreshold } = await import('@google/generative-ai');

        const model = this.gemini.getGenerativeModel({
            model: apiModelId,
            systemInstruction: SYSTEM_PROMPT,
            generationConfig: {
                temperature: 0.7,
            },
            // Disable RECITATION blocking — this is the #1 cause of truncated code
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
        });

        // Gemini history format (exclude last message which is the new user prompt)
        const history = messages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: this.getMessageContent(m) }]
        }));

        const chat = model.startChat({
            history: history
        });

        const lastMessage = messages[messages.length - 1];
        const result = await chat.sendMessageStream(lastMessage.content);

        // Read individual stream chunks — each chunk.text() can throw if
        // that specific candidate was blocked (e.g. RECITATION).
        // We catch per-chunk so any content streamed before the block is preserved.
        for await (const chunk of result.stream) {
            try {
                const chunkText = chunk.text();
                yield chunkText;
            } catch (chunkError: any) {
                // Log but don't re-throw — we want to keep the partial content
                console.warn('[Gemini] Chunk blocked:', chunkError?.message || chunkError);
                // Yield a user-friendly notice so the frontend knows what happened
                yield '\n\n⚠️ _The AI response was partially blocked by the content filter (RECITATION). The generated code above has been saved._';
                break; // Stop reading further chunks
            }
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

    async getThreadFiles(threadId: string, userId: string) {
        const thread = await Thread.findOne({ _id: threadId, userId });
        if (!thread) {
            throw new Error('Thread not found or unauthorized');
        }
        return thread.files || [];
    }
}
