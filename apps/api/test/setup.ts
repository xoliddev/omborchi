import { migrate, type Db } from '@omborchi/db';
import { createPgDb, createPool } from '@omborchi/db/pg';
import type pg from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://omborchi:omborchi@127.0.0.1:55439/omborchi_test';

export async function setupDb(max = 20): Promise<{ db: Db; pool: pg.Pool }> {
  const pool = createPool(TEST_DATABASE_URL, max);
  const db = createPgDb(pool);
  await migrate(db);
  return { db, pool };
}

export const uniq = () => Math.random().toString(36).slice(2, 10);
