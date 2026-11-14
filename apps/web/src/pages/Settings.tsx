import { ROLES, permissionsFor, type Role } from '@omborchi/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/layout';
import { Field, Loading, Modal, Panel, Tabs } from '../components/ui';
import { useI18n, type Key } from '../i18n';
import { api, IS_DEMO, type Out } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

export default function Settings() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'users' | 'warehouses' | 'org'>('users');
  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className="content">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'users', label: t('settings.users') },
            { value: 'warehouses', label: t('settings.warehouses') },
            { value: 'org', label: t('settings.org') },
          ]}
        />
        {tab === 'users' && <Users />}
        {tab === 'warehouses' && <Warehouses />}
        {tab === 'org' && <Org />}
      </div>
    </>
  );
}

type Member = Out<'users.list'>[number];

function Users() {
  const { t } = useI18n();
  const { me } = useSession();
  const q = useQuery({ queryKey: ['users.list'], queryFn: () => api.call('users.list', {}) });
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const whName = (id: string) => me.warehouses.find((w) => w.id === id)?.name ?? '—';
  return (
    <div className="stack-lg">
      <Panel
        title={t('settings.team')}
        sub={t('settings.teamSub')}
        flush
        actions={
          <button className="btn primary sm" onClick={() => setEditing('new')}>
            <Plus size={14} />
            {t('settings.addUser')}
          </button>
        }
      >
        {!q.data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('settings.role')}</th>
                  <th>{t('settings.access')}</th>
                  <th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((u) => (
                  <tr key={u.membership_id} className="clickable" onClick={() => setEditing(u)}>
                    <td>
                      <div className="cell-title">{u.name}</div>
                      <div className="cell-sub">{u.email}</div>
                    </td>
                    <td>{t(`role.${u.role}` as Key)}</td>
                    <td className="ink2">{u.all_warehouses || u.role === 'owner' ? t('settings.allWarehouses') : u.warehouse_ids.map(whName).join(', ')}</td>
                    <td>{u.is_active ? <span className="badge good">{t('common.active')}</span> : <span className="badge">{t('settings.disabled')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={t('settings.matrix')} sub={t('settings.matrixSub')} flush>
        <RoleMatrix />
      </Panel>
      {editing && <UserForm member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const MATRIX_ROWS: { key: Key; perms: string[] }[] = [
  { key: 'perm.sell', perms: ['sales.create'] },
  { key: 'perm.discount', perms: ['sales.discount'] },
  { key: 'perm.returns', perms: ['sales.return'] },
  { key: 'perm.catalog', perms: ['catalog.edit'] },
  { key: 'perm.receive', perms: ['stock.receive'] },
  { key: 'perm.transfer', perms: ['stock.transfer'] },
  { key: 'perm.count', perms: ['stock.count'] },
  { key: 'perm.purchasing', perms: ['purchasing.edit'] },
  { key: 'perm.reports', perms: ['reports.view'] },
  { key: 'perm.users', perms: ['users.manage'] },
];

function RoleMatrix() {
  const { t } = useI18n();
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th />
            {ROLES.map((r) => (
              <th key={r} className="right">
                {t(`role.${r}` as Key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATRIX_ROWS.map((row) => (
            <tr key={row.key}>
              <td>{t(row.key)}</td>
              {ROLES.map((r) => (
                <td key={r} className="right">
                  {row.perms.every((p) => (permissionsFor(r) as string[]).includes(p)) ? <span className="badge good">✓</span> : <span className="muted">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserForm({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: member?.name ?? '',
    email: member?.email ?? '',
    password: '',
    role: (member?.role ?? 'cashier') as Role,
    all: member ? member.all_warehouses : false,
    whs: member?.warehouse_ids ?? [],
    active: member?.is_active ?? true,
  });
  const m = useMutation({
    mutationFn: () =>
      api.call('users.save', {
        membershipId: member?.membership_id ?? null,
        name: f.name,
        email: f.email,
        password: f.password || undefined,
        role: f.role,
        warehouseIds: f.all || f.role === 'owner' ? null : f.whs,
        isActive: f.active,
      }),
    onSuccess: () => {
      toast.ok(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['users.list'] });
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      title={member ? member.name : t('settings.addUser')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={m.isPending || !f.name || !f.email} onClick={() => m.mutate()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        {IS_DEMO && <div className="callout">{t('settings.demoUsers')}</div>}
        <div className="form-grid">
          <Field label={t('common.name')}>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={t('auth.email')}>
            <input className="input" type="email" disabled={!!member} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label={member ? t('settings.newPassword') : t('auth.password')} hint={t('auth.passwordHint')}>
            <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <Field label={t('settings.role')}>
            <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}` as Key)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {f.role !== 'owner' && (
          <div className="stack" style={{ gap: 8 }}>
            <label className="check">
              <input type="checkbox" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} />
              {t('settings.allWarehouses')}
            </label>
            {!f.all &&
              me.warehouses.map((w) => (
                <label key={w.id} className="check" style={{ marginLeft: 22 }}>
                  <input type="checkbox" checked={f.whs.includes(w.id)} onChange={(e) => setF({ ...f, whs: e.target.checked ? [...f.whs, w.id] : f.whs.filter((x) => x !== w.id) })} />
                  {w.name}
                </label>
              ))}
          </div>
        )}
        {member && (
          <label className="check">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            {t('settings.activeUser')}
          </label>
        )}
      </div>
    </Modal>
  );
}

function Warehouses() {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['warehouses.list'], queryFn: () => api.call('warehouses.list', { all: true }) });
  const [form, setForm] = useState<{ id?: string; name: string; code: string; kind: 'store' | 'warehouse'; address: string; isActive: boolean } | null>(null);
  const m = useMutation({
    mutationFn: () => api.call('warehouses.save', { id: form!.id ?? null, name: form!.name, code: form!.code, kind: form!.kind, address: form!.address || null, isActive: form!.isActive }),
    onSuccess: () => {
      qc.invalidateQueries();
      setForm(null);
    },
    onError: toast.error,
  });
  return (
    <Panel
      title={t('settings.warehouses')}
      sub={t('settings.warehousesSub')}
      flush
      actions={
        <button className="btn primary sm" onClick={() => setForm({ name: '', code: '', kind: 'store', address: '', isActive: true })}>
          <Plus size={14} />
          {t('common.add')}
        </button>
      }
    >
      {!q.data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('settings.kind')}</th>
                <th className="right">{t('products.inStock')}</th>
                <th className="right">{t('dash.stockValue')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((w) => (
                <tr key={w.id} className="clickable" onClick={() => setForm({ id: w.id, name: w.name, code: w.code, kind: w.kind as 'store', address: w.address ?? '', isActive: w.is_active })}>
                  <td>
                    <div className="cell-title">
                      {w.name} <span className="muted num">{w.code}</span>
                    </div>
                    <div className="cell-sub">{w.address}</div>
                  </td>
                  <td>{t(`settings.kind.${w.kind}` as Key)}</td>
                  <td className="right">{fmt.num(w.skus)}</td>
                  <td className="right">{fmt.amount(w.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <Modal
          title={form.id ? form.name : t('settings.newWarehouse')}
          onClose={() => setForm(null)}
          footer={
            <button className="btn primary" disabled={!form.name || !form.code || m.isPending} onClick={() => m.mutate()}>
              {t('common.save')}
            </button>
          }
        >
          <div className="form-grid">
            <Field label={t('common.name')}>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('settings.code')}>
              <input className="input" value={form.code} maxLength={16} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t('settings.kind')}>
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as never })}>
                <option value="store">{t('settings.kind.store')}</option>
                <option value="warehouse">{t('settings.kind.warehouse')}</option>
              </select>
            </Field>
            <Field label={t('suppliers.address')}>
              <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function Org() {
  const { t } = useI18n();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const s = me.org.settings as Record<string, string | undefined>;
  const [f, setF] = useState({ name: me.org.name, phone: s.phone ?? '', inn: s.inn ?? '', receiptFooter: s.receiptFooter ?? '' });
  const m = useMutation({
    mutationFn: () => api.call('org.update', { name: f.name, settings: { phone: f.phone, inn: f.inn, receiptFooter: f.receiptFooter } }),
    onSuccess: () => {
      toast.ok(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: toast.error,
  });
  return (
    <Panel title={t('settings.org')} sub={t('settings.orgSub')}>
      <form
        className="stack"
        style={{ maxWidth: 620 }}
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="form-grid">
          <Field label={t('auth.orgName')} className="span-2">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={t('common.phone')}>
            <input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label={t('receipt.inn')}>
            <input className="input" value={f.inn} onChange={(e) => setF({ ...f, inn: e.target.value })} />
          </Field>
          <Field label={t('settings.footer')} className="span-2">
            <input className="input" value={f.receiptFooter} onChange={(e) => setF({ ...f, receiptFooter: e.target.value })} />
          </Field>
        </div>
        <div className="row">
          <button className="btn primary" disabled={m.isPending}>
            {t('common.save')}
          </button>
          <span className="small muted">{t('settings.costing')}</span>
        </div>
      </form>
    </Panel>
  );
}
