# WP-39 — Add-time dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the same series being added twice — compute a deterministic `canonicalSeriesId` from the resolved source, and on add reject a duplicate (return the existing series) instead of creating a second `Series` row.

**Architecture:** A pure `canonicalSeriesId` in `src/lib/dedup.ts` keys a feed series on `canonical(feedUrl)#matcher` and a page-watch series on `canonical(sourceUrl)` (scheme/www-insensitive). `addSeries` computes it after resolution, checks a new `findSeriesByCanonicalId` port, and creates only if new; the route returns 200 "already tracking" vs 201. No schema change (the `canonicalId` column + index already exist).

**Tech Stack:** TypeScript (strict), Prisma/Postgres, Vitest (unit + integration), Next.js route handler.

## Global Constraints

- **TDD** — failing test first for all logic; watch it fail for the right reason.
- **No schema change** — reuse `Series.canonicalId` + `@@index([userId, canonicalId])`.
- **`canonicalSeriesId` contract (verbatim):** feed series (`feedUrl !== null`) → `stripSchemeWww(canonicalUrl(feedUrl))` + `#` + matcher (`WHOLE_FEED`, or `CATEGORY:<value>` / `PATH_PREFIX:<value>`); page-watch (`feedUrl === null`) → `stripSchemeWww(canonicalUrl(sourceUrl))` (no matcher suffix). `stripSchemeWww` drops a leading `https?://` then a leading `www.`.
- **On duplicate:** reject — return the existing series id with `alreadyExisting: true`; **never** call `createSeries`.
- **Keep `src/lib/**` pure and Next-free** (`dedup.ts` may import only from `./feeds/*`).
- **Strict TypeScript, no `any`.**
- **Verify before done:** `npm test` + `DATABASE_URL="…webnovel_test" npm run test:integration` + `npm run typecheck`.
- **Update PLAN.md** in the final task (mark WP-39 done, file WP-39b, note WP-19).

---

## File Structure

- `src/lib/dedup.ts` — NEW: pure `canonicalSeriesId` (+ internal `stripSchemeWww`). Seeds WP-14.
- `src/server/services/addSeries.ts` — `ResolvedSource.canonicalId`; `AddSeriesPorts.findSeriesByCanonicalId`; `AddSeriesResult.alreadyExisting`; a shared `finalize` both branches call.
- `src/server/services/index.ts` — edge `addSeries` wrapper: supply `findSeriesByCanonicalId`; `createSeries` persists `canonicalId`.
- `src/app/api/series/route.ts` — 200 + "already tracking" on dup, 201 otherwise.
- `tests/unit/dedup.test.ts` — NEW: `canonicalSeriesId` cases.
- `tests/unit/server/addSeries.test.ts` — extend the `ports()` fake; dedup + canonicalId tests.
- `tests/integration/services.test.ts` — add-twice → one row.
- `PLAN.md` — status flip + WP-39b + WP-19 note.

---

### Task 1: `canonicalSeriesId` (pure)

**Files:**
- Create: `src/lib/dedup.ts`
- Test: `tests/unit/dedup.test.ts`

**Interfaces:**
- Produces: `canonicalSeriesId(input: { feedUrl: string | null; sourceUrl: string; match: SeriesMatch }): string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/dedup.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { canonicalSeriesId } from '../../src/lib/dedup';

const page = (sourceUrl: string) => canonicalSeriesId({ feedUrl: null, sourceUrl, match: { type: 'WHOLE_FEED' } });

describe('canonicalSeriesId', () => {
  test('feed WHOLE_FEED keys on the feed, scheme/www/slash/tracking-insensitive', () => {
    const a = canonicalSeriesId({ feedUrl: 'https://www.site.example/feed/', sourceUrl: 'https://site.example/', match: { type: 'WHOLE_FEED' } });
    const b = canonicalSeriesId({ feedUrl: 'http://site.example/feed?utm_source=x', sourceUrl: 'https://site.example/other', match: { type: 'WHOLE_FEED' } });
    expect(a).toBe('site.example/feed#WHOLE_FEED');
    expect(b).toBe(a);
  });

  test('home vs TOC URL resolving to the same feed+match → same id', () => {
    const home = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/', match: { type: 'WHOLE_FEED' } });
    const toc = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/toc/', match: { type: 'WHOLE_FEED' } });
    expect(home).toBe(toc);
  });

  test('two novels on one site feed (different CATEGORY) → different ids', () => {
    const a = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/a', match: { type: 'CATEGORY', value: 'Alpha' } });
    const b = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/b', match: { type: 'CATEGORY', value: 'Beta' } });
    expect(a).toBe('site.example/feed#CATEGORY:Alpha');
    expect(a).not.toBe(b);
  });

  test('PATH_PREFIX discriminates too', () => {
    expect(canonicalSeriesId({ feedUrl: 'https://s.example/feed/', sourceUrl: 'x', match: { type: 'PATH_PREFIX', value: '/alpha' } }))
      .toBe('s.example/feed#PATH_PREFIX:/alpha');
  });

  test('page-watch keys on the normalized source URL (scheme/www/slash-insensitive)', () => {
    expect(page('https://www.site.example/novel/x/')).toBe('site.example/novel/x');
  });

  test('two different page-watch pages → different ids (the home-vs-TOC residual, not deduped here)', () => {
    expect(page('https://site.example/')).not.toBe(page('https://site.example/toc/'));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/dedup.test.ts`
Expected: FAIL — cannot import `canonicalSeriesId` (module doesn't exist).

- [ ] **Step 3: Write the implementation**

Create `src/lib/dedup.ts`:

```ts
import { canonicalUrl } from './feeds/diff';
import type { SeriesMatch } from './feeds/discover';

/** Drop the scheme and a leading `www.` so http/https and www/non-www forms unify. */
function stripSchemeWww(u: string): string {
  return u.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
}

/**
 * A stable per-series identity for add-time dedup (WP-39). Feed series are keyed on their FEED — so a
 * home URL and a TOC URL that resolve to the same feed collapse to one id — plus the series matcher,
 * so two novels sharing one multi-novel site feed stay distinct. Page-watch series (no feed) are keyed
 * on their normalized page URL. Scheme/www-insensitive on top of `canonicalUrl` (which already strips
 * the fragment + trailing slash + tracking params and lowercases the host). Pure.
 */
export function canonicalSeriesId(input: { feedUrl: string | null; sourceUrl: string; match: SeriesMatch }): string {
  const base = stripSchemeWww(canonicalUrl(input.feedUrl ?? input.sourceUrl));
  if (input.feedUrl === null) return base; // page-watch: the URL is the identity (match is always WHOLE_FEED)
  const m = input.match;
  const suffix = m.type === 'WHOLE_FEED' ? m.type : `${m.type}:${m.value}`;
  return `${base}#${suffix}`;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/dedup.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dedup.ts tests/unit/dedup.test.ts
git commit -m "WP-39: canonicalSeriesId (pure per-series dedup identity)"
```

---

### Task 2: Dedup in `addSeries` (core + edge)

**Files:**
- Modify: `src/server/services/addSeries.ts`
- Modify: `src/server/services/index.ts` (edge `addSeries` wrapper)
- Test: `tests/unit/server/addSeries.test.ts`, `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `canonicalSeriesId` (Task 1).
- Produces: `ResolvedSource.canonicalId: string`; `AddSeriesPorts.findSeriesByCanonicalId: (id: string) => Promise<{ seriesId: string } | null>`; `AddSeriesResult.alreadyExisting: boolean`.

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/server/addSeries.test.ts`, extend the `ports()` helper to accept an optional existing-lookup and default it to "none", and record whether `createSeries` ran:

```ts
function ports(
  map: Record<string, PoliteResult>,
  existing: (canonicalId: string) => { seriesId: string } | null = () => null,
): AddSeriesPorts & { created: ResolvedSource[] } {
  const created: ResolvedSource[] = [];
  return {
    created,
    fetch: async (url) => map[url] ?? ({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult),
    findSeriesByCanonicalId: async (canonicalId) => existing(canonicalId),
    createSeries: async (resolved) => {
      created.push(resolved);
      return { seriesId: 'new1' };
    },
  };
}
```

Then append:

```ts
describe('addSeries dedup (WP-39)', () => {
  const url = 'https://translator.example/novel/alpha/';
  const feedUrl = 'https://translator.example/feed/';
  const map = { [url]: ok(PAGE(feedUrl)), [feedUrl]: ok(RSS(ITEM('g1', 'https://translator.example/alpha-1/'))) };

  test('a new series is created with a canonicalId and alreadyExisting=false', async () => {
    const p = ports(map);
    const result = await addSeries({ url }, p);
    expect(result.alreadyExisting).toBe(false);
    expect(p.created).toHaveLength(1);
    expect(p.created[0]!.canonicalId).toBe('translator.example/feed#WHOLE_FEED');
    expect(result.resolved.canonicalId).toBe('translator.example/feed#WHOLE_FEED');
  });

  test('a duplicate (canonicalId already present) returns the existing series and does NOT create', async () => {
    const p = ports(map, (id) => (id === 'translator.example/feed#WHOLE_FEED' ? { seriesId: 'existing1' } : null));
    const result = await addSeries({ url }, p);
    expect(result.alreadyExisting).toBe(true);
    expect(result.seriesId).toBe('existing1');
    expect(p.created).toHaveLength(0); // createSeries never called
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/server/addSeries.test.ts -t dedup`
Expected: FAIL — `findSeriesByCanonicalId` not in ports type / `alreadyExisting` + `canonicalId` undefined.

- [ ] **Step 3: Implement the core (`addSeries.ts`)**

Add the import and extend the types:

```ts
import { canonicalSeriesId } from '../../lib/dedup';
```

```ts
export interface ResolvedSource {
  seriesTitle: string;
  sourceUrl: string;
  host: string;
  feedUrl: string | null;
  type: 'FEED' | 'PAGE_WATCH';
  match: SeriesMatch;
  chapters: FeedItem[];
  canonicalId: string; // WP-39
}

export interface AddSeriesPorts {
  fetch: (url: string, opts?: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>;
  createSeries: (resolved: ResolvedSource) => Promise<{ seriesId: string }>;
  findSeriesByCanonicalId: (canonicalId: string) => Promise<{ seriesId: string } | null>; // WP-39
}

export interface AddSeriesResult {
  seriesId: string;
  resolved: ResolvedSource;
  alreadyExisting: boolean; // WP-39
}
```

Add the shared finalizer (near the top of the module body):

```ts
/** The resolved source before its dedup id is computed. */
type ResolvedCore = Omit<ResolvedSource, 'canonicalId'>;

/** Compute the dedup id, and create the series only if one with that id doesn't already exist. */
async function finalize(core: ResolvedCore, ports: AddSeriesPorts): Promise<AddSeriesResult> {
  const canonicalId = canonicalSeriesId({ feedUrl: core.feedUrl, sourceUrl: core.sourceUrl, match: core.match });
  const resolved: ResolvedSource = { ...core, canonicalId };
  const existing = await ports.findSeriesByCanonicalId(canonicalId);
  if (existing) return { seriesId: existing.seriesId, resolved, alreadyExisting: true };
  const { seriesId } = await ports.createSeries(resolved);
  return { seriesId, resolved, alreadyExisting: false };
}
```

In the **feed** branch, replace the `resolved`/`createSeries`/`return` tail with:

```ts
    const core: ResolvedCore = { seriesTitle, sourceUrl: url, host, feedUrl, type: 'FEED', match, chapters };
    return finalize(core, ports);
```

In the **page-watch** branch, replace its tail with:

```ts
    const core: ResolvedCore = {
      seriesTitle: input.title ?? titleFromUrl(url),
      sourceUrl: url,
      host,
      feedUrl: null,
      type: 'PAGE_WATCH',
      match: { type: 'WHOLE_FEED' },
      chapters: withReadingPositions(toc, toc),
    };
    return finalize(core, ports);
```

- [ ] **Step 4: Implement the edge (`index.ts` `addSeries` wrapper)**

Add the `findSeriesByCanonicalId` port and persist `canonicalId` in `createSeries`:

```ts
  return addSeriesCore(input, {
    fetch: fetchImpl,
    findSeriesByCanonicalId: async (canonicalId) => {
      const s = await db.series.findFirst({ where: { userId: getCurrentUserId(), canonicalId }, select: { id: true } });
      return s ? { seriesId: s.id } : null;
    },
    createSeries: async (r) => {
      const series = await db.series.create({
        data: {
          userId: getCurrentUserId(),
          title: r.seriesTitle,
          canonicalId: r.canonicalId, // WP-39
          sources: { /* …unchanged… */ },
          chapters: /* …unchanged… */,
        },
      });
      return { seriesId: series.id };
    },
  });
```

- [ ] **Step 5: Write the failing integration test**

In `tests/integration/services.test.ts`, inside the `addSeries (real DB)` describe, append:

```ts
  test('WP-39: re-adding the same series returns the existing one, no second row', async () => {
    const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE(FEED_URL)), [FEED_URL]: okRes(RSS(ITEM('g1', C1))) });
    const first = await addSeries({ url: PAGE_URL }, fetch);
    const second = await addSeries({ url: PAGE_URL }, fetch);

    expect(first.alreadyExisting).toBe(false);
    expect(second.alreadyExisting).toBe(true);
    expect(second.seriesId).toBe(first.seriesId);
    expect(await db.series.count()).toBe(1);
    expect((await db.series.findFirstOrThrow()).canonicalId).toBe('translator.example/feed#WHOLE_FEED');
  });
```

- [ ] **Step 6: Run unit + integration + typecheck**

Run: `npx vitest run tests/unit/server/addSeries.test.ts`
Run: `DATABASE_URL="$(grep -o 'postgresql://[^\"]*webnovel_test' .env | head -1)" npm run test:integration`
Run: `npm run typecheck`
Expected: all PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/addSeries.ts src/server/services/index.ts tests/unit/server/addSeries.test.ts tests/integration/services.test.ts
git commit -m "WP-39: dedup on add — compute canonicalId, reject duplicates"
```

---

### Task 3: Route surfaces "already tracking"

**Files:**
- Modify: `src/app/api/series/route.ts`

Glue — behavior is covered by Task 2's unit + integration tests; verified by `npm run typecheck` + `npm test`.

- [ ] **Step 1: Update the POST handler**

Replace the success block:

```ts
    const { seriesId, resolved, alreadyExisting } = await addSeries(parsed.value);
    if (alreadyExisting) {
      return NextResponse.json(
        { seriesId, title: resolved.seriesTitle, alreadyExisting: true, message: 'You’re already tracking this series.' },
        { status: 200 },
      );
    }
    return NextResponse.json(
      { seriesId, title: resolved.seriesTitle, sourceType: resolved.type, chapters: resolved.chapters.length, alreadyExisting: false },
      { status: 201 },
    );
```

- [ ] **Step 2: Typecheck + full unit suite**

Run: `npm run typecheck` then `npm test`
Expected: clean / all pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/series/route.ts
git commit -m "WP-39: add route returns 200 'already tracking' on a duplicate"
```

---

### Task 4: PLAN.md — mark done, file WP-39b, note WP-19

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Restructure**

Read the relevant sections first, then:
- **Active queue:** remove the `WP-39` row (→ Completed). Set the new top-of-queue row `NEXT` — that is **WP-37**. Add a **WP-39b** row — "page-watch/no-feed home-vs-TOC dedup (via WP-37 TOC-URL identity and/or WP-30-clean title match)", `TODO`, `Depends on WP-37, WP-30` — placed **immediately after the WP-30 row**.
- **✅ Completed:** append `· WP-39 (add-time dedup)`.
- **WP-39 detail section:** retitle to note DONE (2026-07-31); state what shipped (deterministic `canonicalSeriesId` feed-identity + exact/near-URL dedup, reject-on-dup) and that the page-watch home-vs-TOC residual is refiled as **WP-39b** (gated on WP-37/WP-30).
- **WP-19 row/detail:** add a note — "on a duplicate add (WP-39), optionally offer to attach the pasted URL as an **alternate source** on the existing series rather than only rejecting."
- **Current focus:** WP-39 done; NEXT = WP-37.

- [ ] **Step 2: Changelog (top of Changelog)**

```markdown
- **2026-07-31** — **WP-39 done: add-time dedup.** Pure `canonicalSeriesId` (`lib/dedup.ts`) keys a feed series on
  `canonical(feedUrl)#matcher` and a page-watch series on `canonical(sourceUrl)` (scheme/www-insensitive); `addSeries`
  computes it post-resolution, and a new `findSeriesByCanonicalId` port makes a duplicate return the existing series
  (`alreadyExisting`, route 200) instead of a second row — `createSeries` never runs. Catches all re-adds + home-vs-TOC
  for feed series; keeps multi-novel-feed siblings distinct. No schema change. Residual (page-watch home-vs-TOC) filed
  as WP-39b (after WP-37/WP-30); WP-19 noted for alternate-source-on-dup. +N unit +1 integration, typecheck clean.
```

(Resolve `+N` to the actual new unit-test count — 6 dedup + 2 addSeries = 8.)

- [ ] **Step 3: Commit**

```bash
git add PLAN.md
git commit -m "WP-39: mark done in PLAN.md; file WP-39b; note WP-19"
```

---

## Final verification (before marking WP-39 complete)

- [ ] `npm test` — full unit suite green.
- [ ] `DATABASE_URL="$(grep -o 'postgresql://[^\"]*webnovel_test' .env | head -1)" npm run test:integration` — green.
- [ ] `npm run typecheck` — clean.
- [ ] PLAN.md: WP-39 in Completed, WP-39b filed after WP-30, WP-19 noted, NEXT = WP-37.

## Self-review notes (author)

- **Spec coverage:** `canonicalSeriesId` (Task 1) ✓; core dedup + `canonicalId` persistence + `alreadyExisting` (Task 2) ✓; route 200/201 (Task 3) ✓; feed-identity + multi-novel-distinct + page-watch + home-vs-TOC-feed all unit-tested (Task 1) ✓; add-twice real-DB (Task 2) ✓; WP-39b + WP-19 (Task 4) ✓; no schema change ✓.
- **Type consistency:** `canonicalSeriesId` signature identical across Tasks 1–2; `ResolvedSource.canonicalId` / `AddSeriesPorts.findSeriesByCanonicalId` / `AddSeriesResult.alreadyExisting` defined in Task 2 and consumed by the edge (Task 2) + route (Task 3).
- **Green-at-each-commit:** Task 1 additive; Task 2 adds the required fields AND updates both constructors (the `ports()` test fake + the `index.ts` edge) and the only `AddSeriesResult` producer (`finalize`) together; Task 3 route reads the new flag (already present after Task 2). Integration `addAlpha` (`const { seriesId } = await addSeries(...)`) still compiles (extra result fields ignored).
- **Placeholder scan:** only `+N` in the changelog (Task 4), resolved to 8.
