import { PAYMENT_PROVIDERS, permissionsFor, ROLES } from '@omborchi/core';
import { z } from 'zod';
import { AppError } from '../errors';
import { route } from '../router';
import { bool, id, name, optId, paging, text } from '../schemas';
import { many, one } from '../sql';

export const adminRoutes = {
  me: route({
    method: 'GET',
    path: '/me',
    permission: 'member',
    input: z.object({}),
    handler: async (ctx) => {
      const org = await one<{ id: string; name: string; slug: string; currency: string; settings: Record<string, unknown> }>(
        ctx.db,
        'SELECT id, name, slug, currency, settings FROM orgs WHERE id = $1',
        [ctx.actor.orgId],
        'Organisation',
      );
      const warehouses = await many<{ id: string; name: string; code: string; kind: string; address: string | null }>(
        ctx.db,
        `SELECT id, name, code, kind, address FROM warehouses WHERE org_id = $1 AND is_active AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) ORDER BY kind DESC, name`,
        [ctx.actor.orgId, ctx.actor.role === 'owner' ? null : ctx.actor.warehouseIds],
      );
      const [priceLists, units, orgs] = await Promise.all([
        many<{ id: string; code: string; name: string; is_default: boolean }>(ctx.db, 'SELECT id, code, name, is_default FROM price_lists WHERE org_id = $1 ORDER BY is_default DESC, code', [ctx.actor.orgId]),
        many<{ code: string; name: string; allow_fraction: boolean }>(ctx.db, 'SELECT code, name, allow_fraction FROM units WHERE org_id = $1 ORDER BY code', [ctx.actor.orgId]),
        many<{ id: string; name: string; role: string }>(
          ctx.db,
          'SELECT o.id, o.name, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1 AND m.is_active ORDER BY o.name',
          [ctx.actor.userId],
        ),
      ]);
      return {
        user: { id: ctx.actor.userId, name: ctx.actor.name, email: ctx.actor.email },
        role: ctx.actor.role,
        permissions: permissionsFor(ctx.actor.role),
        org,
        orgs,
        warehouses,
        priceLists,
        units,
        paymentMethods: Object.values(PAYMENT_PROVIDERS).map((p) => ({ id: p.id, label: p.label, kind: p.kind, simulated: p.simulated })),
      };
    },
  }),

  'org.update': route({
    method: 'PUT',
    path: '/org',
    permission: 'settings.edit',
    input: z.object({ name, settings: z.record(z.string(), z.unknown()).default({}) }),
    audit: { action: 'org.update', entity: 'org' },
    handler: (ctx, i) =>
      one<{ id: string }>(ctx.db, 'UPDATE orgs SET name = $2, settings = settings || $3::jsonb WHERE id = $1 RETURNING id', [ctx.actor.orgId, i.name, JSON.stringify(i.settings)]),
  }),

  'warehouses.list': route({
    method: 'GET',
    path: '/warehouses',
    permission: 'member',
    input: z.object({ all: bool.optional() }),
    handler: (ctx, i) =>
      many<{ id: string; name: string; code: string; kind: string; address: string | null; is_active: boolean; skus: number; value: number }>(
        ctx.db,
        `SELECT w.id, w.name, w.code, w.kind, w.address, w.is_active,
                (SELECT count(*)::int FROM stock_balances sb WHERE sb.warehouse_id = w.id AND sb.qty > 0) AS skus,
                (SELECT coalesce(round(sum(qty * avg_cost), 2), 0) FROM stock_balances sb WHERE sb.warehouse_id = w.id) AS value
         FROM warehouses w WHERE w.org_id = $1 AND (w.is_active OR $2::boolean) ORDER BY w.kind DESC, w.name`,
        [ctx.actor.orgId, i.all ?? false],
      ),
  }),

  'warehouses.save': route({
    method: 'POST',
    path: '/warehouses',
    permission: 'settings.edit',
    input: z.object({ id: optId, name, code: z.string().trim().min(1).max(16), kind: z.enum(['store', 'warehouse']), address: text(300).nullish(), isActive: z.boolean().default(true) }),
    audit: { action: 'warehouse.save', entity: 'warehouse' },
    handler: (ctx, i) =>
      i.id
        ? one<{ id: string }>(
            ctx.db,
            'UPDATE warehouses SET name=$3, code=$4, kind=$5, address=$6, is_active=$7 WHERE id=$1 AND org_id=$2 RETURNING id',
            [i.id, ctx.actor.orgId, i.name, i.code, i.kind, i.address ?? null, i.isActive],
            'Warehouse',
          )
        : one<{ id: string }>(ctx.db, 'INSERT INTO warehouses (org_id, name, code, kind, address) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
            ctx.actor.orgId,
            i.name,
            i.code,
            i.kind,
            i.address ?? null,
          ]),
  }),

  'users.list': route({
    method: 'GET',
    path: '/users',
    permission: 'users.manage',
    input: z.object({}),
    handler: (ctx) =>
      many<{ membership_id: string; user_id: string; name: string; email: string; role: string; all_warehouses: boolean; is_active: boolean; warehouse_ids: string[]; last_seen: string | null }>(
        ctx.db,
        `SELECT m.id AS membership_id, u.id AS user_id, u.name, u.email, m.role, m.all_warehouses, m.is_active,
                coalesce((SELECT array_agg(mw.warehouse_id) FROM membership_warehouses mw WHERE mw.membership_id = m.id), '{}') AS warehouse_ids,
                (SELECT max(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
         FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1
         ORDER BY array_position(ARRAY['owner','manager','cashier','storekeeper'], m.role), u.name`,
        [ctx.actor.orgId],
      ),
  }),

  'users.save': route({
    method: 'POST',
    path: '/users',
    permission: 'users.manage',
    input: z.object({
      membershipId: optId,
      name,
      email: z.email().max(200),
      password: z.string().min(8).max(200).optional(),
      role: z.enum(ROLES),
      warehouseIds: z.array(id).nullable(),
      isActive: z.boolean().default(true),
    }),
    audit: { action: 'user.save', entity: 'membership' },
    handler: async (ctx, i) => {
      const org = ctx.actor.orgId;
      let membershipId = i.membershipId ?? null;
      if (membershipId) {
        const m = await one<{ user_id: string; role: string }>(ctx.db, 'SELECT user_id, role FROM memberships WHERE id = $1 AND org_id = $2', [membershipId, org], 'Member');
        if (m.user_id === ctx.actor.userId && (i.role !== 'owner' || !i.isActive)) throw new AppError('INVALID_STATE', 'You cannot demote or deactivate yourself');
        await ctx.db.query('UPDATE users SET name = $2 WHERE id = $1', [m.user_id, i.name]);
        if (i.password) await ctx.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [m.user_id, await ctx.hashPassword(i.password)]);
        await ctx.db.query('UPDATE memberships SET role = $2, all_warehouses = $3, is_active = $4 WHERE id = $1', [membershipId, i.role, i.warehouseIds === null, i.isActive]);
      } else {
        if (!i.password) throw new AppError('VALIDATION', 'Password is required for a new user', { field: 'password' });
        const existing = await many<{ id: string }>(ctx.db, 'SELECT id FROM users WHERE lower(email) = lower($1)', [i.email]);
        const userId =
          existing[0]?.id ??
          (
            await one<{ id: string }>(ctx.db, 'INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [
              i.email.toLowerCase(),
              i.name,
              await ctx.hashPassword(i.password),
            ])
          ).id;
        membershipId = (
          await one<{ id: string }>(ctx.db, 'INSERT INTO memberships (org_id, user_id, role, all_warehouses, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
            org,
            userId,
            i.role,
            i.warehouseIds === null,
            i.isActive,
          ])
        ).id;
      }
      await ctx.db.query('DELETE FROM membership_warehouses WHERE membership_id = $1', [membershipId]);
      if (i.warehouseIds?.length) {
        await ctx.db.query(
          'INSERT INTO membership_warehouses (membership_id, warehouse_id) SELECT $1, w FROM unnest($2::uuid[]) AS w JOIN warehouses ON warehouses.id = w AND warehouses.org_id = $3',
          [membershipId, i.warehouseIds, org],
        );
      }
      return { id: membershipId };
    },
  }),

  'priceLists.save': route({
    method: 'POST',
    path: '/price-lists',
    permission: 'settings.edit',
    input: z.object({ id: optId, code: z.string().regex(/^[a-z0-9_]{2,20}$/), name }),
    audit: { action: 'price_list.save', entity: 'price_list' },
    handler: (ctx, i) =>
      i.id
        ? one<{ id: string }>(ctx.db, 'UPDATE price_lists SET name = $3 WHERE id = $1 AND org_id = $2 RETURNING id', [i.id, ctx.actor.orgId, i.name], 'Price list')
        : one<{ id: string }>(ctx.db, 'INSERT INTO price_lists (org_id, code, name) VALUES ($1,$2,$3) RETURNING id', [ctx.actor.orgId, i.code, i.name]),
  }),

  'audit.list': route({
    method: 'GET',
    path: '/audit',
    permission: 'audit.view',
    input: z.object({ entity: z.string().max(40).optional(), userId: optId, action: z.string().max(60).optional(), ...paging }),
    handler: async (ctx, i) => {
      const rows = await many<{ id: number; created_at: string; action: string; entity: string | null; entity_id: string | null; payload: unknown; user_name: string | null; total: number }>(
        ctx.db,
        `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.payload, u.name AS user_name, count(*) OVER () AS total
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.org_id = $1 AND ($2::text IS NULL OR a.entity = $2) AND ($3::uuid IS NULL OR a.user_id = $3) AND ($4::text IS NULL OR a.action LIKE $4 || '%')
         ORDER BY a.id DESC LIMIT $5 OFFSET $6`,
        [ctx.actor.orgId, i.entity ?? null, i.userId ?? null, i.action ?? null, i.pageSize, (i.page - 1) * i.pageSize],
      );
      return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, page: i.page, pageSize: i.pageSize };
    },
  }),
};
