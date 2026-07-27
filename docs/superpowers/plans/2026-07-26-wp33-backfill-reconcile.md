# WP-33 — Full-TOC backfill + silent access-reconcile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give feed-based series their full chapter history from the TOC (at add + on-demand) and silently reconcile feed-originated `UNKNOWN` chapters to `FREE`/`LOCKED` — the building block that arms WP-20's "now free" for feed series.

**Architecture:** Edges-inward, additive. (1) A new pure `accessReconciled` diff dimension. (2) Threaded through `PollEffects` + persisted silently (by stored id, no push). (3) An on-demand `backfillFromToc` service + API that reads the source's TOC, diffs against stored, and silently persists the older tail + reconciled access. (4) The same full-history seeding at add via a pure feed+TOC merge. (5) A UI button. No DB migration — reuses the existing `access`/`becameFreeAt` columns and the WP-20 stored-id persistence.

**Tech Stack:** TypeScript (strict), Vitest (unit + integration), Prisma/Postgres, `cheerio` (`parseToc`), Next App Router.

## Global Constraints

- **`src/lib/**` stays pure** — no `next`/`prisma`/`fs`/network imports. `diff.ts` and `pageWatch.ts` are `lib/`.
- **TDD** — a failing test first, watched fail for the right reason, then minimal code to green.
- **Verify before done** — `npm test` + `npm run typecheck` (fresh output) before any "done"/commit. Integration:
  `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration` (that DB is migrated/ready).
- **Access values:** `FeedItem.access` / `KnownChapter.access` are `'FREE' | 'LOCKED'` (`undefined` = unknown; the DB
  `AccessState` `UNKNOWN` maps to `undefined` at the binding, already done in `loadStoredChapters`).
- **`accessReconciled` = learning, not an unlock:** an already-seen chapter whose **stored** access is `undefined`
  (UNKNOWN) and whose **fetched** access is `FREE` or `LOCKED`. It is **silent** — access updated, **no `becameFreeAt`,
  no push**. Disjoint from `becameFree` (which requires stored `LOCKED`).
- **Backfill is silent:** the on-demand and at-add backfill paths **never** fire pushes (they are bulk syncs, not
  new-content polls). `becameFree` encountered during a backfill is persisted (state kept correct) but **not** notified.
- **Identity = canonical URL** (spike-validated coherent across a WP and a custom site) with `guid` where present —
  reuse the existing `diffChapters` matching; do not invent a new identity.
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
  Commit directly to `main` (repo convention).

---

### Task 1: `accessReconciled` in `diffChapters` + export `canonicalUrl` (pure)

**Files:**
- Modify: `src/lib/feeds/diff.ts`
- Test: `tests/unit/feeds/diff.test.ts`

**Interfaces:**
- Consumes: existing `diffChapters` internals (`storedMatch`, `canonicalUrl`, the WP-20 stored-id `becameFree`).
- Produces: `export function canonicalUrl(raw: string): string` (was private); `DiffResult.accessReconciled: KnownChapter[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/feeds/diff.test.ts` (reuse the existing `stored`/`fetchedItem` helpers from the becameFree block):

```ts
describe('diffChapters — accessReconciled (learning access on UNKNOWN chapters)', () => {
  const stored = (url: string, access?: 'FREE' | 'LOCKED', guid?: string) => ({ url, access, guid });
  const fetchedItem = (url: string, access?: 'FREE' | 'LOCKED', guid?: string): FeedItem => ({ url, title: url, access, guid });

  test('a stored UNKNOWN chapter the TOC marks LOCKED is reconciled (not new, not becameFree)', () => {
    const r = diffChapters([stored('https://x/a', undefined)], [fetchedItem('https://x/a', 'LOCKED')]);
    expect(r.new).toEqual([]);
    expect(r.becameFree).toEqual([]);
    expect(r.accessReconciled.map((c) => c.url)).toEqual(['https://x/a']);
  });

  test('a stored UNKNOWN chapter the TOC marks FREE is reconciled', () => {
    const r = diffChapters([stored('https://x/a', undefined)], [fetchedItem('https://x/a', 'FREE')]);
    expect(r.accessReconciled.map((c) => c.url)).toEqual(['https://x/a']);
    expect(r.becameFree).toEqual([]); // UNKNOWN→FREE is learning, not an unlock
  });

  test('a stored LOCKED→FREE is becameFree, NOT accessReconciled (disjoint)', () => {
    const r = diffChapters([stored('https://x/a', 'LOCKED')], [fetchedItem('https://x/a', 'FREE')]);
    expect(r.becameFree.map((c) => c.url)).toEqual(['https://x/a']);
    expect(r.accessReconciled).toEqual([]);
  });

  test('a known FREE/LOCKED chapter with unchanged access is not reconciled', () => {
    const r = diffChapters(
      [stored('https://x/a', 'FREE'), stored('https://x/b', 'LOCKED')],
      [fetchedItem('https://x/a', 'FREE'), fetchedItem('https://x/b', 'LOCKED')],
    );
    expect(r.accessReconciled).toEqual([]);
  });

  test('an UNKNOWN stored chapter still UNKNOWN in the fetch (feed poll) is not reconciled', () => {
    const r = diffChapters([stored('https://x/a', undefined)], [fetchedItem('https://x/a', undefined)]);
    expect(r.accessReconciled).toEqual([]);
  });

  test('reconciled carries the stored chapter identity (id) for by-id persistence', () => {
    const r = diffChapters([{ id: 'c1', url: 'https://x/a', access: undefined }], [fetchedItem('https://x/a', 'LOCKED')]);
    expect(r.accessReconciled[0]!.id).toBe('c1');
  });
});
```

Also add a tiny export test in the same file (top-level `describe`) to pin the new public API:

```ts
test('canonicalUrl is exported and normalizes a tracking/fragment variant', () => {
  expect(canonicalUrl('https://x/a/?utm_source=rss#c1')).toBe(canonicalUrl('https://x/a'));
});
```

Update the top import to include `canonicalUrl`:

```ts
import { diffChapters, canonicalUrl, type FeedItem, type KnownChapter } from '../../../src/lib/feeds/diff';
```
*(match the existing relative depth used in this test file).*

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/feeds/diff.test.ts`
Expected: FAIL — `accessReconciled` is `undefined`; `canonicalUrl` is not exported (import error).

- [ ] **Step 3: Implement in `diff.ts`**

1. Export the existing helper: change `function canonicalUrl(` → `export function canonicalUrl(`.

2. Add to `DiffResult`:

```ts
  /** Already-seen chapters whose stored access was UNKNOWN and is now known (FREE/LOCKED) from a TOC read.
   *  Silent — access is *learned*, not an unlock. Carries the stored identity for by-id persistence. */
  accessReconciled: KnownChapter[];
```

3. In `diffChapters`, add an accumulator and populate it in the already-seen branch (right after the `becameFree` check; reuse the existing `match`/`unlockedUrls`/`key`):

```ts
  const becameFree: KnownChapter[] = [];
  const accessReconciled: KnownChapter[] = [];
  const reconciledUrls = new Set<string>();
  const unlockedUrls = new Set<string>();
  for (const item of fetched) {
    if (isSeen(item)) {
      const key = canonicalUrl(item.url);
      const match = storedMatch(item);
      if (item.access === 'FREE' && match?.access === 'LOCKED' && !unlockedUrls.has(key)) {
        unlockedUrls.add(key);
        becameFree.push(match);
      } else if (
        (item.access === 'FREE' || item.access === 'LOCKED') &&
        match !== undefined &&
        match.access === undefined &&
        !reconciledUrls.has(key)
      ) {
        reconciledUrls.add(key);
        accessReconciled.push({ ...match, access: item.access }); // stored identity + the newly-learned access
      }
      continue;
    }
    remember(item);
    fresh.push(item);
  }
  return { new: fresh, becameFree, accessReconciled };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/feeds/diff.test.ts`
Expected: PASS (new blocks + all pre-existing diff/becameFree tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean. `DiffResult.accessReconciled` is required, so any code constructing a `DiffResult` literal must set it — `diffChapters` is the only producer, so no external breakage; confirm.

- [ ] **Step 6: Commit**

```bash
git add src/lib/feeds/diff.ts tests/unit/feeds/diff.test.ts
git commit -m "$(cat <<'EOF'
WP-33: diffChapters reports accessReconciled (UNKNOWN→known); export canonicalUrl

A seen chapter with stored UNKNOWN access and a known (FREE/LOCKED) TOC access
is reported in accessReconciled, carrying the stored identity for by-id
persistence. Disjoint from becameFree (stored LOCKED). canonicalUrl is now
exported for reuse by the feed+TOC merge.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Persist `accessReconciled` (PollEffects + applyPollEffects, silent)

**Files:**
- Modify: `src/server/services/poll.ts`
- Modify: `src/server/services/index.ts` (applyPollEffects) + `tests/integration/services.test.ts` `effect()` factory
- Test: `tests/unit/server/poll.test.ts`, `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `diffChapters(...).accessReconciled` (Task 1).
- Produces: `PollEffects.accessReconciled: KnownChapter[]` (required); `applyPollEffects` updates those rows' `access`
  by id (no `becameFreeAt`, no push).

- [ ] **Step 1: Write the failing unit test**

Append inside `describe('pollSource', ...)` in `tests/unit/server/poll.test.ts` (reuse `source`/`ports`/`ok`):

```ts
  test('PAGE_WATCH: a stored UNKNOWN chapter the TOC marks LOCKED surfaces in accessReconciled', async () => {
    const tocHtml = `<ul><li class="premium"><a href="https://x.example/novel/a/chapter-1/">Chapter 1</a></li></ul>`;
    const p = ports(ok(tocHtml), [{ url: 'https://x.example/novel/a/chapter-1/', access: undefined }]);
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchUrl: 'https://x.example/novel/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.newChapters).toEqual([]);
    expect(effects.accessReconciled.map((c) => c.url)).toEqual(['https://x.example/novel/a/chapter-1/']);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/server/poll.test.ts`
Expected: FAIL — `effects.accessReconciled` is `undefined`.

- [ ] **Step 3: Thread it through `poll.ts`**

1. Add to `PollEffects` (after `becameFree`):

```ts
  /** Already-seen chapters whose access was learned (UNKNOWN→FREE/LOCKED) from a TOC read. Silent. */
  accessReconciled: KnownChapter[];
```

2. Add the accumulator and read it from the diff (mirror `becameFree`):

```ts
  let becameFree: KnownChapter[] = [];
  let accessReconciled: KnownChapter[] = [];
```
```ts
      const diff = diffChapters(stored, mine);
      newChapters = diff.new;
      becameFree = diff.becameFree;
      accessReconciled = diff.accessReconciled;
```

3. Add `accessReconciled` to the `effects` object literal (after `becameFree`).

- [ ] **Step 4: Persist it in `applyPollEffects` + keep typecheck green**

In `src/server/services/index.ts`, inside `applyPollEffects`'s `$transaction` array, after the `becameFree` updates, add (silent — access only, no `becameFreeAt`):

```ts
        ...e.accessReconciled.flatMap((c) =>
          c.id
            ? [db.chapter.updateMany({ where: { id: c.id }, data: { access: c.access ?? 'UNKNOWN' } })]
            : [],
        ),
```

In `tests/integration/services.test.ts`, add `accessReconciled: []` to the `effect()` PollEffects factory (next to `becameFree: []`).

- [ ] **Step 5: Add the integration test**

Append inside `describe('page-watch source (real DB)', ...)` in `tests/integration/services.test.ts` (reuse `WATCH_URL`/`W1`/`TOC`/`ROW`):

```ts
  test('WP-33: a page-watch poll reconciles a stored UNKNOWN chapter to LOCKED, silently', async () => {
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) }));
    // Force the seeded chapter to UNKNOWN (simulate a feed-originated row).
    await db.chapter.updateMany({ where: { seriesId }, data: { access: 'UNKNOWN' } });

    await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1, true))) })); // now marked locked

    const w1 = await db.chapter.findFirstOrThrow({ where: { seriesId, url: W1 } });
    expect(w1.access).toBe('LOCKED');
    expect(w1.becameFreeAt).toBeNull(); // reconcile is silent — not an unlock
  });
```

- [ ] **Step 6: Verify + commit**

Run: `npx vitest run tests/unit/server/poll.test.ts` → PASS; `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration` → PASS; `npm run typecheck` → clean.

```bash
git add src/server/services/poll.ts src/server/services/index.ts tests/unit/server/poll.test.ts tests/integration/services.test.ts
git commit -m "$(cat <<'EOF'
WP-33: thread + persist accessReconciled (silent UNKNOWN→known access)

PollEffects.accessReconciled flows from the diff; applyPollEffects updates
those rows' access by id with no becameFreeAt and no push. Empty on feed
polls (feed items are UNKNOWN).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: On-demand `backfillFromToc` service + API (silent)

**Files:**
- Modify: `src/server/services/index.ts` (new `backfillFromToc` + a `persistBackfill` port)
- Create: `src/app/api/series/[id]/backfill/route.ts`
- Test: `tests/integration/services.test.ts`; `tests/unit/server/` (route auth/validator if extracted)

**Interfaces:**
- Consumes: `parseToc`, `diffChapters`, `politeFetch`, the series' active source.
- Produces: `export async function backfillFromToc(seriesId: string, fetchImpl?: FetchImpl): Promise<{ added: number; reconciled: number }>` — fetches the source's TOC page (`source.url`), diffs against stored, inserts the older tail + reconciles access, **no push, no source-health/etag change**.

- [ ] **Step 1: Write the failing integration test**

Append to `tests/integration/services.test.ts` a new `describe('backfillFromToc (real DB)', ...)` (reuse `addAlpha`/`okRes`/`fetchFrom`; import `backfillFromToc` from `../../src/server/services`):

```ts
describe('backfillFromToc (real DB)', () => {
  const PAGE = 'https://translator.example/novel/alpha/';
  const B1 = 'https://translator.example/a-1/';
  const B2 = 'https://translator.example/a-2/';
  const B3 = 'https://translator.example/a-3/';
  const TOC = (rows: string) => `<html><body><ul>${rows}</ul></body></html>`;
  const ROW = (u: string, locked = false) => `<li${locked ? ' class="premium"' : ''}><a href="${u}">Chapter</a></li>`;

  test('adds older chapters missing from the feed window and reconciles access, without pushing', async () => {
    // addAlpha() seeds a FEED series with 2 chapters (a-1, a-2) as access UNKNOWN, source.url = the series page.
    const seriesId = await addAlpha();
    // Point the source's reading page at our TOC (which shows the full history a-1..a-3, a-2 locked).
    await db.source.updateMany({ where: { seriesId }, data: { url: PAGE } });

    const result = await backfillFromToc(
      seriesId,
      fetchFrom({ [PAGE]: okRes(TOC(ROW(B1) + ROW(B2, true) + ROW(B3))) }),
    );

    expect(result.added).toBe(1); // a-3 was missing
    expect(result.reconciled).toBe(2); // a-1 → FREE, a-2 → LOCKED (were UNKNOWN)

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([B1, B2, B3]);
    expect(chapters.find((c) => c.url === B2)!.access).toBe('LOCKED');
    expect(chapters.find((c) => c.url === B3)!.access).toBe('FREE');
  });
});
```

*(Note: `addAlpha` uses feed URLs `a-1`/`a-2` that share the `translator.example` host — the TOC rows above reuse those exact URLs so the diff matches by canonical URL. If `addAlpha`'s constants differ, align the ROW URLs to its `C1`/`C2`.)*

- [ ] **Step 2: Run it to verify it fails**

Run: `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration`
Expected: FAIL — `backfillFromToc` is not exported.

- [ ] **Step 3: Implement `backfillFromToc` + `persistBackfill` in `index.ts`**

Add near the other services:

```ts
/** One-time TOC read for a feed (or any) series: add the older tail the feed window never showed and
 *  reconcile feed-originated UNKNOWN chapters to the TOC's FREE/LOCKED. Silent — never pushes, never
 *  touches source health/etag (it reads the reading page, not the feed). */
export async function backfillFromToc(
  seriesId: string,
  fetchImpl: FetchImpl = fetchPort,
): Promise<{ added: number; reconciled: number }> {
  const source = await db.source.findFirst({ where: { seriesId, isActive: true } });
  if (!source) return { added: 0, reconciled: 0 };
  const res = await fetchImpl(source.url, {});
  if (res.outcome !== 'SUCCESS' || res.notModified) return { added: 0, reconciled: 0 };

  const toc = parseToc(res.body, source.url);
  const stored = (
    await db.chapter.findMany({ where: { seriesId }, select: { id: true, guid: true, url: true, access: true } })
  ).map((c) => ({ id: c.id, guid: c.guid ?? undefined, url: c.url, access: c.access === 'UNKNOWN' ? undefined : c.access }));
  const diff = diffChapters(stored, toc);

  const now = new Date();
  await db.$transaction([
    ...(diff.new.length > 0
      ? [
          db.chapter.createMany({
            data: diff.new.map((c) => ({
              seriesId,
              sourceId: source.id,
              title: c.title,
              url: c.url,
              guid: c.guid ?? null,
              number: c.number ?? null,
              access: c.access ?? 'UNKNOWN',
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
    ...diff.becameFree.flatMap((c) =>
      c.id ? [db.chapter.updateMany({ where: { id: c.id, becameFreeAt: null }, data: { access: 'FREE' as const, becameFreeAt: now } })] : [],
    ),
    ...diff.accessReconciled.flatMap((c) =>
      c.id ? [db.chapter.updateMany({ where: { id: c.id }, data: { access: c.access ?? 'UNKNOWN' } })] : [],
    ),
  ]);
  return { added: diff.new.length, reconciled: diff.accessReconciled.length };
}
```

Ensure `parseToc`, `diffChapters`, `FetchImpl`, `fetchPort` are imported in `index.ts` (grep — `diffChapters`/`parseToc` may not be imported yet there; add them from `../../lib/feeds/diff` and `../../lib/feeds/pageWatch`).

- [ ] **Step 4: Add the API route**

Create `src/app/api/series/[id]/backfill/route.ts` (follow the existing `src/app/api/series/[id]/route.ts` for the App-Router signature + `getCurrentUserId` ownership pattern):

```ts
import { NextResponse } from 'next/server';
import { backfillFromToc } from '../../../../../server/services';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await backfillFromToc(id);
  return NextResponse.json(result);
}
```

*(Auth: the edge middleware already gates `/api/**` except its allowlist — confirm `backfill` is NOT on the allowlist so it inherits the session gate; match how `/api/series/[id]` PATCH is protected.)*

- [ ] **Step 5: Verify + commit**

Run the integration suite (PASS), `npm test` (PASS), `npm run typecheck` (clean), and `npm run build` (the new route compiles).

```bash
git add src/server/services/index.ts "src/app/api/series/[id]/backfill/route.ts" tests/integration/services.test.ts
git commit -m "$(cat <<'EOF'
WP-33: on-demand backfillFromToc service + API (silent full-history sync)

Reads the active source's TOC, diffs against stored, adds the older tail the
feed window never showed, and reconciles UNKNOWN→FREE/LOCKED — no push, no
source-health/etag change. POST /api/series/[id]/backfill.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Backfill at add — feed+TOC merge seeding

**Files:**
- Modify: `src/lib/feeds/pageWatch.ts` (new pure `mergeFeedAndToc`)
- Modify: `src/server/services/addSeries.ts` (FEED branch seeds the merged set)
- Test: `tests/unit/feeds/pageWatch.test.ts`, `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `canonicalUrl` (Task 1), `FeedItem` (`diff.ts`), `TocChapter` (`pageWatch.ts`), `parseToc`.
- Produces: `export function mergeFeedAndToc(feedItems: FeedItem[], tocItems: TocChapter[]): FeedItem[]` — every feed
  item (guid preserved), access upgraded from a matching TOC item; plus every TOC item not in the feed (the older
  tail). Matched by `canonicalUrl`.

- [ ] **Step 1: Write the failing unit test**

Append to `tests/unit/feeds/pageWatch.test.ts` (import `mergeFeedAndToc`; construct `FeedItem`/`TocChapter` literals):

```ts
describe('mergeFeedAndToc', () => {
  const feed = (url: string, guid?: string): import('../../../src/lib/feeds/diff').FeedItem => ({ url, title: url, guid, access: undefined });
  const toc = (url: string, access: 'FREE' | 'LOCKED'): import('../../../src/lib/feeds/pageWatch').TocChapter => ({ url, title: url, number: null, access });

  test('feed items keep their guid but gain access from the matching TOC item', () => {
    const merged = mergeFeedAndToc([feed('https://x/a', 'g1')], [toc('https://x/a', 'FREE')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ url: 'https://x/a', guid: 'g1', access: 'FREE' });
  });

  test('TOC items missing from the feed (older tail) are appended with their access', () => {
    const merged = mergeFeedAndToc([feed('https://x/b', 'g2')], [toc('https://x/a', 'LOCKED'), toc('https://x/b', 'FREE')]);
    expect(merged.map((c) => c.url).sort()).toEqual(['https://x/a', 'https://x/b']);
    expect(merged.find((c) => c.url === 'https://x/a')!.access).toBe('LOCKED'); // tail, from TOC
    expect(merged.find((c) => c.url === 'https://x/b')!.guid).toBe('g2'); // overlap keeps feed guid
  });

  test('canonical match ignores tracking params / trailing slash', () => {
    const merged = mergeFeedAndToc([feed('https://x/a?utm_source=rss', 'g1')], [toc('https://x/a/', 'LOCKED')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ guid: 'g1', access: 'LOCKED' });
  });

  test('empty TOC (under-read) → just the feed items, unchanged', () => {
    const merged = mergeFeedAndToc([feed('https://x/a', 'g1')], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.access).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/feeds/pageWatch.test.ts`
Expected: FAIL — `mergeFeedAndToc` not exported.

- [ ] **Step 3: Implement `mergeFeedAndToc` in `pageWatch.ts`**

Add the import and the function:

```ts
import { canonicalUrl, type FeedItem } from './diff';
```
```ts
/** Seed a feed series' full history: feed items (guid preserved) with access upgraded from the TOC where they
 *  match, plus the TOC's older tail the feed window never showed. Matched by canonical URL. Falls back to just
 *  the feed items when the TOC under-reads (JS/CF page). */
export function mergeFeedAndToc(feedItems: FeedItem[], tocItems: TocChapter[]): FeedItem[] {
  const tocByUrl = new Map(tocItems.map((t) => [canonicalUrl(t.url), t]));
  const usedToc = new Set<string>();
  const merged: FeedItem[] = feedItems.map((f) => {
    const key = canonicalUrl(f.url);
    const t = tocByUrl.get(key);
    if (t) usedToc.add(key);
    return t ? { ...f, access: t.access } : f;
  });
  for (const t of tocItems) {
    const key = canonicalUrl(t.url);
    if (!usedToc.has(key)) merged.push({ url: t.url, title: t.title, number: t.number, access: t.access });
  }
  return merged;
}
```

- [ ] **Step 4: Wire into `addSeries.ts` (FEED branch)**

In the FEED branch of `src/server/services/addSeries.ts`, replace the `const chapters = filterBySeriesMatch(parsed.items, match);` line so it merges the TOC when the page was a reachable TOC:

```ts
    const feedChapters = filterBySeriesMatch(parsed.items, match);
    const chapters = pageOk ? mergeFeedAndToc(feedChapters, parseToc(page.body, url)) : feedChapters;
```

Add `mergeFeedAndToc` to the existing `parseToc` import from `../../lib/feeds/pageWatch`.

- [ ] **Step 5: Add the integration test**

Append to `describe('addSeries (real DB)', ...)` in `tests/integration/services.test.ts`. `addAlpha` seeds via a page that advertises a feed; make that page ALSO a TOC listing more chapters than the feed, and assert the full set is seeded with TOC access:

```ts
  test('WP-33: a feed series seeds its full TOC history at add, with TOC access', async () => {
    // Page advertises the feed AND lists the full chapter history (feed shows only a-1,a-2; TOC adds a-3 locked).
    const PAGE_HTML =
      `<html><head><link rel="alternate" type="application/rss+xml" href="${FEED_URL}"></head>` +
      `<body><ul>` +
      `<li><a href="${C1}">Chapter 1</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `<li class="premium"><a href="${C3}">Chapter 3</a></li>` +
      `</ul></body></html>`;
    const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE_HTML), [FEED_URL]: okRes(RSS(ITEM('g1', C1) + ITEM('g2', C2))) });
    const { seriesId } = await addSeries({ url: PAGE_URL }, fetch);

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([C1, C2, C3]); // a-3 backfilled from the TOC
    expect(chapters.find((c) => c.url === C3)!.access).toBe('LOCKED');
    expect(chapters.find((c) => c.url === C1)!.guid).toBe('g1'); // overlap kept the feed guid
  });
```

*(Use the module's existing `PAGE_URL`/`FEED_URL`/`C1..C3`/`RSS`/`ITEM` constants; `addAlpha`'s `PAGE` currently returns a head-only doc, so this test supplies its own page HTML.)*

- [ ] **Step 6: Verify + commit**

`npx vitest run tests/unit/feeds/pageWatch.test.ts` → PASS; integration (with the DB override) → PASS; `npm test` → PASS; `npm run typecheck` → clean.

```bash
git add src/lib/feeds/pageWatch.ts src/server/services/addSeries.ts tests/unit/feeds/pageWatch.test.ts tests/integration/services.test.ts
git commit -m "$(cat <<'EOF'
WP-33: seed the full TOC history at add (feed+TOC merge)

New pure mergeFeedAndToc: feed items keep their guid and gain access from the
matching TOC row; the TOC's older tail is appended. addSeries' FEED branch
seeds the merged set when the pasted page is a reachable TOC (falls back to the
feed window when the TOC under-reads).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: "Backfill from TOC" UI button + PLAN closeout

**Files:**
- Modify: the series-detail page/component under `src/app/(app)/series/[id]/` (match WP-10's structure)
- Modify: `PLAN.md`

- [ ] **Step 1: Add the button**

On the series-detail page, add a "Backfill from TOC" control that `POST`s to `/api/series/${id}/backfill` and refreshes on success (a client component with a pending state; reuse the existing mark-progress/PATCH client pattern in that route group). Show the returned `{ added, reconciled }` as a brief confirmation. Keep it visually consistent with the existing detail-page controls (no new design system). Manually verify against a seeded local DB (start the app, click it, confirm chapters appear + a toast/message).

- [ ] **Step 2: Commit the UI**

```bash
git add "src/app/(app)/series/[id]"
git commit -m "$(cat <<'EOF'
WP-33: "Backfill from TOC" button on series detail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Close out PLAN.md**

Flip **WP-33** `TODO → DONE`; update the Current-focus/`NEXT`; add a Changelog entry (accessReconciled arms now-free for feed series; full-history backfill at add + on-demand; URL-coherence spike-validated; WP-34 still CF-gated). Commit:

```bash
git add PLAN.md
git commit -m "$(cat <<'EOF'
plan: WP-33 DONE — full-TOC backfill + silent access-reconcile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-26-feed-toc-transition-design.md` §A + the access-reconcile building block):
- Silent `accessReconciled` (UNKNOWN→FREE/LOCKED, no push, arms now-free) → Task 1 (diff) + Task 2 (persist). ✓
- Backfill at add (full TOC, READING) → Task 4. *(PLANNED-seeds-summary is WP-27, untouched here — the merge only runs in `addSeries`'s existing FEED path; PLANNED gating lands with WP-27.)* ✓
- On-demand "Backfill from TOC" (existing series), explicit action not re-add → Task 3 (service+API) + Task 5 (button). ✓
- Silent backfill (no push storm) → Task 3 uses a dedicated path that never calls `notifyForEffects`. ✓
- URL identity (spike-validated) reused via `diffChapters`/`canonicalUrl` → Tasks 1/3/4. ✓
- No migration → confirmed (reuses `access`/`becameFreeAt`). ✓
- WP-34 (switch, add-time lock-detect, manual override) is **out of scope** here — not in this plan. ✓

**Placeholder scan:** none — every code/test step has concrete code and exact commands. Task 5's UI is described against WP-10's existing pattern rather than pinned to exact filenames (the detail route-group filenames aren't confirmed in this plan); the implementer resolves the exact component path — flagged, not a silent gap.

**Type consistency:** `accessReconciled: KnownChapter[]` identical in `DiffResult` (T1) → `PollEffects` (T2) → persisted by `id` (T2/T3); `KnownChapter` already carries `id?`/`access?` from WP-20. `mergeFeedAndToc(FeedItem[], TocChapter[]) → FeedItem[]` (T4) consumes the exported `canonicalUrl` (T1). `backfillFromToc(seriesId, fetchImpl?) → { added, reconciled }` (T3) consumes the API route (T3) and is surfaced by the button (T5). The `updateMany` by `id` for reconcile matches the WP-20 becameFree persistence shape.

**Open risk noted:** the integration tests assume `addAlpha`'s URL constants; each such test says to align ROW/ITEM URLs to the module's actual `C1..C3`. If `addAlpha` differs, the implementer adjusts the fixture URLs (not the assertions).
