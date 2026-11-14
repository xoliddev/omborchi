import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '../components/layout';
import { DebtSummaryTiles, LedgerTable } from '../components/party';
import { ExportButtons } from '../components/pickers';
import { Drawer, Empty, Field, Loading, Modal, Panel } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

export default function Suppliers() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const { id } = useParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const list = useQuery({ queryKey: ['suppliers.list', { q }], queryFn: () => api.call('suppliers.list', { q }), placeholderData: (p) => p });
  const owed = (list.data ?? []).reduce((s, r) => s + Math.max(0, r.balance), 0);
  return (
    <>
      <PageHeader
        title={t('nav.suppliers')}
        actions={
          can('purchasing.edit') && (
            <button className="btn primary" onClick={() => setEditing(true)}>
              <Plus size={15} />
              {t('suppliers.new')}
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
          <span className="grow" />
          <span className="small muted">
            {t('suppliers.totalOwed')}: <b className="num" style={{ color: 'var(--ink)' }}>{fmt.money(owed)}</b>
          </span>
          <ExportButtons
            name="suppliers"
            rows={list.data}
            cols={[
              { header: 'name', value: (r) => r.name },
              { header: 'phone', value: (r) => r.phone },
              { header: 'inn', value: (r) => r.inn },
              { header: 'purchased', value: (r) => r.purchased },
              { header: 'balance', value: (r) => r.balance },
              { header: 'overdue', value: (r) => r.overdue },
            ]}
          />
        </div>
        <Panel flush>
          {!list.data ? (
            <Loading />
          ) : list.data.length === 0 ? (
            <Empty title={t('suppliers.empty')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.supplier')}</th>
                    <th className="right hide-sm">{t('suppliers.purchased')}</th>
                    <th className="right hide-sm">{t('suppliers.openPos')}</th>
                    <th className="right">{t('suppliers.weOwe')}</th>
                    <th className="right">{t('party.overdue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => nav(`/suppliers/${r.id}`)}>
                      <td>
                        <div className="cell-title">{r.name}</div>
                        <div className="cell-sub">
                          {r.contact ?? ''} {r.phone ?? ''}
                        </div>
                      </td>
                      <td className="right hide-sm">{fmt.amount(r.purchased)}</td>
                      <td className="right hide-sm">{r.open_pos || '—'}</td>
                      <td className="right">{fmt.amount(Math.max(0, r.balance))}</td>
                      <td className="right">{r.overdue > 0 ? <span className="badge bad">{fmt.amount(r.overdue)}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {editing && <SupplierForm onClose={() => setEditing(false)} />}
      {id && <SupplierDetail id={id} onClose={() => nav('/suppliers')} />}
    </>
  );
}

function SupplierForm({ onClose, initial }: { onClose: () => void; initial?: { id: string; name: string; phone: string | null; contact: string | null; inn: string | null; address: string | null } }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: initial?.name ?? '', phone: initial?.phone ?? '', contact: initial?.contact ?? '', inn: initial?.inn ?? '', address: initial?.address ?? '' });
  const m = useMutation({
    mutationFn: () => api.call('suppliers.save', { id: initial?.id ?? null, name: f.name, phone: f.phone || null, contact: f.contact || null, inn: f.inn || null, address: f.address || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers.list'] });
      qc.invalidateQueries({ queryKey: ['suppliers.get'] });
      toast.ok(t('common.saved'));
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      title={initial ? t('common.edit') : t('suppliers.new')}
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
        <Field label={t('suppliers.contact')}>
          <input className="input" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
        </Field>
        <Field label={t('common.phone')}>
          <input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label={t('receipt.inn')}>
          <input className="input" inputMode="numeric" value={f.inn} onChange={(e) => setF({ ...f, inn: e.target.value })} />
        </Field>
        <Field label={t('suppliers.address')}>
          <input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function SupplierDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['suppliers.get', { id }], queryFn: () => api.call('suppliers.get', { id }) });
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'transfer' | 'cash' | 'card'>('transfer');
  const [edit, setEdit] = useState(false);
  const pay = useMutation({
    mutationFn: () => api.call('suppliers.pay', { id, amount: Number(amount), method }),
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
      title={s.data?.name ?? '…'}
      onClose={onClose}
      footer={
        can('purchasing.edit') && (
          <button className="btn" onClick={() => setEdit(true)}>
            {t('common.edit')}
          </button>
        )
      }
    >
      {!s.data ? (
        <Loading />
      ) : (
        <div className="stack-lg">
          <p className="muted small">{[s.data.contact, s.data.phone, s.data.inn && `${t('receipt.inn')} ${s.data.inn}`, s.data.address].filter(Boolean).join(' · ')}</p>
          <DebtSummaryTiles summary={s.data.summary} owedLabel={t('suppliers.weOwe')} />
          {can('suppliers.pay') && s.data.summary.balance > 0 && (
            <form
              className="row wrap"
              onSubmit={(e) => {
                e.preventDefault();
                if (Number(amount) > 0) pay.mutate();
              }}
            >
              <input className="input num" style={{ width: 180 }} inputMode="numeric" placeholder={t('common.amount')} value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} aria-label={t('common.amount')} />
              <select className="select" style={{ width: 170 }} value={method} onChange={(e) => setMethod(e.target.value as never)} aria-label={t('common.method')}>
                {(['transfer', 'cash', 'card'] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(`pay.${m}`)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={() => setAmount(String(Math.round(s.data!.summary.balance)))}>
                {t('party.payAll')}
              </button>
              <button className="btn primary" disabled={!(Number(amount) > 0) || pay.isPending}>
                {t('suppliers.pay')}
              </button>
            </form>
          )}
          <h3>{t('party.history')}</h3>
          <LedgerTable entries={s.data.entries} chargeLabel={t('suppliers.delivery')} />
        </div>
      )}
      {edit && s.data && <SupplierForm initial={s.data} onClose={() => setEdit(false)} />}
    </Drawer>
  );
}
