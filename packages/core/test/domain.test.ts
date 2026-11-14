import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  abcClassify,
  ageOpenItems,
  agingBucket,
  allocatePayments,
  allocateProportionally,
  can,
  canAccessWarehouse,
  daysOverdue,
  detectBarcodeType,
  ean13CheckDigit,
  formatUZS,
  generateInStoreEan13,
  isValidEan13,
  pickFefo,
  priceCart,
  settle,
  sumMoney,
  varianceReport,
  PaymentError,
  PricingError,
  PAYMENT_PROVIDERS,
} from '../src';

describe('money', () => {
  it('allocates proportionally and sums exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }).map((c) => c / 100),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const parts = allocateProportionally(total, weights);
          expect(parts).toHaveLength(weights.length);
          expect(sumMoney(parts)).toBe(total);
          parts.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
        },
      ),
    );
  });

  it('formats UZS per locale', () => {
    expect(formatUZS(1250000, 'uz')).toMatch(/^1.250.000 so'm$/);
    expect(formatUZS(1250000, 'en')).toBe('1,250,000 UZS');
    expect(formatUZS(1250000, 'ru')).toMatch(/^1.250.000 сум$/);
  });
});

describe('pricing', () => {
  const lineArb = fc.record({
    unitPrice: fc.integer({ min: 0, max: 5_000_000 }),
    qty: fc.integer({ min: 1, max: 5000 }).map((q) => q / 10),
    unitFactor: fc.constantFrom(1, 6, 12, 24),
    discount: fc.option(fc.record({ type: fc.constant('percent' as const), value: fc.integer({ min: 0, max: 100 }) }), { nil: null }),
  });

  it('totals = subtotal − discounts, and line totals sum to the cart total', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 15 }), fc.integer({ min: 0, max: 50 }), (lines, cartPct) => {
        const cart = priceCart(lines, { type: 'percent', value: cartPct });
        expect(sumMoney(cart.lines.map((l) => l.total))).toBe(cart.total);
        expect(Math.abs(cart.subtotal - cart.discountTotal - cart.total)).toBeLessThan(0.0001);
        cart.lines.forEach((l) => expect(l.total).toBeGreaterThanOrEqual(0));
      }),
    );
  });

  it('converts sale units to base units', () => {
    const cart = priceCart([{ unitPrice: 60000, qty: 2, unitFactor: 12 }]);
    expect(cart.lines[0].baseQty).toBe(24);
    expect(cart.total).toBe(120000);
  });

  it('rejects discounts above the amount', () => {
    expect(() => priceCart([{ unitPrice: 100, qty: 1, discount: { type: 'amount', value: 101 } }])).toThrow(PricingError);
    expect(() => priceCart([{ unitPrice: 100, qty: 1 }], { type: 'percent', value: 120 })).toThrow(PricingError);
  });
});

describe('payments', () => {
  it('mixed payments: paid + debt = total, change only from cash', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        (total, cardPct, cash) => {
          const card = Math.floor((total * cardPct) / 100);
          const payments = [
            ...(card > 0 ? [{ method: 'card' as const, amount: card }] : []),
            ...(cash > 0 ? [{ method: 'cash' as const, amount: cash }] : []),
          ];
          const s = settle(total, payments, { hasCustomer: true });
          expect(sumMoney([s.paid, s.debt])).toBe(total);
          expect(s.change).toBeGreaterThanOrEqual(0);
          expect(s.change).toBeLessThanOrEqual(cash);
          expect(sumMoney(s.applied.map((p) => p.amount))).toBe(s.paid);
        },
      ),
    );
  });

  it('rejects card overpayment and anonymous debt', () => {
    expect(() => settle(100, [{ method: 'card', amount: 150 }], { hasCustomer: false })).toThrow(PaymentError);
    expect(() => settle(100, [{ method: 'cash', amount: 50 }], { hasCustomer: false })).toThrow(/customer/);
  });

  it('gives change for cash overpay', () => {
    const s = settle(87000, [{ method: 'card', amount: 50000 }, { method: 'cash', amount: 50000 }], { hasCustomer: false });
    expect(s).toMatchObject({ paid: 87000, change: 13000, debt: 0 });
  });

  it('simulated online providers approve with a reference', async () => {
    const r = await PAYMENT_PROVIDERS.payme.authorize({ amount: 1000, reference: 'S-1' });
    expect(r.status).toBe('approved');
    expect(r.providerRef).toMatch(/^PAYME-/);
    expect(PAYMENT_PROVIDERS.payme.simulated).toBe(true);
  });
});

describe('debts', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);
  const chargeArb = fc.record({
    id: fc.uuid(),
    amount: fc.integer({ min: 1, max: 10_000_000 }),
    createdAt: fc.integer({ min: 0, max: 200 }).map(day),
    dueDate: fc.option(fc.integer({ min: 0, max: 260 }).map(day), { nil: null }),
  });
  const paymentArb = fc.record({ amount: fc.integer({ min: 1, max: 10_000_000 }), createdAt: fc.integer({ min: 0, max: 200 }).map(day) });

  it('open items sum to the balance and aging buckets sum to the balance', () => {
    fc.assert(
      fc.property(fc.array(chargeArb, { maxLength: 25 }), fc.array(paymentArb, { maxLength: 25 }), (charges, payments) => {
        const pos = allocatePayments(charges, payments);
        expect(sumMoney(pos.open.map((o) => o.remaining))).toBe(pos.balance);
        const aging = ageOpenItems(pos.open, day(240));
        expect(sumMoney(Object.values(aging))).toBe(pos.balance);
        expect(pos.balance === 0 || pos.credit === 0).toBe(true);
      }),
    );
  });

  it('settles oldest due first', () => {
    const pos = allocatePayments(
      [
        { id: 'b', amount: 100, createdAt: day(5), dueDate: day(40) },
        { id: 'a', amount: 100, createdAt: day(1), dueDate: day(10) },
      ],
      [{ amount: 150, createdAt: day(20) }],
    );
    expect(pos.open).toHaveLength(1);
    expect(pos.open[0]).toMatchObject({ id: 'b', remaining: 50 });
  });

  it('buckets by days overdue', () => {
    expect(agingBucket(0)).toBe('current');
    expect(agingBucket(1)).toBe('d1_30');
    expect(agingBucket(45)).toBe('d31_60');
    expect(agingBucket(61)).toBe('d61_90');
    expect(agingBucket(91)).toBe('d90_plus');
    expect(daysOverdue({ dueDate: day(10), createdAt: day(0) }, day(15))).toBe(5);
  });
});

describe('analysis', () => {
  it('ABC: classes are monotonic along value order and A holds ~80% of value', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 200 }), (values) => {
        const res = abcClassify(values, (v) => v);
        const order = { A: 0, B: 1, C: 2 };
        for (let i = 1; i < res.length; i++) expect(order[res[i].abc]).toBeGreaterThanOrEqual(order[res[i - 1].abc]);
        const total = values.reduce((a, b) => a + b, 0);
        if (total > 0) {
          expect(res[0].abc).toBe('A');
          const aValue = res.filter((r) => r.abc === 'A').reduce((s, r) => s + r.value, 0);
          expect(aValue / total).toBeGreaterThanOrEqual(0.8 - 1e-9);
        }
      }),
    );
  });

  it('variance report', () => {
    const r = varianceReport([
      { variantId: 'a', expectedQty: 10, countedQty: 8, unitCost: 1000 },
      { variantId: 'b', expectedQty: 5, countedQty: 6, unitCost: 500 },
      { variantId: 'c', expectedQty: 3, countedQty: 3, unitCost: 10 },
      { variantId: 'd', expectedQty: 3, countedQty: null, unitCost: 10 },
    ]);
    expect(r).toMatchObject({ counted: 3, uncounted: 1, shortageQty: 2, surplusQty: 1, shortageValue: 2000, surplusValue: 500, netValue: -1500 });
    expect(r.accuracy).toBeCloseTo(1 / 3);
  });

  it('FEFO picks earliest expiry first and never over-picks', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ batchId: fc.uuid(), qty: fc.integer({ min: 0, max: 100 }), expiresAt: fc.option(fc.integer({ min: 0, max: 400 }).map((d) => new Date(d * 86_400_000)), { nil: null }) }), { maxLength: 10 }),
        fc.integer({ min: 1, max: 500 }),
        (batches, qty) => {
          const picks = pickFefo(batches, qty);
          const available = batches.reduce((s, b) => s + b.qty, 0);
          expect(picks.reduce((s, p) => s + p.qty, 0)).toBe(Math.min(qty, available));
          const exp = picks.map((p) => batches.find((b) => b.batchId === p.batchId)?.expiresAt?.getTime() ?? Infinity);
          for (let i = 1; i < exp.length; i++) expect(exp[i]).toBeGreaterThanOrEqual(exp[i - 1]);
        },
      ),
    );
  });
});

describe('barcodes', () => {
  it('generated in-store EAN-13 codes are valid and use the 2xx prefix', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_999_999 }), (n) => {
        const code = generateInStoreEan13(n);
        expect(isValidEan13(code)).toBe(true);
        expect(code.startsWith('200')).toBe(true);
      }),
    );
  });

  it('detects a corrupted digit', () => {
    expect(ean13CheckDigit('478000000001')).toBeTypeOf('number');
    expect(isValidEan13('4780000000015')).toBe(false);
    expect(detectBarcodeType('4006381333931')).toBe('ean13');
    expect(detectBarcodeType('SKU-ABC-12')).toBe('code128');
    expect(detectBarcodeType('')).toBeNull();
  });
});

describe('permissions', () => {
  it('cashiers sell but cannot see reports; storekeepers receive but cannot sell', () => {
    expect(can('cashier', 'sales.create')).toBe(true);
    expect(can('cashier', 'reports.view')).toBe(false);
    expect(can('storekeeper', 'stock.receive')).toBe(true);
    expect(can('storekeeper', 'sales.create')).toBe(false);
    expect(can('manager', 'users.manage')).toBe(false);
    expect(can('owner', 'users.manage')).toBe(true);
  });

  it('scopes warehouses', () => {
    expect(canAccessWarehouse({ role: 'cashier', warehouseIds: ['a'] }, 'a')).toBe(true);
    expect(canAccessWarehouse({ role: 'cashier', warehouseIds: ['a'] }, 'b')).toBe(false);
    expect(canAccessWarehouse({ role: 'owner', warehouseIds: [] }, 'b')).toBe(true);
    expect(canAccessWarehouse({ role: 'manager', warehouseIds: null }, 'b')).toBe(true);
  });
});
