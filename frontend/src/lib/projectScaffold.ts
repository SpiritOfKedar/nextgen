import type { WebContainer } from '@webcontainer/api';
import { MINIMAL_ROOT_PACKAGE_JSON } from './sandboxInstall';
import { readProjectFile, toWorkdirRelativePath, writeProjectFile } from './webContainerShell';

/** Files required before `npm install` / `npm run dev` can succeed. */
export const SCAFFOLD_PATHS = [
    'package.json',
    'index.html',
    'vite.config.ts',
    'tsconfig.json',
    'src/main.tsx',
    'src/index.css',
] as const;

const DEFAULT_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

const DEFAULT_VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
  },
});
`;

const DEFAULT_TSCONFIG = JSON.stringify(
    {
        compilerOptions: {
            target: 'ES2020',
            useDefineForClassFields: true,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            skipLibCheck: true,
            moduleResolution: 'bundler',
            allowImportingTsExtensions: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: 'react-jsx',
            strict: true,
        },
        include: ['src'],
    },
    null,
    2,
);

const DEFAULT_MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;

/**
 * Fill missing root scaffold files in the in-memory file map so npm/vite can run
 * even when the model only emitted src/ components.
 */
export function ensureProjectScaffold(fileMap: Map<string, string>): boolean {
    let changed = false;

    if (!fileMap.has('package.json')) {
        fileMap.set('package.json', MINIMAL_ROOT_PACKAGE_JSON);
        changed = true;
    }

    if (!fileMap.has('index.html')) {
        fileMap.set('index.html', DEFAULT_INDEX_HTML);
        changed = true;
    }

    if (!fileMap.has('vite.config.ts')) {
        fileMap.set('vite.config.ts', DEFAULT_VITE_CONFIG);
        changed = true;
    }

    if (!fileMap.has('tsconfig.json')) {
        fileMap.set('tsconfig.json', DEFAULT_TSCONFIG);
        changed = true;
    }

    const existingCss = fileMap.get('src/index.css') || '';
    if (!existingCss.includes('@import "tailwindcss"') && !existingCss.includes("@import 'tailwindcss'")) {
        const fixedCss =
            '@import "tailwindcss";\n' +
            existingCss.replace(/@tailwind\s+(base|components|utilities);?\s*/g, '');
        fileMap.set('src/index.css', fixedCss);
        changed = true;
    }

    if (!fileMap.has('src/main.tsx')) {
        fileMap.set('src/main.tsx', DEFAULT_MAIN_TSX);
        changed = true;
    } else {
        const mainContent = fileMap.get('src/main.tsx')!;
        if (!mainContent.includes('index.css')) {
            fileMap.set('src/main.tsx', "import './index.css';\n" + mainContent);
            changed = true;
        }
    }

    return changed;
}

/** True when the map looks like a partial React app (model skipped package.json). */
export function needsProjectScaffold(fileMap: Map<string, string>): boolean {
    if (fileMap.has('package.json')) return false;
    for (const key of fileMap.keys()) {
        const normalized = toWorkdirRelativePath(key);
        if (/^src\/.*\.(tsx?|jsx?)$/.test(normalized)) return true;
    }
    return fileMap.size > 0;
}

/**
 * Write scaffold files to the WebContainer workdir when missing on disk.
 * Returns paths that were written.
 */
export async function ensureScaffoldOnDisk(
    wc: WebContainer,
    fileMap: Map<string, string>,
): Promise<string[]> {
    ensureProjectScaffold(fileMap);
    const written: string[] = [];

    for (const path of SCAFFOLD_PATHS) {
        const content = fileMap.get(path);
        if (!content) continue;

        const existing = await readProjectFile(wc, path);
        if (existing?.trim()) {
            if (path === 'package.json') {
                try {
                    JSON.parse(existing);
                    continue;
                } catch {
                    /* rewrite invalid package.json */
                }
            } else {
                continue;
            }
        }

        try {
            await writeProjectFile(wc, path, content);
            written.push(path);
        } catch (err) {
            console.error(`[projectScaffold] Failed to write ${path}:`, err);
        }
    }

    return written;
}
