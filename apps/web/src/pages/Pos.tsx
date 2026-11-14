import { priceCart, roundMoney, type PaymentMethod } from '@omborchi/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleUserRound, Lock, Percent, Printer, ScanLine, Search, Share2, ShoppingBasket, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/layout';
import { itemName, matchItems, useCatalog, type CatalogItem } from '../components/pickers';
import { printReceipt, Receipt, shareReceipt } from '../components/Receipt';
import { Scanner } from '../components/Scanner';
import { Empty, Field, Modal } from '../components/ui';
import { useI18n } from '../i18n';
import { api, type Out } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

interface Line {
  variantId: string;
  name: string;
  baseUnit: string;
  unit: string;
  factor: number;
  basePrice: number;
  qty: number;
  allowFraction: boolean;
  stock: number;
}

const METHODS: PaymentMethod[] = ['cash', 'card', 'payme', 'click', 'uzum'];

export default function Pos() {
  const { t, fmt } = useI18n();
  const { warehouseId, warehouse, can, me } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [priceListId, setPriceListId] = useState<string | undefined>(undefined);
  const cat = useCatalog(warehouseId, priceListId);
  const categories = useQuery({ queryKey: ['categories.list'], queryFn: () => api.call('categories.list', {}) });
  const shift = useQuery({ queryKey: ['shifts.current', warehouseId], queryFn: () => api.call('shifts.current', { warehouseId }), enabled: !!warehouseId });
  const [lines, setLines] = useState<Line[]>([]);
  const [sel, setSel] = useState(0);
  const [q, setQ] = useState('');
  const [catId, setCatId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [discount, setDiscount] = useState<{ type: 'percent' | 'amount'; value: number } | null>(null);
  const [modal, setModal] = useState<null | 'pay' | 'customer' | 'discount' | 'close' | 'scan'>(null);
  const [done, setDone] = useState<Out<'sales.get'> | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const units = useMemo(() => {
    const m = new Map<string, { unit: string; factor: number; barcode: string | null }[]>();
    for (const u of cat.data?.units ?? []) m.set(u.product_id, [...(m.get(u.product_id) ?? []), u]);
    return m;
  }, [cat.data]);

  // subtree filter for category chips
  const subtree = useMemo(() => {
    if (!catId || !categories.data) return null;
    const ids = new Set([catId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of categories.data) if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
    }
    return ids;
  }, [catId, categories.data]);

  const visible = useMemo(() => {
    const all = cat.data?.items ?? [];
    const filtered = subtree ? all.filter((i) => i.category_id && subtree.has(i.category_id)) : all;
    return matchItems(filtered, q, 120);
  }, [cat.data, q, subtree]);

  const roots = (categories.data ?? []).filter((c) => !c.parent_id);

  const add = useCallback(
    (item: CatalogItem, alt?: { unit: string; factor: number }) => {
      const unit = alt?.unit ?? item.unit;
      setLines((ls) => {
        const i = ls.findIndex((l) => l.variantId === item.variant_id && l.unit === unit);
        if (i >= 0) {
          const copy = [...ls];
          copy[i] = { ...copy[i], qty: copy[i].qty + 1 };
          setSel(i);
          return copy;
        }
        setSel(ls.length);
        return [
          ...ls,
          { variantId: item.variant_id, name: itemName(item), baseUnit: item.unit, unit, factor: alt?.factor ?? 1, basePrice: item.price, qty: 1, allowFraction: item.allow_fraction && !alt, stock: item.qty },
        ];
      });
    },
    [setLines],
  );

  const addByCode = (code: string): boolean => {
    const items = cat.data?.items ?? [];
    const hit = items.find((i) => i.barcode === code || i.sku.toLowerCase() === code.toLowerCase());
    if (hit) {
      add(hit);
      return true;
    }
    const alt = (cat.data?.units ?? []).find((u) => u.barcode === code);
    if (alt) {
      const item = items.find((i) => i.product_id === alt.product_id);
      if (item) {
        add(item, alt);
        return true;
      }
    }
    return false;
  };

  const cart = useMemo(() => {
    try {
      return priceCart(
        lines.map((l) => ({ unitPrice: roundMoney(l.basePrice * l.factor), qty: l.qty, unitFactor: l.factor })),
        discount,
      );
    } catch {
      return priceCart(lines.map((l) => ({ unitPrice: roundMoney(l.basePrice * l.factor), qty: Math.max(0.001, l.qty), unitFactor: l.factor })));
    }
  }, [lines, discount]);

  const setQty = (i: number, qty: number) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, qty: Math.max(l.allowFraction ? 0.001 : 1, qty) } : l)));
  const remove = (i: number) => {
    setLines((ls) => ls.filter((_, j) => j !== i));
    setSel((s) => Math.max(0, Math.min(s, lines.length - 2)));
  };
  const clear = () => {
    setLines([]);
    setCustomer(null);
    setDiscount(null);
    setSel(0);
  };

  // Keyboard-first: the cashier never needs the mouse.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modal || done) return;
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' && e.target !== search.current;
      if (e.key === 'F2' || (e.key === '/' && !typing && e.target !== search.current)) {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (lines.length && shift.data) setModal('pay');
      } else if (e.key === 'F6') {
        e.preventDefault();
        setModal('customer');
      } else if (e.key === 'F7' && can('sales.discount')) {
        e.preventDefault();
        setModal('discount');
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (lines.length && confirm(t('pos.clearConfirm'))) clear();
      } else if (!typing && lines.length) {
        if (e.key === 'ArrowDown' && e.target !== search.current) setSel((s) => Math.min(lines.length - 1, s + 1));
        else if (e.key === 'ArrowUp' && e.target !== search.current) setSel((s) => Math.max(0, s - 1));
        else if ((e.key === '+' || e.key === '=') && !q) {
          e.preventDefault();
          setQty(sel, (lines[sel]?.qty ?? 0) + 1);
        } else if (e.key === '-' && !q) {
          e.preventDefault();
          setQty(sel, (lines[sel]?.qty ?? 2) - 1);
        } else if (e.key === 'Delete') remove(sel);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const onSold = async (saleId: string) => {
    const sale = await api.call('sales.get', { id: saleId });
    setDone(sale);
    clear();
    setModal(null);
    setCartOpen(false);
    for (const k of ['pos.catalog', 'shifts.current', 'reports.dashboard', 'sales.list', 'alerts.list', 'stock.balances', 'products.list', 'customers.list']) qc.invalidateQueries({ queryKey: [k] });
  };

  const tapeHead = (
    <div className="tape-head">
      <strong>{me.org.name}</strong>
      <span>
        {warehouse?.name} · {shift.data ? `${t('pos.shift')} ${shift.data.number}` : t('pos.noShift')}
      </span>
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('nav.pos')}
        actions={
          <span className="row">
            {can('sales.discount') && me.priceLists.length > 1 && (
              <select className="select hide-sm" style={{ width: 'auto' }} value={priceListId ?? me.priceLists[0].id} onChange={(e) => setPriceListId(e.target.value)} aria-label={t('pos.priceList')}>
                {me.priceLists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {shift.data && (
              <button className="btn" onClick={() => setModal('close')}>
                <Lock size={15} />
                <span className="hide-sm">{t('pos.closeShift')}</span>
              </button>
            )}
          </span>
        }
      />
      <div className="content" style={{ maxWidth: 'none', paddingBottom: 20 }}>
        <div className={`pos ${cartOpen ? 'cart-open' : ''}`}>
          <div className="pos-left">
            <form
              className="pos-search"
              onSubmit={(e) => {
                e.preventDefault();
                const code = q.trim();
                if (!code) return;
                if (addByCode(code) || (visible.length === 1 && (add(visible[0]), true))) setQ('');
                else if (visible.length === 0) toast.error(new Error(t('pos.notFound', { code })));
              }}
            >
              <Search size={19} />
              <input
                ref={search}
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('pos.searchPlaceholder')}
                aria-label={t('pos.searchPlaceholder')}
                autoFocus
                data-testid="pos-search"
              />
              <span className="actions">
                {q && (
                  <button type="button" className="btn ghost icon" onClick={() => setQ('')} aria-label={t('common.clear')}>
                    <X size={16} />
                  </button>
                )}
                <button type="button" className="btn icon" onClick={() => setModal('scan')} aria-label={t('scan.title')} title={t('scan.title')}>
                  <ScanLine size={17} />
                </button>
              </span>
            </form>
            <div className="chips" role="group" aria-label={t('common.category')}>
              <button className="chip" aria-pressed={!catId} onClick={() => setCatId(null)}>
                {t('common.all')}
              </button>
              {roots.map((c) => (
                <button key={c.id} className="chip" aria-pressed={catId === c.id} onClick={() => setCatId(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="pos-grid" data-testid="pos-grid">
              {visible.map((i) => (
                <button key={i.variant_id} className={`tile ${i.qty <= 0 ? 'out' : ''}`} onClick={() => add(i)} title={`${itemName(i)} · ${i.sku}`}>
                  <span className="t-name">{itemName(i)}</span>
                  <span className="t-foot">
                    <span className="t-price">{fmt.amount(i.price)}</span>
                    <span className="t-stock">
                      {fmt.num(i.qty)} {i.unit}
                    </span>
                  </span>
                </button>
              ))}
              {cat.data && visible.length === 0 && <Empty title={t('pos.noResults')}>{t('pos.noResultsHint')}</Empty>}
            </div>
          </div>

          <aside className="tape" aria-label={t('pos.cart')} data-testid="cart">
            {tapeHead}
            {cartOpen && (
              <button className="btn ghost icon" style={{ position: 'absolute', right: 8, top: 8 }} onClick={() => setCartOpen(false)} aria-label={t('common.close')}>
                <X size={18} />
              </button>
            )}
            {!shift.data && shift.isFetched ? (
              <OpenShift warehouseId={warehouseId} />
            ) : (
              <>
                <div className="tape-lines">
                  {lines.length === 0 ? (
                    <div className="tape-empty">
                      <ShoppingBasket size={28} style={{ opacity: 0.4 }} />
                      <p style={{ marginTop: 8 }}>{t('pos.emptyCart')}</p>
                      <p className="small" style={{ marginTop: 10 }}>
                        <kbd>F2</kbd> {t('pos.kSearch')} · <kbd>F4</kbd> {t('pos.kPay')} · <kbd>F8</kbd> {t('pos.kClear')}
                      </p>
                    </div>
                  ) : (
                    lines.map((l, i) => {
                      const pl = cart.lines[i];
                      const alts = units.get(cat.data?.items.find((x) => x.variant_id === l.variantId)?.product_id ?? '') ?? [];
                      const over = l.qty * l.factor > l.stock;
                      return (
                        <div key={`${l.variantId}-${l.unit}`} className={`tape-line ${i === sel ? 'sel' : ''}`} onClick={() => setSel(i)} data-testid="cart-line">
                          <span className="l-name">{l.name}</span>
                          <span className="l-total">{fmt.amount(pl?.total ?? 0)}</span>
                          <span className="l-meta">
                            <span className="qty-ctl" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => setQty(i, l.qty - 1)} aria-label={t('pos.less')}>
                                −
                              </button>
                              <input
                                value={l.qty}
                                inputMode="decimal"
                                aria-label={t('common.qty')}
                                onChange={(e) => {
                                  const v = Number(e.target.value.replace(',', '.'));
                                  if (Number.isFinite(v)) setQty(i, l.allowFraction ? v : Math.round(v));
                                }}
                              />
                              <button onClick={() => setQty(i, l.qty + 1)} aria-label={t('pos.more')}>
                                +
                              </button>
                            </span>
                            {alts.length > 0 ? (
                              <select
                                value={l.unit}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const u = e.target.value;
                                  const f = u === l.baseUnit ? 1 : (alts.find((a) => a.unit === u)?.factor ?? 1);
                                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit: u, factor: f, qty: Math.max(1, Math.round(x.qty)), allowFraction: false } : x)));
                                }}
                                style={{ border: '1px solid #e3e0d4', borderRadius: 6, background: '#fff', color: 'inherit', height: 26 }}
                                aria-label={t('common.unit')}
                              >
                                <option value={l.baseUnit}>{l.baseUnit}</option>
                                {alts.map((a) => (
                                  <option key={a.unit} value={a.unit}>
                                    {a.unit} ({fmt.num(a.factor)})
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span>{l.unit}</span>
                            )}
                            <span>× {fmt.amount(roundMoney(l.basePrice * l.factor))}</span>
                            {over && <span className="badge bad">{t('pos.overStock', { n: fmt.num(l.stock) })}</span>}
                            <button className="btn ghost icon sm" style={{ marginLeft: 'auto' }} onClick={(e) => (e.stopPropagation(), remove(i))} aria-label={t('common.remove')}>
                              <Trash2 size={14} />
                            </button>
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="tape-foot">
                  <div className="row" style={{ marginBottom: 8 }}>
                    <button className="btn sm grow" onClick={() => setModal('customer')} style={{ justifyContent: 'flex-start' }}>
                      <CircleUserRound size={15} />
                      <span className="ellipsis">{customer?.name ?? t('pos.addCustomer')}</span>
                      <kbd style={{ marginLeft: 'auto' }}>F6</kbd>
                    </button>
                    {can('sales.discount') && (
                      <button className="btn sm" onClick={() => setModal('discount')} aria-label={t('pos.discount')}>
                        <Percent size={15} />
                        <kbd>F7</kbd>
                      </button>
                    )}
                  </div>
                  <div className="tape-sum">
                    <span>{t('pos.subtotal')}</span>
                    <span>{fmt.amount(cart.subtotal)}</span>
                  </div>
                  {cart.discountTotal > 0 && (
                    <div className="tape-sum">
                      <span>{t('pos.discount')}</span>
                      <span>−{fmt.amount(cart.discountTotal)}</span>
                    </div>
                  )}
                  <div className="tape-total">
                    <span>{t('pos.total')}</span>
                    <b data-testid="cart-total">{fmt.amount(cart.total)}</b>
                  </div>
                  <button className="btn primary pay-btn" disabled={!lines.length} onClick={() => setModal('pay')} data-testid="pay">
                    <span>{t('pos.pay')}</span>
                    <kbd style={{ color: 'inherit' }}>F4</kbd>
                  </button>
                </div>
              </>
            )}
          </aside>
          <button className="cart-bar" onClick={() => setCartOpen(true)} aria-label={t('pos.cart')}>
            <span>
              {t('pos.cart')} · {lines.length}
            </span>
            <span className="num">{fmt.money(cart.total)}</span>
          </button>
        </div>
      </div>

      {modal === 'scan' && (
        <Scanner
          onClose={() => setModal(null)}
          onCode={(code) => {
            setModal(null);
            if (!addByCode(code)) toast.error(new Error(t('pos.notFound', { code })));
          }}
        />
      )}
      {modal === 'customer' && (
        <CustomerPicker
          onClose={() => setModal(null)}
          onPick={(c) => {
            setCustomer(c);
            setModal(null);
          }}
          current={customer}
        />
      )}
      {modal === 'discount' && <DiscountModal value={discount} onClose={() => setModal(null)} onApply={(d) => (setDiscount(d), setModal(null))} />}
      {modal === 'pay' && (
        <PayModal
          total={cart.total}
          customer={customer}
          onPickCustomer={() => setModal('customer')}
          onClose={() => setModal(null)}
          submit={(payments, dueDate) =>
            api.call('sales.create', {
              warehouseId,
              customerId: customer?.id ?? null,
              priceListId: priceListId ?? null,
              lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unit: l.unit })),
              cartDiscount: discount,
              payments,
              dueDate,
            })
          }
          onDone={(id) => onSold(id)}
        />
      )}
      {modal === 'close' && shift.data && <CloseShift shift={shift.data} onClose={() => setModal(null)} />}
      {done && <SaleDone sale={done} onClose={() => (setDone(null), setTimeout(() => search.current?.focus(), 50))} />}
    </>
  );
}

function OpenShift({ warehouseId }: { warehouseId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [cash, setCash] = useState('200000');
  const m = useMutation({
    mutationFn: () => api.call('shifts.open', { warehouseId, openingCash: Number(cash) || 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts.current'] }),
    onError: toast.error,
  });
  return (
    <form
      className="tape-empty stack"
      style={{ textAlign: 'left' }}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <h2>{t('pos.openShiftTitle')}</h2>
      <p>{t('pos.openShiftHint')}</p>
      <Field label={t('pos.openingCash')}>
        <input className="input num" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, ''))} />
      </Field>
      <button className="btn primary" disabled={m.isPending} data-testid="open-shift">
        {t('pos.openShift')}
      </button>
    </form>
  );
}

function CloseShift({ shift, onClose }: { shift: NonNullable<Out<'shifts.current'>>; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [counted, setCounted] = useState(String(shift.expectedCash));
  const [result, setResult] = useState<Out<'shifts.close'> | null>(null);
  const m = useMutation({
    mutationFn: () => api.call('shifts.close', { id: shift.id, countedCash: Number(counted) || 0 }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['shifts.current'] });
    },
    onError: toast.error,
  });
  const totals = shift.totals;
  return (
    <Modal
      title={`${t('pos.closeShift')} ${shift.number}`}
      onClose={onClose}
      footer={
        result ? (
          <button className="btn primary" onClick={onClose}>
            {t('common.done')}
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" onClick={() => m.mutate()} disabled={m.isPending}>
              {t('pos.closeShift')}
            </button>
          </>
        )
      }
    >
      <div className="stack">
        <table className="data">
          <tbody>
            <tr>
              <td>{t('pos.openedAt')}</td>
              <td className="right">{fmt.dateTime(shift.opened_at)}</td>
            </tr>
            <tr>
              <td>{t('pos.salesInShift')}</td>
              <td className="right">
                {fmt.num(totals.sales.count)} · {fmt.money(totals.sales.total)}
              </td>
            </tr>
            {totals.payments.map((p) => (
              <tr key={p.method}>
                <td className="muted">{t(`pay.${p.method}` as never)}</td>
                <td className="right">{fmt.money(p.amount)}</td>
              </tr>
            ))}
            <tr>
              <td>{t('pos.returnsInShift')}</td>
              <td className="right">{fmt.money(totals.returns.total)}</td>
            </tr>
            <tr>
              <td>{t('pos.debtCollected')}</td>
              <td className="right">{fmt.money(totals.collections.total)}</td>
            </tr>
            <tr>
              <td>
                <b>{t('pos.expectedCash')}</b>
              </td>
              <td className="right">
                <b>{fmt.money(shift.expectedCash)}</b>
              </td>
            </tr>
          </tbody>
        </table>
        {result ? (
          <div className={`callout ${result.difference === 0 ? '' : result.difference < 0 ? 'bad' : 'warn'}`}>
            {result.difference === 0 ? t('pos.cashMatches') : t('pos.cashDiff', { v: fmt.money(result.difference) })}
          </div>
        ) : (
          <Field label={t('pos.countedCash')}>
            <input className="input num lg" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function DiscountModal({ value, onClose, onApply }: { value: { type: 'percent' | 'amount'; value: number } | null; onClose: () => void; onApply: (d: { type: 'percent' | 'amount'; value: number } | null) => void }) {
  const { t } = useI18n();
  const [type, setType] = useState<'percent' | 'amount'>(value?.type ?? 'percent');
  const [v, setV] = useState(String(value?.value ?? ''));
  return (
    <Modal
      title={t('pos.cartDiscount')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => onApply(null)}>
            {t('pos.noDiscount')}
          </button>
          <button className="btn primary" onClick={() => onApply(Number(v) > 0 ? { type, value: Number(v) } : null)}>
            {t('common.apply')}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="seg">
          <button aria-pressed={type === 'percent'} onClick={() => setType('percent')}>
            %
          </button>
          <button aria-pressed={type === 'amount'} onClick={() => setType('amount')}>
            {t('common.currency')}
          </button>
        </div>
        <div className="row wrap">
          {(type === 'percent' ? [3, 5, 10, 15] : [5000, 10000, 20000, 50000]).map((x) => (
            <button key={x} className="btn sm" onClick={() => setV(String(x))}>
              {type === 'percent' ? `${x}%` : x.toLocaleString('ru-RU')}
            </button>
          ))}
        </div>
        <input className="input num lg" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} autoFocus aria-label={t('pos.discount')} />
      </div>
    </Modal>
  );
}

function CustomerPicker({ onClose, onPick, current }: { onClose: () => void; onPick: (c: { id: string; name: string } | null) => void; current: { id: string; name: string } | null }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['customers.list', { q }], queryFn: () => api.call('customers.list', { q }) });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  return (
    <Modal
      title={t('pos.chooseCustomer')}
      onClose={onClose}
      footer={
        current ? (
          <button className="btn" onClick={() => onPick(null)}>
            {t('pos.removeCustomer')}
          </button>
        ) : undefined
      }
    >
      {creating ? (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api.call('customers.save', { name: form.name, phone: form.phone || null });
              onPick({ id: r.id, name: form.name });
            } catch (x) {
              toast.error(x);
            }
          }}
        >
          <Field label={t('common.name')}>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label={t('common.phone')}>
            <input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+998 90 123 45 67" />
          </Field>
          <button className="btn primary">{t('common.save')}</button>
        </form>
      ) : (
        <div className="stack">
          <div className="row">
            <input className="input grow" autoFocus placeholder={t('pos.customerSearch')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('pos.customerSearch')} />
            <button className="btn" onClick={() => setCreating(true)}>
              {t('common.new')}
            </button>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {(list.data ?? []).slice(0, 50).map((c) => (
              <button
                key={c.id}
                className="row"
                style={{ width: '100%', padding: '9px 6px', border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', cursor: 'pointer' }}
                onClick={() => onPick({ id: c.id, name: c.name })}
              >
                <span className="grow">
                  <span className="cell-title">{c.name}</span>
                  <span className="cell-sub" style={{ display: 'block' }}>
                    {c.phone}
                  </span>
                </span>
                {c.balance > 0 && <span className={`badge ${c.overdue > 0 ? 'bad' : 'warn'}`}>{t('pos.owes', { v: fmt.money(c.balance) })}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function PayModal({
  total,
  customer,
  onPickCustomer,
  onClose,
  submit,
  onDone,
}: {
  total: number;
  customer: { id: string; name: string } | null;
  onPickCustomer: () => void;
  onClose: () => void;
  submit: (payments: { method: PaymentMethod; amount: number }[], dueDate: string | null) => Promise<{ id: string }>;
  onDone: (id: string) => void;
}) {
  const { t, fmt, locale } = useI18n();
  const { me } = useSession();
  const toast = useToast();
  const [amounts, setAmounts] = useState<Partial<Record<PaymentMethod, string>>>({ cash: String(total) });
  const [due, setDue] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const paid = METHODS.reduce((s, m) => s + (Number(amounts[m]) || 0), 0);
  const nonCash = METHODS.filter((m) => m !== 'cash').reduce((s, m) => s + (Number(amounts[m]) || 0), 0);
  const change = Math.max(0, Math.min(Number(amounts.cash) || 0, paid - total));
  const debt = Math.max(0, roundMoney(total - paid));
  const invalid = nonCash > total || (debt > 0 && !customer);
  const quick = [...new Set([total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000, Math.ceil(total / 100000) * 100000])].slice(0, 5);
  const simulated = me.paymentMethods.filter((p) => p.simulated).map((p) => p.label);

  const go = async () => {
    if (invalid || busy) return;
    setBusy(true);
    try {
      const payments = METHODS.map((m) => ({ method: m, amount: Number(amounts[m]) || 0 })).filter((p) => p.amount > 0);
      const r = await submit(payments, debt > 0 ? due : null);
      onDone(r.id);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const only = (m: PaymentMethod) => setAmounts({ [m]: String(total) });

  return (
    <Modal
      wide
      title={t('pos.payment')}
      onClose={onClose}
      footer={
        <>
          <span className="grow small muted">{t('pos.simulatedNote', { list: simulated.join(', ') })}</span>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary lg" disabled={invalid || busy} onClick={go} data-testid="confirm-payment">
            {debt > 0 ? t('pos.confirmDebt') : t('pos.confirm')} · {fmt.money(total)}
          </button>
        </>
      }
    >
      <form
        className="stack-lg"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="muted grow">{t('pos.toPay')}</span>
          <span className="hero-figure num" style={{ fontSize: 40 }}>
            {fmt.amount(total)}
          </span>
          <span className="muted">{t('common.currency')}</span>
        </div>
        <div className="pay-methods">
          {METHODS.map((m) => (
            <button type="button" key={m} className="pay-method" aria-pressed={Number(amounts[m]) > 0} onClick={() => only(m)}>
              {t(`pay.${m}` as never)}
              <small>{m === 'cash' || m === 'card' ? t(`pay.${m}Sub` as never) : t('pay.online')}</small>
            </button>
          ))}
          <button type="button" className="pay-method" aria-pressed={debt > 0 && paid === 0} onClick={() => (setAmounts({}), !customer && onPickCustomer())}>
            {t('pay.nasiya')}
            <small>{customer ? customer.name : t('pay.nasiyaSub')}</small>
          </button>
        </div>
        <div className="form-grid">
          {METHODS.map((m) => (
            <Field key={m} label={t(`pay.${m}` as never)}>
              <input
                className="input num"
                inputMode="numeric"
                value={amounts[m] ?? ''}
                placeholder="0"
                onChange={(e) => setAmounts({ ...amounts, [m]: e.target.value.replace(/[^\d]/g, '') })}
                autoFocus={m === 'cash'}
                data-testid={`pay-${m}`}
              />
            </Field>
          ))}
        </div>
        <div className="row wrap">
          <span className="small muted">{t('pos.quickCash')}</span>
          {quick.map((v) => (
            <button type="button" key={v} className="btn sm" onClick={() => setAmounts({ ...amounts, cash: String(Math.max(0, v - nonCash)) })}>
              {new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU').format(v)}
            </button>
          ))}
        </div>
        <div className="grid cols-3">
          <div className="panel" style={{ padding: 12 }}>
            <div className="small muted">{t('pos.paid')}</div>
            <b className="num">{fmt.money(Math.min(paid, total))}</b>
          </div>
          <div className="panel" style={{ padding: 12 }}>
            <div className="small muted">{t('pos.change')}</div>
            <b className="num" data-testid="change">
              {fmt.money(change)}
            </b>
          </div>
          <div className="panel" style={{ padding: 12, borderColor: debt > 0 ? 'var(--warn)' : undefined }}>
            <div className="small muted">{t('pos.debt')}</div>
            <b className="num">{fmt.money(debt)}</b>
          </div>
        </div>
        {debt > 0 && (
          <div className="callout warn">
            <div className="stack grow" style={{ gap: 8 }}>
              <span>{customer ? t('pos.debtFor', { name: customer.name }) : t('err.debtCustomer')}</span>
              <div className="row wrap">
                <button type="button" className="btn sm" onClick={onPickCustomer}>
                  {customer ? t('pos.changeCustomer') : t('pos.addCustomer')}
                </button>
                <label className="row small">
                  {t('pos.due')}
                  <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 160 }} />
                </label>
              </div>
            </div>
          </div>
        )}
        {nonCash > total && <div className="callout bad">{t('err.overpay')}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function SaleDone({ sale, onClose }: { sale: Out<'sales.get'>; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const { me } = useSession();
  const toast = useToast();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Enter' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <Modal
      title={t('pos.saleDone', { number: sale.number })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => printReceipt(sale.id, 58)}>
            <Printer size={15} /> 58 mm
          </button>
          <button className="btn" onClick={() => printReceipt(sale.id, 80)}>
            <Printer size={15} /> 80 mm
          </button>
          <button className="btn" onClick={async () => toast.ok((await shareReceipt(sale, fmt, t)) === 'copied' ? t('receipt.copied') : t('receipt.shared'))}>
            <Share2 size={15} />
            {t('receipt.share')}
          </button>
          <button className="btn primary" onClick={onClose} data-testid="new-sale">
            {t('pos.newSale')} <kbd style={{ color: 'inherit' }}>Enter</kbd>
          </button>
        </>
      }
    >
      <div className="stack">
        {sale.change > 0 && (
          <div className="callout">
            <span className="grow">{t('pos.giveChange')}</span>
            <b className="num" style={{ fontSize: 20 }}>
              {fmt.money(sale.change)}
            </b>
          </div>
        )}
        <div style={{ background: '#fff', borderRadius: 8, padding: '8px 0', maxHeight: '50vh', overflowY: 'auto', border: '1px solid var(--line)' }}>
          <Receipt sale={sale} settings={me.org.settings} />
        </div>
      </div>
    </Modal>
  );
}
