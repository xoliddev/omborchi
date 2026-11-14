import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarClock, HandCoins, Truck } from 'lucide-react';
import { Link } from 'react-router';
import { BarList, SegmentedBar, SERIES, TimeChart } from '../components/charts';
import { PageHeader } from '../components/layout';
import { RangeControl, useRange } from '../components/pickers';
import { Delta, Loading, Panel } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';

const METHOD_COLORS: Record<string, string> = { cash: 'var(--s1)', card: 'var(--s2)', payme: 'var(--s3)', click: 'var(--s4)', uzum: 'var(--s5)' };

export default function Dashboard() {
  const { t, fmt } = useI18n();
  const range = useRange('30d');
  const q = useQuery({ queryKey: ['reports.dashboard', range.range], queryFn: () => api.call('reports.dashboard', range.range) });
  const d = q.data;
  return (
    <>
      <PageHeader title={t('nav.dashboard')} />
      <div className="content stack-lg">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <RangeControl state={range} />
          <span className="grow" />
          {d && (
            <span className="small muted">
              {t('dash.vsPrevious', { from: fmt.date(d.previous.from), to: fmt.date(d.previous.to) })}
            </span>
          )}
        </div>
        {!d ? (
          <Loading rows={10} />
        ) : (
          <>
            <div className="kpis">
              <div className="kpi">
                <div className="label">{t('dash.revenue')}</div>
                <div className="value" data-testid="kpi-revenue">
                  {fmt.compact(d.current.revenue)}
                  <small>{t('common.currency')}</small>
                </div>
                <Delta current={d.current.revenue} previous={d.previous.revenue} label={t('dash.vsPrev')} />
              </div>
              <div className="kpi">
                <div className="label">{t('dash.grossProfit')}</div>
                <div className="value">
                  {fmt.compact(d.current.profit)}
                  <small>{t('common.currency')}</small>
                </div>
                <span className="delta flat">
                  {t('dash.margin')} {fmt.pct(d.current.margin)}
                </span>
              </div>
              <div className="kpi">
                <div className="label">{t('dash.salesCount')}</div>
                <div className="value">{fmt.num(d.current.count)}</div>
                <span className="delta flat">
                  {t('dash.avgTicket')} {fmt.money(d.current.avgTicket)}
                </span>
              </div>
              <div className="kpi">
                <div className="label">{t('dash.stockValue')}</div>
                <div className="value">
                  {fmt.compact(d.stock.value)}
                  <small>{t('common.currency')}</small>
                </div>
                <span className="delta flat">{t('dash.skus', { n: fmt.num(d.stock.skus) })}</span>
              </div>
            </div>

            <div className="grid dash">
              <Panel title={t('dash.revenueProfit')} sub={t('dash.revenueProfitSub')}>
                <TimeChart
                  days={d.series.map((s) => s.day)}
                  series={[
                    { key: 'revenue', label: t('dash.revenue'), color: SERIES[0], values: d.series.map((s) => s.revenue), area: true },
                    { key: 'profit', label: t('dash.grossProfit'), color: SERIES[2], values: d.series.map((s) => s.profit) },
                  ]}
                />
              </Panel>
              <Panel title={t('dash.today')} sub={fmt.date(new Date())}>
                <div className="stack">
                  <div>
                    <div className="hero-figure num" data-testid="today-revenue">
                      {fmt.amount(d.today.revenue)}
                    </div>
                    <div className="muted" style={{ marginTop: 6 }}>
                      {t('common.currency')} · {t('dash.todaySales', { n: fmt.num(d.today.count) })} · {t('dash.grossProfit').toLowerCase()} {fmt.money(d.today.profit)}
                    </div>
                  </div>
                  <div>
                    <div className="small muted" style={{ marginBottom: 8 }}>
                      {t('dash.paymentMix')}
                    </div>
                    <SegmentedBar
                      parts={d.paymentMix.map((m) => ({ key: m.method, label: t(`pay.${m.method}` as never), value: m.amount, color: METHOD_COLORS[m.method] ?? 'var(--muted)', ink: m.method === 'click' ? '#0b0b0b' : '#fff' }))}
                    />
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    <AttentionRow to="/alerts" icon={<AlertTriangle size={16} />} label={t('dash.lowStock')} value={fmt.num(d.alerts.low)} tone={d.alerts.low > 0 ? 'warn' : ''} />
                    <AttentionRow to="/alerts" icon={<CalendarClock size={16} />} label={t('dash.expiring')} value={fmt.num(d.alerts.expiring)} tone={d.alerts.expiring > 0 ? 'warn' : ''} />
                    <AttentionRow to="/reports/debts" icon={<HandCoins size={16} />} label={t('dash.receivables')} value={fmt.money(d.receivables.balance)} sub={d.receivables.overdue > 0 ? t('dash.overdue', { v: fmt.money(d.receivables.overdue) }) : undefined} tone={d.receivables.overdue > 0 ? 'bad' : ''} />
                    <AttentionRow to="/suppliers" icon={<Truck size={16} />} label={t('dash.payables')} value={fmt.money(d.payables.balance)} sub={d.payables.overdue > 0 ? t('dash.overdue', { v: fmt.money(d.payables.overdue) }) : undefined} tone={d.payables.overdue > 0 ? 'warn' : ''} />
                  </div>
                </div>
              </Panel>
            </div>

            <div className="grid cols-2">
              <Panel title={t('dash.topProducts')} sub={t('dash.byRevenue')} actions={<Link to="/reports/abc" className="small">{t('dash.abcLink')}</Link>}>
                {d.topProducts.length ? (
                  <BarList items={d.topProducts.map((p) => ({ key: p.variant_id, label: p.name, value: p.revenue, sub: `${fmt.num(p.qty)} ${p.unit}` }))} />
                ) : (
                  <p className="muted">{t('common.noData')}</p>
                )}
              </Panel>
              <Panel title={t('dash.byStore')} sub={t('dash.byStoreSub')}>
                <BarList color="var(--s2)" items={d.byWarehouse.map((w) => ({ key: w.warehouse_id, label: w.name, value: w.revenue, sub: t('dash.todaySales', { n: fmt.num(w.count) }) }))} />
              </Panel>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function AttentionRow({ to, icon, label, value, sub, tone }: { to: string; icon: React.ReactNode; label: string; value: string; sub?: string; tone: string }) {
  return (
    <Link to={to} className="row" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--ink)', textDecoration: 'none' }}>
      <span className={`badge ${tone}`} style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }}>
        {icon}
      </span>
      <span className="grow">
        <span style={{ fontWeight: 550 }}>{label}</span>
        {sub && <span className="cell-sub" style={{ display: 'block' }}>{sub}</span>}
      </span>
      <b className="num">{value}</b>
      <ArrowRight size={14} className="muted" />
    </Link>
  );
}
