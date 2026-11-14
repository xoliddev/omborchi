import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import type { Out } from '../lib/api';

export type SaleDetail = Out<'sales.get'>;

export function BarcodeSvg({ value, format = 'CODE128', height = 36, width = 1.4, displayValue = true }: { value: string; format?: 'CODE128' | 'EAN13'; height?: number; width?: number; displayValue?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format, height, width, displayValue, margin: 0, fontSize: 11, background: 'transparent' });
    } catch {
      JsBarcode(ref.current, value, { format: 'CODE128', height, width, displayValue, margin: 0, fontSize: 11, background: 'transparent' });
    }
  }, [value, format, height, width, displayValue]);
  return <svg ref={ref} aria-label={value} />;
}

/** Thermal receipt layout (58 mm or 80 mm paper). */
export function Receipt({ sale, width = 80, settings }: { sale: SaleDetail; width?: 58 | 80; settings?: Record<string, unknown> }) {
  const { t, fmt } = useI18n();
  const methodLabel = (m: string) => t(`pay.${m}` as never);
  return (
    <div className={`receipt ${width === 58 ? 'w58' : ''}`}>
      <div className="r-center">
        <div className="r-title">{sale.org_name}</div>
        <div>{sale.warehouse}</div>
        {sale.warehouse_address && <div>{sale.warehouse_address}</div>}
        {typeof settings?.phone === 'string' && <div>{settings.phone}</div>}
        {typeof settings?.inn === 'string' && <div>{t('receipt.inn')}: {settings.inn}</div>}
      </div>
      <div className="r-sep" />
      <div className="r-row">
        <span>{t('receipt.number')}</span>
        <span>{sale.number}</span>
      </div>
      <div className="r-row">
        <span>{t('common.date')}</span>
        <span>{fmt.dateTime(sale.created_at)}</span>
      </div>
      <div className="r-row">
        <span>{t('receipt.cashier')}</span>
        <span>{sale.cashier}</span>
      </div>
      {sale.customer && (
        <div className="r-row">
          <span>{t('common.customer')}</span>
          <span>{sale.customer}</span>
        </div>
      )}
      <div className="r-sep" />
      {sale.lines.map((l) => (
        <div key={l.id} style={{ marginBottom: 4 }}>
          <div>{l.name}</div>
          <div className="r-row">
            <span>
              {fmt.num(l.qty)} {l.unit_code} × {fmt.amount(l.unit_price)}
            </span>
            <span>{fmt.amount(l.total)}</span>
          </div>
          {l.discount > 0 && (
            <div className="r-row">
              <span>{t('pos.discount')}</span>
              <span>−{fmt.amount(l.discount)}</span>
            </div>
          )}
        </div>
      ))}
      <div className="r-sep" />
      {sale.discount_total > 0 && (
        <>
          <div className="r-row">
            <span>{t('pos.subtotal')}</span>
            <span>{fmt.amount(sale.subtotal)}</span>
          </div>
          <div className="r-row">
            <span>{t('pos.discount')}</span>
            <span>−{fmt.amount(sale.discount_total)}</span>
          </div>
        </>
      )}
      <div className="r-row r-total">
        <span>{t('pos.total')}</span>
        <span>{fmt.money(sale.total)}</span>
      </div>
      {sale.payments.map((p) => (
        <div className="r-row" key={p.method}>
          <span>
            {methodLabel(p.method)}
            {p.provider_ref ? ` (${p.provider_ref})` : ''}
          </span>
          <span>{fmt.amount(p.amount)}</span>
        </div>
      ))}
      {sale.change > 0 && (
        <div className="r-row">
          <span>{t('pos.change')}</span>
          <span>{fmt.amount(sale.change)}</span>
        </div>
      )}
      {sale.debt > 0 && (
        <div className="r-row">
          <span>
            {t('pos.debt')} ({t('pos.due')} {fmt.date(sale.due_date)})
          </span>
          <span>{fmt.amount(sale.debt)}</span>
        </div>
      )}
      <div className="r-sep" />
      <div className="r-center">{typeof settings?.receiptFooter === 'string' ? settings.receiptFooter : t('receipt.thanks')}</div>
      <BarcodeSvg value={sale.number} height={width === 58 ? 28 : 36} width={width === 58 ? 1.1 : 1.4} />
    </div>
  );
}

export function receiptText(sale: SaleDetail, fmt: ReturnType<typeof useI18n>['fmt'], t: ReturnType<typeof useI18n>['t']) {
  const lines = [
    sale.org_name,
    `${t('receipt.number')} ${sale.number} · ${fmt.dateTime(sale.created_at)}`,
    '',
    ...sale.lines.map((l) => `${l.name}\n  ${fmt.num(l.qty)} ${l.unit_code} × ${fmt.amount(l.unit_price)} = ${fmt.amount(l.total)}`),
    '',
    `${t('pos.total')}: ${fmt.money(sale.total)}`,
    ...(sale.debt > 0 ? [`${t('pos.debt')}: ${fmt.money(sale.debt)} (${t('pos.due')} ${fmt.date(sale.due_date)})`] : []),
    t('receipt.thanks'),
  ];
  return lines.join('\n');
}

export async function shareReceipt(sale: SaleDetail, fmt: ReturnType<typeof useI18n>['fmt'], t: ReturnType<typeof useI18n>['t']): Promise<'shared' | 'copied'> {
  const text = receiptText(sale, fmt, t);
  if (navigator.share) {
    try {
      await navigator.share({ title: `${sale.org_name} — ${sale.number}`, text });
      return 'shared';
    } catch {
      /* cancelled → fall back to copy */
    }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

export function printReceipt(saleId: string, width: 58 | 80) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  window.open(`${base}/receipt/${saleId}?w=${width}&print=1`, '_blank', 'noopener,width=420,height=720');
}
