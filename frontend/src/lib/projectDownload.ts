import JSZip from 'jszip';

export const EXCLUDED_ROOT_ENTRIES = new Set(['node_modules', '.boltly', '.git', '.env.local']);

export type ProjectFileEntry = {
  path: string;
  content: string;
};

const normalizePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.replace(/^\/+/, '').replace(/\/+/g, '/');
};

const getTimestamp = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
};

type DownloadProjectOptions = {
  fileNamePrefix?: string;
};

const readDirectoryEntries = async (wc: any, dirPath: string): Promise<string[]> => {
  const entries = await wc.fs.readdir(dirPath);
  return Array.isArray(entries) ? entries : [];
};

const isDirectory = async (wc: any, path: string): Promise<boolean> => {
  try {
    const stat = await wc.fs.stat(path);
    return !!stat?.isDirectory?.();
  } catch {
    return false;
  }
};

const collectDirectoryFiles = async (
  wc: any,
  absoluteDirPath: string,
  relativePath: string,
  out: ProjectFileEntry[],
): Promise<void> => {
  const entries = await readDirectoryEntries(wc, absoluteDirPath);

  for (const entry of entries) {
    if (!relativePath && EXCLUDED_ROOT_ENTRIES.has(entry)) continue;

    const childAbsPath = absoluteDirPath === '/' ? `/${entry}` : `${absoluteDirPath}/${entry}`;
    const childRelPath = normalizePath(relativePath ? `${relativePath}/${entry}` : entry);
    if (!childRelPath) continue;

    if (await isDirectory(wc, childAbsPath)) {
      await collectDirectoryFiles(wc, childAbsPath, childRelPath, out);
      continue;
    }

    try {
      const raw = await wc.fs.readFile(childAbsPath);
      const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      out.push({ path: childRelPath, content });
    } catch {
      // Ignore unreadable file and continue.
    }
  }
};

export const collectProjectFilesFromWebContainer = async (wc: any): Promise<ProjectFileEntry[]> => {
  if (!wc) throw new Error('WebContainer is not ready yet.');
  const files: ProjectFileEntry[] = [];
  await collectDirectoryFiles(wc, '/', '', files);
  return files;
};

const addDirectoryToZip = async (
  wc: any,
  zip: JSZip,
  absoluteDirPath: string,
  zipRelativePath: string,
): Promise<number> => {
  const entries = await readDirectoryEntries(wc, absoluteDirPath);
  let fileCount = 0;

  for (const entry of entries) {
    if (!zipRelativePath && EXCLUDED_ROOT_ENTRIES.has(entry)) continue;

    const childAbsPath = absoluteDirPath === '/' ? `/${entry}` : `${absoluteDirPath}/${entry}`;
    const childZipPath = normalizePath(zipRelativePath ? `${zipRelativePath}/${entry}` : entry);
    if (!childZipPath) continue;

    if (await isDirectory(wc, childAbsPath)) {
      zip.folder(childZipPath);
      fileCount += await addDirectoryToZip(wc, zip, childAbsPath, childZipPath);
      continue;
    }

    try {
      const content = await wc.fs.readFile(childAbsPath);
      zip.file(childZipPath, content);
      fileCount += 1;
    } catch {
      // Ignore unreadable file and continue archiving rest.
    }
  }

  return fileCount;
};

export const downloadProjectFromWebContainer = async (wc: any, options: DownloadProjectOptions = {}): Promise<number> => {
  const files = await collectProjectFilesFromWebContainer(wc);
  if (files.length === 0) {
    throw new Error('No project files found to download.');
  }

  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const fileName = `${options.fileNamePrefix || 'project'}-${getTimestamp()}.zip`;
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }

  return files.length;
};
