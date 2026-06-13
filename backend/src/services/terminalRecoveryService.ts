import { ChatService, ThreadAccessError } from './chatService';
import * as threadsRepo from '../repositories/threads';
import { log } from '../lib/logger';

const RECOVERY_SYSTEM_PROMPT = `
You are a terminal recovery agent for a Vite + React + TypeScript WebContainer project.

Your job is to diagnose npm install, module resolution, and dev-server failures from terminal output and fix them by editing project files and running shell commands.

Rules:
- Preserve ALL packages the project needs. Do not remove dependencies unless they are clearly wrong duplicates.
- Prefer minimal fixes: patch package.json versions, fix import paths, add missing devDependencies, repair vite/tsconfig.
- You MUST emit fixes using bolt protocol only:
  <boltArtifact id="terminal-recovery" title="Terminal Recovery">
    <boltAction type="file" filePath="relative/path">file content</boltAction>
    <boltAction type="shell">npm install --legacy-peer-deps --prefer-offline</boltAction>
    <boltAction type="shell">npm run dev</boltAction>
  </boltArtifact>
- Shell actions: emit ONE command per <boltAction type="shell">. Never chain with &&, ;, or |.
- Emit separate shell actions for install and dev server (install first, then npm run dev).
- npm commands run in the project directory from context; do not cd unless package.json lives in a subdirectory.
- Include at least one shell action when dependencies or dev server need to run again.
- Use npm install with --legacy-peer-deps --prefer-offline --no-audit --no-fund.
- Do not emit markdown outside the artifact. Keep prose before the artifact to 2 sentences max.
`.trim();

export type TerminalRecoveryInput = {
    threadId: string;
    userId: string;
    terminalOutput: string;
    issueCode: string;
    issueMessage?: string;
    suggestedCommands?: string[];
    projectDir: string;
    model?: string;
    files: { filePath: string; content: string }[];
};

export class TerminalRecoveryService {
    private chatService = new ChatService();

    async generateRecoveryStream(input: TerminalRecoveryInput): Promise<AsyncGenerator<string>> {
        const thread = await threadsRepo.findByIdForUser(input.threadId, input.userId);
        if (!thread) throw new ThreadAccessError();

        const terminalTail = input.terminalOutput.slice(-12_000);
        const fileBlocks = input.files
            .slice(0, 12)
            .map((f) => `[file: ${f.filePath}]\n${f.content.slice(0, 8_000)}\n[/file]`)
            .join('\n\n');

        const userContent = [
            `Thread: ${input.threadId}`,
            `Project directory: ${input.projectDir}`,
            `Issue code: ${input.issueCode}`,
            input.issueMessage ? `Issue: ${input.issueMessage}` : '',
            input.suggestedCommands?.length
                ? `Suggested commands (hints only): ${input.suggestedCommands.join('; ')}`
                : '',
            '',
            '--- TERMINAL OUTPUT (tail) ---',
            terminalTail,
            '--- END TERMINAL ---',
            '',
            '--- PROJECT FILES ---',
            fileBlocks || '(no files provided)',
            '--- END FILES ---',
            '',
            'Diagnose the failure and emit bolt artifact fixes.',
        ].filter(Boolean).join('\n');

        log.info('terminal.recovery_start', {
            threadId: input.threadId,
            issueCode: input.issueCode,
            fileCount: input.files.length,
            terminalChars: terminalTail.length,
        });

        return this.chatService.streamRecoveryCompletion(
            RECOVERY_SYSTEM_PROMPT,
            userContent,
            input.model || 'gemini-2.5-flash',
        );
    }
}

export const terminalRecoveryService = new TerminalRecoveryService();
