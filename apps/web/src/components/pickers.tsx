import { addDays, tashkentDay } from '@omborchi/core';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, ScanLine, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { api, type Out } from '../lib/api';
import { exportCsv, exportXlsx, type Column } from '../lib/export';
import { useSession } from '../lib/session';
import { Scanner } from './Scanner';

export type CatalogItem = Out<'pos.catalog'>['items'][number];

export function useCatalog(warehouseId: string, priceListId?: string) {
  return useQuery({
    queryKey: ['pos.catalog', { warehouseId, priceListId }],
    queryFn: () => api.call('pos.catalog', { warehouseId, priceListId }),
    enabled: !!warehouseId,
    staleTime: 30_000,
  });
}

export const itemName = (i: { name: string; variant_name?: string }) => (i.variant_name ? `${i.name} · ${i.variant_name}` : i.name);

export function matchItems(items: CatalogItem[], q: string, limit = 60): CatalogItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return items.slice(0, limit);
  const exact = items.filter((i) => i.barcode === q.trim() || i.sku.toLowerCase() === s);
  if (exact.length) return exact;
  const words = s.split(/\s+/);
  return items.filter((i) => words.every((w) => itemName(i).toLowerCase().includes(w) || i.sku.toLowerCase().includes(w))).slice(0, limit);
}

/** Search-as-you-type product picker for document lines (transfers, receipts, orders…). */
export function ProductPicker({ warehouseId, onPick, placeholder }: { warehouseId: string; onPick: (item: CatalogItem) => void; placeholder?: string }) {
  const { t, fmt } = useI18n();
  const cat = useCatalog(warehouseId);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [scan, setScan] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => (q ? matchItems(cat.data?.items ?? [], q, 8) : []), [cat.data, q]);
  const pick = (i: CatalogItem) => {
    onPick(i);
    setQ('');
    setOpen(false);
    input.current?.focus();
  };
  return (
    <div style={{ position: 'relative' }}>
      <div className="row">
        <div className="search grow">
          <Search size={16} />
          <input
            ref={input}
            className="input"
            value={q}
            placeholder={placeholder ?? t('picker.placeholder')}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setIdx(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setIdx((i) => Math.min(results.length - 1, i + 1));
              if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1));
              if (e.key === 'Enter') {
                e.preventDefault();
                if (results[idx]) pick(results[idx]);
              }
            }}
            aria-label={t('picker.placeholder')}
          />
        </div>
        <button type="button" className="btn icon" onClick={() => setScan(true)} aria-label={t('scan.title')} title={t('scan.title')}>
          <ScanLine size={17} />
        </button>
      </div>
      {open && results.length > 0 && (
        <div className="panel" style={{ position: 'absolute', zIndex: 10, left: 0, right: 0, top: 40, boxShadow: 'var(--shadow-overlay)', maxHeight: 320, overflowY: 'auto' }} role="listbox">
          {results.map((r, i) => (
            <button
              type="button"
              key={r.variant_id}
              role="option"
              aria-selected={i === idx}
              className="row"
              style={{ width: '100%', padding: '8px 12px', border: 0, background: i === idx ? 'var(--accent-tint)' : 'transparent', textAlign: 'left', cursor: 'pointer' }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
            >
              <span className="grow">
                <span className="cell-title">{itemName(r)}</span>
                <span className="cell-sub"> · {r.sku}</span>
              </span>
              <span className="small muted num">
                {fmt.num(r.qty)} {r.unit}
              </span>
            </button>
          ))}
        </div>
      )}
      {scan && (
        <Scanner
          onClose={() => setScan(false)}
          onCode={(code) => {
            setScan(false);
            const hit = matchItems(cat.data?.items ?? [], code, 1)[0];
            if (hit && (hit.barcode === code || hit.sku === code)) pick(hit);
            else setQ(code);
          }}
        />
      )}
    </div>
  );
}

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'month';

export function useRange(initial: RangePreset = '30d') {
  const [preset, setPreset] = useState<RangePreset | 'custom'>(initial);
  const today = tashkentDay(new Date());
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const range = useMemo(() => {
    switch (preset) {
      case 'today':
        return { from: today, to: today };
      case '7d':
        return { from: addDays(today, -6), to: today };
      case '30d':
        return { from: addDays(today, -29), to: today };
      case '90d':
        return { from: addDays(today, -89), to: today };
      case 'month':
        return { from: `${today.slice(0, 8)}01`, to: today };
      default:
        return custom;
    }
  }, [preset, custom, today]);
  return { preset, setPreset, range, custom, setCustom };
}

export function RangeControl({ state }: { state: ReturnType<typeof useRange> }) {
  const { t } = useI18n();
  const presets: (RangePreset | 'custom')[] = ['today', '7d', '30d', '90d', 'month', 'custom'];
  return (
    <div className="row wrap">
      <div className="seg" role="group" aria-label={t('range.label')}>
        {presets.map((p) => (
          <button key={p} type="button" aria-pressed={state.preset === p} onClick={() => state.setPreset(p)}>
            {t(`range.${p}` as never)}
          </button>
        ))}
      </div>
      {state.preset === 'custom' && (
        <span className="row">
          <input className="input" type="date" value={state.custom.from} max={state.custom.to} onChange={(e) => state.setCustom({ ...state.custom, from: e.target.value })} aria-label={t('range.from')} style={{ width: 150 }} />
          <span className="muted">–</span>
          <input className="input" type="date" value={state.custom.to} min={state.custom.from} onChange={(e) => state.setCustom({ ...state.custom, to: e.target.value })} aria-label={t('range.to')} style={{ width: 150 }} />
        </span>
      )}
    </div>
  );
}

export function ExportButtons<T>({ name, rows, cols }: { name: string; rows: T[] | undefined; cols: Column<T>[] }) {
  const { t } = useI18n();
  return (
    <span className="row">
      <button className="btn sm" disabled={!rows?.length} onClick={() => rows && exportCsv(name, rows, cols)}>
        <Download size={14} />
        CSV
      </button>
      <button className="btn sm" disabled={!rows?.length} onClick={() => rows && exportXlsx(name, rows, cols)} title={t('common.excel')}>
        <FileSpreadsheet size={14} />
        Excel
      </button>
    </span>
  );
}

export function WarehouseSelect({ value, onChange, label, exclude, onlyAllowed = true }: { value: string; onChange: (id: string) => void; label?: string; exclude?: string; onlyAllowed?: boolean }) {
  const { me } = useSession();
  const { t } = useI18n();
  const list = me.warehouses.filter((w) => w.id !== exclude);
  void onlyAllowed;
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label ?? t('common.warehouse')}>
      {list.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}
