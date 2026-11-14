/**
 * ABC analysis, inventory count variance and FEFO batch picking.
 */
import { roundMoney, roundQty } from './money';

export type AbcClass = 'A' | 'B' | 'C';

export interface AbcItem<T> {
  item: T;
  value: number;
  share: number;
  cumulativeShare: number;
  abc: AbcClass;
}

/**
 * Classic Pareto ABC: sort by value, A = items making up the first `a`% of value,
 * B = up to `b`%, C = the rest. The item that crosses a threshold belongs to the lower class
 * boundary it starts in, so a single dominant product is always A.
 */
export function abcClassify<T>(items: T[], valueOf: (t: T) => number, thresholds = { a: 0.8, b: 0.95 }): AbcItem<T>[] {
  const sorted = items
    .map((item) => ({ item, value: Math.max(0, valueOf(item)) }))
    .sort((x, y) => y.value - x.value);
  const total = sorted.reduce((s, x) => s + x.value, 0);
  let running = 0;
  return sorted.map(({ item, value }) => {
    const before = total === 0 ? 1 : running / total;
    running += value;
    const share = total === 0 ? 0 : value / total;
    const cumulativeShare = total === 0 ? 0 : running / total;
    const abc: AbcClass = total === 0 ? 'C' : before < thresholds.a ? 'A' : before < thresholds.b ? 'B' : 'C';
    return { item, value, share, cumulativeShare, abc };
  });
}

export interface CountLine {
  variantId: string;
  expectedQty: number;
  countedQty: number | null;
  unitCost: number;
}

export interface VarianceLine extends CountLine {
  varianceQty: number;
  varianceValue: number;
  status: 'match' | 'surplus' | 'shortage' | 'uncounted';
}

export interface VarianceReport {
  lines: VarianceLine[];
  counted: number;
  uncounted: number;
  surplusQty: number;
  shortageQty: number;
  surplusValue: number;
  shortageValue: number;
  netValue: number;
  /** Share of counted lines that matched exactly (0–1). */
  accuracy: number;
}

/**
 * Variance = counted − expected (snapshot when the count started). Applying a count posts an
 * adjustment of exactly this variance, so sales made while counting are not lost.
 */
export function varianceReport(lines: CountLine[]): VarianceReport {
  let surplusQty = 0;
  let shortageQty = 0;
  let surplusValue = 0;
  let shortageValue = 0;
  let matched = 0;
  let counted = 0;
  const out: VarianceLine[] = lines.map((l) => {
    if (l.countedQty === null || l.countedQty === undefined) {
      return { ...l, varianceQty: 0, varianceValue: 0, status: 'uncounted' };
    }
    counted++;
    const varianceQty = roundQty(l.countedQty - l.expectedQty);
    const varianceValue = roundMoney(varianceQty * l.unitCost);
    if (varianceQty > 0) {
      surplusQty += varianceQty;
      surplusValue += varianceValue;
    } else if (varianceQty < 0) {
      shortageQty += -varianceQty;
      shortageValue += -varianceValue;
    } else matched++;
    return { ...l, varianceQty, varianceValue, status: varianceQty === 0 ? 'match' : varianceQty > 0 ? 'surplus' : 'shortage' };
  });
  return {
    lines: out,
    counted,
    uncounted: lines.length - counted,
    surplusQty: roundQty(surplusQty),
    shortageQty: roundQty(shortageQty),
    surplusValue: roundMoney(surplusValue),
    shortageValue: roundMoney(shortageValue),
    netValue: roundMoney(surplusValue - shortageValue),
    accuracy: counted === 0 ? 0 : matched / counted,
  };
}

export interface BatchStock {
  batchId: string;
  qty: number;
  expiresAt: Date | null;
}

/** First-expired-first-out picking. Batches without an expiry go last. */
export function pickFefo(batches: BatchStock[], qty: number): { batchId: string; qty: number }[] {
  const ordered = batches
    .filter((b) => b.qty > 0)
    .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity) || a.batchId.localeCompare(b.batchId));
  const picks: { batchId: string; qty: number }[] = [];
  let left = roundQty(qty);
  for (const b of ordered) {
    if (left <= 0) break;
    const take = roundQty(Math.min(left, b.qty));
    picks.push({ batchId: b.batchId, qty: take });
    left = roundQty(left - take);
  }
  return picks;
}

export function expiryStatus(expiresAt: Date, asOf: Date, warnDays = 30): 'expired' | 'soon' | 'ok' {
  const days = (expiresAt.getTime() - asOf.getTime()) / 86_400_000;
  if (days < 0) return 'expired';
  if (days <= warnDays) return 'soon';
  return 'ok';
}
