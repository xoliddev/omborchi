import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '../components/layout';
import { LinesEditor, linesValid, type DocLine } from '../components/lines';
import { Drawer, Empty, Field, Loading, Panel, Seg, StatusBadge } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

export default function Purchasing() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const { id } = useParams();
  const nav = useNavigate();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['purchaseOrders.list'], queryFn: () => api.call('purchaseOrders.list', {}) });
  const rows = (list.data ?? []).filter((r) => status === 'all' || r.status === 'ordered' || r.status === 'partial');
  return (
    <>
      <PageHeader
        title={t('nav.purchasing')}
        actions={
          can('purchasing.edit') && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              {t('po.new')}
            </button>
          )
        }
      />
      <div className="content">
        <div className="toolbar">
          <Seg
            value={status}
            onChange={setStatus}
            options={[
              { value: 'open', label: t('po.openOnly') },
              { value: 'all', label: t('common.all') },
            ]}
          />
        </div>
        <Panel flush>
          {!list.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty title={t('po.empty')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('transfers.number')}</th>
                    <th>{t('common.supplier')}</th>
                    <th className="hide-sm">{t('common.date')}</th>
                    <th>{t('common.status')}</th>
                    <th className="right">{t('po.received')}</th>
                    <th className="right">{t('common.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => nav(`/purchasing/${r.id}`)}>
                      <td>
                        <div className="cell-title num">{r.number}</div>
                        <div className="cell-sub">{r.warehouse}</div>
                      </td>
                      <td>{r.supplier}</td>
                      <td className="hide-sm nowrap">{fmt.date(r.created_at)}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="right">{r.ordered ? fmt.pct((r.received / r.ordered) * 100, 0) : '—'}</td>
                      <td className="right">{fmt.amount(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {creating && <NewPo onClose={() => setCreating(false)} />}
      {id && <PoDetail id={id} onClose={() => nav('/purchasing')} />}
    </>
  );
}

function NewPo({ onClose }: { onClose: () => void }) {
  const { t, fmt } = useI18n();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const suppliers = useQuery({ queryKey: ['suppliers.list', {}], queryFn: () => api.call('suppliers.list', {}) });
  const central = me.warehouses.find((w) => w.kind === 'warehouse') ?? me.warehouses[0];
  const [supplierId, setSupplierId] = useState('');
  const [wh, setWh] = useState(central.id);
  const [expected, setExpected] = useState(() => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  const [lines, setLines] = useState<DocLine[]>([]);
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
  const m = useMutation({
    mutationFn: () => api.call('purchaseOrders.create', { supplierId, warehouseId: wh, expectedAt: expected, lines: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty), unitCost: Number(l.cost) || 0 })) }),
    onSuccess: (r) => {
      toast.ok(t('po.created', { number: r.number }));
      qc.invalidateQueries({ queryKey: ['purchaseOrders.list'] });
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Drawer
      wide
      title={t('po.new')}
      onClose={onClose}
      footer={
        <>
          <span className="grow muted">
            {t('common.total')}: <b className="num" style={{ color: 'var(--ink)' }}>{fmt.money(total)}</b>
          </span>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!supplierId || !linesValid(lines) || m.isPending} onClick={() => m.mutate()}>
            {t('po.send')}
          </button>
        </>
      }
    >
      <div className="stack-lg">
        <div className="form-grid">
          <Field label={t('common.supplier')}>
            <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('stock.chooseSupplier')}</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('stock.toWarehouse')}>
            <select className="select" value={wh} onChange={(e) => setWh(e.target.value)}>
              {me.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('po.expected')}>
            <input className="input" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </div>
        <LinesEditor warehouseId={wh} lines={lines} onChange={setLines} withCost showAvailable />
      </div>
    </Drawer>
  );
}

function PoDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const po = useQuery({ queryKey: ['purchaseOrders.get', { id }], queryFn: () => api.call('purchaseOrders.get', { id }) });
  const [recv, setRecv] = useState<Record<string, { qty: string; batch: string; exp: string }>>({});
  const [paid, setPaid] = useState('');
  const open = po.data && (po.data.status === 'ordered' || po.data.status === 'partial');
  const m = useMutation({
    mutationFn: () =>
      api.call('purchaseOrders.receive', {
        id,
        paid: Number(paid) || 0,
        method: 'transfer',
        lines: Object.entries(recv)
          .filter(([, v]) => Number(v.qty) > 0)
          .map(([poLineId, v]) => ({ poLineId, qty: Number(v.qty), batchCode: v.batch || null, expiresAt: v.exp || null })),
      }),
    onSuccess: (r) => {
      toast.ok(t('po.receivedToast', { number: r.receiptNumber }));
      setRecv({});
      qc.invalidateQueries();
    },
    onError: toast.error,
  });
  const cancel = useMutation({ mutationFn: () => api.call('purchaseOrders.cancel', { id }), onSuccess: () => qc.invalidateQueries(), onError: toast.error });
  const fillAll = () => po.data && setRecv(Object.fromEntries(po.data.lines.map((l) => [l.id, { qty: String(Math.max(0, l.qty_ordered - l.qty_received)), batch: '', exp: '' }])));
  const any = Object.values(recv).some((v) => Number(v.qty) > 0);
  return (
    <Drawer
      wide
      title={po.data ? `${po.data.number} · ${po.data.supplier}` : '…'}
      onClose={onClose}
      footer={
        open &&
        can('stock.receive') && (
          <>
            {po.data?.status === 'ordered' && can('purchasing.edit') && (
              <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => cancel.mutate()}>
                {t('po.cancel')}
              </button>
            )}
            <button className="btn" onClick={fillAll}>
              {t('po.fillRemaining')}
            </button>
            <button className="btn primary" disabled={!any || m.isPending} onClick={() => m.mutate()}>
              <PackageCheck size={15} />
              {t('po.receive')}
            </button>
          </>
        )
      }
    >
      {!po.data ? (
        <Loading />
      ) : (
        <div className="stack-lg">
          <div className="row wrap">
            <StatusBadge status={po.data.status} />
            <span className="muted small">
              {t('stock.toWarehouse')}: {po.data.warehouse} · {t('po.expected')}: {fmt.date(po.data.expected_at)}
            </span>
          </div>
          <div className="table-wrap panel">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('common.product')}</th>
                  <th className="right">{t('po.ordered')}</th>
                  <th className="right">{t('po.received')}</th>
                  <th className="right">{t('lines.unitCost')}</th>
                  {open && <th style={{ width: 110 }}>{t('po.receiveNow')}</th>}
                  {open && <th style={{ width: 140 }}>{t('lines.expires')}</th>}
                </tr>
              </thead>
              <tbody>
                {po.data.lines.map((l) => {
                  const r = recv[l.id] ?? { qty: '', batch: '', exp: '' };
                  const left = l.qty_ordered - l.qty_received;
                  return (
                    <tr key={l.id}>
                      <td>
                        <div className="cell-title">{l.name}</div>
                        <div className="cell-sub">{l.sku}</div>
                      </td>
                      <td className="right">
                        {fmt.num(l.qty_ordered)} {l.unit}
                      </td>
                      <td className="right">
                        <span className={`badge ${l.qty_received >= l.qty_ordered ? 'good' : l.qty_received > 0 ? 'warn' : ''}`}>{fmt.num(l.qty_received)}</span>
                      </td>
                      <td className="right">{fmt.amount(l.unit_cost)}</td>
                      {open && (
                        <td>
                          <input
                            className="input num"
                            disabled={left <= 0}
                            value={r.qty}
                            placeholder={left > 0 ? fmt.num(left) : '—'}
                            aria-invalid={Number(r.qty) > left}
                            onChange={(e) => setRecv({ ...recv, [l.id]: { ...r, qty: e.target.value.replace(',', '.') } })}
                            aria-label={t('po.receiveNow')}
                          />
                        </td>
                      )}
                      {open && <td>{l.track_expiry ? <input className="input" type="date" value={r.exp} onChange={(e) => setRecv({ ...recv, [l.id]: { ...r, exp: e.target.value } })} aria-label={t('lines.expires')} /> : <span className="muted">—</span>}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {open && (
            <Field label={t('stock.paidNow')} hint={t('stock.paidHint')}>
              <input className="input num" style={{ maxWidth: 220 }} inputMode="numeric" value={paid} placeholder="0" onChange={(e) => setPaid(e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}
          {po.data.receipts.length > 0 && (
            <section className="stack">
              <h3>{t('po.receipts')}</h3>
              {po.data.receipts.map((r) => (
                <div key={r.id} className="row small">
                  <span className="num cell-title">{r.number}</span>
                  <span className="muted grow">{fmt.dateTime(r.created_at)}</span>
                  <span className="num">{fmt.money(r.total)}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
