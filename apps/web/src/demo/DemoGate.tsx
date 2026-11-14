import { Cpu, Database, ShieldCheck } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Logo } from '../components/layout';
import { useI18n } from '../i18n';
import { IS_DEMO, setTransport } from '../lib/api';
import type { DemoBackend, DemoUser } from './transport';

interface DemoCtx {
  users: DemoUser[];
  userId: string | null;
  setUser: (id: string) => void;
  reset: () => Promise<void>;
}
const Ctx = createContext<DemoCtx>({ users: [], userId: null, setUser: () => undefined, reset: async () => undefined });
export const useDemo = () => useContext(Ctx);

export function DemoGate({ children }: { children: ReactNode }) {
  if (!IS_DEMO) return <>{children}</>;
  return <DemoBoot>{children}</DemoBoot>;
}

function DemoBoot({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const backend = useRef<DemoBackend | null>(null);
  const [state, setState] = useState<{ ready: boolean; users: DemoUser[]; error?: string }>({ ready: false, users: [] });
  const [progress, setProgress] = useState<{ fraction: number; label: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { DemoBackend } = await import('./transport');
        const b = (backend.current ??= new DemoBackend());
        b.onProgress((fraction, label) => setProgress({ fraction, label }));
        const r = await b.init();
        if (cancelled) return;
        if (!b.userId || !r.users.some((u) => u.userId === b.userId)) b.setUser(r.users[0]?.userId ?? null);
        setUserId(b.userId);
        setTransport(b);
        setState({ ready: true, users: r.users });
      } catch (e) {
        setState({ ready: false, users: [], error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state.ready) {
    const pct = Math.round((progress?.fraction ?? 0.02) * 100);
    return (
      <div className="splash">
        <div className="splash-card">
          <div className="row" style={{ gap: 12 }}>
            <Logo size={40} />
            <div>
              <h1>Omborchi</h1>
              <p className="muted">{t('demo.mode')}</p>
            </div>
          </div>
          {state.error ? (
            <div className="callout bad">{t('demo.failed', { error: state.error })}</div>
          ) : (
            <>
              <div>
                <p style={{ fontWeight: 560 }}>{progress ? t(`demo.step.${progress.label}` as never) : t('demo.starting')}</p>
                <p className="muted small">{t('demo.firstVisit')}</p>
              </div>
              <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="ledger-ticks small">
                <div>
                  <Database size={16} />
                  <b>PGlite</b>
                  <span className="muted">{t('demo.tickDb')}</span>
                </div>
                <div>
                  <Cpu size={16} />
                  <b>Worker</b>
                  <span className="muted">{t('demo.tickWorker')}</span>
                </div>
                <div>
                  <ShieldCheck size={16} />
                  <b>0 bytes</b>
                  <span className="muted">{t('demo.tickPrivate')}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const value: DemoCtx = {
    users: state.users,
    userId,
    setUser: (id) => {
      backend.current?.setUser(id);
      setUserId(id);
    },
    reset: async () => {
      setProgress(null);
      setState((s) => ({ ...s, ready: false }));
      const r = await backend.current!.reset();
      backend.current!.setUser(r.users[0]?.userId ?? null);
      setUserId(backend.current!.userId);
      setState({ ready: true, users: r.users });
    },
  };
  return (
    <Ctx.Provider value={value} key={userId ?? 'none'}>
      {children}
    </Ctx.Provider>
  );
}
