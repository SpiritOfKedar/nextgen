import type { SupabaseMigrationInput } from './supabaseSandboxEnv';

const MIGRATION_PATH_RE = /^supabase\/migrations\/(.+)\.sql$/i;

export function migrationIdFromPath(filePath: string): string | null {
    const normalized = filePath.replace(/^\//, '');
    const match = normalized.match(MIGRATION_PATH_RE);
    return match?.[1] ?? null;
}

export function collectMigrationsFromFileMap(
    fileMap: Map<string, string> | Iterable<[string, string]>,
): SupabaseMigrationInput[] {
    const migrations: SupabaseMigrationInput[] = [];
    for (const [filePath, content] of fileMap) {
        const migrationId = migrationIdFromPath(filePath);
        const sql = content.trim();
        if (!migrationId || !sql) continue;
        migrations.push({ migrationId, sql });
    }
    migrations.sort((a, b) => a.migrationId.localeCompare(b.migrationId));
    return migrations;
}

export function mergeMigrationInputs(
    ...lists: SupabaseMigrationInput[][]
): SupabaseMigrationInput[] {
    const byId = new Map<string, string>();
    for (const list of lists) {
        for (const item of list) {
            const id = item.migrationId.trim();
            const sql = item.sql.trim();
            if (!id || !sql) continue;
            byId.set(id, sql);
        }
    }
    return [...byId.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([migrationId, sql]) => ({ migrationId, sql }));
}
