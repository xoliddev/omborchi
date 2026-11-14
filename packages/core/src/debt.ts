/**
 * Debt (nasiya) logic for customers and suppliers.
 *
 * Charges (a credit sale, a received delivery) and payments are entries on a party's debt ledger.
 * Payments settle the oldest open charge first (FIFO by due date, then creation), which is how
 * shops reason about "which debt is overdue". Aging buckets are computed on what remains open.
 */
import { roundMoney } from './money';

export interface DebtCharge {
  id: string;
  amount: number;
  createdAt: Date;
  dueDate: Date | null;
}

export interface DebtPayment {
  amount: number;
  createdAt: Date;
}

export interface OpenItem extends DebtCharge {
  paid: number;
  remaining: number;
}

export interface DebtPosition {
  charged: number;
  paid: number;
  balance: number;
  /** Payments beyond all charges (prepayment / credit balance). */
  credit: number;
  open: OpenItem[];
}

export function allocatePayments(charges: DebtCharge[], payments: DebtPayment[]): DebtPosition {
  const ordered = [...charges].sort(
    (a, b) =>
      (a.dueDate ?? a.createdAt).getTime() - (b.dueDate ?? b.createdAt).getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  let pool = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100);
  const totalPaidCents = pool;
  const items: OpenItem[] = [];
  let chargedCents = 0;
  for (const c of ordered) {
    const cents = Math.round(c.amount * 100);
    chargedCents += cents;
    const used = Math.min(pool, cents);
    pool -= used;
    items.push({ ...c, paid: used / 100, remaining: (cents - used) / 100 });
  }
  return {
    charged: chargedCents / 100,
    paid: totalPaidCents / 100,
    balance: roundMoney(Math.max(0, chargedCents - totalPaidCents) / 100),
    credit: roundMoney(pool / 100),
    open: items.filter((i) => i.remaining > 0),
  };
}

export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

const DAY = 86_400_000;

export function daysOverdue(item: { dueDate: Date | null; createdAt: Date }, asOf: Date): number {
  const due = item.dueDate ?? item.createdAt;
  const startOfDue = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const startOfAsOf = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.floor((startOfAsOf - startOfDue) / DAY);
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

export function ageOpenItems(open: OpenItem[], asOf: Date): Record<AgingBucket, number> {
  const out: Record<AgingBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const item of open) {
    const b = agingBucket(daysOverdue(item, asOf));
    out[b] = roundMoney(out[b] + item.remaining);
  }
  return out;
}
