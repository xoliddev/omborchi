import { ArrowDownRight, ArrowUpRight, Minus, X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';

export function Panel({ title, sub, actions, children, flush, className = '' }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          <div className="grow">
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, className = '' }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

function useFocusTrap(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not([data-close])');
    (first ?? el)?.focus();
    return () => prev?.focus?.();
  }, [ref]);
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEscape(onClose);
  useFocusTrap(ref);
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="overlay-head">
          <h2 id={id} className="grow">
            {title}
          </h2>
          <CloseButton onClose={onClose} />
        </div>
        <div className="overlay-body">{children}</div>
        {footer && <div className="overlay-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export function Drawer({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEscape(onClose);
  useFocusTrap(ref);
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <aside className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="overlay-head">
          <h2 id={id} className="grow">
            {title}
          </h2>
          <CloseButton onClose={onClose} />
        </div>
        <div className="overlay-body">{children}</div>
        {footer && <div className="overlay-foot">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <button className="btn ghost icon" onClick={onClose} aria-label={t('common.close')} data-close>
      <X size={18} />
    </button>
  );
}

export function Empty({ title, children, icon }: { title: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="stack" style={{ padding: 16 }} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function Delta({ current, previous, goodWhenUp = true, label }: { current: number; previous: number; goodWhenUp?: boolean; label?: string }) {
  const { fmt } = useI18n();
  if (!previous) return <span className="delta flat">{label ?? '—'}</span>;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const dir = Math.abs(change) < 0.5 ? 'flat' : change > 0 ? 'up' : 'down';
  const good = dir === 'flat' ? 'flat' : (dir === 'up') === goodWhenUp ? 'up' : 'down';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  return (
    <span className={`delta ${good}`}>
      <Icon size={14} aria-hidden />
      {change > 0 ? '+' : ''}
      {fmt.pct(change)}
      {label && <span className="muted" style={{ fontWeight: 450 }}>&nbsp;{label}</span>}
    </span>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t, fmt } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span>
        {t('common.showing', { from: fmt.num(total === 0 ? 0 : (page - 1) * pageSize + 1), to: fmt.num(Math.min(total, page * pageSize)), total: fmt.num(total) })}
      </span>
      <span className="row">
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('common.prev')}
        </button>
        <span className="num">
          {page} / {pages}
        </span>
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('common.next')}
        </button>
      </span>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, string> = {
    completed: 'good',
    received: 'good',
    applied: 'good',
    closed: '',
    open: 'accent',
    ordered: 'accent',
    partial: 'warn',
    partially_returned: 'warn',
    returned: 'bad',
    cancelled: '',
    draft: '',
  };
  return <span className={`badge ${map[status] ?? ''}`}>{t(`status.${status}` as never)}</span>;
}
