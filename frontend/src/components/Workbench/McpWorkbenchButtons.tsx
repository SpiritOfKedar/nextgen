import React, { useState, useRef } from 'react';
import { Figma } from 'lucide-react';
import { useAtom } from 'jotai';
import { manualFigmaLinksAtom, stitchContextAtom } from '../../store/mcpAttachments';
import { FigmaPanel } from '../Chat/FigmaPanel';
import { StitchPanel } from '../Chat/StitchPanel';

const StitchIcon = () => (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
        <path d="M12 2L2 7l10 5 10-5-10-5zm0 7.5L4.5 6.75 12 10.5l7.5-3.75L12 9.5zm-8 3.25L12 17.5l8-4.75v2.5L12 20l-8-4.75v-2.5z" />
    </svg>
);

export const McpWorkbenchButtons: React.FC = () => {
    const [manualFigmaLinks, setManualFigmaLinks] = useAtom(manualFigmaLinksAtom);
    const [stitchContext, setStitchContext] = useAtom(stitchContextAtom);
    const [showFigmaPanel, setShowFigmaPanel] = useState(false);
    const [showStitchPanel, setShowStitchPanel] = useState(false);
    const figmaRef = useRef<HTMLButtonElement>(null);
    const stitchRef = useRef<HTMLButtonElement>(null);

    const handleAddFigmaLink = (url: string) => {
        setManualFigmaLinks((prev) => {
            if (prev.includes(url)) return prev;
            return [...prev, url].slice(0, 3);
        });
    };

    const handleRemoveFigmaLink = (url: string) => {
        setManualFigmaLinks((prev) => prev.filter((l) => l !== url));
    };

    const iconBtnClass = (active: boolean) =>
        `inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            active
                ? 'text-zinc-100 bg-zinc-800 ring-1 ring-zinc-700'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
        }`;

    return (
        <>
            <button
                ref={figmaRef}
                type="button"
                onClick={() => {
                    setShowStitchPanel(false);
                    setShowFigmaPanel((v) => !v);
                }}
                className={iconBtnClass(showFigmaPanel || manualFigmaLinks.length > 0)}
                title="Figma MCP"
                aria-label="Figma MCP"
            >
                <Figma className="h-3.5 w-3.5" />
            </button>

            <button
                ref={stitchRef}
                type="button"
                onClick={() => {
                    setShowFigmaPanel(false);
                    setShowStitchPanel((v) => !v);
                }}
                className={iconBtnClass(showStitchPanel || !!stitchContext)}
                title="Google Stitch MCP"
                aria-label="Google Stitch MCP"
            >
                <StitchIcon />
            </button>

            <FigmaPanel
                anchorRef={figmaRef}
                isOpen={showFigmaPanel}
                onClose={() => setShowFigmaPanel(false)}
                figmaLinks={manualFigmaLinks.map((url) => ({ url }))}
                onAddLink={handleAddFigmaLink}
                onRemoveLink={handleRemoveFigmaLink}
                manualFigmaLinks={manualFigmaLinks}
            />

            <StitchPanel
                anchorRef={stitchRef}
                isOpen={showStitchPanel}
                onClose={() => setShowStitchPanel(false)}
                stitchContext={stitchContext}
                onStitchContextChange={setStitchContext}
            />
        </>
    );
};
