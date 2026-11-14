import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { ApiError } from './api';

type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const Ctx = createContext<{ ok: (text: string) => void; error: (e: unknown) => void } | null>(null);

export function errorText(t: ReturnType<typeof useI18n>['t'], e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details as Record<string, unknown>;
    switch (e.code) {
      case 'INSUFFICIENT_STOCK':
        return d.product ? t('err.stockFor', { name: String(d.product), available: String(d.available ?? 0) }) : t('err.stock');
      case 'NO_OPEN_SHIFT':
        return t('err.noShift');
      case 'PRICE_OVERRIDE_FORBIDDEN':
        return t('err.priceOverride');
      case 'FORBIDDEN':
      case 'WAREHOUSE_FORBIDDEN':
        return t('err.forbidden');
      case 'UNAUTHENTICATED':
        return d.reason === 'BAD_CREDENTIALS' ? t('err.badCredentials') : t('err.signIn');
      case 'CONFLICT':
        return t('err.conflict');
      case 'NOT_FOUND':
        return t('err.notFound');
      case 'PAYMENT':
        return d.reason === 'CREDIT_LIMIT' ? t('err.creditLimit') : d.reason === 'DEBT_REQUIRES_CUSTOMER' ? t('err.debtCustomer') : d.reason === 'NON_CASH_OVERPAY' ? t('err.overpay') : e.message;
      case 'VALIDATION': {
        const issues = d.issues as { path: string; message: string }[] | undefined;
        return issues?.length ? `${t('err.validation')}: ${issues.map((i) => `${i.path || '—'} — ${i.message}`).join('; ')}` : `${t('err.validation')}: ${e.message}`;
      }
      case 'INVALID_STATE':
        return `${t('err.state')}: ${e.message}`;
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind']) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), kind === 'error' ? 6500 : 3500);
  }, []);
  const value = { ok: (text: string) => push(text, 'ok'), error: (e: unknown) => push(errorText(t, e), 'error') };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind === 'error' ? 'error' : ''}`}>
            {x.kind === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('ToastProvider missing');
  return c;
}
