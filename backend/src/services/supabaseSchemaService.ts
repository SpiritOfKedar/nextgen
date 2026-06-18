import { Client } from 'pg';
import { log, errorFields } from '../lib/logger';

export interface SchemaColumn {
    name: string;
    type: string;
    nullable: boolean;
}

export interface SchemaTable {
    name: string;
    columns: SchemaColumn[];
    rlsEnabled: boolean;
}

export interface SchemaSnapshot {
    tables: SchemaTable[];
    fetchedAt: string;
}

const createUserDbClient = (databaseUrl: string): Client =>
    new Client({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
        statement_timeout: 15_000,
        connectionTimeoutMillis: 15_000,
    });

/**
 * Read the `public` schema (tables, columns, RLS state) so the AI can reason about
 * the user's existing database without ever seeing credentials. Best-effort: returns
 * null on failure so callers can degrade gracefully.
 */
export const fetchSchemaSnapshot = async (
    databaseUrl: string,
    requestId?: string,
): Promise<SchemaSnapshot | null> => {
    const client = createUserDbClient(databaseUrl);
    try {
        await client.connect();

        const { rows: columnRows } = await client.query(`
            SELECT table_name, column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `);

        const { rows: rlsRows } = await client.query(`
            SELECT relname AS table_name, relrowsecurity AS rls_enabled
            FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
        `);

        const rlsByTable = new Map<string, boolean>();
        for (const r of rlsRows) rlsByTable.set(r.table_name, r.rls_enabled === true);

        const tableMap = new Map<string, SchemaTable>();
        for (const r of columnRows) {
            let table = tableMap.get(r.table_name);
            if (!table) {
                table = { name: r.table_name, columns: [], rlsEnabled: rlsByTable.get(r.table_name) ?? false };
                tableMap.set(r.table_name, table);
            }
            table.columns.push({
                name: r.column_name,
                type: r.data_type,
                nullable: r.is_nullable === 'YES',
            });
        }

        return { tables: [...tableMap.values()], fetchedAt: new Date().toISOString() };
    } catch (error) {
        log.warn('supabase.schema_snapshot_failed', { requestId, ...errorFields(error) });
        return null;
    } finally {
        await client.end().catch(() => { /* ignore */ });
    }
};
