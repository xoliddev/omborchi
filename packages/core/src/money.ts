/**
 * Money & quantity arithmetic.
 *
 * Money is UZS with 2 decimal places (tiyin); quantities have 3 decimals
 * (grams, millimetres); unit costs keep 4 decimals so weighted averages stay precise.
 * We round at every boundary so floating point noise never accumulates into the ledger.
 */
export const MONEY_SCALE = 100;
export const QTY_SCALE = 1000;
export const COST_SCALE = 10000;

function roundTo(value: number, scale: number): number {
  const r = Math.round(Math.abs(value) * scale + 1e-9) / scale;
  return value < 0 ? -r : r;
}

export const roundMoney = (value: number): number => roundTo(value, MONEY_SCALE);
export const roundQty = (value: number): number => roundTo(value, QTY_SCALE);
export const roundCost = (value: number): number => roundTo(value, COST_SCALE);

export function sumMoney(values: Iterable<number>): number {
  let cents = 0;
  for (const v of values) cents += Math.round(v * MONEY_SCALE);
  return cents / MONEY_SCALE;
}

export function sumQty(values: Iterable<number>): number {
  let milli = 0;
  for (const v of values) milli += Math.round(v * QTY_SCALE);
  return milli / QTY_SCALE;
}

/** Split `total` into parts proportional to `weights` so the parts sum exactly to `total` (largest remainder method). */
export function allocateProportionally(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const cents = Math.round(total * MONEY_SCALE);
  const weightSum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (weightSum === 0) {
    const out = weights.map(() => 0);
    out[0] = cents / MONEY_SCALE;
    return out;
  }
  const raw = weights.map((w) => (Math.max(0, w) / weightSum) * cents);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = cents - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floored[i] += 1;
    remainder -= 1;
  }
  return floored.map((c) => c / MONEY_SCALE);
}

export type Locale = 'uz' | 'ru' | 'en';

const INTL_LOCALE: Record<Locale, string> = { uz: 'uz-Latn-UZ', ru: 'ru-RU', en: 'en-US' };

export function formatNumber(value: number, locale: Locale = 'uz', maxFractionDigits = 2): string {
  const formatted = new Intl.NumberFormat(INTL_LOCALE[locale] ?? 'uz-Latn-UZ', {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
  // Normalise narrow no-break spaces to regular no-break spaces (thermal printers choke on U+202F).
  return formatted.replace(/ /g, ' ');
}

/** "125 000 so'm" / "125 000 сум" / "125,000 UZS" */
export function formatUZS(value: number, locale: Locale = 'uz', opts: { withCurrency?: boolean; decimals?: boolean } = {}): string {
  const { withCurrency = true, decimals = false } = opts;
  const n = formatNumber(decimals ? roundMoney(value) : Math.round(value), locale, decimals ? 2 : 0);
  if (!withCurrency) return n;
  if (locale === 'en') return `${n} UZS`;
  if (locale === 'ru') return `${n} сум`;
  return `${n} so'm`;
}

/** Compact amounts for axes and tiles: 1,2 mln / 12 mlrd */
export function formatCompact(value: number, locale: Locale = 'uz'): string {
  const abs = Math.abs(value);
  const units =
    locale === 'en'
      ? [{ v: 1e12, s: 'T' }, { v: 1e9, s: 'B' }, { v: 1e6, s: 'M' }, { v: 1e3, s: 'K' }]
      : locale === 'ru'
        ? [{ v: 1e12, s: ' трлн' }, { v: 1e9, s: ' млрд' }, { v: 1e6, s: ' млн' }, { v: 1e3, s: ' тыс' }]
        : [{ v: 1e12, s: ' trln' }, { v: 1e9, s: ' mlrd' }, { v: 1e6, s: ' mln' }, { v: 1e3, s: ' ming' }];
  for (const u of units) {
    if (abs >= u.v) return `${formatNumber(value / u.v, locale, abs / u.v >= 100 ? 0 : 1)}${u.s}`;
  }
  return formatNumber(Math.round(value), locale, 0);
}
