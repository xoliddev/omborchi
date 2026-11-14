import type { Permission } from '@omborchi/core';
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Out } from './api';

export type Me = Out<'me'>;

interface SessionCtx {
  me: Me;
  can: (p: Permission) => boolean;
  warehouseId: string;
  setWarehouseId: (id: string) => void;
  warehouse: Me['warehouses'][number] | undefined;
  stores: Me['warehouses'];
}

const Ctx = createContext<SessionCtx | null>(null);

export function useMeQuery() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.call('me', {}), retry: false, staleTime: 60_000 });
}

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const key = `omb.wh.${me.user.id}`;
  const [warehouseId, setWh] = useState<string>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(key);
    } catch {
      /* ignore */
    }
    return saved && me.warehouses.some((w) => w.id === saved) ? saved : (me.warehouses.find((w) => w.kind === 'store') ?? me.warehouses[0])?.id ?? '';
  });
  useEffect(() => {
    if (!me.warehouses.some((w) => w.id === warehouseId)) setWh((me.warehouses.find((w) => w.kind === 'store') ?? me.warehouses[0])?.id ?? '');
  }, [me, warehouseId]);
  const setWarehouseId = useCallback(
    (id: string) => {
      setWh(id);
      try {
        localStorage.setItem(key, id);
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  const value = useMemo<SessionCtx>(() => {
    const perms = new Set(me.permissions);
    return {
      me,
      can: (p) => perms.has(p),
      warehouseId,
      setWarehouseId,
      warehouse: me.warehouses.find((w) => w.id === warehouseId),
      stores: me.warehouses.filter((w) => w.kind === 'store'),
    };
  }, [me, warehouseId, setWarehouseId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
}
