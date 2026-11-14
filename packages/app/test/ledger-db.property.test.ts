/**
 * Property-based test against the real SQL schema (PGlite): random sequences of receipts, sales,
 * transfers, write-offs and inventory adjustments through the public routes. After every sequence
 *  - the materialised balances equal the sum of the ledger (stock_drift is empty),
 *  - nothing is negative,
 *  - the stored average costs equal the domain core's fold over the stored movements.
 */
import { balanceKey, foldLedger, type MovementKind } from '@omborchi/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src';
import { drift, world } from './helpers';

type Op =
  | { t: 'receive'; v: number; w: number; qty: number; cost: number }
  | { t: 'sell'; v: number; qty: number }
  | { t: 'transfer'; v: number; qty: number; dir: 0 | 1 }
  | { t: 'writeoff'; v: number; w: number; qty: number }
  | { t: 'count'; v: number; w: number; counted: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ t: fc.constant('receive' as const), v: fc.nat(2), w: fc.nat(1), qty: fc.integer({ min: 1, max: 40 }), cost: fc.integer({ min: 100, max: 90000 }) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('sell' as const), v: fc.nat(2), qty: fc.integer({ min: 1, max: 15 }) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('transfer' as const), v: fc.nat(2), qty: fc.integer({ min: 1, max: 20 }), dir: fc.constantFrom<0 | 1>(0, 1) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('writeoff' as const), v: fc.nat(2), w: fc.nat(1), qty: fc.integer({ min: 1, max: 5 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('count' as const), v: fc.nat(2), w: fc.nat(1), counted: fc.integer({ min: 0, max: 30 }) }) },
);

describe('ledger ↔ balances (property-based, real SQL)', () => {
  it('balances never diverge from the ledger, and stored WAC equals the core fold', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 18 }), async (ops) => {
        const w = await world();
        const variants = [await w.product(), await w.product(), await w.product()].map((p) => p.variantId);
        const whs = [w.storeId, w.warehouseId];
        const supplierId = await w.supplier();
        await w.call('shifts.open', { warehouseId: w.storeId });
        for (const op of ops) {
          try {
            if (op.t === 'receive') await w.call('stock.receive', { supplierId, warehouseId: whs[op.w], lines: [{ variantId: variants[op.v], qty: op.qty, unitCost: op.cost }] });
            else if (op.t === 'sell')
              await w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId: variants[op.v], qty: op.qty }], payments: [{ method: 'card', amount: 1500 * op.qty }] });
            else if (op.t === 'transfer')
              await w.call('stock.transfer', { fromWarehouseId: whs[op.dir], toWarehouseId: whs[1 - op.dir], lines: [{ variantId: variants[op.v], qty: op.qty }] });
            else if (op.t === 'writeoff') await w.call('stock.writeOff', { warehouseId: whs[op.w], reason: 'damaged', lines: [{ variantId: variants[op.v], qty: op.qty }] });
            else {
              const c = await w.call('counts.create', { warehouseId: whs[op.w] });
              const has = (await w.call('counts.get', { id: c.id })).lines.some((l) => l.variant_id === variants[op.v]);
              await w.call('counts.setCounted', { id: c.id, lines: [{ variantId: variants[op.v], countedQty: op.counted }] });
              if (has || op.counted > 0) await w.call('counts.apply', { id: c.id });
            }
          } catch (e) {
            // The only acceptable failure is a refused oversell.
            expect(e).toBeInstanceOf(AppError);
            expect((e as AppError).code).toBe('INSUFFICIENT_STOCK');
          }
        }
        expect(await drift(w.db)).toBe(0);
        const movements = await w.db.query<{ warehouse_id: string; variant_id: string; kind: MovementKind; qty: number; unit_cost: number }>(
          'SELECT warehouse_id, variant_id, kind, qty, unit_cost FROM stock_movements WHERE org_id = $1 ORDER BY id',
          [w.orgId],
        );
        const folded = foldLedger(movements.rows.map((m) => ({ warehouseId: m.warehouse_id, variantId: m.variant_id, kind: m.kind, qty: m.qty, unitCost: m.unit_cost })));
        const balances = await w.db.query<{ warehouse_id: string; variant_id: string; qty: number; avg_cost: number }>(
          'SELECT warehouse_id, variant_id, qty, avg_cost FROM stock_balances WHERE org_id = $1',
          [w.orgId],
        );
        for (const b of balances.rows) {
          expect(b.qty).toBeGreaterThanOrEqual(0);
          const f = folded.get(balanceKey(b.warehouse_id, b.variant_id));
          expect(b.qty).toBe(f?.qty ?? 0);
          if (b.qty > 0) expect(b.avg_cost).toBeCloseTo(f!.avgCost, 4);
        }
      }),
      { numRuns: 25 },
    );
  });
});
