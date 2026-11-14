import { useI18n } from '../i18n';
import type { Out } from '../lib/api';

type Entry = Out<'customers.get'>['entries'][number];
type Summary = Out<'customers.get'>['summary'];

export function DebtSummaryTiles({ summary, owedLabel }: { summary: Summary; owedLabel: string }) {
  const { t, fmt } = useI18n();
  return (
    <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
      <div className="kpi">
        <div className="label">{owedLabel}</div>
        <div className="value">{fmt.money(Math.max(0, summary.balance))}</div>
      </div>
      <div className="kpi">
        <div className="label">{t('party.overdue')}</div>
        <div className="value" style={{ color: summary.overdue > 0 ? 'var(--bad)' : undefined }}>
          {fmt.money(summary.overdue)}
        </div>
      </div>
      <div className="kpi">
        <div className="label">{t('party.nextDue')}</div>
        <div className="value" style={{ fontSize: 18 }}>
          {summary.nextDue ? fmt.date(summary.nextDue) : '—'}
        </div>
      </div>
    </div>
  );
}

export function LedgerTable({ entries, chargeLabel }: { entries: Entry[]; chargeLabel: string }) {
  const { t, fmt } = useI18n();
  if (!entries.length) return <p className="muted">{t('party.noEntries')}</p>;
  return (
    <div className="table-wrap panel" style={{ maxHeight: 420 }}>
      <table className="data">
        <thead>
          <tr>
            <th>{t('common.date')}</th>
            <th>{t('party.entry')}</th>
            <th className="right">{chargeLabel}</th>
            <th className="right">{t('party.payment')}</th>
            <th className="right">{t('common.balance')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="nowrap">{fmt.dateTime(e.created_at)}</td>
              <td>
                <div className="cell-title">{e.note ?? (e.kind === 'payment' ? t('party.payment') : chargeLabel)}</div>
                <div className="cell-sub">
                  {e.method ? t(`pay.${e.method}` as never) : ''}
                  {e.due_date ? ` · ${t('pos.due')} ${fmt.date(e.due_date)}` : ''}
                  {e.user_name ? ` · ${e.user_name}` : ''}
                </div>
              </td>
              <td className="right">{e.kind === 'charge' ? fmt.amount(e.amount) : ''}</td>
              <td className="right" style={{ color: 'var(--good)' }}>
                {e.kind === 'payment' ? fmt.amount(e.amount) : ''}
              </td>
              <td className="right">{fmt.amount(e.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
