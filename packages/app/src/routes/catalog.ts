import { detectBarcodeType, generateInStoreEan13, isValidEan13, roundMoney } from '@omborchi/core';
import { z } from 'zod';
import { AppError } from '../errors';
import { assertWarehouse, route, type Ctx } from '../router';
import { bool, id, money, name, optId, paging, text } from '../schemas';
import { like, many, maybeOne, nextNumber, one, type Page } from '../sql';
import { postMovements } from '../stock';

/** Warehouses the actor may see, optionally narrowed to one. null = all. */
export function warehouseScope(ctx: Ctx, warehouseId?: string | null): string[] | null {
  if (warehouseId) {
    assertWarehouse(ctx, warehouseId);
    return [warehouseId];
  }
  return ctx.actor.role === 'owner' ? null : ctx.actor.warehouseIds;
}

export async function defaultPriceListId(ctx: Ctx): Promise<string> {
  const row = await one<{ id: string }>(
    ctx.db,
    `SELECT id FROM price_lists WHERE org_id = $1 ORDER BY is_default DESC, code LIMIT 1`,
    [ctx.actor.orgId],
    'Price list',
  );
  return row.id;
}

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  sort: number;
  product_count: number;
}

export interface ProductListRow {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  unit: string;
  track_expiry: boolean;
  min_stock: number;
  is_active: boolean;
  image_url: string | null;
  variant_count: number;
  sku: string | null;
  barcode: string | null;
  price_min: number | null;
  price_max: number | null;
  cost: number | null;
  stock_qty: number;
  stock_value: number;
}

const variantInput = z.object({
  id: optId,
  name: text(100).default(''),
  sku: text(64).optional().nullable(),
  barcode: text(48).optional().nullable(),
  generateBarcode: z.boolean().optional(),
  cost: money.default(0),
  prices: z.record(z.string(), money).default({}),
});

const productInput = z.object({
  id: optId,
  name,
  categoryId: optId,
  baseUnit: z.string().min(1).max(16),
  description: text(2000).optional().nullable(),
  trackExpiry: z.boolean().default(false),
  minStock: z.coerce.number().min(0).default(0),
  imageUrl: z.string().trim().max(500_000).optional().nullable(),
  units: z.array(z.object({ unit: z.string().min(1).max(16), factor: z.coerce.number().positive(), barcode: text(48).optional().nullable() })).default([]),
  variants: z.array(variantInput).min(1).max(100),
});

async function unitIdByCode(ctx: Ctx, code: string): Promise<string> {
  const row = await maybeOne<{ id: string }>(ctx.db, 'SELECT id FROM units WHERE org_id = $1 AND code = $2', [ctx.actor.orgId, code]);
  if (!row) throw new AppError('VALIDATION', `Unknown unit ${code}`, { unit: code });
  return row.id;
}

function checkBarcode(code: string | null | undefined) {
  if (!code) return null;
  if (/^\d{13}$/.test(code) && !isValidEan13(code)) throw new AppError('VALIDATION', 'Invalid EAN-13 check digit', { barcode: code, field: 'barcode' });
  const t = detectBarcodeType(code);
  if (!t) throw new AppError('VALIDATION', 'Invalid barcode', { barcode: code, field: 'barcode' });
  return t;
}

async function saveProduct(ctx: Ctx, input: z.output<typeof productInput>): Promise<{ id: string }> {
  const { db } = ctx;
  const org = ctx.actor.orgId;
  const baseUnitId = await unitIdByCode(ctx, input.baseUnit);
  if (input.categoryId) await one(db, 'SELECT 1 FROM categories WHERE id = $1 AND org_id = $2', [input.categoryId, org], 'Category');
  let productId = input.id ?? null;
  if (productId) {
    await one(
      db,
      `UPDATE products SET name=$3, category_id=$4, base_unit_id=$5, description=$6, track_expiry=$7, min_stock=$8, image_url=$9, updated_at=$10
       WHERE id=$1 AND org_id=$2 RETURNING id`,
      [productId, org, input.name, input.categoryId ?? null, baseUnitId, input.description ?? null, input.trackExpiry, input.minStock, input.imageUrl ?? null, ctx.now()],
      'Product',
    );
  } else {
    const row = await one<{ id: string }>(
      db,
      `INSERT INTO products (org_id, name, category_id, base_unit_id, description, track_expiry, min_stock, image_url, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
      [org, input.name, input.categoryId ?? null, baseUnitId, input.description ?? null, input.trackExpiry, input.minStock, input.imageUrl ?? null, ctx.now()],
    );
    productId = row.id;
  }
  // Extra units of measure
  await db.query('DELETE FROM product_units WHERE product_id = $1', [productId]);
  for (const u of input.units) {
    if (u.unit === input.baseUnit) continue;
    checkBarcode(u.barcode);
    await db.query('INSERT INTO product_units (product_id, unit_id, factor, barcode) VALUES ($1,$2,$3,$4)', [
      productId,
      await unitIdByCode(ctx, u.unit),
      u.factor,
      u.barcode || null,
    ]);
  }
  // Variants (upsert; variants missing from the payload are archived, never deleted — the ledger references them)
  const priceLists = await many<{ id: string; code: string }>(db, 'SELECT id, code FROM price_lists WHERE org_id = $1', [org]);
  const keep: string[] = [];
  for (const v of input.variants) {
    let barcode = v.barcode || null;
    if (!barcode && v.generateBarcode) {
      const n = await nextNumber(db, org, 'barcode');
      barcode = generateInStoreEan13(Number(n.replace(/\D/g, '')));
    }
    const barcodeType = checkBarcode(barcode);
    const sku = v.sku || (await nextNumber(db, org, 'sku'));
    let variantId = v.id ?? null;
    if (variantId) {
      await one(
        db,
        `UPDATE variants SET name=$3, sku=$4, barcode=$5, barcode_type=$6, last_cost=$7, is_active=true WHERE id=$1 AND product_id=$2 RETURNING id`,
        [variantId, productId, v.name, sku, barcode, barcodeType, v.cost],
        'Variant',
      );
    } else {
      variantId = (
        await one<{ id: string }>(
          db,
          `INSERT INTO variants (org_id, product_id, name, sku, barcode, barcode_type, last_cost, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [org, productId, v.name, sku, barcode, barcodeType, v.cost, ctx.now()],
        )
      ).id;
    }
    keep.push(variantId);
    for (const pl of priceLists) {
      const price = v.prices[pl.code];
      if (price === undefined) continue;
      await db.query(
        `INSERT INTO prices (price_list_id, variant_id, price) VALUES ($1,$2,$3) ON CONFLICT (price_list_id, variant_id) DO UPDATE SET price = EXCLUDED.price`,
        [pl.id, variantId, roundMoney(price)],
      );
    }
  }
  await db.query('UPDATE variants SET is_active = false WHERE product_id = $1 AND NOT (id = ANY($2::uuid[]))', [productId, keep]);
  return { id: productId };
}

const importRow = z.object({
  name: z.string().trim().min(1, 'required').max(200),
  category: z.string().trim().max(500).optional().nullable(),
  unit: z.string().trim().min(1, 'required').max(16),
  sku: z.string().trim().max(64).optional().nullable(),
  barcode: z.string().trim().max(48).optional().nullable(),
  cost: z.coerce.number().min(0).default(0),
  retail: z.coerce.number().min(0),
  wholesale: z.coerce.number().min(0).optional().nullable(),
  minStock: z.coerce.number().min(0).optional().nullable(),
  qty: z.coerce.number().min(0).optional().nullable(),
});

export type ImportRowResult = {
  index: number;
  status: 'create' | 'update' | 'error';
  errors: { field: string; message: string }[];
  name?: string;
  sku?: string | null;
};

export const catalogRoutes = {
  'categories.list': route({
    method: 'GET',
    path: '/categories',
    permission: 'catalog.view',
    input: z.object({}),
    handler: (ctx) =>
      many<CategoryRow>(
        ctx.db,
        `SELECT c.id, c.parent_id, c.name, c.sort, (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.is_active) AS product_count
         FROM categories c WHERE c.org_id = $1 ORDER BY c.sort, c.name`,
        [ctx.actor.orgId],
      ),
  }),

  'categories.save': route({
    method: 'POST',
    path: '/categories',
    permission: 'catalog.edit',
    input: z.object({ id: optId, name, parentId: optId }),
    audit: { action: 'category.save', entity: 'category' },
    handler: async (ctx, input) => {
      if (input.parentId) await one(ctx.db, 'SELECT 1 FROM categories WHERE id = $1 AND org_id = $2', [input.parentId, ctx.actor.orgId], 'Parent category');
      if (input.id) {
        try {
          return await one<{ id: string }>(
            ctx.db,
            'UPDATE categories SET name = $3, parent_id = $4 WHERE id = $1 AND org_id = $2 RETURNING id',
            [input.id, ctx.actor.orgId, input.name, input.parentId ?? null],
            'Category',
          );
        } catch (e) {
          if (e instanceof Error && /cycle/.test(e.message)) throw new AppError('VALIDATION', 'A category cannot be moved inside itself', { field: 'parentId' });
          throw e;
        }
      }
      return one<{ id: string }>(ctx.db, 'INSERT INTO categories (org_id, name, parent_id) VALUES ($1,$2,$3) RETURNING id', [
        ctx.actor.orgId,
        input.name,
        input.parentId ?? null,
      ]);
    },
  }),

  'categories.delete': route({
    method: 'DELETE',
    path: '/categories/:id',
    permission: 'catalog.edit',
    input: z.object({ id }),
    audit: { action: 'category.delete', entity: 'category' },
    handler: async (ctx, { id }) => {
      const used = await one<{ children: number; products: number }>(
        ctx.db,
        `SELECT (SELECT count(*)::int FROM categories WHERE parent_id = $1) AS children, (SELECT count(*)::int FROM products WHERE category_id = $1) AS products`,
        [id],
      );
      if (used.children > 0 || used.products > 0) throw new AppError('INVALID_STATE', 'Category is not empty', used);
      await one(ctx.db, 'DELETE FROM categories WHERE id = $1 AND org_id = $2 RETURNING id', [id, ctx.actor.orgId], 'Category');
      return { id };
    },
  }),

  'products.list': route({
    method: 'GET',
    path: '/products',
    permission: 'catalog.view',
    input: z.object({
      q: z.string().optional(),
      categoryId: optId,
      warehouseId: optId,
      lowStock: bool.optional(),
      archived: bool.optional(),
      sort: z.enum(['name', 'stock_qty', 'stock_value', 'price', 'created']).default('name'),
      dir: z.enum(['asc', 'desc']).default('asc'),
      ...paging,
    }),
    handler: async (ctx, i): Promise<Page<ProductListRow>> => {
      const pl = await defaultPriceListId(ctx);
      const wh = warehouseScope(ctx, i.warehouseId);
      const sortCol = { name: 'p.name', stock_qty: 'stock_qty', stock_value: 'stock_value', price: 'price_min', created: 'p.created_at' }[i.sort];
      const rows = await many<ProductListRow & { total: number }>(
        ctx.db,
        `WITH RECURSIVE sub AS (
           SELECT id FROM categories WHERE id = $3::uuid
           UNION ALL SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
         )
         SELECT p.id, p.name, p.category_id, c.name AS category_name, u.code AS unit, p.track_expiry, p.min_stock, p.is_active, p.image_url,
           vs.variant_count, vs.sku, vs.barcode, vs.price_min, vs.price_max, vs.cost,
           coalesce(st.qty, 0) AS stock_qty, coalesce(st.value, 0) AS stock_value, count(*) OVER () AS total
         FROM products p
         JOIN units u ON u.id = p.base_unit_id
         LEFT JOIN categories c ON c.id = p.category_id
         JOIN LATERAL (
           SELECT count(*)::int AS variant_count, min(v.sku) AS sku, min(v.barcode) AS barcode,
                  min(pr.price) AS price_min, max(pr.price) AS price_max, max(v.last_cost) AS cost
           FROM variants v LEFT JOIN prices pr ON pr.variant_id = v.id AND pr.price_list_id = $2
           WHERE v.product_id = p.id AND v.is_active
         ) vs ON true
         LEFT JOIN LATERAL (
           SELECT sum(sb.qty) AS qty, round(sum(sb.qty * sb.avg_cost), 2) AS value
           FROM stock_balances sb JOIN variants v ON v.id = sb.variant_id
           WHERE v.product_id = p.id AND ($4::uuid[] IS NULL OR sb.warehouse_id = ANY($4::uuid[]))
         ) st ON true
         WHERE p.org_id = $1
           AND ($5::text IS NULL OR p.name ILIKE $5 OR EXISTS (SELECT 1 FROM variants v2 WHERE v2.product_id = p.id AND (v2.sku ILIKE $5 OR v2.barcode = $6)))
           AND ($3::uuid IS NULL OR p.category_id IN (SELECT id FROM sub))
           AND (p.is_active OR $7::boolean)
           AND (NOT $8::boolean OR coalesce(st.qty, 0) <= p.min_stock)
         ORDER BY ${sortCol} ${i.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, p.name
         LIMIT $9 OFFSET $10`,
        [
          ctx.actor.orgId,
          pl,
          i.categoryId ?? null,
          wh,
          like(i.q),
          i.q?.trim() ?? null,
          i.archived ?? false,
          i.lowStock ?? false,
          i.pageSize,
          (i.page - 1) * i.pageSize,
        ],
      );
      return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, page: i.page, pageSize: i.pageSize };
    },
  }),

  'products.get': route({
    method: 'GET',
    path: '/products/:id',
    permission: 'catalog.view',
    input: z.object({ id }),
    handler: async (ctx, { id }) => {
      const org = ctx.actor.orgId;
      const product = await one<{
        id: string;
        name: string;
        category_id: string | null;
        description: string | null;
        base_unit: string;
        track_expiry: boolean;
        min_stock: number;
        image_url: string | null;
        is_active: boolean;
        created_at: string;
      }>(
        ctx.db,
        `SELECT p.id, p.name, p.category_id, p.description, u.code AS base_unit, p.track_expiry, p.min_stock, p.image_url, p.is_active, p.created_at
         FROM products p JOIN units u ON u.id = p.base_unit_id WHERE p.id = $1 AND p.org_id = $2`,
        [id, org],
        'Product',
      );
      const [units, variants, prices, stock, batches] = await Promise.all([
        many<{ unit: string; factor: number; barcode: string | null }>(
          ctx.db,
          'SELECT u.code AS unit, pu.factor, pu.barcode FROM product_units pu JOIN units u ON u.id = pu.unit_id WHERE pu.product_id = $1 ORDER BY pu.factor',
          [id],
        ),
        many<{ id: string; name: string; sku: string; barcode: string | null; barcode_type: string | null; last_cost: number; is_active: boolean }>(
          ctx.db,
          'SELECT id, name, sku, barcode, barcode_type, last_cost, is_active FROM variants WHERE product_id = $1 ORDER BY is_active DESC, created_at, sku',
          [id],
        ),
        many<{ variant_id: string; code: string; price: number }>(
          ctx.db,
          'SELECT pr.variant_id, pl.code, pr.price FROM prices pr JOIN price_lists pl ON pl.id = pr.price_list_id JOIN variants v ON v.id = pr.variant_id WHERE v.product_id = $1',
          [id],
        ),
        many<{ variant_id: string; warehouse_id: string; warehouse: string; qty: number; avg_cost: number }>(
          ctx.db,
          `SELECT sb.variant_id, sb.warehouse_id, w.name AS warehouse, sb.qty, sb.avg_cost FROM stock_balances sb
           JOIN warehouses w ON w.id = sb.warehouse_id JOIN variants v ON v.id = sb.variant_id WHERE v.product_id = $1 ORDER BY w.name`,
          [id],
        ),
        many<{ id: string; variant_id: string; code: string; expires_at: string | null; warehouse: string; qty: number }>(
          ctx.db,
          `SELECT b.id, b.variant_id, b.code, b.expires_at, w.name AS warehouse, bb.qty FROM batches b
           JOIN batch_balances bb ON bb.batch_id = b.id JOIN warehouses w ON w.id = bb.warehouse_id JOIN variants v ON v.id = b.variant_id
           WHERE v.product_id = $1 AND bb.qty > 0 ORDER BY b.expires_at NULLS LAST`,
          [id],
        ),
      ]);
      return {
        ...product,
        units,
        batches,
        variants: variants.map((v) => ({
          ...v,
          prices: Object.fromEntries(prices.filter((p) => p.variant_id === v.id).map((p) => [p.code, p.price])),
          stock: stock.filter((s) => s.variant_id === v.id),
        })),
      };
    },
  }),

  'products.save': route({
    method: 'POST',
    path: '/products',
    permission: 'catalog.edit',
    input: productInput,
    audit: { action: 'product.save', entity: 'product' },
    handler: saveProduct,
  }),

  'products.archive': route({
    method: 'POST',
    path: '/products/:id/archive',
    permission: 'catalog.edit',
    input: z.object({ id, archived: z.boolean().default(true) }),
    audit: { action: 'product.archive', entity: 'product' },
    handler: async (ctx, { id, archived }) =>
      one<{ id: string }>(ctx.db, 'UPDATE products SET is_active = $3, updated_at = $4 WHERE id = $1 AND org_id = $2 RETURNING id', [id, ctx.actor.orgId, !archived, ctx.now()], 'Product'),
  }),

  'products.import': route({
    method: 'POST',
    path: '/products/import',
    permission: 'catalog.edit',
    input: z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(5000), dryRun: z.boolean().default(true), warehouseId: optId }),
    audit: { action: 'product.import', entity: 'product' },
    handler: async (ctx, input) => {
      const org = ctx.actor.orgId;
      if (input.warehouseId) assertWarehouse(ctx, input.warehouseId);
      const units = new Set((await many<{ code: string }>(ctx.db, 'SELECT code FROM units WHERE org_id = $1', [org])).map((u) => u.code));
      const existing = await many<{ sku: string; barcode: string | null; product_id: string; id: string }>(
        ctx.db,
        'SELECT sku, barcode, product_id, id FROM variants WHERE org_id = $1',
        [org],
      );
      const bySku = new Map(existing.map((e) => [e.sku.toLowerCase(), e]));
      const byBarcode = new Map(existing.filter((e) => e.barcode).map((e) => [e.barcode!, e]));
      const seenSku = new Set<string>();
      const seenBarcode = new Set<string>();
      const results: ImportRowResult[] = [];
      const valid: { index: number; row: z.output<typeof importRow>; existing?: (typeof existing)[number] }[] = [];
      input.rows.forEach((raw, index) => {
        const norm = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === '' ? null : v]));
        const parsed = importRow.safeParse(norm);
        const errors: { field: string; message: string }[] = [];
        if (!parsed.success) {
          for (const iss of parsed.error.issues) errors.push({ field: String(iss.path[0] ?? ''), message: iss.message });
          results.push({ index, status: 'error', errors, name: typeof raw.name === 'string' ? raw.name : undefined });
          return;
        }
        const r = parsed.data;
        if (!units.has(r.unit)) errors.push({ field: 'unit', message: `unknown unit "${r.unit}"` });
        if (r.barcode) {
          if (/^\d{13}$/.test(r.barcode) && !isValidEan13(r.barcode)) errors.push({ field: 'barcode', message: 'invalid EAN-13 check digit' });
          if (seenBarcode.has(r.barcode)) errors.push({ field: 'barcode', message: 'duplicate in file' });
          seenBarcode.add(r.barcode);
        }
        const skuKey = r.sku?.toLowerCase();
        if (skuKey) {
          if (seenSku.has(skuKey)) errors.push({ field: 'sku', message: 'duplicate in file' });
          seenSku.add(skuKey);
        }
        const match = skuKey ? bySku.get(skuKey) : undefined;
        if (r.barcode && byBarcode.has(r.barcode) && byBarcode.get(r.barcode)!.id !== match?.id) {
          errors.push({ field: 'barcode', message: 'used by another product' });
        }
        if (r.qty && !input.warehouseId) errors.push({ field: 'qty', message: 'choose a warehouse for opening stock' });
        if (errors.length) results.push({ index, status: 'error', errors, name: r.name, sku: r.sku });
        else {
          results.push({ index, status: match ? 'update' : 'create', errors: [], name: r.name, sku: r.sku });
          valid.push({ index, row: r, existing: match });
        }
      });
      const summary = {
        total: results.length,
        create: results.filter((r) => r.status === 'create').length,
        update: results.filter((r) => r.status === 'update').length,
        errors: results.filter((r) => r.status === 'error').length,
      };
      if (input.dryRun || summary.errors > 0) return { dryRun: true, applied: false, summary, results, id: null };

      // Commit: categories by path ("Food / Drinks / Water"), then products.
      const cats = await many<{ id: string; parent_id: string | null; name: string }>(ctx.db, 'SELECT id, parent_id, name FROM categories WHERE org_id = $1', [org]);
      const catKey = (parent: string | null, n: string) => `${parent ?? ''}/${n.toLowerCase()}`;
      const catMap = new Map(cats.map((c) => [catKey(c.parent_id, c.name), c.id]));
      const resolveCategory = async (path: string | null | undefined): Promise<string | null> => {
        if (!path) return null;
        let parent: string | null = null;
        for (const part of path.split(/\s*[/>]\s*/).filter(Boolean)) {
          const k = catKey(parent, part);
          let cid = catMap.get(k);
          if (!cid) {
            cid = (await one<{ id: string }>(ctx.db, 'INSERT INTO categories (org_id, parent_id, name) VALUES ($1,$2,$3) RETURNING id', [org, parent, part])).id;
            catMap.set(k, cid);
          }
          parent = cid;
        }
        return parent;
      };
      const opening: { variantId: string; qty: number; cost: number }[] = [];
      for (const { row, existing: ex } of valid) {
        const categoryId = await resolveCategory(row.category);
        const prices: Record<string, number> = { retail: row.retail };
        if (row.wholesale !== null && row.wholesale !== undefined) prices.wholesale = row.wholesale;
        if (ex) {
          await ctx.db.query('UPDATE products SET name = $2, category_id = coalesce($3, category_id), min_stock = coalesce($4, min_stock), updated_at = $5 WHERE id = $1', [
            ex.product_id,
            row.name,
            categoryId,
            row.minStock ?? null,
            ctx.now(),
          ]);
          await ctx.db.query('UPDATE variants SET barcode = coalesce($2, barcode), barcode_type = coalesce($3, barcode_type), last_cost = $4 WHERE id = $1', [
            ex.id,
            row.barcode || null,
            row.barcode ? detectBarcodeType(row.barcode) : null,
            row.cost,
          ]);
          for (const [code, price] of Object.entries(prices)) {
            await ctx.db.query(
              `INSERT INTO prices (price_list_id, variant_id, price) SELECT id, $2, $3 FROM price_lists WHERE org_id = $1 AND code = $4
               ON CONFLICT (price_list_id, variant_id) DO UPDATE SET price = EXCLUDED.price`,
              [org, ex.id, price, code],
            );
          }
          if (row.qty) opening.push({ variantId: ex.id, qty: row.qty, cost: row.cost });
        } else {
          const { id: productId } = await saveProduct(ctx, {
            name: row.name,
            categoryId,
            baseUnit: row.unit,
            trackExpiry: false,
            minStock: row.minStock ?? 0,
            units: [],
            variants: [{ name: '', sku: row.sku ?? null, barcode: row.barcode ?? null, cost: row.cost, prices }],
          });
          if (row.qty) {
            const v = await one<{ id: string }>(ctx.db, 'SELECT id FROM variants WHERE product_id = $1', [productId]);
            opening.push({ variantId: v.id, qty: row.qty, cost: row.cost });
          }
        }
      }
      if (opening.length && input.warehouseId) {
        await postMovements(
          ctx.db,
          { orgId: org, userId: ctx.actor.userId, at: ctx.now(), docType: 'import', docId: null },
          opening.map((o) => ({ warehouseId: input.warehouseId!, variantId: o.variantId, kind: 'opening', qty: o.qty, unitCost: o.cost })),
        );
      }
      return { dryRun: false, applied: true, summary, results, id: null };
    },
  }),

  'pos.catalog': route({
    method: 'GET',
    path: '/pos/catalog',
    permission: 'catalog.view',
    input: z.object({ warehouseId: id, priceListId: optId }),
    handler: async (ctx, i) => {
      assertWarehouse(ctx, i.warehouseId);
      const pl = i.priceListId ?? (await defaultPriceListId(ctx));
      const def = await defaultPriceListId(ctx);
      const [items, units] = await Promise.all([
        many<{
          variant_id: string;
          product_id: string;
          name: string;
          variant_name: string;
          sku: string;
          barcode: string | null;
          category_id: string | null;
          unit: string;
          allow_fraction: boolean;
          price: number;
          qty: number;
          image_url: string | null;
        }>(
          ctx.db,
          `SELECT v.id AS variant_id, p.id AS product_id, p.name, v.name AS variant_name, v.sku, v.barcode, p.category_id,
                  u.code AS unit, u.allow_fraction, coalesce(pr.price, dp.price, 0) AS price, coalesce(sb.qty, 0) AS qty, p.image_url
           FROM variants v JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
           LEFT JOIN prices pr ON pr.variant_id = v.id AND pr.price_list_id = $2
           LEFT JOIN prices dp ON dp.variant_id = v.id AND dp.price_list_id = $4
           LEFT JOIN stock_balances sb ON sb.variant_id = v.id AND sb.warehouse_id = $3
           WHERE v.org_id = $1 AND v.is_active AND p.is_active
           ORDER BY p.name, v.name`,
          [ctx.actor.orgId, pl, i.warehouseId, def],
        ),
        many<{ product_id: string; unit: string; factor: number; barcode: string | null }>(
          ctx.db,
          `SELECT pu.product_id, u.code AS unit, pu.factor, pu.barcode FROM product_units pu JOIN units u ON u.id = pu.unit_id
           JOIN products p ON p.id = pu.product_id WHERE p.org_id = $1`,
          [ctx.actor.orgId],
        ),
      ]);
      return { priceListId: pl, items, units };
    },
  }),

  'catalog.lookup': route({
    method: 'GET',
    path: '/lookup',
    permission: 'catalog.view',
    input: z.object({ code: z.string().trim().min(1).max(64) }),
    handler: async (ctx, { code }) =>
      maybeOne<{ variant_id: string; product_id: string; name: string; unit: string; factor: number }>(
        ctx.db,
        `SELECT v.id AS variant_id, p.id AS product_id, p.name || CASE WHEN v.name <> '' THEN ' · ' || v.name ELSE '' END AS name, u.code AS unit, 1 AS factor
         FROM variants v JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
         WHERE v.org_id = $1 AND v.is_active AND (v.barcode = $2 OR lower(v.sku) = lower($2))
         UNION ALL
         SELECT v.id, p.id, p.name, u.code, pu.factor
         FROM product_units pu JOIN products p ON p.id = pu.product_id JOIN units u ON u.id = pu.unit_id
         JOIN LATERAL (SELECT id FROM variants WHERE product_id = p.id AND is_active ORDER BY created_at LIMIT 1) v ON true
         WHERE p.org_id = $1 AND pu.barcode = $2
         LIMIT 1`,
        [ctx.actor.orgId, code],
      ),
  }),

  'units.list': route({
    method: 'GET',
    path: '/units',
    permission: 'member',
    input: z.object({}),
    handler: (ctx) => many<{ id: string; code: string; name: string; allow_fraction: boolean }>(ctx.db, 'SELECT id, code, name, allow_fraction FROM units WHERE org_id = $1 ORDER BY code', [ctx.actor.orgId]),
  }),
};


