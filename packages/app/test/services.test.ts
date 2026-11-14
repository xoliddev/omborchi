import { describe, expect, it } from 'vitest';
import { AppError } from '../src';
import { drift, world } from './helpers';

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await p.catch((e: AppError) => expect(e.code).toBe(code));
}

describe('receiving & weighted average cost', () => {
  it('receipt increases stock, averages cost and books supplier debt', async () => {
    const w = await world();
    const { variantId } = await w.product();
    const supplierId = await w.supplier();
    await w.call('stock.receive', { supplierId, warehouseId: w.storeId, lines: [{ variantId, qty: 10, unitCost: 1000 }] });
    await w.call('stock.receive', { supplierId, warehouseId: w.storeId, lines: [{ variantId, qty: 30, unitCost: 2000 }], paid: 20000 });
    expect(await w.balance(variantId)).toEqual({ qty: 40, avg_cost: 1750 });
    const s = await w.call('suppliers.get', { id: supplierId });
    expect(s.summary.balance).toBe(10000 + 60000 - 20000);
    expect(await drift(w.db)).toBe(0);
  });
});

describe('sales', () => {
  it('requires an open shift', async () => {
    const w = await world();
    const { variantId } = await w.product();
    await w.receive(variantId, 5, 1000);
    await expectCode(w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId, qty: 1 }], payments: [{ method: 'cash', amount: 1500 }] }), 'NO_OPEN_SHIFT');
  });

  it('sells with mixed payment, books COGS at average cost and gives change', async () => {
    const w = await world();
    const { variantId } = await w.product({ price: 15000 });
    await w.receive(variantId, 10, 9000);
    await w.call('shifts.open', { warehouseId: w.storeId, openingCash: 100000 });
    const sale = await w.call('sales.create', {
      warehouseId: w.storeId,
      lines: [{ variantId, qty: 3 }],
      payments: [
        { method: 'card', amount: 20000 },
        { method: 'cash', amount: 30000 },
      ],
    });
    expect(sale).toMatchObject({ total: 45000, paid: 45000, change: 5000, debt: 0 });
    expect(await w.balance(variantId)).toMatchObject({ qty: 7 });
    const detail = await w.call('sales.get', { id: sale.id });
    expect(detail.cost_total).toBe(27000);
    expect(detail.payments.map((p) => p.method).sort()).toEqual(['card', 'cash']);
    const shift = await w.call('shifts.current', { warehouseId: w.storeId });
    expect(shift?.expectedCash).toBe(100000 + 25000);
  });

  it('sells in an alternative unit (box of 12) and converts to base units', async () => {
    const w = await world();
    const { variantId } = await w.product({ price: 5000, units: [{ unit: 'quti', factor: 12 }] });
    await w.receive(variantId, 30, 3000);
    await w.call('shifts.open', { warehouseId: w.storeId });
    const sale = await w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId, qty: 2, unit: 'quti' }], payments: [{ method: 'card', amount: 120000 }] });
    expect(sale.total).toBe(120000);
    expect(await w.balance(variantId)).toMatchObject({ qty: 6 });
  });

  it('rejects overselling atomically (nothing is persisted)', async () => {
    const w = await world();
    const a = await w.product();
    const b = await w.product();
    await w.receive(a.variantId, 5, 1000);
    await w.receive(b.variantId, 1, 1000);
    await w.call('shifts.open', { warehouseId: w.storeId });
    await expectCode(
      w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId: a.variantId, qty: 2 }, { variantId: b.variantId, qty: 2 }], payments: [{ method: 'cash', amount: 10000 }] }),
      'INSUFFICIENT_STOCK',
    );
    expect(await w.balance(a.variantId)).toMatchObject({ qty: 5 });
    const sales = await w.call('sales.list', {});
    expect(sales.total).toBe(0);
    expect(await drift(w.db)).toBe(0);
  });

  it('credit sale (nasiya) needs a customer, respects the credit limit and is collectable', async () => {
    const w = await world();
    const { variantId } = await w.product({ price: 50000 });
    await w.receive(variantId, 10, 30000);
    await w.call('shifts.open', { warehouseId: w.storeId });
    await expectCode(w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId, qty: 1 }], payments: [] }), 'PAYMENT');
    const { id: customerId } = await w.call('customers.save', { name: 'Aziz', creditLimit: 120000 });
    const sale = await w.call('sales.create', { warehouseId: w.storeId, customerId, lines: [{ variantId, qty: 2 }], payments: [{ method: 'cash', amount: 20000 }], dueDate: '2030-01-01' });
    expect(sale.debt).toBe(80000);
    await expectCode(w.call('sales.create', { warehouseId: w.storeId, customerId, lines: [{ variantId, qty: 1 }], payments: [] }), 'PAYMENT');
    await w.call('customers.collect', { id: customerId, amount: 50000, method: 'cash' });
    const c = await w.call('customers.get', { id: customerId });
    expect(c.summary.balance).toBe(30000);
  });

  it('returns put goods back at the original cost and update the sale', async () => {
    const w = await world();
    const { variantId } = await w.product({ price: 2000 });
    await w.receive(variantId, 10, 1000);
    await w.call('shifts.open', { warehouseId: w.storeId });
    const sale = await w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId, qty: 4 }], payments: [{ method: 'cash', amount: 8000 }] });
    await w.receive(variantId, 10, 3000); // average moves to (6*1000 + 10*3000)/16 = 2250
    const detail = await w.call('sales.get', { id: sale.id });
    await w.call('sales.return', { id: sale.id, lines: [{ saleLineId: detail.lines[0].id, qty: 1 }], refundMethod: 'cash' });
    const after = await w.call('sales.get', { id: sale.id });
    expect(after.status).toBe('partially_returned');
    expect(after.returned_total).toBe(2000);
    const bal = await w.balance(variantId);
    expect(bal.qty).toBe(17);
    expect(bal.avg_cost).toBeCloseTo((16 * 2250 + 1000) / 17, 3);
    await expectCode(w.call('sales.return', { id: sale.id, lines: [{ saleLineId: detail.lines[0].id, qty: 4 }], refundMethod: 'cash' }), 'VALIDATION');
  });

  it('cashiers cannot change prices or give discounts', async () => {
    const w = await world();
    const { variantId } = await w.product({ price: 2000 });
    await w.receive(variantId, 10, 1000);
    const cashier = await w.actorFor('cashier', [w.storeId]);
    await w.call('shifts.open', { warehouseId: w.storeId }, cashier);
    await expectCode(w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId, qty: 1, unitPrice: 1000 }], payments: [{ method: 'cash', amount: 1000 }] }, cashier), 'PRICE_OVERRIDE_FORBIDDEN');
    const ok = await w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId, qty: 1 }], payments: [{ method: 'cash', amount: 2000 }] }, cashier);
    expect(ok.total).toBe(2000);
  });
});

describe('transfers, write-offs, batches', () => {
  it('transfers move quantity and value at the source average cost', async () => {
    const w = await world();
    const { variantId } = await w.product();
    await w.receive(variantId, 10, 1200, w.warehouseId);
    await w.call('stock.transfer', { fromWarehouseId: w.warehouseId, toWarehouseId: w.storeId, lines: [{ variantId, qty: 4 }] });
    expect(await w.balance(variantId, w.warehouseId)).toEqual({ qty: 6, avg_cost: 1200 });
    expect(await w.balance(variantId, w.storeId)).toEqual({ qty: 4, avg_cost: 1200 });
    await expectCode(w.call('stock.transfer', { fromWarehouseId: w.warehouseId, toWarehouseId: w.storeId, lines: [{ variantId, qty: 7 }] }), 'INSUFFICIENT_STOCK');
  });

  it('sells expiry-tracked goods first-expired-first-out and lists expiring batches', async () => {
    const w = await world();
    const { variantId } = await w.product({ trackExpiry: true });
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    await w.receive(variantId, 5, 1000, w.storeId, { batchCode: 'LATE', expiresAt: later });
    await w.receive(variantId, 3, 1000, w.storeId, { batchCode: 'SOON', expiresAt: soon });
    await w.call('shifts.open', { warehouseId: w.storeId });
    await w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId, qty: 4 }], payments: [{ method: 'card', amount: 6000 }] });
    const batches = await w.db.query<{ code: string; qty: number }>(
      'SELECT b.code, bb.qty FROM batch_balances bb JOIN batches b ON b.id = bb.batch_id WHERE b.variant_id = $1 ORDER BY b.code',
      [variantId],
    );
    expect(batches.rows).toEqual([
      { code: 'LATE', qty: 4 },
      { code: 'SOON', qty: 0 },
    ]);
    await w.call('stock.writeOff', { warehouseId: w.storeId, reason: 'damaged', lines: [{ variantId, qty: 1 }] });
    const alerts = await w.call('alerts.list', { expiryDays: 300 });
    expect(alerts.expiring.find((e) => e.code === 'LATE')?.qty).toBe(3);
  });
});

describe('inventory count (revizion)', () => {
  it('snapshots expected qty, reports variance and applies adjustments relative to the snapshot', async () => {
    const w = await world();
    const a = await w.product({ cost: 1000 });
    const b = await w.product({ cost: 500 });
    await w.receive(a.variantId, 10, 1000);
    await w.receive(b.variantId, 5, 500);
    const count = await w.call('counts.create', { warehouseId: w.storeId });
    // a sale happens while counting
    await w.call('shifts.open', { warehouseId: w.storeId });
    await w.call('sales.create', { warehouseId: w.storeId, lines: [{ variantId: a.variantId, qty: 2 }], payments: [{ method: 'cash', amount: 3000 }] });
    await w.call('counts.setCounted', { id: count.id, lines: [{ variantId: a.variantId, countedQty: 9 }, { variantId: b.variantId, countedQty: 6 }] });
    const report = await w.call('counts.get', { id: count.id });
    expect(report.summary).toMatchObject({ shortageQty: 1, surplusQty: 1, shortageValue: 1000, surplusValue: 500, netValue: -500 });
    await w.call('counts.apply', { id: count.id });
    expect(await w.balance(a.variantId)).toMatchObject({ qty: 7 }); // 10 − 2 sold − 1 shortage
    expect(await w.balance(b.variantId)).toMatchObject({ qty: 6 });
    await expectCode(w.call('counts.apply', { id: count.id }), 'INVALID_STATE');
    expect(await drift(w.db)).toBe(0);
  });
});

describe('purchasing', () => {
  it('partial receiving moves a PO to partial then received, never over-receives', async () => {
    const w = await world();
    const { variantId } = await w.product();
    const supplierId = await w.supplier();
    const po = await w.call('purchaseOrders.create', { supplierId, warehouseId: w.warehouseId, lines: [{ variantId, qty: 10, unitCost: 700 }] });
    const detail = await w.call('purchaseOrders.get', { id: po.id });
    const lineId = detail.lines[0].id;
    expect((await w.call('purchaseOrders.receive', { id: po.id, lines: [{ poLineId: lineId, qty: 4 }], paid: 2800 })).status).toBe('partial');
    await expectCode(w.call('purchaseOrders.receive', { id: po.id, lines: [{ poLineId: lineId, qty: 7 }] }), 'VALIDATION');
    expect((await w.call('purchaseOrders.receive', { id: po.id, lines: [{ poLineId: lineId, qty: 6 }], paid: 4200 })).status).toBe('received');
    expect(await w.balance(variantId, w.warehouseId)).toEqual({ qty: 10, avg_cost: 700 });
    const s = await w.call('suppliers.get', { id: supplierId });
    expect(s.summary.balance).toBe(0);
  });
});

describe('permissions & tenancy', () => {
  it('scopes cashiers to their warehouse and hides reports', async () => {
    const w = await world();
    const cashier = await w.actorFor('cashier', [w.storeId]);
    await expectCode(w.call('reports.dashboard', {}, cashier), 'FORBIDDEN');
    await expectCode(w.call('shifts.open', { warehouseId: w.warehouseId }, cashier), 'WAREHOUSE_FORBIDDEN');
    const keeper = await w.actorFor('storekeeper', [w.warehouseId]);
    await expectCode(w.call('shifts.open', { warehouseId: w.warehouseId }, keeper), 'FORBIDDEN');
  });

  it('never leaks another organisation’s data', async () => {
    const a = await world();
    const b = await world();
    const p = await a.product({ name: 'Faqat A uchun' });
    const list = await b.call('products.list', { q: 'Faqat A' });
    expect(list.total).toBe(0);
    await expectCode(b.call('products.get', { id: p.productId }), 'NOT_FOUND');
  });
});

describe('ledger integrity', () => {
  it('stock_movements is append-only at the database level', async () => {
    const w = await world();
    const { variantId } = await w.product();
    await w.receive(variantId, 1, 1);
    await expect(w.db.query('UPDATE stock_movements SET qty = 100 WHERE variant_id = $1', [variantId])).rejects.toThrow(/append-only/);
    await expect(w.db.query('DELETE FROM stock_movements WHERE variant_id = $1', [variantId])).rejects.toThrow(/append-only/);
  });

  it('every mutation is written to the audit log', async () => {
    const w = await world();
    const { variantId } = await w.product();
    await w.receive(variantId, 3, 100);
    const log = await w.call('audit.list', {});
    expect(log.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['product.save', 'supplier.save', 'stock.receive']));
  });

  it('nested categories reject cycles', async () => {
    const w = await world();
    const root = await w.call('categories.save', { name: 'A' });
    const child = await w.call('categories.save', { name: 'B', parentId: root.id });
    const grand = await w.call('categories.save', { name: 'C', parentId: child.id });
    await expectCode(w.call('categories.save', { id: root.id, name: 'A', parentId: grand.id }), 'VALIDATION');
  });
});

describe('import', () => {
  it('validates rows in a dry run and imports with opening stock', async () => {
    const w = await world();
    const rows = [
      { name: 'Choy 100 g', category: 'Oziq-ovqat / Choy', unit: 'dona', sku: 'IMP-1', barcode: '4780000000014', cost: 9000, retail: 12000, qty: 10 },
      { name: 'Yomon', unit: 'tonna', retail: 5 },
      { name: 'Xato kod', unit: 'dona', barcode: '4780000000015', retail: 100 },
      { name: '', unit: 'dona', retail: 1 },
    ];
    const dry = await w.call('products.import', { rows, dryRun: true, warehouseId: w.storeId });
    expect(dry.summary).toMatchObject({ total: 4, create: 1, errors: 3 });
    const ok = await w.call('products.import', { rows: [rows[0]], dryRun: false, warehouseId: w.storeId });
    expect(ok.applied).toBe(true);
    const list = await w.call('products.list', { q: 'Choy 100' });
    expect(list.rows[0]).toMatchObject({ category_name: 'Choy', stock_qty: 10 });
  });
});
