import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { SYSTEM_PROMPT } from '../prompts/systemPrompt';
import { getModelConfig } from '../config/models';
import { withThreadLock, withTransaction } from '../config/db';
import * as threadsRepo from '../repositories/threads';
import * as messagesRepo from '../repositories/messages';
import * as chunksRepo from '../repositories/messageChunks';
import * as fileVersionsRepo from '../repositories/fileVersions';
import * as shellCommandsRepo from '../repositories/shellCommands';
import * as blobsRepo from '../repositories/blobs';
import { MessageRow } from '../repositories/types';
import { log, errorFields } from '../lib/logger';

dotenv.config();

export class ThreadAccessError extends Error {
    public readonly code: 'THREAD_NOT_FOUND_OR_UNAUTHORIZED';

    constructor(message = 'Thread not found or unauthorized') {
        super(message);
        this.name = 'ThreadAccessError';
        this.code = 'THREAD_NOT_FOUND_OR_UNAUTHORIZED';
    }
}

/** Optional correlation fields for chat streaming logs */
export type ChatLogContext = {
    requestId?: string;
    internalUserId?: string;
    model?: string;
};

type ChatAttachment = {
    kind: 'image' | 'text';
    name: string;
    mimeType: string;
    sizeBytes: number;
    dataBase64?: string;
    textContent?: string;
};

const MAX_ATTACHMENTS = 6;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 80_000;

const sanitizeAttachments = (raw: unknown): ChatAttachment[] => {
    if (!Array.isArray(raw)) return [];
    const out: ChatAttachment[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const kind = rec.kind === 'image' ? 'image' : rec.kind === 'text' ? 'text' : null;
        if (!kind) continue;
        const name = String(rec.name || 'attachment');
        const mimeType = String(rec.mimeType || (kind === 'image' ? 'image/png' : 'text/plain'));
        const sizeBytes = Number(rec.sizeBytes || 0);
        if (!Number.isFinite(sizeBytes) || sizeBytes < 0) continue;
        if (kind === 'image') {
            const dataBase64 = typeof rec.dataBase64 === 'string' ? rec.dataBase64 : '';
            if (!dataBase64) continue;
            if (sizeBytes > MAX_IMAGE_BYTES) continue;
            out.push({ kind, name, mimeType, sizeBytes, dataBase64 });
        } else {
            const textContent = typeof rec.textContent === 'string' ? rec.textContent : '';
            if (!textContent) continue;
            out.push({
                kind,
                name,
                mimeType,
                sizeBytes,
                textContent: textContent.slice(0, MAX_TEXT_ATTACHMENT_CHARS),
            });
        }
        if (out.length >= MAX_ATTACHMENTS) break;
    }
    return out;
};

const buildTextAttachmentContext = (attachments: ChatAttachment[]): string => {
    const textAttachments = attachments.filter((a) => a.kind === 'text' && a.textContent);
    if (textAttachments.length === 0) return '';
    const blocks = textAttachments.map((a) =>
        `[attached_text_file]\nname: ${a.name}\ntype: ${a.mimeType}\nsize: ${a.sizeBytes}\ncontent:\n${a.textContent}\n[/attached_text_file]`,
    );
    return `\n\nAttached text files for context:\n${blocks.join('\n\n')}`;
};

// ── Bolt protocol parsing helpers (unchanged from previous service) ──

interface ExtractedFile {
    filePath: string;
    content: string;
}

const extractFilesFromRaw = (raw: string): ExtractedFile[] => {
    const files: ExtractedFile[] = [];
    const regex = /<boltAction\s+[^>]*?type="file"[^>]*?filePath="([^"]+)"[^>]*>([\s\S]*?)<\/boltAction>/g;
    let m;
    while ((m = regex.exec(raw)) !== null) {
        files.push({ filePath: m[1], content: m[2] });
    }
    const regex2 = /<boltAction\s+[^>]*?filePath="([^"]+)"[^>]*?type="file"[^>]*>([\s\S]*?)<\/boltAction>/g;
    while ((m = regex2.exec(raw)) !== null) {
        if (!files.some((f) => f.filePath === m![1])) {
            files.push({ filePath: m[1], content: m[2] });
        }
    }
    return files;
};

const extractShellCommands = (raw: string): string[] => {
    const cmds: string[] = [];
    const regex = /<boltAction\s+[^>]*?type="shell"[^>]*>([\s\S]*?)<\/boltAction>/g;
    let m;
    while ((m = regex.exec(raw)) !== null) {
        cmds.push(m[1].trim());
    }
    return cmds;
};

const stripBoltTags = (raw: string): string =>
    raw
        .replace(/<boltAction[^>]*>[\s\S]*?<\/boltAction>/g, '')
        .replace(/<boltArtifact[^>]*>/g, '')
        .replace(/<\/boltArtifact>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim() || 'Generated code.';

// ── Auto-patch missing third-party deps in package.json (unchanged) ──

const BUILTIN_MODULES = new Set([
    'react', 'react-dom', 'react/jsx-runtime',
    'fs', 'path', 'os', 'url', 'util', 'crypto', 'stream', 'events', 'http', 'https',
    'child_process', 'assert', 'buffer', 'querystring', 'zlib', 'net', 'tls',
]);

const patchMissingDeps = (files: ExtractedFile[]): ExtractedFile[] => {
    const pkgFile = files.find((f) => f.filePath === 'package.json');
    if (!pkgFile) return files;

    let pkg: any;
    try { pkg = JSON.parse(pkgFile.content); } catch { return files; }

    const allDeps = new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
    ]);
    const importRegex = /(?:import\s+[\s\S]*?from\s+['"]([^'"./][^'"]*?)['"]|require\s*\(\s*['"]([^'"./][^'"]*?)['"]\s*\))/g;
    const missingPackages = new Set<string>();

    for (const f of files) {
        if (!/\.(tsx?|jsx?|mts|cts)$/.test(f.filePath)) continue;
        let match;
        importRegex.lastIndex = 0;
        const content = f.content;
        while ((match = importRegex.exec(content)) !== null) {
            const raw = match[1] || match[2];
            if (!raw) continue;
            const pkgName = raw.startsWith('@')
                ? raw.split('/').slice(0, 2).join('/')
                : raw.split('/')[0];
            if (!allDeps.has(pkgName) && !BUILTIN_MODULES.has(pkgName)) {
                missingPackages.add(pkgName);
            }
        }
    }

    if (missingPackages.size === 0) return files;
    if (!pkg.dependencies) pkg.dependencies = {};
    for (const p of missingPackages) pkg.dependencies[p] = 'latest';
    return files.map((f) =>
        f.filePath === 'package.json'
            ? { ...f, content: JSON.stringify(pkg, null, 2) }
            : f,
    );
};

// ── Streaming chunk flusher: batches deltas to message_chunks ──

const FLUSH_INTERVAL_MS = 250;
const FLUSH_BYTE_THRESHOLD = 2048;

class ChunkFlusher {
    private buffer: string[] = [];
    private bufferedBytes = 0;
    private nextIdx = 0;
    private timer: NodeJS.Timeout | null = null;
    private inFlight: Promise<void> = Promise.resolve();

    constructor(private readonly messageId: string) {}

    push(delta: string): void {
        if (!delta) return;
        this.buffer.push(delta);
        this.bufferedBytes += Buffer.byteLength(delta, 'utf8');
        if (this.bufferedBytes >= FLUSH_BYTE_THRESHOLD) {
            this.flushNow();
        } else if (!this.timer) {
            this.timer = setTimeout(() => this.flushNow(), FLUSH_INTERVAL_MS);
        }
    }

    private flushNow(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.buffer.length === 0) return;
        const deltas = this.buffer;
        const startIdx = this.nextIdx;
        this.nextIdx += deltas.length;
        this.buffer = [];
        this.bufferedBytes = 0;
        // Chain inserts so they always commit in order.
        this.inFlight = this.inFlight.then(() =>
            chunksRepo.insertBatch(this.messageId, startIdx, deltas).catch((err) => {
                log.error('chat.chunk_flush_failed', {
                    messageId: this.messageId,
                    startIdx,
                    deltaCount: deltas.length,
                    ...errorFields(err),
                });
            }),
        );
    }

    async flushAndWait(): Promise<void> {
        this.flushNow();
        await this.inFlight;
    }
}

export class ChatService {
    private openai: OpenAI | null = null;
    private anthropic: Anthropic | null = null;
    private gemini: GoogleGenerativeAI | null = null;

    private isValidKey(key: string | undefined): boolean {
        return !!key && key.length > 10 && !key.endsWith('...');
    }

    constructor() {
        if (this.isValidKey(process.env.OPENAI_API_KEY)) {
            this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        }
        if (this.isValidKey(process.env.ANTHROPIC_API_KEY)) {
            this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        }
        if (this.isValidKey(process.env.GEMINI_API_KEY)) {
            this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        }
    }

    /**
     * Main entry point. Returns a stream that the controller pipes to the
     * client. The stream:
     *   1. Emits AI text deltas as they arrive.
     *   2. Persists each delta to message_chunks (batched flushes).
     *   3. On end, transactionally finalizes the assistant message and
     *      appends file_versions + shell_commands.
     *   4. On error/abort, marks the assistant message accordingly.
     */
    async generateResponse(
        messageContent: string,
        threadIdParam: string | null,
        userId: string,
        model: string = 'gpt-4o',
        rawAttachments: unknown[] = [],
        logContext: ChatLogContext = {},
    ): Promise<{ stream: AsyncGenerator<string>; threadId: string }> {
        const attachments = sanitizeAttachments(rawAttachments);
        // 1. Resolve / create thread (outside the per-thread lock since a brand
        //    new thread can't have concurrent traffic yet).
        let threadId = threadIdParam;
        if (!threadId) {
            const title = messageContent.substring(0, 50) + (messageContent.length > 50 ? '...' : '');
            const thread = await threadsRepo.create(userId, title);
            threadId = thread.id;
        }

        // 2. Inside the per-thread advisory lock: allocate seq for both the
        //    user msg and the assistant placeholder, then commit so the lock
        //    is released before the AI call (which can take many seconds).
        const { assistantMessageId } = await withThreadLock(threadId, async (tx) => {
            const userSeq = await messagesRepo.nextSeq(threadId!, tx);
            await messagesRepo.insert(
                {
                    threadId: threadId!,
                    userId,
                    role: 'user',
                    seq: userSeq,
                    content: messageContent,
                    status: 'complete',
                },
                tx,
            );
            const assistantSeq = userSeq + 1;
            const assistant = await messagesRepo.insert(
                {
                    threadId: threadId!,
                    userId,
                    role: 'assistant',
                    seq: assistantSeq,
                    model,
                    status: 'streaming',
                },
                tx,
            );
            await threadsRepo.touch(threadId!, tx);
            return { assistantMessageId: assistant.id };
        });

        // 3. Build context: current snapshot + recent message tail.
        const snapshotRows = await fileVersionsRepo.currentSnapshot(threadId);
        const blobMap = await blobsRepo.getBlobs(snapshotRows.map((r) => r.current_blob_sha256));
        const fileSnapshot = snapshotRows.map((r) => ({
            filePath: r.file_path,
            content: blobMap.get(r.current_blob_sha256) ?? '',
        }));

        let enhancedSystemPrompt = SYSTEM_PROMPT;
        if (fileSnapshot.length > 0) {
            enhancedSystemPrompt += '\n\n--- CURRENT PROJECT FILES ---\n';
            enhancedSystemPrompt += 'Below is the current state of ALL files in the user\'s project. ';
            enhancedSystemPrompt += 'When the user asks for modifications, update ONLY the changed files (do not re-emit unchanged files).\n';
            for (const f of fileSnapshot) {
                enhancedSystemPrompt += `\n--- ${f.filePath} ---\n${f.content}\n`;
            }
            enhancedSystemPrompt += '\n--- END OF PROJECT FILES ---\n';
        }

        const recentRows = await messagesRepo.recentForThread(threadId, 10);
        const messages = recentRows.map((m) => ({
            role: m.role,
            content: m.content || '(no content)',
        }));

        log.info('chat.context_built', {
            requestId: logContext.requestId,
            internalUserId: logContext.internalUserId ?? userId,
            threadId,
            model,
            snapshotFileCount: fileSnapshot.length,
            recentMessageCount: messages.length,
            attachmentCount: attachments.length,
            imageAttachmentCount: attachments.filter((a) => a.kind === 'image').length,
            assistantMessageId,
        });

        // 4. Provider stream selection.
        let providerStream: AsyncGenerator<string>;
        try {
            const modelConfig = getModelConfig(model);
            if (!modelConfig) {
                providerStream = this.mockStream(`Unknown model: ${model}. Using mock.`);
            } else {
                switch (modelConfig.provider) {
                    case 'openai':
                        providerStream = this.streamOpenAI(messages, attachments, modelConfig.apiModelId, enhancedSystemPrompt);
                        break;
                    case 'anthropic':
                        providerStream = this.streamAnthropic(messages, attachments, modelConfig.apiModelId, enhancedSystemPrompt);
                        break;
                    case 'google':
                        providerStream = this.streamGemini(messages, attachments, modelConfig.apiModelId, enhancedSystemPrompt);
                        break;
                    default:
                        providerStream = this.mockStream(`Unknown provider: ${modelConfig.provider}. Using mock.`);
                }
            }
        } catch (error) {
            log.error('chat.provider_selection_failed', {
                requestId: logContext.requestId,
                threadId,
                model,
                ...errorFields(error),
            });
            providerStream = this.mockStream(`Error with ${model}: ${error instanceof Error ? error.message : 'Unknown error'}. Falling back to mock.`);
        }

        return {
            stream: this.persistAndYield(providerStream, threadId, assistantMessageId, {
                requestId: logContext.requestId,
                internalUserId: userId,
                model,
            }),
            threadId,
        };
    }

    /**
     * Wraps the provider stream:
     *   - mirror each chunk to message_chunks (batched flush)
     *   - yield each chunk to the HTTP response
     *   - on end, finalize the assistant message + persist files transactionally
     *   - on error, mark the message as 'error' but keep what we got
     */
    private async *persistAndYield(
        stream: AsyncGenerator<string>,
        threadId: string,
        assistantMessageId: string,
        ctx: ChatLogContext = {},
    ): AsyncGenerator<string> {
        const flusher = new ChunkFlusher(assistantMessageId);
        let fullResponse = '';

        try {
            for await (const chunk of stream) {
                fullResponse += chunk;
                flusher.push(chunk);
                yield chunk;
            }
        } catch (err) {
            log.error('chat.provider_stream_aborted', {
                requestId: ctx.requestId,
                internalUserId: ctx.internalUserId,
                threadId,
                assistantMessageId,
                model: ctx.model,
                responseChars: fullResponse.length,
                ...errorFields(err),
            });
            await flusher.flushAndWait();
            await messagesRepo.markAborted(
                assistantMessageId,
                err instanceof Error ? err.message : String(err),
            );
            yield `\n\n[error: stream interrupted — partial response saved]`;
            return;
        }

        await flusher.flushAndWait();

        // Finalize: parse, hash + upload blobs, version files, save shell cmds,
        // mark message complete — all in one transaction.
        try {
            const extractedFiles = patchMissingDeps(extractFilesFromRaw(fullResponse));
            const shellCommands = extractShellCommands(fullResponse);
            const displayContent = stripBoltTags(fullResponse);

            // Hash + upload blobs OUTSIDE the transaction (Storage upload may
            // be slow; code_blobs row insert inside the upload is idempotent).
            const fileShas: { filePath: string; sha: string }[] = [];
            for (const f of extractedFiles) {
                const sha = await blobsRepo.putBlob(f.content);
                fileShas.push({ filePath: f.filePath, sha });
            }

            await withThreadLock(threadId, async (tx) => {
                await messagesRepo.finalize(
                    {
                        id: assistantMessageId,
                        content: displayContent,
                        rawContent: fullResponse.trim(),
                        status: 'complete',
                    },
                    tx,
                );
                for (const { filePath, sha } of fileShas) {
                    await fileVersionsRepo.insert(
                        {
                            threadId,
                            messageId: assistantMessageId,
                            filePath,
                            blobSha256: sha,
                        },
                        tx,
                    );
                }
                if (shellCommands.length > 0) {
                    await shellCommandsRepo.insertBatch(threadId, assistantMessageId, shellCommands, tx);
                }
                await threadsRepo.touch(threadId, tx);
            });
            log.info('chat.message_finalized', {
                requestId: ctx.requestId,
                internalUserId: ctx.internalUserId,
                threadId,
                assistantMessageId,
                model: ctx.model,
                fileCount: extractedFiles.length,
                shellCommandCount: shellCommands.length,
                responseChars: fullResponse.length,
            });
        } catch (err) {
            log.error('chat.finalize_failed', {
                requestId: ctx.requestId,
                internalUserId: ctx.internalUserId,
                threadId,
                assistantMessageId,
                model: ctx.model,
                responseChars: fullResponse.length,
                ...errorFields(err),
            });
            try {
                await withTransaction(async (tx) => {
                    await messagesRepo.finalize(
                        {
                            id: assistantMessageId,
                            content: stripBoltTags(fullResponse),
                            rawContent: fullResponse.trim(),
                            status: 'error',
                            error: err instanceof Error ? err.message : String(err),
                        },
                        tx,
                    );
                });
            } catch (innerErr) {
                log.error('chat.finalize_error_mark_failed', {
                    requestId: ctx.requestId,
                    assistantMessageId,
                    ...errorFields(innerErr),
                });
            }
            // Tell the client so they know to retry.
            yield `\n\n[error: response not fully persisted]`;
        }
    }

    // ── Provider streams (unchanged behavior, just no DB I/O here) ──

    private async *streamOpenAI(
        messages: { role: string; content: string }[],
        attachments: ChatAttachment[],
        apiModelId: string,
        systemPrompt: string,
    ) {
        if (!this.openai) throw new Error('OpenAI API Key not configured');
        const textAttachmentContext = buildTextAttachmentContext(attachments);
        const imageAttachments = attachments.filter((a) => a.kind === 'image' && a.dataBase64);
        const preparedMessages = messages.map((m, idx) => {
            const isLast = idx === messages.length - 1;
            const isLastUser = isLast && m.role === 'user';
            if (!isLastUser || (imageAttachments.length === 0 && !textAttachmentContext)) {
                return { role: m.role, content: m.content };
            }
            const contentParts: any[] = [{ type: 'text', text: `${m.content}${textAttachmentContext}` }];
            for (const image of imageAttachments) {
                contentParts.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${image.mimeType};base64,${image.dataBase64}`,
                    },
                });
            }
            return { role: m.role, content: contentParts };
        });
        const stream = await this.openai.chat.completions.create({
            model: apiModelId,
            messages: [
                { role: 'system', content: systemPrompt },
                ...(preparedMessages as any),
            ],
            stream: true,
        });
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) yield content;
        }
    }

    private async *streamAnthropic(
        messages: { role: string; content: string }[],
        attachments: ChatAttachment[],
        apiModelId: string,
        systemPrompt: string,
    ) {
        if (!this.anthropic) throw new Error('Anthropic API Key not configured');
        const merged: { role: 'user' | 'assistant'; content: string }[] = [];
        for (const m of messages) {
            if (merged.length > 0 && merged[merged.length - 1].role === m.role) {
                merged[merged.length - 1].content += '\n\n' + m.content;
            } else {
                merged.push({ role: m.role as 'user' | 'assistant', content: m.content });
            }
        }
        if (merged.length > 0 && merged[0].role !== 'user') {
            merged.unshift({ role: 'user', content: '(conversation continued)' });
        }
        const textAttachmentContext = buildTextAttachmentContext(attachments);
        const imageAttachments = attachments.filter((a) => a.kind === 'image' && a.dataBase64);
        const anthropicMessages = merged.map((m, idx) => {
            const isLast = idx === merged.length - 1;
            const isLastUser = isLast && m.role === 'user';
            if (!isLastUser || (imageAttachments.length === 0 && !textAttachmentContext)) {
                return { role: m.role, content: m.content };
            }
            const content: any[] = [{ type: 'text', text: `${m.content}${textAttachmentContext}` }];
            for (const image of imageAttachments) {
                content.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: image.mimeType,
                        data: image.dataBase64,
                    },
                });
            }
            return { role: m.role, content };
        });
        const stream = await this.anthropic.messages.create({
            model: apiModelId,
            max_tokens: 8192,
            system: systemPrompt,
            messages: anthropicMessages as any,
            stream: true,
        });
        for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                yield chunk.delta.text;
            }
        }
    }

    private async *streamGemini(
        messages: { role: string; content: string }[],
        attachments: ChatAttachment[],
        apiModelId: string,
        systemPrompt: string,
    ) {
        if (!this.gemini) throw new Error('Gemini API Key not configured');
        const { HarmCategory, HarmBlockThreshold } = await import('@google/generative-ai');
        const model = this.gemini.getGenerativeModel({
            model: apiModelId,
            systemInstruction: systemPrompt,
            generationConfig: { temperature: 0.7 },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
        });
        const history = messages.slice(0, -1).map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));
        const chat = model.startChat({ history });
        const lastMessage = messages[messages.length - 1];
        const textAttachmentContext = buildTextAttachmentContext(attachments);
        const imageAttachments = attachments.filter((a) => a.kind === 'image' && a.dataBase64);
        const geminiParts: any[] = [{ text: `${lastMessage.content}${textAttachmentContext}` }];
        for (const image of imageAttachments) {
            geminiParts.push({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.dataBase64,
                },
            });
        }
        const result = await chat.sendMessageStream(geminiParts as any);
        for await (const chunk of result.stream) {
            try {
                yield chunk.text();
            } catch (chunkError: any) {
                log.warn('chat.gemini_chunk_blocked', {
                    detail: chunkError?.message || String(chunkError),
                });
                yield '\n\n⚠️ _The AI response was partially blocked by the content filter (RECITATION). The generated code above has been saved._';
                break;
            }
        }
    }

    private async *mockStream(message: string): AsyncGenerator<string> {
        const responseText = `(Mock Response) ${message}`;
        for (const word of responseText.split(' ')) {
            yield word + ' ';
            await new Promise((r) => setTimeout(r, 50));
        }
    }

    // ── Read APIs used by the controller ──

    async getUserThreads(userId: string) {
        const rows = await threadsRepo.listForUser(userId);
        return rows.map(this.mapThread);
    }

    async getThreadMessages(threadId: string, userId: string) {
        const thread = await threadsRepo.findByIdForUser(threadId, userId);
        if (!thread) throw new ThreadAccessError();
        const rows = await messagesRepo.listForThread(threadId);
        return Promise.all(rows.map((m) => this.mapMessage(m)));
    }

    async getThreadFiles(threadId: string, userId: string) {
        const thread = await threadsRepo.findByIdForUser(threadId, userId);
        if (!thread) throw new ThreadAccessError();
        const snap = await fileVersionsRepo.currentSnapshot(threadId);
        if (snap.length === 0) return [];
        const blobs = await blobsRepo.getBlobs(snap.map((s) => s.current_blob_sha256));
        return snap.map((s) => ({
            filePath: s.file_path,
            content: blobs.get(s.current_blob_sha256) ?? '',
        }));
    }

    async getThreadFilesDelta(threadId: string, userId: string, sinceSeq: number) {
        const thread = await threadsRepo.findByIdForUser(threadId, userId);
        if (!thread) throw new ThreadAccessError();

        const changes = await fileVersionsRepo.latestChangesSinceSeq(threadId, sinceSeq);
        const upserts = changes.filter((c) => !c.is_deletion);
        const deletedPaths = changes.filter((c) => c.is_deletion).map((c) => c.file_path);
        const blobs = await blobsRepo.getBlobs(upserts.map((c) => c.blob_sha256));

        const files = upserts.map((c) => ({
            filePath: c.file_path,
            content: blobs.get(c.blob_sha256) ?? '',
        }));

        const messages = await messagesRepo.listForThread(threadId);
        const lastSeq = messages.reduce((max, m) => Math.max(max, Number(m.seq) || 0), 0);

        return {
            isDelta: true,
            sinceSeq,
            lastSeq,
            files,
            deletedPaths,
        };
    }

    private mapThread(row: { id: string; title: string; created_at: string; updated_at: string }) {
        return {
            _id: row.id,
            id: row.id,
            title: row.title,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private async mapMessage(row: MessageRow) {
        // For an in-flight streaming message, hydrate live content from chunks
        // so a reconnecting client sees what's been generated so far.
        let content = row.content;
        if (row.status === 'streaming' && !content) {
            content = await chunksRepo.concatenate(row.id);
        }
        return {
            _id: row.id,
            id: row.id,
            threadId: row.thread_id,
            role: row.role,
            seq: Number(row.seq),
            content,
            rawContent: row.raw_content ?? '',
            status: row.status,
            model: row.model,
            createdAt: row.created_at,
        };
    }
}
