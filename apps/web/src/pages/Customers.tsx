import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '../components/layout';
import { DebtSummaryTiles, LedgerTable } from '../components/party';
import { ExportButtons } from '../components/pickers';
import { Drawer, Empty, Field, Loading, Modal, Panel, StatusBadge } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

export default function Customers() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const { id } = useParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [withDebt, setWithDebt] = useState(false);
  const [editing, setEditing] = useState(false);
  const list = useQuery({ queryKey: ['customers.list', { q, withDebt }], queryFn: () => api.call('customers.list', { q, withDebt }), placeholderData: (p) => p });
  const totals = (list.data ?? []).reduce((a, r) => ({ balance: a.balance + Math.max(0, r.balance), overdue: a.overdue + r.overdue }), { balance: 0, overdue: 0 });
  return (
    <>
      <PageHeader
        title={t('nav.customers')}
        actions={
          can('customers.edit') && (
            <button className="btn primary" onClick={() => setEditing(true)}>
              <Plus size={15} />
              {t('customers.new')}
            </button>
          )
        }
      />
      <div className="content">
        <div className="toolbar">
          <div className="search" style={{ width: 280 }}>
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('party.search')} aria-label={t('party.search')} />
          </div>
          <label className="check">
            <input type="checkbox" checked={withDebt} onChange={(e) => setWithDebt(e.target.checked)} />
            {t('customers.withDebt')}
          </label>
          <span className="grow" />
          <span className="small muted">
            {t('customers.totalOwed')}: <b className="num" style={{ color: 'var(--ink)' }}>{fmt.money(totals.balance)}</b>
            {totals.overdue > 0 && <> · <span style={{ color: 'var(--bad)' }}>{t('dash.overdue', { v: fmt.money(totals.overdue) })}</span></>}
          </span>
          <ExportButtons
            name="customers"
            rows={list.data}
            cols={[
              { header: 'name', value: (r) => r.name },
              { header: 'phone', value: (r) => r.phone },
              { header: 'sales', value: (r) => r.sales_count },
              { header: 'salesTotal', value: (r) => r.sales_total },
              { header: 'balance', value: (r) => r.balance },
              { header: 'overdue', value: (r) => r.overdue },
              { header: 'nextDue', value: (r) => r.nextDue },
            ]}
          />
        </div>
        <Panel flush>
          {!list.data ? (
            <Loading />
          ) : list.data.length === 0 ? (
            <Empty title={t('customers.empty')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.customer')}</th>
                    <th className="right hide-sm">{t('customers.purchases')}</th>
                    <th className="right">{t('customers.owes')}</th>
                    <th className="right">{t('party.overdue')}</th>
                    <th className="right hide-sm">{t('party.nextDue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => nav(`/customers/${r.id}`)}>
                      <td>
                        <div className="cell-title">{r.name}</div>
                        <div className="cell-sub">{r.phone ?? '—'}</div>
                      </td>
                      <td className="right hide-sm">
                        {fmt.amount(r.sales_total)}
                        <div className="cell-sub">{t('dash.todaySales', { n: r.sales_count })}</div>
                      </td>
                      <td className="right">{r.balance > 0 ? fmt.amount(r.balance) : <span className="muted">—</span>}</td>
                      <td className="right">{r.overdue > 0 ? <span className="badge bad">{fmt.amount(r.overdue)}</span> : <span className="muted">—</span>}</td>
                      <td className="right hide-sm">{r.nextDue ? fmt.date(r.nextDue) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {editing && <CustomerForm onClose={() => setEditing(false)} />}
      {id && <CustomerDetail id={id} onClose={() => nav('/customers')} />}
    </>
  );
}

function CustomerForm({ onClose, initial }: { onClose: () => void; initial?: { id: string; name: string; phone: string | null; note: string | null; credit_limit: number | null } }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: initial?.name ?? '', phone: initial?.phone ?? '', note: initial?.note ?? '', limit: initial?.credit_limit ? String(initial.credit_limit) : '' });
  const m = useMutation({
    mutationFn: () => api.call('customers.save', { id: initial?.id ?? null, name: f.name, phone: f.phone || null, note: f.note || null, creditLimit: f.limit ? Number(f.limit) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers.list'] });
      qc.invalidateQueries({ queryKey: ['customers.get'] });
      toast.ok(t('common.saved'));
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      title={initial ? t('common.edit') : t('customers.new')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!f.name.trim() || m.isPending} onClick={() => m.mutate()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('common.name')} className="span-2">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('common.phone')}>
          <input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+998 90 123 45 67" />
        </Field>
        <Field label={t('customers.creditLimit')} hint={t('customers.creditLimitHint')}>
          <input className="input num" inputMode="numeric" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label={t('common.note')} className="span-2">
          <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function CustomerDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useQuery({ queryKey: ['customers.get', { id }], queryFn: () => api.call('customers.get', { id }) });
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'card' | 'payme' | 'click' | 'uzum'>('cash');
  const [edit, setEdit] = useState(false);
  const pay = useMutation({
    mutationFn: () => api.call('customers.collect', { id, amount: Number(amount), method }),
    onSuccess: () => {
      toast.ok(t('party.paid'));
      setAmount('');
      qc.invalidateQueries();
    },
    onError: toast.error,
  });
  return (
    <Drawer
      wide
      title={c.data?.name ?? '…'}
      onClose={onClose}
      footer={
        can('customers.edit') && (
          <button className="btn" onClick={() => setEdit(true)}>
            {t('common.edit')}
          </button>
        )
      }
    >
      {!c.data ? (
        <Loading />
      ) : (
        <div className="stack-lg">
          <p className="muted small">
            {[c.data.phone, c.data.credit_limit ? `${t('customers.creditLimit')}: ${fmt.money(c.data.credit_limit)}` : null, c.data.note].filter(Boolean).join(' · ')}
          </p>
          <DebtSummaryTiles summary={c.data.summary} owedLabel={t('customers.owes')} />
          {can('customers.collect') && c.data.summary.balance > 0 && (
            <form
              className="row wrap"
              onSubmit={(e) => {
                e.preventDefault();
                if (Number(amount) > 0) pay.mutate();
              }}
            >
              <input className="input num" style={{ width: 180 }} inputMode="numeric" placeholder={t('common.amount')} value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} aria-label={t('common.amount')} />
              <select className="select" style={{ width: 150 }} value={method} onChange={(e) => setMethod(e.target.value as never)} aria-label={t('common.method')}>
                {(['cash', 'card', 'payme', 'click', 'uzum'] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(`pay.${m}`)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={() => setAmount(String(Math.round(c.data!.summary.balance)))}>
                {t('party.payAll')}
              </button>
              <button className="btn primary" disabled={!(Number(amount) > 0) || pay.isPending}>
                {t('customers.collect')}
              </button>
            </form>
          )}
          <h3>{t('party.history')}</h3>
          <LedgerTable entries={c.data.entries} chargeLabel={t('customers.creditSale')} />
          <h3>{t('nav.sales')}</h3>
          {c.data.sales.length === 0 ? (
            <p className="muted">{t('customers.noSales')}</p>
          ) : (
            <div className="table-wrap panel" style={{ maxHeight: 320 }}>
              <table className="data">
                <tbody>
                  {c.data.sales.map((s) => (
                    <tr key={s.id}>
                      <td className="num">
                        <Link to={`/sales/${s.id}`}>{s.number}</Link>
                      </td>
                      <td className="nowrap">{fmt.dateTime(s.created_at)}</td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="right">{fmt.amount(s.total)}</td>
                      <td className="right">{s.debt > 0 ? <span className="badge warn">{fmt.amount(s.debt)}</span> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {edit && c.data && <CustomerForm initial={c.data} onClose={() => setEdit(false)} />}
    </Drawer>
  );
}
