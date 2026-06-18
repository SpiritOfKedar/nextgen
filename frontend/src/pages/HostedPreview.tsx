import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WebContainer, type FileSystemTree } from '@webcontainer/api';

type PreviewStatus = 'loading' | 'booting' | 'installing' | 'starting' | 'ready' | 'error' | 'not-found';

interface PreviewData {
  threadId: string;
  title: string;
  files: Record<string, { content: string }>;
}

function buildFileSystemTree(files: Record<string, { content: string }>): FileSystemTree {
  const tree: FileSystemTree = {};
  for (const [path, { content }] of Object.entries(files)) {
    const parts = path.split('/');
    let current: any = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = { directory: {} };
      }
      current = current[parts[i]].directory;
    }
    current[parts[parts.length - 1]] = { file: { contents: content } };
  }
  return tree;
}

const STATUS_MESSAGES: Record<PreviewStatus, string> = {
  loading: 'Loading project files…',
  booting: 'Booting sandbox…',
  installing: 'Installing dependencies…',
  starting: 'Starting dev server…',
  ready: '',
  error: 'Something went wrong',
  'not-found': 'Project not found',
};

export function HostedPreview() {
  const { threadId } = useParams<{ threadId: string }>();
  const [status, setStatus] = useState<PreviewStatus>('loading');
  const [title, setTitle] = useState('Preview');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const containerRef = useRef<WebContainer | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (!threadId || hasStarted.current) return;
    hasStarted.current = true;

    let teardownCalled = false;

    async function run() {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

      // 1. Fetch project files
      setStatus('loading');
      let data: PreviewData;
      try {
        const res = await fetch(`${API_URL}/preview/${threadId}`);
        if (res.status === 404) {
          setStatus('not-found');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch (err) {
        console.error('[HostedPreview] Failed to fetch files:', err);
        setStatus('error');
        setErrorMessage('Failed to load project files. Please check the URL and try again.');
        return;
      }

      setTitle(data.title || 'Preview');
      document.title = data.title ? `${data.title} — NextGen Preview` : 'NextGen Preview';

      if (teardownCalled) return;

      // 2. Boot WebContainer
      setStatus('booting');
      let instance: WebContainer;
      try {
        instance = await WebContainer.boot();
        containerRef.current = instance;
      } catch (err) {
        console.error('[HostedPreview] Failed to boot WebContainer:', err);
        setStatus('error');
        setErrorMessage('Failed to boot the sandbox environment. Please try reloading.');
        return;
      }

      if (teardownCalled) {
        instance.teardown();
        return;
      }

      // 3. Mount files
      const tree = buildFileSystemTree(data.files);
      await instance.mount(tree);

      if (teardownCalled) {
        instance.teardown();
        return;
      }

      // 4. Listen for server-ready
      instance.on('server-ready', (_port: number, url: string) => {
        setPreviewUrl(url);
        setStatus('ready');
      });

      // 5. npm install
      setStatus('installing');
      try {
        const installProcess = await instance.spawn('npm', ['install']);
        const installReader = installProcess.output.getReader();
        while (true) {
          const { done, value } = await installReader.read();
          if (done) break;
          setTerminalOutput((prev) => [...prev.slice(-200), value]);
        }
        const installExit = await installProcess.exit;
        if (installExit !== 0) {
          setStatus('error');
          setErrorMessage(`npm install failed with exit code ${installExit}`);
          return;
        }
      } catch (err) {
        console.error('[HostedPreview] npm install error:', err);
        setStatus('error');
        setErrorMessage('Failed to install dependencies.');
        return;
      }

      if (teardownCalled) {
        instance.teardown();
        return;
      }

      // 6. npm run dev
      setStatus('starting');
      try {
        const devProcess = await instance.spawn('npm', ['run', 'dev']);
        const devReader = devProcess.output.getReader();
        // Read dev output in background
        (async () => {
          while (true) {
            const { done, value } = await devReader.read();
            if (done) break;
            setTerminalOutput((prev) => [...prev.slice(-200), value]);
          }
        })();
      } catch (err) {
        console.error('[HostedPreview] npm run dev error:', err);
        setStatus('error');
        setErrorMessage('Failed to start the dev server.');
      }
    }

    run();

    return () => {
      teardownCalled = true;
      if (containerRef.current) {
        containerRef.current.teardown();
        containerRef.current = null;
      }
    };
  }, [threadId]);

  // Not-found state
  if (status === 'not-found') {
    return (
      <div className="h-[100dvh] w-full bg-zinc-950 flex flex-col items-center justify-center text-white">
        <div className="text-6xl font-bold text-zinc-700 mb-4">404</div>
        <p className="text-zinc-400 text-lg mb-2">Project not found</p>
        <p className="text-zinc-600 text-sm">
          The preview link may be invalid or the project may have been removed.
        </p>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="h-[100dvh] w-full bg-zinc-950 flex flex-col items-center justify-center text-white px-4">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-zinc-300 text-lg mb-2">Something went wrong</p>
        <p className="text-zinc-500 text-sm text-center max-w-md mb-6">{errorMessage}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 text-sm text-zinc-300 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Ready state — show the preview
  if (status === 'ready' && previewUrl) {
    return (
      <div className="h-[100dvh] w-full bg-zinc-950 flex flex-col">
        {/* Header bar */}
        <div className="h-10 flex items-center justify-between px-4 bg-zinc-950 border-b border-zinc-800 shrink-0">
          <span className="text-sm font-medium text-zinc-300 truncate">{title}</span>
          <span className="text-[11px] text-zinc-600">
            Powered by <span className="text-zinc-400 font-medium">NextGen</span>
          </span>
        </div>
        {/* Preview iframe */}
        <iframe
          src={previewUrl}
          className="flex-1 w-full border-0"
          title={title}
          allow="clipboard-read; clipboard-write; cross-origin-isolated"
        />
      </div>
    );
  }

  // Loading / booting / installing / starting states
  return (
    <div className="h-[100dvh] w-full bg-zinc-950 flex flex-col items-center justify-center text-white">
      <div className="flex flex-col items-center gap-6 max-w-lg w-full px-6">
        {/* Spinner */}
        <div className="relative">
          <div className="h-10 w-10 rounded-full border-2 border-zinc-800" />
          <div className="absolute inset-0 h-10 w-10 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
        </div>

        {/* Status message */}
        <div className="text-center">
          <p className="text-zinc-300 text-sm font-medium">{STATUS_MESSAGES[status]}</p>
          <p className="text-zinc-600 text-xs mt-1">This may take a moment</p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-2">
          {(['loading', 'booting', 'installing', 'starting'] as const).map((step, i) => {
            const steps = ['loading', 'booting', 'installing', 'starting'];
            const currentIdx = steps.indexOf(status);
            const isComplete = i < currentIdx;
            const isCurrent = i === currentIdx;
            return (
              <div key={step} className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full transition-colors duration-300 ${
                    isComplete
                      ? 'bg-emerald-500'
                      : isCurrent
                        ? 'bg-blue-500 animate-pulse'
                        : 'bg-zinc-700'
                  }`}
                />
                {i < 3 && (
                  <div
                    className={`h-px w-6 transition-colors duration-300 ${
                      isComplete ? 'bg-emerald-500/50' : 'bg-zinc-800'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Terminal output during install/starting */}
        {(status === 'installing' || status === 'starting') && terminalOutput.length > 0 && (
          <div className="w-full mt-4 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
              <div className="flex gap-1">
                <div className="h-2 w-2 rounded-full bg-zinc-700" />
                <div className="h-2 w-2 rounded-full bg-zinc-700" />
                <div className="h-2 w-2 rounded-full bg-zinc-700" />
              </div>
              <span className="text-[10px] text-zinc-600 font-mono">terminal</span>
            </div>
            <div className="p-3 font-mono text-[11px] text-zinc-500 max-h-48 overflow-y-auto whitespace-pre-wrap break-all leading-relaxed">
              {terminalOutput.slice(-30).join('')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
