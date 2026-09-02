// Dry-run-by-default maintenance CLI over the WP-38 recovery services.
// Usage: npm run db:cleanup -- <command> [args] [--apply]
//
// Without --apply, every mutating command prints the plan it would execute and makes
// no writes. `list` is always read-only. Run via `tsx`; do NOT point this at prod —
// see PLAN.md / the task brief for the local-test-DB verification workflow.
//
// Full reference (every command, examples, and the set-api-descriptor gotchas):
//   docs/db-cleanup-cli.md
import { fileURLToPath } from 'node:url';
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
  getSourceForProbe,
  renderPort,
} from '../src/server/services/index';
import { parseApiChapters, type ApiDescriptor } from '../src/lib/feeds/apiAdapter';
import { makeRenderCapture } from '../src/lib/feeds/renderFetch';
import { inferApiDescriptors, UNCONFIRMED_PREFIX } from '../src/lib/feeds/apiInfer';

export class UsageError extends Error {}

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
  probe-api <sourceId> [--render] [--apply]

Without --apply, mutating commands print a dry-run plan and make no changes.
"list" is always read-only.

Full reference + gotchas (esp. set-api-descriptor): docs/db-cleanup-cli.md`);
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
  if ((!map.urlField && !map.urlTemplate) || !map.titleField) {
    throw new UsageError('--map needs titleField and one of urlField or urlTemplate');
  }
  if (map.pagination) {
    const { pageParam, perPage } = map.pagination;
    if (!(typeof pageParam === 'string' && typeof perPage === 'number' && perPage > 0)) {
      throw new UsageError('--map pagination needs a string pageParam and a positive perPage');
    }
  }
  if (render) {
    console.log('note: --render uses the headless renderer to clear Cloudflare and read the JSON API (WP-45b).');
  }
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

async function cmdProbeApi(args: string[], render: boolean, apply: boolean): Promise<void> {
  const sourceId = args[0];
  if (!sourceId) throw new UsageError('probe-api requires <sourceId>');
  const endpoint = process.env.RENDER_URL;
  if (!endpoint) {
    throw new UsageError('probe-api needs RENDER_URL (+ RENDER_SECRET) in the env (point it at the deployed /api/render).');
  }
  const source = await getSourceForProbe(sourceId);
  if (!source) {
    console.log(`No source ${sourceId} for the current user.`);
    return;
  }

  console.log(`Rendering ${source.url} to capture its runtime chapter API…`);
  // A protected Vercel preview deployment needs the automation-bypass header to get past the
  // platform SSO gate before our route's RENDER_SECRET check runs.
  // The bypass header alone grants access for this single POST; do NOT set the bypass *cookie*
  // (`x-vercel-set-bypass-cookie`) — that makes Vercel redirect to set a cookie we don't carry
  // back, so undici loops until "redirect count exceeded".
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const capture = makeRenderCapture({
    endpoint,
    secret: process.env.RENDER_SECRET,
    timeoutMs: 60_000,
    extraHeaders: bypass ? { 'x-vercel-protection-bypass': bypass } : undefined,
  });
  const result = await capture(source.url);
  if (!result.ok) {
    console.log(`Render capture failed: ${result.error ?? 'unknown error'}`);
    return;
  }

  const candidates = inferApiDescriptors(result.captures);
  if (candidates.length === 0) {
    console.log(`Captured ${result.captures.length} JSON response(s), but none looked like a chapter list:`);
    for (const c of result.captures) {
      const preview = c.body.replace(/\s+/g, ' ').slice(0, 200);
      console.log(`  - ${c.url}  (${c.body.length} bytes)\n      ${preview}`);
    }
    // Diagnose whether the page even ran: an empty/challenge shell means the render was gated
    // (CF/bot-block on the datacenter IP) or didn't hydrate — distinct from a nudge that missed.
    const html = result.html ?? '';
    const gated = /just a moment|cf-mitigated|attention required|enable javascript|verify you are human/i.test(html);
    console.log(`\nrendered page: finalUrl=${result.finalUrl ?? '?'}  html=${html.length} bytes`);
    console.log(`  contains "chapter list" text: ${/chapter\s*list/i.test(html)}`);
    if (gated) console.log('  ⚠ looks like a Cloudflare/JS challenge — the datacenter IP is likely gated (tier 3).');
    console.log('\nIf the chapter-list request is missing above, the render didn’t trigger it — CF-gating on the');
    console.log('datacenter IP, no hydration, or a different interaction. Inspect: DevTools → Network (docs/api-sources.md).');
    return;
  }

  console.log(`\nFound ${candidates.length} candidate chapter API(s):\n`);
  candidates.forEach((c, i) => {
    // Sanity-count: run the inferred descriptor against the captured body it came from.
    const cap = result.captures.find((x) => x.url.split('?')[0] === c.apiUrl.split('?')[0]);
    let parsed = c.sampleCount;
    if (cap) {
      let origin = c.apiUrl;
      try {
        origin = new URL(cap.url).origin;
      } catch {
        // keep the apiUrl as the resolution base
      }
      parsed = parseApiChapters(cap.body, c.descriptor, origin).length;
    }
    console.log(`[${i + 1}] ${c.apiUrl}`);
    console.log(`    items in capture: ${c.sampleCount}  ·  parsed by descriptor: ${parsed}`);
    console.log(`    map: ${JSON.stringify(c.descriptor)}`);
    for (const n of c.notes) console.log(`    ⚠ ${n}`);
  });

  const top = candidates[0]!;
  const unconfirmed = top.descriptor.urlTemplate?.includes(UNCONFIRMED_PREFIX) ?? false;
  if (!apply) {
    console.log(`\n[dry run] Re-run with --apply to wire candidate [1] onto source ${sourceId} (fetchMode ${render ? 'RENDER' : 'PLAIN'}).`);
    if (unconfirmed) {
      console.log('Note: candidate [1] needs its reader-URL prefix filled in first (see ⚠) — wire it via set-api-descriptor once you know the path.');
    }
    return;
  }
  if (unconfirmed) {
    throw new UsageError(
      `candidate [1] has an unconfirmed reader-URL prefix (${UNCONFIRMED_PREFIX}). Open a real chapter, then wire it with:\n` +
        `  set-api-descriptor ${sourceId} --endpoint '${top.apiUrl}' --map '<edited map>'${render ? ' --render' : ''} --apply`,
    );
  }
  const res = await setApiDescriptor(sourceId, { endpoint: top.apiUrl, map: top.descriptor, render });
  console.log(
    res.updated
      ? `Wired candidate [1] onto source ${sourceId} (API, fetchMode ${render ? 'RENDER' : 'PLAIN'}).`
      : `No source ${sourceId} for the current user.`,
  );
}

export async function run(argv: string[]): Promise<void> {
  const [, , cmd, ...rest] = argv;
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
    case 'probe-api':
      return cmdProbeApi(args, render, apply);
    default:
      throw new UsageError(cmd ? `Unknown command: ${cmd}` : 'No command given');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv)
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
}
