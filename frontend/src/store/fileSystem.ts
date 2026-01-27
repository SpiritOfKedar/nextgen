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

const initialFileSystem: FileSystemItem[] = [
    {
        type: 'folder',
        name: 'src',
        isOpen: true,
        children: [
            {
                type: 'file',
                name: 'main.tsx',
                content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`
            },
            {
                type: 'file',
                name: 'App.tsx',
                content: `import React, { useState } from 'react';
import './App.css';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="container">
      <h1>Hello from WebContainer! ⚡️</h1>
      <p>This is a real Node.js environment running in your browser.</p>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
      </div>
      <p className="read-the-docs">
        Edit <code>src/App.tsx</code> to see updates!
      </p>
    </div>
  );
}`
            },
            {
                type: 'file',
                name: 'index.css',
                content: `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

.container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}`
            },
            {
                type: 'file',
                name: 'App.css',
                content: `.read-the-docs { color: #888; }`
            }
        ]
    },
    {
        type: 'file',
        name: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`
    },
    {
        type: 'file',
        name: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
})`
    },
    {
        type: 'file',
        name: 'package.json',
        content: `{
  "name": "vite-react-starter",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.66",
    "@types/react-dom": "^18.2.22",
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.2.0"
  }
}`
    }
];

export const fileSystemAtom = atom<FileSystemItem[]>(initialFileSystem);
export const activeFileAtom = atom<FileNode | null>(null);
