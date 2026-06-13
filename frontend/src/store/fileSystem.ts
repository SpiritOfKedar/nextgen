import { atom } from 'jotai';

export type FileSystemItem = FileNode | FolderNode;

export interface FileNode {
    type: 'file';
    name: string;
    content: string;
}

export interface FolderNode {
    type: 'folder';
    name: string;
    children: FileSystemItem[];
    isOpen?: boolean;
}

const initialFileSystem: FileSystemItem[] = [];

export const fileSystemAtom = atom<FileSystemItem[]>(initialFileSystem);

export interface ActiveFile {
    path: string;
    name: string;
    content: string;
}

/** @deprecated use editorTabsAtom — kept for type exports */
export type EditorTab = ActiveFile & { dirty?: boolean };

export const editorTabsAtom = atom<EditorTab[]>([]);
export const activeEditorTabPathAtom = atom<string | null>(null);

export const activeEditorTabAtom = atom((get) => {
    const path = get(activeEditorTabPathAtom);
    if (!path) return null;
    return get(editorTabsAtom).find((tab) => tab.path === path) ?? null;
});

const normalizePath = (path: string): string => path.replace(/^\//, '');

export const openEditorTabAtom = atom(
    null,
    (get, set, input: ActiveFile & { focus?: boolean }) => {
        const path = normalizePath(input.path);
        const tabs = get(editorTabsAtom);
        const existingIndex = tabs.findIndex((tab) => tab.path === path);

        if (existingIndex >= 0) {
            const next = [...tabs];
            next[existingIndex] = {
                ...next[existingIndex],
                name: input.name,
                content: input.content,
            };
            set(editorTabsAtom, next);
        } else {
            set(editorTabsAtom, [...tabs, { path, name: input.name, content: input.content, dirty: false }]);
        }

        if (input.focus !== false) {
            set(activeEditorTabPathAtom, path);
        }
    },
);

export const closeEditorTabAtom = atom(null, (get, set, path: string) => {
    const normalized = normalizePath(path);
    const tabs = get(editorTabsAtom).filter((tab) => tab.path !== normalized);
    set(editorTabsAtom, tabs);

    const active = get(activeEditorTabPathAtom);
    if (active === normalized) {
        set(activeEditorTabPathAtom, tabs.length > 0 ? tabs[tabs.length - 1].path : null);
    }
});

export const setActiveEditorTabAtom = atom(null, (get, set, path: string) => {
    const normalized = normalizePath(path);
    if (get(editorTabsAtom).some((tab) => tab.path === normalized)) {
        set(activeEditorTabPathAtom, normalized);
    }
});

export const clearEditorTabsAtom = atom(null, (_get, set) => {
    set(editorTabsAtom, []);
    set(activeEditorTabPathAtom, null);
});

export const updateEditorTabContentAtom = atom(
    null,
    (get, set, input: { path: string; content: string; dirty?: boolean }) => {
        const path = normalizePath(input.path);
        set(
            editorTabsAtom,
            get(editorTabsAtom).map((tab) =>
                tab.path === path
                    ? { ...tab, content: input.content, dirty: input.dirty ?? tab.dirty }
                    : tab,
            ),
        );
    },
);

/** Back-compat alias */
export const activeFileAtom = activeEditorTabAtom;
