import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/layout';
import { LinesEditor, linesValid, type DocLine } from '../components/lines';
import { Drawer, Empty, Field, Loading, Panel } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

const REASONS = ['damaged', 'expired', 'lost', 'internal_use', 'other'] as const;

export default function WriteOffs() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['writeOffs.list'], queryFn: () => api.call('writeOffs.list', { pageSize: 200 }) });
  return (
    <>
      <PageHeader
        title={t('nav.writeOffs')}
        actions={
          can('stock.writeoff') && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              {t('writeoffs.new')}
            </button>
          )
        }
      />
      <div className="content">
        <Panel flush>
          {!list.data ? (
            <Loading />
          ) : list.data.length === 0 ? (
            <Empty title={t('writeoffs.empty')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('transfers.number')}</th>
                    <th>{t('common.date')}</th>
                    <th>{t('common.warehouse')}</th>
                    <th>{t('common.reason')}</th>
                    <th className="right">{t('common.lines')}</th>
                    <th className="right">{t('writeoffs.loss')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((r) => (
                    <tr key={r.id}>
                      <td className="num cell-title">{r.number}</td>
                      <td className="nowrap">{fmt.dateTime(r.created_at)}</td>
                      <td>{r.warehouse}</td>
                      <td>
                        <span className={`badge ${r.reason === 'expired' ? 'warn' : ''}`}>{t(`reason.${r.reason}` as never)}</span>
                        {r.note && <div className="cell-sub">{r.note}</div>}
                      </td>
                      <td className="right">{r.lines}</td>
                      <td className="right">{fmt.amount(r.total_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {creating && <NewWriteOff onClose={() => setCreating(false)} />}
    </>
  );
}

function NewWriteOff({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { me, warehouseId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [wh, setWh] = useState(warehouseId);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('damaged');
  const [lines, setLines] = useState<DocLine[]>([]);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.call('stock.writeOff', { warehouseId: wh, reason, note: note || null, lines: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty) })) }),
    onSuccess: (r) => {
      toast.ok(t('writeoffs.done', { number: r.number }));
      qc.invalidateQueries();
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Drawer
      wide
      title={t('writeoffs.new')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!linesValid(lines, { checkAvailable: true }) || m.isPending} onClick={() => m.mutate()}>
            {t('writeoffs.post')}
          </button>
        </>
      }
    >
      <div className="stack-lg">
        <div className="form-grid">
          <Field label={t('common.warehouse')}>
            <select className="select" value={wh} onChange={(e) => (setWh(e.target.value), setLines([]))}>
              {me.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('common.reason')}>
            <select className="select" value={reason} onChange={(e) => setReason(e.target.value as never)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`reason.${r}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="small muted">{t('writeoffs.hint')}</p>
        <LinesEditor warehouseId={wh} lines={lines} onChange={setLines} showAvailable />
        <Field label={t('common.note')}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
