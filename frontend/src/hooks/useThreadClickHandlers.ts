import { useRef, useCallback } from 'react';

export const useThreadClickHandlers = ({
    onOpen,
    onDelete,
}: {
    onOpen: (threadId: string) => void;
    onDelete: (threadId: string) => void | Promise<void>;
}) => {
    const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleClick = useCallback((threadId: string) => {
        if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
        clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null;
            onOpen(threadId);
        }, 250);
    }, [onOpen]);

    const handleDoubleClick = useCallback((e: React.MouseEvent, threadId: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
        }
        void onDelete(threadId);
    }, [onDelete]);

    return { handleClick, handleDoubleClick };
};
