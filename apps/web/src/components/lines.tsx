import { roundMoney } from '@omborchi/core';
import { Trash2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { itemName, ProductPicker, type CatalogItem } from './pickers';

export interface DocLine {
  variantId: string;
  name: string;
  unit: string;
  available: number;
  qty: string;
  cost: string;
  batchCode?: string;
  expiresAt?: string;
}

export function lineFromItem(i: CatalogItem, cost?: number): DocLine {
  return { variantId: i.variant_id, name: itemName(i), unit: i.unit, available: i.qty, qty: '1', cost: cost !== undefined ? String(cost) : '' };
}

/** Editable document lines (transfer, write-off, receipt, purchase order). */
export function LinesEditor({
  warehouseId,
  lines,
  onChange,
  withCost,
  withBatch,
  showAvailable,
  costOf,
}: {
  warehouseId: string;
  lines: DocLine[];
  onChange: (l: DocLine[]) => void;
  withCost?: boolean;
  withBatch?: boolean;
  showAvailable?: boolean;
  costOf?: (i: CatalogItem) => number;
}) {
  const { t, fmt } = useI18n();
  const update = (idx: number, patch: Partial<DocLine>) => onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + roundMoney((Number(l.qty) || 0) * (Number(l.cost) || 0)), 0);
  return (
    <div className="stack">
      <ProductPicker
        warehouseId={warehouseId}
        onPick={(i) => {
          const at = lines.findIndex((l) => l.variantId === i.variant_id);
          if (at >= 0) update(at, { qty: String((Number(lines[at].qty) || 0) + 1) });
          else onChange([...lines, lineFromItem(i, costOf?.(i))]);
        }}
      />
      {lines.length > 0 && (
        <div className="table-wrap panel">
          <table className="data">
            <thead>
              <tr>
                <th>{t('common.product')}</th>
                {showAvailable && <th className="right">{t('lines.available')}</th>}
                <th className="right" style={{ width: 110 }}>
                  {t('common.qty')}
                </th>
                {withCost && (
                  <th className="right" style={{ width: 130 }}>
                    {t('lines.unitCost')}
                  </th>
                )}
                {withBatch && <th style={{ width: 150 }}>{t('lines.batch')}</th>}
                {withBatch && <th style={{ width: 150 }}>{t('lines.expires')}</th>}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const over = showAvailable && Number(l.qty) > l.available;
                return (
                  <tr key={l.variantId}>
                    <td>
                      <div className="cell-title">{l.name}</div>
                      <div className="cell-sub">{l.unit}</div>
                    </td>
                    {showAvailable && <td className="right">{fmt.num(l.available)}</td>}
                    <td>
                      <input className="input num" inputMode="decimal" value={l.qty} aria-invalid={over || !(Number(l.qty) > 0)} onChange={(e) => update(idx, { qty: e.target.value.replace(',', '.') })} aria-label={t('common.qty')} />
                    </td>
                    {withCost && (
                      <td>
                        <input className="input num" inputMode="decimal" value={l.cost} onChange={(e) => update(idx, { cost: e.target.value.replace(',', '.') })} aria-label={t('lines.unitCost')} />
                      </td>
                    )}
                    {withBatch && (
                      <td>
                        <input className="input" value={l.batchCode ?? ''} placeholder={t('lines.batchAuto')} onChange={(e) => update(idx, { batchCode: e.target.value })} aria-label={t('lines.batch')} />
                      </td>
                    )}
                    {withBatch && (
                      <td>
                        <input className="input" type="date" value={l.expiresAt ?? ''} onChange={(e) => update(idx, { expiresAt: e.target.value })} aria-label={t('lines.expires')} />
                      </td>
                    )}
                    <td>
                      <button className="btn ghost icon sm" onClick={() => onChange(lines.filter((_, i) => i !== idx))} aria-label={t('common.remove')}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {withCost && (
              <tfoot>
                <tr>
                  <td colSpan={showAvailable ? 3 : 2}>{t('common.total')}</td>
                  <td className="right">{fmt.money(total)}</td>
                  <td colSpan={withBatch ? 3 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

export function linesValid(lines: DocLine[], opts: { checkAvailable?: boolean } = {}) {
  return lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && (!opts.checkAvailable || Number(l.qty) <= l.available));
}
