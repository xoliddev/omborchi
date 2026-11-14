import { formatCompact, formatNumber, formatUZS, type Locale } from '@omborchi/core';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, type Key } from './en';
import { ru } from './ru';
import { uz } from './uz';

const DICTS: Record<Locale, Record<Key, string>> = { uz, ru, en };
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'uz', label: 'O‘zbekcha' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
];

const INTL: Record<Locale, string> = { uz: 'uz-Latn-UZ', ru: 'ru-RU', en: 'en-GB' };

export type T = (key: Key, vars?: Record<string, string | number>) => string;

function makeFormatters(locale: Locale) {
  const dateFmt = new Intl.DateTimeFormat(INTL[locale], { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Tashkent' });
  const shortDate = new Intl.DateTimeFormat(INTL[locale], { day: 'numeric', month: 'short', timeZone: 'Asia/Tashkent' });
  const dtFmt = new Intl.DateTimeFormat(INTL[locale], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tashkent' });
  const timeFmt = new Intl.DateTimeFormat(INTL[locale], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tashkent' });
  const toDate = (v: string | Date) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T07:00:00Z`) : new Date(v));
  return {
    money: (v: number | null | undefined) => formatUZS(v ?? 0, locale),
    amount: (v: number | null | undefined) => formatUZS(v ?? 0, locale, { withCurrency: false }),
    compact: (v: number) => formatCompact(v, locale),
    num: (v: number | null | undefined, digits = 3) => formatNumber(v ?? 0, locale, digits),
    pct: (v: number, digits = 1) => `${formatNumber(v, locale, digits)}%`,
    date: (v: string | Date | null | undefined) => (v ? dateFmt.format(toDate(v)) : '—'),
    shortDate: (v: string | Date) => shortDate.format(toDate(v)),
    dateTime: (v: string | Date | null | undefined) => (v ? dtFmt.format(new Date(v)) : '—'),
    time: (v: string | Date) => timeFmt.format(new Date(v)),
  };
}
export type Fmt = ReturnType<typeof makeFormatters>;

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: T;
  fmt: Fmt;
}
const I18nContext = createContext<Ctx | null>(null);

function initialLocale(): Locale {
  try {
    const s = localStorage.getItem('omb.locale');
    if (s === 'uz' || s === 'ru' || s === 'en') return s;
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'uz';
  return nav === 'ru' ? 'ru' : nav === 'en' ? 'en' : 'uz';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem('omb.locale', l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<Ctx>(() => {
    const dict = DICTS[locale];
    const t: T = (key, vars) => {
      let s = dict[key] ?? en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    return { locale, setLocale, t, fmt: makeFormatters(locale) };
  }, [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error('I18nProvider missing');
  return c;
}

export type { Key };
