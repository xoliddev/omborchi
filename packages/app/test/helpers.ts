import { migrate, type Db } from '@omborchi/db';
import { createPgliteDb } from '@omborchi/db/pglite';
import type { Role } from '@omborchi/core';
import { createOrganisation, dispatch, routes, type Actor, type RouteInput, type RouteOutput, type Routes } from '../src';

let shared: Promise<Db> | null = null;

/** One in-memory PGlite per test file; each test creates its own organisation (tenant isolation keeps tests independent). */
export function testDb(): Promise<Db> {
  shared ??= (async () => {
    const db = await createPgliteDb();
    await migrate(db);
    return db;
  })();
  return shared;
}

let n = 0;

export interface World {
  db: Db;
  orgId: string;
  owner: Actor;
  storeId: string;
  warehouseId: string;
  call<K extends keyof Routes>(name: K, input: RouteInput<Routes[K]>, actor?: Actor): Promise<RouteOutput<Routes[K]>>;
  actorFor(role: Role, warehouseIds: string[] | null): Promise<Actor>;
  product(opts?: { name?: string; unit?: string; price?: number; cost?: number; trackExpiry?: boolean; units?: { unit: string; factor: number }[] }): Promise<{ productId: string; variantId: string }>;
  supplier(): Promise<string>;
  receive(variantId: string, qty: number, unitCost: number, warehouseId?: string, extra?: { batchCode?: string; expiresAt?: string }): Promise<void>;
  balance(variantId: string, warehouseId?: string): Promise<{ qty: number; avg_cost: number }>;
}

export async function world(now: () => Date = () => new Date()): Promise<World> {
  const db = await testDb();
  const id = ++n;
  const { orgId, userId, warehouseId: storeId } = await createOrganisation(db, {
    name: `Test Org ${id}`,
    slug: `test-${id}-${Math.random().toString(36).slice(2, 8)}`,
    owner: { email: `owner${id}-${Math.random().toString(36).slice(2, 8)}@test.uz`, name: 'Owner', passwordHash: null },
  });
  const wh = await db.query<{ id: string }>(`INSERT INTO warehouses (org_id, name, code, kind) VALUES ($1, 'Ombor', 'WH', 'warehouse') RETURNING id`, [orgId]);
  const owner: Actor = { userId, orgId, role: 'owner', warehouseIds: null, name: 'Owner', email: 'owner@test.uz' };
  const hashPassword = async (p: string) => `plain:${p}`;
  const w: World = {
    db,
    orgId,
    owner,
    storeId,
    warehouseId: wh.rows[0].id,
    call: (name, input, actor = owner) => dispatch(routes[name], { db, actor, now, hashPassword }, input) as never,
    async actorFor(role, warehouseIds) {
      const u = await db.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [`${role}-${Math.random().toString(36).slice(2)}@test.uz`, role]);
      await db.query(`INSERT INTO memberships (org_id, user_id, role, all_warehouses) VALUES ($1,$2,$3,$4)`, [orgId, u.rows[0].id, role, warehouseIds === null]);
      return { userId: u.rows[0].id, orgId, role, warehouseIds, name: role, email: `${role}@test.uz` };
    },
    async product(o = {}) {
      const r = await w.call('products.save', {
        name: o.name ?? `Mahsulot ${Math.random().toString(36).slice(2, 7)}`,
        baseUnit: o.unit ?? 'dona',
        trackExpiry: o.trackExpiry ?? false,
        units: o.units ?? [],
        variants: [{ name: '', cost: o.cost ?? 1000, prices: { retail: o.price ?? 1500, wholesale: (o.price ?? 1500) * 0.9 } }],
      });
      const v = await db.query<{ id: string }>('SELECT id FROM variants WHERE product_id = $1', [r.id]);
      return { productId: r.id, variantId: v.rows[0].id };
    },
    async supplier() {
      return (await w.call('suppliers.save', { name: `Yetkazuvchi ${Math.random().toString(36).slice(2, 6)}` })).id;
    },
    async receive(variantId, qty, unitCost, warehouseId = storeId, extra = {}) {
      await w.call('stock.receive', { supplierId: await w.supplier(), warehouseId, lines: [{ variantId, qty, unitCost, ...extra }] });
    },
    async balance(variantId, warehouseId = storeId) {
      const r = await db.query<{ qty: number; avg_cost: number }>('SELECT qty, avg_cost FROM stock_balances WHERE variant_id = $1 AND warehouse_id = $2', [variantId, warehouseId]);
      return r.rows[0] ?? { qty: 0, avg_cost: 0 };
    },
  };
  return w;
}

export async function drift(db: Db): Promise<number> {
  return (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM stock_drift')).rows[0].n;
}
