import { Octokit } from '@octokit/rest';
import { getPool } from '../config/db';
import * as threadsRepo from '../repositories/threads';
import { ThreadAccessError } from './chatService';
import { log, errorFields } from '../lib/logger';

const EXCLUDED_PATH_SEGMENTS = new Set(['node_modules', '.boltly', '.git']);

export type PushFileEntry = {
    path: string;
    content: string;
};

export type PushToGitHubInput = {
    userId: string;
    threadId: string;
    mode: 'create' | 'existing';
    owner?: string;
    repo: string;
    branch?: string;
    commitMessage: string;
    isPrivate?: boolean;
    files: PushFileEntry[];
};

export type PushToGitHubResult = {
    owner: string;
    repo: string;
    branch: string;
    commitSha: string;
    fileCount: number;
    htmlUrl: string;
};

const isSafeRelativePath = (filePath: string): boolean => {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) return false;
    const segments = normalized.split('/');
    if (segments.some((seg) => EXCLUDED_PATH_SEGMENTS.has(seg))) return false;
    return true;
};

const sanitizeFiles = (files: PushFileEntry[]): PushFileEntry[] => {
    const out: PushFileEntry[] = [];
    const seen = new Set<string>();
    for (const file of files) {
        if (!file?.path || typeof file.content !== 'string') continue;
        const path = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!isSafeRelativePath(path) || seen.has(path)) continue;
        seen.add(path);
        out.push({ path, content: file.content });
    }
    return out;
};

export const validateGitHubToken = async (accessToken: string): Promise<{ login: string }> => {
    const octokit = new Octokit({ auth: accessToken });
    const { data } = await octokit.users.getAuthenticated();
    return { login: data.login };
};

export const pushProjectToGitHub = async (input: PushToGitHubInput): Promise<PushToGitHubResult> => {
    const thread = await threadsRepo.findByIdForUser(input.threadId, input.userId);
    if (!thread) throw new ThreadAccessError();

    const { rows } = await getPool().query(
        `SELECT access_token, github_login FROM public.user_github_connections WHERE user_id = $1 AND enabled = true`,
        [input.userId],
    );
    const conn = rows[0];
    if (!conn?.access_token) {
        throw new Error('GitHub is not connected. Connect a Personal Access Token first.');
    }

    const files = sanitizeFiles(input.files);
    if (files.length === 0) {
        throw new Error('No valid project files to push.');
    }

    const branch = (input.branch || 'main').trim() || 'main';
    const octokit = new Octokit({ auth: conn.access_token });
    const authUser = conn.github_login || (await validateGitHubToken(conn.access_token)).login;

    let owner = (input.owner || authUser).trim();
    let repo = input.repo.trim();
    if (!repo) throw new Error('Repository name is required.');

    if (input.mode === 'create') {
        try {
            await octokit.repos.get({ owner, repo });
        } catch (error: any) {
            if (error?.status === 404) {
                const created = await octokit.repos.createForAuthenticatedUser({
                    name: repo,
                    private: !!input.isPrivate,
                    auto_init: false,
                });
                owner = created.data.owner?.login || owner;
                repo = created.data.name;
            } else {
                throw error;
            }
        }
    } else {
        if (!input.owner?.trim()) {
            throw new Error('Repository owner is required when pushing to an existing repo.');
        }
        await octokit.repos.get({ owner, repo });
    }

    let parentSha: string | undefined;
    try {
        const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
        parentSha = ref.data.object.sha;
    } catch (error: any) {
        if (error?.status !== 404) throw error;
    }

    const treeItems: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
    for (const file of files) {
        const blob = await octokit.git.createBlob({
            owner,
            repo,
            content: file.content,
            encoding: 'utf-8',
        });
        treeItems.push({
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: blob.data.sha,
        });
    }

    const tree = await octokit.git.createTree({
        owner,
        repo,
        tree: treeItems,
        ...(parentSha ? { base_tree: undefined } : {}),
    });

    const commit = await octokit.git.createCommit({
        owner,
        repo,
        message: input.commitMessage.trim() || 'Update from NextGen',
        tree: tree.data.sha,
        ...(parentSha ? { parents: [parentSha] } : {}),
    });

    if (parentSha) {
        await octokit.git.updateRef({
            owner,
            repo,
            ref: `heads/${branch}`,
            sha: commit.data.sha,
        });
    } else {
        await octokit.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${branch}`,
            sha: commit.data.sha,
        });
    }

    await getPool().query(
        `INSERT INTO public.thread_github_links (thread_id, owner, repo, default_branch, last_pushed_sha, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (thread_id) DO UPDATE SET
           owner = EXCLUDED.owner,
           repo = EXCLUDED.repo,
           default_branch = EXCLUDED.default_branch,
           last_pushed_sha = EXCLUDED.last_pushed_sha,
           updated_at = NOW()`,
        [input.threadId, owner, repo, branch, commit.data.sha],
    );

    const htmlUrl = `https://github.com/${owner}/${repo}`;

    log.info('github.push_success', {
        userId: input.userId,
        threadId: input.threadId,
        owner,
        repo,
        branch,
        fileCount: files.length,
    });

    return {
        owner,
        repo,
        branch,
        commitSha: commit.data.sha,
        fileCount: files.length,
        htmlUrl,
    };
};

export const getThreadGitHubLink = async (threadId: string, userId: string) => {
    const thread = await threadsRepo.findByIdForUser(threadId, userId);
    if (!thread) throw new ThreadAccessError();
    const { rows } = await getPool().query(
        `SELECT owner, repo, default_branch, last_pushed_sha, updated_at
         FROM public.thread_github_links WHERE thread_id = $1`,
        [threadId],
    );
    return rows[0] ?? null;
};
