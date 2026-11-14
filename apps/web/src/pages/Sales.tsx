import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Search, Share2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '../components/layout';
import { ExportButtons, RangeControl, useRange } from '../components/pickers';
import { printReceipt, Receipt, shareReceipt } from '../components/Receipt';
import { Drawer, Empty, Field, Loading, Modal, Pager, Panel, StatusBadge } from '../components/ui';
import { useI18n } from '../i18n';
import { api, type Out } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

export default function Sales() {
  const { t, fmt } = useI18n();
  const { warehouseId } = useSession();
  const { id } = useParams();
  const nav = useNavigate();
  const range = useRange('7d');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const input = { warehouseId, q, ...range.range, page, pageSize: 50 };
  const list = useQuery({ queryKey: ['sales.list', input], queryFn: () => api.call('sales.list', input), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title={t('nav.sales')} />
      <div className="content">
        <div className="toolbar">
          <RangeControl state={range} />
          <div className="search" style={{ width: 240 }}>
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder={t('sales.search')} aria-label={t('sales.search')} />
          </div>
          <span className="grow" />
          <ExportButtons
            name="sales"
            rows={list.data?.rows}
            cols={[
              { header: 'number', value: (r) => r.number },
              { header: 'date', value: (r) => r.created_at },
              { header: 'warehouse', value: (r) => r.warehouse },
              { header: 'cashier', value: (r) => r.cashier },
              { header: 'customer', value: (r) => r.customer },
              { header: 'total', value: (r) => r.total },
              { header: 'paid', value: (r) => r.paid },
              { header: 'debt', value: (r) => r.debt },
              { header: 'methods', value: (r) => r.methods.join('+') },
              { header: 'status', value: (r) => r.status },
            ]}
          />
        </div>
        <Panel flush>
          {!list.data ? (
            <Loading />
          ) : list.data.rows.length === 0 ? (
            <Empty title={t('sales.empty')} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('receipt.number')}</th>
                      <th>{t('common.date')}</th>
                      <th className="hide-sm">{t('receipt.cashier')}</th>
                      <th className="hide-sm">{t('common.customer')}</th>
                      <th>{t('common.method')}</th>
                      <th className="right">{t('common.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.rows.map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => nav(`/sales/${r.id}`)}>
                        <td>
                          <div className="cell-title num">{r.number}</div>
                          <div className="cell-sub">{r.warehouse}</div>
                        </td>
                        <td className="nowrap num">{fmt.dateTime(r.created_at)}</td>
                        <td className="hide-sm ink2">{r.cashier}</td>
                        <td className="hide-sm ink2">{r.customer ?? '—'}</td>
                        <td>
                          <span className="row" style={{ gap: 4 }}>
                            {r.methods.map((m) => (
                              <span key={m} className="badge">
                                {t(`pay.${m}` as never)}
                              </span>
                            ))}
                            {r.debt > 0 && <span className="badge warn">{t('pay.nasiya')}</span>}
                            {r.status !== 'completed' && <StatusBadge status={r.status} />}
                          </span>
                        </td>
                        <td className="right">{fmt.amount(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={50} total={list.data.total} onPage={setPage} />
            </>
          )}
        </Panel>
      </div>
      {id && <SaleDrawer id={id} onClose={() => nav('/sales')} />}
    </>
  );
}

function SaleDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const { can, me } = useSession();
  const toast = useToast();
  const sale = useQuery({ queryKey: ['sales.get', { id }], queryFn: () => api.call('sales.get', { id }) });
  const [returning, setReturning] = useState(false);
  const s = sale.data;
  return (
    <Drawer
      wide
      title={s ? `${t('receipt.number')} ${s.number}` : '…'}
      onClose={onClose}
      footer={
        s && (
          <>
            {can('sales.return') && s.status !== 'returned' && (
              <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setReturning(true)}>
                <Undo2 size={15} />
                {t('sales.return')}
              </button>
            )}
            <button className="btn" onClick={() => printReceipt(s.id, 58)}>
              <Printer size={15} />
              58 mm
            </button>
            <button className="btn" onClick={() => printReceipt(s.id, 80)}>
              <Printer size={15} />
              80 mm
            </button>
            <button className="btn" onClick={async () => toast.ok((await shareReceipt(s, fmt, t)) === 'copied' ? t('receipt.copied') : t('receipt.shared'))}>
              <Share2 size={15} />
              {t('receipt.share')}
            </button>
          </>
        )
      }
    >
      {!s ? (
        <Loading />
      ) : (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <div className="row wrap">
              <StatusBadge status={s.status} />
              <span className="small muted">
                {s.warehouse} · {s.cashier} · {t('pos.shift')} {s.shift_number}
              </span>
            </div>
            <table className="data">
              <tbody>
                <tr>
                  <td>{t('pos.total')}</td>
                  <td className="right">
                    <b>{fmt.money(s.total)}</b>
                  </td>
                </tr>
                {can('reports.view') && (
                  <tr>
                    <td>{t('dash.grossProfit')}</td>
                    <td className="right">
                      {fmt.money(s.total - s.cost_total)} <span className="muted small">({fmt.pct(s.total ? ((s.total - s.cost_total) / s.total) * 100 : 0)})</span>
                    </td>
                  </tr>
                )}
                {s.debt > 0 && (
                  <tr>
                    <td>{t('pos.debt')}</td>
                    <td className="right">
                      {fmt.money(s.debt)} · {t('pos.due')} {fmt.date(s.due_date)}
                    </td>
                  </tr>
                )}
                {s.returned_total > 0 && (
                  <tr>
                    <td>{t('sales.returned')}</td>
                    <td className="right">{fmt.money(s.returned_total)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {s.returns.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <h3>{t('sales.returns')}</h3>
                {s.returns.map((r) => (
                  <div key={r.id} className="row small">
                    <span className="num cell-title">{r.number}</span>
                    <span className="muted grow">
                      {fmt.dateTime(r.created_at)} · {t(`pay.${r.refund_method}` as never)} {r.reason ? `· ${r.reason}` : ''}
                    </span>
                    <span className="num">{fmt.money(r.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ background: '#fff', borderRadius: 8, padding: '10px 0', border: '1px solid var(--line)' }}>
            <Receipt sale={s} settings={me.org.settings} />
          </div>
        </div>
      )}
      {returning && s && <ReturnModal sale={s} onClose={() => setReturning(false)} />}
    </Drawer>
  );
}

function ReturnModal({ sale, onClose }: { sale: Out<'sales.get'>; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<'cash' | 'card' | 'debt'>(sale.debt > 0 ? 'debt' : 'cash');
  const [reason, setReason] = useState('');
  const amount = sale.lines.reduce((s, l) => s + (Number(qty[l.id]) || 0) * (l.total / l.base_qty), 0);
  const m = useMutation({
    mutationFn: () =>
      api.call('sales.return', {
        id: sale.id,
        refundMethod: method,
        reason: reason || null,
        lines: Object.entries(qty)
          .filter(([, v]) => Number(v) > 0)
          .map(([saleLineId, v]) => ({ saleLineId, qty: Number(v) })),
      }),
    onSuccess: (r) => {
      toast.ok(t('sales.returnedToast', { number: r.number, v: fmt.money(r.total) }));
      qc.invalidateQueries();
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      wide
      title={t('sales.return')}
      onClose={onClose}
      footer={
        <>
          <span className="grow">
            {t('sales.refund')}: <b className="num">{fmt.money(amount)}</b>
          </span>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={amount <= 0 || m.isPending} onClick={() => m.mutate()}>
            {t('sales.confirmReturn')}
          </button>
        </>
      }
    >
      <div className="stack">
        <table className="data">
          <thead>
            <tr>
              <th>{t('common.product')}</th>
              <th className="right">{t('sales.sold')}</th>
              <th style={{ width: 120 }}>{t('sales.returnQty')}</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((l) => {
              const left = l.base_qty - l.returned_qty;
              return (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td className="right">
                    {fmt.num(left)} / {fmt.num(l.base_qty)}
                  </td>
                  <td>
                    <input className="input num" disabled={left <= 0} value={qty[l.id] ?? ''} placeholder="0" aria-invalid={Number(qty[l.id]) > left} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(',', '.') })} aria-label={t('sales.returnQty')} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="form-grid">
          <Field label={t('sales.refundHow')}>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as never)}>
              <option value="cash">{t('pay.cash')}</option>
              <option value="card">{t('pay.card')}</option>
              {sale.customer_id && <option value="debt">{t('pay.debt')}</option>}
            </select>
          </Field>
          <Field label={t('common.reason')}>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
