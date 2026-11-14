/// <reference lib="webworker" />
/**
 * Demo backend: PostgreSQL (PGlite, WebAssembly) + the real route handlers, running in a Web Worker.
 * The database lives in IndexedDB, so the visitor's sales survive reloads.
 */
import { PGlite } from '@electric-sql/pglite';
import { dispatch, routes, seedDemo, toAppError, type Actor, type Routes } from '@omborchi/app';
import { tashkentDay, type Role } from '@omborchi/core';
import { migrate, type Db } from '@omborchi/db';
import { pgliteParsers, wrapPglite } from '@omborchi/db/pglite';

declare const self: DedicatedWorkerGlobalScope;

const DATA_DIR = 'idb://omborchi-demo-v1';
let db: Db | null = null;
let ready: Promise<InitResult> | null = null;

export interface DemoUser {
  userId: string;
  name: string;
  email: string;
  role: Role;
  warehouses: string[];
}
export interface InitResult {
  users: DemoUser[];
  seeded: boolean;
  seededDay: string | null;
}

const post = (msg: unknown) => self.postMessage(msg);

async function openDb(): Promise<Db> {
  const pg = new PGlite({ dataDir: DATA_DIR, parsers: pgliteParsers, relaxedDurability: true });
  await pg.waitReady;
  const d = wrapPglite(pg);
  await migrate(d);
  return d;
}

async function seed(d: Db) {
  await seedDemo(d, { onProgress: (fraction, label) => post({ type: 'progress', fraction, label }) });
  await d.query(`UPDATE orgs SET settings = settings || jsonb_build_object('demoSeededDay', $1::text)`, [tashkentDay(new Date())]);
}

async function users(d: Db): Promise<DemoUser[]> {
  const { rows } = await d.query<{ user_id: string; name: string; email: string; role: Role; whs: string[] | null }>(
    `SELECT u.id AS user_id, u.name, u.email, m.role,
            (SELECT array_agg(w.name ORDER BY w.name) FROM membership_warehouses mw JOIN warehouses w ON w.id = mw.warehouse_id WHERE mw.membership_id = m.id) AS whs
     FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.is_active
     ORDER BY array_position(ARRAY['owner','manager','cashier','storekeeper'], m.role), u.name`,
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role, warehouses: r.whs ?? [] }));
}

async function init(): Promise<InitResult> {
  db = await openDb();
  const org = await db.query<{ day: string | null }>(`SELECT settings->>'demoSeededDay' AS day FROM orgs LIMIT 1`);
  let seeded = false;
  // A demo older than two days is regenerated so the charts always end today.
  const stale = org.rows[0] && (!org.rows[0].day || org.rows[0].day < tashkentDayMinus(2));
  if (!org.rows[0] || stale) {
    if (stale) await wipe(db);
    await seed(db);
    seeded = true;
  }
  const day = (await db.query<{ day: string | null }>(`SELECT settings->>'demoSeededDay' AS day FROM orgs LIMIT 1`)).rows[0]?.day ?? null;
  return { users: await users(db), seeded, seededDay: day };
}

function tashkentDayMinus(n: number) {
  return tashkentDay(new Date(Date.now() - n * 86_400_000));
}

async function wipe(d: Db) {
  await d.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(d);
}

async function actorFor(d: Db, userId: string | null): Promise<Actor> {
  const { rows } = await d.query<{ user_id: string; org_id: string; role: Role; all_warehouses: boolean; name: string; email: string; mid: string }>(
    `SELECT u.id AS user_id, m.org_id, m.role, m.all_warehouses, u.name, u.email, m.id AS mid FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.is_active AND ($1::uuid IS NULL OR u.id = $1) ORDER BY (m.role = 'owner') DESC LIMIT 1`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw new Error('Demo user not found');
  let warehouseIds: string[] | null = null;
  if (!r.all_warehouses && r.role !== 'owner') {
    warehouseIds = (await d.query<{ warehouse_id: string }>('SELECT warehouse_id FROM membership_warehouses WHERE membership_id = $1', [r.mid])).rows.map((x) => x.warehouse_id);
  }
  return { userId: r.user_id, orgId: r.org_id, role: r.role, warehouseIds, name: r.name, email: r.email };
}

// Calls are processed one at a time, like a single-connection server.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as { id: number; type: 'init' | 'call' | 'reset'; name?: string; input?: unknown; userId?: string | null };
  const run = async () => {
    try {
      if (msg.type === 'init') {
        ready ??= init();
        post({ id: msg.id, ok: true, result: await ready });
        return;
      }
      await ready;
      if (!db) throw new Error('Demo database is not ready');
      if (msg.type === 'reset') {
        await wipe(db);
        await seed(db);
        post({ id: msg.id, ok: true, result: { users: await users(db), seeded: true, seededDay: tashkentDay(new Date()) } });
        return;
      }
      const def = routes[msg.name as keyof Routes];
      if (!def) throw new Error(`Unknown route ${msg.name}`);
      const actor = await actorFor(db, msg.userId ?? null);
      const result = await dispatch(def, { db, actor, now: () => new Date(), hashPassword: async (p) => `demo:${p.length}` }, msg.input);
      // Mirror HTTP: the UI always receives plain JSON (dates as ISO strings).
      post({ id: msg.id, ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) });
    } catch (e) {
      const err = toAppError(e);
      post({ id: msg.id, ok: false, error: { code: err.code, message: err.message, status: err.status, details: JSON.parse(JSON.stringify(err.details ?? {})) } });
    }
  };
  queue = queue.then(run, run);
};
