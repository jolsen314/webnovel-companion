# WP-39 — Prevent duplicate series on add (deterministic dedup)

**Date:** 2026-07-31
**Status:** Design accepted (brainstorm).
**Depends on / reuses:** WP-07 (`addSeries`), WP-05 (`canonicalUrl`, `SeriesMatch`). Seeds `lib/dedup.ts` (the WP-14 slice WP-39 needs — not all of WP-14).
**Follow-up filed:** WP-39b (page-watch home-vs-TOC dedup), sequenced after its enablers WP-37 + WP-30.

## Problem

The same work can be added twice — the owner's incident was a **landing/home URL and a chapter-TOC URL** for one
series creating two `Series` rows. `addSeries` resolves a source and calls `createSeries` but **never sets or checks**
`Series.canonicalId` (the field + `@@index([userId, canonicalId])` exist, unused). We want add-time dedup that catches
the real duplicate cases **deterministically** (no fuzzy false positives).

Key insight: normalizing the *pasted URL* (the original WP-39 note) can't unify home-vs-TOC — they're different URLs.
But both adds of a **feed** series resolve to the **same feed**. So the dedup key is computed from the **resolved**
source, not the raw URL.

## Design

### 1. `canonicalSeriesId` — pure, `src/lib/dedup.ts` (new; Next-free)

```ts
import { canonicalUrl, /* existing */ } from './feeds/diff';
import { slugify, type SeriesMatch } from './feeds/discover';

/** A stable per-series identity for add-time dedup. Feed series are identified by their FEED (so a
 *  home URL and a TOC URL that resolve to the same feed collapse to one id) plus the series matcher
 *  (so two novels sharing one multi-novel site feed stay distinct). Page-watch series are identified
 *  by their normalized page URL. Scheme- and www-insensitive on top of canonicalUrl's normalization
 *  (hash/trailing-slash/tracking stripped, params sorted, host lowercased). Pure. WP-39. */
export function canonicalSeriesId(input: {
  feedUrl: string | null;
  sourceUrl: string;
  match: SeriesMatch;
}): string {
  const base = stripSchemeWww(canonicalUrl(input.feedUrl ?? input.sourceUrl));
  // Feed series: disambiguate novels that share one site-wide feed by the matcher. Page-watch
  // (feedUrl === null) is identified by the URL alone (its match is always WHOLE_FEED).
  if (input.feedUrl === null) return base;
  const m = input.match;
  // CATEGORY value is slugified so a re-add resolving to the positive match (raw category name)
  // converges with one resolving to the fallback match (URL slug) — see the caveat below.
  const suffix =
    m.type === 'WHOLE_FEED' ? m.type
    : m.type === 'CATEGORY' ? `CATEGORY:${slugify(m.value)}`
    : `PATH_PREFIX:${m.value}`;
  return `${base}#${suffix}`;
}

/** Drop the scheme and a leading `www.` so http/https and www/non-www forms unify. */
function stripSchemeWww(u: string): string {
  return u.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
}
```

- **Feed, WHOLE_FEED** (per-series feed): `id = <feed-host+path>#WHOLE_FEED`. Home & TOC adds that both discover this
  feed collapse to one id.
- **Feed, CATEGORY / PATH_PREFIX** (multi-novel site feed): `id = <feed>#CATEGORY:<slug>` (the CATEGORY value is
  `slugify`d). Two novels on the same site feed get **different** ids (the matcher discriminates) — no false collision.
- **Page-watch** (no feed): `id = <page-host+path>`. Exact/near re-adds of the same page collapse; a different page
  URL (home vs TOC) does **not** (the deferred residual — see WP-39b).

> **Multi-novel re-add idempotency — scope caveat.** The matcher is derived from the *live feed window* at add time,
> so for a **multi-novel** feed the id is stable only within a window. The most likely divergence — a positive match
> (raw category *name*) vs the fallback match (URL *slug*) — is **closed** by slugifying the CATEGORY value (both →
> the same slug; `chooseSeriesMatch` picks the category precisely because `slugify(name) === slug`). The remaining,
> rarer divergence is a matcher *type* flip across windows (WHOLE_FEED ↔ CATEGORY ↔ PATH_PREFIX, e.g. when a novel
> ages out of the capped window) → a re-add could miss and create a second row. Single-novel / per-series feeds are
> fully deterministic (always WHOLE_FEED), and back-to-back home+TOC adds sit in one window, so the owner's actual
> incident is covered; the residual degrades to a WP-38-cleanable duplicate and is folded into **WP-39b**.

### 2. `addSeries` flow (`src/server/services/addSeries.ts`)

Both resolution branches (feed, page-watch) currently build a `resolved` and call `createSeries`. Extract a shared
`finalize` that computes the id, checks for an existing series, and creates only if new:

```ts
export interface ResolvedSource { /* …existing… */ canonicalId: string; }  // new field

export interface AddSeriesPorts {
  fetch: /* …existing… */;
  createSeries: (resolved: ResolvedSource) => Promise<{ seriesId: string }>;
  findSeriesByCanonicalId: (canonicalId: string) => Promise<{ seriesId: string } | null>;  // new port
}

export interface AddSeriesResult { seriesId: string; resolved: ResolvedSource; alreadyExisting: boolean; }  // new flag

// internal: the resolved source before its id is computed
type ResolvedCore = Omit<ResolvedSource, 'canonicalId'>;

async function finalize(core: ResolvedCore, ports: AddSeriesPorts): Promise<AddSeriesResult> {
  const canonicalId = canonicalSeriesId({ feedUrl: core.feedUrl, sourceUrl: core.sourceUrl, match: core.match });
  const resolved: ResolvedSource = { ...core, canonicalId };
  const existing = await ports.findSeriesByCanonicalId(canonicalId);
  if (existing) return { seriesId: existing.seriesId, resolved, alreadyExisting: true }; // no second row
  const { seriesId } = await ports.createSeries(resolved);
  return { seriesId, resolved, alreadyExisting: false };
}
```

Each branch builds a `ResolvedCore` (unchanged logic) and ends with `return finalize(core, ports)`. On a duplicate,
**`createSeries` is never called** — the existing series id is returned with `alreadyExisting: true`.

### 3. Edge wiring (`src/server/services/index.ts`)

- `findSeriesByCanonicalId`: `db.series.findFirst({ where: { userId: getCurrentUserId(), canonicalId }, select: { id: true } })` → `{ seriesId } | null`.
- `createSeries`: add `canonicalId: r.canonicalId` to the `db.series.create` data.
- (App-level check, no migration. A DB unique constraint on `(userId, canonicalId)` is possible later hardening;
  unnecessary for a single user — no concurrent adds.)

### 4. Route (`src/app/api/series/route.ts`)

`addSeries` now returns `alreadyExisting`. On a duplicate return **200** with the existing id and a clear message;
otherwise **201** as today:

```ts
const { seriesId, resolved, alreadyExisting } = await addSeries(parsed.value);
if (alreadyExisting) {
  return NextResponse.json(
    { seriesId, title: resolved.seriesTitle, alreadyExisting: true, message: 'You’re already tracking this series.' },
    { status: 200 },
  );
}
return NextResponse.json({ seriesId, title: resolved.seriesTitle, sourceType: resolved.type, chapters: resolved.chapters.length, alreadyExisting: false }, { status: 201 });
```

## What this catches (and the deferred residual)

| Case | Caught? |
|------|---------|
| Re-add the same URL (incl. http↔https, www, trailing slash, tracking params) | ✅ |
| Home URL vs TOC URL for a **feed** series (both resolve to the same feed + match) | ✅ |
| Two novels sharing one multi-novel site feed | ✅ kept distinct (matcher) |
| Home URL vs TOC URL for a **page-watch-only** series (different pages, no feed) | ❌ → **WP-39b** |

The residual is deterministic-impossible without a shared key. Its enablers — **WP-37** (resolve/store a per-series TOC
URL so both map to one identity) and **WP-30** (reliable series titles for a title-match fallback) — are already near
the front of the queue; **WP-39b** is filed to depend on them.

## Plan changes (in the final task)

- File **WP-39b** — page-watch/no-feed home-vs-TOC dedup (via WP-37's TOC-URL identity and/or a WP-30-clean title
  match), `Depends on WP-37, WP-30`, placed after WP-30.
- Add a note to **WP-19** (non-destructive re-pointing): on a duplicate add, optionally offer to attach the pasted URL
  as an **alternate source** on the existing series (instead of only rejecting) — belongs with re-pointing.

## Testing

- **Unit — `lib/dedup.ts` (`canonicalSeriesId`):** feed WHOLE_FEED keyed on feed; http/https/www/slash/tracking
  variants of one feed → same id; two CATEGORY values on the same feed → different ids; PATH_PREFIX likewise;
  page-watch keyed on sourceUrl; a home vs TOC URL that resolve to the *same* feed+match → same id; two page-watch
  pages → different ids.
- **Unit — `addSeries` (fakes):** when `findSeriesByCanonicalId` returns an existing series, `addSeries` returns
  `alreadyExisting: true` and **does not call `createSeries`**; when it returns null, it creates once with
  `resolved.canonicalId` set. Cover both the feed and page-watch branches. (Extend the existing `ports()` fake with
  `findSeriesByCanonicalId` defaulting to `null`.)
- **Integration (real DB):** add a series, then add it again via the same URL → the second call returns
  `alreadyExisting: true` and there is still **one** `Series` row; `canonicalId` is persisted on it. (Feed-identity
  home-vs-TOC is validated at the unit level via `canonicalSeriesId`; a full dual-URL real-DB case can be added when a
  representative fixture exists.)

## Out of scope / deferred

- **WP-39b** — page-watch home-vs-TOC dedup (needs WP-37 / WP-30).
- **Attach-as-alternate-source on dup** — noted on WP-19 (re-pointing).
- **DB unique constraint** on `(userId, canonicalId)` — optional later hardening; app-level check suffices for a
  single user.
