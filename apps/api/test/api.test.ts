/** HTTP API integration tests against a real PostgreSQL 16 server. */
import type { Db } from '@omborchi/db';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { setupDb, uniq } from './setup';

let app: FastifyInstance;
let db: Db;
let pool: pg.Pool;

beforeAll(async () => {
  ({ db, pool } = await setupDb());
  app = await buildApp({ db });
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

class Client {
  cookie = '';
  async req<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<{ status: number; json: T }> {
    const res = await app.inject({
      method,
      url,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
    });
    const set = res.headers['set-cookie'];
    if (set) this.cookie = (Array.isArray(set) ? set[0] : set).split(';')[0];
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  }
  get = <T = any>(url: string) => this.req<T>('GET', url);
  post = <T = any>(url: string, body: unknown = {}) => this.req<T>('POST', url, body);
}

async function registerOwner() {
  const c = new Client();
  const email = `owner-${uniq()}@test.uz`;
  const r = await c.post('/api/auth/register', { orgName: `Do'kon ${uniq()}`, name: 'Ega', email, password: 'parol12345' });
  expect(r.status).toBe(200);
  return { c, email };
}

describe('auth', () => {
  it('rejects anonymous requests and wrong passwords', async () => {
    const anon = new Client();
    expect((await anon.get('/api/me')).status).toBe(401);
    const { email } = await registerOwner();
    const bad = await anon.post('/api/auth/login', { email, password: 'notthepassword' });
    expect(bad.status).toBe(401);
    expect(bad.json.error.code).toBe('UNAUTHENTICATED');
  });

  it('registers, signs in with an httpOnly session cookie, and signs out', async () => {
    const { c, email } = await registerOwner();
    const me = await c.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ role: 'owner', user: { email } });
    expect(me.json.units.map((u: { code: string }) => u.code)).toEqual(expect.arrayContaining(['dona', 'kg', 'm', 'quti']));
    const fresh = new Client();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'parol12345' } });
    expect(login.statusCode).toBe(200);
    expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(String(login.headers['set-cookie'])).toMatch(/SameSite=Lax/i);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/me')).status).toBe(401);
    expect(fresh.cookie).toBe('');
  });

  it('refuses non-JSON mutations (CSRF guard)', async () => {
    const { c } = await registerOwner();
    const res = await app.inject({ method: 'POST', url: '/api/customers', payload: 'name=x', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: c.cookie } });
    expect(res.statusCode).toBe(400);
  });
});

describe('business flow over HTTP', () => {
  it('product → receipt → shift → sale → receipt data → dashboard', async () => {
    const { c } = await registerOwner();
    const me = (await c.get('/api/me')).json;
    const store = me.warehouses[0].id;
    const bad = await c.post('/api/products', { name: '', baseUnit: 'dona', variants: [] });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('VALIDATION');

    const prod = await c.post('/api/products', { name: 'Coca-Cola 1.5 l', baseUnit: 'dona', units: [{ unit: 'quti', factor: 6 }], variants: [{ name: '', barcode: '5449000000439', cost: 9000, prices: { retail: 13000 } }] });
    expect(prod.status).toBe(200);
    const lookup = await c.get('/api/lookup?code=5449000000439');
    expect(lookup.json.product_id).toBe(prod.json.id);
    const variantId = lookup.json.variant_id;
    const supplier = await c.post('/api/suppliers', { name: 'Ichimliklar MChJ' });
    const rec = await c.post('/api/stock/receipts', { supplierId: supplier.json.id, warehouseId: store, lines: [{ variantId, qty: 24, unitCost: 9000 }] });
    expect(rec.status).toBe(200);

    expect((await c.post('/api/sales', { warehouseId: store, lines: [{ variantId, qty: 1 }], payments: [{ method: 'cash', amount: 13000 }] })).json.error.code).toBe('NO_OPEN_SHIFT');
    await c.post('/api/shifts', { warehouseId: store, openingCash: 50000 });
    const sale = await c.post('/api/sales', {
      warehouseId: store,
      lines: [
        { variantId, qty: 1, unit: 'quti' },
        { variantId, qty: 2 },
      ],
      payments: [{ method: 'payme', amount: 104000 }],
    });
    expect(sale.status).toBe(200);
    expect(sale.json.total).toBe(6 * 13000 + 2 * 13000);
    const detail = (await c.get(`/api/sales/${sale.json.id}`)).json;
    expect(detail.payments[0].provider_ref).toMatch(/^PAYME-/);
    expect(detail.lines.map((l: { base_qty: number }) => l.base_qty)).toEqual([6, 2]);

    const stock = (await c.get(`/api/stock?warehouseId=${store}`)).json;
    expect(stock.rows[0]).toMatchObject({ qty: 16, avg_cost: 9000 });
    const dash = (await c.get('/api/reports/dashboard')).json;
    expect(dash.today.revenue).toBe(104000);
    expect(dash.today.profit).toBe(104000 - 8 * 9000);
    const drift = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM stock_drift');
    expect(drift.rows[0].n).toBe(0);
  });

  it('enforces roles end-to-end: a cashier signs in, sells in their shop, cannot see reports or other shops', async () => {
    const { c } = await registerOwner();
    const me = (await c.get('/api/me')).json;
    const store = me.warehouses[0].id;
    const other = (await c.post('/api/warehouses', { name: 'Filial', code: 'F2', kind: 'store' })).json.id;
    const email = `kassir-${uniq()}@test.uz`;
    const u = await c.post('/api/users', { name: 'Kassir', email, password: 'kassir12345', role: 'cashier', warehouseIds: [store] });
    expect(u.status).toBe(200);
    const cashier = new Client();
    expect((await cashier.post('/api/auth/login', { email, password: 'kassir12345' })).status).toBe(200);
    const cme = (await cashier.get('/api/me')).json;
    expect(cme.role).toBe('cashier');
    expect(cme.warehouses.map((w: { id: string }) => w.id)).toEqual([store]);
    expect((await cashier.get('/api/reports/dashboard')).status).toBe(403);
    expect((await cashier.post('/api/shifts', { warehouseId: other })).json.error.code).toBe('WAREHOUSE_FORBIDDEN');
    expect((await cashier.post('/api/users', { name: 'x', email: 'x@y.uz', password: '12345678', role: 'owner', warehouseIds: null })).status).toBe(403);
    const audit = (await c.get('/api/audit')).json;
    expect(audit.rows.find((r: { action: string; payload: { password?: string } }) => r.action === 'user.save').payload.password).toBe('***');
  });
});
