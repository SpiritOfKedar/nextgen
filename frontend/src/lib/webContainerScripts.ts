import type { WebContainer } from '@webcontainer/api';

/** jsh cannot exec node_modules/.bin/vite — invoke via node instead */
export const WEBCONTAINER_VITE_DEV_SCRIPT = 'node ./node_modules/vite/bin/vite.js';
export const WEBCONTAINER_VITE_BUILD_SCRIPT = 'node ./node_modules/vite/bin/vite.js build';

const usesBareViteBinary = (script: string | undefined): boolean => {
    if (!script?.trim()) return false;
    if (/node\s+.*vite/i.test(script)) return false;
    if (/\bnpx\b/.test(script)) return false;
    return /\bvite\b/.test(script);
};

export const patchPackageJsonScriptsForWebContainer = (pkgContent: string): { patched: string; changed: boolean } => {
    try {
        const pkg = JSON.parse(pkgContent);
        if (!pkg.scripts || typeof pkg.scripts !== 'object') {
            return { patched: pkgContent, changed: false };
        }

        let changed = false;
        const scripts = { ...pkg.scripts };

        if (usesBareViteBinary(scripts.dev)) {
            scripts.dev = WEBCONTAINER_VITE_DEV_SCRIPT;
            changed = true;
        }
        if (usesBareViteBinary(scripts.build)) {
            scripts.build = WEBCONTAINER_VITE_BUILD_SCRIPT;
            changed = true;
        }
        if (usesBareViteBinary(scripts.preview)) {
            scripts.preview = 'node ./node_modules/vite/bin/vite.js preview';
            changed = true;
        }

        if (!changed) return { patched: pkgContent, changed: false };
        return { patched: JSON.stringify({ ...pkg, scripts }, null, 2), changed: true };
    } catch {
        return { patched: pkgContent, changed: false };
    }
};

export const terminalShowsVitePermissionError = (output: string): boolean =>
    /permission denied:\s*vite|jsh:\s*permission denied:\s*vite|exited 126/i.test(output);

export async function repairViteScriptsForWebContainer(
    wc: WebContainer,
    options?: {
        fileMap?: Map<string, string>;
        projectDir?: string;
        onPatched?: (content: string) => void;
        announce?: (msg: string) => void;
    },
): Promise<boolean> {
    const paths = ['package.json', '/package.json'];
    if (options?.projectDir && options.projectDir !== '/') {
        paths.unshift(`${options.projectDir}/package.json`.replace(/^\//, ''));
    }

    for (const p of paths) {
        const rel = p.replace(/^\//, '');
        let content = options?.fileMap?.get(rel) ?? options?.fileMap?.get('package.json');
        if (!content) {
            try {
                content = await wc.fs.readFile(rel, 'utf-8');
            } catch {
                continue;
            }
        }

        const { patched, changed } = patchPackageJsonScriptsForWebContainer(content);
        if (!changed) continue;

        const writePath = rel || 'package.json';
        try {
            await wc.fs.writeFile(writePath, patched);
        } catch {
            try {
                await wc.fs.writeFile(`/${writePath}`, patched);
            } catch {
                continue;
            }
        }

        options?.fileMap?.set('package.json', patched);
        options?.fileMap?.set(writePath, patched);
        options?.onPatched?.(patched);
        options?.announce?.(
            '\r\n\x1b[33m⚠ WebContainer cannot exec the vite binary directly — patched package.json scripts to use node.\x1b[0m\r\n',
        );
        console.info('[SandboxPerf] vite_scripts_repaired', { path: writePath });
        return true;
    }
    return false;
}
