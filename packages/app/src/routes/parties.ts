import { ageOpenItems, allocatePayments, roundMoney, sumMoney, type AgingBucket } from '@omborchi/core';
import type { Db } from '@omborchi/db';
import { z } from 'zod';
import { AppError } from '../errors';
import { assertWarehouse, route, type Ctx } from '../router';
import { dateStr, id, money, name, optId, qty, text } from '../schemas';
import { insertMany, like, many, nextNumber, one } from '../sql';
import { receiveGoods } from './stock';

type PartyType = 'customer' | 'supplier';

interface DebtEntryRow {
  id: string;
  party_id: string;
  kind: 'charge' | 'payment';
  amount: number;
  due_date: string | null;
  created_at: Date | string;
  method: string | null;
  doc_type: string | null;
  doc_id: string | null;
  note: string | null;
}

export interface DebtSummary {
  balance: number;
  overdue: number;
  nextDue: string | null;
  aging: Record<AgingBucket, number>;
}

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

export function summarizeDebts(entries: DebtEntryRow[], asOf: Date): DebtSummary {
  const pos = allocatePayments(
    entries.filter((e) => e.kind === 'charge').map((e) => ({ id: e.id, amount: e.amount, createdAt: toDate(e.created_at), dueDate: e.due_date ? new Date(`${e.due_date}T00:00:00Z`) : null })),
    entries.filter((e) => e.kind === 'payment').map((e) => ({ amount: e.amount, createdAt: toDate(e.created_at) })),
  );
  const aging = ageOpenItems(pos.open, asOf);
  const overdue = sumMoney([aging.d1_30, aging.d31_60, aging.d61_90, aging.d90_plus]);
  const nextDue = pos.open.map((o) => (o.dueDate ? o.dueDate.toISOString().slice(0, 10) : null)).filter((d): d is string => !!d).sort()[0] ?? null;
  return { balance: roundMoney(pos.balance - pos.credit), overdue, nextDue, aging };
}

export async function debtSummaries(db: Db, orgId: string, partyType: PartyType, asOf: Date): Promise<Map<string, DebtSummary>> {
  const entries = await many<DebtEntryRow>(
    db,
    `SELECT id, party_id, kind, amount, due_date, created_at, method, doc_type, doc_id, note FROM debt_entries WHERE org_id = $1 AND party_type = $2 ORDER BY created_at`,
    [orgId, partyType],
  );
  const by = new Map<string, DebtEntryRow[]>();
  for (const e of entries) by.set(e.party_id, [...(by.get(e.party_id) ?? []), e]);
  return new Map([...by].map(([k, v]) => [k, summarizeDebts(v, asOf)]));
}

async function partyLedger(db: Db, orgId: string, partyType: PartyType, partyId: string, asOf: Date) {
  const entries = await many<DebtEntryRow & { user_name: string | null }>(
    db,
    `SELECT d.id, d.party_id, d.kind, d.amount, d.due_date, d.created_at, d.method, d.doc_type, d.doc_id, d.note, u.name AS user_name
     FROM debt_entries d LEFT JOIN users u ON u.id = d.user_id WHERE d.org_id = $1 AND d.party_type = $2 AND d.party_id = $3 ORDER BY d.created_at, d.id`,
    [orgId, partyType, partyId],
  );
  let running = 0;
  const withBalance = entries.map((e) => {
    running = roundMoney(running + (e.kind === 'charge' ? e.amount : -e.amount));
    return { ...e, balance: running };
  });
  return { entries: withBalance.reverse(), summary: summarizeDebts(entries, asOf) };
}

async function recordPayment(ctx: Ctx, partyType: PartyType, partyId: string, amount: number, method: string, note: string | null) {
  const table = partyType === 'customer' ? 'customers' : 'suppliers';
  await one(ctx.db, `SELECT 1 FROM ${table} WHERE id = $1 AND org_id = $2 FOR UPDATE`, [partyId, ctx.actor.orgId], partyType === 'customer' ? 'Customer' : 'Supplier');
  const row = await one<{ id: string }>(
    ctx.db,
    `INSERT INTO debt_entries (org_id, party_type, party_id, kind, amount, method, doc_type, note, user_id, created_at)
     VALUES ($1,$2,$3,'payment',$4,$5,'payment',$6,$7,$8) RETURNING id`,
    [ctx.actor.orgId, partyType, partyId, roundMoney(amount), method, note, ctx.actor.userId, ctx.now()],
  );
  return row;
}

const partyInput = z.object({ id: optId, name, phone: text(40).nullish(), note: text(500).nullish() });

export const partyRoutes = {
  // ── Customers ──
  'customers.list': route({
    method: 'GET',
    path: '/customers',
    permission: 'customers.view',
    input: z.object({ q: z.string().optional(), withDebt: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional() }),
    handler: async (ctx, i) => {
      const rows = await many<{ id: string; name: string; phone: string | null; note: string | null; credit_limit: number | null; created_at: string; sales_count: number; sales_total: number; last_sale: string | null }>(
        ctx.db,
        `SELECT c.id, c.name, c.phone, c.note, c.credit_limit, c.created_at,
                count(s.id)::int AS sales_count, coalesce(sum(s.total), 0) AS sales_total, max(s.created_at) AS last_sale
         FROM customers c LEFT JOIN sales s ON s.customer_id = c.id
         WHERE c.org_id = $1 AND ($2::text IS NULL OR c.name ILIKE $2 OR c.phone ILIKE $2)
         GROUP BY c.id ORDER BY c.name LIMIT 1000`,
        [ctx.actor.orgId, like(i.q)],
      );
      const debts = await debtSummaries(ctx.db, ctx.actor.orgId, 'customer', ctx.now());
      const out = rows.map((r) => ({ ...r, ...(debts.get(r.id) ?? { balance: 0, overdue: 0, nextDue: null }) }));
      return i.withDebt ? out.filter((r) => r.balance > 0) : out;
    },
  }),

  'customers.save': route({
    method: 'POST',
    path: '/customers',
    permission: 'customers.edit',
    input: partyInput.extend({ creditLimit: money.nullish() }),
    audit: { action: 'customer.save', entity: 'customer' },
    handler: async (ctx, i) =>
      i.id
        ? one<{ id: string }>(
            ctx.db,
            'UPDATE customers SET name=$3, phone=$4, note=$5, credit_limit=$6 WHERE id=$1 AND org_id=$2 RETURNING id',
            [i.id, ctx.actor.orgId, i.name, i.phone ?? null, i.note ?? null, i.creditLimit ?? null],
            'Customer',
          )
        : one<{ id: string }>(ctx.db, 'INSERT INTO customers (org_id, name, phone, note, credit_limit, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [
            ctx.actor.orgId,
            i.name,
            i.phone ?? null,
            i.note ?? null,
            i.creditLimit ?? null,
            ctx.now(),
          ]),
  }),

  'customers.get': route({
    method: 'GET',
    path: '/customers/:id',
    permission: 'customers.view',
    input: z.object({ id }),
    handler: async (ctx, { id }) => {
      const customer = await one<{ id: string; name: string; phone: string | null; note: string | null; credit_limit: number | null; created_at: string }>(
        ctx.db,
        'SELECT id, name, phone, note, credit_limit, created_at FROM customers WHERE id = $1 AND org_id = $2',
        [id, ctx.actor.orgId],
        'Customer',
      );
      const [ledger, sales] = await Promise.all([
        partyLedger(ctx.db, ctx.actor.orgId, 'customer', id, ctx.now()),
        many<{ id: string; number: string; created_at: string; total: number; debt: number; due_date: string | null; status: string }>(
          ctx.db,
          'SELECT id, number, created_at, total, debt, due_date, status FROM sales WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100',
          [id],
        ),
      ]);
      return { ...customer, ...ledger, sales };
    },
  }),

  'customers.collect': route({
    method: 'POST',
    path: '/customers/:id/payments',
    permission: 'customers.collect',
    input: z.object({ id, amount: money.refine((v) => v > 0, 'Must be positive'), method: z.enum(['cash', 'card', 'payme', 'click', 'uzum']), note: text(500).nullish() }),
    audit: { action: 'customer.payment', entity: 'customer' },
    handler: async (ctx, i) => {
      const r = await recordPayment(ctx, 'customer', i.id, i.amount, i.method, i.note ?? null);
      // Cash collected at the till belongs to the cashier's open shift.
      return { id: i.id, paymentId: r.id };
    },
  }),

  // ── Suppliers ──
  'suppliers.list': route({
    method: 'GET',
    path: '/suppliers',
    permission: 'purchasing.view',
    input: z.object({ q: z.string().optional() }),
    handler: async (ctx, i) => {
      const rows = await many<{ id: string; name: string; phone: string | null; contact: string | null; inn: string | null; address: string | null; receipts: number; purchased: number; last_receipt: string | null; open_pos: number }>(
        ctx.db,
        `SELECT s.id, s.name, s.phone, s.contact, s.inn, s.address,
                (SELECT count(*)::int FROM goods_receipts r WHERE r.supplier_id = s.id) AS receipts,
                (SELECT coalesce(sum(total), 0) FROM goods_receipts r WHERE r.supplier_id = s.id) AS purchased,
                (SELECT max(created_at) FROM goods_receipts r WHERE r.supplier_id = s.id) AS last_receipt,
                (SELECT count(*)::int FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status IN ('ordered','partial')) AS open_pos
         FROM suppliers s WHERE s.org_id = $1 AND ($2::text IS NULL OR s.name ILIKE $2 OR s.phone ILIKE $2) ORDER BY s.name`,
        [ctx.actor.orgId, like(i.q)],
      );
      const debts = await debtSummaries(ctx.db, ctx.actor.orgId, 'supplier', ctx.now());
      return rows.map((r) => ({ ...r, ...(debts.get(r.id) ?? { balance: 0, overdue: 0, nextDue: null }) }));
    },
  }),

  'suppliers.save': route({
    method: 'POST',
    path: '/suppliers',
    permission: 'purchasing.edit',
    input: partyInput.extend({ contact: text(100).nullish(), inn: text(20).nullish(), address: text(300).nullish() }),
    audit: { action: 'supplier.save', entity: 'supplier' },
    handler: async (ctx, i) =>
      i.id
        ? one<{ id: string }>(
            ctx.db,
            'UPDATE suppliers SET name=$3, phone=$4, contact=$5, inn=$6, address=$7 WHERE id=$1 AND org_id=$2 RETURNING id',
            [i.id, ctx.actor.orgId, i.name, i.phone ?? null, i.contact ?? null, i.inn ?? null, i.address ?? null],
            'Supplier',
          )
        : one<{ id: string }>(ctx.db, 'INSERT INTO suppliers (org_id, name, phone, contact, inn, address, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [
            ctx.actor.orgId,
            i.name,
            i.phone ?? null,
            i.contact ?? null,
            i.inn ?? null,
            i.address ?? null,
            ctx.now(),
          ]),
  }),

  'suppliers.get': route({
    method: 'GET',
    path: '/suppliers/:id',
    permission: 'purchasing.view',
    input: z.object({ id }),
    handler: async (ctx, { id }) => {
      const supplier = await one<{ id: string; name: string; phone: string | null; contact: string | null; inn: string | null; address: string | null }>(
        ctx.db,
        'SELECT id, name, phone, contact, inn, address FROM suppliers WHERE id = $1 AND org_id = $2',
        [id, ctx.actor.orgId],
        'Supplier',
      );
      const ledger = await partyLedger(ctx.db, ctx.actor.orgId, 'supplier', id, ctx.now());
      return { ...supplier, ...ledger };
    },
  }),

  'suppliers.pay': route({
    method: 'POST',
    path: '/suppliers/:id/payments',
    permission: 'suppliers.pay',
    input: z.object({ id, amount: money.refine((v) => v > 0, 'Must be positive'), method: z.enum(['cash', 'card', 'transfer']), note: text(500).nullish() }),
    audit: { action: 'supplier.payment', entity: 'supplier' },
    handler: async (ctx, i) => {
      const r = await recordPayment(ctx, 'supplier', i.id, i.amount, i.method, i.note ?? null);
      return { id: i.id, paymentId: r.id };
    },
  }),

  // ── Purchase orders ──
  'purchaseOrders.list': route({
    method: 'GET',
    path: '/purchase-orders',
    permission: 'purchasing.view',
    input: z.object({ status: z.enum(['draft', 'ordered', 'partial', 'received', 'cancelled']).optional(), supplierId: optId }),
    handler: (ctx, i) =>
      many<{ id: string; number: string; status: string; created_at: string; expected_at: string | null; supplier: string; supplier_id: string; warehouse: string; total: number; ordered: number; received: number; lines: number }>(
        ctx.db,
        `SELECT po.id, po.number, po.status, po.created_at, po.expected_at, s.name AS supplier, s.id AS supplier_id, w.name AS warehouse, po.total,
                coalesce(sum(l.qty_ordered), 0) AS ordered, coalesce(sum(l.qty_received), 0) AS received, count(l.id)::int AS lines
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN warehouses w ON w.id = po.warehouse_id
         LEFT JOIN purchase_order_lines l ON l.po_id = po.id
         WHERE po.org_id = $1 AND ($2::text IS NULL OR po.status = $2) AND ($3::uuid IS NULL OR po.supplier_id = $3)
         GROUP BY po.id, s.name, s.id, w.name ORDER BY po.created_at DESC LIMIT 500`,
        [ctx.actor.orgId, i.status ?? null, i.supplierId ?? null],
      ),
  }),

  'purchaseOrders.get': route({
    method: 'GET',
    path: '/purchase-orders/:id',
    permission: 'purchasing.view',
    input: z.object({ id }),
    handler: async (ctx, { id }) => {
      const po = await one<{ id: string; number: string; status: string; created_at: string; expected_at: string | null; note: string | null; supplier: string; supplier_id: string; warehouse: string; warehouse_id: string; total: number }>(
        ctx.db,
        `SELECT po.id, po.number, po.status, po.created_at, po.expected_at, po.note, s.name AS supplier, s.id AS supplier_id, w.name AS warehouse, w.id AS warehouse_id, po.total
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN warehouses w ON w.id = po.warehouse_id WHERE po.id = $1 AND po.org_id = $2`,
        [id, ctx.actor.orgId],
        'Purchase order',
      );
      const [lines, receipts] = await Promise.all([
        many<{ id: string; variant_id: string; name: string; sku: string; unit: string; track_expiry: boolean; qty_ordered: number; qty_received: number; unit_cost: number }>(
          ctx.db,
          `SELECT l.id, l.variant_id, p.name || CASE WHEN v.name <> '' THEN ' · ' || v.name ELSE '' END AS name, v.sku, u.code AS unit, p.track_expiry,
                  l.qty_ordered, l.qty_received, l.unit_cost
           FROM purchase_order_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
           WHERE l.po_id = $1 ORDER BY p.name`,
          [id],
        ),
        many<{ id: string; number: string; created_at: string; total: number; paid: number }>(
          ctx.db,
          'SELECT id, number, created_at, total, paid FROM goods_receipts WHERE po_id = $1 ORDER BY created_at',
          [id],
        ),
      ]);
      return { ...po, lines, receipts };
    },
  }),

  'purchaseOrders.create': route({
    method: 'POST',
    path: '/purchase-orders',
    permission: 'purchasing.edit',
    input: z.object({
      supplierId: id,
      warehouseId: id,
      expectedAt: dateStr.nullish(),
      note: text(500).nullish(),
      lines: z.array(z.object({ variantId: id, qty, unitCost: money })).min(1).max(500),
    }),
    audit: { action: 'purchase_order.create', entity: 'purchase_order' },
    handler: async (ctx, i) => {
      assertWarehouse(ctx, i.warehouseId);
      await one(ctx.db, 'SELECT 1 FROM suppliers WHERE id = $1 AND org_id = $2', [i.supplierId, ctx.actor.orgId], 'Supplier');
      const number = await nextNumber(ctx.db, ctx.actor.orgId, 'po');
      const total = sumMoney(i.lines.map((l) => roundMoney(l.qty * l.unitCost)));
      const po = await one<{ id: string }>(
        ctx.db,
        `INSERT INTO purchase_orders (org_id, number, supplier_id, warehouse_id, status, expected_at, note, total, user_id, created_at)
         VALUES ($1,$2,$3,$4,'ordered',$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.actor.orgId, number, i.supplierId, i.warehouseId, i.expectedAt ?? null, i.note ?? null, total, ctx.actor.userId, ctx.now()],
      );
      await insertMany(
        ctx.db,
        'purchase_order_lines',
        ['po_id', 'variant_id', 'qty_ordered', 'unit_cost'],
        i.lines.map((l) => [po.id, l.variantId, l.qty, l.unitCost]),
      );
      return { id: po.id, number };
    },
  }),

  'purchaseOrders.receive': route({
    method: 'POST',
    path: '/purchase-orders/:id/receive',
    permission: 'stock.receive',
    input: z.object({
      id,
      lines: z.array(z.object({ poLineId: id, qty, unitCost: money.optional(), batchCode: text(64).nullish(), expiresAt: dateStr.nullish() })).min(1),
      paid: money.default(0),
      method: z.enum(['cash', 'card', 'transfer']).default('cash'),
      dueDate: dateStr.nullish(),
    }),
    audit: { action: 'purchase_order.receive', entity: 'purchase_order' },
    handler: async (ctx, i) => {
      const po = await one<{ id: string; status: string; supplier_id: string; warehouse_id: string; number: string }>(
        ctx.db,
        'SELECT id, status, supplier_id, warehouse_id, number FROM purchase_orders WHERE id = $1 AND org_id = $2 FOR UPDATE',
        [i.id, ctx.actor.orgId],
        'Purchase order',
      );
      if (po.status !== 'ordered' && po.status !== 'partial') throw new AppError('INVALID_STATE', `Order is ${po.status}`);
      const lines = await many<{ id: string; variant_id: string; qty_ordered: number; qty_received: number; unit_cost: number }>(
        ctx.db,
        'SELECT id, variant_id, qty_ordered, qty_received, unit_cost FROM purchase_order_lines WHERE po_id = $1',
        [po.id],
      );
      const byId = new Map(lines.map((l) => [l.id, l]));
      const receive = i.lines.map((r) => {
        const l = byId.get(r.poLineId);
        if (!l) throw new AppError('VALIDATION', 'Line does not belong to this order', { poLineId: r.poLineId });
        if (r.qty > roundMoney(l.qty_ordered - l.qty_received) + 1e-9) {
          throw new AppError('VALIDATION', 'Cannot receive more than ordered', { poLineId: r.poLineId, remaining: l.qty_ordered - l.qty_received });
        }
        return { variantId: l.variant_id, qty: r.qty, unitCost: r.unitCost ?? l.unit_cost, poLineId: l.id, batchCode: r.batchCode, expiresAt: r.expiresAt };
      });
      const receipt = await receiveGoods(ctx, {
        supplierId: po.supplier_id,
        warehouseId: po.warehouse_id,
        poId: po.id,
        lines: receive,
        paid: i.paid,
        method: i.method,
        dueDate: i.dueDate,
        note: po.number,
      });
      await ctx.db.query(
        `UPDATE purchase_order_lines l SET qty_received = l.qty_received + t.q FROM unnest($1::uuid[], $2::numeric[]) AS t(id, q) WHERE l.id = t.id`,
        [receive.map((r) => r.poLineId), receive.map((r) => r.qty)],
      );
      const { open } = await one<{ open: number }>(ctx.db, 'SELECT count(*)::int AS open FROM purchase_order_lines WHERE po_id = $1 AND qty_received < qty_ordered', [po.id]);
      await ctx.db.query('UPDATE purchase_orders SET status = $2 WHERE id = $1', [po.id, open === 0 ? 'received' : 'partial']);
      return { id: po.id, receiptId: receipt.id, receiptNumber: receipt.number, status: open === 0 ? 'received' : 'partial' };
    },
  }),

  'purchaseOrders.cancel': route({
    method: 'POST',
    path: '/purchase-orders/:id/cancel',
    permission: 'purchasing.edit',
    input: z.object({ id }),
    audit: { action: 'purchase_order.cancel', entity: 'purchase_order' },
    handler: (ctx, { id }) =>
      one<{ id: string }>(ctx.db, `UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1 AND org_id = $2 AND status = 'ordered' RETURNING id`, [id, ctx.actor.orgId], 'Open purchase order'),
  }),
};
