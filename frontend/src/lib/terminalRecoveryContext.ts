/** Extract likely project file paths referenced in terminal / Vite / npm errors. */
export const extractPathsFromTerminalOutput = (terminalOutput: string): string[] => {
    const paths = new Set<string>();
    const patterns = [
        /from\s+['"](\.\.?\/[^'"]+|src\/[^'"]+)['"]/gi,
        /Failed to resolve import\s+["'][^"']+["']\s+from\s+["']([^"']+)["']/gi,
        /(?:^|\s)(src\/[\w./-]+\.(?:tsx?|jsx?|css|json))(?:\:|'|"|\s|$)/gim,
        /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.(?:tsx?|jsx?|css))(?:\:|'|"|\s|$)/gim,
        /at\s+([^\s(]+\.(?:tsx?|jsx?))/gi,
        /in\s+([^\s(]+\.(?:tsx?|jsx?))/gi,
        /file:\s*\/(?:home\/[^/]+\/)?([\w./-]+\.(?:tsx?|jsx?|css|json))/gi,
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(terminalOutput)) !== null) {
            const raw = match[1]?.replace(/^\.\//, '').replace(/^\//, '');
            if (!raw || raw.includes('node_modules')) continue;
            if (/\.(tsx?|jsx?|css|json|html)$/.test(raw) || raw === 'package.json' || raw.startsWith('src/')) {
                paths.add(raw);
            }
        }
    }

    return [...paths];
};

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
    const picked = new Map<string, { filePath: string; content: string }>();

    for (const p of priority) {
        const match = files.find((f) => f.filePath === p);
        if (match) picked.set(p, match);
    }

    for (const pathFromError of extractPathsFromTerminalOutput(terminalOutput)) {
        if (picked.size >= 12) break;
        const normalized = pathFromError.replace(/^\//, '');
        const match = files.find((f) => f.filePath === normalized || f.filePath.endsWith(`/${normalized}`));
        if (match) picked.set(match.filePath, match);
    }

    for (const f of files) {
        if (picked.size >= 12) break;
        if (f.filePath.startsWith('src/') && /\.(tsx?|jsx?)$/.test(f.filePath)) {
            picked.set(f.filePath, f);
        }
    }

    return [...picked.values()];
};
