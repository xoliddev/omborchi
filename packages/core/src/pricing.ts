/**
 * Cart pricing: line discounts, a cart-level discount spread proportionally over lines
 * (so per-product revenue and profit stay exact), and unit-of-measure conversion.
 */
import { allocateProportionally, roundMoney, roundQty, sumMoney } from './money';

export type Discount = { type: 'percent'; value: number } | { type: 'amount'; value: number };

export interface CartLineInput {
  /** Price per sale unit (e.g. per box when selling boxes). */
  unitPrice: number;
  /** Quantity in sale units. */
  qty: number;
  /** How many base units one sale unit contains (1 for the base unit, 12 for a box of 12…). */
  unitFactor?: number;
  discount?: Discount | null;
}

export interface PricedLine {
  qty: number;
  baseQty: number;
  unitPrice: number;
  gross: number;
  lineDiscount: number;
  cartDiscountShare: number;
  /** Final amount the customer pays for this line. */
  total: number;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: number;
  lineDiscountTotal: number;
  cartDiscount: number;
  discountTotal: number;
  total: number;
}

export class PricingError extends Error {
  constructor(
    public readonly code: 'INVALID_DISCOUNT' | 'INVALID_QTY' | 'INVALID_PRICE',
    message: string,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

export function discountAmount(base: number, discount: Discount | null | undefined): number {
  if (!discount || discount.value === 0) return 0;
  if (discount.value < 0) throw new PricingError('INVALID_DISCOUNT', 'Discount cannot be negative');
  if (discount.type === 'percent') {
    if (discount.value > 100) throw new PricingError('INVALID_DISCOUNT', 'Discount cannot exceed 100%');
    return roundMoney((base * discount.value) / 100);
  }
  if (discount.value > base + 1e-9) throw new PricingError('INVALID_DISCOUNT', 'Discount cannot exceed the amount');
  return roundMoney(discount.value);
}

export function toBaseQty(qty: number, unitFactor = 1): number {
  return roundQty(qty * unitFactor);
}

export function priceCart(lines: CartLineInput[], cartDiscount?: Discount | null): PricedCart {
  const prelim = lines.map((l) => {
    if (!(l.qty > 0) || !Number.isFinite(l.qty)) throw new PricingError('INVALID_QTY', 'Quantity must be positive');
    if (!(l.unitPrice >= 0)) throw new PricingError('INVALID_PRICE', 'Price must be zero or positive');
    const gross = roundMoney(l.unitPrice * l.qty);
    const lineDiscount = discountAmount(gross, l.discount);
    return { l, gross, lineDiscount, net: roundMoney(gross - lineDiscount) };
  });
  const subtotal = sumMoney(prelim.map((p) => p.gross));
  const lineDiscountTotal = sumMoney(prelim.map((p) => p.lineDiscount));
  const afterLines = roundMoney(subtotal - lineDiscountTotal);
  const cartDisc = discountAmount(afterLines, cartDiscount);
  const shares = allocateProportionally(cartDisc, prelim.map((p) => p.net));
  const priced: PricedLine[] = prelim.map((p, i) => ({
    qty: roundQty(p.l.qty),
    baseQty: toBaseQty(p.l.qty, p.l.unitFactor ?? 1),
    unitPrice: roundMoney(p.l.unitPrice),
    gross: p.gross,
    lineDiscount: p.lineDiscount,
    cartDiscountShare: shares[i] ?? 0,
    total: roundMoney(p.net - (shares[i] ?? 0)),
  }));
  const total = sumMoney(priced.map((p) => p.total));
  return {
    lines: priced,
    subtotal,
    lineDiscountTotal,
    cartDiscount: cartDisc,
    discountTotal: roundMoney(lineDiscountTotal + cartDisc),
    total,
  };
}

/** Gross margin % (0–100) — returns 0 when revenue is 0. */
export function marginPercent(revenue: number, cost: number): number {
  if (revenue === 0) return 0;
  return Math.round(((revenue - cost) / revenue) * 1000) / 10;
}
