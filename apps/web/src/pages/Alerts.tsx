import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, CalendarX2, PackageX } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../components/layout';
import { ExportButtons } from '../components/pickers';
import { Empty, Loading, Panel } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

export default function Alerts() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['alerts.list', { expiryDays: 30 }], queryFn: () => api.call('alerts.list', { expiryDays: 30 }) });
  const writeOff = useMutation({
    mutationFn: (e: { warehouse_id: string; variant_id: string; batch_id: string; qty: number }) =>
      api.call('stock.writeOff', { warehouseId: e.warehouse_id, reason: 'expired', lines: [{ variantId: e.variant_id, qty: e.qty, batchId: e.batch_id }] }),
    onSuccess: (r) => {
      toast.ok(t('writeoffs.done', { number: r.number }));
      qc.invalidateQueries();
    },
    onError: toast.error,
  });
  const d = q.data;
  return (
    <>
      <PageHeader title={t('nav.alerts')} />
      <div className="content stack-lg">
        {!d ? (
          <Loading />
        ) : (
          <>
            <Panel
              title={t('alerts.low', { n: d.lowStock.length })}
              sub={t('alerts.lowSub')}
              flush
              actions={
                <span className="row">
                  {can('stock.transfer') && (
                    <Link className="btn sm" to="/transfers">
                      <ArrowLeftRight size={14} />
                      {t('transfers.new')}
                    </Link>
                  )}
                  <ExportButtons name="low-stock" rows={d.lowStock} cols={[{ header: 'warehouse', value: (r) => r.warehouse }, { header: 'name', value: (r) => r.name }, { header: 'sku', value: (r) => r.sku }, { header: 'qty', value: (r) => r.qty }, { header: 'min', value: (r) => r.min_stock }]} />
                </span>
              }
            >
              {d.lowStock.length === 0 ? (
                <Empty icon={<PackageX size={24} />} title={t('alerts.noneLow')} />
              ) : (
                <div className="table-wrap" style={{ maxHeight: 460 }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t('common.product')}</th>
                        <th>{t('common.warehouse')}</th>
                        <th className="right">{t('common.qty')}</th>
                        <th className="right">{t('products.minStock')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.lowStock.map((r) => (
                        <tr key={`${r.warehouse_id}-${r.variant_id}`}>
                          <td>
                            <div className="cell-title">{r.name}</div>
                            <div className="cell-sub">{r.sku}</div>
                          </td>
                          <td>{r.warehouse}</td>
                          <td className="right">
                            <span className={`badge ${r.qty <= 0 ? 'bad' : 'warn'}`}>
                              {r.qty <= 0 ? t('alerts.out') : `${fmt.num(r.qty)} ${r.unit}`}
                            </span>
                          </td>
                          <td className="right muted">{fmt.num(r.min_stock)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel title={t('alerts.expiring', { n: d.expiring.length })} sub={t('alerts.expiringSub')} flush>
              {d.expiring.length === 0 ? (
                <Empty icon={<CalendarX2 size={24} />} title={t('alerts.noneExpiring')} />
              ) : (
                <div className="table-wrap" style={{ maxHeight: 460 }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t('common.product')}</th>
                        <th>{t('common.warehouse')}</th>
                        <th>{t('lines.expires')}</th>
                        <th className="right">{t('common.qty')}</th>
                        <th className="right hide-sm">{t('common.value')}</th>
                        {can('stock.writeoff') && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {d.expiring.map((r) => (
                        <tr key={`${r.batch_id}-${r.warehouse_id}`}>
                          <td>
                            <div className="cell-title">{r.name}</div>
                            <div className="cell-sub">
                              {t('lines.batch')} {r.code}
                            </div>
                          </td>
                          <td>{r.warehouse}</td>
                          <td>
                            <span className={`badge ${r.days_left < 0 ? 'bad' : r.days_left <= 7 ? 'warn' : ''}`}>{r.days_left < 0 ? t('alerts.expired', { n: -r.days_left }) : t('alerts.daysLeft', { n: r.days_left })}</span>
                            <div className="cell-sub">{fmt.date(r.expires_at)}</div>
                          </td>
                          <td className="right">
                            {fmt.num(r.qty)} {r.unit}
                          </td>
                          <td className="right hide-sm">{fmt.amount(r.value)}</td>
                          {can('stock.writeoff') && (
                            <td className="right">
                              {r.days_left < 0 && (
                                <button className="btn sm" disabled={writeOff.isPending} onClick={() => writeOff.mutate(r)}>
                                  {t('alerts.writeOff')}
                                </button>
                              )}
                            </td>
                          )}
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
    </>
  );
}
