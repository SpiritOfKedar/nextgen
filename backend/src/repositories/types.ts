export interface UserRow {
    id: string;
    clerk_id: string;
    email: string;
    created_at: string;
}

export interface ThreadRow {
    id: string;
    user_id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'streaming' | 'complete' | 'error' | 'aborted';

export interface MessageRow {
    id: string;
    thread_id: string;
    user_id: string;
    role: MessageRole;
    seq: string; // bigint comes back as string from pg by default
    content: string;
    raw_content: string | null;
    model: string | null;
    status: MessageStatus;
    error: string | null;
    created_at: string;
    completed_at: string | null;
}

export interface FileVersionRow {
    id: string;
    thread_id: string;
    message_id: string;
    file_path: string;
    version: number;
    blob_sha256: string;
    is_deletion: boolean;
    created_at: string;
}

export interface ThreadFileStateRow {
    thread_id: string;
    file_path: string;
    current_version: number;
    current_blob_sha256: string;
    is_deleted: boolean;
    updated_at: string;
}

export interface CodeBlobRow {
    sha256: string;
    size_bytes: number;
    storage_path: string | null;
    mime_type: string;
    content: string | null;
    created_at: string;
}
