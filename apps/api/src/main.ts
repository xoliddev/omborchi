import { migrate } from '@omborchi/db';
import { createPgDb, createPool } from '@omborchi/db/pg';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createPgDb(pool);

if (config.MIGRATE_ON_START) {
  const applied = await migrate(db);
  if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
}

const app = await buildApp({
  db,
  cookieSecure: config.COOKIE_SECURE,
  sessionTtlDays: config.SESSION_TTL_DAYS,
  webDir: config.WEB_DIR ?? null,
  allowRegistration: config.ALLOW_REGISTRATION,
  logger: true,
});

const close = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);

await app.listen({ port: config.PORT, host: config.HOST });
