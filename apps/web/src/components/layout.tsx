import type { Permission } from '@omborchi/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  PackageMinus,
  Receipt,
  RotateCcw,
  Settings,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useDemo } from '../demo/DemoGate';
import { LOCALES, useI18n, type Key } from '../i18n';
import { api, authRequest, IS_DEMO } from '../lib/api';
import { useSession } from '../lib/session';

const NAV: { to: string; icon: typeof Package; label: Key; perm: Permission; group?: Key }[] = [
  { to: '/', icon: LayoutDashboard, label: 'nav.dashboard', perm: 'reports.view' },
  { to: '/pos', icon: ShoppingCart, label: 'nav.pos', perm: 'sales.create' },
  { to: '/sales', icon: Receipt, label: 'nav.sales', perm: 'sales.view' },
  { to: '/customers', icon: Users, label: 'nav.customers', perm: 'customers.view' },
  { to: '/products', icon: Package, label: 'nav.products', perm: 'catalog.view', group: 'nav.group.stock' },
  { to: '/stock', icon: Boxes, label: 'nav.stock', perm: 'stock.view' },
  { to: '/transfers', icon: ArrowLeftRight, label: 'nav.transfers', perm: 'stock.view' },
  { to: '/write-offs', icon: PackageMinus, label: 'nav.writeOffs', perm: 'stock.view' },
  { to: '/counts', icon: ClipboardCheck, label: 'nav.counts', perm: 'stock.view' },
  { to: '/alerts', icon: Bell, label: 'nav.alerts', perm: 'stock.view' },
  { to: '/purchasing', icon: Truck, label: 'nav.purchasing', perm: 'purchasing.view', group: 'nav.group.buy' },
  { to: '/suppliers', icon: Warehouse, label: 'nav.suppliers', perm: 'purchasing.view' },
  { to: '/reports', icon: BarChart3, label: 'nav.reports', perm: 'reports.view', group: 'nav.group.insight' },
  { to: '/audit', icon: FileClock, label: 'nav.audit', perm: 'audit.view' },
  { to: '/settings', icon: Settings, label: 'nav.settings', perm: 'users.manage' },
];

export function homePath(can: (p: Permission) => boolean) {
  return NAV.find((n) => can(n.perm))?.to ?? '/pos';
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const d = document.documentElement.dataset.theme;
    if (d === 'dark' || d === 'light') return d;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('omb.theme', next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };
  return { theme, toggle };
}

export function Layout() {
  const { t } = useI18n();
  const { can, me } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const alerts = useQuery({ queryKey: ['alerts.list', {}], queryFn: () => api.call('alerts.list', {}), enabled: can('stock.view'), staleTime: 60_000 });
  const alertCount = (alerts.data?.lowStock.length ?? 0) + (alerts.data?.expiring.length ?? 0);
  let lastGroup: Key | undefined;
  return (
    <>
      {IS_DEMO && <DemoBar />}
      <div className={`shell ${IS_DEMO ? 'has-demo' : ''}`}>
        <nav className={`sidebar ${open ? 'open' : ''}`} aria-label={t('nav.main')}>
          <NavLink to="/" className="brand" end>
            <Logo />
            <span>
              Omborchi
              <small>{me.org.name}</small>
            </span>
          </NavLink>
          {NAV.filter((n) => can(n.perm)).map((n) => {
            const header = n.group && n.group !== lastGroup ? n.group : null;
            if (n.group) lastGroup = n.group;
            const Icon = n.icon;
            return (
              <div key={n.to} style={{ display: 'contents' }}>
                {header && <div className="nav-group">{t(header)}</div>}
                <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Icon size={17} />
                  {t(n.label)}
                  {n.to === '/alerts' && alertCount > 0 && <span className="count num">{alertCount}</span>}
                </NavLink>
              </div>
            );
          })}
          <SidebarFoot />
        </nav>
        {open && <div className="overlay" style={{ zIndex: 69 }} onClick={() => setOpen(false)} />}
        <div className="main">
          <MenuContext.Provider value={() => setOpen(true)}>
            <Outlet />
          </MenuContext.Provider>
        </div>
      </div>
    </>
  );
}

const MenuContext = createContext<() => void>(() => undefined);

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M8 11.5 16 7l8 4.5v9L16 25l-8-4.5z" fill="none" stroke="var(--accent-ink)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M8 11.5 16 16l8-4.5M16 16v9" fill="none" stroke="var(--accent-ink)" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

function SidebarFoot() {
  const { t, locale, setLocale } = useI18n();
  const { me } = useSession();
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();
  return (
    <div className="sidebar-foot">
      <div className="row">
        <select className="select grow" value={locale} onChange={(e) => setLocale(e.target.value as never)} aria-label={t('common.language')} style={{ height: 30 }}>
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <button className="btn icon sm" onClick={toggle} aria-label={t(theme === 'dark' ? 'common.lightMode' : 'common.darkMode')} title={t(theme === 'dark' ? 'common.lightMode' : 'common.darkMode')}>
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
      <div className="row small" style={{ padding: '4px 6px' }}>
        <div className="grow">
          <div className="ellipsis" style={{ fontWeight: 560 }}>
            {me.user.name}
          </div>
          <div className="muted ellipsis">{t(`role.${me.role}` as Key)}</div>
        </div>
        {!IS_DEMO && (
          <button
            className="btn ghost icon sm"
            aria-label={t('auth.signOut')}
            title={t('auth.signOut')}
            onClick={async () => {
              await authRequest('logout');
              qc.clear();
              location.href = '/';
            }}
          >
            <LogOut size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

export function PageHeader({ title, actions, back }: { title: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  const { t } = useI18n();
  const openMenu = useContext(MenuContext);
  const { me, warehouseId, setWarehouseId } = useSession();
  useEffect(() => {
    if (typeof title === 'string') document.title = `${title} · Omborchi`;
  }, [title]);
  return (
    <header className="topbar">
      <button className="btn ghost icon menu-btn" onClick={openMenu} aria-label={t('nav.menu')}>
        <Menu size={19} />
      </button>
      {back}
      <h1 className="grow ellipsis">{title}</h1>
      {actions}
      {me.warehouses.length > 1 && (
        <select className="select hide-sm" style={{ width: 'auto', maxWidth: 220 }} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label={t('common.warehouse')}>
          {me.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      )}
    </header>
  );
}

function DemoBar() {
  const { t } = useI18n();
  const demo = useDemo();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <div className="demo-bar no-print" role="note">
      <span className="dot" aria-hidden />
      <span className="demo-text grow">
        <b>{t('demo.mode')}</b>
        <span className="hide-xs"> — {t('demo.inBrowser')}</span>
      </span>
      <label className="row" style={{ gap: 6 }}>
        <span className="hide-xs">{t('demo.viewAs')}</span>
        <select
          value={demo.userId ?? ''}
          aria-label={t('demo.viewAs')}
          onChange={(e) => {
            demo.setUser(e.target.value);
            qc.clear();
          }}
        >
          {demo.users.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.name} · {t(`role.${u.role}` as Key)}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy}
        onClick={async () => {
          if (!confirm(t('demo.resetConfirm'))) return;
          setBusy(true);
          await demo.reset();
          qc.clear();
          setBusy(false);
        }}
        title={t('demo.reset')}
      >
        <span className="row" style={{ gap: 5 }}>
          <RotateCcw size={13} />
          <span className="hide-xs">{busy ? t('demo.resetting') : t('demo.reset')}</span>
        </span>
      </button>
    </div>
  );
}
