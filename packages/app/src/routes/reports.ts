import { abcClassify, addDays, AGING_BUCKETS, daysBetween, marginPercent, roundMoney, sumMoney, tashkentDay, type AgingBucket } from '@omborchi/core';
import { z } from 'zod';
import { route, type Ctx } from '../router';
import { optId, range } from '../schemas';
import { localDay, many, one, tsFrom, tsTo } from '../sql';
import { warehouseScope } from './catalog';
import { debtSummaries } from './parties';

function period(ctx: Ctx, from?: string, to?: string) {
  const today = tashkentDay(ctx.now());
  const t = to ?? today;
  const f = from ?? addDays(t, -29);
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

async function totals(ctx: Ctx, wh: string[] | null, from: string, to: string) {
  const s = await one<{ revenue: number; cost: number; count: number; discount: number }>(
    ctx.db,
    `SELECT coalesce(sum(total), 0) AS revenue, coalesce(sum(cost_total), 0) AS cost, count(*)::int AS count, coalesce(sum(discount_total), 0) AS discount
     FROM sales WHERE org_id = $1 AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[])) AND created_at >= ${tsFrom('$3')} AND created_at < ${tsTo('$4')}`,
    [ctx.actor.orgId, wh, from, to],
  );
  const r = await one<{ total: number; cost: number }>(
    ctx.db,
    `SELECT coalesce(sum(total), 0) AS total, coalesce(sum(cost_total), 0) AS cost
     FROM sale_returns WHERE org_id = $1 AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[])) AND created_at >= ${tsFrom('$3')} AND created_at < ${tsTo('$4')}`,
    [ctx.actor.orgId, wh, from, to],
  );
  const revenue = roundMoney(s.revenue - r.total);
  const cogs = roundMoney(s.cost - r.cost);
  const profit = roundMoney(revenue - cogs);
  return {
    revenue,
    cogs,
    profit,
    margin: marginPercent(revenue, cogs),
    count: s.count,
    avgTicket: s.count ? roundMoney(s.revenue / s.count) : 0,
    discount: s.discount,
    returns: r.total,
  };
}

async function dailySeries(ctx: Ctx, wh: string[] | null, from: string, to: string) {
  return many<{ day: string; revenue: number; profit: number; count: number }>(
    ctx.db,
    `WITH days AS (SELECT d::date AS day FROM generate_series($3::date, $4::date, interval '1 day') AS d),
     s AS (SELECT ${localDay('created_at')} AS day, sum(total) AS revenue, sum(total - cost_total) AS profit, count(*) AS cnt
           FROM sales WHERE org_id = $1 AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[])) AND created_at >= ${tsFrom('$3')} AND created_at < ${tsTo('$4')} GROUP BY 1),
     r AS (SELECT ${localDay('created_at')} AS day, sum(total) AS total, sum(total - cost_total) AS profit
           FROM sale_returns WHERE org_id = $1 AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[])) AND created_at >= ${tsFrom('$3')} AND created_at < ${tsTo('$4')} GROUP BY 1)
     SELECT to_char(days.day, 'YYYY-MM-DD') AS day, coalesce(s.revenue, 0) - coalesce(r.total, 0) AS revenue,
            coalesce(s.profit, 0) - coalesce(r.profit, 0) AS profit, coalesce(s.cnt, 0)::int AS count
     FROM days LEFT JOIN s ON s.day = days.day LEFT JOIN r ON r.day = days.day ORDER BY days.day`,
    [ctx.actor.orgId, wh, from, to],
  );
}

async function productPerformance(ctx: Ctx, wh: string[] | null, from: string, to: string) {
  return many<{ variant_id: string; product_id: string; name: string; sku: string; category: string | null; unit: string; qty: number; revenue: number; profit: number }>(
    ctx.db,
    `SELECT v.id AS variant_id, p.id AS product_id, p.name || CASE WHEN v.name <> '' THEN ' · ' || v.name ELSE '' END AS name, v.sku, c.name AS category, u.code AS unit,
            round(sum(l.base_qty - l.returned_qty), 3) AS qty,
            round(sum(l.total * (1 - l.returned_qty / l.base_qty)), 2) AS revenue,
            round(sum((l.total - l.cost_total) * (1 - l.returned_qty / l.base_qty)), 2) AS profit
     FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
     JOIN units u ON u.id = p.base_unit_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.org_id = $1 AND ($2::uuid[] IS NULL OR s.warehouse_id = ANY($2::uuid[])) AND s.created_at >= ${tsFrom('$3')} AND s.created_at < ${tsTo('$4')}
     GROUP BY v.id, p.id, c.name, u.code ORDER BY revenue DESC`,
    [ctx.actor.orgId, wh, from, to],
  );
}

const rangeInput = z.object({ ...range, warehouseId: optId });

export const reportRoutes = {
  'reports.dashboard': route({
    method: 'GET',
    path: '/reports/dashboard',
    permission: 'reports.view',
    input: rangeInput,
    handler: async (ctx, i) => {
      const { from, to } = period(ctx, i.from, i.to);
      const wh = warehouseScope(ctx, i.warehouseId);
      const len = daysBetween(from, to) + 1;
      const prevTo = addDays(from, -1);
      const prevFrom = addDays(prevTo, -(len - 1));
      const today = tashkentDay(ctx.now());
      const [current, previous, todayTotals, series, products, mix, stock, alerts, byWarehouse] = await Promise.all([
        totals(ctx, wh, from, to),
        totals(ctx, wh, prevFrom, prevTo),
        totals(ctx, wh, today, today),
        dailySeries(ctx, wh, from, to),
        productPerformance(ctx, wh, from, to),
        many<{ method: string; amount: number }>(
          ctx.db,
          `SELECT sp.method, sum(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
           WHERE s.org_id = $1 AND ($2::uuid[] IS NULL OR s.warehouse_id = ANY($2::uuid[])) AND s.created_at >= ${tsFrom('$3')} AND s.created_at < ${tsTo('$4')}
           GROUP BY sp.method ORDER BY amount DESC`,
          [ctx.actor.orgId, wh, from, to],
        ),
        one<{ value: number; skus: number }>(
          ctx.db,
          `SELECT coalesce(round(sum(qty * avg_cost), 2), 0) AS value, count(*) FILTER (WHERE qty > 0)::int AS skus FROM stock_balances
           WHERE org_id = $1 AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[]))`,
          [ctx.actor.orgId, wh],
        ),
        one<{ low: number; expiring: number }>(
          ctx.db,
          `SELECT
             (SELECT count(*)::int FROM variants v JOIN products p ON p.id = v.product_id CROSS JOIN warehouses w
              LEFT JOIN stock_balances sb ON sb.variant_id = v.id AND sb.warehouse_id = w.id
              WHERE v.org_id = $1 AND w.org_id = $1 AND w.kind = 'store' AND w.is_active AND v.is_active AND p.is_active AND p.min_stock > 0
                AND coalesce(sb.qty, 0) <= p.min_stock AND ($2::uuid[] IS NULL OR w.id = ANY($2::uuid[]))) AS low,
             (SELECT count(*)::int FROM batch_balances bb JOIN batches b ON b.id = bb.batch_id
              WHERE b.org_id = $1 AND bb.qty > 0 AND b.expires_at <= $3::date + 30 AND ($2::uuid[] IS NULL OR bb.warehouse_id = ANY($2::uuid[]))) AS expiring`,
          [ctx.actor.orgId, wh, today],
        ),
        many<{ warehouse_id: string; name: string; revenue: number; count: number }>(
          ctx.db,
          `SELECT w.id AS warehouse_id, w.name, coalesce(sum(s.total), 0) AS revenue, count(s.id)::int AS count FROM warehouses w
           LEFT JOIN sales s ON s.warehouse_id = w.id AND s.created_at >= ${tsFrom('$3')} AND s.created_at < ${tsTo('$4')}
           WHERE w.org_id = $1 AND w.kind = 'store' AND ($2::uuid[] IS NULL OR w.id = ANY($2::uuid[])) GROUP BY w.id ORDER BY revenue DESC`,
          [ctx.actor.orgId, wh, from, to],
        ),
      ]);
      const [receivables, payables] = await Promise.all([
        debtSummaries(ctx.db, ctx.actor.orgId, 'customer', ctx.now()),
        debtSummaries(ctx.db, ctx.actor.orgId, 'supplier', ctx.now()),
      ]);
      const sumDebt = (m: Map<string, { balance: number; overdue: number }>) => ({
        balance: sumMoney([...m.values()].map((d) => Math.max(0, d.balance))),
        overdue: sumMoney([...m.values()].map((d) => d.overdue)),
        parties: [...m.values()].filter((d) => d.balance > 0).length,
      });
      return {
        from,
        to,
        previous: { from: prevFrom, to: prevTo, ...previous },
        current,
        today: todayTotals,
        series,
        topProducts: products.slice(0, 8),
        paymentMix: mix,
        stock,
        alerts,
        byWarehouse,
        receivables: sumDebt(receivables),
        payables: sumDebt(payables),
      };
    },
  }),

  'reports.sales': route({
    method: 'GET',
    path: '/reports/sales',
    permission: 'reports.view',
    input: rangeInput,
    handler: async (ctx, i) => {
      const { from, to } = period(ctx, i.from, i.to);
      const wh = warehouseScope(ctx, i.warehouseId);
      const [summary, series, products] = await Promise.all([totals(ctx, wh, from, to), dailySeries(ctx, wh, from, to), productPerformance(ctx, wh, from, to)]);
      return { from, to, summary, series, products: products.slice(0, 50) };
    },
  }),

  'reports.abc': route({
    method: 'GET',
    path: '/reports/abc',
    permission: 'reports.view',
    input: rangeInput.extend({ metric: z.enum(['revenue', 'profit', 'qty']).default('revenue') }),
    handler: async (ctx, i) => {
      const { from, to } = period(ctx, i.from, i.to);
      const products = await productPerformance(ctx, warehouseScope(ctx, i.warehouseId), from, to);
      const classified = abcClassify(products, (p) => p[i.metric]);
      const classes = (['A', 'B', 'C'] as const).map((k) => {
        const items = classified.filter((c) => c.abc === k);
        return { class: k, count: items.length, value: sumMoney(items.map((x) => x.value)), share: items.reduce((s, x) => s + x.share, 0) };
      });
      return {
        from,
        to,
        metric: i.metric,
        classes,
        items: classified.map((c) => ({ ...c.item, value: c.value, share: c.share, cumulativeShare: c.cumulativeShare, abc: c.abc })),
      };
    },
  }),

  'reports.stockValue': route({
    method: 'GET',
    path: '/reports/stock-value',
    permission: 'reports.view',
    input: z.object({}),
    handler: async (ctx) => {
      const wh = warehouseScope(ctx);
      const [byWarehouse, byCategory] = await Promise.all([
        many<{ warehouse_id: string; name: string; kind: string; skus: number; qty: number; cost_value: number; retail_value: number }>(
          ctx.db,
          `SELECT w.id AS warehouse_id, w.name, w.kind, count(sb.variant_id) FILTER (WHERE sb.qty > 0)::int AS skus, coalesce(sum(sb.qty), 0) AS qty,
                  coalesce(round(sum(sb.qty * sb.avg_cost), 2), 0) AS cost_value, coalesce(round(sum(sb.qty * coalesce(pr.price, 0)), 2), 0) AS retail_value
           FROM warehouses w LEFT JOIN stock_balances sb ON sb.warehouse_id = w.id
           LEFT JOIN prices pr ON pr.variant_id = sb.variant_id AND pr.price_list_id = (SELECT id FROM price_lists WHERE org_id = $1 AND is_default LIMIT 1)
           WHERE w.org_id = $1 AND ($2::uuid[] IS NULL OR w.id = ANY($2::uuid[])) GROUP BY w.id ORDER BY cost_value DESC`,
          [ctx.actor.orgId, wh],
        ),
        many<{ category_id: string | null; name: string | null; cost_value: number; skus: number }>(
          ctx.db,
          `WITH RECURSIVE tree AS (
             SELECT id, id AS root_id, name AS root_name FROM categories WHERE org_id = $1 AND parent_id IS NULL
             UNION ALL SELECT c.id, t.root_id, t.root_name FROM categories c JOIN tree t ON c.parent_id = t.id
           )
           SELECT tree.root_id AS category_id, tree.root_name AS name, round(sum(sb.qty * sb.avg_cost), 2) AS cost_value, count(*) FILTER (WHERE sb.qty > 0)::int AS skus
           FROM stock_balances sb JOIN variants v ON v.id = sb.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN tree ON tree.id = p.category_id
           WHERE sb.org_id = $1 AND ($2::uuid[] IS NULL OR sb.warehouse_id = ANY($2::uuid[]))
           GROUP BY tree.root_id, tree.root_name ORDER BY cost_value DESC NULLS LAST`,
          [ctx.actor.orgId, wh],
        ),
      ]);
      return { byWarehouse, byCategory, total: sumMoney(byWarehouse.map((w) => w.cost_value)), retailTotal: sumMoney(byWarehouse.map((w) => w.retail_value)) };
    },
  }),

  'reports.deadStock': route({
    method: 'GET',
    path: '/reports/dead-stock',
    permission: 'reports.view',
    input: z.object({ days: z.coerce.number().int().min(7).max(365).default(30), warehouseId: optId }),
    handler: async (ctx, i) => {
      const wh = warehouseScope(ctx, i.warehouseId);
      const rows = await many<{ variant_id: string; product_id: string; name: string; sku: string; category: string | null; unit: string; qty: number; value: number; last_sale: string | null; days_idle: number | null }>(
        ctx.db,
        `SELECT v.id AS variant_id, p.id AS product_id, p.name || CASE WHEN v.name <> '' THEN ' · ' || v.name ELSE '' END AS name, v.sku, c.name AS category, u.code AS unit,
                sum(sb.qty) AS qty, round(sum(sb.qty * sb.avg_cost), 2) AS value, ls.last_sale,
                CASE WHEN ls.last_sale IS NULL THEN NULL ELSE extract(day FROM ($3::timestamptz - ls.last_sale))::int END AS days_idle
         FROM stock_balances sb JOIN variants v ON v.id = sb.variant_id JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.base_unit_id
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN LATERAL (SELECT max(m.created_at) AS last_sale FROM stock_movements m WHERE m.variant_id = v.id AND m.kind = 'sale') ls ON true
         WHERE sb.org_id = $1 AND sb.qty > 0 AND ($2::uuid[] IS NULL OR sb.warehouse_id = ANY($2::uuid[]))
           AND (ls.last_sale IS NULL OR ls.last_sale < $3::timestamptz - make_interval(days => $4))
         GROUP BY v.id, p.id, c.name, u.code, ls.last_sale ORDER BY value DESC`,
        [ctx.actor.orgId, wh, ctx.now(), i.days],
      );
      return { days: i.days, rows, totalValue: sumMoney(rows.map((r) => r.value)) };
    },
  }),

  'reports.shifts': route({
    method: 'GET',
    path: '/reports/shifts',
    permission: 'reports.view',
    input: rangeInput,
    handler: async (ctx, i) => {
      const { from, to } = period(ctx, i.from, i.to);
      return many<{ id: string; number: string; status: string; opened_at: string; closed_at: string | null; cashier: string; warehouse: string; sales_count: number; revenue: number; cash: number; card: number; online: number; debt: number; returns: number; expected_cash: number | null; counted_cash: number | null; difference: number | null }>(
        ctx.db,
        `SELECT sh.id, sh.number, sh.status, sh.opened_at, sh.closed_at, u.name AS cashier, w.name AS warehouse,
                (SELECT count(*)::int FROM sales s WHERE s.shift_id = sh.id) AS sales_count,
                (SELECT coalesce(sum(total), 0) FROM sales s WHERE s.shift_id = sh.id) AS revenue,
                (SELECT coalesce(sum(sp.amount), 0) FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.shift_id = sh.id AND sp.method = 'cash') AS cash,
                (SELECT coalesce(sum(sp.amount), 0) FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.shift_id = sh.id AND sp.method = 'card') AS card,
                (SELECT coalesce(sum(sp.amount), 0) FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.shift_id = sh.id AND sp.method IN ('payme','click','uzum')) AS online,
                (SELECT coalesce(sum(debt), 0) FROM sales s WHERE s.shift_id = sh.id) AS debt,
                (SELECT coalesce(sum(total), 0) FROM sale_returns r WHERE r.shift_id = sh.id) AS returns,
                sh.expected_cash, sh.counted_cash, sh.counted_cash - sh.expected_cash AS difference
         FROM shifts sh JOIN users u ON u.id = sh.user_id JOIN warehouses w ON w.id = sh.warehouse_id
         WHERE sh.org_id = $1 AND ($2::uuid[] IS NULL OR sh.warehouse_id = ANY($2::uuid[])) AND sh.opened_at >= ${tsFrom('$3')} AND sh.opened_at < ${tsTo('$4')}
         ORDER BY sh.opened_at DESC`,
        [ctx.actor.orgId, warehouseScope(ctx, i.warehouseId), from, to],
      );
    },
  }),

  'reports.debtAging': route({
    method: 'GET',
    path: '/reports/debt-aging',
    permission: 'reports.view',
    input: z.object({ partyType: z.enum(['customer', 'supplier']).default('customer') }),
    handler: async (ctx, i) => {
      const table = i.partyType === 'customer' ? 'customers' : 'suppliers';
      const parties = await many<{ id: string; name: string; phone: string | null }>(ctx.db, `SELECT id, name, phone FROM ${table} WHERE org_id = $1`, [ctx.actor.orgId]);
      const debts = await debtSummaries(ctx.db, ctx.actor.orgId, i.partyType, ctx.now());
      const rows = parties
        .flatMap((p) => {
          const d = debts.get(p.id);
          return d && d.balance > 0 ? [{ ...p, ...d }] : [];
        })
        .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
      const totalsByBucket = Object.fromEntries(AGING_BUCKETS.map((b) => [b, sumMoney(rows.map((r) => r.aging[b]))])) as Record<AgingBucket, number>;
      return { partyType: i.partyType, rows, totals: totalsByBucket, balance: sumMoney(rows.map((r) => r.balance)) };
    },
  }),
};
