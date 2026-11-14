import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, FolderTree, Plus, Printer, Search, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/layout';
import { ExportButtons } from '../components/pickers';
import { BarcodeSvg } from '../components/Receipt';
import { Drawer, Empty, Field, Loading, Modal, Pager, Panel } from '../components/ui';
import { useI18n } from '../i18n';
import { api, type Out } from '../lib/api';
import { downloadTemplate, readSpreadsheet } from '../lib/export';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

type Category = Out<'categories.list'>[number];

export function categoryOptions(cats: Category[]): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const c of cats.filter((x) => x.parent_id === parent)) {
      out.push({ id: c.id, label: `${prefix}${c.name}`, depth });
      walk(c.id, depth + 1, `${prefix}${c.name} / `);
    }
  };
  walk(null, 0, '');
  return out;
}

export default function Products() {
  const { t, fmt } = useI18n();
  const { can, warehouseId } = useSession();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [scope, setScope] = useState<'here' | 'all'>('all');
  const [lowStock, setLowStock] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<{ col: 'name' | 'stock_qty' | 'stock_value' | 'price'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [modal, setModal] = useState<null | 'import' | 'categories'>(null);
  const cats = useQuery({ queryKey: ['categories.list'], queryFn: () => api.call('categories.list', {}) });
  const input = { q, categoryId: categoryId || null, warehouseId: scope === 'here' ? warehouseId : null, lowStock, archived, sort: sort.col, dir: sort.dir, page, pageSize: 50 };
  const list = useQuery({ queryKey: ['products.list', input], queryFn: () => api.call('products.list', input), placeholderData: (p) => p });
  const options = useMemo(() => categoryOptions(cats.data ?? []), [cats.data]);
  const sortBy = (col: typeof sort.col) => setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : col === 'name' ? 'asc' : 'desc' }));
  const arrow = (col: typeof sort.col) => (sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <>
      <PageHeader
        title={t('nav.products')}
        actions={
          can('catalog.edit') && (
            <span className="row">
              <button className="btn hide-sm" onClick={() => setModal('categories')}>
                <FolderTree size={15} />
                {t('products.categories')}
              </button>
              <button className="btn hide-sm" onClick={() => setModal('import')}>
                <Upload size={15} />
                {t('products.import')}
              </button>
              <button className="btn primary" onClick={() => setEditing('new')}>
                <Plus size={15} />
                {t('products.new')}
              </button>
            </span>
          )
        }
      />
      <div className="content">
        <div className="toolbar">
          <div className="search" style={{ width: 280 }}>
            <Search size={16} />
            <input className="input" placeholder={t('products.search')} value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} aria-label={t('products.search')} />
          </div>
          <select className="select" style={{ width: 240 }} value={categoryId} onChange={(e) => (setCategoryId(e.target.value), setPage(1))} aria-label={t('common.category')}>
            <option value="">{t('products.allCategories')}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {' '.repeat(o.depth)}
                {o.label.split(' / ').pop()}
              </option>
            ))}
          </select>
          <div className="seg">
            <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
              {t('products.allWarehouses')}
            </button>
            <button aria-pressed={scope === 'here'} onClick={() => setScope('here')}>
              {t('products.thisWarehouse')}
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={lowStock} onChange={(e) => (setLowStock(e.target.checked), setPage(1))} />
            {t('products.lowOnly')}
          </label>
          <label className="check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            {t('products.showArchived')}
          </label>
          <span className="grow" />
          <ExportButtons
            name="products"
            rows={list.data?.rows}
            cols={[
              { header: 'name', value: (r) => r.name },
              { header: 'category', value: (r) => r.category_name },
              { header: 'unit', value: (r) => r.unit },
              { header: 'sku', value: (r) => r.sku },
              { header: 'barcode', value: (r) => r.barcode },
              { header: 'cost', value: (r) => r.cost },
              { header: 'retail', value: (r) => r.price_min },
              { header: 'minStock', value: (r) => r.min_stock },
              { header: 'qty', value: (r) => r.stock_qty },
              { header: 'stockValue', value: (r) => r.stock_value },
            ]}
          />
        </div>
        <Panel flush>
          {!list.data ? (
            <Loading />
          ) : list.data.rows.length === 0 ? (
            <Empty title={t('products.empty')}>{t('products.emptyHint')}</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>
                        <button onClick={() => sortBy('name')}>{t('common.product')}{arrow('name')}</button>
                      </th>
                      <th className="hide-sm">{t('common.category')}</th>
                      <th className="hide-sm">{t('common.sku')}</th>
                      <th className="right">
                        <button onClick={() => sortBy('price')}>{t('common.price')}{arrow('price')}</button>
                      </th>
                      <th className="right">
                        <button onClick={() => sortBy('stock_qty')}>{t('products.inStock')}{arrow('stock_qty')}</button>
                      </th>
                      <th className="right hide-sm">
                        <button onClick={() => sortBy('stock_value')}>{t('products.stockValue')}{arrow('stock_value')}</button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.rows.map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => setEditing(r.id)}>
                        <td>
                          <div className="cell-title">
                            {r.name} {!r.is_active && <span className="badge">{t('common.archived')}</span>} {r.track_expiry && <span className="badge accent">{t('products.expiryShort')}</span>}
                          </div>
                          <div className="cell-sub">
                            {r.variant_count > 1 ? t('products.variants', { n: r.variant_count }) : r.barcode ?? '—'}
                          </div>
                        </td>
                        <td className="hide-sm ink2">{r.category_name ?? '—'}</td>
                        <td className="hide-sm ink2 num">{r.sku}</td>
                        <td className="right">{r.price_min === r.price_max ? fmt.amount(r.price_min) : `${fmt.amount(r.price_min)}–${fmt.amount(r.price_max)}`}</td>
                        <td className="right">
                          <span className={r.min_stock > 0 && r.stock_qty <= r.min_stock ? 'badge warn' : ''}>
                            {fmt.num(r.stock_qty)} {r.unit}
                          </span>
                        </td>
                        <td className="right hide-sm">{fmt.amount(r.stock_value)}</td>
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
      {editing && <ProductEditor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} categories={options} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} />}
      {modal === 'categories' && <CategoriesModal onClose={() => setModal(null)} />}
    </>
  );
}

interface VariantForm {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  generateBarcode: boolean;
  cost: string;
  retail: string;
  wholesale: string;
}

function ProductEditor({ id, onClose, categories }: { id: string | null; onClose: () => void; categories: { id: string; label: string }[] }) {
  const { t, fmt } = useI18n();
  const { me, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const p = useQuery({ queryKey: ['products.get', { id }], queryFn: () => api.call('products.get', { id: id! }), enabled: !!id });
  const [form, setForm] = useState<{
    name: string;
    categoryId: string;
    baseUnit: string;
    description: string;
    trackExpiry: boolean;
    minStock: string;
    units: { unit: string; factor: string; barcode: string }[];
    variants: VariantForm[];
  } | null>(id ? null : { name: '', categoryId: '', baseUnit: 'dona', description: '', trackExpiry: false, minStock: '0', units: [], variants: [{ name: '', sku: '', barcode: '', generateBarcode: true, cost: '', retail: '', wholesale: '' }] });
  if (id && p.data && !form) {
    const d = p.data;
    setForm({
      name: d.name,
      categoryId: d.category_id ?? '',
      baseUnit: d.base_unit,
      description: d.description ?? '',
      trackExpiry: d.track_expiry,
      minStock: String(d.min_stock),
      units: d.units.map((u) => ({ unit: u.unit, factor: String(u.factor), barcode: u.barcode ?? '' })),
      variants: d.variants
        .filter((v) => v.is_active)
        .map((v) => ({ id: v.id, name: v.name, sku: v.sku, barcode: v.barcode ?? '', generateBarcode: false, cost: String(v.last_cost), retail: String(v.prices.retail ?? ''), wholesale: String(v.prices.wholesale ?? '') })),
    });
  }
  const save = useMutation({
    mutationFn: () =>
      api.call('products.save', {
        id,
        name: form!.name,
        categoryId: form!.categoryId || null,
        baseUnit: form!.baseUnit,
        description: form!.description || null,
        trackExpiry: form!.trackExpiry,
        minStock: Number(form!.minStock) || 0,
        units: form!.units.filter((u) => u.unit && Number(u.factor) > 0).map((u) => ({ unit: u.unit, factor: Number(u.factor), barcode: u.barcode || null })),
        variants: form!.variants.map((v) => ({
          id: v.id ?? null,
          name: v.name,
          sku: v.sku || null,
          barcode: v.barcode || null,
          generateBarcode: !v.barcode && v.generateBarcode,
          cost: Number(v.cost) || 0,
          prices: { retail: Number(v.retail) || 0, ...(v.wholesale ? { wholesale: Number(v.wholesale) } : {}) },
        })),
      }),
    onSuccess: () => {
      toast.ok(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['products.list'] });
      qc.invalidateQueries({ queryKey: ['products.get'] });
      qc.invalidateQueries({ queryKey: ['pos.catalog'] });
      onClose();
    },
    onError: toast.error,
  });
  const archive = useMutation({
    mutationFn: () => api.call('products.archive', { id: id!, archived: p.data?.is_active ?? true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products.list'] });
      onClose();
    },
    onError: toast.error,
  });
  const editable = can('catalog.edit');
  const setV = (i: number, patch: Partial<VariantForm>) => form && setForm({ ...form, variants: form.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  return (
    <Drawer
      wide
      title={id ? (p.data?.name ?? '…') : t('products.new')}
      onClose={onClose}
      footer={
        editable && (
          <>
            {id && (
              <button className="btn danger" onClick={() => archive.mutate()} style={{ marginRight: 'auto' }}>
                <Archive size={15} />
                {p.data?.is_active === false ? t('products.restore') : t('products.archive')}
              </button>
            )}
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!form || save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </button>
          </>
        )
      }
    >
      {!form ? (
        <Loading />
      ) : (
        <form
          className="stack-lg"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }} className="stack-lg">
            <div className="form-grid">
              <Field label={t('common.name')} className="span-2">
                <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </Field>
              <Field label={t('common.category')}>
                <select className="select" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">{t('common.none')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('products.baseUnit')}>
                <select className="select" value={form.baseUnit} onChange={(e) => setForm({ ...form, baseUnit: e.target.value })}>
                  {me.units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.code} — {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('products.minStock')} hint={t('products.minStockHint')}>
                <input className="input num" inputMode="decimal" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
              </Field>
              <Field label={t('products.expiry')}>
                <label className="check" style={{ height: 34 }}>
                  <input type="checkbox" checked={form.trackExpiry} onChange={(e) => setForm({ ...form, trackExpiry: e.target.checked })} />
                  {t('products.trackExpiry')}
                </label>
              </Field>
            </div>

            <section className="stack">
              <div className="row">
                <h3 className="grow">{t('products.packaging')}</h3>
                <button type="button" className="btn sm" onClick={() => setForm({ ...form, units: [...form.units, { unit: 'quti', factor: '12', barcode: '' }] })}>
                  <Plus size={14} />
                  {t('common.add')}
                </button>
              </div>
              <p className="small muted">{t('products.packagingHint', { unit: form.baseUnit })}</p>
              {form.units.map((u, i) => (
                <div className="row" key={i}>
                  <select className="select" style={{ width: 120 }} value={u.unit} onChange={(e) => setForm({ ...form, units: form.units.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })} aria-label={t('common.unit')}>
                    {me.units.filter((x) => x.code !== form.baseUnit).map((x) => (
                      <option key={x.code}>{x.code}</option>
                    ))}
                  </select>
                  <span className="muted">=</span>
                  <input className="input num" style={{ width: 90 }} value={u.factor} onChange={(e) => setForm({ ...form, units: form.units.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)) })} aria-label={t('products.factor')} />
                  <span className="muted">{form.baseUnit}</span>
                  <input className="input grow" placeholder={t('common.barcode')} value={u.barcode} onChange={(e) => setForm({ ...form, units: form.units.map((x, j) => (j === i ? { ...x, barcode: e.target.value } : x)) })} aria-label={t('common.barcode')} />
                  <button type="button" className="btn ghost icon sm" onClick={() => setForm({ ...form, units: form.units.filter((_, j) => j !== i) })} aria-label={t('common.remove')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </section>

            <section className="stack">
              <div className="row">
                <h3 className="grow">{t('products.variantsTitle')}</h3>
                <button type="button" className="btn sm" onClick={() => setForm({ ...form, variants: [...form.variants, { name: '', sku: '', barcode: '', generateBarcode: true, cost: form.variants[0]?.cost ?? '', retail: form.variants[0]?.retail ?? '', wholesale: form.variants[0]?.wholesale ?? '' }] })}>
                  <Plus size={14} />
                  {t('products.addVariant')}
                </button>
              </div>
              {form.variants.map((v, i) => (
                <div key={v.id ?? i} className="panel" style={{ padding: 12 }}>
                  <div className="form-grid">
                    {form.variants.length > 1 && (
                      <Field label={t('products.variantName')} className="span-2">
                        <input className="input" value={v.name} placeholder={t('products.variantPlaceholder')} onChange={(e) => setV(i, { name: e.target.value })} />
                      </Field>
                    )}
                    <Field label={t('common.sku')} hint={!v.sku ? t('products.skuAuto') : undefined}>
                      <input className="input" value={v.sku} onChange={(e) => setV(i, { sku: e.target.value })} />
                    </Field>
                    <Field label={t('products.barcodeLabel')} hint={!v.barcode ? t('products.barcodeAuto') : undefined}>
                      <input className="input" value={v.barcode} inputMode="numeric" onChange={(e) => setV(i, { barcode: e.target.value })} />
                    </Field>
                    <Field label={t('products.costPrice')}>
                      <input className="input num" inputMode="decimal" value={v.cost} onChange={(e) => setV(i, { cost: e.target.value })} />
                    </Field>
                    <Field label={t('products.retail')} hint={Number(v.cost) > 0 && Number(v.retail) > 0 ? t('products.markup', { pct: fmt.pct(((Number(v.retail) - Number(v.cost)) / Number(v.cost)) * 100) }) : undefined}>
                      <input className="input num" inputMode="decimal" required value={v.retail} onChange={(e) => setV(i, { retail: e.target.value })} />
                    </Field>
                    <Field label={t('products.wholesale')}>
                      <input className="input num" inputMode="decimal" value={v.wholesale} onChange={(e) => setV(i, { wholesale: e.target.value })} />
                    </Field>
                    {v.barcode && (
                      <div className="row" style={{ alignItems: 'flex-end' }}>
                        <div style={{ background: '#fff', padding: 6, borderRadius: 6, color: '#000' }}>
                          <BarcodeSvg value={v.barcode} format={/^\d{13}$/.test(v.barcode) ? 'EAN13' : 'CODE128'} height={34} width={1.3} />
                        </div>
                        <button type="button" className="btn sm" onClick={() => printLabel(form.name + (v.name ? ` · ${v.name}` : ''), v.barcode, Number(v.retail), fmt.money)}>
                          <Printer size={14} />
                          {t('products.label')}
                        </button>
                      </div>
                    )}
                  </div>
                  {form.variants.length > 1 && (
                    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                      <button type="button" className="btn ghost sm danger" onClick={() => setForm({ ...form, variants: form.variants.filter((_, j) => j !== i) })}>
                        <Trash2 size={14} />
                        {t('common.remove')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          </fieldset>

          {p.data && (
            <section className="stack">
              <h3>{t('products.stockByWarehouse')}</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.warehouse')}</th>
                    {p.data.variants.length > 1 && <th>{t('products.variantName')}</th>}
                    <th className="right">{t('common.qty')}</th>
                    <th className="right">{t('products.avgCost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.data.variants.flatMap((v) =>
                    v.stock.map((s) => (
                      <tr key={`${v.id}-${s.warehouse_id}`}>
                        <td>{s.warehouse}</td>
                        {p.data!.variants.length > 1 && <td>{v.name}</td>}
                        <td className="right">
                          {fmt.num(s.qty)} {p.data!.base_unit}
                        </td>
                        <td className="right">{fmt.money(s.avg_cost)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
              {p.data.batches.length > 0 && (
                <>
                  <h3>{t('products.batches')}</h3>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t('lines.batch')}</th>
                        <th>{t('common.warehouse')}</th>
                        <th>{t('lines.expires')}</th>
                        <th className="right">{t('common.qty')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.data.batches.map((b) => (
                        <tr key={`${b.id}-${b.warehouse}`}>
                          <td className="num">{b.code}</td>
                          <td>{b.warehouse}</td>
                          <td>{fmt.date(b.expires_at)}</td>
                          <td className="right">{fmt.num(b.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </section>
          )}
        </form>
      )}
    </Drawer>
  );
}

function printLabel(name: string, barcode: string, price: number, money: (v: number) => string) {
  const w = window.open('', '_blank', 'width=360,height=300');
  if (!w) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  import('jsbarcode').then(({ default: JsBarcode }) => {
    JsBarcode(svg, barcode, { format: /^\d{13}$/.test(barcode) ? 'EAN13' : 'CODE128', height: 40, width: 1.6, margin: 0, fontSize: 12 });
    w.document.write(
      `<html><head><title>${barcode}</title><style>@page{size:58mm 40mm;margin:2mm}body{font:12px system-ui;margin:0;text-align:center}b{font-size:16px;display:block;margin:2px 0}</style></head><body><div>${name.replace(/</g, '&lt;')}</div><b>${money(price)}</b>${svg.outerHTML}<script>setTimeout(()=>print(),200)</script></body></html>`,
    );
    w.document.close();
  });
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { warehouseId, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [wh, setWh] = useState('');
  const [preview, setPreview] = useState<Out<'products.import'> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean, r = rows) => {
    if (!r) return;
    setBusy(true);
    try {
      const res = await api.call('products.import', { rows: r, dryRun, warehouseId: wh || null });
      setPreview(res);
      if (res.applied) {
        toast.ok(t('import.done', { n: res.summary.create + res.summary.update }));
        qc.invalidateQueries();
        onClose();
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title={t('products.import')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={downloadTemplate} style={{ marginRight: 'auto' }}>
            {t('import.template')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!preview || preview.summary.errors > 0 || busy} onClick={() => run(false)}>
            {t('import.apply', { n: preview ? preview.summary.create + preview.summary.update : 0 })}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">{t('import.hint')}</p>
        <div className="form-grid">
          <Field label={t('import.file')}>
            <input
              className="input"
              type="file"
              accept=".xlsx,.csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const r = await readSpreadsheet(f);
                  setRows(r);
                  await run(true, r);
                } catch (x) {
                  toast.error(x);
                }
              }}
            />
          </Field>
          <Field label={t('import.openingTo')} hint={t('import.openingHint')}>
            <select className="select" value={wh} onChange={(e) => setWh(e.target.value)}>
              <option value="">{t('import.noOpening')}</option>
              {me.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {wh !== '' && rows && (
          <button className="btn sm" onClick={() => run(true)}>
            {t('import.recheck')}
          </button>
        )}
        {preview && (
          <>
            <div className="row wrap">
              <span className="badge">{t('import.total', { n: preview.summary.total })}</span>
              <span className="badge good">{t('import.create', { n: preview.summary.create })}</span>
              <span className="badge accent">{t('import.update', { n: preview.summary.update })}</span>
              <span className={`badge ${preview.summary.errors ? 'bad' : ''}`}>{t('import.errors', { n: preview.summary.errors })}</span>
            </div>
            <div className="table-wrap panel" style={{ maxHeight: 320 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('common.name')}</th>
                    <th>{t('common.sku')}</th>
                    <th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.results.map((r) => (
                    <tr key={r.index}>
                      <td className="num muted">{r.index + 2}</td>
                      <td>{r.name ?? '—'}</td>
                      <td className="num">{r.sku ?? '—'}</td>
                      <td>
                        {r.status === 'error' ? (
                          <span className="small" style={{ color: 'var(--bad)' }}>
                            {r.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}
                          </span>
                        ) : (
                          <span className={`badge ${r.status === 'create' ? 'good' : 'accent'}`}>{t(`import.${r.status}` as never, { n: '' })}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {void warehouseId}
      </div>
    </Modal>
  );
}

function CategoriesModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const cats = useQuery({ queryKey: ['categories.list'], queryFn: () => api.call('categories.list', {}) });
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const options = categoryOptions(cats.data ?? []);
  const refresh = () => qc.invalidateQueries({ queryKey: ['categories.list'] });
  const add = useMutation({ mutationFn: () => api.call('categories.save', { name, parentId: parentId || null }), onSuccess: () => (setName(''), refresh()), onError: toast.error });
  const del = useMutation({ mutationFn: (id: string) => api.call('categories.delete', { id }), onSuccess: refresh, onError: toast.error });
  const counts = new Map((cats.data ?? []).map((c) => [c.id, c.product_count]));
  return (
    <Modal wide title={t('products.categories')} onClose={onClose}>
      <div className="stack">
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <input className="input grow" style={{ minWidth: 180 }} placeholder={t('products.newCategory')} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('products.newCategory')} />
          <select className="select" style={{ width: 240 }} value={parentId} onChange={(e) => setParentId(e.target.value)} aria-label={t('products.parent')}>
            <option value="">{t('products.topLevel')}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="btn primary">{t('common.add')}</button>
        </form>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {options.map((o) => (
            <div key={o.id} className="row" style={{ padding: '6px 4px', paddingLeft: 4 + o.depth * 20, borderBottom: '1px solid var(--line)' }}>
              <span className="grow">{o.label.split(' / ').pop()}</span>
              <span className="small muted num">{counts.get(o.id) ?? 0}</span>
              <button className="btn ghost icon sm" onClick={() => del.mutate(o.id)} aria-label={t('common.remove')}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
