import { describe, expect, it } from 'vitest';
import { dispatch, routes, seedDemo, type Actor } from '../src';
import { drift, testDb } from './helpers';

describe('demo seed + reports', () => {
  it('generates a consistent business and every report answers', async () => {
    const db = await testDb();
    const now = new Date();
    const seeded = await seedDemo(db, { days: 21, volume: 0.25, now, seed: 7 });
    expect(seeded.counts.variants).toBeGreaterThan(280);
    expect(seeded.counts.sales).toBeGreaterThan(100);
    expect(await drift(db)).toBe(0);
    const neg = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM stock_balances WHERE qty < 0');
    expect(neg.rows[0].n).toBe(0);

    const owner = seeded.users.find((u) => u.role === 'owner')!;
    const actor: Actor = { userId: owner.userId, orgId: seeded.orgId, role: 'owner', warehouseIds: null, name: owner.name, email: owner.email };
    const call = <K extends keyof typeof routes>(k: K, input: object) => dispatch(routes[k], { db, actor, now: () => now, hashPassword: async (p) => p }, input);

    const dash = await call('reports.dashboard', {});
    expect(dash.current.revenue).toBeGreaterThan(0);
    expect(dash.current.profit).toBeGreaterThan(0);
    expect(dash.series).toHaveLength(30);
    expect(dash.topProducts.length).toBeGreaterThan(3);
    const abc = await call('reports.abc', {});
    expect(abc.classes.map((c) => c.class)).toEqual(['A', 'B', 'C']);
    expect(abc.classes[0].share).toBeGreaterThanOrEqual(0.79);
    const value = await call('reports.stockValue', {});
    expect(value.total).toBeGreaterThan(0);
    const dead = await call('reports.deadStock', { days: 14 });
    expect(dead.rows.length).toBeGreaterThan(0);
    const aging = await call('reports.debtAging', { partyType: 'supplier' });
    expect(aging.balance).toBeGreaterThan(0);
    const shifts = await call('reports.shifts', {});
    expect(shifts.length).toBeGreaterThan(5);
    const alerts = await call('alerts.list', {});
    expect(alerts.expiring.length + alerts.lowStock.length).toBeGreaterThan(0);

    // Sales after seeding keep the ledger consistent.
    const me = await call('me', {});
    const chl = me.warehouses.find((w) => w.code === 'CHL')!;
    const cat = await call('pos.catalog', { warehouseId: chl.id });
    const item = cat.items.find((i) => i.qty >= 2)!;
    const sale = await call('sales.create', { warehouseId: chl.id, lines: [{ variantId: item.variant_id, qty: 1 }], payments: [{ method: 'card', amount: item.price }] });
    expect(sale.total).toBe(item.price);
    expect(await drift(db)).toBe(0);
  });
});
