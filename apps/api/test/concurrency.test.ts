/**
 * Concurrency on a real PostgreSQL server: many connections selling the same last items at once
 * must never oversell, and the ledger must still balance afterwards.
 */
import { createOrganisation, dispatch, routes, type Actor, type AppError } from '@omborchi/app';
import type { Db } from '@omborchi/db';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupDb, uniq } from './setup';

let db: Db;
let pool: pg.Pool;

beforeAll(async () => {
  ({ db, pool } = await setupDb(30));
});
afterAll(async () => pool.end());

async function shop(stock: number, cashiers: number) {
  const { orgId, userId, warehouseId } = await createOrganisation(db, { name: 'Race', slug: `race-${uniq()}`, owner: { email: `race-${uniq()}@t.uz`, name: 'O', passwordHash: null } });
  const owner: Actor = { userId, orgId, role: 'owner', warehouseIds: null, name: 'O', email: 'o@t.uz' };
  const ctx = (actor: Actor) => ({ db, actor, now: () => new Date(), hashPassword: async (p: string) => p });
  const p = await dispatch(routes['products.save'], ctx(owner), { name: 'Oxirgi non', baseUnit: 'dona', variants: [{ name: '', cost: 3000, prices: { retail: 4000 } }] });
  const v = (await db.query<{ id: string }>('SELECT id FROM variants WHERE product_id = $1', [p.id])).rows[0].id;
  const s = await dispatch(routes['suppliers.save'], ctx(owner), { name: 'Novvoyxona' });
  await dispatch(routes['stock.receive'], ctx(owner), { supplierId: s.id, warehouseId, lines: [{ variantId: v, qty: stock, unitCost: 3000 }] });
  const actors: Actor[] = [];
  for (let i = 0; i < cashiers; i++) {
    const u = await db.query<{ id: string }>('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id', [`k${i}-${uniq()}@t.uz`, `Kassir ${i}`]);
    await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'cashier')`, [orgId, u.rows[0].id]);
    const a: Actor = { userId: u.rows[0].id, orgId, role: 'cashier', warehouseIds: null, name: `K${i}`, email: '' };
    await dispatch(routes['shifts.open'], ctx(a), { warehouseId });
    actors.push(a);
  }
  const sell = (a: Actor, qty = 1) => dispatch(routes['sales.create'], ctx(a), { warehouseId, lines: [{ variantId: v, qty }], payments: [{ method: 'cash', amount: 4000 * qty }] });
  const qty = async () => (await db.query<{ qty: number }>('SELECT qty FROM stock_balances WHERE variant_id = $1', [v])).rows[0].qty;
  return { v, actors, sell, qty, warehouseId, orgId };
}

describe('concurrency on PostgreSQL', () => {
  it('two cashiers selling the last item at the same moment: exactly one succeeds', async () => {
    const s = await shop(1, 2);
    const results = await Promise.allSettled([s.sell(s.actors[0]), s.sell(s.actors[1])]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe('INSUFFICIENT_STOCK');
    expect(await s.qty()).toBe(0);
  });

  it('20 parallel sales against 10 units: 10 succeed, stock ends at exactly 0, ledger balances', async () => {
    const s = await shop(10, 20);
    const results = await Promise.allSettled(s.actors.map((a) => s.sell(a)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    for (const r of results) if (r.status === 'rejected') expect((r.reason as AppError).code).toBe('INSUFFICIENT_STOCK');
    expect(await s.qty()).toBe(0);
    const sales = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM sales WHERE org_id = $1', [s.orgId]);
    expect(sales.rows[0].n).toBe(10);
    const drift = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM stock_drift');
    expect(drift.rows[0].n).toBe(0);
  });

  it('the database itself refuses an oversell even if the application check is bypassed', async () => {
    const s = await shop(1, 0);
    const raw = (qty: number) =>
      db.tx((tx) =>
        tx.query(
          `INSERT INTO stock_movements (org_id, warehouse_id, variant_id, kind, qty, unit_cost, cost_value, doc_type) VALUES ($1,$2,$3,'sale',$4,3000,$5,'raw')`,
          [s.orgId, s.warehouseId, s.v, -qty, -3000 * qty],
        ),
      );
    const results = await Promise.allSettled([raw(1), raw(1)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/stock_never_negative/);
    expect(await s.qty()).toBe(0);
  });
});
