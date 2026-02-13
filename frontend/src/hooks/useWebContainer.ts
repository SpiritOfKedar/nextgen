import { useEffect, useState, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { useAtom, useSetAtom } from 'jotai';
import {
    webContainerAtom,
    serverUrlAtom,
    shellInputWriterAtom,
    shellReadyAtom,
    writeShellOutput,
    setShellResizeFn,
} from '../store/webContainer';

// ── Module-level singletons (survive React strict-mode double-invoke) ──
let _bootPromise: Promise<WebContainer> | null = null;
let _instance: WebContainer | null = null;
let _shellSpawned = false;

/** Direct access to the booted instance — bypasses React closures */
export function getWebContainerInstance(): WebContainer | null {
    return _instance;
}

export const useWebContainer = () => {
    const [webContainer, setWebContainer] = useAtom(webContainerAtom);
    const setServerUrl = useSetAtom(serverUrlAtom);
    const setShellWriter = useSetAtom(shellInputWriterAtom);
    const setShellReady = useSetAtom(shellReadyAtom);
    const [isLoading, setIsLoading] = useState(!_instance);
    const [error, setError] = useState<string | null>(null);
    const didRun = useRef(false);

    useEffect(() => {
        // Guard against strict-mode double-invoke
        if (didRun.current) return;
        didRun.current = true;

        const boot = async () => {
            // Already booted (e.g. HMR, re-mount)
            if (_instance) {
                setWebContainer(_instance);
                setIsLoading(false);
                return;
            }

            try {
                if (!_bootPromise) {
                    console.log('[WebContainer] Booting...');
                    _bootPromise = WebContainer.boot();
                }

                const instance = await _bootPromise;
                _instance = instance;
                setWebContainer(instance);

                instance.on('server-ready', (_, url) => {
                    console.log('[WebContainer] Server Ready:', url);
                    setServerUrl(url);
                });

                // ── Spawn persistent jsh shell (once) ──────────────────
                if (!_shellSpawned) {
                    _shellSpawned = true;
                    try {
                        const shellProcess = await instance.spawn('jsh', {
                            terminal: { cols: 80, rows: 24 },
                            env: { FORCE_COLOR: '1', TERM: 'xterm-256color', HOME: '/' },
                        });

                        shellProcess.output.pipeTo(
                            new WritableStream({
                                write(data) {
                                    writeShellOutput(data);
                                },
                            })
                        );

                        const writer = shellProcess.input.getWriter();

                        // Navigate to filesystem root BEFORE signaling ready.
                        // All files are written to / via fs.writeFile, so the
                        // shell CWD must match — otherwise npm can't find package.json.
                        await writer.write('cd /\n');

                        // Give jsh time to execute `cd /` before anyone sends more commands.
                        await new Promise(r => setTimeout(r, 500));

                        setShellWriter(writer);
                        setShellReady(true);

                        setShellResizeFn((dims) => shellProcess.resize?.(dims));

                        shellProcess.exit.then((code: number) => {
                            writeShellOutput(`\r\n\x1b[33mShell exited (code ${code})\x1b[0m\r\n`);
                            setShellWriter(null);
                            setShellReady(false);
                            setShellResizeFn(null);
                            _shellSpawned = false;
                        });

                        console.log('[WebContainer] jsh shell spawned');
                    } catch (shellErr) {
                        console.error('[WebContainer] Failed to spawn shell:', shellErr);
                        writeShellOutput(`\x1b[31mFailed to start shell: ${shellErr}\x1b[0m\r\n`);
                        _shellSpawned = false;
                    }
                }

                setIsLoading(false);
            } catch (err) {
                console.error('[WebContainer] Boot failed:', err);
                setError(err instanceof Error ? err.message : 'Unknown error');
                setIsLoading(false);
                _bootPromise = null; // Allow retry
            }
        };

        boot();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return { webContainer, isLoading, error };
};
