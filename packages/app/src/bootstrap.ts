import type { Db } from '@omborchi/db';
import { one } from './sql';

export interface NewOrganisation {
  name: string;
  slug: string;
  owner: { email: string; name: string; passwordHash: string | null; locale?: 'uz' | 'ru' | 'en' };
  warehouse?: { name: string; code: string; kind?: 'store' | 'warehouse'; address?: string };
}

export const DEFAULT_UNITS: { code: string; name: string; allowFraction: boolean }[] = [
  { code: 'dona', name: 'dona', allowFraction: false },
  { code: 'kg', name: 'kilogramm', allowFraction: true },
  { code: 'g', name: 'gramm', allowFraction: true },
  { code: 'l', name: 'litr', allowFraction: true },
  { code: 'm', name: 'metr', allowFraction: true },
  { code: 'm2', name: 'kvadrat metr', allowFraction: true },
  { code: 'quti', name: 'quti', allowFraction: false },
  { code: 'paket', name: 'paket', allowFraction: false },
  { code: 'blok', name: 'blok', allowFraction: false },
  { code: 'qop', name: 'qop', allowFraction: false },
];

/** Create an organisation with sane defaults: units, retail + wholesale price lists, a first store, the owner. */
export async function createOrganisation(db: Db, input: NewOrganisation): Promise<{ orgId: string; userId: string; warehouseId: string }> {
  return db.tx(async (tx) => {
    const org = await one<{ id: string }>(tx, 'INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id', [input.name, input.slug]);
    for (const u of DEFAULT_UNITS) {
      await tx.query('INSERT INTO units (org_id, code, name, allow_fraction) VALUES ($1,$2,$3,$4)', [org.id, u.code, u.name, u.allowFraction]);
    }
    await tx.query(`INSERT INTO price_lists (org_id, code, name, is_default) VALUES ($1, 'retail', 'Chakana', true), ($1, 'wholesale', 'Ulgurji', false)`, [org.id]);
    const w = input.warehouse ?? { name: 'Asosiy do‘kon', code: 'MAIN', kind: 'store' as const };
    const wh = await one<{ id: string }>(tx, 'INSERT INTO warehouses (org_id, name, code, kind, address) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
      org.id,
      w.name,
      w.code,
      w.kind ?? 'store',
      w.address ?? null,
    ]);
    const existing = await tx.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [input.owner.email]);
    const userId =
      existing.rows[0]?.id ??
      (
        await one<{ id: string }>(tx, 'INSERT INTO users (email, name, password_hash, locale) VALUES ($1,$2,$3,$4) RETURNING id', [
          input.owner.email.toLowerCase(),
          input.owner.name,
          input.owner.passwordHash,
          input.owner.locale ?? 'uz',
        ])
      ).id;
    await tx.query(`INSERT INTO memberships (org_id, user_id, role, all_warehouses) VALUES ($1,$2,'owner',true)`, [org.id, userId]);
    return { orgId: org.id, userId, warehouseId: wh.id };
  });
}
