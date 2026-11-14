/**
 * Typed API client. Every call names a route from the shared route table, so inputs and outputs
 * are type-checked end to end. In server mode it speaks HTTP to Fastify; in demo mode the very
 * same route handlers run in a Web Worker against PGlite.
 */
import { fillPath, routes, type RouteInput, type RouteOutput, type Routes } from '@omborchi/app/client';

export const IS_DEMO = import.meta.env.VITE_DEMO === 'true';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Transport {
  call(name: string, input: unknown): Promise<unknown>;
}

const httpTransport: Transport = {
  async call(name, input) {
    const def = routes[name as keyof Routes];
    const data = { ...(input as Record<string, unknown>) };
    const path = fillPath(def.path, data);
    for (const m of def.path.matchAll(/:([a-zA-Z]+)/g)) delete data[m[1]];
    let url = `/api${path}`;
    const init: RequestInit = { method: def.method, credentials: 'same-origin', headers: {} };
    if (def.method === 'GET') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      if ([...qs].length) url += `?${qs}`;
    } else {
      init.body = JSON.stringify(data);
      init.headers = { 'content-type': 'application/json' };
    }
    const res = await fetch(url, init);
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(body?.error?.code ?? 'INTERNAL', body?.error?.message ?? res.statusText, res.status, body?.error?.details ?? {});
    return body;
  },
};

let transport: Transport = httpTransport;
export function setTransport(t: Transport) {
  transport = t;
}

export const api = {
  call<K extends keyof Routes>(name: K, input: RouteInput<Routes[K]>): Promise<RouteOutput<Routes[K]>> {
    return transport.call(name, input) as Promise<RouteOutput<Routes[K]>>;
  },
};

export type Out<K extends keyof Routes> = RouteOutput<Routes[K]>;
export type In<K extends keyof Routes> = RouteInput<Routes[K]>;

export async function authRequest(path: 'login' | 'register' | 'logout', body: unknown = {}) {
  const res = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.code ?? 'INTERNAL', json?.error?.message ?? res.statusText, res.status, json?.error?.details ?? {});
  return json;
}
