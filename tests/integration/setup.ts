import { afterAll, beforeEach } from 'vitest';
import { db } from '../../src/server/db';

/**
 * Integration-test harness: runs the real Prisma services against a real Postgres.
 * Requires DATABASE_URL to point at a *test* database (name must contain "test") so
 * we never truncate a real one. Each test starts from an empty schema.
 */
const url = process.env.DATABASE_URL ?? '';
if (!/test/i.test(url)) {
  throw new Error(
    'Integration tests need DATABASE_URL to point at a test database (its name must contain "test"). ' +
      'Run e.g. DATABASE_URL="postgresql://…/webnovel_test" npm run test:integration',
  );
}

beforeEach(async () => {
  // Truncate every app table dynamically so new models are cleared automatically
  // (a hardcoded list silently leaks state the moment a table is added).
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length > 0) {
    const list = rows.map((r) => `"${r.tablename}"`).join(', ');
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
});

afterAll(async () => {
  await db.$disconnect();
});
