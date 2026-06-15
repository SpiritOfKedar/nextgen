import {
    MessageSquare,
    MonitorPlay,
    GitBranch,
    History,
    Layers,
    Cpu,
    Figma,
    Users,
    Sparkles,
    Zap,
    Boxes,
    Database,
    Hammer,
    Download,
    type LucideIcon,
} from 'lucide-react';

export type FeatureCategory = 'Product' | 'Platform';

export interface FeatureHighlight {
    icon: LucideIcon;
    title: string;
    description: string;
}

export interface FeatureDefinition {
    slug: string;
    title: string;
    category: FeatureCategory;
    icon: LucideIcon;
    eyebrow: string;
    headline: string;
    headlineMuted: string;
    description: string;
    badge?: string;
    highlights: FeatureHighlight[];
}

export const FEATURES: FeatureDefinition[] = [
    {
        slug: 'chat-to-build',
        title: 'Chat-to-Build',
        category: 'Product',
        icon: MessageSquare,
        eyebrow: '► PRODUCT',
        headline: 'Describe it.',
        headlineMuted: 'Watch it build.',
        description:
            'Type what you want in plain language. NextGen generates the files, runs install commands, and spins up a live preview — all from a single prompt.',
        highlights: [
            {
                icon: MessageSquare,
                title: 'Natural language input',
                description: 'No syntax, no scaffolding commands — just describe the app you want and the AI takes it from there.',
            },
            {
                icon: Sparkles,
                title: 'Streaming generation',
                description: 'Files and commands appear in real time as the model generates them, so you see progress instantly.',
            },
            {
                icon: Zap,
                title: 'End-to-end loop',
                description: 'From first word to running dev server in under a minute. No local setup required.',
            },
        ],
    },
    {
        slug: 'live-preview',
        title: 'Live Preview',
        category: 'Product',
        icon: MonitorPlay,
        eyebrow: '► PRODUCT',
        headline: 'See it running.',
        headlineMuted: 'Instantly.',
        description:
            'Every generated app runs in an in-browser Node sandbox with a real dev server. Preview updates live as files are written.',
        badge: 'LIVE',
        highlights: [
            {
                icon: MonitorPlay,
                title: 'In-browser sandbox',
                description: 'WebContainer runs npm and the dev server entirely in your browser — nothing to install locally.',
            },
            {
                icon: Layers,
                title: 'Auto dev server',
                description: 'Dependencies install and the dev server starts automatically after generation completes.',
            },
            {
                icon: Zap,
                title: 'Hot updates',
                description: 'As the AI writes files, the preview refreshes so you always see the latest version.',
            },
        ],
    },
    {
        slug: 'plan-and-build',
        title: 'Plan & Build',
        category: 'Product',
        icon: GitBranch,
        eyebrow: '► PRODUCT',
        headline: 'Plan first.',
        headlineMuted: 'Build second.',
        description:
            'Approve the architecture before a single line of code is written. Switch to build mode when you are ready to ship.',
        highlights: [
            {
                icon: GitBranch,
                title: 'Plan mode',
                description: 'The AI proposes structure, pages and data flow as a reviewable plan — no file writes allowed.',
            },
            {
                icon: Hammer,
                title: 'Build mode',
                description: 'Approved plans become real code: files stream in, commands execute, the preview updates live.',
            },
            {
                icon: Sparkles,
                title: 'Mode-aware prompts',
                description: 'Each mode uses tailored system prompts so the AI stays focused on planning or building.',
            },
        ],
    },
    {
        slug: 'version-history',
        title: 'Version History',
        category: 'Product',
        icon: History,
        eyebrow: '► PRODUCT',
        headline: 'Every generation.',
        headlineMuted: 'Immutable.',
        description:
            'Every AI generation is saved as a version. Roll any file — or the whole project — back in one click.',
        badge: 'EARLY ACCESS',
        highlights: [
            {
                icon: History,
                title: 'Per-generation snapshots',
                description: 'Each AI response creates an immutable version with full file diffs you can browse and restore.',
            },
            {
                icon: Database,
                title: 'Durable storage',
                description: 'Versions live in Neon Postgres — not ephemeral browser state — so history survives across sessions.',
            },
            {
                icon: Download,
                title: 'Selective restore',
                description: 'Restore individual files or the entire project to any previous generation.',
            },
        ],
    },
    {
        slug: 'sandbox',
        title: 'Sandbox',
        category: 'Platform',
        icon: Layers,
        eyebrow: '► PLATFORM',
        headline: 'Instant preview.',
        headlineMuted: 'Zero setup.',
        description:
            'Run your app in an in-browser sandbox the moment it is generated. Real terminal, real dependencies, real output.',
        highlights: [
            {
                icon: Layers,
                title: 'Zero setup',
                description: 'npm install and the dev server run automatically inside a WebContainer — nothing to install locally.',
            },
            {
                icon: Boxes,
                title: 'Real terminal',
                description: 'A full shell with persisted history and automatic error recovery when builds go sideways.',
            },
            {
                icon: Database,
                title: 'Dependency snapshots',
                description: 'Cached node_modules restore in seconds, so returning to a project never starts from scratch.',
            },
        ],
    },
    {
        slug: 'multi-model-ai',
        title: 'Multi-Model AI',
        category: 'Platform',
        icon: Cpu,
        eyebrow: '► PLATFORM',
        headline: 'Pick the right brain.',
        headlineMuted: 'One prompt box.',
        description:
            'OpenAI, Anthropic and Gemini behind one prompt — switch models without losing context or starting over.',
        highlights: [
            {
                icon: Cpu,
                title: 'Multi-provider',
                description: 'GPT, Claude and Gemini in a single dropdown. Use the best model for planning, coding or speed.',
            },
            {
                icon: Sparkles,
                title: 'Mode-aware prompts',
                description: 'Plan mode keeps the AI in architecture-only mode. Build mode unlocks file writes and shell commands.',
            },
            {
                icon: Zap,
                title: 'Streaming output',
                description: 'Responses stream token-by-token. Files and commands appear in real time as the model generates them.',
            },
        ],
    },
    {
        slug: 'figma-import',
        title: 'Figma Import',
        category: 'Platform',
        icon: Figma,
        eyebrow: '► PLATFORM',
        headline: 'Design to code.',
        headlineMuted: 'One link away.',
        description:
            'Paste a Figma link and the design context flows straight into the prompt. Build apps that match your designs.',
        highlights: [
            {
                icon: Figma,
                title: 'Link-based import',
                description: 'Paste any Figma file URL and NextGen extracts layout, components and styling context automatically.',
            },
            {
                icon: Hammer,
                title: 'Build mode integration',
                description: 'Design context is injected into build prompts so generated code reflects your Figma structure.',
            },
            {
                icon: Sparkles,
                title: 'Context-aware generation',
                description: 'The AI uses your design tokens, spacing and component hierarchy to produce accurate UI code.',
            },
        ],
    },
    {
        slug: 'collaboration',
        title: 'Collaboration',
        category: 'Platform',
        icon: Users,
        eyebrow: '► PLATFORM',
        headline: 'Every change versioned.',
        headlineMuted: 'Ship together.',
        description:
            'Restore any generation, invite collaborators, and export projects. Built for teams that move fast.',
        highlights: [
            {
                icon: History,
                title: 'Version history',
                description: 'Every AI generation is an immutable version. Roll any file — or the whole project — back in one click.',
            },
            {
                icon: Users,
                title: 'Collaborators',
                description: 'Invite editors to a project by email and build the same thread together.',
            },
            {
                icon: Download,
                title: 'Project export',
                description: 'Download the entire generated project as a zip and take it anywhere.',
            },
        ],
    },
];

export const getFeatureBySlug = (slug: string): FeatureDefinition | undefined =>
    FEATURES.find((f) => f.slug === slug);

export const getFeaturesByCategory = (category: FeatureCategory): FeatureDefinition[] =>
    FEATURES.filter((f) => f.category === category);

export const featureHref = (slug: string): string => `/features/${slug}`;

export const FOOTER_COLUMNS: {
    heading: string;
    links: { label: string; href: string }[];
}[] = [
    {
        heading: 'Product',
        links: getFeaturesByCategory('Product').map((f) => ({
            label: f.title,
            href: featureHref(f.slug),
        })),
    },
    {
        heading: 'Platform',
        links: getFeaturesByCategory('Platform').map((f) => ({
            label: f.title,
            href: featureHref(f.slug),
        })),
    },
    {
        heading: 'Resources',
        links: [
            { label: 'Documentation', href: '#' },
            { label: 'Changelog', href: '#' },
            { label: 'Community', href: '#' },
            { label: 'Support', href: '#' },
        ],
    },
    {
        heading: 'Company',
        links: [
            { label: 'About', href: '#' },
            { label: 'Legal', href: '#' },
            { label: 'Privacy', href: '#' },
        ],
    },
];
