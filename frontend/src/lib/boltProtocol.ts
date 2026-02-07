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

    parse(chunk: string): BoltAction[] {
        this.buffer += chunk;
        const actionsFound: BoltAction[] = [];

        // Simple regex-based state machine for streaming (robust enough for this context)
        // Note: A full XML parser would be better for complex nesting, but regex works for the strict protocol.

        // Check for Artifact Open <boltArtifact ...>
        if (!this.currentArtifact) {
            const match = this.buffer.match(/<boltArtifact[^>]*>/);
            if (match) {
                this.buffer = this.buffer.substring(match.index! + match[0].length);
                this.currentArtifact = { id: 'temp', title: 'temp', actions: [] }; // Parse pattern extraction later if needed
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
                }
            }

            // If inside an action, look for closing tag
            if (this.currentAction) {
                const closeTag = '</boltAction>';
                const closeIndex = this.buffer.indexOf(closeTag);

                if (closeIndex !== -1) {
                    // Action completed
                    const content = this.buffer.substring(0, closeIndex);
                    this.currentAction.content += content;

                    actionsFound.push({ ...this.currentAction });

                    // Reset action
                    this.currentAction = null;
                    this.buffer = this.buffer.substring(closeIndex + closeTag.length);
                } else {
                    // Action continues, move almost all buffer to content (keep last few chars for partial tags)
                    // For safety, we just wait for the closing tag in a simple implementation, 
                    // OR we can stream the content if we want real-time updates.
                    // For now, let's buffer until we find the closing tag to be safe.
                    // Optimization: If buffer gets huge, flushed content.
                    if (this.buffer.length > 100000) {
                        // failsafe
                    }
                }
            } else {
                // Check for Artifact Close
                if (this.buffer.includes('</boltArtifact>')) {
                    this.currentArtifact = null;
                    this.buffer = ''; // Reset buffer
                }
            }
        }

        return actionsFound;
    }
}
