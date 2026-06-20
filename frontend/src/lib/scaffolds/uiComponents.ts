/** Canonical UI primitives for generated apps — injected when basic templates are detected. */

const INPUT_PATHS = ['src/components/ui/Input.tsx', 'src/components/ui/input.tsx'] as const;

export const IMPROVED_INPUT_SOURCE = `import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-2.5 text-sm text-slate-50',
          'placeholder:text-slate-500',
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
          'transition-[color,box-shadow,border-color] duration-200',
          'focus:outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/15',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
`;

const isBasicInputTemplate = (content: string): boolean =>
    content.includes('bg-slate-800')
    && content.includes('border-slate-700')
    && !content.includes('focus:border-amber')
    && !content.includes('focus:ring-amber');

/** Upgrade minimal UI primitives in-place. Returns paths that were updated. */
export function upgradeUiComponents(fileMap: Map<string, string>): string[] {
    const upgraded: string[] = [];

    for (const path of INPUT_PATHS) {
        const content = fileMap.get(path);
        if (!content || !isBasicInputTemplate(content)) continue;
        fileMap.set(path, IMPROVED_INPUT_SOURCE);
        upgraded.push(path);
    }

    return upgraded;
}
