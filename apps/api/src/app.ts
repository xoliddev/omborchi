import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { AppError, createOrganisation, dispatch, routes, toAppError, type Actor, type RouteDef } from '@omborchi/app';
import type { Db } from '@omborchi/db';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFromSession, AttemptLimiter, createSession, destroySession, hashPassword, verifyPassword } from './auth';

export interface AppOptions {
  db: Db;
  cookieSecure?: boolean;
  sessionTtlDays?: number;
  webDir?: string | null;
  logger?: boolean;
  allowRegistration?: boolean;
  /** Trust X-Forwarded-For (only when a reverse proxy sets it); otherwise clients could spoof their IP past the login limiter. */
  trustProxy?: boolean;
  /** New organisations one IP may register per hour (default 10). */
  signupsPerHour?: number;
  now?: () => Date;
}

const COOKIE = 'omb_sid';

const loginInput = z.object({ email: z.email(), password: z.string().min(1).max(200), orgId: z.guid().optional() });
const registerInput = z.object({
  orgName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  password: z.string().min(8).max(200),
});

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db } = opts;
  const ttl = opts.sessionTtlDays ?? 30;
  const now = opts.now ?? (() => new Date());
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 8 * 1024 * 1024, trustProxy: opts.trustProxy ?? false });
  await app.register(fastifyCookie);
  const limiter = new AttemptLimiter(8, 60_000);
  const signups = new AttemptLimiter(opts.signupsPerHour ?? 10, 3_600_000);

  const setCookie = (reply: FastifyReply, token: string, expires: Date) =>
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: opts.cookieSecure ?? false, path: '/', expires });

  app.setErrorHandler((err, req, reply) => {
    const v = err as { validation?: unknown; message?: string };
    const e = err instanceof AppError ? err : v.validation ? new AppError('VALIDATION', v.message ?? 'Invalid input') : toAppError(err);
    if (e.status >= 500) req.log.error(err);
    void reply.status(e.status).send({ error: { code: e.code, message: e.message, details: e.details } });
  });

  // Mutations must be JSON: browsers cannot send cross-site JSON without a CORS preflight (CSRF guard, with SameSite=Lax cookies).
  app.addHook('onRequest', async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.url.startsWith('/api/') && !String(req.headers['content-type'] ?? '').includes('application/json')) {
      if (req.method === 'DELETE' || req.url === '/api/auth/logout') return;
      throw new AppError('VALIDATION', 'Content-Type must be application/json');
    }
  });

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, time: now().toISOString() };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const input = loginInput.parse(req.body);
    const key = `${req.ip}:${input.email.toLowerCase()}`;
    if (!limiter.check(key)) throw new AppError('FORBIDDEN', 'Too many attempts, try again in a minute', { reason: 'RATE_LIMITED' });
    const { rows } = await db.query<{ id: string; password_hash: string | null }>('SELECT id, password_hash FROM users WHERE lower(email) = lower($1)', [input.email]);
    const user = rows[0];
    // Always run a hash comparison so response time does not reveal whether the email exists.
    const ok = await verifyPassword(input.password, user?.password_hash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    if (!user || !ok) throw new AppError('UNAUTHENTICATED', 'Wrong email or password', { reason: 'BAD_CREDENTIALS' });
    const m = await db.query<{ org_id: string }>('SELECT org_id FROM memberships WHERE user_id = $1 AND is_active ORDER BY (org_id = $2) DESC, created_at LIMIT 1', [
      user.id,
      input.orgId ?? null,
    ]);
    if (!m.rows[0]) throw new AppError('FORBIDDEN', 'No active organisation for this user');
    limiter.reset(key);
    const s = await createSession(db, user.id, m.rows[0].org_id, ttl);
    setCookie(reply, s.token, s.expiresAt);
    return { ok: true };
  });

  app.post('/api/auth/register', async (req, reply) => {
    if (opts.allowRegistration === false) throw new AppError('FORBIDDEN', 'Registration is disabled');
    if (!signups.check(req.ip)) throw new AppError('FORBIDDEN', 'Too many sign-ups, try again later', { reason: 'RATE_LIMITED' });
    const input = registerInput.parse(req.body);
    const exists = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [input.email]);
    if (exists.rows.length) throw new AppError('CONFLICT', 'This email is already registered', { field: 'email' });
    const slug = `${input.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org'}-${Math.random().toString(36).slice(2, 7)}`;
    const { orgId, userId } = await createOrganisation(db, {
      name: input.orgName,
      slug,
      owner: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) },
    });
    const s = await createSession(db, userId, orgId, ttl);
    setCookie(reply, s.token, s.expiresAt);
    return { ok: true, orgId };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await destroySession(db, token);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/switch-org', async (req, reply) => {
    const actor = await requireActor(req);
    const { orgId } = z.object({ orgId: z.guid() }).parse(req.body);
    const m = await db.query('SELECT 1 FROM memberships WHERE user_id = $1 AND org_id = $2 AND is_active', [actor.userId, orgId]);
    if (!m.rows.length) throw new AppError('FORBIDDEN', 'Not a member of this organisation');
    await destroySession(db, req.cookies[COOKIE]!);
    const s = await createSession(db, actor.userId, orgId, ttl);
    setCookie(reply, s.token, s.expiresAt);
    return { ok: true };
  });

  async function requireActor(req: FastifyRequest): Promise<Actor> {
    const actor = await actorFromSession(db, req.cookies[COOKIE]);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    return actor;
  }

  // Every shared route (catalog, stock, sales, reports…) is mounted from the transport-agnostic route table.
  for (const [name, def] of Object.entries(routes) as [string, RouteDef][]) {
    app.route({
      method: def.method,
      url: `/api${def.path}`,
      handler: async (req) => {
        const actor = await requireActor(req);
        const input = { ...(req.query as object), ...((req.body as object) ?? {}), ...(req.params as object) };
        return dispatch(def, { db, actor, now, hashPassword }, input);
      },
      config: { name },
    });
  }

  const webDir = opts.webDir === undefined ? null : opts.webDir;
  if (webDir && existsSync(resolve(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: resolve(webDir), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint' } });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
