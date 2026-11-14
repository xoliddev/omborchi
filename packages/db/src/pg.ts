/** node-postgres adapter (server). */
import pg from 'pg';
import { TYPE_OIDS, type Db, type QueryResult } from './index';

pg.types.setTypeParser(TYPE_OIDS.numeric, (v: string) => Number(v));
pg.types.setTypeParser(TYPE_OIDS.int8, (v: string) => Number(v));
pg.types.setTypeParser(TYPE_OIDS.date, (v: string) => v);

type Queryable = Pick<pg.PoolClient, 'query'>;

function wrap(client: Queryable, inTransaction: boolean, beginTx: <T>(fn: (db: Db) => Promise<T>) => Promise<T>): Db {
  const db: Db = {
    dialect: 'postgres',
    inTransaction,
    async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const r = await client.query(sql, params as unknown[]);
      return { rows: r.rows as T[], affectedRows: r.rowCount ?? undefined };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
    tx: inTransaction ? (fn) => fn(db) : beginTx,
  };
  return db;
}

export function createPgDb(pool: pg.Pool): Db & { pool: pg.Pool } {
  const beginTx = async <T>(fn: (db: Db) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inner = wrap(client, true, beginTx);
      const result = await fn(inner);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };
  return Object.assign(wrap(pool, false, beginTx), { pool });
}

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}
