# WP-49 — Don't WHOLE_FEED a multi-novel advertised feed: page-watch divert

**Status:** approved (owner, 2026-08-11) · **Depends on:** WP-05, WP-07 (both done) · **Relates to:** WP-38, WP-46, WP-39b

## Problem

A dense multi-novel WordPress source advertises the **site-wide `/feed/`** on every series page (a WordPress
default). When a user adds one series from such a host, `addSeries` takes the FEED branch, and `chooseSeriesMatch`
can't isolate the series, so the match falls back to `WHOLE_FEED`
([addSeries.ts:124](../../../src/server/services/addSeries.ts#L124)) — which ingests **every** novel's chapters into
the series, at add and on every poll.

`chooseSeriesMatch` returns `null` here because none of its isolation ties fire:

- **No category tie** — the site-wide feed's items are `Uncategorized`, which `GENERIC_CATEGORIES` correctly ignores
  ([discover.ts:54](../../../src/lib/feeds/discover.ts#L54)).
- **No path tie** — chapters use **date permalinks** (`/YYYY/MM/DD/…`), not paths under the series' own URL.
- **Not "demonstrably multi-novel"** — the multi-novel guard needs ≥2 non-generic categories or sibling works under a
  parent path ([discover.ts:129](../../../src/lib/feeds/discover.ts#L129)); date permalinks + `Uncategorized` trip
  neither, so it returns `null` → `WHOLE_FEED`.

A field spike (real host, kept in local uncommitted notes) confirmed the shape and the fix's footing:

- The advertised feed is the site-root `/feed/` — a **capped ~10-item window churning several novels per day**.
- The series identity lives in the data only as an **acronym prefix** on each item's title and URL slug
  (`<ACRONYM> Ch. N` → `/YYYY/MM/DD/<acronym>-ch-N/`) — neither a category nor a URL path-prefix, which is exactly
  why the existing matcher can't isolate it.
- **The add URL (the series' TOC post) is a complete chapter list in static HTML** — ~139 chapter links parsed
  straight from the raw page, no JS render needed. So page-watch here is **PLAIN, complete, and series-scoped**.

Distinguishing a single-novel blog from a multi-novel site's root feed by structure alone is unreliable in the worst
case (both can use `/feed/`, date permalinks, `Uncategorized`, bare "Chapter N" titles). WP-39b already deferred true
matcher intelligence for this reason. The robust lever is the page: on WordPress — the class where this bug occurs —
post content is server-rendered, so a series' TOC post is a **static, plainly-parseable chapter list**. When we can't
trust the feed, the page's TOC is the series-scoped source of truth.

## Design

In `resolveFrom`'s FEED branch: when the feed came from an **advertised** `<link>` (not a URL guess), the page loaded,
`chooseSeriesMatch` returned **null**, and the page is a **real TOC**, do **not** take the FEED branch — fall through
to the existing PAGE_WATCH branch (which already seeds from `parseToc`, applies WP-46 under-fetch, and extracts the
title via WP-30).

```
usedGuesses           = advertised.length === 0
cantIsolateAdvertised = positive === null && !usedGuesses
pageIsToc             = pageOk && parseToc(pageBody, url).length > RENDER_ESCALATION_MAX   // > 5

if (cantIsolateAdvertised && pageIsToc)  → fall through to PAGE_WATCH
else                                     → FEED as today (positive match, or WHOLE_FEED / fallback)
```

- **Threshold** — reuse `RENDER_ESCALATION_MAX` (5, already exported from `poll.ts` and imported in `addSeries` by
  WP-46): "a chapter list this small isn't a real TOC," the same notion WP-46 uses for under-reads. A substantial TOC
  (the spike's ~139) clears it; an incidental ≤5-link page does not.
- **Diverting drops the contaminated feed** — the resulting source is `type: 'PAGE_WATCH'`, `feedUrl: null`,
  `match: { type: 'WHOLE_FEED' }` (page-watch is already series-scoped, no filter), `fetchMode: 'PLAIN'`. WP-46's
  under-fetch escalation renders only if the plain TOC under-reads (≤5), which a real TOC won't — **so no
  contamination and no render**.
- **Implementation note** — `parseToc(pageBody, url)` is already computed in the FEED branch for the feed↔TOC merge
  and again in the PAGE_WATCH branch. Compute it once (`const pageToc = pageOk ? parseToc(pageBody, url) : []`) near
  the top of `resolveFrom` and reuse it for the merge, the `pageIsToc` check, and the PAGE_WATCH seed, so the divert
  adds no extra parse. `chooseSeriesMatch` is **not** modified (no regression to its tested behavior).

### Blast radius

Only the *advertised-feed + null-isolation + rich-page-TOC* case changes. Every other path fails the
`cantIsolateAdvertised && pageIsToc` guard and is untouched: a positive CATEGORY/PATH match, a guessed-feed fallback
(`usedGuesses` true), a page-blocked add (`pageOk` false), and an advertised feed whose page carries no chapter list
(`parseToc` ≤ 5 → stays FEED, so a single-novel blog whose landing isn't a TOC keeps its feed).

### Consequence: poll cadence

WP-43's ~2h frequent trigger polls the **PLAIN-FEED tier only** (`sourceTierWhere('plain')` →
`{ type: 'FEED', fetchMode: 'PLAIN' }`, [poll.ts:54](../../../src/server/services/poll.ts#L54)). A diverted series is
`PAGE_WATCH`, so it polls on the **general (daily) cadence**, not the 2h trigger. For the target case — a slow,
monthly-updating multi-novel series — daily is ample. Accepted.

## Non-goals / deferred

- **Feed-matcher intelligence (acronym / slug-prefix isolation).** The series *is* identifiable in the feed by its
  acronym prefix, but (a) extracting the acronym is fragile and site-specific (which slug token? a `(ACRONYM)` title
  convention many series lack?), (b) it's the same matcher intelligence WP-39b deferred, and (c) page-watch already
  meets the goals while we read the TOC for backfill regardless. **The one case it would uniquely help** — a
  multi-novel site whose series page is *not* a usable TOC (page-watch impossible) but whose feed items are
  acronym-identifiable — is rare and folds into WP-39b / WP-WORKID. Deferred, not built here.
- **Page-blocked multi-novel advertised feed** (CF-403 page, feed still serves) → can't page-watch, stays `WHOLE_FEED`.
  Out of scope; WP-46's render could later make the page readable and this divert would then apply.
- **Existing WHOLE_FEED-contaminated series** are not auto-healed → recover via WP-38 / `db:cleanup` (prune the
  cross-novel chapters + re-point). The **`reclassify-source` CLI gap** (the manual FEED→PAGE_WATCH flip was a raw DB
  update) stays out of WP-49 → WP-CLEANUP-UI.

## Limits (documented, accepted)

- **Tiny brand-new series on a multi-novel site** (TOC ≤ 5 chapters) still falls to `WHOLE_FEED` and could contaminate
  until it grows past the threshold or is re-added. Rare, bounded to the feed window, and user-visible.

## Testing (TDD, service-level)

**Unit (`addSeries`):**
- Advertised multi-novel feed, `chooseSeriesMatch` null, page is a **rich TOC** (> 5 chapters) → resolves
  `PAGE_WATCH`, `feedUrl: null`, `fetchMode: 'PLAIN'`, chapters seeded from the TOC (not the feed).
- Same, but page has **no/thin TOC** (≤ 5) → stays `FEED` `WHOLE_FEED` (single-novel-blog-like preserved).
- Advertised feed with a **positive** CATEGORY/PATH match → unchanged `FEED` with that match (not diverted).
- **Guessed** feed, null isolation → unchanged `fallbackSeriesMatch` (not diverted; `usedGuesses` true).
- Existing "page advertises a feed → FEED" case (feed body has no chapter links) → unchanged (`pageIsToc` false).

**Integration (real DB):** a diverted add persists a `PAGE_WATCH` source (`feedUrl` null) with the TOC's chapters and
no cross-novel strays.

**Verify:** `npm test` + `npm run typecheck` (unit) and the integration project, fresh output, before any done claim.

## Definition of Done

- Adding a series from a dense multi-novel WordPress source whose page is a real TOC resolves to a **series-scoped
  `PAGE_WATCH`** source seeded from the TOC — **not** a `WHOLE_FEED` feed that ingests every novel.
- Single-novel and positively-isolable adds are unchanged (blast-radius tests green).
- Test properties above pass; service logic written test-first; PLAN.md WP-49 → DONE with a changelog line and the
  next `NEXT` set.