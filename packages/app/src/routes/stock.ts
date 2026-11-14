import { MOVEMENT_KINDS, roundMoney, roundQty, sumMoney, varianceReport } from '@omborchi/core';
import type { Db } from '@omborchi/db';
import { z } from 'zod';
import { AppError } from '../errors';
import { assertWarehouse, route, type Ctx } from '../router';
import { bool, dateStr, id, money, optId, paging, qty, range, text } from '../schemas';
import { insertMany, like, many, nextNumber, one, tsFrom, tsTo, type Page } from '../sql';
import { ensureBatch, postMovements, splitByBatches, type PostLine } from '../stock';
import { warehouseScope } from './catalog';

const VARIANT_NAME = `p.name || CASE WHEN v.name <> '' THEN ' · ' || v.name ELSE '' END`;

export interface ReceiveLine {
  variantId: string;
  qty: number;
  unitCost: number;
  poLineId?: string | null;
  batchCode?: string | null;
  expiresAt?: string | null;
}

/** Post a goods receipt: stock in at cost, supplier debt charge, optional immediate payment. */
export async function receiveGoods(
  ctx: Ctx,
  input: {
    supplierId: string;
    warehouseId: string;
    poId?: string | null;
    lines: ReceiveLine[];
    paid?: number;
    method?: string;
    dueDate?: string | null;
    note?: string | null;
  },
): Promise<{ id: string; number: string; total: number }> {
  const { db } = ctx;
  const org = ctx.actor.orgId;
  assertWarehouse(ctx, input.warehouseId);
  await one(db, 'SELECT 1 FROM suppliers WHERE id = $1 AND org_id = $2', [input.supplierId, org], 'Supplier');
  const total = sumMoney(input.lines.map((l) => roundMoney(l.qty * l.unitCost)));
  const paid = Math.min(roundMoney(input.paid ?? 0), total);
  const number = await nextNumber(db, org, 'receipt');
  const at = ctx.now();
  const receipt = await one<{ id: string }>(
    db,
    `INSERT INTO goods_receipts (org_id, number, po_id, supplier_id, warehouse_id, total, paid, due_date, note, user_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [org, number, input.poId ?? null, input.supplierId, input.warehouseId, total, paid, input.dueDate ?? null, input.note ?? null, ctx.actor.userId, at],
  );
  const tracked = new Set(
    (
      await many<{ id: string }>(
        db,
        'SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1::uuid[]) AND p.track_expiry AND v.org_id = $2',
        [input.lines.map((l) => l.variantId), org],
      )
    ).map((r) => r.id),
  );
  const lineRows: unknown[][] = [];
  const post: PostLine[] = [];
  for (const l of input.lines) {
    let batchId: string | null = null;
    if (tracked.has(l.variantId) || l.batchCode) {
      batchId = await ensureBatch(db, org, l.variantId, l.batchCode || number, l.expiresAt ?? null);
    }
    lineRows.push([receipt.id, l.poLineId ?? null, l.variantId, batchId, l.qty, l.unitCost]);
    post.push({ warehouseId: input.warehouseId, variantId: l.variantId, kind: 'receipt', qty: l.qty, unitCost: l.unitCost, batchId });
  }
  await insertMany(db, 'goods_receipt_lines', ['receipt_id', 'po_line_id', 'variant_id', 'batch_id', 'qty', 'unit_cost'], lineRows);
  await postMovements(db, { orgId: org, userId: ctx.actor.userId, at, docType: 'receipt', docId: receipt.id }, post);
  await db.query(
    `UPDATE variants v SET last_cost = t.c FROM unnest($1::uuid[], $2::numeric[]) AS t(id, c) WHERE v.id = t.id`,
    [input.lines.map((l) => l.variantId), input.lines.map((l) => l.unitCost)],
  );
  if (total > 0) {
    await db.query(
      `INSERT INTO debt_entries (org_id, party_type, party_id, kind, amount, due_date, doc_type, doc_id, user_id, created_at, note)
       VALUES ($1,'supplier',$2,'charge',$3,$4,'receipt',$5,$6,$7,$8)`,
      [org, input.supplierId, total, input.dueDate ?? null, receipt.id, ctx.actor.userId, at, number],
    );
  }
  if (paid > 0) {
    await db.query(
      `INSERT INTO debt_entries (org_id, party_type, party_id, kind, amount, method, doc_type, doc_id, user_id, created_at, note)
       VALUES ($1,'supplier',$2,'payment',$3,$4,'receipt',$5,$6,$7,$8)`,
      [org, input.supplierId, paid, input.method ?? 'cash', receipt.id, ctx.actor.userId, at, number],
    );
  }
  return { id: receipt.id, number, total };
}

export async function createCount(db: Db, ctx: Ctx, warehouseId: string, categoryId: string | null, note: string | null) {
  const org = ctx.actor.orgId;
  const number = await nextNumber(db, org, 'count');
  const count = await one<{ id: string }>(
    db,
    `INSERT INTO inventory_counts (org_id, number, warehouse_id, category_id, note, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [org, number, warehouseId, categoryId, note, ctx.actor.userId, ctx.now()],
  );
  // Snapshot expected quantities: every active variant in scope (in category subtree, if given).
  await db.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM categories WHERE id = $3::uuid
       UNION ALL SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
     )
     INSERT INTO inventory_count_lines (count_id, variant_id, expected_qty, unit_cost)
     SELECT $1, v.id, coalesce(sb.qty, 0), coalesce(nullif(sb.avg_cost, 0), v.last_cost)
     FROM variants v JOIN products p ON p.id = v.product_id
     LEFT JOIN stock_balances sb ON sb.variant_id = v.id AND sb.warehouse_id = $2
     WHERE v.org_id = $4 AND v.is_active AND p.is_active
       AND ($3::uuid IS NULL OR p.category_id IN (SELECT id FROM sub))
       AND (coalesce(sb.qty, 0) > 0 OR $3::uuid IS NOT NULL)`,
    [count.id, warehouseId, categoryId, org],
  );
  return { id: count.id, number };
}

export const stockRoutes = {
  'stock.balances': route({
    method: 'GET',
    path: '/stock',
    permission: 'stock.view',
    input: z.object({ warehouseId: optId, q: z.string().optional(), categoryId: optId, onlyLow: bool.optional(), nonZero: bool.optional(), ...paging }),
    handler: async (ctx, i) => {
      const wh = warehouseScope(ctx, i.warehouseId);
      const rows = await many<{
        warehouse_id: string;
        warehouse: string;
        variant_id: string;
        product_id: string;
        name: string;
        sku: string;
        unit: string;
        qty: number;
        avg_cost: number;
        value: number;
        min_stock: number;
        total: number;
      }>(
        ctx.db,
        `WITH RECURSIVE sub AS (SELECT id FROM categories WHERE id = $3::uuid UNION ALL SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id)
         SELECT sb.warehouse_id, w.name AS warehouse, v.id AS variant_id, p.id AS product_id, ${VARIANT_NAME} AS name, v.sku, u.code AS unit,
                sb.qty, sb.avg_cost, round(sb.qty * sb.avg_cost, 2) AS value, p.min_stock, count(*) OVER () AS total
         FROM stock_balances sb JOIN warehouses w ON w.id = sb.warehouse_id JOIN variants v ON v.id = sb.variant_id
         JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
         WHERE sb.org_id = $1 AND ($2::uuid[] IS NULL OR sb.warehouse_id = ANY($2::uuid[]))
           AND ($3::uuid IS NULL OR p.category_id IN (SELECT id FROM sub))
           AND ($4::text IS NULL OR p.name ILIKE $4 OR v.sku ILIKE $4 OR v.barcode = $5)
           AND (NOT $6::boolean OR sb.qty <= p.min_stock)
           AND (NOT $7::boolean OR sb.qty <> 0)
         ORDER BY p.name, w.name LIMIT $8 OFFSET $9`,
        [ctx.actor.orgId, wh, i.categoryId ?? null, like(i.q), i.q?.trim() ?? null, i.onlyLow ?? false, i.nonZero ?? false, i.pageSize, (i.page - 1) * i.pageSize],
      );
      const totals = await one<{ qty: number; value: number }>(
        ctx.db,
        `SELECT coalesce(sum(qty), 0) AS qty, coalesce(round(sum(qty * avg_cost), 2), 0) AS value FROM stock_balances WHERE org_id = $1 AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[]))`,
        [ctx.actor.orgId, wh],
      );
      return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, page: i.page, pageSize: i.pageSize, totals };
    },
  }),

  'stock.movements': route({
    method: 'GET',
    path: '/stock/movements',
    permission: 'stock.view',
    input: z.object({ warehouseId: optId, variantId: optId, productId: optId, kind: z.enum(MOVEMENT_KINDS).optional(), ...range, ...paging }),
    handler: async (ctx, i): Promise<Page<{
      id: number; created_at: string; kind: string; warehouse: string; name: string; sku: string; unit: string;
      qty: number; unit_cost: number; cost_value: number; doc_type: string; doc_id: string | null; user_name: string | null; batch: string | null;
    }>> => {
      const wh = warehouseScope(ctx, i.warehouseId);
      const rows = await many<{ total: number } & Record<string, unknown>>(
        ctx.db,
        `SELECT m.id, m.created_at, m.kind, w.name AS warehouse, ${VARIANT_NAME} AS name, v.sku, u.code AS unit, m.qty, m.unit_cost, m.cost_value,
                m.doc_type, m.doc_id, us.name AS user_name, b.code AS batch, count(*) OVER () AS total
         FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id JOIN variants v ON v.id = m.variant_id
         JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
         LEFT JOIN users us ON us.id = m.user_id LEFT JOIN batches b ON b.id = m.batch_id
         WHERE m.org_id = $1 AND ($2::uuid[] IS NULL OR m.warehouse_id = ANY($2::uuid[]))
           AND ($3::uuid IS NULL OR m.variant_id = $3) AND ($4::uuid IS NULL OR v.product_id = $4) AND ($5::text IS NULL OR m.kind = $5)
           AND ($6::date IS NULL OR m.created_at >= ${tsFrom('$6')})
           AND ($7::date IS NULL OR m.created_at < ${tsTo('$7')})
         ORDER BY m.id DESC LIMIT $8 OFFSET $9`,
        [ctx.actor.orgId, wh, i.variantId ?? null, i.productId ?? null, i.kind ?? null, i.from ?? null, i.to ?? null, i.pageSize, (i.page - 1) * i.pageSize],
      );
      return { rows: rows.map(({ total: _t, ...r }) => r) as never, total: rows[0]?.total ?? 0, page: i.page, pageSize: i.pageSize };
    },
  }),

  'stock.receive': route({
    method: 'POST',
    path: '/stock/receipts',
    permission: 'stock.receive',
    input: z.object({
      supplierId: id,
      warehouseId: id,
      lines: z
        .array(z.object({ variantId: id, qty, unitCost: money, batchCode: text(64).nullish(), expiresAt: dateStr.nullish() }))
        .min(1)
        .max(500),
      paid: money.default(0),
      method: z.enum(['cash', 'card', 'transfer']).default('cash'),
      dueDate: dateStr.nullish(),
      note: text(500).nullish(),
    }),
    audit: { action: 'stock.receive', entity: 'goods_receipt' },
    handler: (ctx, i) => receiveGoods(ctx, i),
  }),

  'receipts.list': route({
    method: 'GET',
    path: '/stock/receipts',
    permission: 'stock.view',
    input: z.object({ warehouseId: optId, supplierId: optId, ...range, ...paging }),
    handler: async (ctx, i) => {
      const wh = warehouseScope(ctx, i.warehouseId);
      return many<{ id: string; number: string; created_at: string; supplier: string; warehouse: string; total: number; paid: number; po_number: string | null; lines: number }>(
        ctx.db,
        `SELECT r.id, r.number, r.created_at, s.name AS supplier, w.name AS warehouse, r.total, r.paid, po.number AS po_number,
                (SELECT count(*)::int FROM goods_receipt_lines l WHERE l.receipt_id = r.id) AS lines
         FROM goods_receipts r JOIN suppliers s ON s.id = r.supplier_id JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN purchase_orders po ON po.id = r.po_id
         WHERE r.org_id = $1 AND ($2::uuid[] IS NULL OR r.warehouse_id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR r.supplier_id = $3)
         ORDER BY r.created_at DESC LIMIT $4 OFFSET $5`,
        [ctx.actor.orgId, wh, i.supplierId ?? null, i.pageSize, (i.page - 1) * i.pageSize],
      );
    },
  }),

  'stock.transfer': route({
    method: 'POST',
    path: '/stock/transfers',
    permission: 'stock.transfer',
    input: z
      .object({ fromWarehouseId: id, toWarehouseId: id, lines: z.array(z.object({ variantId: id, qty })).min(1).max(500), note: text(500).nullish() })
      .refine((v) => v.fromWarehouseId !== v.toWarehouseId, { message: 'Choose two different warehouses', path: ['toWarehouseId'] }),
    audit: { action: 'stock.transfer', entity: 'transfer' },
    handler: async (ctx, i) => {
      assertWarehouse(ctx, i.fromWarehouseId);
      assertWarehouse(ctx, i.toWarehouseId);
      const org = ctx.actor.orgId;
      const at = ctx.now();
      const number = await nextNumber(ctx.db, org, 'transfer');
      const t = await one<{ id: string }>(
        ctx.db,
        `INSERT INTO transfers (org_id, number, from_warehouse_id, to_warehouse_id, note, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [org, number, i.fromWarehouseId, i.toWarehouseId, i.note ?? null, ctx.actor.userId, at],
      );
      const outs = await splitByBatches(
        ctx.db,
        i.lines.map((l) => ({ warehouseId: i.fromWarehouseId, variantId: l.variantId, kind: 'transfer_out' as const, qty: -l.qty })),
      );
      const pc = { orgId: org, userId: ctx.actor.userId, at, docType: 'transfer', docId: t.id };
      const posted = await postMovements(ctx.db, pc, outs);
      // Goods arrive at the source's average cost, in the same batches.
      await postMovements(
        ctx.db,
        pc,
        posted.map((p) => ({ warehouseId: i.toWarehouseId, variantId: p.variantId, kind: 'transfer_in' as const, qty: -p.qty, unitCost: p.unitCost, batchId: p.batchId })),
      );
      await insertMany(
        ctx.db,
        'transfer_lines',
        ['transfer_id', 'variant_id', 'qty', 'unit_cost'],
        posted.map((p) => [t.id, p.variantId, -p.qty, p.unitCost]),
      );
      return { id: t.id, number };
    },
  }),

  'transfers.list': route({
    method: 'GET',
    path: '/stock/transfers',
    permission: 'stock.view',
    input: z.object({ ...paging }),
    handler: (ctx, i) =>
      many<{ id: string; number: string; created_at: string; from_name: string; to_name: string; lines: number; qty: number; value: number; user_name: string | null; note: string | null }>(
        ctx.db,
        `SELECT t.id, t.number, t.created_at, f.name AS from_name, tw.name AS to_name, t.note, u.name AS user_name,
                count(l.id)::int AS lines, coalesce(sum(l.qty), 0) AS qty, coalesce(round(sum(l.qty * l.unit_cost), 2), 0) AS value
         FROM transfers t JOIN warehouses f ON f.id = t.from_warehouse_id JOIN warehouses tw ON tw.id = t.to_warehouse_id
         LEFT JOIN transfer_lines l ON l.transfer_id = t.id LEFT JOIN users u ON u.id = t.user_id
         WHERE t.org_id = $1 AND ($2::uuid[] IS NULL OR t.from_warehouse_id = ANY($2::uuid[]) OR t.to_warehouse_id = ANY($2::uuid[]))
         GROUP BY t.id, f.name, tw.name, u.name ORDER BY t.created_at DESC LIMIT $3 OFFSET $4`,
        [ctx.actor.orgId, warehouseScope(ctx), i.pageSize, (i.page - 1) * i.pageSize],
      ),
  }),

  'stock.writeOff': route({
    method: 'POST',
    path: '/stock/write-offs',
    permission: 'stock.writeoff',
    input: z.object({
      warehouseId: id,
      reason: z.enum(['damaged', 'expired', 'lost', 'internal_use', 'other']),
      lines: z.array(z.object({ variantId: id, qty, batchId: optId })).min(1).max(500),
      note: text(500).nullish(),
    }),
    audit: { action: 'stock.write_off', entity: 'write_off' },
    handler: async (ctx, i) => {
      assertWarehouse(ctx, i.warehouseId);
      const org = ctx.actor.orgId;
      const at = ctx.now();
      const number = await nextNumber(ctx.db, org, 'writeoff');
      const w = await one<{ id: string }>(
        ctx.db,
        `INSERT INTO write_offs (org_id, number, warehouse_id, reason, note, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [org, number, i.warehouseId, i.reason, i.note ?? null, ctx.actor.userId, at],
      );
      const lines = await splitByBatches(
        ctx.db,
        i.lines.map((l) => ({ warehouseId: i.warehouseId, variantId: l.variantId, kind: 'write_off' as const, qty: -l.qty, batchId: l.batchId ?? null })),
      );
      const posted = await postMovements(ctx.db, { orgId: org, userId: ctx.actor.userId, at, docType: 'write_off', docId: w.id }, lines);
      await insertMany(
        ctx.db,
        'write_off_lines',
        ['write_off_id', 'variant_id', 'batch_id', 'qty', 'unit_cost'],
        posted.map((p) => [w.id, p.variantId, p.batchId ?? null, -p.qty, p.unitCost]),
      );
      const totalCost = sumMoney(posted.map((p) => -p.costValue));
      await ctx.db.query('UPDATE write_offs SET total_cost = $2 WHERE id = $1', [w.id, totalCost]);
      return { id: w.id, number, totalCost };
    },
  }),

  'writeOffs.list': route({
    method: 'GET',
    path: '/stock/write-offs',
    permission: 'stock.view',
    input: z.object({ ...paging }),
    handler: (ctx, i) =>
      many<{ id: string; number: string; created_at: string; warehouse: string; reason: string; total_cost: number; lines: number; user_name: string | null; note: string | null }>(
        ctx.db,
        `SELECT wo.id, wo.number, wo.created_at, w.name AS warehouse, wo.reason, wo.total_cost, wo.note, u.name AS user_name,
                (SELECT count(*)::int FROM write_off_lines l WHERE l.write_off_id = wo.id) AS lines
         FROM write_offs wo JOIN warehouses w ON w.id = wo.warehouse_id LEFT JOIN users u ON u.id = wo.user_id
         WHERE wo.org_id = $1 AND ($2::uuid[] IS NULL OR wo.warehouse_id = ANY($2::uuid[]))
         ORDER BY wo.created_at DESC LIMIT $3 OFFSET $4`,
        [ctx.actor.orgId, warehouseScope(ctx), i.pageSize, (i.page - 1) * i.pageSize],
      ),
  }),

  'counts.list': route({
    method: 'GET',
    path: '/counts',
    permission: 'stock.view',
    input: z.object({}),
    handler: (ctx) =>
      many<{ id: string; number: string; status: string; created_at: string; applied_at: string | null; warehouse: string; category: string | null; lines: number; counted: number; net_value: number }>(
        ctx.db,
        `SELECT c.id, c.number, c.status, c.created_at, c.applied_at, w.name AS warehouse, cat.name AS category,
                count(l.id)::int AS lines, count(l.counted_qty)::int AS counted,
                coalesce(round(sum(CASE WHEN l.counted_qty IS NOT NULL THEN (l.counted_qty - l.expected_qty) * l.unit_cost ELSE 0 END), 2), 0) AS net_value
         FROM inventory_counts c JOIN warehouses w ON w.id = c.warehouse_id LEFT JOIN categories cat ON cat.id = c.category_id
         LEFT JOIN inventory_count_lines l ON l.count_id = c.id
         WHERE c.org_id = $1 AND ($2::uuid[] IS NULL OR c.warehouse_id = ANY($2::uuid[]))
         GROUP BY c.id, w.name, cat.name ORDER BY c.created_at DESC`,
        [ctx.actor.orgId, warehouseScope(ctx)],
      ),
  }),

  'counts.create': route({
    method: 'POST',
    path: '/counts',
    permission: 'stock.count',
    input: z.object({ warehouseId: id, categoryId: optId, note: text(500).nullish() }),
    audit: { action: 'count.create', entity: 'inventory_count' },
    handler: async (ctx, i) => {
      assertWarehouse(ctx, i.warehouseId);
      return createCount(ctx.db, ctx, i.warehouseId, i.categoryId ?? null, i.note ?? null);
    },
  }),

  'counts.get': route({
    method: 'GET',
    path: '/counts/:id',
    permission: 'stock.view',
    input: z.object({ id }),
    handler: async (ctx, { id }) => {
      const count = await one<{ id: string; number: string; status: string; warehouse_id: string; warehouse: string; created_at: string; applied_at: string | null; note: string | null }>(
        ctx.db,
        `SELECT c.id, c.number, c.status, c.warehouse_id, w.name AS warehouse, c.created_at, c.applied_at, c.note
         FROM inventory_counts c JOIN warehouses w ON w.id = c.warehouse_id WHERE c.id = $1 AND c.org_id = $2`,
        [id, ctx.actor.orgId],
        'Inventory count',
      );
      assertWarehouse(ctx, count.warehouse_id);
      const lines = await many<{ variant_id: string; name: string; sku: string; barcode: string | null; unit: string; expected_qty: number; counted_qty: number | null; unit_cost: number }>(
        ctx.db,
        `SELECT l.variant_id, ${VARIANT_NAME} AS name, v.sku, v.barcode, u.code AS unit, l.expected_qty, l.counted_qty, l.unit_cost
         FROM inventory_count_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
         WHERE l.count_id = $1 ORDER BY p.name, v.name`,
        [id],
      );
      const report = varianceReport(
        lines.map((l) => ({ variantId: l.variant_id, expectedQty: l.expected_qty, countedQty: l.counted_qty, unitCost: l.unit_cost })),
      );
      return {
        ...count,
        lines: lines.map((l, idx) => ({ ...l, variance_qty: report.lines[idx].varianceQty, variance_value: report.lines[idx].varianceValue, status: report.lines[idx].status })),
        summary: { ...report, lines: undefined },
      };
    },
  }),

  'counts.setCounted': route({
    method: 'PUT',
    path: '/counts/:id/lines',
    permission: 'stock.count',
    input: z.object({ id, lines: z.array(z.object({ variantId: id, countedQty: z.coerce.number().min(0).nullable() })).min(1).max(5000) }),
    handler: async (ctx, i) => {
      const c = await one<{ status: string; warehouse_id: string }>(ctx.db, 'SELECT status, warehouse_id FROM inventory_counts WHERE id = $1 AND org_id = $2 FOR UPDATE', [i.id, ctx.actor.orgId], 'Inventory count');
      assertWarehouse(ctx, c.warehouse_id);
      if (c.status !== 'open') throw new AppError('INVALID_STATE', 'This count is already closed');
      await ctx.db.query(
        `UPDATE inventory_count_lines l SET counted_qty = t.q FROM unnest($2::uuid[], $3::numeric[]) AS t(v, q) WHERE l.count_id = $1 AND l.variant_id = t.v`,
        [i.id, i.lines.map((l) => l.variantId), i.lines.map((l) => (l.countedQty === null ? null : roundQty(l.countedQty)))],
      );
      // Variants scanned that were not in the snapshot (found on a shelf, not in the system).
      await ctx.db.query(
        `INSERT INTO inventory_count_lines (count_id, variant_id, expected_qty, counted_qty, unit_cost)
         SELECT $1, t.v, coalesce(sb.qty, 0), t.q, coalesce(nullif(sb.avg_cost, 0), v.last_cost)
         FROM unnest($2::uuid[], $3::numeric[]) AS t(v, q) JOIN variants v ON v.id = t.v AND v.org_id = $5
         LEFT JOIN stock_balances sb ON sb.variant_id = t.v AND sb.warehouse_id = $4
         ON CONFLICT (count_id, variant_id) DO NOTHING`,
        [i.id, i.lines.map((l) => l.variantId), i.lines.map((l) => l.countedQty), c.warehouse_id, ctx.actor.orgId],
      );
      return { id: i.id };
    },
  }),

  'counts.apply': route({
    method: 'POST',
    path: '/counts/:id/apply',
    permission: 'stock.count',
    input: z.object({ id }),
    audit: { action: 'count.apply', entity: 'inventory_count' },
    handler: async (ctx, { id }) => {
      const c = await one<{ status: string; warehouse_id: string; number: string }>(
        ctx.db,
        'SELECT status, warehouse_id, number FROM inventory_counts WHERE id = $1 AND org_id = $2 FOR UPDATE',
        [id, ctx.actor.orgId],
        'Inventory count',
      );
      assertWarehouse(ctx, c.warehouse_id);
      if (c.status !== 'open') throw new AppError('INVALID_STATE', 'This count is already closed');
      const lines = await many<{ variant_id: string; expected_qty: number; counted_qty: number; unit_cost: number; current: number | null }>(
        ctx.db,
        `SELECT l.variant_id, l.expected_qty, l.counted_qty, l.unit_cost, sb.qty AS current FROM inventory_count_lines l
         LEFT JOIN stock_balances sb ON sb.variant_id = l.variant_id AND sb.warehouse_id = $2
         WHERE l.count_id = $1 AND l.counted_qty IS NOT NULL AND l.counted_qty <> l.expected_qty`,
        [id, c.warehouse_id],
      );
      // Variance relative to the snapshot, so sales made during the count are preserved.
      // A shortage can never take stock below zero.
      const post = lines
        .map((l) => {
          let delta = roundQty(l.counted_qty - l.expected_qty);
          if (delta < 0) delta = -Math.min(-delta, l.current ?? 0);
          return { warehouseId: c.warehouse_id, variantId: l.variant_id, kind: 'adjustment' as const, qty: delta, unitCost: delta > 0 ? l.unit_cost : undefined };
        })
        .filter((l) => l.qty !== 0);
      const at = ctx.now();
      await postMovements(ctx.db, { orgId: ctx.actor.orgId, userId: ctx.actor.userId, at, docType: 'count', docId: id }, post);
      await ctx.db.query(`UPDATE inventory_counts SET status = 'applied', applied_at = $2 WHERE id = $1`, [id, at]);
      return { id, adjustments: post.length };
    },
  }),

  'counts.cancel': route({
    method: 'POST',
    path: '/counts/:id/cancel',
    permission: 'stock.count',
    input: z.object({ id }),
    audit: { action: 'count.cancel', entity: 'inventory_count' },
    handler: async (ctx, { id }) =>
      one<{ id: string }>(ctx.db, `UPDATE inventory_counts SET status = 'cancelled' WHERE id = $1 AND org_id = $2 AND status = 'open' RETURNING id`, [id, ctx.actor.orgId], 'Open count'),
  }),

  'alerts.list': route({
    method: 'GET',
    path: '/alerts',
    permission: 'stock.view',
    input: z.object({ warehouseId: optId, expiryDays: z.coerce.number().int().min(1).max(365).default(7) }),
    handler: async (ctx, i) => {
      const wh = warehouseScope(ctx, i.warehouseId);
      const today = ctx.now().toISOString().slice(0, 10);
      const [lowStock, expiring] = await Promise.all([
        many<{ warehouse_id: string; warehouse: string; variant_id: string; product_id: string; name: string; sku: string; unit: string; qty: number; min_stock: number }>(
          ctx.db,
          `SELECT w.id AS warehouse_id, w.name AS warehouse, v.id AS variant_id, p.id AS product_id, ${VARIANT_NAME} AS name, v.sku, u.code AS unit,
                  coalesce(sb.qty, 0) AS qty, p.min_stock
           FROM variants v JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
           CROSS JOIN warehouses w
           LEFT JOIN stock_balances sb ON sb.variant_id = v.id AND sb.warehouse_id = w.id
           WHERE v.org_id = $1 AND w.org_id = $1 AND w.is_active AND v.is_active AND p.is_active AND p.min_stock > 0
             AND w.kind = 'store' AND coalesce(sb.qty, 0) <= p.min_stock
             AND ($2::uuid[] IS NULL OR w.id = ANY($2::uuid[]))
           ORDER BY coalesce(sb.qty, 0) / nullif(p.min_stock, 0), p.name LIMIT 500`,
          [ctx.actor.orgId, wh],
        ),
        many<{ batch_id: string; code: string; expires_at: string; warehouse: string; warehouse_id: string; variant_id: string; name: string; unit: string; qty: number; value: number; days_left: number }>(
          ctx.db,
          `SELECT b.id AS batch_id, b.code, b.expires_at, w.name AS warehouse, w.id AS warehouse_id, v.id AS variant_id, ${VARIANT_NAME} AS name, u.code AS unit, bb.qty,
                  round(bb.qty * coalesce(sb.avg_cost, 0), 2) AS value, (b.expires_at - $3::date) AS days_left
           FROM batch_balances bb JOIN batches b ON b.id = bb.batch_id JOIN warehouses w ON w.id = bb.warehouse_id
           JOIN variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
           LEFT JOIN stock_balances sb ON sb.variant_id = v.id AND sb.warehouse_id = w.id
           WHERE b.org_id = $1 AND bb.qty > 0 AND b.expires_at IS NOT NULL AND b.expires_at <= $3::date + $4::int
             AND ($2::uuid[] IS NULL OR w.id = ANY($2::uuid[]))
           ORDER BY b.expires_at, p.name`,
          [ctx.actor.orgId, wh, today, i.expiryDays],
        ),
      ]);
      return { lowStock, expiring };
    },
  }),
};
