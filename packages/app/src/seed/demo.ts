/**
 * "Demo Market" generator: three locations, ~300 SKUs and 90 days of realistic trading.
 *
 * History is simulated in memory with the real domain core (the same Ledger / WAC costing,
 * pricing and settlement code the API uses), then bulk-inserted. Every stock movement still goes
 * through the database trigger that materialises balances, and the seed asserts there is no drift.
 */
import {
  addDays,
  balanceKey,
  generateEan13,
  Ledger,
  pickFefo,
  priceCart,
  roundMoney,
  roundQty,
  settle,
  startOfTashkentDay,
  sumMoney,
  tashkentDay,
  type MovementKind,
  type PaymentMethod,
} from '@omborchi/core';
import type { Db } from '@omborchi/db';
import { createOrganisation } from '../bootstrap';
import { insertMany, many } from '../sql';
import { CATALOG, CUSTOMERS, SUPPLIERS, type ProductTemplate } from './catalog';

export interface SeedOptions {
  days?: number;
  now?: Date;
  seed?: number;
  passwordHash?: string | null;
  /** Scale sales volume (tests use a small value). */
  volume?: number;
  onProgress?: (fraction: number, label: string) => void;
}

export interface SeedResult {
  orgId: string;
  users: { role: string; userId: string; name: string; email: string; warehouseIds: string[] | null }[];
  warehouses: { id: string; name: string; code: string; kind: string }[];
  counts: { products: number; variants: number; sales: number; movements: number };
}

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a: number, b: number) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }
  uuid(): string {
    const h = () => Math.floor(this.next() * 0x10000).toString(16).padStart(4, '0');
    const variant = (8 + Math.floor(this.next() * 4)).toString(16);
    return `${h()}${h()}-${h()}-4${h().slice(1)}-${variant}${h().slice(1)}-${h()}${h()}${h()}`;
  }
}

interface SimVariant {
  id: string;
  productId: string;
  name: string;
  tpl: ProductTemplate;
  sku: string;
  barcode: string;
  cost: number;
  markup: number;
  retail: number;
  wholesale: number;
  weight: number;
  tracked: boolean;
  allowFraction: boolean;
  scarce: boolean;
  avgQty: number;
}

const roundPrice = (v: number) => (v < 5000 ? Math.ceil(v / 100) * 100 : Math.ceil(v / 500) * 500);
const HOUR = 3_600_000;

export async function seedDemo(db: Db, opts: SeedOptions = {}): Promise<SeedResult> {
  const rng = new Rng(opts.seed ?? 20260101);
  const days = opts.days ?? 90;
  const now = opts.now ?? new Date();
  const volume = opts.volume ?? 1;
  const progress = opts.onProgress ?? (() => undefined);
  const today = tashkentDay(now);
  const startDay = addDays(today, -days);
  const at = (day: string, hours: number) => new Date(startOfTashkentDay(day).getTime() + hours * HOUR);
  const pw = opts.passwordHash ?? null;

  progress(0.02, 'organisation');
  const { orgId, userId: ownerId, warehouseId: chl } = await createOrganisation(db, {
    name: 'Demo Market',
    slug: `demo-market-${rng.int(1000, 9999)}`,
    owner: { email: 'owner@demo.uz', name: 'Akmal Karimov', passwordHash: pw },
    warehouse: { name: 'Chilonzor do‘koni', code: 'CHL', kind: 'store', address: 'Toshkent, Chilonzor 9-kvartal, 14-uy' },
  });
  await db.query(`UPDATE orgs SET settings = $2 WHERE id = $1`, [orgId, JSON.stringify({ phone: '+998 71 200 70 70', inn: '309876543', receiptFooter: 'Xaridingiz uchun rahmat!' })]);
  const yun = rng.uuid();
  const cen = rng.uuid();
  await insertMany(db, 'warehouses', ['id', 'org_id', 'name', 'code', 'kind', 'address'], [
    [yun, orgId, 'Yunusobod filiali', 'YUN', 'store', 'Toshkent, Yunusobod 4-mavze, Amir Temur ko‘chasi 108'],
    [cen, orgId, 'Markaziy ombor', 'CEN', 'warehouse', 'Toshkent, Sergeli sanoat zonasi, 3-ombor'],
  ]);
  const stores = [
    { id: chl, base: 40, code: 'CHL' },
    { id: yun, base: 25, code: 'YUN' },
  ];

  // ── People ──
  const people = [
    { role: 'manager', name: 'Dilnoza Rahimova', email: 'manager@demo.uz', wh: null as string[] | null },
    { role: 'cashier', name: 'Jasur Toshmatov', email: 'kassir@demo.uz', wh: [chl] },
    { role: 'cashier', name: 'Madina Yusupova', email: 'kassir2@demo.uz', wh: [yun] },
    { role: 'storekeeper', name: 'Bekzod Aliyev', email: 'omborchi@demo.uz', wh: [cen, chl, yun] },
  ].map((p) => ({ ...p, id: rng.uuid(), mid: rng.uuid() }));
  await insertMany(db, 'users', ['id', 'email', 'name', 'password_hash'], people.map((p) => [p.id, p.email, p.name, pw]));
  await insertMany(db, 'memberships', ['id', 'org_id', 'user_id', 'role', 'all_warehouses'], people.map((p) => [p.mid, orgId, p.id, p.role, p.wh === null]));
  await insertMany(db, 'membership_warehouses', ['membership_id', 'warehouse_id'], people.flatMap((p) => (p.wh ?? []).map((w) => [p.mid, w])));
  const cashierOf: Record<string, string> = { [chl]: people[1].id, [yun]: people[2].id };
  const storekeeper = people[3].id;
  const manager = people[0].id;

  // ── Catalogue ──
  progress(0.05, 'catalog');
  const units = new Map((await many<{ id: string; code: string; allow_fraction: boolean }>(db, 'SELECT id, code, allow_fraction FROM units WHERE org_id = $1', [orgId])).map((u) => [u.code, u]));
  const priceLists = new Map((await many<{ id: string; code: string }>(db, 'SELECT id, code FROM price_lists WHERE org_id = $1', [orgId])).map((p) => [p.code, p.id]));
  const catIds = new Map<string, string>();
  const catRows: unknown[][] = [];
  let sort = 0;
  for (const t of CATALOG) {
    let parent: string | null = null;
    for (let i = 0; i < t.cat.length; i++) {
      const key = t.cat.slice(0, i + 1).join('/');
      let cid = catIds.get(key);
      if (!cid) {
        cid = rng.uuid();
        catIds.set(key, cid);
        catRows.push([cid, orgId, parent, t.cat[i], sort++]);
      }
      parent = cid;
    }
  }
  await insertMany(db, 'categories', ['id', 'org_id', 'parent_id', 'name', 'sort'], catRows);

  const supplierIds = SUPPLIERS.map(() => rng.uuid());
  await insertMany(
    db,
    'suppliers',
    ['id', 'org_id', 'name', 'phone', 'contact', 'inn', 'address', 'created_at'],
    SUPPLIERS.map((s, i) => [supplierIds[i], orgId, s.name, s.phone, s.contact, s.inn, 'Toshkent', at(startDay, -24 * 10)]),
  );
  const customerIds = CUSTOMERS.map(() => rng.uuid());
  await insertMany(
    db,
    'customers',
    ['id', 'org_id', 'name', 'phone', 'credit_limit', 'created_at'],
    CUSTOMERS.map((c, i) => [
      customerIds[i],
      orgId,
      c,
      `+998 9${rng.int(0, 9)} ${rng.int(100, 999)} ${String(rng.int(0, 99)).padStart(2, '0')} ${String(rng.int(0, 99)).padStart(2, '0')}`,
      c.startsWith('“') ? 15_000_000 : null,
      at(startDay, -24 * rng.int(1, 200)),
    ]),
  );
  const businessCustomers = customerIds.filter((_, i) => CUSTOMERS[i].startsWith('“'));

  const variants: SimVariant[] = [];
  const productRows: unknown[][] = [];
  const unitRows: unknown[][] = [];
  let seq = 1;
  CATALOG.forEach((t, idx) => {
    const pid = rng.uuid();
    const unit = units.get(t.unit)!;
    const rank = (idx * 7919) % CATALOG.length; // deterministic shuffle for Zipf-like spread
    const baseWeight = t.pop * (0.35 + 1.6 / Math.sqrt(1 + rank / 6));
    productRows.push([pid, orgId, catIds.get(t.cat.join('/')), t.name, unit.id, !!t.shelf, 0, at(startDay, -24 * 5)]);
    for (const [code, factor] of t.alt ?? []) unitRows.push([rng.uuid(), pid, units.get(code)!.id, factor, null]);
    const names = t.variants ?? [''];
    names.forEach((vn, vi) => {
      const markup = t.markup ?? 1.18 + rng.next() * 0.22;
      const cost = Math.round(t.cost * (1 + vi * 0.02));
      variants.push({
        id: rng.uuid(),
        productId: pid,
        name: vn,
        tpl: t,
        sku: `DM-${String(seq).padStart(4, '0')}`,
        barcode: generateEan13(seq * 7 + 1000),
        cost,
        markup,
        retail: roundPrice(cost * markup),
        wholesale: roundPrice(cost * (1 + (markup - 1) * 0.55)),
        weight: (baseWeight / names.length) * (vi === 0 ? 1.4 : 1),
        tracked: !!t.shelf,
        allowFraction: unit.allow_fraction,
        scarce: false,
        avgQty: t.unit === 'kg' ? 1.3 : t.unit === 'm' ? 8 : 1.25,
      });
      seq++;
    });
  });
  // A few popular items are hard to source → they run low and show up in alerts.
  for (const v of variants.filter((x) => x.weight > 1.2).filter((_, i) => i % 9 === 4).slice(0, 7)) v.scarce = true;

  // ── Demand model ──
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  const linesPerDay = (store: (typeof stores)[number]) => store.base * volume * 2.3;
  const demand = (v: SimVariant, store: (typeof stores)[number]) => (linesPerDay(store) * v.weight * v.avgQty) / totalWeight;
  const storeDemand = (v: SimVariant) => stores.reduce((s, st) => s + demand(v, st), 0);
  const roundOrder = (v: SimVariant, q: number) => (v.allowFraction ? Math.max(1, Math.ceil(q)) : Math.max(1, Math.ceil(q)));

  // min stock per store = ~2.5 days of demand at the busier store
  for (const v of variants) {
    const min = v.weight === 0 ? 0 : Math.max(2, Math.ceil(demand(v, stores[0]) * 2.5));
    const row = productRows.find((p) => p[0] === v.productId)!;
    row[6] = Math.max(Number(row[6]), min);
  }
  await insertMany(db, 'products', ['id', 'org_id', 'category_id', 'name', 'base_unit_id', 'track_expiry', 'min_stock', 'created_at'], productRows);
  await insertMany(db, 'product_units', ['id', 'product_id', 'unit_id', 'factor', 'barcode'], unitRows);

  // ── Simulation state ──
  progress(0.1, 'history');
  const ledger = new Ledger();
  const batches = new Map<string, { batchId: string; qty: number; expires: string | null }[]>();
  const batchRows: unknown[][] = [];
  const movementRows: unknown[][] = [];
  const counters: Record<string, number> = {};
  const num = (kind: string, prefix: string) => {
    counters[kind] = (counters[kind] ?? 0) + 1;
    return `${prefix}-${String(counters[kind]).padStart(6, '0')}`;
  };
  const docs = {
    receipts: [] as unknown[][],
    receiptLines: [] as unknown[][],
    pos: [] as { id: string; number: string; supplier: number; created: Date; status: string; total: number; lines: { id: string; v: SimVariant; qty: number; received: number; cost: number }[] }[],
    transfers: [] as unknown[][],
    transferLines: [] as unknown[][],
    writeOffs: [] as unknown[][],
    writeOffLines: [] as unknown[][],
    shifts: [] as unknown[][],
    sales: [] as Record<string, unknown>[],
    saleLines: [] as Record<string, unknown>[],
    payments: [] as unknown[][],
    returns: [] as unknown[][],
    returnLines: [] as unknown[][],
    debts: [] as unknown[][],
    counts: [] as unknown[][],
    countLines: [] as unknown[][],
    audit: [] as unknown[][],
  };
  const audit = (when: Date, userId: string, action: string, entity: string, entityId: string, payload: Record<string, unknown>) =>
    docs.audit.push([orgId, userId, action, entity, entityId, JSON.stringify(payload), when]);

  const post = (when: Date, docType: string, docId: string, userId: string, wh: string, v: SimVariant, kind: MovementKind, qty: number, unitCost?: number, batchId: string | null = null) => {
    const r = ledger.post({ warehouseId: wh, variantId: v.id, kind, qty, unitCost });
    movementRows.push([orgId, wh, v.id, batchId, kind, roundQty(qty), r.unitCost, r.costValue, docType, docId, userId, null, when]);
    if (batchId) {
      const k = balanceKey(wh, v.id);
      const list = batches.get(k) ?? [];
      const b = list.find((x) => x.batchId === batchId);
      if (b) b.qty = roundQty(b.qty + qty);
      batches.set(k, list);
    }
    return r;
  };
  /** Outbound with FEFO batch picking; returns total cost booked (positive) and per-batch parts. */
  const out = (when: Date, docType: string, docId: string, userId: string, wh: string, v: SimVariant, kind: MovementKind, qty: number) => {
    const parts: { batchId: string | null; qty: number; unitCost: number }[] = [];
    let cost = 0;
    if (v.tracked) {
      const list = batches.get(balanceKey(wh, v.id)) ?? [];
      const picks = pickFefo(list.map((b) => ({ batchId: b.batchId, qty: b.qty, expiresAt: b.expires ? new Date(b.expires) : null })), qty);
      let left = qty;
      for (const p of picks) {
        const r = post(when, docType, docId, userId, wh, v, kind, -p.qty, undefined, p.batchId);
        parts.push({ batchId: p.batchId, qty: p.qty, unitCost: r.unitCost });
        cost += -r.costValue;
        left = roundQty(left - p.qty);
      }
      if (left > 0) {
        const r = post(when, docType, docId, userId, wh, v, kind, -left);
        parts.push({ batchId: null, qty: left, unitCost: r.unitCost });
        cost += -r.costValue;
      }
    } else {
      const r = post(when, docType, docId, userId, wh, v, kind, -qty);
      parts.push({ batchId: null, qty, unitCost: r.unitCost });
      cost += -r.costValue;
    }
    return { cost: roundMoney(cost), parts };
  };
  const newBatch = (v: SimVariant, code: string, expires: string | null, createdAt: Date) => {
    const id = rng.uuid();
    batchRows.push([id, orgId, v.id, code, expires, createdAt]);
    return { id, expires };
  };
  const ensureBatchList = (wh: string, v: SimVariant, id: string, expires: string | null) => {
    const k = balanceKey(wh, v.id);
    const list = batches.get(k) ?? [];
    if (!list.find((b) => b.batchId === id)) list.push({ batchId: id, qty: 0, expires });
    batches.set(k, list);
  };

  const debtEntry = (party: 'customer' | 'supplier', partyId: string, kind: 'charge' | 'payment', amount: number, when: Date, extra: { due?: string | null; method?: string; docType?: string; docId?: string | null; note?: string; userId?: string }) =>
    docs.debts.push([rng.uuid(), orgId, party, partyId, kind, roundMoney(amount), extra.due ?? null, extra.method ?? null, extra.docType ?? null, extra.docId ?? null, extra.note ?? null, extra.userId ?? manager, when]);

  // Goods receipt into a warehouse
  const receive = (when: Date, supplier: number, wh: string, lines: { v: SimVariant; qty: number; cost: number; poLineId?: string }[], poId: string | null, payShare: number) => {
    const id = rng.uuid();
    const number = num('receipt', 'GR');
    const total = sumMoney(lines.map((l) => roundMoney(l.qty * l.cost)));
    const paid = roundMoney(total * payShare);
    const due = addDays(tashkentDay(when), 14);
    docs.receipts.push([id, orgId, number, poId, supplierIds[supplier], wh, total, paid, due, null, storekeeper, when]);
    for (const l of lines) {
      let batchId: string | null = null;
      if (l.v.tracked) {
        let expires = addDays(tashkentDay(when), Math.round(l.v.tpl.shelf! * (0.85 + rng.next() * 0.3)));
        // Make a handful of pharmacy batches expire soon so the expiry alerts have something to show.
        if (l.v.tpl.shelf! > 300 && rng.chance(0.18)) expires = addDays(today, rng.int(-6, 40));
        const b = newBatch(l.v, `${number.replace('GR-', 'B')}-${l.v.sku.slice(3)}`, expires, when);
        batchId = b.id;
        ensureBatchList(wh, l.v, b.id, b.expires);
      }
      docs.receiptLines.push([rng.uuid(), id, l.poLineId ?? null, l.v.id, batchId, l.qty, l.cost]);
      post(when, 'receipt', id, storekeeper, wh, l.v, 'receipt', l.qty, l.cost, batchId);
    }
    debtEntry('supplier', supplierIds[supplier], 'charge', total, when, { due, docType: 'receipt', docId: id, note: number, userId: storekeeper });
    if (paid > 0) debtEntry('supplier', supplierIds[supplier], 'payment', paid, when, { method: 'transfer', docType: 'receipt', docId: id, note: number, userId: manager });
    audit(when, storekeeper, 'stock.receive', 'goods_receipt', id, { number, lines: lines.length, total });
    return id;
  };

  const transfer = (when: Date, from: string, to: string, lines: { v: SimVariant; qty: number }[]) => {
    if (lines.length === 0) return;
    const id = rng.uuid();
    const number = num('transfer', 'TR');
    docs.transfers.push([id, orgId, number, from, to, null, storekeeper, when]);
    for (const l of lines) {
      const { parts } = out(when, 'transfer', id, storekeeper, from, l.v, 'transfer_out', l.qty);
      for (const p of parts) {
        if (p.batchId) ensureBatchList(to, l.v, p.batchId, batches.get(balanceKey(from, l.v.id))!.find((b) => b.batchId === p.batchId)!.expires);
        post(when, 'transfer', id, storekeeper, to, l.v, 'transfer_in', p.qty, p.unitCost, p.batchId);
        docs.transferLines.push([rng.uuid(), id, l.v.id, p.qty, p.unitCost]);
      }
    }
    audit(when, storekeeper, 'stock.transfer', 'transfer', id, { number, lines: lines.length });
  };

  // ── Day 0: opening stock into the central warehouse, then stock the shops ──
  const day0 = startDay;
  const bySupplier = new Map<number, SimVariant[]>();
  for (const v of variants) bySupplier.set(v.tpl.supplier, [...(bySupplier.get(v.tpl.supplier) ?? []), v]);
  for (const [s, vs] of bySupplier) {
    receive(
      at(day0, 8),
      s,
      cen,
      vs.map((v) => ({ v, qty: roundOrder(v, v.weight === 0 ? rng.int(6, 30) : storeDemand(v) * 30 + 4), cost: v.cost })),
      null,
      rng.chance(0.5) ? 1 : 0.6,
    );
  }
  const replenish = (when: Date, days1: number, days2: number) => {
    for (const st of stores) {
      const lines: { v: SimVariant; qty: number }[] = [];
      for (const v of variants) {
        const d = demand(v, st);
        const have = ledger.get(st.id, v.id).qty;
        const target = v.weight === 0 ? 3 : Math.max(3, d * days2);
        if (have > Math.max(1, d * days1) && !(v.weight === 0 && have === 0)) continue;
        const avail = ledger.get(cen, v.id).qty;
        let q = Math.min(avail, target - have);
        q = v.allowFraction ? roundQty(Math.floor(q * 10) / 10) : Math.floor(q);
        if (q > 0) lines.push({ v, qty: q });
      }
      transfer(when, cen, st.id, lines);
    }
  };
  replenish(at(day0, 9), 0, 9);

  // ── Daily trading ──
  const pendingPos: { dueDay: string; po: (typeof docs.pos)[number] }[] = [];
  const pendingReturns: { day: string; saleIdx: number; store: string }[] = [];
  const dowFactor = [1.12, 0.9, 0.92, 0.95, 0.97, 1.08, 1.22]; // Sun..Sat
  const methodsCum: [PaymentMethod | 'mixed' | 'debt', number][] = [
    ['cash', 0.47],
    ['card', 0.74],
    ['payme', 0.82],
    ['click', 0.89],
    ['uzum', 0.92],
    ['mixed', 0.965],
    ['debt', 1],
  ];
  const cumulative = (vs: SimVariant[]) => {
    let s = 0;
    return vs.map((v) => (s += v.weight));
  };
  const sellable = variants.filter((v) => v.weight > 0);
  const cum = cumulative(sellable);
  const pickVariant = () => {
    const r = rng.next() * cum[cum.length - 1];
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return sellable[lo];
  };
  const hourWeights = [0.5, 0.8, 1, 1.25, 1.3, 1.05, 0.9, 0.85, 1, 1.25, 1.35, 1.1]; // 9..20
  const hourCum: number[] = [];
  hourWeights.reduce((acc, w) => {
    hourCum.push(acc + w);
    return acc + w;
  }, 0);
  const randomHour = () => {
    const r = rng.next() * hourCum[hourCum.length - 1];
    const h = hourCum.findIndex((c) => c >= r);
    return 9 + h + rng.next();
  };

  for (let d = 0; d <= days; d++) {
    const day = addDays(startDay, d);
    const isToday = day === today;
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const limit = isToday ? now.getTime() : Infinity;
    if (d % 6 === 0) progress(0.1 + (0.55 * d) / days, 'history');

    // 08:00 receipts for purchase orders placed two days ago
    for (const p of pendingPos.filter((x) => x.dueDay === day)) {
      const po = p.po;
      const partial = rng.chance(0.15);
      const lines = po.lines
        .map((l) => {
          let q = l.qty;
          if (l.v.scarce) q = Math.floor(l.qty * 0.25);
          else if (partial && rng.chance(0.4)) q = Math.floor(l.qty * (0.5 + rng.next() * 0.3));
          return { ...l, rec: Math.max(0, q) };
        })
        .filter((l) => l.rec > 0);
      if (lines.length) {
        receive(at(day, 8), po.supplier, cen, lines.map((l) => ({ v: l.v, qty: l.rec, cost: l.cost, poLineId: l.id })), po.id, rng.pick([0, 0.5, 1, 1]));
        for (const l of lines) po.lines.find((x) => x.id === l.id)!.received += l.rec;
      }
      po.status = po.lines.every((l) => l.received >= l.qty) ? 'received' : 'partial';
    }
    // 08:30 shop replenishment every second day
    if (d > 0 && d % 2 === 0 && !(isToday && now.getTime() < at(day, 8.5).getTime())) replenish(at(day, 8.5), 3.5, 8);

    // 08:45 weekly write-offs: expired batches + breakage
    if (d % 7 === 3 && at(day, 8.75).getTime() < limit) {
      for (const wh of [cen, chl, yun]) {
        const lines: { v: SimVariant; qty: number; batchId: string | null }[] = [];
        for (const v of variants.filter((x) => x.tracked)) {
          for (const b of batches.get(balanceKey(wh, v.id)) ?? []) {
            if (b.qty > 0 && b.expires && b.expires < day && b.expires >= addDays(day, -20)) lines.push({ v, qty: b.qty, batchId: b.batchId });
          }
        }
        const write = (reason: string, ls: typeof lines) => {
          if (!ls.length) return;
          const id = rng.uuid();
          const number = num('writeoff', 'WO');
          const when = at(day, 8.75);
          let total = 0;
          for (const l of ls) {
            if (l.batchId) {
              const r = post(when, 'write_off', id, storekeeper, wh, l.v, 'write_off', -l.qty, undefined, l.batchId);
              total += -r.costValue;
              docs.writeOffLines.push([rng.uuid(), id, l.v.id, l.batchId, l.qty, r.unitCost]);
            } else {
              const o = out(when, 'write_off', id, storekeeper, wh, l.v, 'write_off', l.qty);
              total += o.cost;
              for (const p of o.parts) docs.writeOffLines.push([rng.uuid(), id, l.v.id, p.batchId, p.qty, p.unitCost]);
            }
          }
          docs.writeOffs.push([id, orgId, number, wh, reason, reason === 'expired' ? 'Muddati o‘tgan partiyalar' : 'Shikastlangan qadoq', roundMoney(total), storekeeper, when]);
          audit(when, storekeeper, 'stock.write_off', 'write_off', id, { number, reason, lines: ls.length });
        };
        write('expired', lines);
        if (wh !== cen) {
          const dmg = [] as typeof lines;
          for (let k = 0; k < rng.int(0, 2); k++) {
            const v = pickVariant();
            if (!v.tracked && !v.allowFraction && ledger.get(wh, v.id).qty >= 2) dmg.push({ v, qty: 1, batchId: null });
          }
          write('damaged', [...new Map(dmg.map((x) => [x.v.id, x])).values()]);
        }
      }
    }

    // Inventory count (revizion) of the drinks section, about six weeks ago
    if (d === days - 45) {
      const when = at(day, 8.9);
      const id = rng.uuid();
      const number = num('count', 'INV');
      const drinks = variants.filter((v) => v.tpl.cat[1] === 'Ichimliklar');
      for (const v of drinks) {
        const expected = ledger.get(chl, v.id).qty;
        if (expected <= 0) continue;
        let counted = expected;
        if (rng.chance(0.12)) counted = Math.max(0, expected - rng.int(1, 3));
        else if (rng.chance(0.04)) counted = expected + 1;
        docs.countLines.push([rng.uuid(), id, v.id, expected, counted, ledger.get(chl, v.id).avgCost]);
        if (counted !== expected) post(when, 'count', id, storekeeper, chl, v, 'adjustment', counted - expected);
      }
      docs.counts.push([id, orgId, number, chl, catIds.get('Oziq-ovqat/Ichimliklar'), 'applied', 'Choraklik revizion: ichimliklar', storekeeper, at(day, 8), when]);
      audit(when, storekeeper, 'count.apply', 'inventory_count', id, { number });
    }

    // Shifts open
    const shiftIds: Record<string, string> = {};
    const shiftCash: Record<string, number> = {};
    for (const st of stores) {
      const opened = at(day, 8.9 + rng.next() * 0.1);
      if (opened.getTime() > limit) continue;
      const id = rng.uuid();
      shiftIds[st.id] = id;
      shiftCash[st.id] = 200000;
      docs.shifts.push([id, orgId, st.id, cashierOf[st.id], num('shift', 'SH'), 'open', 200000, null, null, null, opened, null]);
    }
    if (isToday) {
      // The demo visitor signs in as the owner: give them an open till at Chilonzor.
      docs.shifts.push([rng.uuid(), orgId, chl, ownerId, num('shift', 'SH'), 'open', 300000, null, null, null, at(day, 8.95), null]);
    }

    // Sales events through the day (both shops interleaved)
    type Ev = { t: number; store: (typeof stores)[number]; kind: 'sale' | 'return' | 'collect'; ref?: number };
    const events: Ev[] = [];
    for (const st of stores) {
      if (!shiftIds[st.id]) continue;
      const n = Math.round(st.base * volume * dowFactor[dow] * (0.86 + (0.28 * d) / days) * (0.85 + rng.next() * 0.3));
      for (let k = 0; k < n; k++) events.push({ t: at(day, randomHour()).getTime(), store: st, kind: 'sale' });
      if (rng.chance(0.45)) events.push({ t: at(day, randomHour()).getTime(), store: st, kind: 'collect' });
    }
    for (const r of pendingReturns.filter((x) => x.day === day)) {
      const st = stores.find((s) => s.id === r.store)!;
      if (shiftIds[st.id]) events.push({ t: at(day, randomHour()).getTime(), store: st, kind: 'return', ref: r.saleIdx });
    }
    events.sort((a, b) => a.t - b.t);

    for (const ev of events) {
      if (ev.t > limit) break;
      const when = new Date(ev.t);
      const wh = ev.store.id;
      const cashier = cashierOf[wh];
      if (ev.kind === 'collect') {
        // A customer with debt comes to pay part of it
        const debtors = docs.sales.filter((s) => Number(s.debt) > 0 && s.customer_id);
        if (!debtors.length) continue;
        const s = rng.pick(debtors);
        const custIdx = customerIds.indexOf(String(s.customer_id));
        if (custIdx % 5 === 0) continue; // some customers never pay → overdue debts
        const amount = roundPrice(Number(s.debt) * (0.4 + rng.next() * 0.6));
        const method = rng.chance(0.7) ? 'cash' : 'card';
        debtEntry('customer', String(s.customer_id), 'payment', amount, when, { method, docType: 'payment', userId: cashier });
        if (method === 'cash') shiftCash[wh] += amount;
        continue;
      }
      if (ev.kind === 'return') {
        const sale = docs.sales[ev.ref!];
        const lines = docs.saleLines.filter((l) => l.sale_id === sale.id);
        const line = rng.pick(lines);
        const qty = Number(line.base_qty);
        if (Number(line.returned_qty) > 0) continue;
        const v = variants.find((x) => x.id === line.variant_id)!;
        const unitCost = Number(line.cost_total) / qty;
        const amount = roundMoney(Number(line.total));
        const id = rng.uuid();
        const number = num('return', 'R');
        post(when, 'sale_return', id, cashier, wh, v, 'sale_return', qty, unitCost);
        docs.returns.push([id, orgId, number, sale.id, wh, shiftIds[wh], amount, Number(line.cost_total), 'cash', rng.pick(['Sifatsiz mahsulot', 'Mijoz fikrini o‘zgartirdi', 'Noto‘g‘ri o‘lcham']), cashier, when]);
        docs.returnLines.push([rng.uuid(), id, line.id, v.id, qty, amount, Number(line.cost_total)]);
        line.returned_qty = qty;
        sale.returned_total = roundMoney(Number(sale.returned_total) + amount);
        sale.status = lines.every((l) => Number(l.returned_qty) >= Number(l.base_qty)) ? 'returned' : 'partially_returned';
        shiftCash[wh] -= amount;
        audit(when, cashier, 'sale.return', 'sale', String(sale.id), { number, total: amount });
        continue;
      }

      // ── A sale ──
      const wholesale = rng.chance(0.03) && businessCustomers.length > 0;
      const nLines = Math.min(7, 1 + Math.floor(-Math.log(1 - rng.next()) / 0.75));
      const chosen = new Map<string, { v: SimVariant; qty: number; unit: string; factor: number }>();
      for (let k = 0; k < nLines; k++) {
        const v = pickVariant();
        if (chosen.has(v.id)) continue;
        let qty: number;
        if (v.tpl.unit === 'kg') qty = rng.pick([0.5, 1, 1, 1.5, 2, 0.3, 0.75, 2.5]);
        else if (v.tpl.unit === 'm') qty = rng.int(2, 25);
        else qty = rng.chance(0.72) ? 1 : rng.chance(0.7) ? 2 : rng.int(3, 6);
        let unit = v.tpl.unit as string;
        let factor = 1;
        const alt = v.tpl.alt?.[0];
        if (alt && (wholesale || rng.chance(0.03))) {
          unit = alt[0];
          factor = alt[1];
          qty = wholesale ? rng.int(1, 3) : 1;
        } else if (wholesale) qty = v.allowFraction ? qty * rng.int(5, 10) : qty * rng.int(4, 10);
        const have = ledger.get(wh, v.id).qty;
        if (have < qty * factor) continue;
        chosen.set(v.id, { v, qty, unit, factor });
      }
      if (chosen.size === 0) continue;
      const lines = [...chosen.values()];
      const priceOf = (v: SimVariant) => (wholesale ? v.wholesale : v.retail);
      const cartDiscount = !wholesale && rng.chance(0.06) ? { type: 'percent' as const, value: rng.pick([3, 5, 5, 10]) } : null;
      const cart = priceCart(
        lines.map((l) => ({ unitPrice: roundMoney(priceOf(l.v) * l.factor), qty: l.qty, unitFactor: l.factor })),
        cartDiscount,
      );
      let pick = rng.next();
      if (wholesale) pick = rng.chance(0.5) ? 0.99 : 0.5;
      const method = methodsCum.find(([, c]) => pick <= c)![0];
      let customerId: string | null = wholesale ? rng.pick(businessCustomers) : rng.chance(0.07) ? rng.pick(customerIds) : null;
      let payments: { method: PaymentMethod; amount: number }[];
      if (method === 'mixed') payments = [{ method: 'card', amount: roundMoney(Math.floor((cart.total * 0.6) / 1000) * 1000) || cart.total }, { method: 'cash', amount: Math.ceil((cart.total - Math.floor((cart.total * 0.6) / 1000) * 1000) / 1000) * 1000 }];
      else if (method === 'debt') {
        customerId = customerId ?? rng.pick(customerIds);
        const part = rng.chance(0.5) ? Math.floor((cart.total * rng.next() * 0.5) / 1000) * 1000 : 0;
        payments = part > 0 ? [{ method: 'cash', amount: part }] : [];
      } else if (method === 'cash') payments = [{ method: 'cash', amount: Math.ceil(cart.total / rng.pick([1000, 5000, 10000])) * rng.pick([1000, 1000, 1000]) }];
      else payments = [{ method, amount: cart.total }];
      payments = payments.filter((p) => p.amount > 0);
      if (method === 'cash') payments = [{ method: 'cash', amount: Math.max(cart.total, Math.ceil(cart.total / 5000) * 5000) }];
      const s = settle(cart.total, payments, { hasCustomer: !!customerId });
      const id = rng.uuid();
      const number = num('sale', 'S');
      let costTotal = 0;
      lines.forEach((l, idx) => {
        const pl = cart.lines[idx];
        const o = out(when, 'sale', id, cashier, wh, l.v, 'sale', pl.baseQty);
        costTotal += o.cost;
        docs.saleLines.push({
          id: rng.uuid(),
          sale_id: id,
          variant_id: l.v.id,
          unit_code: l.unit,
          unit_factor: l.factor,
          qty: pl.qty,
          base_qty: pl.baseQty,
          unit_price: pl.unitPrice,
          discount: roundMoney(pl.lineDiscount + pl.cartDiscountShare),
          total: pl.total,
          cost_total: o.cost,
          returned_qty: 0,
        });
      });
      const due = s.debt > 0 ? addDays(day, rng.pick([7, 14, 14, 30])) : null;
      docs.sales.push({
        id,
        org_id: orgId,
        number,
        warehouse_id: wh,
        shift_id: shiftIds[wh],
        user_id: cashier,
        customer_id: customerId,
        price_list_id: priceLists.get(wholesale ? 'wholesale' : 'retail'),
        subtotal: cart.subtotal,
        discount_total: cart.discountTotal,
        total: cart.total,
        cost_total: roundMoney(costTotal),
        paid: s.paid,
        change: s.change,
        debt: s.debt,
        due_date: due,
        returned_total: 0,
        status: 'completed',
        created_at: when,
      });
      for (const p of s.applied) {
        const ref = p.method === 'cash' || p.method === 'card' ? null : `${p.method.toUpperCase()}-${rng.uuid().slice(0, 8).toUpperCase()}`;
        docs.payments.push([rng.uuid(), id, p.method, p.amount, ref, when]);
        if (p.method === 'cash') shiftCash[wh] += p.amount;
      }
      if (s.debt > 0) debtEntry('customer', customerId!, 'charge', s.debt, when, { due, docType: 'sale', docId: id, note: number, userId: cashier });
      if (rng.chance(0.006) && !isToday) pendingReturns.push({ day: addDays(day, rng.int(1, 3)), saleIdx: docs.sales.length - 1, store: wh });
      if (d >= days - 2) audit(when, cashier, 'sale.create', 'sale', id, { number, total: cart.total, lines: lines.length });
    }

    // 18:00 weekly purchase orders to suppliers for what the central warehouse is running out of
    if (d % 7 === 5 && at(day, 18).getTime() < limit) {
      for (const [s, vs] of bySupplier) {
        const pipeline = new Map<string, number>();
        for (const p of pendingPos) if (p.dueDay >= day) for (const l of p.po.lines) pipeline.set(l.v.id, (pipeline.get(l.v.id) ?? 0) + l.qty);
        const lines = vs
          .filter((v) => v.weight > 0)
          .map((v) => {
            const need = storeDemand(v) * 24 - ledger.get(cen, v.id).qty - (pipeline.get(v.id) ?? 0);
            return { v, qty: roundOrder(v, need) };
          })
          .filter((l) => l.qty > 0 && storeDemand(l.v) * 24 - ledger.get(cen, l.v.id).qty > storeDemand(l.v) * 8);
        if (!lines.length) continue;
        for (const l of lines) {
          if (rng.chance(0.25)) {
            l.v.cost = Math.round(l.v.cost * (1 + rng.next() * 0.05));
            l.v.retail = roundPrice(l.v.cost * l.v.markup);
            l.v.wholesale = roundPrice(l.v.cost * (1 + (l.v.markup - 1) * 0.55));
          }
        }
        const po = {
          id: rng.uuid(),
          number: num('po', 'PO'),
          supplier: s,
          created: at(day, 18),
          status: 'ordered',
          total: sumMoney(lines.map((l) => roundMoney(l.qty * l.v.cost))),
          lines: lines.map((l) => ({ id: rng.uuid(), v: l.v, qty: l.qty, received: 0, cost: l.v.cost })),
        };
        docs.pos.push(po);
        pendingPos.push({ dueDay: addDays(day, 2), po });
        audit(po.created, manager, 'purchase_order.create', 'purchase_order', po.id, { number: po.number, lines: lines.length });
      }
    }

    // Saturday evening: pay suppliers (two of them are paid slowly → payables aging)
    if (dow === 6 && at(day, 18.5).getTime() < limit) {
      for (let s = 0; s < SUPPLIERS.length; s++) {
        const bal = docs.debts
          .filter((e) => e[2] === 'supplier' && e[3] === supplierIds[s])
          .reduce((acc, e) => acc + (e[4] === 'charge' ? Number(e[5]) : -Number(e[5])), 0);
        if (bal <= 0) continue;
        const share = s === 5 || s === 3 ? 0.15 : 0.55 + rng.next() * 0.4;
        const amount = Math.floor((bal * share) / 1000) * 1000;
        if (amount > 0) {
          debtEntry('supplier', supplierIds[s], 'payment', amount, at(day, 18.5), { method: 'transfer', docType: 'payment', userId: manager });
          audit(at(day, 18.5), manager, 'supplier.payment', 'supplier', supplierIds[s], { amount });
        }
      }
    }

    // 21:00 shifts close
    if (!isToday) {
      for (const row of docs.shifts.filter((r) => r[11] === null && r[5] === 'open' && Object.values(shiftIds).includes(String(r[0])))) {
        const wh = String(row[2]);
        const expected = roundMoney(shiftCash[wh]);
        const diff = rng.chance(0.82) ? 0 : rng.chance(0.7) ? -rng.int(1, 15) * 1000 : rng.int(1, 5) * 1000;
        row[5] = 'closed';
        row[7] = expected + diff;
        row[8] = expected;
        row[11] = at(day, 21 + rng.next() * 0.3);
        audit(row[11] as Date, String(row[3]), 'shift.close', 'shift', String(row[0]), { expected, counted: expected + diff });
      }
    }
  }

  // An open count at Yunusobod (pharmacy corner), half counted — shows the revizion workflow in progress.
  {
    const id = rng.uuid();
    const number = num('count', 'INV');
    const meds = variants.filter((v) => v.tpl.cat[0] === 'Dorixona');
    meds.forEach((v, i) => {
      const expected = ledger.get(yun, v.id).qty;
      const counted = i % 2 === 0 ? Math.max(0, expected - (i % 6 === 0 ? 1 : 0)) : null;
      docs.countLines.push([rng.uuid(), id, v.id, expected, counted, ledger.get(yun, v.id).avgCost || v.cost]);
    });
    docs.counts.push([id, orgId, number, yun, catIds.get('Dorixona'), 'open', 'Dorixona bo‘limi revizioni', storekeeper, at(today, 8.2), null]);
  }

  // ── Persist ──
  progress(0.68, 'saving');
  await insertMany(db, 'variants', ['id', 'org_id', 'product_id', 'name', 'sku', 'barcode', 'barcode_type', 'last_cost', 'created_at'], variants.map((v) => [v.id, orgId, v.productId, v.name, v.sku, v.barcode, 'ean13', v.cost, at(startDay, -24 * 5)]));
  await insertMany(db, 'prices', ['price_list_id', 'variant_id', 'price'], [
    ...variants.map((v) => [priceLists.get('retail'), v.id, v.retail]),
    ...variants.map((v) => [priceLists.get('wholesale'), v.id, v.wholesale]),
  ]);
  await insertMany(db, 'batches', ['id', 'org_id', 'variant_id', 'code', 'expires_at', 'created_at'], batchRows);
  await insertMany(
    db,
    'purchase_orders',
    ['id', 'org_id', 'number', 'supplier_id', 'warehouse_id', 'status', 'expected_at', 'total', 'user_id', 'created_at'],
    docs.pos.map((p) => [p.id, orgId, p.number, supplierIds[p.supplier], cen, p.status, addDays(tashkentDay(p.created), 2), p.total, manager, p.created]),
  );
  await insertMany(
    db,
    'purchase_order_lines',
    ['id', 'po_id', 'variant_id', 'qty_ordered', 'qty_received', 'unit_cost'],
    docs.pos.flatMap((p) => p.lines.map((l) => [l.id, p.id, l.v.id, l.qty, l.received, l.cost])),
  );
  await insertMany(db, 'goods_receipts', ['id', 'org_id', 'number', 'po_id', 'supplier_id', 'warehouse_id', 'total', 'paid', 'due_date', 'note', 'user_id', 'created_at'], docs.receipts);
  await insertMany(db, 'goods_receipt_lines', ['id', 'receipt_id', 'po_line_id', 'variant_id', 'batch_id', 'qty', 'unit_cost'], docs.receiptLines);
  await insertMany(db, 'transfers', ['id', 'org_id', 'number', 'from_warehouse_id', 'to_warehouse_id', 'note', 'user_id', 'created_at'], docs.transfers);
  await insertMany(db, 'transfer_lines', ['id', 'transfer_id', 'variant_id', 'qty', 'unit_cost'], docs.transferLines);
  await insertMany(db, 'write_offs', ['id', 'org_id', 'number', 'warehouse_id', 'reason', 'note', 'total_cost', 'user_id', 'created_at'], docs.writeOffs);
  await insertMany(db, 'write_off_lines', ['id', 'write_off_id', 'variant_id', 'batch_id', 'qty', 'unit_cost'], docs.writeOffLines);
  await insertMany(db, 'shifts', ['id', 'org_id', 'warehouse_id', 'user_id', 'number', 'status', 'opening_cash', 'counted_cash', 'expected_cash', 'note', 'opened_at', 'closed_at'], docs.shifts);
  progress(0.74, 'saving');
  const saleCols = ['id', 'org_id', 'number', 'warehouse_id', 'shift_id', 'user_id', 'customer_id', 'price_list_id', 'subtotal', 'discount_total', 'total', 'cost_total', 'paid', 'change', 'debt', 'due_date', 'returned_total', 'status', 'created_at'];
  await insertMany(db, 'sales', saleCols, docs.sales.map((s) => saleCols.map((c) => s[c] ?? null)));
  const lineCols = ['id', 'sale_id', 'variant_id', 'unit_code', 'unit_factor', 'qty', 'base_qty', 'unit_price', 'discount', 'total', 'cost_total', 'returned_qty'];
  await insertMany(db, 'sale_lines', lineCols, docs.saleLines.map((s) => lineCols.map((c) => s[c] ?? null)));
  await insertMany(db, 'sale_payments', ['id', 'sale_id', 'method', 'amount', 'provider_ref', 'created_at'], docs.payments);
  await insertMany(db, 'sale_returns', ['id', 'org_id', 'number', 'sale_id', 'warehouse_id', 'shift_id', 'total', 'cost_total', 'refund_method', 'reason', 'user_id', 'created_at'], docs.returns);
  await insertMany(db, 'sale_return_lines', ['id', 'return_id', 'sale_line_id', 'variant_id', 'base_qty', 'amount', 'cost_total'], docs.returnLines);
  await insertMany(db, 'inventory_counts', ['id', 'org_id', 'number', 'warehouse_id', 'category_id', 'status', 'note', 'user_id', 'created_at', 'applied_at'], docs.counts);
  await insertMany(db, 'inventory_count_lines', ['id', 'count_id', 'variant_id', 'expected_qty', 'counted_qty', 'unit_cost'], docs.countLines);
  progress(0.8, 'ledger');
  // Bulk load: insert the ledger with the per-row trigger paused, then materialise balances from it in
  // one set-based statement (the same derivation the trigger performs row by row). The drift check in
  // the tests proves both paths agree.
  await db.tx(async (tx) => {
    await tx.exec('ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_apply');
    await insertMany(
      tx,
      'stock_movements',
      ['org_id', 'warehouse_id', 'variant_id', 'batch_id', 'kind', 'qty', 'unit_cost', 'cost_value', 'doc_type', 'doc_id', 'user_id', 'note', 'created_at'],
      movementRows,
    );
    await tx.query(
      `INSERT INTO stock_balances (org_id, warehouse_id, variant_id, qty, avg_cost, updated_at)
       SELECT org_id, warehouse_id, variant_id, sum(qty), 0, max(created_at) FROM stock_movements WHERE org_id = $1 GROUP BY 1, 2, 3`,
      [orgId],
    );
    await tx.query(
      `INSERT INTO batch_balances (warehouse_id, batch_id, qty)
       SELECT warehouse_id, batch_id, sum(qty) FROM stock_movements WHERE org_id = $1 AND batch_id IS NOT NULL GROUP BY 1, 2`,
      [orgId],
    );
    await tx.exec('ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_apply');
  });
  progress(0.93, 'ledger');
  const keys = [...ledger.balances.entries()];
  await db.query(
    `UPDATE stock_balances b SET avg_cost = t.c FROM unnest($1::uuid[], $2::uuid[], $3::numeric[]) AS t(w, v, c) WHERE b.warehouse_id = t.w AND b.variant_id = t.v`,
    [keys.map(([k]) => k.split(':')[0]), keys.map(([k]) => k.split(':')[1]), keys.map(([, b]) => b.avgCost)],
  );
  await insertMany(db, 'debt_entries', ['id', 'org_id', 'party_type', 'party_id', 'kind', 'amount', 'due_date', 'method', 'doc_type', 'doc_id', 'note', 'user_id', 'created_at'], docs.debts);
  await insertMany(db, 'doc_counters', ['org_id', 'kind', 'last'], [
    ...Object.entries(counters).map(([k, v]) => [orgId, k, v]),
    [orgId, 'sku', seq],
  ]);
  docs.audit.sort((a, b) => (a[6] as Date).getTime() - (b[6] as Date).getTime());
  await insertMany(db, 'audit_log', ['org_id', 'user_id', 'action', 'entity', 'entity_id', 'payload', 'created_at'], docs.audit);
  progress(1, 'done');

  const whs = await many<{ id: string; name: string; code: string; kind: string }>(db, 'SELECT id, name, code, kind FROM warehouses WHERE org_id = $1 ORDER BY kind DESC, name', [orgId]);
  return {
    orgId,
    users: [
      { role: 'owner', userId: ownerId, name: 'Akmal Karimov', email: 'owner@demo.uz', warehouseIds: null },
      ...people.map((p) => ({ role: p.role, userId: p.id, name: p.name, email: p.email, warehouseIds: p.wh })),
    ],
    warehouses: whs,
    counts: { products: CATALOG.length, variants: variants.length, sales: docs.sales.length, movements: movementRows.length },
  };
}
