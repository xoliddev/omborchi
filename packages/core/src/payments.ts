/**
 * Payment settlement for a sale: mixed methods, change from cash only, the rest as debt (nasiya).
 */
import { roundMoney, sumMoney } from './money';

export const PAYMENT_METHODS = ['cash', 'card', 'payme', 'click', 'uzum'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
}

export interface Settlement {
  /** Amount applied to the sale (never more than the total). */
  paid: number;
  /** Cash handed back to the customer. */
  change: number;
  /** Unpaid remainder that becomes customer debt. */
  debt: number;
  /** Payments as applied (cash reduced by change). */
  applied: PaymentInput[];
}

export class PaymentError extends Error {
  constructor(
    public readonly code: 'INVALID_AMOUNT' | 'NON_CASH_OVERPAY' | 'DEBT_REQUIRES_CUSTOMER',
    message: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export function settle(total: number, payments: PaymentInput[], opts: { hasCustomer: boolean }): Settlement {
  for (const p of payments) {
    if (!(p.amount > 0) || !Number.isFinite(p.amount)) throw new PaymentError('INVALID_AMOUNT', 'Payment amount must be positive');
  }
  const nonCash = sumMoney(payments.filter((p) => p.method !== 'cash').map((p) => p.amount));
  if (nonCash > total + 1e-9) {
    throw new PaymentError('NON_CASH_OVERPAY', 'Card and online payments cannot exceed the total');
  }
  const cash = sumMoney(payments.filter((p) => p.method === 'cash').map((p) => p.amount));
  const cashNeeded = roundMoney(Math.max(0, total - nonCash));
  const cashApplied = Math.min(cash, cashNeeded);
  const change = roundMoney(cash - cashApplied);
  const paid = roundMoney(nonCash + cashApplied);
  const debt = roundMoney(total - paid);
  if (debt > 0 && !opts.hasCustomer) {
    throw new PaymentError('DEBT_REQUIRES_CUSTOMER', 'Choose a customer to sell on credit (nasiya)');
  }
  // Collapse the cash payments into one applied cash row.
  const applied: PaymentInput[] = payments.filter((p) => p.method !== 'cash').map((p) => ({ ...p, amount: roundMoney(p.amount) }));
  if (cashApplied > 0) applied.unshift({ method: 'cash', amount: roundMoney(cashApplied) });
  return { paid, change, debt, applied };
}

/**
 * Pluggable payment provider interface. Cash and card are settled at the counter; Payme, Click
 * and Uzum are integrations whose real implementations live server-side (merchant API keys).
 * The bundled implementations are simulators that approve instantly with a fake reference.
 */
export interface PaymentProvider {
  id: PaymentMethod;
  label: string;
  kind: 'cash' | 'card' | 'online';
  /** True when the integration is a placeholder (no real money moves). */
  simulated: boolean;
  authorize(input: { amount: number; reference: string }): Promise<{ status: 'approved' | 'declined'; providerRef: string | null }>;
}

function simulated(id: PaymentMethod, label: string): PaymentProvider {
  return {
    id,
    label,
    kind: 'online',
    simulated: true,
    async authorize({ amount, reference }) {
      if (!(amount > 0)) return { status: 'declined', providerRef: null };
      const tail = Math.abs(hash(`${id}:${reference}:${amount}`)).toString(36).toUpperCase().padStart(6, '0').slice(0, 8);
      return { status: 'approved', providerRef: `${id.toUpperCase()}-${tail}` };
    },
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

export const PAYMENT_PROVIDERS: Record<PaymentMethod, PaymentProvider> = {
  cash: { id: 'cash', label: 'Naqd', kind: 'cash', simulated: false, authorize: async () => ({ status: 'approved', providerRef: null }) },
  card: { id: 'card', label: 'Karta (Uzcard/Humo)', kind: 'card', simulated: false, authorize: async () => ({ status: 'approved', providerRef: null }) },
  payme: simulated('payme', 'Payme'),
  click: simulated('click', 'Click'),
  uzum: simulated('uzum', 'Uzum'),
};
