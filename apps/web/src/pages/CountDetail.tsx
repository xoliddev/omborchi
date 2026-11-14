import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ScanLine, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../components/layout';
import { ExportButtons } from '../components/pickers';
import { Scanner } from '../components/Scanner';
import { Loading, Panel, Seg, StatusBadge } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

export default function CountDetail() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['counts.get', { id }], queryFn: () => api.call('counts.get', { id }) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'uncounted' | 'diff'>('all');
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const open = q.data?.status === 'open' && can('stock.count');

  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(q.data.lines.map((l) => [l.variant_id, l.counted_qty === null ? '' : String(l.counted_qty)])));
  }, [q.data]);

  const dirty = q.data?.lines.some((l) => (l.counted_qty === null ? '' : String(l.counted_qty)) !== (draft[l.variant_id] ?? '')) ?? false;
  const save = useMutation({
    mutationFn: () =>
      api.call('counts.setCounted', {
        id,
        lines: q.data!.lines.map((l) => ({ variantId: l.variant_id, countedQty: draft[l.variant_id] === '' || draft[l.variant_id] === undefined ? null : Number(draft[l.variant_id]) })),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['counts.get'] }),
    onError: toast.error,
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      return api.call('counts.apply', { id });
    },
    onSuccess: (r) => {
      toast.ok(t('counts.applied', { n: r.adjustments }));
      qc.invalidateQueries();
    },
    onError: toast.error,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.lines ?? []).filter((l) => {
      if (s && !l.name.toLowerCase().includes(s) && !l.sku.toLowerCase().includes(s) && l.barcode !== search.trim()) return false;
      const d = draft[l.variant_id];
      if (filter === 'uncounted') return d === '' || d === undefined;
      if (filter === 'diff') return d !== '' && d !== undefined && Number(d) !== l.expected_qty;
      return true;
    });
  }, [q.data, draft, filter, search]);

  if (!q.data) return <Loading rows={10} />;
  const s = q.data.summary;
  return (
    <>
      <PageHeader
        back={
          <Link to="/counts" className="btn ghost icon" aria-label={t('common.back')}>
            <ArrowLeft size={18} />
          </Link>
        }
        title={`${t('nav.counts')} ${q.data.number}`}
        actions={
          <span className="row">
            <StatusBadge status={q.data.status} />
            {open && (
              <>
                <button className="btn" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                  {t('common.save')}
                </button>
                <button
                  className="btn primary"
                  disabled={apply.isPending}
                  onClick={() => confirm(t('counts.applyConfirm')) && apply.mutate()}
                >
                  <Check size={15} />
                  {t('counts.apply')}
                </button>
              </>
            )}
          </span>
        }
      />
      <div className="content stack-lg">
        <div className="kpis">
          <div className="kpi">
            <div className="label">{t('counts.progress')}</div>
            <div className="value">
              {fmt.num(s.counted)} <small>/ {fmt.num(s.counted + s.uncounted)}</small>
            </div>
            <span className="delta flat">{t('counts.accuracy', { pct: fmt.pct(s.accuracy * 100) })}</span>
          </div>
          <div className="kpi">
            <div className="label">{t('counts.shortage')}</div>
            <div className="value" style={{ color: s.shortageValue ? 'var(--bad)' : undefined }}>
              {fmt.compact(s.shortageValue)} <small>{t('common.currency')}</small>
            </div>
            <span className="delta flat">{t('counts.units', { n: fmt.num(s.shortageQty) })}</span>
          </div>
          <div className="kpi">
            <div className="label">{t('counts.surplus')}</div>
            <div className="value">
              {fmt.compact(s.surplusValue)} <small>{t('common.currency')}</small>
            </div>
            <span className="delta flat">{t('counts.units', { n: fmt.num(s.surplusQty) })}</span>
          </div>
          <div className="kpi">
            <div className="label">{t('counts.net')}</div>
            <div className="value" style={{ color: s.netValue < 0 ? 'var(--bad)' : undefined }}>
              {fmt.compact(s.netValue)} <small>{t('common.currency')}</small>
            </div>
            <span className="delta flat">{q.data.warehouse}</span>
          </div>
        </div>
        {open && <p className="small muted">{t('counts.workHint')}</p>}
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="search" style={{ width: 280 }}>
            <Search size={16} />
            <input
              className="input"
              value={search}
              placeholder={t('products.search')}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && open) {
                  const hit = q.data!.lines.find((l) => l.barcode === search.trim() || l.sku.toLowerCase() === search.trim().toLowerCase());
                  if (hit) {
                    setDraft((d) => ({ ...d, [hit.variant_id]: String((Number(d[hit.variant_id]) || 0) + 1) }));
                    setSearch('');
                  }
                }
              }}
              aria-label={t('products.search')}
            />
          </div>
          {open && (
            <button className="btn" onClick={() => setScan(true)}>
              <ScanLine size={15} />
              {t('counts.scanCount')}
            </button>
          )}
          <Seg
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('common.all') },
              { value: 'uncounted', label: t('counts.uncounted') },
              { value: 'diff', label: t('counts.differences') },
            ]}
          />
          <span className="grow" />
          <ExportButtons
            name={`count-${q.data.number}`}
            rows={q.data.lines}
            cols={[
              { header: 'name', value: (r) => r.name },
              { header: 'sku', value: (r) => r.sku },
              { header: 'expected', value: (r) => r.expected_qty },
              { header: 'counted', value: (r) => r.counted_qty },
              { header: 'variance', value: (r) => r.variance_qty },
              { header: 'varianceValue', value: (r) => r.variance_value },
            ]}
          />
        </div>
        <Panel flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('common.product')}</th>
                  <th className="right">{t('counts.expected')}</th>
                  <th className="right" style={{ width: 130 }}>
                    {t('counts.counted')}
                  </th>
                  <th className="right">{t('counts.variance')}</th>
                  <th className="right hide-sm">{t('common.value')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const d = draft[l.variant_id];
                  const has = d !== '' && d !== undefined;
                  const v = has ? Number(d) - l.expected_qty : 0;
                  return (
                    <tr key={l.variant_id}>
                      <td>
                        <div className="cell-title">{l.name}</div>
                        <div className="cell-sub">{l.sku}</div>
                      </td>
                      <td className="right">
                        {fmt.num(l.expected_qty)} {l.unit}
                      </td>
                      <td className="right">
                        {open ? (
                          <input className="input num" inputMode="decimal" value={d ?? ''} placeholder="—" onChange={(e) => setDraft({ ...draft, [l.variant_id]: e.target.value.replace(',', '.') })} aria-label={t('counts.counted')} />
                        ) : (
                          fmt.num(l.counted_qty ?? 0)
                        )}
                      </td>
                      <td className="right">{has ? <span className={`badge ${v === 0 ? 'good' : v < 0 ? 'bad' : 'warn'}`}>{v > 0 ? `+${fmt.num(v)}` : fmt.num(v)}</span> : <span className="muted">—</span>}</td>
                      <td className="right hide-sm">{has ? fmt.amount(v * l.unit_cost) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      {scan && (
        <Scanner
          onClose={() => setScan(false)}
          onCode={(code) => {
            const hit = q.data!.lines.find((l) => l.barcode === code || l.sku === code);
            if (hit) {
              setDraft((d) => ({ ...d, [hit.variant_id]: String((Number(d[hit.variant_id]) || 0) + 1) }));
              toast.ok(`${hit.name} +1`);
            } else toast.error(new Error(t('pos.notFound', { code })));
          }}
        />
      )}
    </>
  );
}
