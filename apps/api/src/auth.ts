import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Actor } from '@omborchi/app';
import type { Role } from '@omborchi/core';
import type { Db } from '@omborchi/db';

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

// scrypt with N=2^15, r=8, p=1 (~32 MiB, OWASP-recommended floor). Format: scrypt$N$r$p$salt$hash
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(db: Db, userId: string, orgId: string, ttlDays: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await db.query('INSERT INTO sessions (id, user_id, org_id, expires_at) VALUES ($1,$2,$3,$4)', [sha256(token), userId, orgId, expiresAt]);
  return { token, expiresAt };
}

export async function destroySession(db: Db, token: string) {
  await db.query('DELETE FROM sessions WHERE id = $1', [sha256(token)]);
}

/** Resolve the acting user + organisation + role + warehouse scope from a session token. */
export async function actorFromSession(db: Db, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const { rows } = await db.query<{ user_id: string; org_id: string; role: Role; all_warehouses: boolean; name: string; email: string; membership_id: string }>(
    `SELECT s.user_id, s.org_id, m.role, m.all_warehouses, u.name, u.email, m.id AS membership_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id AND m.is_active
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  const r = rows[0];
  if (!r) return null;
  let warehouseIds: string[] | null = null;
  if (!r.all_warehouses && r.role !== 'owner') {
    const w = await db.query<{ warehouse_id: string }>('SELECT warehouse_id FROM membership_warehouses WHERE membership_id = $1', [r.membership_id]);
    warehouseIds = w.rows.map((x) => x.warehouse_id);
  }
  return { userId: r.user_id, orgId: r.org_id, role: r.role, warehouseIds, name: r.name, email: r.email };
}

/** Tiny fixed-window limiter for login attempts (per IP + email). */
export class AttemptLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  check(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    h.count++;
    return h.count <= this.max;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}
