export type BoltActionType = 'file' | 'shell';

export interface BoltAction {
    type: BoltActionType;
    filePath?: string;
    content: string;
}

export interface BoltArtifact {
    id: string;
    title: string;
    actions: BoltAction[];
}

export class BoltParser {
    private buffer = '';
    private currentArtifact: BoltArtifact | null = null;
    private currentAction: BoltAction | null = null;

    /**
     * Parse a streaming chunk and return ALL complete actions found.
     * Loops internally so multiple actions in a single chunk are all emitted.
     */
    parse(chunk: string): BoltAction[] {
        this.buffer += chunk;
        const actionsFound: BoltAction[] = [];

        // Loop until no more progress can be made in this call
        let madeProgress = true;
        while (madeProgress) {
            madeProgress = false;

            // Check for Artifact Open <boltArtifact ...>
            if (!this.currentArtifact) {
                const match = this.buffer.match(/<boltArtifact[^>]*>/);
                if (match) {
                    this.buffer = this.buffer.substring(match.index! + match[0].length);
                    this.currentArtifact = { id: 'temp', title: 'temp', actions: [] };
                    madeProgress = true;
                    continue;
                }
            }

            if (this.currentArtifact) {
                // Check for Action Open <boltAction ...>
                if (!this.currentAction) {
                    const match = this.buffer.match(/<boltAction\s+([^>]*)>/);
                    if (match) {
                        const [fullMatch, attrs] = match;
                        const typeMatch = attrs.match(/type="([^"]+)"/);
                        const filePathMatch = attrs.match(/filePath="([^"]+)"/);
                        this.currentAction = {
                            type: (typeMatch?.[1] || 'file') as BoltActionType,
                            filePath: filePathMatch?.[1],
                            content: ''
                        };
                        this.buffer = this.buffer.substring(match.index! + fullMatch.length);
                        madeProgress = true;
                        continue;
                    }

                    // Check for Artifact Close (only when not inside an action)
                    if (this.buffer.includes('</boltArtifact>')) {
                        this.currentArtifact = null;
                        this.buffer = '';
                        madeProgress = true;
                        continue;
                    }
                }

                // If inside an action, look for closing tag
                if (this.currentAction) {
                    const closeTag = '</boltAction>';
                    const closeIndex = this.buffer.indexOf(closeTag);

                    if (closeIndex !== -1) {
                        this.currentAction.content += this.buffer.substring(0, closeIndex);
                        actionsFound.push({ ...this.currentAction });
                        this.currentAction = null;
                        this.buffer = this.buffer.substring(closeIndex + closeTag.length);
                        madeProgress = true;
                        continue;
                    } else {
                        // No closing tag yet — accumulate the buffer into the action
                        // content BUT keep the last 20 chars in buffer in case the
                        // closing tag was split across chunks (e.g. "</boltAc" + "tion>")
                        const safeLen = Math.max(0, this.buffer.length - 20);
                        if (safeLen > 0) {
                            this.currentAction.content += this.buffer.substring(0, safeLen);
                            this.buffer = this.buffer.substring(safeLen);
                            // Don't set madeProgress — we're just accumulating, not
                            // completing an action. Prevents infinite loop.
                        }
                    }
                }
            }
        }

        return actionsFound;
    }

    /** Reset parser state — use when switching threads */
    reset() {
        this.buffer = '';
        this.currentArtifact = null;
        this.currentAction = null;
    }
}
