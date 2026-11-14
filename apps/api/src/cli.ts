/** `npm run migrate` / `npm run seed` — operational commands against DATABASE_URL. */
import { seedDemo } from '@omborchi/app';
import { migrate } from '@omborchi/db';
import { createPgDb, createPool } from '@omborchi/db/pg';
import { hashPassword } from './auth';

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const pool = createPool(url, 4);
const db = createPgDb(pool);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `migrations applied: ${applied.join(', ')}` : 'schema up to date');
  if (cmd === 'seed') {
    const exists = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE email = 'owner@demo.uz'`);
    if (exists.rows[0].n > 0) {
      console.log('demo data already present (owner@demo.uz) — skipping');
    } else {
      const password = process.env.DEMO_PASSWORD ?? 'demo12345';
      const t = Date.now();
      const r = await seedDemo(db, { passwordHash: await hashPassword(password) });
      console.log(`seeded Demo Market in ${Date.now() - t} ms`, r.counts);
      console.log(`sign in: ${r.users.map((u) => `${u.email} (${u.role})`).join(', ')} — password from DEMO_PASSWORD`);
    }
  }
} finally {
  await pool.end();
}
