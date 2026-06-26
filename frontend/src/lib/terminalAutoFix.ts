import type { WebContainer } from '@webcontainer/api';
import { detectTerminalIssue } from './terminalIssues';
import { repairViteScriptsForWebContainer, terminalShowsVitePermissionError } from './webContainerScripts';
import { ensureNpmCacheDir } from './webContainerShell';
import { ensureScaffoldOnDisk } from './projectScaffold';
import { writeShellOutput } from '../store/webContainer';
import { DEFAULT_RECOVERY_MODEL, resolveRecoveryModel } from './models';

export { DEFAULT_RECOVERY_MODEL, resolveRecoveryModel };

// ── Tailwind v4 deterministic patch helpers ───────────────────────────────────

/** Returns true when the CSS content uses Tailwind v3 directives instead of v4 import syntax. */
const hasTailwindV3Directives = (css: string): boolean =>
    /@tailwind\s+(base|components|utilities)/i.test(css) ||
    /@import\s+['"]tailwindcss\/base['"]/i.test(css);

/** Returns true when the CSS content is already v4-compatible. */
const hasTailwindV4Import = (css: string): boolean =>
    /@import\s+['"]tailwindcss['"]/i.test(css);

/** Converts v3 CSS directives to a single v4 @import line. */
export const patchCssForTailwindV4 = (css: string): { patched: string; changed: boolean } => {
    if (hasTailwindV4Import(css) && !hasTailwindV3Directives(css)) {
        return { patched: css, changed: false };
    }
    // Remove all v3 directives
    let patched = css.replace(/@tailwind\s+(base|components|utilities)\s*;?\s*/gi, '');
    patched = patched.replace(/@import\s+['"]tailwindcss\/(base|components|utilities)['"]\s*;?\s*/gi, '');
    // Add v4 import at the top if not present
    if (!hasTailwindV4Import(patched)) {
        patched = `@import "tailwindcss";\n${patched.trimStart()}`;
    }
    return { patched: patched.trimEnd() + '\n', changed: patched !== css };
};

/** Adds @tailwindcss/vite to vite.config.ts if it's missing. */
export const patchViteConfigForTailwindV4 = (config: string): { patched: string; changed: boolean } => {
    if (/@tailwindcss\/vite/.test(config)) return { patched: config, changed: false };
    // Add import after the last existing import statement
    let patched = config.replace(
        /(import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*)(\n(?!import))/,
        `$1\nimport tailwindcss from '@tailwindcss/vite';\n`,
    );
    // Add to plugins array
    patched = patched.replace(
        /plugins\s*:\s*\[([^\]]*)\]/,
        (_, inner) => `plugins: [${inner.trimEnd()}${inner.trim() ? ', ' : ''}tailwindcss()]`,
    );
    return { patched, changed: patched !== config };
};

/** Returns true when the output contains a PostCSS/CSS parse error. */
export const terminalShowsPostCSSError = (output: string): boolean =>
    /\[postcss\]|postcss-import.*Unknown word|Unknown word "use strict"|postcss.*SyntaxError/i.test(output) ||
    /@tailwind\s+(base|components|utilities)/i.test(output);

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
    /** Called for any file deterministically patched (path + content). */
    onFilePatched?: (path: string, content: string) => void;
    shellWriter?: WritableStreamDefaultWriter<string> | null;
    syncShellCwd?: () => Promise<void>;
}): Promise<DeterministicFixResult[]> {
    const {
        wc,
        terminalOutput,
        projectDir,
        fileMap,
        repairRootForNpm,
        onPackageJsonPatched,
        onFilePatched,
        syncShellCwd,
    } = input;
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

    // Deterministic Tailwind v3→v4 migration: patch src/index.css and vite.config.ts
    if (terminalShowsPostCSSError(tail)) {
        const cssCandidates = ['src/index.css', 'src/App.css', 'src/styles.css', 'src/global.css'];
        let cssPatched = false;
        for (const cssPath of cssCandidates) {
            let cssContent = fileMap.get(cssPath);
            if (!cssContent) {
                try { cssContent = await wc.fs.readFile(cssPath, 'utf-8'); } catch { continue; }
            }
            const { patched, changed } = patchCssForTailwindV4(cssContent);
            if (changed) {
                try {
                    await wc.fs.writeFile(cssPath, patched);
                    fileMap.set(cssPath, patched);
                    onFilePatched?.(cssPath, patched);
                    writeShellOutput(`\r\n\x1b[36m⬢ Auto-fix: upgraded ${cssPath} to Tailwind v4 @import syntax\x1b[0m\r\n`);
                    cssPatched = true;
                } catch { /* best effort */ }
            }
        }

        // Remove postcss.config.js/ts if it imports tailwindcss (breaks v4)
        const postcssCandidates = ['postcss.config.js', 'postcss.config.ts', 'postcss.config.cjs'];
        for (const cfgPath of postcssCandidates) {
            let cfgContent = fileMap.get(cfgPath);
            if (!cfgContent) {
                try { cfgContent = await wc.fs.readFile(cfgPath, 'utf-8'); } catch { continue; }
            }
            if (/tailwindcss/i.test(cfgContent)) {
                try {
                    await wc.fs.rm(cfgPath);
                    fileMap.delete(cfgPath);
                    writeShellOutput(`\r\n\x1b[36m⬢ Auto-fix: removed ${cfgPath} (Tailwind v4 uses Vite plugin, not PostCSS plugin)\x1b[0m\r\n`);
                    cssPatched = true;
                } catch { /* best effort */ }
            }
        }

        // Patch vite.config.ts to include @tailwindcss/vite if missing
        const viteConfigCandidates = ['vite.config.ts', 'vite.config.js'];
        for (const cfgPath of viteConfigCandidates) {
            let cfgContent = fileMap.get(cfgPath);
            if (!cfgContent) {
                try { cfgContent = await wc.fs.readFile(cfgPath, 'utf-8'); } catch { continue; }
            }
            const { patched, changed } = patchViteConfigForTailwindV4(cfgContent);
            if (changed) {
                try {
                    await wc.fs.writeFile(cfgPath, patched);
                    fileMap.set(cfgPath, patched);
                    onFilePatched?.(cfgPath, patched);
                    writeShellOutput(`\r\n\x1b[36m⬢ Auto-fix: added @tailwindcss/vite plugin to ${cfgPath}\x1b[0m\r\n`);
                    cssPatched = true;
                } catch { /* best effort */ }
            }
        }

        results.push({
            code: 'postcss_css_error',
            applied: cssPatched,
            message: cssPatched
                ? 'Applied Tailwind v4 patch (CSS import + Vite plugin)'
                : 'PostCSS error detected but no fixable files found',
        });
    }

    if (/MODULE_NOT_FOUND[\s\S]*node_modules\/vite|Cannot find module ['"].*node_modules\/vite/i.test(tail)) {
        if (syncShellCwd) {
            try {
                await syncShellCwd();
            } catch {
                /* best effort */
            }
        }
        results.push({
            code: 'deps_not_installed',
            applied: true,
            message: 'vite missing from node_modules — npm install will be retried',
        });
    }

    if (/ENOENT[\s\S]*package\.json|Could not read package\.json/i.test(tail)) {
        if (syncShellCwd) {
            try {
                await syncShellCwd();
            } catch {
                /* best effort */
            }
        }
        try {
            await ensureScaffoldOnDisk(wc, fileMap);
        } catch {
            /* best effort */
        }
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
    'deps_not_installed',
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
    'postcss_css_error',
    'typescript_error',
    'vite_pre_transform_error',
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
