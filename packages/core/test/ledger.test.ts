import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyMovement,
  balanceKey,
  EMPTY_BALANCE,
  foldLedger,
  Ledger,
  StockError,
  sumQuantities,
  type MovementKind,
} from '../src';

const WAREHOUSES = ['w1', 'w2', 'w3'];
const VARIANTS = ['v1', 'v2'];

type Op =
  | { t: 'in'; kind: MovementKind; w: string; v: string; qty: number; cost: number }
  | { t: 'out'; kind: MovementKind; w: string; v: string; qty: number }
  | { t: 'transfer'; from: string; to: string; v: string; qty: number }
  | { t: 'adjust'; w: string; v: string; qty: number };

const qtyArb = fc.integer({ min: 1, max: 50_000 }).map((m) => m / 1000); // 0.001 … 50
const costArb = fc.integer({ min: 0, max: 5_000_000 }).map((c) => c / 100);
const wArb = fc.constantFrom(...WAREHOUSES);
const vArb = fc.constantFrom(...VARIANTS);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant('in' as const), kind: fc.constantFrom<MovementKind>('receipt', 'sale_return', 'opening'), w: wArb, v: vArb, qty: qtyArb, cost: costArb }),
  fc.record({ t: fc.constant('out' as const), kind: fc.constantFrom<MovementKind>('sale', 'write_off', 'purchase_return'), w: wArb, v: vArb, qty: qtyArb }),
  fc.record({ t: fc.constant('transfer' as const), from: wArb, to: wArb, v: vArb, qty: qtyArb }).filter((o) => o.from !== o.to),
  fc.record({ t: fc.constant('adjust' as const), w: wArb, v: vArb, qty: fc.integer({ min: -20_000, max: 20_000 }).filter((n) => n !== 0).map((n) => n / 1000) }),
);

/** Run ops against the ledger, skipping (and counting) the ones the ledger rejects. */
function run(ops: Op[]) {
  const ledger = new Ledger();
  let rejected = 0;
  for (const op of ops) {
    try {
      if (op.t === 'in') ledger.post({ kind: op.kind, warehouseId: op.w, variantId: op.v, qty: op.qty, unitCost: op.cost });
      else if (op.t === 'out') ledger.post({ kind: op.kind, warehouseId: op.w, variantId: op.v, qty: -op.qty });
      else if (op.t === 'adjust') ledger.post({ kind: 'adjustment', warehouseId: op.w, variantId: op.v, qty: op.qty });
      else {
        // pre-check like the service does, so a failed transfer posts nothing
        if (ledger.get(op.from, op.v).qty < op.qty) throw new StockError('INSUFFICIENT_STOCK', 'x');
        ledger.transfer(op.from, op.to, op.v, op.qty);
      }
    } catch (e) {
      expect(e).toBeInstanceOf(StockError);
      expect((e as StockError).code).toBe('INSUFFICIENT_STOCK');
      rejected++;
    }
  }
  return { ledger, rejected };
}

describe('stock ledger (property-based)', () => {
  it('materialised balances never diverge from a fold over the ledger', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 200 }), (ops) => {
        const { ledger } = run(ops);
        const folded = foldLedger(ledger.entries);
        const sums = sumQuantities(ledger.entries);
        for (const w of WAREHOUSES)
          for (const v of VARIANTS) {
            const key = balanceKey(w, v);
            const mat = ledger.get(w, v);
            const f = folded.get(key) ?? EMPTY_BALANCE;
            expect(mat.qty).toBe(f.qty);
            expect(mat.avgCost).toBe(f.avgCost);
            expect(mat.qty).toBe(sums.get(key) ?? 0);
          }
      }),
      { numRuns: 300 },
    );
  });

  it('stock never goes negative', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 200 }), (ops) => {
        const { ledger } = run(ops);
        for (const b of ledger.balances.values()) expect(b.qty).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  it('transfers conserve total quantity across warehouses', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 150 }), (ops) => {
        const { ledger } = run(ops);
        const outs = ledger.entries.filter((e) => e.kind === 'transfer_out');
        const ins = ledger.entries.filter((e) => e.kind === 'transfer_in');
        expect(outs.length).toBe(ins.length);
        const sum = (xs: typeof outs) => Math.round(xs.reduce((s, e) => s + e.qty * 1000, 0));
        expect(sum(outs) + sum(ins)).toBe(0);
        // value moved out equals value moved in (same unit cost)
        outs.forEach((o, i) => expect(ins[i].unitCost).toBe(o.unitCost));
      }),
      { numRuns: 200 },
    );
  });

  it('average cost stays within the range of inbound costs', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 120 }), (ops) => {
        const { ledger } = run(ops);
        const inbound = ledger.entries.filter((e) => e.qty > 0 && e.kind !== 'transfer_in');
        if (inbound.length === 0) return;
        const min = Math.min(...inbound.map((e) => e.unitCost));
        const max = Math.max(...inbound.map((e) => e.unitCost));
        for (const b of ledger.balances.values()) {
          if (b.qty > 0) {
            expect(b.avgCost).toBeGreaterThanOrEqual(min - 0.0001);
            expect(b.avgCost).toBeLessThanOrEqual(max + 0.0001);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('inventory value is conserved: Σ movement values ≈ qty × avg cost', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 100 }), (ops) => {
        const { ledger } = run(ops);
        for (const w of WAREHOUSES)
          for (const v of VARIANTS) {
            const entries = ledger.entries.filter((e) => e.warehouseId === w && e.variantId === v);
            const b = ledger.get(w, v);
            const value = entries.reduce((s, e) => s + e.costValue, 0);
            if (b.qty === 0) continue;
            // Rounding of avg cost to 4 dp and values to 2 dp bounds the drift per movement.
            const tolerance = 0.01 * entries.length + b.qty * 0.0001 + 1;
            expect(Math.abs(value - b.qty * b.avgCost)).toBeLessThanOrEqual(tolerance + Math.abs(value) * 1e-6);
          }
      }),
      { numRuns: 200 },
    );
  });
});

describe('applyMovement', () => {
  it('computes weighted average cost on receipts', () => {
    let b = applyMovement(EMPTY_BALANCE, { kind: 'receipt', qty: 10, unitCost: 1000 }).balance;
    b = applyMovement(b, { kind: 'receipt', qty: 30, unitCost: 2000 }).balance;
    expect(b).toEqual({ qty: 40, avgCost: 1750 });
  });

  it('books sales at average cost (COGS) and keeps the average', () => {
    const start = { qty: 40, avgCost: 1750 };
    const r = applyMovement(start, { kind: 'sale', qty: -4 });
    expect(r.unitCost).toBe(1750);
    expect(r.costValue).toBe(-7000);
    expect(r.balance).toEqual({ qty: 36, avgCost: 1750 });
  });

  it('rejects overselling with INSUFFICIENT_STOCK', () => {
    expect(() => applyMovement({ qty: 1, avgCost: 5 }, { kind: 'sale', qty: -2 })).toThrowError(StockError);
  });

  it('rejects wrong directions and zero quantities', () => {
    expect(() => applyMovement(EMPTY_BALANCE, { kind: 'receipt', qty: -1, unitCost: 1 })).toThrow(/cannot have quantity/);
    expect(() => applyMovement(EMPTY_BALANCE, { kind: 'sale', qty: 1 })).toThrow(/cannot have quantity/);
    expect(() => applyMovement(EMPTY_BALANCE, { kind: 'receipt', qty: 0, unitCost: 1 })).toThrow(/non-zero/);
  });

  it('positive adjustments come in at the current average cost', () => {
    const r = applyMovement({ qty: 10, avgCost: 300 }, { kind: 'adjustment', qty: 2 });
    expect(r.balance).toEqual({ qty: 12, avgCost: 300 });
  });

  it('handles fractional (kg) quantities without float drift', () => {
    let b = EMPTY_BALANCE;
    for (let i = 0; i < 10; i++) b = applyMovement(b, { kind: 'receipt', qty: 0.1, unitCost: 12000 }).balance;
    expect(b.qty).toBe(1);
    for (let i = 0; i < 10; i++) b = applyMovement(b, { kind: 'sale', qty: -0.1 }).balance;
    expect(b.qty).toBe(0);
  });
});
