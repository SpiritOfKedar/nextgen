export type BoltActionType = 'file' | 'shell' | 'supabase-migration' | 'patch';

export interface BoltAction {
    type: BoltActionType;
    filePath?: string;
    /** Present on supabase-migration actions: the ordered migration id. */
    id?: string;
    content: string;
}

/**
 * Apply a patch action to an existing file's content.
 * Patch format uses search/replace blocks:
 *
 *   <<<<<<< SEARCH
 *   exact text to find
 *   =======
 *   replacement text
 *   >>>>>>> REPLACE
 *
 * Multiple blocks are applied in order. Returns null if any search string is not found.
 */
export function applyPatchToContent(original: string, patch: string): string | null {
    const SEARCH_MARKER = '<<<<<<< SEARCH';
    const SEP_MARKER = '=======';
    const REPLACE_MARKER = '>>>>>>> REPLACE';

    let result = original;
    let remaining = patch;

    while (remaining.includes(SEARCH_MARKER)) {
        const searchStart = remaining.indexOf(SEARCH_MARKER);
        const sepIdx = remaining.indexOf(SEP_MARKER, searchStart);
        const replaceEnd = remaining.indexOf(REPLACE_MARKER, sepIdx);

        if (searchStart === -1 || sepIdx === -1 || replaceEnd === -1) break;

        const searchText = remaining.slice(searchStart + SEARCH_MARKER.length, sepIdx).replace(/^\n/, '').replace(/\n$/, '');
        const replaceText = remaining.slice(sepIdx + SEP_MARKER.length, replaceEnd).replace(/^\n/, '').replace(/\n$/, '');

        if (!result.includes(searchText)) {
            // Search string not found — patch cannot be applied
            return null;
        }

        result = result.replace(searchText, replaceText);
        remaining = remaining.slice(replaceEnd + REPLACE_MARKER.length);
    }

    return result;
}

export interface BoltArtifact {
    id: string;
    title: string;
    actions: BoltAction[];
}

/** Models sometimes emit <artifact> / <action> instead of <boltArtifact> / <boltAction>. */
const ARTIFACT_OPEN_RE = /<(?:bolt)?[Aa]rtifact[^>]*>/;
const ARTIFACT_CLOSE_RE = /<\/(?:bolt)?[Aa]rtifact>/i;
const ACTION_OPEN_RE = /<(?:bolt)?[Aa]ction\s+([^>]*)>/;
const ACTION_CLOSE_RE = /<\/(?:bolt)?[Aa]ction>/i;

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

        let madeProgress = true;
        while (madeProgress) {
            madeProgress = false;

            if (!this.currentArtifact) {
                const match = this.buffer.match(ARTIFACT_OPEN_RE);
                if (match) {
                    this.buffer = this.buffer.substring(match.index! + match[0].length);
                    this.currentArtifact = { id: 'temp', title: 'temp', actions: [] };
                    madeProgress = true;
                    continue;
                }
            }

            // Parse actions inside an artifact, or standalone (model skipped the wrapper).
            if (!this.currentAction) {
                const match = this.buffer.match(ACTION_OPEN_RE);
                if (match) {
                    if (!this.currentArtifact) {
                        this.currentArtifact = { id: 'implicit', title: 'implicit', actions: [] };
                    }
                    const [fullMatch, attrs] = match;
                    const typeMatch = attrs.match(/type="([^"]+)"/);
                    const filePathMatch = attrs.match(/filePath="([^"]+)"/);
                    const idMatch = attrs.match(/id="([^"]+)"/);
                    this.currentAction = {
                        type: (typeMatch?.[1] || 'file') as BoltActionType,
                        filePath: filePathMatch?.[1],
                        id: idMatch?.[1],
                        content: '',
                    };
                    this.buffer = this.buffer.substring(match.index! + fullMatch.length);
                    madeProgress = true;
                    continue;
                }

                if (this.currentArtifact && ARTIFACT_CLOSE_RE.test(this.buffer)) {
                    const closeMatch = this.buffer.match(ARTIFACT_CLOSE_RE);
                    if (closeMatch && closeMatch.index !== undefined) {
                        this.currentArtifact = null;
                        this.buffer = this.buffer.substring(closeMatch.index + closeMatch[0].length);
                        madeProgress = true;
                        continue;
                    }
                }
            }

            if (this.currentAction) {
                const closeMatch = this.buffer.match(ACTION_CLOSE_RE);
                if (closeMatch && closeMatch.index !== undefined) {
                    this.currentAction.content += this.buffer.substring(0, closeMatch.index);
                    actionsFound.push({ ...this.currentAction });
                    this.currentAction = null;
                    this.buffer = this.buffer.substring(closeMatch.index + closeMatch[0].length);
                    madeProgress = true;
                    continue;
                }

                const safeLen = Math.max(0, this.buffer.length - 24);
                if (safeLen > 0) {
                    this.currentAction.content += this.buffer.substring(0, safeLen);
                    this.buffer = this.buffer.substring(safeLen);
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
