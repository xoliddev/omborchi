/** Date helpers. Business days are in Asia/Tashkent (UTC+5, no DST). */
export const TASHKENT_OFFSET_MIN = 5 * 60;

/** YYYY-MM-DD of a timestamp in Tashkent time. */
export function tashkentDay(d: Date): string {
  return new Date(d.getTime() + TASHKENT_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** UTC instant at 00:00 Tashkent on the given YYYY-MM-DD. */
export function startOfTashkentDay(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - TASHKENT_OFFSET_MIN * 60_000);
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function formatDocNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, '0')}`;
}
