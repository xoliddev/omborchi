import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/layout';
import { LinesEditor, linesValid, type DocLine } from '../components/lines';
import { Drawer, Empty, Field, Loading, Panel } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

export default function Transfers() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['transfers.list'], queryFn: () => api.call('transfers.list', { pageSize: 200 }) });
  return (
    <>
      <PageHeader
        title={t('nav.transfers')}
        actions={
          can('stock.transfer') && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              {t('transfers.new')}
            </button>
          )
        }
      />
      <div className="content">
        <Panel flush>
          {!list.data ? (
            <Loading />
          ) : list.data.length === 0 ? (
            <Empty title={t('transfers.empty')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('transfers.number')}</th>
                    <th>{t('common.date')}</th>
                    <th>{t('transfers.route')}</th>
                    <th className="right">{t('common.lines')}</th>
                    <th className="right hide-sm">{t('common.value')}</th>
                    <th className="hide-sm">{t('common.user')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((r) => (
                    <tr key={r.id}>
                      <td className="num cell-title">{r.number}</td>
                      <td className="nowrap">{fmt.dateTime(r.created_at)}</td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          {r.from_name} <ArrowRight size={13} className="muted" /> {r.to_name}
                        </span>
                      </td>
                      <td className="right">{r.lines}</td>
                      <td className="right hide-sm">{fmt.amount(r.value)}</td>
                      <td className="hide-sm ink2">{r.user_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {creating && <NewTransfer onClose={() => setCreating(false)} />}
    </>
  );
}

function NewTransfer({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { me, warehouseId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const central = me.warehouses.find((w) => w.kind === 'warehouse');
  const [from, setFrom] = useState(central?.id ?? warehouseId);
  const [to, setTo] = useState(me.warehouses.find((w) => w.id !== (central?.id ?? warehouseId))?.id ?? '');
  const [lines, setLines] = useState<DocLine[]>([]);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.call('stock.transfer', { fromWarehouseId: from, toWarehouseId: to, note: note || null, lines: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty) })) }),
    onSuccess: (r) => {
      toast.ok(t('transfers.done', { number: r.number }));
      qc.invalidateQueries();
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Drawer
      wide
      title={t('transfers.new')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!to || from === to || !linesValid(lines, { checkAvailable: true }) || m.isPending} onClick={() => m.mutate()}>
            {t('transfers.post')}
          </button>
        </>
      }
    >
      <div className="stack-lg">
        <div className="form-grid">
          <Field label={t('common.from')}>
            <select className="select" value={from} onChange={(e) => (setFrom(e.target.value), setLines([]))}>
              {me.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('common.to')}>
            <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
              {me.warehouses
                .filter((w) => w.id !== from)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <p className="small muted">{t('transfers.hint')}</p>
        <LinesEditor warehouseId={from} lines={lines} onChange={setLines} showAvailable />
        <Field label={t('common.note')}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
