# 1. Source is a swappable fetch-target, separate from the Series

Date: 2026-07-16
Status: Accepted

## Context

Users read a given novel across many fan-translation sites. Two facts make the "where I read it" unstable:

- **Translators move or disappear.** Sites shut down, get DMCA'd, or a translation migrates to a new host;
  aggregators (NovelUpdates) sometimes point at the wrong/outdated translator. Losing a novel's identity when its
  site dies would throw away the user's progress, rating, and notes.
- **Feeds don't map 1:1 to novels** (from the 2026-07-16 fetch spike): a site's feed is frequently *site-wide and
  multi-novel* (one feed served ~20 novels), a per-series feed may be Cloudflare-blocked, and a capped feed window
  can silently drop a slow-updating series.

If we modeled a tracked novel *as* a feed URL, both facts would corrupt user data or make correct fetching
impossible.

## Decision

Model the **tracked work (`Series`)** separately from **where we fetch it (`Source`)**:

- `Series` owns the durable, user-facing state: progress, rating, notes, shelf status, dedup identity.
- `Source` is a **swappable fetch target** — a feed *or* a watched page — carrying fetch mechanics: `feedUrl`,
  conditional-GET headers, health, and a **series matcher** (`matchType` WHOLE_FEED / CATEGORY / PATH_PREFIX +
  `matchValue`) that isolates this Series' items from a multi-novel feed.
- A Series has **exactly one active Source** at a time. **Re-pointing** to a new translator is additive: add a new
  Source and flip `isActive` — never destructive.

## Consequences

- **+** Translator moves and takedowns don't lose user data — progress/rating/notes live on the Series and survive.
- **+** Multi-novel feeds are handled by the matcher; page-watch is just a `SourceType`, not a special path.
- **+** Health and access-state sit on the Source, which is the correct granularity (a novel can be healthy on one
  host and dead on another).
- **−** Chapter numbering differs across translations, so re-pointing needs a **manual current-chapter reconcile**.
- **−** A Series with history has multiple Sources; most queries must filter `isActive`.

## Alternatives rejected

- **Series == a single feed URL.** Simplest, but loses all user data when a translator moves, and cannot represent
  a multi-novel feed or a page-watch-only site.
- **One shared Source per feed, many Series pointing at it.** Couples unrelated novels that merely share a host and
  makes per-series health/matching impossible.
