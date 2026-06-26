/** Extract likely project file paths referenced in terminal / Vite / npm errors. */
export const extractPathsFromTerminalOutput = (terminalOutput: string): string[] => {
    const paths = new Set<string>();
    const patterns = [
        /from\s+['"](\.\.?\/[^'"]+|src\/[^'"]+)['"]/gi,
        /Failed to resolve import\s+["'][^"']+["']\s+from\s+["']([^"']+)["']/gi,
        /(?:^|\s)(src\/[\w./-]+\.(?:tsx?|jsx?|css|json))(?:\:|'|"|\s|$)/gim,
        /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.(?:tsx?|jsx?|css))(?:\:|'|"|\s|$)/gim,
        /at\s+([^\s(]+\.(?:tsx?|jsx?|css))/gi,
        /in\s+([^\s(]+\.(?:tsx?|jsx?|css))/gi,
        /file:\s*\/(?:home\/[^/]+\/)?([\w./-]+\.(?:tsx?|jsx?|css|json))/gi,
        // PostCSS / CSS errors reference the CSS file directly
        /\[postcss\]\s+([^\s:]+\.css)/gi,
        /Plugin:\s*([\w./-]+\.(?:ts|js|cjs))/gi,
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(terminalOutput)) !== null) {
            const raw = match[1]?.replace(/^\.\//, '').replace(/^\//, '');
            if (!raw || raw.includes('node_modules')) continue;
            if (/\.(tsx?|jsx?|css|json|html|ts|js|cjs)$/.test(raw) || raw === 'package.json' || raw.startsWith('src/')) {
                paths.add(raw);
            }
        }
    }

    return [...paths];
};

/** True when the terminal output suggests a CSS / PostCSS / Tailwind error. */
export const isPostCSSError = (terminalOutput: string): boolean =>
    /\[postcss\]|postcss-import|Unknown word "use strict"|@tailwind\s+(base|components|utilities)/i.test(terminalOutput);

/** True when the output suggests a TypeScript compilation error. */
export const isTypeScriptError = (terminalOutput: string): boolean =>
    /error TS\d+:|TypeScript error/i.test(terminalOutput);

/** Pull the most error-dense lines so the recovery LLM sees the signal, not 12k of noise. */
export const extractErrorSnippets = (terminalOutput: string, maxLines = 48): string => {
    const lines = terminalOutput.split('\n');
    const hot = new Set<number>();
    const signal = /error|failed|ENOENT|ERR!|cannot find|could not resolve|failed to resolve|unexpected token|syntax error|peer dep|ERESOLVE|✗|⚠/i;

    lines.forEach((line, i) => {
        if (signal.test(line)) {
            for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 2); j += 1) {
                hot.add(j);
            }
        }
    });

    if (hot.size === 0) {
        return lines.slice(-maxLines).join('\n');
    }

    const picked = [...hot].sort((a, b) => a - b).slice(0, maxLines);
    return picked.map((i) => lines[i]).join('\n');
};

export const selectRecoveryFiles = (
    files: { filePath: string; content: string }[],
    terminalOutput = '',
): { filePath: string; content: string }[] => {
    const priority = [
        'package.json',
        'package-lock.json',
        'vite.config.ts',
        'vite.config.js',
        'tsconfig.json',
        'index.html',
    ];

    // Always include CSS + PostCSS config files when CSS/PostCSS error is detected
    if (isPostCSSError(terminalOutput)) {
        priority.push(
            'src/index.css',
            'src/App.css',
            'src/styles.css',
            'postcss.config.js',
            'postcss.config.ts',
            'postcss.config.cjs',
            'tailwind.config.js',
            'tailwind.config.ts',
        );
    }

    // Always include tsconfig variants for TS errors
    if (isTypeScriptError(terminalOutput)) {
        priority.push('tsconfig.app.json', 'tsconfig.node.json');
    }

    const picked = new Map<string, { filePath: string; content: string }>();

    for (const p of priority) {
        const match = files.find((f) => f.filePath === p);
        if (match) picked.set(p, match);
    }

    for (const pathFromError of extractPathsFromTerminalOutput(terminalOutput)) {
        if (picked.size >= 14) break;
        const normalized = pathFromError.replace(/^\//, '');
        const match = files.find((f) => f.filePath === normalized || f.filePath.endsWith(`/${normalized}`));
        if (match) picked.set(match.filePath, match);
    }

    // Include CSS files in src/ as fallback (especially for styling errors)
    for (const f of files) {
        if (picked.size >= 14) break;
        if (f.filePath.startsWith('src/') && /\.css$/.test(f.filePath)) {
            picked.set(f.filePath, f);
        }
    }

    for (const f of files) {
        if (picked.size >= 14) break;
        if (f.filePath.startsWith('src/') && /\.(tsx?|jsx?)$/.test(f.filePath)) {
            picked.set(f.filePath, f);
        }
    }

    return [...picked.values()];
};
