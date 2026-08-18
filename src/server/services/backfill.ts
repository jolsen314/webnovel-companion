/**
 * The pure decision core of a TOC backfill (WP-SIMPLIFY A1), extracted out of
 * `services/index.ts` so the subtlest branches — the reindex collision predicate,
 * the title-source choice — unit-test with fakes instead of only through the
 * integration DB. `index.ts` keeps the Prisma binding of the ports and the thin
 * async orchestrator that drives these pieces (mirrors `poll`/`scheduleNotify`).
 *
 * No `db` import: everything here is a pure function over already-fetched inputs.
 */

import { diffChapters, canonicalUrl, type KnownChapter } from '../../lib/feeds/diff';
import { parseToc, tocReadingOrder, type TocChapter } from '../../lib/feeds/pageWatch';
import { findTocUrl } from '../../lib/feeds/discover';
import { extractSeriesTitle } from '../../lib/feeds/title';
import type { PoliteResult } from '../../lib/feeds/fetch';

/** A stored chapter as the planner needs it: the diff identity plus its stored `position`
 *  (which the reindex-collision predicate reads — `KnownChapter` alone omits it). */
export interface StoredChapter extends KnownChapter {
  id: string;
  position: number | null;
}

/** A pure description of the writes a backfill intends — no Prisma, no `now`. The edge
 *  binds `seriesId`/`sourceId`/`now` when it applies the plan. */
export interface BackfillPlan {
  /** Chapters present in the TOC but not yet stored, each with its resolved reading-order position. */
  newChapters: {
    title: string;
    url: string;
    guid: string | null;
    number: number | null;
    access: 'FREE' | 'LOCKED' | 'UNKNOWN';
    position: number | null;
  }[];
  /** Stored chapters that flipped LOCKED→FREE (carry row id for exact-row persistence). */
  becameFree: KnownChapter[];
  /** Stored chapters whose UNKNOWN access is now learned (carry row id + the learned access). */
  accessReconciled: KnownChapter[];
  /** Position updates for already-stored chapters, empty when this TOC isn't authoritative. */
  reindex: { id: string; position: number }[];
  /** Self-healed TOC url to persist on the source, when one was discovered this run. */
  persistTocUrl?: string;
  /** Repaired series title to persist, when the title decision produced one. */
  persistTitle?: string;
}

/** What a DB loader supplies up front: the owned series' title state + its active source. One
 *  port folds both loads (ownership + active-source); either absent → the whole backfill no-ops. */
export interface BackfillMeta {
  currentTitle: string;
  titleIsManual: boolean;
  sourceId: string;
  sourceUrl: string;
  host: string;
  tocUrl: string | null;
}

/** The interleaved I/O the orchestrator drives, injected so its decisions unit-test with fakes.
 *  Each port is bound to one series at the edge; `applyBackfillPlan` gets the runtime-discovered
 *  `sourceId` (from the loaded meta) since the plan itself is series/source-agnostic. */
export interface BackfillPorts {
  /** Fetch a URL plainly (backfill never sends conditional headers). */
  fetch: (url: string) => Promise<PoliteResult>;
  /** Ownership + active source folded into one load; null → not owned or no active source. */
  loadSeriesMeta: () => Promise<BackfillMeta | null>;
  loadStoredChapters: () => Promise<StoredChapter[]>;
  applyBackfillPlan: (sourceId: string, plan: BackfillPlan) => Promise<void>;
}

/** A fetch is usable content only when it succeeded and wasn't a 304. */
function isFreshBody(res: PoliteResult): res is Extract<PoliteResult, { outcome: 'SUCCESS' }> {
  return res.outcome === 'SUCCESS' && !res.notModified;
}

/**
 * The thin async orchestrator (steps 1–13): it owns the interleaving — two of its fetches are
 * conditional on prior pure decisions (the self-heal follow, the title-body choice) — and drives
 * the pure `computeBackfillPlan`/`chooseTitleUpdate` between the I/O. Silent: reads the reading
 * page, never the feed, so it never touches source health/etag and fires no pushes.
 */
export async function runBackfill(
  ports: BackfillPorts,
): Promise<{ added: number; reconciled: number; titleUpdated?: string }> {
  const meta = await ports.loadSeriesMeta();
  if (!meta) return { added: 0, reconciled: 0 };

  // WP-37: fetch the real TOC page. If tocUrl is unset (pre-WP-37 series, or a landing page that
  // only later linked a TOC), self-heal: fetch the landing page, discover its TOC link, follow it
  // one hop, and persist tocUrl so future backfills/polls go straight there.
  let tocUrl = meta.tocUrl ?? meta.sourceUrl;
  let res = await ports.fetch(tocUrl);
  if (!isFreshBody(res)) return { added: 0, reconciled: 0 };

  // WP-30: the landing page (source.url) is the title source. On the self-heal path this first
  // `res` IS the landing page — capture it before findTocUrl/follow reassigns `res` to the TOC body.
  const landingBody: string | null = meta.tocUrl == null ? res.body : null;

  let discoveredTocUrl: string | null = null;
  if (meta.tocUrl == null) {
    const link = findTocUrl(res.body, meta.sourceUrl);
    if (link != null && link !== tocUrl) {
      const followed = await ports.fetch(link);
      if (isFreshBody(followed)) {
        tocUrl = link;
        res = followed;
        discoveredTocUrl = link;
      }
    }
  }

  const toc = parseToc(res.body, tocUrl);

  // Title source: the captured landing body (self-heal, free) → else one extra source.url fetch
  // (tocUrl-set path) → else the TOC body we already have.
  let titleBody = landingBody;
  if (titleBody == null && !meta.titleIsManual) {
    const landing = await ports.fetch(meta.sourceUrl);
    titleBody = isFreshBody(landing) ? landing.body : res.body;
  }
  const titleUpdate = chooseTitleUpdate(
    { titleIsManual: meta.titleIsManual, currentTitle: meta.currentTitle, host: meta.host },
    titleBody,
    res.body,
  );

  const stored = await ports.loadStoredChapters();
  const plan = computeBackfillPlan(stored, toc, { discoveredTocUrl, titleUpdate });
  await ports.applyBackfillPlan(meta.sourceId, plan);
  return { added: plan.newChapters.length, reconciled: plan.accessReconciled.length, titleUpdated: titleUpdate };
}

/** Step 8's decision, isolated and pure: extract a title from the preferred body (falling back to
 *  the TOC body), and return it only when it's a real, *different*, non-manual title to persist. */
export function chooseTitleUpdate(
  meta: { titleIsManual: boolean; currentTitle: string; host: string },
  titleBody: string | null,
  tocBody: string,
): string | undefined {
  if (meta.titleIsManual) return undefined;
  const extracted = extractSeriesTitle(titleBody ?? tocBody, { siteName: meta.host });
  return extracted != null && extracted !== meta.currentTitle ? extracted : undefined;
}

/** Steps 9, 11, 12: diff the TOC against the store, decide whether the read is authoritative
 *  enough to re-index reading-order positions, and assemble the pure write description. */
export function computeBackfillPlan(
  stored: StoredChapter[],
  toc: TocChapter[],
  opts: { discoveredTocUrl: string | null; titleUpdate: string | undefined },
): BackfillPlan {
  const order = tocReadingOrder(toc);
  const diff = diffChapters(stored, toc);
  // Re-index positions only when this TOC read is authoritative for the whole reading order.
  // Safe when every already-stored chapter is either listed in the TOC OR still unpositioned:
  //   - listed → gets its normalized index;
  //   - absent but unpositioned → a feed-ahead chapter (published to the feed before the
  //     hand-maintained TOC lists it); left null, it sorts last (= newest), colliding with nothing.
  // Blocked only when an absent chapter already HAS a position — a windowed/trimmed TOC (site
  // dropped an old chapter), where re-indexing the present chapters into a fresh 0..N-1 block
  // would collide with the dropped chapter's retained position. Then we leave positions as-is.
  const tocReindexable = order != null && stored.every((s) => order.has(canonicalUrl(s.url)) || s.position == null);

  return {
    newChapters: diff.new.map((c) => ({
      title: c.title,
      url: c.url,
      guid: c.guid ?? null,
      number: c.number ?? null,
      access: c.access ?? 'UNKNOWN',
      position: tocReindexable ? (order!.get(canonicalUrl(c.url)) ?? null) : null,
    })),
    becameFree: diff.becameFree,
    accessReconciled: diff.accessReconciled,
    reindex: tocReindexable
      ? stored.flatMap((s) => {
          const pos = order!.get(canonicalUrl(s.url));
          return pos != null ? [{ id: s.id, position: pos }] : [];
        })
      : [],
    ...(opts.discoveredTocUrl != null ? { persistTocUrl: opts.discoveredTocUrl } : {}),
    ...(opts.titleUpdate != null ? { persistTitle: opts.titleUpdate } : {}),
  };
}
