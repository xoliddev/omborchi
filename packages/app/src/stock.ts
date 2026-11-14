/**
 * The single write path into the stock ledger.
 *
 * 1. Make sure a balance row exists for every (warehouse, variant) touched.
 * 2. Lock those rows in a fixed order (deadlock-free under concurrency).
 * 3. Apply each movement with the domain core (WAC, never-negative) to get its booked cost.
 * 4. Insert the movements. A database trigger adds the quantities to the balances; the
 *    `stock_never_negative` CHECK is the last line of defence if anything slipped through.
 * 5. Store the new average costs computed by the core.
 */
import { applyMovement, balanceKey, pickFefo, roundQty, StockError, type Balance, type MovementKind } from '@omborchi/core';
import type { Db } from '@omborchi/db';
import { AppError } from './errors';
import { insertMany, many } from './sql';

export interface PostLine {
  warehouseId: string;
  variantId: string;
  kind: MovementKind;
  /** Signed base-unit quantity. */
  qty: number;
  unitCost?: number;
  batchId?: string | null;
  note?: string | null;
  /** Caller's own reference (e.g. sale line index), carried through batch splitting. */
  ref?: number;
}

export interface PostedLine extends PostLine {
  unitCost: number;
  costValue: number;
}

export interface PostContext {
  orgId: string;
  userId: string | null;
  at: Date;
  docType: string;
  docId: string | null;
}

export async function lockBalances(db: Db, orgId: string, keys: { warehouseId: string; variantId: string }[]): Promise<Map<string, Balance>> {
  const uniq = [...new Map(keys.map((k) => [balanceKey(k.warehouseId, k.variantId), k])).values()].sort(
    (a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.variantId.localeCompare(b.variantId),
  );
  if (uniq.length === 0) return new Map();
  const ws = uniq.map((k) => k.warehouseId);
  const vs = uniq.map((k) => k.variantId);
  await db.query(
    `INSERT INTO stock_balances (org_id, warehouse_id, variant_id, qty, avg_cost)
     SELECT $1, w, v, 0, 0 FROM unnest($2::uuid[], $3::uuid[]) AS t(w, v)
     ON CONFLICT (warehouse_id, variant_id) DO NOTHING`,
    [orgId, ws, vs],
  );
  const rows = await many<{ warehouse_id: string; variant_id: string; qty: number; avg_cost: number }>(
    db,
    `SELECT warehouse_id, variant_id, qty, avg_cost FROM stock_balances
     WHERE org_id = $1 AND (warehouse_id, variant_id) IN (SELECT * FROM unnest($2::uuid[], $3::uuid[]))
     ORDER BY warehouse_id, variant_id FOR UPDATE`,
    [orgId, ws, vs],
  );
  return new Map(rows.map((r) => [balanceKey(r.warehouse_id, r.variant_id), { qty: r.qty, avgCost: r.avg_cost }]));
}

export async function postMovements(db: Db, pc: PostContext, lines: PostLine[]): Promise<PostedLine[]> {
  if (!db.inTransaction) throw new Error('postMovements must run inside a transaction');
  if (lines.length === 0) return [];
  const balances = await lockBalances(db, pc.orgId, lines);
  const posted: PostedLine[] = [];
  for (const line of lines) {
    const key = balanceKey(line.warehouseId, line.variantId);
    const current = balances.get(key) ?? { qty: 0, avgCost: 0 };
    try {
      const applied = applyMovement(current, { kind: line.kind, qty: line.qty, unitCost: line.unitCost });
      balances.set(key, applied.balance);
      posted.push({ ...line, qty: roundQty(line.qty), unitCost: applied.unitCost, costValue: applied.costValue });
    } catch (e) {
      if (e instanceof StockError && e.code === 'INSUFFICIENT_STOCK') {
        const names = await many<{ name: string; sku: string }>(
          db,
          `SELECT p.name || CASE WHEN v.name <> '' THEN ' · ' || v.name ELSE '' END AS name, v.sku FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
          [line.variantId],
        );
        throw new AppError('INSUFFICIENT_STOCK', `Not enough stock for ${names[0]?.name ?? line.variantId}`, {
          variantId: line.variantId,
          warehouseId: line.warehouseId,
          product: names[0]?.name,
          sku: names[0]?.sku,
          available: current.qty,
          requested: -line.qty,
        });
      }
      throw e;
    }
  }
  await insertMany(
    db,
    'stock_movements',
    ['org_id', 'warehouse_id', 'variant_id', 'batch_id', 'kind', 'qty', 'unit_cost', 'cost_value', 'doc_type', 'doc_id', 'user_id', 'note', 'created_at'],
    posted.map((p) => [pc.orgId, p.warehouseId, p.variantId, p.batchId ?? null, p.kind, p.qty, p.unitCost, p.costValue, pc.docType, pc.docId, pc.userId, p.note ?? null, pc.at]),
  );
  const touched = [...new Set(posted.map((p) => balanceKey(p.warehouseId, p.variantId)))];
  const w: string[] = [];
  const v: string[] = [];
  const c: number[] = [];
  for (const k of touched) {
    const [wid, vid] = k.split(':');
    w.push(wid);
    v.push(vid);
    c.push(balances.get(k)!.avgCost);
  }
  await db.query(
    `UPDATE stock_balances b SET avg_cost = t.c FROM unnest($1::uuid[], $2::uuid[], $3::numeric[]) AS t(w, v, c)
     WHERE b.warehouse_id = t.w AND b.variant_id = t.v`,
    [w, v, c],
  );
  return posted;
}

/**
 * Expand an outbound line into per-batch lines (first-expired-first-out) for expiry-tracked
 * products. Any remainder not covered by batches is posted without a batch.
 */
export async function splitByBatches(db: Db, lines: PostLine[]): Promise<PostLine[]> {
  const outbound = lines.filter((l) => l.qty < 0 && !l.batchId);
  if (outbound.length === 0) return lines;
  const rows = await many<{ warehouse_id: string; variant_id: string; batch_id: string; qty: number; expires_at: string | null }>(
    db,
    `SELECT bb.warehouse_id, b.variant_id, bb.batch_id, bb.qty, b.expires_at
     FROM batch_balances bb JOIN batches b ON b.id = bb.batch_id JOIN variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id
     WHERE p.track_expiry AND bb.qty > 0 AND (bb.warehouse_id, b.variant_id) IN (SELECT * FROM unnest($1::uuid[], $2::uuid[]))`,
    [outbound.map((l) => l.warehouseId), outbound.map((l) => l.variantId)],
  );
  if (rows.length === 0) return lines;
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = balanceKey(r.warehouse_id, r.variant_id);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const out: PostLine[] = [];
  for (const l of lines) {
    const batches = l.qty < 0 && !l.batchId ? byKey.get(balanceKey(l.warehouseId, l.variantId)) : undefined;
    if (!batches) {
      out.push(l);
      continue;
    }
    const picks = pickFefo(
      batches.map((b) => ({ batchId: b.batch_id, qty: b.qty, expiresAt: b.expires_at ? new Date(b.expires_at) : null })),
      -l.qty,
    );
    let left = -l.qty;
    for (const p of picks) {
      out.push({ ...l, qty: -p.qty, batchId: p.batchId });
      left = roundQty(left - p.qty);
      // keep the batch pool in sync if the same variant appears twice
      const b = batches.find((x) => x.batch_id === p.batchId)!;
      b.qty = roundQty(b.qty - p.qty);
    }
    if (left > 0) out.push({ ...l, qty: -left, batchId: null });
  }
  return out;
}

export async function ensureBatch(db: Db, orgId: string, variantId: string, code: string, expiresAt: string | null): Promise<string> {
  const rows = await many<{ id: string }>(
    db,
    `INSERT INTO batches (org_id, variant_id, code, expires_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (variant_id, code) DO UPDATE SET expires_at = coalesce(EXCLUDED.expires_at, batches.expires_at)
     RETURNING id`,
    [orgId, variantId, code, expiresAt],
  );
  return rows[0].id;
}
