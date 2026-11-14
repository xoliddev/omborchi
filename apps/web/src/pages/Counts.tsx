import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../components/layout';
import { Empty, Field, Loading, Modal, Panel, StatusBadge } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { categoryOptions } from './Products';

export default function Counts() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['counts.list'], queryFn: () => api.call('counts.list', {}) });
  return (
    <>
      <PageHeader
        title={t('nav.counts')}
        actions={
          can('stock.count') && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              {t('counts.new')}
            </button>
          )
        }
      />
      <div className="content stack">
        <p className="muted small">{t('counts.intro')}</p>
        <Panel flush>
          {!list.data ? (
            <Loading />
          ) : list.data.length === 0 ? (
            <Empty title={t('counts.empty')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('transfers.number')}</th>
                    <th>{t('common.date')}</th>
                    <th>{t('common.warehouse')}</th>
                    <th>{t('common.status')}</th>
                    <th className="right">{t('counts.progress')}</th>
                    <th className="right">{t('counts.net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => nav(`/counts/${r.id}`)}>
                      <td>
                        <div className="cell-title num">{r.number}</div>
                        <div className="cell-sub">{r.category ?? t('counts.wholeWarehouse')}</div>
                      </td>
                      <td className="nowrap">{fmt.dateTime(r.created_at)}</td>
                      <td>{r.warehouse}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="right">
                        {fmt.num(r.counted)} / {fmt.num(r.lines)}
                      </td>
                      <td className="right" style={{ color: r.net_value < 0 ? 'var(--bad)' : undefined }}>
                        {fmt.amount(r.net_value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {creating && <NewCount onClose={() => setCreating(false)} />}
    </>
  );
}

function NewCount({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { me, warehouseId } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const cats = useQuery({ queryKey: ['categories.list'], queryFn: () => api.call('categories.list', {}) });
  const [wh, setWh] = useState(warehouseId);
  const [cat, setCat] = useState('');
  const m = useMutation({
    mutationFn: () => api.call('counts.create', { warehouseId: wh, categoryId: cat || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['counts.list'] });
      nav(`/counts/${r.id}`);
    },
    onError: toast.error,
  });
  return (
    <Modal
      title={t('counts.new')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={() => m.mutate()} disabled={m.isPending}>
            {t('counts.start')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label={t('common.warehouse')}>
          <select className="select" value={wh} onChange={(e) => setWh(e.target.value)}>
            {me.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('common.category')} hint={t('counts.scopeHint')}>
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t('counts.wholeWarehouse')}</option>
            {categoryOptions(cats.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
