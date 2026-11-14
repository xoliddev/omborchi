import { addDays, can, PAYMENT_METHODS, PAYMENT_PROVIDERS, priceCart, roundMoney, roundQty, settle, sumMoney, tashkentDay } from '@omborchi/core';
import type { Db } from '@omborchi/db';
import { z } from 'zod';
import { AppError } from '../errors';
import { assertWarehouse, route, type Ctx } from '../router';
import { dateStr, discount, id, money, optId, paging, range, text } from '../schemas';
import { insertMany, like, many, maybeOne, nextNumber, one, tsFrom, tsTo, type Page } from '../sql';
import { postMovements, splitByBatches, type PostLine } from '../stock';
import { warehouseScope } from './catalog';
import { debtSummaries } from './parties';

const saleInput = z.object({
  warehouseId: id,
  customerId: optId,
  priceListId: optId,
  lines: z
    .array(
      z.object({
        variantId: id,
        qty: z.coerce.number().positive().max(1e6),
        unit: z.string().max(16).nullish(),
        unitPrice: money.nullish(),
        discount,
      }),
    )
    .min(1)
    .max(300),
  cartDiscount: discount,
  payments: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount: money })).max(10).default([]),
  dueDate: dateStr.nullish(),
  note: text(500).nullish(),
});

export type SaleInput = z.input<typeof saleInput>;

async function openShift(db: Db, ctx: Ctx, warehouseId: string) {
  return maybeOne<{ id: string; number: string; opened_at: string; opening_cash: number }>(
    db,
    `SELECT id, number, opened_at, opening_cash FROM shifts WHERE org_id = $1 AND warehouse_id = $2 AND user_id = $3 AND status = 'open'`,
    [ctx.actor.orgId, warehouseId, ctx.actor.userId],
  );
}

export async function createSale(ctx: Ctx, input: z.output<typeof saleInput>) {
  const { db } = ctx;
  const org = ctx.actor.orgId;
  assertWarehouse(ctx, input.warehouseId);
  const shift = await openShift(db, ctx, input.warehouseId);
  if (!shift) throw new AppError('NO_OPEN_SHIFT', 'Open a cashier shift before selling');

  const priceListId =
    input.priceListId ??
    (await one<{ id: string }>(db, 'SELECT id FROM price_lists WHERE org_id = $1 ORDER BY is_default DESC, code LIMIT 1', [org], 'Price list')).id;
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
  const info = await many<{ id: string; product_id: string; unit: string; allow_fraction: boolean; price: number | null; default_price: number | null }>(
    db,
    `SELECT v.id, v.product_id, u.code AS unit, u.allow_fraction, pr.price, dp.price AS default_price
     FROM variants v JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
     LEFT JOIN prices pr ON pr.variant_id = v.id AND pr.price_list_id = $2
     LEFT JOIN prices dp ON dp.variant_id = v.id AND dp.price_list_id = (SELECT id FROM price_lists WHERE org_id = $3 AND is_default LIMIT 1)
     WHERE v.id = ANY($1::uuid[]) AND v.org_id = $3 AND v.is_active AND p.is_active`,
    [variantIds, priceListId, org],
  );
  const byId = new Map(info.map((v) => [v.id, v]));
  const altUnits = await many<{ product_id: string; unit: string; factor: number }>(
    db,
    `SELECT pu.product_id, u.code AS unit, pu.factor FROM product_units pu JOIN units u ON u.id = pu.unit_id WHERE pu.product_id = ANY($1::uuid[])`,
    [info.map((v) => v.product_id)],
  );
  const mayDiscount = can(ctx.actor.role, 'sales.discount');
  const lines = input.lines.map((l) => {
    const v = byId.get(l.variantId);
    if (!v) throw new AppError('NOT_FOUND', 'Product not found or archived', { variantId: l.variantId });
    let factor = 1;
    const unit = l.unit ?? v.unit;
    if (unit !== v.unit) {
      const alt = altUnits.find((a) => a.product_id === v.product_id && a.unit === unit);
      if (!alt) throw new AppError('VALIDATION', `Unit ${unit} is not set up for this product`, { variantId: l.variantId });
      factor = alt.factor;
    }
    if (!v.allow_fraction && factor === 1 && !Number.isInteger(l.qty)) throw new AppError('VALIDATION', 'This product is sold in whole units', { variantId: l.variantId });
    const listPrice = roundMoney((v.price ?? v.default_price ?? 0) * factor);
    const unitPrice = l.unitPrice ?? listPrice;
    if (!mayDiscount && (Math.abs(unitPrice - listPrice) > 0.001 || (l.discount && l.discount.value > 0))) {
      throw new AppError('PRICE_OVERRIDE_FORBIDDEN', 'You are not allowed to change prices or give discounts');
    }
    return { variantId: l.variantId, unit, factor, qty: l.qty, unitPrice, discount: l.discount ?? null };
  });
  if (!mayDiscount && input.cartDiscount && input.cartDiscount.value > 0) {
    throw new AppError('PRICE_OVERRIDE_FORBIDDEN', 'You are not allowed to give discounts');
  }

  const cart = priceCart(
    lines.map((l) => ({ unitPrice: l.unitPrice, qty: l.qty, unitFactor: l.factor, discount: l.discount })),
    input.cartDiscount ?? null,
  );
  const settlement = settle(cart.total, input.payments, { hasCustomer: !!input.customerId });
  const at = ctx.now();
  let dueDate: string | null = null;
  if (settlement.debt > 0) {
    const customer = await one<{ credit_limit: number | null }>(db, 'SELECT credit_limit FROM customers WHERE id = $1 AND org_id = $2 FOR UPDATE', [input.customerId, org], 'Customer');
    if (customer.credit_limit !== null) {
      const current = (await debtSummaries(db, org, 'customer', at)).get(input.customerId!)?.balance ?? 0;
      if (current + settlement.debt > customer.credit_limit + 0.001) {
        throw new AppError('PAYMENT', 'Credit limit exceeded', { reason: 'CREDIT_LIMIT', limit: customer.credit_limit, balance: current });
      }
    }
    dueDate = input.dueDate ?? addDays(tashkentDay(at), 14);
  } else if (input.customerId) {
    await one(db, 'SELECT 1 FROM customers WHERE id = $1 AND org_id = $2', [input.customerId, org], 'Customer');
  }

  const number = await nextNumber(db, org, 'sale');
  const sale = await one<{ id: string }>(
    db,
    `INSERT INTO sales (org_id, number, warehouse_id, shift_id, user_id, customer_id, price_list_id, subtotal, discount_total, total, paid, change, debt, due_date, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [
      org,
      number,
      input.warehouseId,
      shift.id,
      ctx.actor.userId,
      input.customerId ?? null,
      priceListId,
      cart.subtotal,
      cart.discountTotal,
      cart.total,
      settlement.paid,
      settlement.change,
      settlement.debt,
      dueDate,
      input.note ?? null,
      at,
    ],
  );

  // Stock out (FEFO across batches for expiry-tracked goods), booked at weighted-average cost.
  const out = await splitByBatches(
    db,
    lines.map((l, idx) => ({ warehouseId: input.warehouseId, variantId: l.variantId, kind: 'sale' as const, qty: -cart.lines[idx].baseQty, ref: idx })),
  );
  const posted = await postMovements(db, { orgId: org, userId: ctx.actor.userId, at, docType: 'sale', docId: sale.id }, out);
  const costByLine = new Map<number, number>();
  for (const p of posted) costByLine.set(p.ref!, roundMoney((costByLine.get(p.ref!) ?? 0) - p.costValue));
  const costTotal = sumMoney(costByLine.values());

  await insertMany(
    db,
    'sale_lines',
    ['sale_id', 'variant_id', 'unit_code', 'unit_factor', 'qty', 'base_qty', 'unit_price', 'discount', 'total', 'cost_total'],
    lines.map((l, idx) => {
      const pl = cart.lines[idx];
      return [sale.id, l.variantId, l.unit, l.factor, pl.qty, pl.baseQty, pl.unitPrice, roundMoney(pl.lineDiscount + pl.cartDiscountShare), pl.total, costByLine.get(idx) ?? 0];
    }),
  );
  const payments = [];
  for (const p of settlement.applied) {
    const auth = await PAYMENT_PROVIDERS[p.method].authorize({ amount: p.amount, reference: number });
    if (auth.status !== 'approved') throw new AppError('PAYMENT', `${PAYMENT_PROVIDERS[p.method].label} declined the payment`, { method: p.method });
    payments.push([sale.id, p.method, p.amount, auth.providerRef, at]);
  }
  await insertMany(db, 'sale_payments', ['sale_id', 'method', 'amount', 'provider_ref', 'created_at'], payments);
  await db.query('UPDATE sales SET cost_total = $2 WHERE id = $1', [sale.id, costTotal]);
  if (settlement.debt > 0) {
    await db.query(
      `INSERT INTO debt_entries (org_id, party_type, party_id, kind, amount, due_date, doc_type, doc_id, note, user_id, created_at)
       VALUES ($1,'customer',$2,'charge',$3,$4,'sale',$5,$6,$7,$8)`,
      [org, input.customerId, settlement.debt, dueDate, sale.id, number, ctx.actor.userId, at],
    );
  }
  return { id: sale.id, number, total: cart.total, paid: settlement.paid, change: settlement.change, debt: settlement.debt, dueDate };
}

async function shiftTotals(db: Db, shiftId: string) {
  const [sales, payments, returns, collections] = await Promise.all([
    one<{ count: number; total: number; discount: number; cost: number; debt: number }>(
      db,
      `SELECT count(*)::int AS count, coalesce(sum(total), 0) AS total, coalesce(sum(discount_total), 0) AS discount,
              coalesce(sum(cost_total), 0) AS cost, coalesce(sum(debt), 0) AS debt FROM sales WHERE shift_id = $1`,
      [shiftId],
    ),
    many<{ method: string; amount: number }>(
      db,
      `SELECT sp.method, sum(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.shift_id = $1 GROUP BY sp.method ORDER BY sp.method`,
      [shiftId],
    ),
    one<{ count: number; total: number; cash: number; cost: number }>(
      db,
      `SELECT count(*)::int AS count, coalesce(sum(total), 0) AS total, coalesce(sum(total) FILTER (WHERE refund_method = 'cash'), 0) AS cash,
              coalesce(sum(cost_total), 0) AS cost FROM sale_returns WHERE shift_id = $1`,
      [shiftId],
    ),
    one<{ cash: number; total: number }>(
      db,
      `SELECT coalesce(sum(d.amount) FILTER (WHERE d.method = 'cash'), 0) AS cash, coalesce(sum(d.amount), 0) AS total
       FROM debt_entries d JOIN shifts sh ON sh.id = $1
       WHERE d.party_type = 'customer' AND d.kind = 'payment' AND d.doc_type = 'payment' AND d.user_id = sh.user_id
         AND d.created_at >= sh.opened_at AND d.created_at <= coalesce(sh.closed_at, 'infinity'::timestamptz)`,
      [shiftId],
    ),
  ]);
  const cashSales = payments.find((p) => p.method === 'cash')?.amount ?? 0;
  return {
    sales,
    payments,
    returns,
    collections,
    cashIn: roundMoney(cashSales + collections.cash - returns.cash),
    grossProfit: roundMoney(sales.total - sales.cost - (returns.total - returns.cost)),
  };
}

export const salesRoutes = {
  'shifts.current': route({
    method: 'GET',
    path: '/shifts/current',
    permission: 'sales.create',
    input: z.object({ warehouseId: id }),
    handler: async (ctx, i) => {
      assertWarehouse(ctx, i.warehouseId);
      const s = await openShift(ctx.db, ctx, i.warehouseId);
      if (!s) return null;
      const t = await shiftTotals(ctx.db, s.id);
      return { ...s, totals: t, expectedCash: roundMoney(s.opening_cash + t.cashIn) };
    },
  }),

  'shifts.open': route({
    method: 'POST',
    path: '/shifts',
    permission: 'sales.create',
    input: z.object({ warehouseId: id, openingCash: money.default(0) }),
    audit: { action: 'shift.open', entity: 'shift' },
    handler: async (ctx, i) => {
      assertWarehouse(ctx, i.warehouseId);
      if (await openShift(ctx.db, ctx, i.warehouseId)) throw new AppError('INVALID_STATE', 'A shift is already open');
      const number = await nextNumber(ctx.db, ctx.actor.orgId, 'shift');
      return one<{ id: string; number: string }>(
        ctx.db,
        `INSERT INTO shifts (org_id, warehouse_id, user_id, number, opening_cash, opened_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, number`,
        [ctx.actor.orgId, i.warehouseId, ctx.actor.userId, number, i.openingCash, ctx.now()],
      );
    },
  }),

  'shifts.close': route({
    method: 'POST',
    path: '/shifts/:id/close',
    permission: 'sales.create',
    input: z.object({ id, countedCash: money, note: text(500).nullish() }),
    audit: { action: 'shift.close', entity: 'shift' },
    handler: async (ctx, i) => {
      const s = await one<{ id: string; user_id: string; status: string; opening_cash: number }>(
        ctx.db,
        'SELECT id, user_id, status, opening_cash FROM shifts WHERE id = $1 AND org_id = $2 FOR UPDATE',
        [i.id, ctx.actor.orgId],
        'Shift',
      );
      if (s.status !== 'open') throw new AppError('INVALID_STATE', 'Shift is already closed');
      if (s.user_id !== ctx.actor.userId && !can(ctx.actor.role, 'reports.view')) throw new AppError('FORBIDDEN', 'Only the cashier or a manager can close this shift');
      const t = await shiftTotals(ctx.db, s.id);
      const expected = roundMoney(s.opening_cash + t.cashIn);
      await ctx.db.query(`UPDATE shifts SET status = 'closed', closed_at = $2, counted_cash = $3, expected_cash = $4, note = $5 WHERE id = $1`, [
        s.id,
        ctx.now(),
        i.countedCash,
        expected,
        i.note ?? null,
      ]);
      return { id: s.id, expectedCash: expected, countedCash: i.countedCash, difference: roundMoney(i.countedCash - expected) };
    },
  }),

  'shifts.get': route({
    method: 'GET',
    path: '/shifts/:id',
    permission: 'sales.view',
    input: z.object({ id }),
    handler: async (ctx, { id }) => {
      const s = await one<{ id: string; number: string; status: string; opened_at: string; closed_at: string | null; opening_cash: number; counted_cash: number | null; expected_cash: number | null; note: string | null; user_name: string; warehouse: string; warehouse_id: string; user_id: string }>(
        ctx.db,
        `SELECT sh.id, sh.number, sh.status, sh.opened_at, sh.closed_at, sh.opening_cash, sh.counted_cash, sh.expected_cash, sh.note, u.name AS user_name, sh.user_id,
                w.name AS warehouse, w.id AS warehouse_id
         FROM shifts sh JOIN users u ON u.id = sh.user_id JOIN warehouses w ON w.id = sh.warehouse_id WHERE sh.id = $1 AND sh.org_id = $2`,
        [id, ctx.actor.orgId],
        'Shift',
      );
      if (!can(ctx.actor.role, 'reports.view') && s.user_id !== ctx.actor.userId) throw new AppError('FORBIDDEN', 'Not your shift');
      const totals = await shiftTotals(ctx.db, id);
      return { ...s, totals, expectedNow: roundMoney(s.opening_cash + totals.cashIn) };
    },
  }),

  'sales.create': route({
    method: 'POST',
    path: '/sales',
    permission: 'sales.create',
    input: saleInput,
    audit: { action: 'sale.create', entity: 'sale' },
    handler: createSale,
  }),

  'sales.list': route({
    method: 'GET',
    path: '/sales',
    permission: 'sales.view',
    input: z.object({ warehouseId: optId, customerId: optId, shiftId: optId, q: z.string().optional(), status: z.enum(['completed', 'partially_returned', 'returned']).optional(), ...range, ...paging }),
    handler: async (ctx, i): Promise<Page<{ id: string; number: string; created_at: string; warehouse: string; cashier: string | null; customer: string | null; total: number; paid: number; debt: number; status: string; items: number; methods: string[] }>> => {
      const wh = warehouseScope(ctx, i.warehouseId);
      // Cashiers only see their own sales.
      const onlyUser = can(ctx.actor.role, 'reports.view') ? null : ctx.actor.userId;
      const rows = await many<{ total_count: number } & Record<string, unknown>>(
        ctx.db,
        `SELECT s.id, s.number, s.created_at, w.name AS warehouse, u.name AS cashier, c.name AS customer, s.total, s.paid, s.debt, s.status,
                (SELECT count(*)::int FROM sale_lines l WHERE l.sale_id = s.id) AS items,
                coalesce((SELECT array_agg(DISTINCT sp.method) FROM sale_payments sp WHERE sp.sale_id = s.id), '{}') AS methods,
                count(*) OVER () AS total_count
         FROM sales s JOIN warehouses w ON w.id = s.warehouse_id LEFT JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.org_id = $1 AND ($2::uuid[] IS NULL OR s.warehouse_id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR s.customer_id = $3)
           AND ($4::uuid IS NULL OR s.shift_id = $4) AND ($5::text IS NULL OR s.number ILIKE $5 OR c.name ILIKE $5)
           AND ($6::text IS NULL OR s.status = $6) AND ($7::date IS NULL OR s.created_at >= ${tsFrom('$7')}) AND ($8::date IS NULL OR s.created_at < ${tsTo('$8')})
           AND ($9::uuid IS NULL OR s.user_id = $9)
         ORDER BY s.created_at DESC LIMIT $10 OFFSET $11`,
        [ctx.actor.orgId, wh, i.customerId ?? null, i.shiftId ?? null, like(i.q), i.status ?? null, i.from ?? null, i.to ?? null, onlyUser, i.pageSize, (i.page - 1) * i.pageSize],
      );
      return { rows: rows.map(({ total_count: _t, ...r }) => r) as never, total: rows[0]?.total_count ?? 0, page: i.page, pageSize: i.pageSize };
    },
  }),

  'sales.get': route({
    method: 'GET',
    path: '/sales/:id',
    permission: 'sales.view',
    input: z.object({ id }),
    handler: async (ctx, { id }) => {
      const sale = await one<{
        id: string; number: string; created_at: string; warehouse_id: string; warehouse: string; warehouse_address: string | null; cashier: string | null; user_id: string | null;
        customer_id: string | null; customer: string | null; customer_phone: string | null; subtotal: number; discount_total: number; total: number; cost_total: number;
        paid: number; change: number; debt: number; due_date: string | null; returned_total: number; status: string; note: string | null; shift_number: string | null; org_name: string;
      }>(
        ctx.db,
        `SELECT s.id, s.number, s.created_at, s.warehouse_id, w.name AS warehouse, w.address AS warehouse_address, u.name AS cashier, s.user_id,
                s.customer_id, c.name AS customer, c.phone AS customer_phone, s.subtotal, s.discount_total, s.total, s.cost_total, s.paid, s.change, s.debt,
                s.due_date, s.returned_total, s.status, s.note, sh.number AS shift_number, o.name AS org_name
         FROM sales s JOIN warehouses w ON w.id = s.warehouse_id JOIN orgs o ON o.id = s.org_id LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN shifts sh ON sh.id = s.shift_id
         WHERE s.id = $1 AND s.org_id = $2`,
        [id, ctx.actor.orgId],
        'Sale',
      );
      assertWarehouse(ctx, sale.warehouse_id);
      if (!can(ctx.actor.role, 'reports.view') && sale.user_id !== ctx.actor.userId) throw new AppError('FORBIDDEN', 'Not your sale');
      const [lines, payments, returns] = await Promise.all([
        many<{ id: string; variant_id: string; name: string; sku: string; barcode: string | null; unit_code: string; unit_factor: number; qty: number; base_qty: number; unit_price: number; discount: number; total: number; cost_total: number; returned_qty: number }>(
          ctx.db,
          `SELECT l.id, l.variant_id, p.name || CASE WHEN v.name <> '' THEN ' · ' || v.name ELSE '' END AS name, v.sku, v.barcode, l.unit_code, l.unit_factor,
                  l.qty, l.base_qty, l.unit_price, l.discount, l.total, l.cost_total, l.returned_qty
           FROM sale_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id WHERE l.sale_id = $1 ORDER BY l.id`,
          [id],
        ),
        many<{ method: string; amount: number; provider_ref: string | null }>(ctx.db, 'SELECT method, amount, provider_ref FROM sale_payments WHERE sale_id = $1 ORDER BY method', [id]),
        many<{ id: string; number: string; created_at: string; total: number; refund_method: string; reason: string | null }>(
          ctx.db,
          'SELECT id, number, created_at, total, refund_method, reason FROM sale_returns WHERE sale_id = $1 ORDER BY created_at',
          [id],
        ),
      ]);
      return { ...sale, lines, payments, returns };
    },
  }),

  'sales.return': route({
    method: 'POST',
    path: '/sales/:id/returns',
    permission: 'sales.return',
    input: z.object({
      id,
      lines: z.array(z.object({ saleLineId: id, qty: z.coerce.number().positive() })).min(1),
      refundMethod: z.enum(['cash', 'card', 'debt']),
      reason: text(300).nullish(),
    }),
    audit: { action: 'sale.return', entity: 'sale' },
    handler: async (ctx, i) => {
      const org = ctx.actor.orgId;
      const sale = await one<{ id: string; warehouse_id: string; customer_id: string | null; total: number; returned_total: number; number: string }>(
        ctx.db,
        'SELECT id, warehouse_id, customer_id, total, returned_total, number FROM sales WHERE id = $1 AND org_id = $2 FOR UPDATE',
        [i.id, org],
        'Sale',
      );
      assertWarehouse(ctx, sale.warehouse_id);
      if (i.refundMethod === 'debt' && !sale.customer_id) throw new AppError('VALIDATION', 'Refund to debt needs a customer on the sale');
      const lines = await many<{ id: string; variant_id: string; base_qty: number; returned_qty: number; total: number; cost_total: number }>(
        ctx.db,
        'SELECT id, variant_id, base_qty, returned_qty, total, cost_total FROM sale_lines WHERE sale_id = $1',
        [sale.id],
      );
      const byId = new Map(lines.map((l) => [l.id, l]));
      const items = i.lines.map((r) => {
        const l = byId.get(r.saleLineId);
        if (!l) throw new AppError('VALIDATION', 'Line does not belong to this sale');
        const left = roundQty(l.base_qty - l.returned_qty);
        if (r.qty > left + 1e-9) throw new AppError('VALIDATION', 'Cannot return more than was sold', { saleLineId: l.id, left });
        const share = r.qty / l.base_qty;
        return { line: l, qty: roundQty(r.qty), amount: roundMoney(l.total * share), cost: roundMoney(l.cost_total * share), unitCost: l.cost_total / l.base_qty };
      });
      const total = sumMoney(items.map((x) => x.amount));
      const cost = sumMoney(items.map((x) => x.cost));
      const shift = await openShift(ctx.db, ctx, sale.warehouse_id);
      if (i.refundMethod === 'cash' && !shift) throw new AppError('NO_OPEN_SHIFT', 'Open a shift to refund cash');
      const number = await nextNumber(ctx.db, org, 'return');
      const at = ctx.now();
      const ret = await one<{ id: string }>(
        ctx.db,
        `INSERT INTO sale_returns (org_id, number, sale_id, warehouse_id, shift_id, total, cost_total, refund_method, reason, user_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [org, number, sale.id, sale.warehouse_id, shift?.id ?? null, total, cost, i.refundMethod, i.reason ?? null, ctx.actor.userId, at],
      );
      const post: PostLine[] = items.map((x) => ({ warehouseId: sale.warehouse_id, variantId: x.line.variant_id, kind: 'sale_return', qty: x.qty, unitCost: x.unitCost }));
      await postMovements(ctx.db, { orgId: org, userId: ctx.actor.userId, at, docType: 'sale_return', docId: ret.id }, post);
      await insertMany(
        ctx.db,
        'sale_return_lines',
        ['return_id', 'sale_line_id', 'variant_id', 'base_qty', 'amount', 'cost_total'],
        items.map((x) => [ret.id, x.line.id, x.line.variant_id, x.qty, x.amount, x.cost]),
      );
      await ctx.db.query(`UPDATE sale_lines l SET returned_qty = l.returned_qty + t.q FROM unnest($1::uuid[], $2::numeric[]) AS t(id, q) WHERE l.id = t.id`, [
        items.map((x) => x.line.id),
        items.map((x) => x.qty),
      ]);
      const { fully } = await one<{ fully: boolean }>(ctx.db, 'SELECT bool_and(returned_qty >= base_qty) AS fully FROM sale_lines WHERE sale_id = $1', [sale.id]);
      await ctx.db.query('UPDATE sales SET returned_total = returned_total + $2, status = $3 WHERE id = $1', [sale.id, total, fully ? 'returned' : 'partially_returned']);
      if (i.refundMethod === 'debt' && total > 0) {
        await ctx.db.query(
          `INSERT INTO debt_entries (org_id, party_type, party_id, kind, amount, method, doc_type, doc_id, note, user_id, created_at)
           VALUES ($1,'customer',$2,'payment',$3,'return','sale_return',$4,$5,$6,$7)`,
          [org, sale.customer_id, total, ret.id, number, ctx.actor.userId, at],
        );
      }
      return { id: sale.id, returnId: ret.id, number, total };
    },
  }),
};

export { saleInput };
