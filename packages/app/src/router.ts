/**
 * Transport-agnostic route layer.
 *
 * Every API operation is declared once here — name, HTTP method + path, permission, zod input and
 * handler. Fastify mounts these as REST endpoints; the demo build calls `dispatch` directly against
 * PGlite in the browser. Same validation, same permissions, same SQL, same audit log.
 */
import { can, canAccessWarehouse, type Permission, type Role } from '@omborchi/core';
import type { Db } from '@omborchi/db';
import { z } from 'zod';
import { AppError, toAppError } from './errors';

export interface Actor {
  userId: string;
  orgId: string;
  role: Role;
  /** null = every warehouse */
  warehouseIds: string[] | null;
  name: string;
  email: string;
}

export interface Ctx {
  db: Db;
  actor: Actor;
  now: () => Date;
  /** Injected by the server (scrypt); the demo uses a stub since it has no login. */
  hashPassword: (password: string) => Promise<string>;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RouteDef<S extends z.ZodType = z.ZodType, O = unknown> {
  method: Method;
  path: string;
  /** 'member' = any active member of the organisation. */
  permission: Permission | 'member';
  input: S;
  /** Mutations are audited automatically under this action name. */
  audit?: { action: string; entity: string };
  handler: (ctx: Ctx, input: z.output<S>) => Promise<O>;
}

export function route<S extends z.ZodType, O>(def: RouteDef<S, O>): RouteDef<S, O> {
  return def;
}

export type RouteInput<R> = R extends RouteDef<infer S, unknown> ? z.input<S> : never;
export type RouteOutput<R> = R extends RouteDef<z.ZodType, infer O> ? O : never;

export function assertWarehouse(ctx: Ctx, warehouseId: string) {
  if (!canAccessWarehouse({ role: ctx.actor.role, warehouseIds: ctx.actor.warehouseIds }, warehouseId)) {
    throw new AppError('WAREHOUSE_FORBIDDEN', 'No access to this warehouse', { warehouseId });
  }
}

export function assertCan(ctx: Ctx, permission: Permission) {
  if (!can(ctx.actor.role, permission)) throw new AppError('FORBIDDEN', `Missing permission ${permission}`, { permission });
}

const SENSITIVE = /password|token|secret/i;
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.length > 50 ? { items: value.length } : value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '***' : redact(v)]));
  }
  return value;
}

export async function dispatch<R extends RouteDef>(routeDef: R, ctx: Omit<Ctx, 'db'> & { db: Db }, rawInput: unknown): Promise<RouteOutput<R>> {
  try {
    if (routeDef.permission !== 'member') assertCan(ctx as Ctx, routeDef.permission);
    const input = routeDef.input.parse(rawInput ?? {});
    const run = async (db: Db) => {
      const c: Ctx = { ...ctx, db };
      const result = await routeDef.handler(c, input);
      if (routeDef.audit) {
        const entityId =
          result && typeof result === 'object' && 'id' in result ? String((result as { id: unknown }).id) : ((input as { id?: string }).id ?? null);
        await db.query(
          `INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, payload, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [ctx.actor.orgId, ctx.actor.userId, routeDef.audit.action, routeDef.audit.entity, entityId, JSON.stringify(redact(input)), ctx.now()],
        );
      }
      return result;
    };
    const result = routeDef.method === 'GET' ? await run(ctx.db) : await ctx.db.tx(run);
    return result as RouteOutput<R>;
  } catch (e) {
    throw toAppError(e);
  }
}

/** Match "/products/:id" against "/products/42" → { id: '42' }. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('?')[0].split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function fillPath(pattern: string, input: Record<string, unknown>): string {
  return pattern.replace(/:([a-zA-Z]+)/g, (_, k: string) => encodeURIComponent(String(input[k] ?? '')));
}
