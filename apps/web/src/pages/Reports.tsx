import { tashkentDay } from '@omborchi/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { BarList, SegmentedBar, SERIES, TimeChart } from '../components/charts';
import { PageHeader } from '../components/layout';
import { ExportButtons, RangeControl, useRange } from '../components/pickers';
import { Empty, Loading, Panel, Seg } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

const TABS = ['sales', 'abc', 'stock', 'dead', 'shifts', 'debts'] as const;
type Tab = (typeof TABS)[number];

export default function Reports() {
  const { t } = useI18n();
  const { tab = 'sales' } = useParams();
  const current = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : 'sales';
  return (
    <>
      <PageHeader title={t('nav.reports')} />
      <div className="content">
        <nav className="tabs" aria-label={t('nav.reports')}>
          {TABS.map((x) => (
            <NavLink key={x} to={`/reports/${x}`} className={() => (x === current ? 'active' : '')}>
              {t(`rep.tab.${x}` as never)}
            </NavLink>
          ))}
        </nav>
        {current === 'sales' && <SalesReport />}
        {current === 'abc' && <AbcReport />}
        {current === 'stock' && <StockValueReport />}
        {current === 'dead' && <DeadStockReport />}
        {current === 'shifts' && <ShiftsReport />}
        {current === 'debts' && <DebtAgingReport />}
      </div>
    </>
  );
}

function useScope() {
  const { warehouseId, me } = useSession();
  const [scope, setScope] = useState<'all' | 'here'>('all');
  return { scope, setScope, warehouseId: scope === 'here' ? warehouseId : null, label: me.warehouses.find((w) => w.id === warehouseId)?.name ?? '' };
}

function ScopeSeg({ s }: { s: ReturnType<typeof useScope> }) {
  const { t } = useI18n();
  return <Seg value={s.scope} onChange={s.setScope} options={[{ value: 'all', label: t('products.allWarehouses') }, { value: 'here', label: s.label }]} />;
}

function SalesReport() {
  const { t, fmt } = useI18n();
  const range = useRange('30d');
  const s = useScope();
  const q = useQuery({ queryKey: ['reports.sales', range.range, s.warehouseId], queryFn: () => api.call('reports.sales', { ...range.range, warehouseId: s.warehouseId }) });
  const d = q.data;
  return (
    <div className="stack-lg">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <RangeControl state={range} />
        <ScopeSeg s={s} />
        <span className="grow" />
        <ExportButtons
          name={`sales-by-day-${range.range.from}-${range.range.to}`}
          rows={d?.series}
          cols={[
            { header: 'day', value: (r) => r.day },
            { header: 'receipts', value: (r) => r.count },
            { header: 'revenue', value: (r) => r.revenue },
            { header: 'grossProfit', value: (r) => r.profit },
          ]}
        />
      </div>
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="label">{t('dash.revenue')}</div>
              <div className="value">{fmt.money(d.summary.revenue)}</div>
              <span className="delta flat">{t('rep.returns', { v: fmt.money(d.summary.returns) })}</span>
            </div>
            <div className="kpi">
              <div className="label">{t('rep.cogs')}</div>
              <div className="value">{fmt.money(d.summary.cogs)}</div>
              <span className="delta flat">{t('rep.wac')}</span>
            </div>
            <div className="kpi">
              <div className="label">{t('dash.grossProfit')}</div>
              <div className="value">{fmt.money(d.summary.profit)}</div>
              <span className="delta flat">
                {t('dash.margin')} {fmt.pct(d.summary.margin)}
              </span>
            </div>
            <div className="kpi">
              <div className="label">{t('dash.salesCount')}</div>
              <div className="value">{fmt.num(d.summary.count)}</div>
              <span className="delta flat">
                {t('pos.discount')} {fmt.money(d.summary.discount)}
              </span>
            </div>
          </div>
          <Panel title={t('dash.revenueProfit')}>
            <TimeChart
              partialLast={(d.series.at(-1)?.day ?? '') === tashkentDay(new Date())}
              days={d.series.map((x) => x.day)}
              series={[
                { key: 'r', label: t('dash.revenue'), color: SERIES[0], values: d.series.map((x) => x.revenue), area: true },
                { key: 'p', label: t('dash.grossProfit'), color: SERIES[2], values: d.series.map((x) => x.profit) },
              ]}
            />
          </Panel>
          <Panel
            title={t('rep.products')}
            flush
            actions={
              <ExportButtons
                name="product-sales"
                rows={d.products}
                cols={[
                  { header: 'name', value: (r) => r.name },
                  { header: 'sku', value: (r) => r.sku },
                  { header: 'category', value: (r) => r.category },
                  { header: 'qty', value: (r) => r.qty },
                  { header: 'revenue', value: (r) => r.revenue },
                  { header: 'grossProfit', value: (r) => r.profit },
                ]}
              />
            }
          >
            <ProductsTable rows={d.products} />
          </Panel>
        </>
      )}
    </div>
  );
}

function ProductsTable({ rows }: { rows: { variant_id: string; name: string; sku: string; category: string | null; unit: string; qty: number; revenue: number; profit: number }[] }) {
  const { t, fmt } = useI18n();
  if (!rows.length) return <Empty title={t('common.noData')} />;
  return (
    <div className="table-wrap" style={{ maxHeight: 520 }}>
      <table className="data">
        <thead>
          <tr>
            <th>{t('common.product')}</th>
            <th className="right">{t('common.qty')}</th>
            <th className="right">{t('dash.revenue')}</th>
            <th className="right">{t('dash.grossProfit')}</th>
            <th className="right hide-sm">{t('dash.margin')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.variant_id}>
              <td>
                <div className="cell-title">{r.name}</div>
                <div className="cell-sub">{r.category}</div>
              </td>
              <td className="right">
                {fmt.num(r.qty)} {r.unit}
              </td>
              <td className="right">{fmt.amount(r.revenue)}</td>
              <td className="right">{fmt.amount(r.profit)}</td>
              <td className="right hide-sm">{fmt.pct(r.revenue ? (r.profit / r.revenue) * 100 : 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AbcReport() {
  const { t, fmt } = useI18n();
  const range = useRange('90d');
  const s = useScope();
  const [metric, setMetric] = useState<'revenue' | 'profit' | 'qty'>('revenue');
  const q = useQuery({ queryKey: ['reports.abc', range.range, metric, s.warehouseId], queryFn: () => api.call('reports.abc', { ...range.range, metric, warehouseId: s.warehouseId }) });
  const d = q.data;
  const fmtV = metric === 'qty' ? (v: number) => fmt.num(v) : fmt.money;
  return (
    <div className="stack-lg">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <RangeControl state={range} />
        <Seg value={metric} onChange={setMetric} options={[{ value: 'revenue', label: t('dash.revenue') }, { value: 'profit', label: t('dash.grossProfit') }, { value: 'qty', label: t('common.qty') }]} />
        <ScopeSeg s={s} />
        <span className="grow" />
        <ExportButtons
          name="abc"
          rows={d?.items}
          cols={[
            { header: 'class', value: (r) => r.abc },
            { header: 'name', value: (r) => r.name },
            { header: 'sku', value: (r) => r.sku },
            { header: metric, value: (r) => r.value },
            { header: 'share', value: (r) => Math.round(r.share * 10000) / 100 },
            { header: 'cumulative', value: (r) => Math.round(r.cumulativeShare * 10000) / 100 },
          ]}
        />
      </div>
      <p className="small muted">{t('rep.abcHint')}</p>
      {!d ? (
        <Loading />
      ) : (
        <>
          <Panel title={t('rep.abcSplit')}>
            <SegmentedBar
              format={(v) => fmtV(v)}
              parts={d.classes.map((c, i) => ({ key: c.class, label: t('rep.abcClass', { c: c.class, n: c.count }), value: c.value, color: SERIES[i] }))}
            />
          </Panel>
          <Panel flush>
            <div className="table-wrap" style={{ maxHeight: 560 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>ABC</th>
                    <th>{t('common.product')}</th>
                    <th className="right">{metric === 'qty' ? t('common.qty') : t(metric === 'revenue' ? 'dash.revenue' : 'dash.grossProfit')}</th>
                    <th className="right">{t('rep.share')}</th>
                    <th className="right hide-sm">{t('rep.cumulative')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((r) => (
                    <tr key={r.variant_id}>
                      <td>
                        <span className={`badge ${r.abc === 'A' ? 'good' : r.abc === 'B' ? 'accent' : ''}`}>{r.abc}</span>
                      </td>
                      <td>
                        <div className="cell-title">{r.name}</div>
                        <div className="cell-sub">{r.category}</div>
                      </td>
                      <td className="right">{fmtV(r.value)}</td>
                      <td className="right">{fmt.pct(r.share * 100, 2)}</td>
                      <td className="right hide-sm">{fmt.pct(r.cumulativeShare * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function StockValueReport() {
  const { t, fmt } = useI18n();
  const q = useQuery({ queryKey: ['reports.stockValue'], queryFn: () => api.call('reports.stockValue', {}) });
  const d = q.data;
  if (!d) return <Loading />;
  return (
    <div className="stack-lg">
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="label">{t('rep.atCost')}</div>
          <div className="value">{fmt.money(d.total)}</div>
        </div>
        <div className="kpi">
          <div className="label">{t('rep.atRetail')}</div>
          <div className="value">{fmt.money(d.retailTotal)}</div>
        </div>
        <div className="kpi">
          <div className="label">{t('rep.potential')}</div>
          <div className="value">{fmt.money(d.retailTotal - d.total)}</div>
        </div>
      </div>
      <div className="grid cols-2">
        <Panel title={t('rep.byWarehouse')} actions={<ExportButtons name="stock-value" rows={d.byWarehouse} cols={[{ header: 'warehouse', value: (r) => r.name }, { header: 'skus', value: (r) => r.skus }, { header: 'costValue', value: (r) => r.cost_value }, { header: 'retailValue', value: (r) => r.retail_value }]} />}>
          <BarList items={d.byWarehouse.map((w) => ({ key: w.warehouse_id, label: w.name, value: w.cost_value, sub: t('dash.skus', { n: fmt.num(w.skus) }) }))} />
        </Panel>
        <Panel title={t('rep.byCategory')}>
          <BarList color="var(--s3)" items={d.byCategory.map((c) => ({ key: c.category_id ?? 'none', label: c.name ?? t('common.none'), value: c.cost_value ?? 0, sub: t('dash.skus', { n: fmt.num(c.skus) }) }))} />
        </Panel>
      </div>
    </div>
  );
}

function DeadStockReport() {
  const { t, fmt } = useI18n();
  const [days, setDays] = useState<'30' | '60' | '90'>('30');
  const q = useQuery({ queryKey: ['reports.deadStock', days], queryFn: () => api.call('reports.deadStock', { days: Number(days) }) });
  const d = q.data;
  return (
    <div className="stack-lg">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Seg value={days} onChange={setDays} options={(['30', '60', '90'] as const).map((x) => ({ value: x, label: t('rep.noSalesFor', { n: x }) }))} />
        <span className="grow" />
        {d && (
          <span className="small muted">
            {t('rep.frozen')}: <b className="num" style={{ color: 'var(--ink)' }}>{fmt.money(d.totalValue)}</b>
          </span>
        )}
        <ExportButtons name="dead-stock" rows={d?.rows} cols={[{ header: 'name', value: (r) => r.name }, { header: 'sku', value: (r) => r.sku }, { header: 'qty', value: (r) => r.qty }, { header: 'value', value: (r) => r.value }, { header: 'lastSale', value: (r) => r.last_sale }]} />
      </div>
      <p className="small muted">{t('rep.deadHint')}</p>
      <Panel flush>
        {!d ? (
          <Loading />
        ) : d.rows.length === 0 ? (
          <Empty title={t('rep.noDead')} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('common.product')}</th>
                  <th className="right">{t('common.qty')}</th>
                  <th className="right">{t('rep.frozen')}</th>
                  <th className="right">{t('rep.lastSale')}</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.variant_id}>
                    <td>
                      <div className="cell-title">{r.name}</div>
                      <div className="cell-sub">{r.category}</div>
                    </td>
                    <td className="right">
                      {fmt.num(r.qty)} {r.unit}
                    </td>
                    <td className="right">{fmt.amount(r.value)}</td>
                    <td className="right">{r.last_sale ? t('rep.daysAgo', { n: r.days_idle ?? 0 }) : <span className="badge warn">{t('rep.never')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ShiftsReport() {
  const { t, fmt } = useI18n();
  const range = useRange('7d');
  const q = useQuery({ queryKey: ['reports.shifts', range.range], queryFn: () => api.call('reports.shifts', range.range) });
  const d = q.data;
  return (
    <div className="stack-lg">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <RangeControl state={range} />
        <span className="grow" />
        <ExportButtons
          name="shifts"
          rows={d}
          cols={[
            { header: 'number', value: (r) => r.number },
            { header: 'cashier', value: (r) => r.cashier },
            { header: 'warehouse', value: (r) => r.warehouse },
            { header: 'opened', value: (r) => r.opened_at },
            { header: 'closed', value: (r) => r.closed_at },
            { header: 'sales', value: (r) => r.sales_count },
            { header: 'revenue', value: (r) => r.revenue },
            { header: 'cash', value: (r) => r.cash },
            { header: 'card', value: (r) => r.card },
            { header: 'online', value: (r) => r.online },
            { header: 'debt', value: (r) => r.debt },
            { header: 'expectedCash', value: (r) => r.expected_cash },
            { header: 'countedCash', value: (r) => r.counted_cash },
            { header: 'difference', value: (r) => r.difference },
          ]}
        />
      </div>
      <Panel flush>
        {!d ? (
          <Loading />
        ) : d.length === 0 ? (
          <Empty title={t('common.noData')} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('rep.shift')}</th>
                  <th className="right">{t('dash.salesCount')}</th>
                  <th className="right">{t('dash.revenue')}</th>
                  <th className="right hide-sm">{t('pay.cash')}</th>
                  <th className="right hide-sm">{t('pay.card')}</th>
                  <th className="right hide-sm">{t('pay.online')}</th>
                  <th className="right hide-sm">{t('pos.debt')}</th>
                  <th className="right">{t('rep.cashDiff')}</th>
                </tr>
              </thead>
              <tbody>
                {d.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="cell-title">
                        {r.cashier} <span className="muted num">{r.number}</span>
                      </div>
                      <div className="cell-sub">
                        {r.warehouse} · {fmt.dateTime(r.opened_at)}
                        {r.closed_at ? ` – ${fmt.time(r.closed_at)}` : ''}
                      </div>
                    </td>
                    <td className="right">{r.sales_count}</td>
                    <td className="right">{fmt.amount(r.revenue)}</td>
                    <td className="right hide-sm">{fmt.amount(r.cash)}</td>
                    <td className="right hide-sm">{fmt.amount(r.card)}</td>
                    <td className="right hide-sm">{fmt.amount(r.online)}</td>
                    <td className="right hide-sm">{fmt.amount(r.debt)}</td>
                    <td className="right">
                      {r.status === 'open' ? (
                        <span className="badge accent">{t('status.open')}</span>
                      ) : r.difference === 0 ? (
                        <span className="badge good">0</span>
                      ) : (
                        <span className={`badge ${(r.difference ?? 0) < 0 ? 'bad' : 'warn'}`}>
                          {(r.difference ?? 0) > 0 ? '+' : ''}
                          {fmt.amount(r.difference)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
const BUCKET_COLORS = ['var(--s3)', 'var(--s4)', 'var(--s2)', '#d03b3b', '#8a1f1f'];

function DebtAgingReport() {
  const { t, fmt } = useI18n();
  const [party, setParty] = useState<'customer' | 'supplier'>('customer');
  const q = useQuery({ queryKey: ['reports.debtAging', party], queryFn: () => api.call('reports.debtAging', { partyType: party }) });
  const d = q.data;
  return (
    <div className="stack-lg">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Seg value={party} onChange={setParty} options={[{ value: 'customer', label: t('rep.receivable') }, { value: 'supplier', label: t('rep.payable') }]} />
        <span className="grow" />
        <ExportButtons
          name={`debt-aging-${party}`}
          rows={d?.rows}
          cols={[{ header: 'name', value: (r) => r.name }, { header: 'phone', value: (r) => r.phone }, { header: 'balance', value: (r) => r.balance }, ...BUCKETS.map((b) => ({ header: b, value: (r: NonNullable<typeof d>['rows'][number]) => r.aging[b] }))]}
        />
      </div>
      {!d ? (
        <Loading />
      ) : (
        <>
          <Panel title={t('rep.agingTitle', { v: fmt.money(d.balance) })} sub={t('rep.agingSub')}>
            <SegmentedBar parts={BUCKETS.map((b, i) => ({ key: b, label: t(`aging.${b}`), value: d.totals[b], color: BUCKET_COLORS[i], ink: i === 1 ? '#0b0b0b' : '#fff' }))} />
          </Panel>
          <Panel flush>
            {d.rows.length === 0 ? (
              <Empty title={t('rep.noDebts')} />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{party === 'customer' ? t('common.customer') : t('common.supplier')}</th>
                      {BUCKETS.map((b) => (
                        <th key={b} className={`right ${b === 'current' ? '' : 'hide-sm'}`}>
                          {t(`aging.${b}`)}
                        </th>
                      ))}
                      <th className="right">{t('common.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div className="cell-title">{r.name}</div>
                          <div className="cell-sub">{r.phone}</div>
                        </td>
                        {BUCKETS.map((b) => (
                          <td key={b} className={`right ${b === 'current' ? '' : 'hide-sm'}`} style={{ color: b !== 'current' && r.aging[b] > 0 ? 'var(--bad)' : undefined }}>
                            {r.aging[b] ? fmt.amount(r.aging[b]) : '—'}
                          </td>
                        ))}
                        <td className="right">
                          <b>{fmt.amount(r.balance)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
