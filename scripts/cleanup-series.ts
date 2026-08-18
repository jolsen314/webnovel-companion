// Dry-run-by-default maintenance CLI over the WP-38 recovery services.
// Usage: npm run db:cleanup -- <command> [args] [--apply]
//
// Without --apply, every mutating command prints the plan it would execute and makes
// no writes. `list` is always read-only. Run via `tsx`; do NOT point this at prod —
// see PLAN.md / the task brief for the local-test-DB verification workflow.
import { db } from '../src/server/db';
import { getCurrentUserId } from '../src/server/user';
import { chaptersToMove } from '../src/lib/chapters/merge';
import {
  pruneChapters,
  deleteSeries,
  resetChapters,
  setSourceUrl,
  mergeSeries,
  listSeriesForCleanup,
  backfillFromToc,
  reclassifySource,
  setApiDescriptor,
  renderPort,
} from '../src/server/services/index';
import type { ApiDescriptor } from '../src/lib/feeds/apiAdapter';

class UsageError extends Error {}

function usage(): void {
  console.log(`Usage: npm run db:cleanup -- <command> [args] [--apply]

Commands:
  list <seriesId>
  prune-chapters <chapterId...>
  delete-series <seriesId>
  reset-chapters <seriesId>
  set-source-url <sourceId> <url>
  merge-series --from <fromId> --into <intoId>
  backfill <seriesId> [--render]
  reclassify-source <sourceId> [--render]
  set-api-descriptor <sourceId> --endpoint <url> --map <json> [--render]

Without --apply, mutating commands print a dry-run plan and make no changes.
"list" is always read-only.`);
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function cmdList(seriesId: string | undefined): Promise<void> {
  if (!seriesId) throw new UsageError('list requires <seriesId>');
  const series = await listSeriesForCleanup(seriesId);
  if (!series) {
    console.log(`No series ${seriesId} found for the current user.`);
    return;
  }
  console.log(`Series ${series.id} — "${series.title}"`);
  console.log(`Chapters (${series.chapters.length}):`);
  for (const c of series.chapters) {
    console.log(`  ${c.id}  #${c.number ?? '—'}  ${c.title}  ${c.url}`);
  }
  console.log(`Sources (${series.sources.length}):`);
  for (const s of series.sources) {
    console.log(`  ${s.id}  ${s.type}  ${s.url}${s.feedUrl ? `  feed=${s.feedUrl}` : ''}`);
  }
}

async function cmdPruneChapters(chapterIds: string[], apply: boolean): Promise<void> {
  if (chapterIds.length === 0) throw new UsageError('prune-chapters requires at least one <chapterId>');
  const userId = getCurrentUserId();
  const targeted = await db.chapter.findMany({
    where: { id: { in: chapterIds }, series: { userId } },
    select: { id: true, number: true, title: true, seriesId: true },
  });
  if (!apply) {
    console.log(
      `[dry run] prune-chapters would delete ${targeted.length} of ${chapterIds.length} requested chapter(s):`,
    );
    for (const c of targeted) console.log(`  ${c.id}  #${c.number ?? '—'}  ${c.title}  (series ${c.seriesId})`);
    console.log('Re-run with --apply to delete.');
    return;
  }
  const result = await pruneChapters(chapterIds);
  console.log(`Deleted ${result.deleted} chapter(s).`);
}

async function cmdDeleteSeries(seriesId: string | undefined, apply: boolean): Promise<void> {
  if (!seriesId) throw new UsageError('delete-series requires <seriesId>');
  const series = await listSeriesForCleanup(seriesId);
  if (!series) {
    console.log(`No series ${seriesId} found for the current user. Nothing to delete.`);
    return;
  }
  if (!apply) {
    console.log(
      `[dry run] delete-series would delete series ${series.id} ("${series.title}"): ` +
        `${series.chapters.length} chapter(s), ${series.sources.length} source(s), and any reading progress.`,
    );
    console.log('Re-run with --apply to delete.');
    return;
  }
  const result = await deleteSeries(seriesId);
  console.log(result.deleted ? `Deleted series ${seriesId}.` : `Series ${seriesId} not found (nothing deleted).`);
}

async function cmdResetChapters(seriesId: string | undefined, apply: boolean): Promise<void> {
  if (!seriesId) throw new UsageError('reset-chapters requires <seriesId>');
  const series = await listSeriesForCleanup(seriesId);
  if (!series) {
    console.log(`No series ${seriesId} found for the current user.`);
    return;
  }
  if (!apply) {
    console.log(
      `[dry run] reset-chapters would delete ${series.chapters.length} chapter(s) from series ${series.id} ` +
        `("${series.title}"). The series row stays.`,
    );
    console.log('Re-run with --apply to delete.');
    return;
  }
  const result = await resetChapters(seriesId);
  console.log(`Deleted ${result.deleted} chapter(s) from series ${seriesId}.`);
}

async function cmdSetSourceUrl(sourceId: string | undefined, url: string | undefined, apply: boolean): Promise<void> {
  if (!sourceId || !url) throw new UsageError('set-source-url requires <sourceId> <url>');
  const userId = getCurrentUserId();
  const current = await db.source.findFirst({
    where: { id: sourceId, series: { userId } },
    select: { id: true, url: true },
  });
  if (!current) {
    console.log(`No source ${sourceId} found for the current user.`);
    return;
  }
  if (!apply) {
    console.log(`[dry run] set-source-url would change source ${sourceId} url:`);
    console.log(`  from: ${current.url}`);
    console.log(`  to:   ${url}`);
    console.log('Re-run with --apply to update.');
    return;
  }
  const result = await setSourceUrl(sourceId, url);
  console.log(result.updated ? `Updated source ${sourceId}.` : `Source ${sourceId} not found (nothing updated).`);
}

async function cmdMergeSeries(args: string[], apply: boolean): Promise<void> {
  const fromId = flagValue(args, '--from');
  const intoId = flagValue(args, '--into');
  if (!fromId || !intoId) throw new UsageError('merge-series requires --from <id> --into <id>');
  if (!apply) {
    const userId = getCurrentUserId();
    const [from, into] = await Promise.all([
      db.series.findFirst({ where: { id: fromId, userId }, select: { id: true, title: true } }),
      db.series.findFirst({ where: { id: intoId, userId }, select: { id: true, title: true } }),
    ]);
    if (!from || !into) {
      console.log('[dry run] both series must belong to the current user; at least one was not found.');
      return;
    }
    const [fromChapters, intoChapters] = await Promise.all([
      db.chapter.findMany({ where: { seriesId: fromId }, select: { id: true, url: true } }),
      db.chapter.findMany({ where: { seriesId: intoId }, select: { url: true } }),
    ]);
    const toMove = chaptersToMove(fromChapters, intoChapters.map((c) => c.url));
    console.log(
      `[dry run] merge-series would move ${toMove.length} chapter(s) from "${from.title}" (${fromId}) ` +
        `into "${into.title}" (${intoId}), then delete ${fromId}.`,
    );
    console.log('Re-run with --apply to merge.');
    return;
  }
  const result = await mergeSeries(fromId, intoId);
  console.log(`Merged: moved ${result.movedChapters} chapter(s); source series deleted: ${result.deleted}.`);
}

async function cmdReclassifySource(sourceId: string | undefined, render: boolean, apply: boolean): Promise<void> {
  if (!sourceId) throw new UsageError('reclassify-source requires <sourceId>');
  const userId = getCurrentUserId();
  const src = await db.source.findFirst({
    where: { id: sourceId, series: { userId } },
    select: { id: true, type: true, feedUrl: true, fetchMode: true },
  });
  if (!src) {
    console.log(`No source ${sourceId} found for the current user.`);
    return;
  }
  if (!apply) {
    console.log(`[dry run] reclassify-source would flip source ${sourceId}:`);
    console.log(
      `  type ${src.type} → PAGE_WATCH; feedUrl ${src.feedUrl ?? '—'} → null; matcher → WHOLE_FEED; fetchMode ${src.fetchMode}${render ? ' → RENDER' : ' (unchanged)'}`,
    );
    console.log('Re-run with --apply to update.');
    return;
  }
  const res = await reclassifySource(sourceId, { render });
  console.log(res.updated ? `Reclassified source ${sourceId} → PAGE_WATCH${render ? '/RENDER' : ''}.` : `Source ${sourceId} not found.`);
}

async function cmdSetApiDescriptor(args: string[], render: boolean, apply: boolean): Promise<void> {
  const sourceId = args[0];
  if (!sourceId) throw new UsageError('set-api-descriptor requires <sourceId>');
  const endpoint = flagValue(args, '--endpoint');
  const mapJson = flagValue(args, '--map');
  if (!endpoint) throw new UsageError('set-api-descriptor requires --endpoint <url>');
  if (!mapJson) throw new UsageError('set-api-descriptor requires --map <json>');
  let map: ApiDescriptor;
  try {
    map = JSON.parse(mapJson);
  } catch {
    throw new UsageError('--map must be valid JSON');
  }
  if (!map.urlField || !map.titleField) throw new UsageError('--map needs at least urlField and titleField');
  if (!apply) {
    console.log(`[dry run] set-api-descriptor would set source ${sourceId} → API`);
    console.log(`  endpoint=${endpoint}  fetchMode=${render ? 'RENDER' : 'PLAIN'}  map=${JSON.stringify(map)}`);
    console.log('Re-run with --apply to update.');
    return;
  }
  const res = await setApiDescriptor(sourceId, { endpoint, map, render });
  console.log(res.updated ? `Set API descriptor on source ${sourceId}.` : `No source ${sourceId} for the current user.`);
}

async function cmdBackfill(seriesId: string | undefined, render: boolean, apply: boolean): Promise<void> {
  if (!seriesId) throw new UsageError('backfill requires <seriesId>');
  if (render && !renderPort()) {
    throw new UsageError(
      'backfill --render needs RENDER_URL (+ RENDER_SECRET) in the env (point it at the deployed /api/render).',
    );
  }
  if (!apply) {
    console.log(
      `[dry run] backfill would fetch series ${seriesId}'s active source page${render ? ' via the renderer' : ''} and add missing chapters, reconciling FREE/LOCKED. No network request in dry-run.`,
    );
    console.log('Re-run with --apply to fetch and apply.');
    return;
  }
  const result = await backfillFromToc(seriesId, render ? renderPort() : undefined);
  console.log(`Backfill complete: added ${result.added} chapter(s), reconciled ${result.reconciled}.`);
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const apply = rest.includes('--apply');
  const render = rest.includes('--render');
  const args = rest.filter((a) => a !== '--apply' && a !== '--render');

  switch (cmd) {
    case 'list':
      return cmdList(args[0]);
    case 'prune-chapters':
      return cmdPruneChapters(args, apply);
    case 'delete-series':
      return cmdDeleteSeries(args[0], apply);
    case 'reset-chapters':
      return cmdResetChapters(args[0], apply);
    case 'set-source-url':
      return cmdSetSourceUrl(args[0], args[1], apply);
    case 'merge-series':
      return cmdMergeSeries(args, apply);
    case 'backfill':
      return cmdBackfill(args[0], render, apply);
    case 'reclassify-source':
      return cmdReclassifySource(args[0], render, apply);
    case 'set-api-descriptor':
      return cmdSetApiDescriptor(args, render, apply);
    default:
      throw new UsageError(cmd ? `Unknown command: ${cmd}` : 'No command given');
  }
}

main()
  .catch((err) => {
    if (err instanceof UsageError) {
      console.error(err.message);
      usage();
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
