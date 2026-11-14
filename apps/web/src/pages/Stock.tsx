import { MOVEMENT_KINDS } from '@omborchi/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, Search } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/layout';
import { LinesEditor, linesValid, type DocLine } from '../components/lines';
import { ExportButtons, RangeControl, useRange } from '../components/pickers';
import { Drawer, Empty, Field, Loading, Pager, Panel, Tabs } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

export default function Stock() {
  const { t } = useI18n();
  const { can } = useSession();
  const [tab, setTab] = useState<'balances' | 'movements' | 'receipts'>('balances');
  const [receiving, setReceiving] = useState(false);
  return (
    <>
      <PageHeader
        title={t('nav.stock')}
        actions={
          can('stock.receive') && (
            <button className="btn primary" onClick={() => setReceiving(true)}>
              <PackagePlus size={15} />
              {t('stock.receive')}
            </button>
          )
        }
      />
      <div className="content">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'balances', label: t('stock.balances') },
            { value: 'movements', label: t('stock.ledger') },
            { value: 'receipts', label: t('stock.receipts') },
          ]}
        />
        {tab === 'balances' && <Balances />}
        {tab === 'movements' && <Movements />}
        {tab === 'receipts' && <Receipts />}
      </div>
      {receiving && <ReceiveDrawer onClose={() => setReceiving(false)} />}
    </>
  );
}

function Balances() {
  const { t, fmt } = useI18n();
  const { warehouseId } = useSession();
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [page, setPage] = useState(1);
  const input = { warehouseId, q, onlyLow, nonZero: !onlyLow, page, pageSize: 50 };
  const list = useQuery({ queryKey: ['stock.balances', input], queryFn: () => api.call('stock.balances', input), placeholderData: (p) => p });
  return (
    <>
      <div className="toolbar">
        <div className="search" style={{ width: 280 }}>
          <Search size={16} />
          <input className="input" placeholder={t('products.search')} value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} aria-label={t('products.search')} />
        </div>
        <label className="check">
          <input type="checkbox" checked={onlyLow} onChange={(e) => (setOnlyLow(e.target.checked), setPage(1))} />
          {t('products.lowOnly')}
        </label>
        <span className="grow" />
        {list.data && (
          <span className="small muted">
            {t('stock.totalValue')}: <b className="num" style={{ color: 'var(--ink)' }}>{fmt.money(list.data.totals.value)}</b>
          </span>
        )}
        <ExportButtons
          name="stock"
          rows={list.data?.rows}
          cols={[
            { header: 'warehouse', value: (r) => r.warehouse },
            { header: 'name', value: (r) => r.name },
            { header: 'sku', value: (r) => r.sku },
            { header: 'qty', value: (r) => r.qty },
            { header: 'unit', value: (r) => r.unit },
            { header: 'avgCost', value: (r) => r.avg_cost },
            { header: 'value', value: (r) => r.value },
          ]}
        />
      </div>
      <Panel flush>
        {!list.data ? (
          <Loading />
        ) : list.data.rows.length === 0 ? (
          <Empty title={t('stock.empty')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.product')}</th>
                    <th className="right">{t('common.qty')}</th>
                    <th className="right hide-sm">{t('products.minStock')}</th>
                    <th className="right">{t('products.avgCost')}</th>
                    <th className="right hide-sm">{t('common.value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((r) => (
                    <tr key={`${r.warehouse_id}-${r.variant_id}`}>
                      <td>
                        <div className="cell-title">{r.name}</div>
                        <div className="cell-sub">
                          {r.sku} · {r.warehouse}
                        </div>
                      </td>
                      <td className="right">
                        <span className={r.min_stock > 0 && r.qty <= r.min_stock ? 'badge warn' : ''}>
                          {fmt.num(r.qty)} {r.unit}
                        </span>
                      </td>
                      <td className="right hide-sm muted">{fmt.num(r.min_stock)}</td>
                      <td className="right">{fmt.amount(r.avg_cost)}</td>
                      <td className="right hide-sm">{fmt.amount(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={50} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}

function Movements() {
  const { t, fmt } = useI18n();
  const { warehouseId } = useSession();
  const range = useRange('7d');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const input = { warehouseId, kind: (kind || undefined) as never, ...range.range, page, pageSize: 50 };
  const list = useQuery({ queryKey: ['stock.movements', input], queryFn: () => api.call('stock.movements', input), placeholderData: (p) => p });
  return (
    <>
      <div className="toolbar">
        <RangeControl state={range} />
        <select className="select" style={{ width: 200 }} value={kind} onChange={(e) => (setKind(e.target.value), setPage(1))} aria-label={t('stock.kind')}>
          <option value="">{t('stock.allKinds')}</option>
          {MOVEMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}` as never)}
            </option>
          ))}
        </select>
        <span className="grow" />
        <ExportButtons
          name="stock-ledger"
          rows={list.data?.rows}
          cols={[
            { header: 'date', value: (r) => r.created_at },
            { header: 'kind', value: (r) => r.kind },
            { header: 'warehouse', value: (r) => r.warehouse },
            { header: 'name', value: (r) => r.name },
            { header: 'qty', value: (r) => r.qty },
            { header: 'unitCost', value: (r) => r.unit_cost },
            { header: 'value', value: (r) => r.cost_value },
            { header: 'batch', value: (r) => r.batch },
            { header: 'user', value: (r) => r.user_name },
          ]}
        />
      </div>
      <p className="small muted" style={{ marginBottom: 10 }}>
        {t('stock.ledgerHint')}
      </p>
      <Panel flush>
        {!list.data ? (
          <Loading />
        ) : list.data.rows.length === 0 ? (
          <Empty title={t('common.noData')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('stock.kind')}</th>
                    <th>{t('common.product')}</th>
                    <th className="right">{t('common.qty')}</th>
                    <th className="right hide-sm">{t('lines.unitCost')}</th>
                    <th className="right hide-sm">{t('common.value')}</th>
                    <th className="hide-sm">{t('common.user')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap num">{fmt.dateTime(r.created_at)}</td>
                      <td>
                        <span className={`badge ${r.qty > 0 ? 'good' : ''}`}>{t(`kind.${r.kind}` as never)}</span>
                      </td>
                      <td>
                        <div className="cell-title">{r.name}</div>
                        <div className="cell-sub">
                          {r.warehouse}
                          {r.batch ? ` · ${t('lines.batch')} ${r.batch}` : ''}
                        </div>
                      </td>
                      <td className="right" style={{ color: r.qty > 0 ? 'var(--good)' : undefined }}>
                        {r.qty > 0 ? '+' : ''}
                        {fmt.num(r.qty)} {r.unit}
                      </td>
                      <td className="right hide-sm">{fmt.amount(r.unit_cost)}</td>
                      <td className="right hide-sm">{fmt.amount(r.cost_value)}</td>
                      <td className="hide-sm ink2">{r.user_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={50} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}

function Receipts() {
  const { t, fmt } = useI18n();
  const { warehouseId } = useSession();
  const list = useQuery({ queryKey: ['receipts.list', { warehouseId }], queryFn: () => api.call('receipts.list', { warehouseId, pageSize: 100 }) });
  return (
    <Panel flush>
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <Empty title={t('stock.noReceipts')} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('stock.receiptNo')}</th>
                <th>{t('common.date')}</th>
                <th>{t('common.supplier')}</th>
                <th className="right">{t('common.lines')}</th>
                <th className="right">{t('common.total')}</th>
                <th className="right hide-sm">{t('pos.paid')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td className="num">
                    <div className="cell-title">{r.number}</div>
                    {r.po_number && <div className="cell-sub">{r.po_number}</div>}
                  </td>
                  <td className="nowrap">{fmt.dateTime(r.created_at)}</td>
                  <td>{r.supplier}</td>
                  <td className="right">{r.lines}</td>
                  <td className="right">{fmt.amount(r.total)}</td>
                  <td className="right hide-sm">{fmt.amount(r.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ReceiveDrawer({ onClose }: { onClose: () => void }) {
  const { t, fmt } = useI18n();
  const { warehouseId, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const suppliers = useQuery({ queryKey: ['suppliers.list', {}], queryFn: () => api.call('suppliers.list', {}) });
  const [wh, setWh] = useState(warehouseId);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<DocLine[]>([]);
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('transfer');
  const [due, setDue] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
  const m = useMutation({
    mutationFn: () =>
      api.call('stock.receive', {
        supplierId,
        warehouseId: wh,
        lines: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty), unitCost: Number(l.cost) || 0, batchCode: l.batchCode || null, expiresAt: l.expiresAt || null })),
        paid: Number(paid) || 0,
        method,
        dueDate: due,
      }),
    onSuccess: (r) => {
      toast.ok(t('stock.received', { number: r.number }));
      qc.invalidateQueries();
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Drawer
      wide
      title={t('stock.receive')}
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
            {t('stock.post')}
          </button>
        </>
      }
    >
      <div className="stack-lg">
        <div className="form-grid">
          <Field label={t('common.supplier')}>
            <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
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
        </div>
        <LinesEditor warehouseId={wh} lines={lines} onChange={setLines} withCost withBatch />
        <div className="form-grid">
          <Field label={t('stock.paidNow')} hint={t('stock.paidHint')}>
            <input className="input num" inputMode="numeric" value={paid} placeholder="0" onChange={(e) => setPaid(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label={t('common.method')}>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as never)}>
              {(['transfer', 'cash', 'card'] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`pay.${x}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('stock.payBy')}>
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
      </div>
    </Drawer>
  );
}
