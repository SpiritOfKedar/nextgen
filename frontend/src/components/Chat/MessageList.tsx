
import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Check, Copy, FileCode, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { messagesAtom } from '../../store/atoms';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

export const MessageList: React.FC = () => {
    const messages = useAtomValue(messagesAtom);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    if (messages.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                Send a message to start building
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {messages.map((msg) => (
                <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                    {msg.role === 'assistant' && (
                        <div className="w-7 h-7 rounded-full bg-linear-to-br from-blue-500 to-violet-600 flex items-center justify-center mr-3 mt-0.5 shrink-0">
                            <Sparkles className="w-3.5 h-3.5 text-white" />
                        </div>
                    )}
                    <div
                        className={`text-sm leading-relaxed ${
                            msg.role === 'user'
                                ? 'max-w-[75%] bg-zinc-800 text-zinc-100 rounded-2xl rounded-br-sm px-4 py-2.5'
                                : 'max-w-[90%] text-zinc-300'
                        }`}
                    >
                        {msg.role === 'assistant' ? (
                            <AssistantMessage content={msg.content} />
                        ) : (
                            msg.content
                        )}
                    </div>
                </div>
            ))}
            <div ref={bottomRef} />
        </div>
    );
};

// Copy button for code blocks
const CopyButton: React.FC<{ text: string }> = ({ text }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [text]);

    return (
        <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1 rounded hover:bg-zinc-700/50"
        >
            {copied ? (
                <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied</span>
                </>
            ) : (
                <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                </>
            )}
        </button>
    );
};

// File actions summary (collapsible)
const FileActionsSummary: React.FC<{ content: string }> = ({ content }) => {
    const [isOpen, setIsOpen] = useState(false);

    // Extract file paths from "Generated N files:" block
    const fileMatch = content.match(/Generated \d+ files?:\n([\s\S]*)/);
    if (!fileMatch) return null;

    const files = fileMatch[1]
        .split('\n')
        .filter((l) => l.trim().startsWith('-'))
        .map((l) => l.replace(/^[-•*]\s*(?:Creating\s+)?/, '').trim())
        .filter(Boolean);

    if (files.length === 0) return null;

    return (
        <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
            >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <FileCode className="w-3.5 h-3.5 text-blue-400" />
                <span className="font-medium text-zinc-300">{files.length} file{files.length > 1 ? 's' : ''} generated</span>
            </button>
            {isOpen && (
                <div className="px-3 pb-2 space-y-1">
                    {files.map((file, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-zinc-500 pl-5">
                            <FileCode className="w-3 h-3 text-zinc-600" />
                            <span className="font-mono">{file}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Language display name map
const langDisplayName: Record<string, string> = {
    js: 'JavaScript', javascript: 'JavaScript',
    ts: 'TypeScript', typescript: 'TypeScript',
    tsx: 'TSX', jsx: 'JSX',
    py: 'Python', python: 'Python',
    css: 'CSS', html: 'HTML',
    json: 'JSON', bash: 'Bash', sh: 'Shell',
    sql: 'SQL', yaml: 'YAML', yml: 'YAML',
    md: 'Markdown', markdown: 'Markdown',
    rust: 'Rust', go: 'Go', java: 'Java',
    cpp: 'C++', c: 'C', ruby: 'Ruby',
    php: 'PHP', swift: 'Swift', kotlin: 'Kotlin',
};

// Renders assistant messages with proper markdown
const AssistantMessage: React.FC<{ content: string }> = memo(({ content }) => {
    if (!content) {
        return (
            <div className="flex items-center gap-2 text-zinc-500">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-zinc-400" />
                <span className="text-xs">Generating...</span>
            </div>
        );
    }

    // Separate file summary from narrative text
    const hasFileSummary = /^Generated \d+ files?:\n/.test(content);
    const narrativeContent = hasFileSummary
        ? content.replace(/^Generated \d+ files?:\n(?:[-•*]\s*(?:Creating\s+)?[\w/.\-]+\n?)+/, '').trim()
        : content;

    return (
        <div className="chat-markdown">
            {hasFileSummary && <FileActionsSummary content={content} />}
            {narrativeContent && (
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        // Code blocks with syntax highlighting
                        code({ className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            const codeString = String(children).replace(/\n$/, '');
                            const isInline = !match && !codeString.includes('\n');

                            if (isInline) {
                                return (
                                    <code className="bg-zinc-800 text-zinc-200 px-1.5 py-0.5 rounded text-[13px] font-mono" {...props}>
                                        {children}
                                    </code>
                                );
                            }

                            const language = match?.[1] || 'text';
                            const displayLang = langDisplayName[language] || language;

                            return (
                                <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden my-3 group">
                                    <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/60 border-b border-zinc-800">
                                        <span className="text-xs text-zinc-400 font-medium">{displayLang}</span>
                                        <CopyButton text={codeString} />
                                    </div>
                                    <SyntaxHighlighter
                                        style={oneDark}
                                        language={language}
                                        PreTag="div"
                                        customStyle={{
                                            margin: 0,
                                            padding: '16px',
                                            background: 'transparent',
                                            fontSize: '13px',
                                            lineHeight: '1.6',
                                        }}
                                        codeTagProps={{
                                            style: { fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" },
                                        }}
                                    >
                                        {codeString}
                                    </SyntaxHighlighter>
                                </div>
                            );
                        },
                        // Paragraphs
                        p({ children }) {
                            return <p className="text-zinc-300 text-sm leading-relaxed mb-3 last:mb-0">{children}</p>;
                        },
                        // Headings
                        h1({ children }) {
                            return <h1 className="text-lg font-semibold text-zinc-100 mt-5 mb-2">{children}</h1>;
                        },
                        h2({ children }) {
                            return <h2 className="text-base font-semibold text-zinc-100 mt-4 mb-2">{children}</h2>;
                        },
                        h3({ children }) {
                            return <h3 className="text-sm font-semibold text-zinc-200 mt-3 mb-1.5">{children}</h3>;
                        },
                        // Lists
                        ul({ children }) {
                            return <ul className="list-disc list-outside ml-5 space-y-1 mb-3 text-sm text-zinc-300">{children}</ul>;
                        },
                        ol({ children }) {
                            return <ol className="list-decimal list-outside ml-5 space-y-1 mb-3 text-sm text-zinc-300">{children}</ol>;
                        },
                        li({ children }) {
                            return <li className="text-zinc-300 leading-relaxed pl-1">{children}</li>;
                        },
                        // Bold / Italic
                        strong({ children }) {
                            return <strong className="font-semibold text-zinc-100">{children}</strong>;
                        },
                        em({ children }) {
                            return <em className="italic text-zinc-400">{children}</em>;
                        },
                        // Links
                        a({ href, children }) {
                            return (
                                <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors">
                                    {children}
                                </a>
                            );
                        },
                        // Blockquotes
                        blockquote({ children }) {
                            return (
                                <blockquote className="border-l-2 border-zinc-700 pl-4 my-3 text-zinc-400 italic">
                                    {children}
                                </blockquote>
                            );
                        },
                        // Horizontal rule
                        hr() {
                            return <hr className="border-zinc-800 my-4" />;
                        },
                        // Tables
                        table({ children }) {
                            return (
                                <div className="overflow-x-auto my-3 rounded-lg border border-zinc-800">
                                    <table className="w-full text-sm text-left text-zinc-300">{children}</table>
                                </div>
                            );
                        },
                        thead({ children }) {
                            return <thead className="text-xs text-zinc-400 uppercase bg-zinc-800/50">{children}</thead>;
                        },
                        th({ children }) {
                            return <th className="px-4 py-2 font-medium">{children}</th>;
                        },
                        td({ children }) {
                            return <td className="px-4 py-2 border-t border-zinc-800">{children}</td>;
                        },
                        // Pre (wrapper for code blocks)
                        pre({ children }) {
                            return <>{children}</>;
                        },
                    }}
                >
                    {narrativeContent}
                </ReactMarkdown>
            )}
        </div>
    );
});
