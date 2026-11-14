/**
 * Minimal database abstraction shared by the server (node-postgres) and the in-browser demo (PGlite).
 * Everything above this layer is plain SQL, so the same queries run in both places.
 */
import init from './migrations/0001_init';

export interface QueryResult<T> {
  rows: T[];
  affectedRows?: number;
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Multi-statement SQL without parameters (migrations). */
  exec(sql: string): Promise<void>;
  /** Run `fn` in a transaction. Nested calls reuse the outer transaction. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  readonly inTransaction: boolean;
  readonly dialect: 'postgres' | 'pglite';
}

export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [{ id: '0001_init', sql: init }];

/** Apply pending migrations in order, each in its own transaction. Idempotent. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await db.query<{ id: string }>('SELECT id FROM schema_migrations');
  const done = new Set(rows.map((r) => r.id));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await db.tx(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
    });
    applied.push(m.id);
  }
  return applied;
}

/** Postgres type OIDs we parse into JS numbers / plain strings so both drivers return identical shapes. */
export const TYPE_OIDS = { int8: 20, numeric: 1700, date: 1082 } as const;

export function parseNumeric(value: string): number {
  return Number(value);
}

/** Postgres SQLSTATE codes we translate into domain errors. */
export const PG_ERRORS = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  serializationFailure: '40001',
  deadlock: '40P01',
} as const;

export function pgErrorCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') return (e as { code: string }).code;
  return undefined;
}

export function pgConstraint(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'constraint' in e) return String((e as { constraint: unknown }).constraint ?? '') || undefined;
  // PGlite surfaces the constraint name in the message
  if (e instanceof Error) {
    const m = /constraint "([^"]+)"/.exec(e.message);
    return m?.[1];
  }
  return undefined;
}
