import type { TerminalIssue } from '../store/webContainer';

type PatternRule = {
  code: string;
  regex: RegExp;
  confidence: number;
  message: string;
  /** Likely root causes — NOT shell commands to blindly run */
  diagnosticHints: string[];
};

const PATTERNS: PatternRule[] = [
  {
    code: 'invalid_shell_chain',
    regex: /EINVALIDTAGNAME|Invalid tag name ["']&&["']/i,
    confidence: 0.96,
    message: 'A shell command was chained incorrectly (&& in npm args).',
    diagnosticHints: [
      'The model emitted chained shell commands; recovery should fix package.json/config only — platform runs install.',
    ],
  },
  {
    code: 'cwd_package_json_missing',
    regex: /ENOENT[\s\S]*package\.json|Could not read package\.json/i,
    confidence: 0.98,
    message: 'npm ran in a directory without package.json.',
    diagnosticHints: [
      'Check whether package.json exists at project root or in a subdirectory.',
      'If missing, write a valid package.json — do not cd around blindly.',
    ],
  },
  {
    code: 'vite_permission_denied',
    regex: /permission denied:\s*vite|jsh:\s*permission denied:\s*vite|npm run build exited 126|exited 126/i,
    confidence: 0.97,
    message: 'Vite binary is not executable in WebContainer (permission denied).',
    diagnosticHints: [
      'Patch package.json scripts: dev → "node ./node_modules/vite/bin/vite.js", build → "node ./node_modules/vite/bin/vite.js build".',
      'Do NOT rerun npm install — this is a script invocation issue, not missing deps.',
    ],
  },
  {
    code: 'deps_not_installed',
    regex: /MODULE_NOT_FOUND[\s\S]*node_modules\/vite|Cannot find module ['"].*node_modules\/vite/i,
    confidence: 0.97,
    message: 'Dependencies are not installed (vite missing from node_modules).',
    diagnosticHints: [
      'Run npm install in the project workdir (~) — node_modules is empty or incomplete.',
      'Do not start npm run dev until install completes successfully.',
    ],
  },
  {
    code: 'vite_missing_binary',
    regex: /command not found:\s*vite|sh:\s*1:\s*vite:\s*not found/i,
    confidence: 0.95,
    message: 'Vite binary not found in node_modules/.bin.',
    diagnosticHints: [
      'Ensure vite is listed in devDependencies in package.json.',
      'If package.json is correct, platform install will restore node_modules — no manual npm install shell needed.',
    ],
  },
  {
    code: 'module_resolution_failed',
    regex: /Failed to resolve import|Could not resolve(?!\s+dependency)/i,
    confidence: 0.85,
    message: 'Import could not be resolved.',
    diagnosticHints: [
      'Read the failing import path in the error — fix typo/wrong path in the source file first.',
      'If importing an npm package, add it to package.json dependencies (platform installs after edit).',
      'If using path aliases (@/), verify tsconfig paths and vite resolve.alias match.',
    ],
  },
  {
    code: 'peer_dependency_conflict',
    regex: /ERESOLVE|peer dep missing|Could not resolve dependency/i,
    confidence: 0.88,
    message: 'npm peer dependency conflict.',
    diagnosticHints: [
      'Identify which package versions conflict from the npm error tree.',
      'Adjust package.json to compatible versions — do not just rerun npm install.',
    ],
  },
  {
    code: 'vite_plugin_missing',
    regex: /Cannot find package '@vitejs\/plugin-react'|Failed to resolve import "@tailwindcss\/vite"/i,
    confidence: 0.9,
    message: 'A Vite/Tailwind plugin is missing from devDependencies.',
    diagnosticHints: [
      'Add the missing plugin to devDependencies in package.json.',
      'Ensure vite.config imports match installed plugins.',
    ],
  },
  {
    code: 'npm_cache_eacces',
    regex: /EACCES|EPERM[\s\S]*npm-cache|cache folder contains root-owned files|Your cache folder contains root-owned files/i,
    confidence: 0.97,
    message: 'npm cannot write to its cache directory (permission denied).',
    diagnosticHints: [
      'Platform auto-creates a project-local .npm-cache — retry install after cache path fix.',
      'Do not suggest chown on host paths; WebContainer uses in-sandbox directories only.',
    ],
  },
  {
    code: 'wrong_working_directory',
    regex: /ENOTDIR|spawn ENOENT[\s\S]*cwd/i,
    confidence: 0.82,
    message: 'Shell may be running in the wrong project directory.',
    diagnosticHints: [
      'Confirm projectDir from context; only use cd if package.json is genuinely in a subdirectory.',
    ],
  },
  {
    code: 'install_failed',
    regex: /npm ERR!|install failed|timed out|Install failed once/i,
    confidence: 0.8,
    message: 'Dependency installation failed.',
    diagnosticHints: [
      'Read the specific npm ERR! line — network, version conflict, or invalid package name.',
      'Fix package.json (bad version, typo, incompatible peer) before retrying install.',
    ],
  },
  {
    code: 'dev_server_failed',
    regex: /Error when starting dev server|dev server crashed|Port \d+ is already in use/i,
    confidence: 0.84,
    message: 'Dev server failed to start.',
    diagnosticHints: [
      'Check vite.config for invalid plugins, bad paths, or port conflicts.',
      'Fix config/source errors — then npm run dev only (platform already installed deps).',
    ],
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
        diagnosticHints: rule.diagnosticHints,
      };
    }
  }
  return null;
};
