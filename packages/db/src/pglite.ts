/** PGlite adapter — PostgreSQL compiled to WebAssembly, used by the in-browser demo and fast tests. */
import { PGlite, type PGliteOptions, type Transaction } from '@electric-sql/pglite';
import { TYPE_OIDS, type Db, type QueryResult } from './index';

type Queryable = Pick<Transaction, 'query' | 'exec'>;

export const pgliteParsers = {
  [TYPE_OIDS.numeric]: (v: string) => Number(v),
  [TYPE_OIDS.int8]: (v: string) => Number(v),
  [TYPE_OIDS.date]: (v: string) => v,
};

function wrap(q: Queryable, inTransaction: boolean, root: PGlite): Db {
  const db: Db = {
    dialect: 'pglite',
    inTransaction,
    async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const r = await q.query<T>(sql, params as unknown[]);
      return { rows: r.rows, affectedRows: r.affectedRows };
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
    tx: inTransaction
      ? (fn) => fn(db)
      : <T>(fn: (db: Db) => Promise<T>) => root.transaction((t) => fn(wrap(t, true, root))),
  };
  return db;
}

export function wrapPglite(pglite: PGlite): Db & { pglite: PGlite } {
  return Object.assign(wrap(pglite, false, pglite), { pglite });
}

export async function createPgliteDb(dataDir?: string, opts: Omit<PGliteOptions, 'dataDir' | 'parsers'> = {}): Promise<Db & { pglite: PGlite }> {
  const pglite = new PGlite({ dataDir, parsers: pgliteParsers, ...opts });
  await pglite.waitReady;
  return wrapPglite(pglite);
}

export { PGlite };
