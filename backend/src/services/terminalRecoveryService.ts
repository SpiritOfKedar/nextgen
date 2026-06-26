import { ThreadAccessError } from './chatService';
import { chatService } from '../controllers/chatController';
import * as threadsRepo from '../repositories/threads';
import { log } from '../lib/logger';
import { resolveRecoveryModel } from '../config/models';

const RECOVERY_SYSTEM_PROMPT = `
You are an expert debugger for Vite + React + TypeScript projects running inside WebContainer.

Your job is to **diagnose the root cause** from terminal output and **fix it with targeted, minimal edits**.
You are NOT a script that reruns npm install. Think like a senior engineer reading a stack trace.

## Diagnosis workflow (follow in order)
1. Read the error snippets and identify the **specific** failure: wrong import path, missing package.json entry, bad vite/tsconfig config, syntax error, CSS parse error, version conflict, wrong cwd, etc.
2. State your diagnosis in 1–2 sentences before the artifact (what broke and why).
3. Emit **minimal file fixes** that address the root cause — prefer patches over full file rewrites.
4. Only emit shell actions when a file edit alone cannot verify the fix.

## Platform behavior (important)
- The platform **automatically runs npm install** after your file edits when package.json changes.
- Do **NOT** emit \`npm install\`, \`npm ci\`, or \`npm i\` shell actions — they are stripped and waste time.
- Emit \`npm run dev\` only if the dev server needs restarting after config/source fixes.
- Do **NOT** emit \`cd\` unless package.json genuinely lives in a subdirectory AND the error proves the cwd is wrong.

## Fix strategies by error type

### PostCSS / CSS parse errors ("Unknown word", "[postcss]", "use strict")
This is almost always a **Tailwind v3 vs v4 mismatch**.
- Open \`src/index.css\`. Replace ALL of these v3 lines:
    @tailwind base;
    @tailwind components;
    @tailwind utilities;
  with a SINGLE v4 line as the FIRST line of the file:
    @import "tailwindcss";
- In \`vite.config.ts\`, ensure \`@tailwindcss/vite\` is imported and added to plugins[].
- **Delete** \`postcss.config.js\` / \`postcss.config.ts\` if it imports tailwindcss — Tailwind v4 uses the Vite plugin, NOT a PostCSS plugin. Emitting it with type="file" and empty content is NOT enough; use a shell action: \`rm postcss.config.js\` only if it exists and is causing the error.
- Do NOT add tailwindcss to postcss.config plugins — that is the v3 pattern and will break v4.

### Import resolution failures
- **Failed to resolve import "X" from "src/File.tsx"**: open src/File.tsx — fix typo/wrong path first; if X is an npm package, add it to package.json dependencies.
- **Cannot find module 'pkg'**: add pkg to package.json with a sensible version; check import spelling.

### TypeScript errors (error TS####:)
- Fix the specific source file and line referenced in the output.
- Do not disable strict mode or add @ts-ignore unless the type error is in generated/third-party code.
- If types are missing, add @types/* to devDependencies in package.json.

### Other common errors
- **Peer dependency / ERESOLVE**: adjust conflicting versions in package.json — do not reinstall blindly.
- **Missing vite / plugin**: add to devDependencies; align vite.config.ts imports with package.json.
- **ENOENT package.json**: write or restore package.json at the correct path — not cd hacks.
- **permission denied: vite / exit 126**: Patch package.json scripts: dev → node ./node_modules/vite/bin/vite.js, build → node ./node_modules/vite/bin/vite.js build.

## Output format — PATCHES PREFERRED

Use the **patch action** for small targeted edits to existing files (1–20 lines changed):
<boltArtifact id="terminal-recovery" title="Terminal Recovery">
  <boltAction type="patch" filePath="src/index.css">
<<<<<<< SEARCH
@tailwind base;
@tailwind components;
@tailwind utilities;
=======
@import "tailwindcss";
>>>>>>> REPLACE
  </boltAction>
  <boltAction type="shell">npm run dev</boltAction>
</boltArtifact>

Use the **file action** only when:
- The file does not exist yet (new file), OR
- More than ~40% of the file content changes, OR
- The file is small (< 20 lines) and a full rewrite is cleaner.

<boltArtifact id="terminal-recovery" title="Terminal Recovery">
  <boltAction type="file" filePath="relative/path">full corrected file content</boltAction>
  <boltAction type="shell">npm run dev</boltAction>
</boltArtifact>

Patch format rules:
- Each hunk: <<<<<<< SEARCH / exact text / ======= / replacement / >>>>>>> REPLACE
- The SEARCH text must match the file exactly (including whitespace/indentation).
- Multiple hunks in one patch action are applied in order.
- Prefer one patch action per file; multiple patch actions for the same file are also fine.

General rules:
- Shell: ONE command per <boltAction type="shell">. Never chain with &&, ;, or |.
- Prefer file/patch edits over shell commands.
- Preserve packages the project needs; do not strip dependencies to fix conflicts without replacing them.
- Do not emit markdown outside the artifact except your 1–2 sentence diagnosis before it.

## Iterative recovery (multi-round)
You may receive **prior failed attempts**. Read what was already tried — do NOT repeat the same file edits or commands.
Each round must propose a **different root-cause fix** based on the latest terminal output.
If prior round patched package.json but import still fails, fix the **import path or source file** next.
`.trim();

export type TerminalRecoveryInput = {
    threadId: string;
    userId: string;
    terminalOutput: string;
    issueCode: string;
    issueMessage?: string;
    diagnosticHints?: string[];
    errorSnippets?: string;
    referencedPaths?: string[];
    projectDir: string;
    model?: string;
    files: { filePath: string; content: string }[];
    recoveryRound?: number;
    maxRecoveryRounds?: number;
    priorAttempts?: Array<{
        round: number;
        filesChanged: string[];
        commandsExecuted: string[];
        result: string;
        errorSnippets: string;
        issueCode?: string;
    }>;
};

export class TerminalRecoveryService {
    async generateRecoveryStream(input: TerminalRecoveryInput): Promise<AsyncGenerator<string>> {
        const thread = await threadsRepo.findByIdForUser(input.threadId, input.userId);
        if (!thread) throw new ThreadAccessError();

        const terminalTail = input.terminalOutput.slice(-12_000);
        const errorSnippets = input.errorSnippets?.trim() || terminalTail;
        const fileBlocks = input.files
            .slice(0, 12)
            .map((f) => `[file: ${f.filePath}]\n${f.content.slice(0, 8_000)}\n[/file]`)
            .join('\n\n');

        const userContent = [
            input.recoveryRound && input.maxRecoveryRounds
                ? `Recovery round: ${input.recoveryRound} of ${input.maxRecoveryRounds}`
                : '',
            `Thread: ${input.threadId}`,
            `Project directory: ${input.projectDir}`,
            `Detected issue code: ${input.issueCode}`,
            input.issueMessage ? `Issue summary: ${input.issueMessage}` : '',
            input.diagnosticHints?.length
                ? `Diagnostic hints (consider these, do not blindly run commands):\n${input.diagnosticHints.map((h) => `- ${h}`).join('\n')}`
                : '',
            input.referencedPaths?.length
                ? `Files referenced in error output: ${input.referencedPaths.join(', ')}`
                : '',
            input.priorAttempts?.length
                ? [
                    '--- PRIOR FAILED ATTEMPTS (do NOT repeat these — try a different fix) ---',
                    ...input.priorAttempts.map((a) =>
                        [
                            `Round ${a.round}:`,
                            `  Files changed: ${a.filesChanged.length ? a.filesChanged.join(', ') : '(none)'}`,
                            `  Commands run: ${a.commandsExecuted.length ? a.commandsExecuted.join('; ') : '(none)'}`,
                            `  Outcome: ${a.result}`,
                            a.errorSnippets ? `  Error after attempt:\n${a.errorSnippets}` : '',
                        ].filter(Boolean).join('\n'),
                    ),
                    '--- END PRIOR ATTEMPTS ---',
                ].join('\n')
                : '',
            '',
            '--- KEY ERROR SNIPPETS ---',
            errorSnippets,
            '--- END SNIPPETS ---',
            '',
            '--- FULL TERMINAL TAIL (context) ---',
            terminalTail,
            '--- END TERMINAL ---',
            '',
            '--- PROJECT FILES ---',
            fileBlocks || '(no files provided)',
            '--- END FILES ---',
            '',
            'Diagnose the root cause, then emit targeted bolt artifact fixes.',
        ].filter(Boolean).join('\n');

        log.info('terminal.recovery_start', {
            threadId: input.threadId,
            issueCode: input.issueCode,
            model: input.model ?? 'default',
            recoveryRound: input.recoveryRound,
            fileCount: input.files.length,
            terminalChars: terminalTail.length,
            referencedPaths: input.referencedPaths?.length ?? 0,
            priorAttempts: input.priorAttempts?.length ?? 0,
        });

        return chatService.streamRecoveryCompletion(
            RECOVERY_SYSTEM_PROMPT,
            userContent,
            resolveRecoveryModel(input.model),
        );
    }
}

export const terminalRecoveryService = new TerminalRecoveryService();
