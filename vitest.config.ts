import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'core', include: ['packages/core/test/**/*.test.ts'], environment: 'node' },
      },
      {
        // Services + SQL running on PGlite (real Postgres compiled to WASM) — same migrations as production.
        test: { name: 'app', include: ['packages/app/test/**/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 120_000 },
      },
      {
        // HTTP API on a real PostgreSQL 16 server (DATABASE_URL); see apps/api/test/setup.
        test: {
          name: 'api',
          include: ['apps/api/test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
