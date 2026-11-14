import { formatDocNumber } from '@omborchi/core';
import type { Db } from '@omborchi/db';
import { notFound } from './errors';

export async function many<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function maybeOne<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await db.query<T>(sql, params)).rows[0] ?? null;
}

export async function one<T>(db: Db, sql: string, params: unknown[] = [], what = 'Record'): Promise<T> {
  const row = await maybeOne<T>(db, sql, params);
  if (!row) throw notFound(what);
  return row;
}

/** Multi-row INSERT, chunked to stay under Postgres' 65 535 parameter limit. */
export async function insertMany(db: Db, table: string, columns: string[], rows: unknown[][], suffix = ''): Promise<void> {
  if (rows.length === 0) return;
  const perChunk = Math.max(1, Math.floor(30000 / columns.length));
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const values = chunk.map((r) => {
      const ph = r.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    await db.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')} ${suffix}`, params);
  }
}

const PREFIX: Record<string, string> = {
  sale: 'S',
  return: 'R',
  receipt: 'GR',
  po: 'PO',
  transfer: 'TR',
  writeoff: 'WO',
  count: 'INV',
  shift: 'SH',
  sku: 'SKU',
  barcode: 'BC',
};

export async function nextNumber(db: Db, orgId: string, kind: keyof typeof PREFIX): Promise<string> {
  const { rows } = await db.query<{ last: number }>(
    `INSERT INTO doc_counters (org_id, kind, last) VALUES ($1, $2, 1)
     ON CONFLICT (org_id, kind) DO UPDATE SET last = doc_counters.last + 1 RETURNING last`,
    [orgId, kind],
  );
  return formatDocNumber(PREFIX[kind], rows[0].last);
}

export function like(q: string | undefined): string | null {
  if (!q || !q.trim()) return null;
  return `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Business days are Asia/Tashkent (UTC+5, no DST). These fragments are session-timezone independent. */
export const tsFrom = (param: string) => `((${param}::date)::timestamp - interval '5 hours') AT TIME ZONE 'UTC'`;
export const tsTo = (param: string) => `((${param}::date)::timestamp + interval '19 hours') AT TIME ZONE 'UTC'`;
export const localDay = (col: string) => `((${col} AT TIME ZONE 'UTC') + interval '5 hours')::date`;
