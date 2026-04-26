import type { TerminalIssue } from '../store/webContainer';

type PatternRule = {
  code: string;
  regex: RegExp;
  confidence: number;
  message: string;
  suggestedCommands: string[];
};

const PATTERNS: PatternRule[] = [
  {
    code: 'cwd_package_json_missing',
    regex: /ENOENT[\s\S]*package\.json|Could not read package\.json/i,
    confidence: 0.98,
    message: 'Terminal is running in a directory without package.json.',
    suggestedCommands: ['pwd', 'ls', 'cd .', 'npm install'],
  },
  {
    code: 'vite_missing_binary',
    regex: /command not found:\s*vite/i,
    confidence: 0.95,
    message: 'Vite binary is missing, dependencies are likely not installed.',
    suggestedCommands: ['npm install', 'npm run dev'],
  },
  {
    code: 'module_resolution_failed',
    regex: /Failed to resolve import|Cannot find module/i,
    confidence: 0.85,
    message: 'Module resolution failed, dependency install may be incomplete.',
    suggestedCommands: ['npm install', 'npm run dev'],
  },
  {
    code: 'install_failed',
    regex: /npm ERR!|install failed|timed out/i,
    confidence: 0.8,
    message: 'Dependency installation failed.',
    suggestedCommands: ['npm install --legacy-peer-deps --prefer-offline', 'npm run dev'],
  },
];

export const detectTerminalIssue = (terminalOutput: string): TerminalIssue | null => {
  if (!terminalOutput.trim()) return null;
  for (const rule of PATTERNS) {
    if (rule.regex.test(terminalOutput)) {
      return {
        code: rule.code,
        confidence: rule.confidence,
        message: rule.message,
        suggestedCommands: rule.suggestedCommands,
      };
    }
  }
  return null;
};

