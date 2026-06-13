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
    suggestedCommands: ['pwd', 'ls', 'npm install --legacy-peer-deps --prefer-offline'],
  },
  {
    code: 'vite_missing_binary',
    regex: /command not found:\s*vite|sh:\s*1:\s*vite:\s*not found/i,
    confidence: 0.95,
    message: 'Vite binary is missing, dependencies are likely not installed.',
    suggestedCommands: ['npm install --legacy-peer-deps --prefer-offline', 'npm run dev'],
  },
  {
    code: 'module_resolution_failed',
    regex: /Failed to resolve import|Cannot find module|Could not resolve/i,
    confidence: 0.85,
    message: 'Module resolution failed, dependency install may be incomplete.',
    suggestedCommands: ['npm install --legacy-peer-deps --prefer-offline', 'npm run dev'],
  },
  {
    code: 'peer_dependency_conflict',
    regex: /ERESOLVE|peer dep missing|Could not resolve dependency/i,
    confidence: 0.88,
    message: 'npm peer dependency conflict detected.',
    suggestedCommands: ['npm install --legacy-peer-deps --prefer-offline', 'npm run dev'],
  },
  {
    code: 'vite_plugin_missing',
    regex: /Cannot find package '@vitejs\/plugin-react'|Failed to resolve import "@tailwindcss\/vite"/i,
    confidence: 0.9,
    message: 'A Vite or Tailwind plugin package is missing from devDependencies.',
    suggestedCommands: ['npm install --legacy-peer-deps --prefer-offline', 'npm run dev'],
  },
  {
    code: 'wrong_working_directory',
    regex: /EACCES|ENOTDIR|spawn ENOENT[\s\S]*cwd/i,
    confidence: 0.82,
    message: 'Shell may be running in the wrong project directory.',
    suggestedCommands: ['pwd', 'ls', 'npm install --legacy-peer-deps --prefer-offline'],
  },
  {
    code: 'install_failed',
    regex: /npm ERR!|install failed|timed out|Install failed once/i,
    confidence: 0.8,
    message: 'Dependency installation failed. Click Fix with agent in Terminal.',
    suggestedCommands: ['npm install --legacy-peer-deps --prefer-offline', 'npm run dev'],
  },
  {
    code: 'dev_server_failed',
    regex: /Error when starting dev server|dev server crashed|Port \d+ is already in use/i,
    confidence: 0.84,
    message: 'Dev server failed to start.',
    suggestedCommands: ['npm run dev'],
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
