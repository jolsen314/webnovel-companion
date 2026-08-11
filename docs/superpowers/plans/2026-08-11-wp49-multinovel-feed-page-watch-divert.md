# WP-49 — Page-watch Divert for Un-isolable Multi-novel Feeds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `addSeries` from binding a series to a site-wide multi-novel feed (`WHOLE_FEED`) it can't isolate; when the series page is itself a real chapter list, resolve to a series-scoped `PAGE_WATCH` source instead.

**Architecture:** One surgical change in `addSeries`'s inner `resolveFrom`. Parse the page's own TOC once; in the FEED branch, when the feed was **advertised** (not guessed), `chooseSeriesMatch` returned **null**, and the page's TOC has more than `RENDER_ESCALATION_MAX` (5) chapters, fall through to the existing PAGE_WATCH branch rather than defaulting to `WHOLE_FEED`. `chooseSeriesMatch` is untouched.

**Tech Stack:** TypeScript (strict), Vitest (unit + integration), Prisma/Postgres.

## Global Constraints

- **Keep `src/lib/**` pure/Next-free.** This WP edits only `src/server/services/addSeries.ts` (orchestration over injected ports) and tests.
- **TDD** — failing test first; red → green → refactor.
- **Verify before "done"** — `npm test` (unit) + the integration project + `npm run typecheck`, fresh output, before any completion claim. Integration command (verified in this repo): `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration`.
- **Anonymity** — no real site/series names in code or docs; `*.example` hosts only.
- **Threshold** — reuse `RENDER_ESCALATION_MAX` (5), already imported in `addSeries` from `./poll`.
- **Do not modify `chooseSeriesMatch`** (avoid regressing its tested behavior). The fix lives entirely in `addSeries`.

---

### Task 1: The divert logic + unit tests

Parse the page TOC once and reuse it; add the WP-49 divert guard to the FEED branch. TDD with three new unit cases (divert; thin-page-stays-FEED; positive-match-stays-FEED).

**Files:**
- Modify: `src/server/services/addSeries.ts` (`resolveFrom` — three targeted edits)
- Test: `tests/unit/server/addSeries.test.ts`

**Interfaces:**
- Consumes: `parseToc`, `RENDER_ESCALATION_MAX`, `chooseSeriesMatch`, `withReadingPositions` (all already imported).
- Produces: no signature changes — behavior change only (an un-isolable advertised feed with a rich page TOC now yields a `PAGE_WATCH` `ResolvedSource` with `feedUrl: null`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/server/addSeries.test.ts` inside the top `describe('addSeries', …)`. Uses the existing `ports()` factory (which exposes `created`/`renderCalls`/`fetchCalls`) and the `ok`/`RSS`/`ITEM` helpers already in the file:

```ts
// A page that BOTH advertises a feed and is itself a chapter list (a TOC post).
const pageWithToc = (feedHref: string, chapterUrls: string[]) =>
  `<html><head><link rel="alternate" type="application/rss+xml" href="${feedHref}"></head><body><ul>${chapterUrls
    .map((u, i) => `<li><a href="${u}">Chapter ${i + 1}</a></li>`)
    .join('')}</ul></body></html>`;

test('WP-49: advertised multi-novel feed we cannot isolate + a real page TOC → PAGE_WATCH, not WHOLE_FEED', async () => {
  const url = 'https://wp.example/novel-toc/';
  const feedUrl = 'https://wp.example/feed/';
  const chapters = Array.from({ length: 6 }, (_, i) => `https://wp.example/novel-toc/ch-${i + 1}/`);
  const p = ports({
    // Site-wide feed: other novels, no category, date permalinks → chooseSeriesMatch returns null.
    [feedUrl]: ok(
      RSS(ITEM('o1', 'https://wp.example/2026/08/11/other-ch-1/') + ITEM('o2', 'https://wp.example/2026/08/11/misc-ch-9/')),
    ),
    [url]: ok(pageWithToc(feedUrl, chapters)),
  });

  const result = await addSeries({ url }, p);

  expect(result.resolved.type).toBe('PAGE_WATCH');
  expect(result.resolved.feedUrl).toBeNull();
  expect(result.resolved.fetchMode).toBe('PLAIN');
  expect(result.resolved.match).toEqual({ type: 'WHOLE_FEED' }); // page-watch is already series-scoped
  // Seeded from the page TOC, not the feed (order-independent: the other novels' feed items are absent).
  expect([...result.resolved.chapters.map((c) => c.url)].sort()).toEqual([...chapters].sort());
});

test('WP-49: advertised feed we cannot isolate but the page is NOT a TOC (≤5 links) → stays FEED WHOLE_FEED', async () => {
  const url = 'https://wp.example/novel-toc/';
  const feedUrl = 'https://wp.example/feed/';
  const p = ports({
    [feedUrl]: ok(RSS(ITEM('o1', 'https://wp.example/2026/08/11/other-ch-1/'))),
    // Page advertises the feed but has only 2 chapter-ish links → not a real TOC.
    [url]: ok(pageWithToc(feedUrl, ['https://wp.example/novel-toc/ch-1/', 'https://wp.example/novel-toc/ch-2/'])),
  });

  const result = await addSeries({ url }, p);

  expect(result.resolved.type).toBe('FEED');
  expect(result.resolved.feedUrl).toBe(feedUrl);
  expect(result.resolved.match).toEqual({ type: 'WHOLE_FEED' });
});

test('WP-49: a positive CATEGORY match is never diverted, even with a rich page TOC', async () => {
  const url = 'https://wp.example/novel/beta/';
  const feedUrl = 'https://wp.example/feed/';
  const chapters = Array.from({ length: 6 }, (_, i) => `https://wp.example/novel/beta/ch-${i + 1}/`);
  const p = ports({
    // A per-novel category matching the series slug → chooseSeriesMatch returns CATEGORY (not null).
    [feedUrl]: ok(RSS(ITEM('g1', 'https://wp.example/beta-1/', 'Beta') + ITEM('g2', 'https://wp.example/other-1/', 'Other Tale'))),
    [url]: ok(pageWithToc(feedUrl, chapters)),
  });

  const result = await addSeries({ url }, p);

  expect(result.resolved.type).toBe('FEED');
  expect(result.resolved.match).toEqual({ type: 'CATEGORY', value: 'Beta' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- addSeries`
Expected: the first test FAILS (`type` is `'FEED'` / `feedUrl` set — today it WHOLE_FEEDs). The second and third should already pass (they assert today's behavior), which confirms the guard's boundaries.

- [ ] **Step 3: Parse the page TOC once (Edit A)**

In `src/server/services/addSeries.ts`, add the shared parse right after `pageTitle`:

```ts
    const pageTitle = pageOk ? extractSeriesTitle(pageBody, { siteName: host }) : null;
    // Parse the page's own chapter list once (empty when the page didn't load). Reused by the
    // feed↔TOC merge, the WP-49 divert check, and the page-watch seed below.
    const pageToc = pageOk ? parseToc(pageBody, url) : [];
```

- [ ] **Step 4: Add the divert guard to the FEED branch (Edit B)**

Replace the entire FEED branch (`if (feedUrl !== null && feedBody !== null) { … }`) with:

```ts
    if (feedUrl !== null && feedBody !== null) {
      const parsed = await parseFeed(feedBody);
      const usedGuesses = advertised.length === 0;
      const positive = chooseSeriesMatch(parsed.items, url);
      // WP-49: an ADVERTISED feed we can't positively isolate is almost always the site-wide,
      // multi-novel `/feed/`. WHOLE_FEED-ing it ingests every other novel's chapters. If the page
      // is itself a real chapter list, prefer page-watch (series-scoped) over the contaminated
      // feed — fall through to the PAGE_WATCH branch below. A guessed feed, or a page that isn't
      // a real TOC, keeps today's behavior.
      const cantIsolateAdvertised = positive === null && !usedGuesses;
      if (!(cantIsolateAdvertised && pageToc.length > RENDER_ESCALATION_MAX)) {
        const match = positive ?? (usedGuesses ? fallbackSeriesMatch(parsed.items, url) : { type: 'WHOLE_FEED' });
        const feedChapters = filterBySeriesMatch(parsed.items, match);
        const toc = pageToc;
        const chapters = pageOk ? withReadingPositions(mergeFeedAndToc(feedChapters, toc), toc) : feedChapters;
        const seriesTitle =
          input.title ??
          pageTitle ??
          (positive?.type === 'CATEGORY'
            ? positive.value
            : match.type === 'WHOLE_FEED'
              ? (parsed.title != null && !matchesSiteName(parsed.title, host) ? parsed.title : titleFromUrl(url))
              : titleFromUrl(url));
        const tocUrl = pageOk ? findTocUrl(pageBody, url) : null;
        const core: ResolvedCore = {
          seriesTitle, sourceUrl: url, host, feedUrl, tocUrl, type: 'FEED', fetchMode: 'PLAIN', match, chapters,
        };
        return finalize(core, ports);
      }
      // else: advertised multi-novel feed we can't isolate + the page is a real TOC → page-watch it.
    }
```

- [ ] **Step 5: Reuse `pageToc` in the PAGE_WATCH branch (Edit C)**

In the `if (pageOk) { … }` branch, change the TOC parse to reuse the shared one:

```ts
    if (pageOk) {
      const tocUrl = findTocUrl(pageBody, url);
      let toc = pageToc;
      let fetchMode: 'PLAIN' | 'RENDER' = bodyMode;
```

(Leave the rest of the PAGE_WATCH branch — the WP-46 under-fetch block and the `core` — unchanged.)

- [ ] **Step 6: Run tests + typecheck to verify green**

Run: `npm test && npm run typecheck`
Expected: all three new tests pass; every existing `addSeries` test still passes (the divert guard only fires for advertised-feed + null-isolation + rich-page-TOC). Note the existing "page advertises a feed → FEED" test seeds from a body with no chapter links (`pageToc` empty), so it stays FEED.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/addSeries.ts tests/unit/server/addSeries.test.ts
git commit -m "WP-49: page-watch an un-isolable multi-novel advertised feed when the page is a real TOC

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Integration coverage + PLAN.md + verify

Prove the divert persists a `PAGE_WATCH` source (no feed, TOC chapters) on the real DB, flip WP-49 to DONE, and run the full verification.

**Files:**
- Test: `tests/integration/services.test.ts` (new case in the `addSeries (real DB)` describe)
- Modify: `PLAN.md`

**Interfaces:**
- Consumes: `addSeries`, `db`, `okRes`, `fetchFrom`, `RSS`, `ITEM` — all already in the integration file (`ITEM(guid, url)` there takes two args and titles it `Chapter <guid>`).

- [ ] **Step 1: Write the failing integration test**

Add inside `describe('addSeries (real DB)', …)` in `tests/integration/services.test.ts`:

```ts
  test('WP-49: an un-isolable multi-novel advertised feed + a real page TOC persists a PAGE_WATCH source', async () => {
    const url = 'https://wp.example/novel-toc/';
    const feedUrl = 'https://wp.example/feed/';
    const chapterUrls = Array.from({ length: 6 }, (_, i) => `https://wp.example/novel-toc/ch-${i + 1}/`);
    const page = `<html><head><link rel="alternate" type="application/rss+xml" href="${feedUrl}"></head><body><ul>${chapterUrls
      .map((u, i) => `<li><a href="${u}">Chapter ${i + 1}</a></li>`)
      .join('')}</ul></body></html>`;
    const feed = RSS(ITEM('o1', 'https://wp.example/2026/08/11/other-ch-1/') + ITEM('o2', 'https://wp.example/2026/08/11/misc-ch-9/'));

    const { seriesId } = await addSeries({ url }, fetchFrom({ [url]: okRes(page), [feedUrl]: okRes(feed) }));

    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.type).toBe('PAGE_WATCH');
    expect(source.feedUrl).toBeNull();

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([...chapterUrls].sort()); // the TOC's chapters, no cross-novel strays
  });
```

- [ ] **Step 2: Run to verify it passes (behavior implemented in Task 1)**

Run: `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration`
Expected: PASS. If it FAILS, do not edit the test — the divert or its persistence has a bug from Task 1; fix that.

- [ ] **Step 3: Update `PLAN.md`**

1. In the **▶ Active queue** table, remove the WP-49 row (completed WPs live only in the Completed sentence, matching WP-48/WP-46 precedent) and confirm the top data row is marked `NEXT` (WP-30 is next after WP-49 in the current order — set whichever row is now top-of-queue to `NEXT`).
2. Add WP-49 to the **✅ Completed** list line.
3. Update **Current focus**: add WP-49 to "Recently landed (newest first)" and set the new NEXT.
4. Add a **Changelog** entry dated **2026-08-11**:

```markdown
- **2026-08-11** — **WP-49 done: page-watch divert for un-isolable multi-novel advertised feeds.** In `addSeries`,
  when an **advertised** feed can't be positively isolated (`chooseSeriesMatch` null, not a guessed feed) and the
  series page is a **real TOC** (`parseToc` > `RENDER_ESCALATION_MAX`), resolve to a series-scoped `PAGE_WATCH`
  source (`feedUrl` null, seeded from the page TOC) instead of defaulting to `WHOLE_FEED` — which had ingested every
  novel on a site-wide `/feed/`. The page TOC is parsed once and reused (merge / divert check / page-watch seed);
  `chooseSeriesMatch` is unchanged. **Limit:** a tiny brand-new series (TOC ≤ 5) still WHOLE_FEEDs until it grows.
  **Deferred:** acronym/slug-prefix feed-matcher intelligence (fragile, and page-watch is the better source anyway;
  the series *is* identifiable in the feed by acronym, but density + fragility make the matcher not worth it) →
  folds into WP-39b / WP-WORKID; page-blocked multi-novel feeds; existing contaminated series (→ WP-38 /
  `db:cleanup`; the `reclassify-source` CLI gap stays → WP-CLEANUP-UI). Consequence: a diverted series polls on the
  general (daily) cadence, not WP-43's 2h PLAIN-FEED trigger — fine for slow multi-novel series.
```

- [ ] **Step 4: Full verification**

Run: `npm test && DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration && npm run typecheck`
Expected: all green. Paste the fresh output when claiming done.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/services.test.ts PLAN.md
git commit -m "WP-49: integration coverage for the page-watch divert; mark WP-49 done

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **The whole fix is three edits** in `resolveFrom` (parse-once, FEED-branch guard, PAGE_WATCH reuse). Do not touch `chooseSeriesMatch` or `filterBySeriesMatch`.
- **Why `const toc = pageToc` is safe in the FEED branch:** `pageToc` is already `[]` when `!pageOk`, so it equals the old `pageOk ? parseToc(...) : []` in every case.
- **Don't "fix" a red integration test by editing its assertions** (Task 2 Step 2). A failure there means the divert didn't persist as `PAGE_WATCH`/`feedUrl null` — that's a Task 1 bug.
```