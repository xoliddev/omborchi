import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '../components/layout';
import { Empty, Loading, Pager, Panel } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';

const ENTITIES = ['sale', 'goods_receipt', 'transfer', 'write_off', 'inventory_count', 'purchase_order', 'product', 'customer', 'supplier', 'shift', 'membership'];

export default function Audit() {
  const { t, fmt } = useI18n();
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const input = { entity: entity || undefined, page, pageSize: 50 };
  const q = useQuery({ queryKey: ['audit.list', input], queryFn: () => api.call('audit.list', input), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title={t('nav.audit')} />
      <div className="content">
        <div className="toolbar">
          <select className="select" style={{ width: 240 }} value={entity} onChange={(e) => (setEntity(e.target.value), setPage(1))} aria-label={t('audit.entity')}>
            <option value="">{t('audit.allEntities')}</option>
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {t(`entity.${e}` as never)}
              </option>
            ))}
          </select>
          <span className="small muted">{t('audit.hint')}</span>
        </div>
        <Panel flush>
          {!q.data ? (
            <Loading />
          ) : q.data.rows.length === 0 ? (
            <Empty title={t('common.noData')} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('common.date')}</th>
                      <th>{t('common.user')}</th>
                      <th>{t('audit.action')}</th>
                      <th className="hide-sm">{t('audit.details')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.rows.map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        <td className="nowrap num">{fmt.dateTime(r.created_at)}</td>
                        <td>{r.user_name ?? '—'}</td>
                        <td>
                          <span className="badge">{r.action}</span>
                          <div className="cell-sub">{r.entity ? t(`entity.${r.entity}` as never) : ''}</div>
                        </td>
                        <td className="hide-sm">
                          {open === r.id ? (
                            <pre className="small" style={{ margin: 0, whiteSpace: 'pre-wrap', maxWidth: 560 }}>
                              {JSON.stringify(r.payload, null, 2)}
                            </pre>
                          ) : (
                            <span className="small muted ellipsis" style={{ display: 'block', maxWidth: 520 }}>
                              {JSON.stringify(r.payload)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={50} total={q.data.total} onPage={setPage} />
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
