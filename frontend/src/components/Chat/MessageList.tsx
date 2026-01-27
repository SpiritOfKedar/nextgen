
import React from 'react';
import { Check, CircleDashed, Loader2 } from 'lucide-react';

export const MessageList: React.FC = () => {
    return (
        <div className="space-y-6">
            {/* Initial Prompt */}
            <div className="text-zinc-400 text-sm">
                I'll build a fully functional to-do list application with Bolt Database backend.
            </div>

            {/* Plan Component */}
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-zinc-400 text-sm font-semibold uppercase tracking-wider">
                    <span className="i-ph-list-dashes" /> Plan
                </div>

                <div className="space-y-3 pl-2 border-l-2 border-zinc-800">
                    <PlanItem status="completed" text="Create database migration for todos table" />
                    <PlanItem status="completed" text="Set up Bolt Database client" />
                    <PlanItem status="current" text="Building to-do list UI components">
                        <div className="ml-6 mt-1 text-xs text-zinc-500 font-mono flex items-center gap-2">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-500" />
                            Reading <span className="text-zinc-300 bg-zinc-800 px-1 rounded">src/App.tsx</span>
                        </div>
                    </PlanItem>
                    <PlanItem status="pending" text="Run build to verify functionality" />
                </div>
            </div>
        </div>
    );
};

interface PlanItemProps {
    status: 'completed' | 'current' | 'pending';
    text: string;
    children?: React.ReactNode;
}

const PlanItem: React.FC<PlanItemProps> = ({ status, text, children }) => {
    let Icon;
    let textColor = "text-zinc-400";

    if (status === 'completed') {
        Icon = <Check className="w-5 h-5 text-green-500" />;
        textColor = "text-zinc-300";
    } else if (status === 'current') {
        Icon = <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
        textColor = "text-zinc-200";
    } else {
        Icon = <CircleDashed className="w-5 h-5 text-zinc-600" />;
        textColor = "text-zinc-500";
    }

    return (
        <div className="group">
            <div className={`flex items-start gap-3 ${textColor}`}>
                <div className="mt-0.5">{Icon}</div>
                <span className="leading-relaxed">{text}</span>
            </div>
            {children}
        </div>
    );
};
