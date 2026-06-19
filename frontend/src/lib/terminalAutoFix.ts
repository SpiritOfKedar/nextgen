import type { WebContainer } from '@webcontainer/api';
import { detectTerminalIssue } from './terminalIssues';
import { repairViteScriptsForWebContainer, terminalShowsVitePermissionError } from './webContainerScripts';
import { ensureNpmCacheDir } from './webContainerShell';
import { writeShellOutput } from '../store/webContainer';

export type DeterministicFixResult = {
    code: string;
    applied: boolean;
    message: string;
};

const npmCacheEaccesPattern = /EACCES|EPERM[\s\S]*npm-cache|cache folder contains root-owned files/i;

/** Fixes common WebContainer failures without calling the LLM. */
export async function applyDeterministicTerminalFixes(input: {
    wc: WebContainer;
    terminalOutput: string;
    projectDir: string;
    fileMap: Map<string, string>;
    repairRootForNpm?: (announce?: boolean) => Promise<void>;
    onPackageJsonPatched?: (content: string) => void;
}): Promise<DeterministicFixResult[]> {
    const { wc, terminalOutput, projectDir, fileMap, repairRootForNpm, onPackageJsonPatched } = input;
    const results: DeterministicFixResult[] = [];
    const tail = terminalOutput.slice(-12_000);

    if (npmCacheEaccesPattern.test(tail)) {
        try {
            const cachePath = await ensureNpmCacheDir(wc, projectDir);
            writeShellOutput(`\r\n\x1b[36m⬢ Auto-fix: relocated npm cache to writable ${cachePath}\x1b[0m\r\n`);
            results.push({
                code: 'npm_cache_eacces',
                applied: true,
                message: `Relocated npm cache to writable ${cachePath}`,
            });
        } catch (err) {
            results.push({
                code: 'npm_cache_eacces',
                applied: false,
                message: err instanceof Error ? err.message : 'Failed to create npm cache directory',
            });
        }
    }

    if (terminalShowsVitePermissionError(tail)) {
        const patched = await repairViteScriptsForWebContainer(wc, {
            fileMap,
            projectDir,
            onPatched: onPackageJsonPatched,
            announce: writeShellOutput,
        });
        results.push({
            code: 'vite_permission_denied',
            applied: patched,
            message: patched
                ? 'Patched package.json scripts to invoke Vite via node'
                : 'Vite script patch not needed or package.json missing',
        });
    }

    if (/ENOENT[\s\S]*package\.json|Could not read package\.json/i.test(tail)) {
        if (repairRootForNpm) {
            try {
                await repairRootForNpm(true);
                results.push({
                    code: 'cwd_package_json_missing',
                    applied: true,
                    message: 'Ensured root package.json exists for npm',
                });
            } catch (err) {
                results.push({
                    code: 'cwd_package_json_missing',
                    applied: false,
                    message: err instanceof Error ? err.message : 'Failed to repair package.json',
                });
            }
        }
    }

    return results;
}

/**
 * Purely environmental WebContainer issues. These are fixed deterministically (cache
 * relocation, script patch, package.json repair) and must NEVER trigger an LLM recovery —
 * the model cannot fix sandbox permissions and looping wastes compute/intelligence.
 */
export const DETERMINISTIC_FIX_CODES = new Set([
    'npm_cache_eacces',
    'vite_permission_denied',
    'cwd_package_json_missing',
    'wrong_working_directory',
]);

/** Code/config issues where the LLM can genuinely help (bad imports, versions, configs). */
export const LLM_RECOVERABLE_CODES = new Set([
    'install_failed',
    'vite_missing_binary',
    'module_resolution_failed',
    'peer_dependency_conflict',
    'vite_plugin_missing',
    'dev_server_failed',
]);

/** True when the issue is environmental and resolvable without any LLM call. */
export function isDeterministicFixCode(issue: ReturnType<typeof detectTerminalIssue>): boolean {
    return !!issue && DETERMINISTIC_FIX_CODES.has(issue.code);
}

/** True only for issues worth spending an LLM recovery round on. */
export function shouldAutoRecover(issue: ReturnType<typeof detectTerminalIssue>): boolean {
    if (!issue) return false;
    if (issue.confidence < 0.8) return false;
    return LLM_RECOVERABLE_CODES.has(issue.code);
}

export const RECOVERY_LLM_MODEL = 'claude-haiku-4.5';
