import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { run, UsageError } from '../../scripts/cleanup-series';
import { db } from '../../src/server/db';
import { getCurrentUserId } from '../../src/server/user';

/**
 * Black-box coverage for the `db:cleanup` CLI (scripts/cleanup-series.ts).
 *
 * The `cmd*` handlers all delegate mutation to already integration-tested services
 * (see services.test.ts) — what's untested is the CLI layer itself: arg validation
 * (UsageError paths) and dry-run safety (no writes without --apply). We drive it
 * through the exported `run(argv)` entry point as a real caller would, against the
 * real test DB.
 */

const cli = (...a: string[]) => run(['node', 'cleanup-series.ts', ...a]);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Seed a minimal series + source + chapter for the current user, "Fixture" title,
 *  *.example URLs throughout. */
async function seedSeries(): Promise<{ seriesId: string; sourceId: string; chapterId: string }> {
  const series = await db.series.create({
    data: {
      userId: getCurrentUserId(),
      title: 'Fixture Series',
      sources: {
        create: {
          url: 'https://reader.example/series/fixture/',
          host: 'reader.example',
          type: 'FEED',
          feedUrl: 'https://reader.example/series/fixture/feed/',
        },
      },
      chapters: {
        create: {
          title: 'Chapter 1',
          url: 'https://reader.example/series/fixture/chapter-1/',
        },
      },
    },
    include: { sources: true, chapters: true },
  });
  return { seriesId: series.id, sourceId: series.sources[0]!.id, chapterId: series.chapters[0]!.id };
}

describe('cleanup-series CLI (black box, real DB)', () => {
  describe('A. arg validation -> UsageError (no DB needed)', () => {
    test('no command rejects', async () => {
      await expect(cli()).rejects.toThrow(UsageError);
    });

    test('unknown command rejects', async () => {
      await expect(cli('bogus-command')).rejects.toThrow(UsageError);
    });

    test.each(['delete-series', 'reset-chapters', 'list', 'backfill', 'reclassify-source'])(
      '%s with no id rejects',
      async (cmd) => {
        await expect(cli(cmd)).rejects.toThrow(UsageError);
      },
    );

    test('prune-chapters with no ids rejects', async () => {
      await expect(cli('prune-chapters')).rejects.toThrow(UsageError);
    });

    test('set-source-url with missing url rejects', async () => {
      await expect(cli('set-source-url', 'some-id')).rejects.toThrow(UsageError);
    });

    test('merge-series without --from/--into rejects', async () => {
      await expect(cli('merge-series')).rejects.toThrow(UsageError);
      await expect(cli('merge-series', '--from', 'a')).rejects.toThrow(UsageError);
      await expect(cli('merge-series', '--into', 'b')).rejects.toThrow(UsageError);
    });

    describe('set-api-descriptor', () => {
      test('no id rejects', async () => {
        await expect(cli('set-api-descriptor')).rejects.toThrow(UsageError);
      });

      test('missing --endpoint rejects', async () => {
        await expect(
          cli('set-api-descriptor', 'some-id', '--map', '{"urlField":"u","titleField":"t"}'),
        ).rejects.toThrow(UsageError);
      });

      test('missing --map rejects', async () => {
        await expect(
          cli('set-api-descriptor', 'some-id', '--endpoint', 'https://api.example/chapters'),
        ).rejects.toThrow(UsageError);
      });

      test('--map invalid JSON rejects', async () => {
        await expect(
          cli('set-api-descriptor', 'some-id', '--endpoint', 'https://api.example/chapters', '--map', 'not-json'),
        ).rejects.toThrow(UsageError);
      });

      test('--map missing urlField/titleField rejects', async () => {
        await expect(
          cli('set-api-descriptor', 'some-id', '--endpoint', 'https://api.example/chapters', '--map', '{}'),
        ).rejects.toThrow(UsageError);
      });

      test('--map with a bad pagination (perPage: 0) rejects', async () => {
        await expect(
          cli(
            'set-api-descriptor',
            'some-id',
            '--endpoint',
            'https://api.example/chapters',
            '--map',
            JSON.stringify({ urlField: 'u', titleField: 't', pagination: { pageParam: 'page', perPage: 0 } }),
          ),
        ).rejects.toThrow(UsageError);
      });

      test('--map with a bad pagination (missing pageParam) rejects', async () => {
        await expect(
          cli(
            'set-api-descriptor',
            'some-id',
            '--endpoint',
            'https://api.example/chapters',
            '--map',
            JSON.stringify({ urlField: 'u', titleField: 't', pagination: { perPage: 20 } }),
          ),
        ).rejects.toThrow(UsageError);
      });

      // WP-54: urlTemplate satisfies the url requirement in place of urlField.
      test('--map with urlTemplate (no urlField) passes validation (dry-run, no throw)', async () => {
        await expect(
          cli(
            'set-api-descriptor',
            'some-id',
            '--endpoint',
            'https://api.example/chapters',
            '--map',
            JSON.stringify({ urlTemplate: '/novel/{slug}', titleField: 't' }),
          ),
        ).resolves.toBeUndefined();
      });
    });

    describe('probe-api', () => {
      test('no id rejects', async () => {
        await expect(cli('probe-api')).rejects.toThrow(UsageError);
      });
    });
  });

  describe('B. dry-run safety -> no DB writes', () => {
    test('delete-series (no --apply) leaves the series in place', async () => {
      const { seriesId } = await seedSeries();

      await cli('delete-series', seriesId);

      expect(await db.series.findUnique({ where: { id: seriesId } })).not.toBeNull();
    });

    test('prune-chapters (no --apply) leaves the chapter in place', async () => {
      const { chapterId } = await seedSeries();

      await cli('prune-chapters', chapterId);

      expect(await db.chapter.findUnique({ where: { id: chapterId } })).not.toBeNull();
    });

    test('reset-chapters (no --apply) leaves the series chapters in place', async () => {
      const { seriesId } = await seedSeries();

      await cli('reset-chapters', seriesId);

      expect(await db.chapter.count({ where: { seriesId } })).toBe(1);
    });

    test('set-source-url (no --apply) leaves the source url unchanged', async () => {
      const { sourceId } = await seedSeries();

      await cli('set-source-url', sourceId, 'https://newhost.example/series/fixture/');

      const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
      expect(source.url).toBe('https://reader.example/series/fixture/');
    });

    test('reclassify-source (no --apply) leaves the source type unchanged', async () => {
      const { sourceId } = await seedSeries();

      await cli('reclassify-source', sourceId);

      const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
      expect(source.type).toBe('FEED');
    });

    test('set-api-descriptor (no --apply) does not flip the source to API', async () => {
      const { sourceId } = await seedSeries();

      await cli(
        'set-api-descriptor',
        sourceId,
        '--endpoint',
        'https://api.example/chapters',
        '--map',
        JSON.stringify({ urlField: 'u', titleField: 't' }),
      );

      const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
      expect(source.type).toBe('FEED');
    });

    test('merge-series (no --apply) leaves the "from" series in place', async () => {
      const { seriesId: fromId } = await seedSeries();
      const into = await db.series.create({ data: { userId: getCurrentUserId(), title: 'Fixture Target' } });

      await cli('merge-series', '--from', fromId, '--into', into.id);

      expect(await db.series.findUnique({ where: { id: fromId } })).not.toBeNull();
    });
  });

  describe('C. one --apply happy path (confirm delegation)', () => {
    test('delete-series --apply actually deletes the series', async () => {
      const { seriesId } = await seedSeries();

      await cli('delete-series', seriesId, '--apply');

      expect(await db.series.findUnique({ where: { id: seriesId } })).toBeNull();
    });
  });
});
