import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!/e2e|test/i.test(url)) {
  throw new Error(
    'E2E tests need DATABASE_URL to point at an e2e/test database (its name must contain "e2e" or "test"). ' +
      'Run e.g. DATABASE_URL="postgresql://…/webnovel_e2e" npm run test:e2e',
  );
}

export const db = new PrismaClient();

/** Truncate every app table (dynamic, so new models clear automatically) — mirrors the integration setup. */
export async function resetDb(): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length > 0) {
    const list = rows.map((r) => `"${r.tablename}"`).join(', ');
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}

export interface SeedChapter {
  title: string;
  url: string;
  guid?: string;
}
export interface SeedSeriesInput {
  title: string;
  sourceType?: 'FEED' | 'PAGE_WATCH';
  host?: string;
  chapters?: SeedChapter[];
}

/** Seed one owned series with a source + chapters, directly via Prisma (no network add flow).
 *  Mirrors the integration `addAlphaDuplicate` shape. userId 'local' matches WEBNOVEL_USER_ID. */
export async function seedSeries(input: SeedSeriesInput): Promise<{ id: string }> {
  const host = input.host ?? 'translator.example';
  const type = input.sourceType ?? 'FEED';
  const series = await db.series.create({
    data: {
      userId: 'local',
      title: input.title,
      sources: {
        create: {
          url: `https://${host}/series/${encodeURIComponent(input.title)}/`,
          host,
          type,
          ...(type === 'FEED'
            ? { feedUrl: `https://${host}/feed/`, matchType: 'WHOLE_FEED', matchValue: null }
            : {}),
        },
      },
      ...(input.chapters?.length
        ? {
            chapters: {
              create: input.chapters.map((c, i) => ({
                title: c.title,
                url: c.url,
                guid: c.guid ?? `g${i + 1}`,
              })),
            },
          }
        : {}),
    },
    select: { id: true },
  });
  return series;
}