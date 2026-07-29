# Poll-once-per-feed + politeness (WP-42), with frequent polling as follow-up (WP-43)

**Status:** design approved (owner, 2026-07-29). Supersedes the per-source poll loop for the fetch step.

## Motivation

Two problems, one root:

1. **Dense-feed fall-off.** A site-wide multi-novel feed is capped (~30 items). Polled once/day, a busy site can
   publish more than a window's worth between polls, so a tracked series' chapter appears *and rolls off* before we
   poll — a permanent miss. (Confirmed live on a dense WordPress translator; its `/feed/` **does** reach Vercel, so
   this is a polling-*frequency* problem, not a Cloudflare one — see the WP-40 detail.)
2. **Redundant fetches.** `pollAllSources` loops **every active source** and fetches each source's `fetchUrl`
   (`feedUrl ?? url`), so K series sharing one site feed = **K identical fetches per cycle**, each with its own
   `etag`/health. Polling more frequently would multiply that.

De-duping the fetch is the precondition for polite frequent polling: **fetch each feed once, fan out to every tracked
series on it.** With dedup, even hourly polling can be *less* total load on a site than today's daily per-series
polling whenever series share a feed.

## WP-42 — Poll-once-per-feed + politeness (build first)

### §1 Feed-centric poll loop

Split the current `pollSource` (poll.ts) into two steps:

- **fetch** — once per distinct group.
- **process** — per source: the existing parse → `filterBySeriesMatch` → `diffChapters` → build `PollEffects`.

`pollAllSources`:

```
sources = loadActiveSources()
groups  = groupBy(sources, key = `${fetchMode}::${fetchUrl}`)
for each group (respecting the gates in §3):
  result = fetchOnce(group)                 // one (conditional) GET
  for each source in group:
    effects = processFetched(source, result) // parse/filter/diff — unchanged logic
    applyPollEffects(effects)
```

- **Grouping key = `(fetchMode, fetchUrl)`.** FEED/PLAIN sources sharing a `feedUrl` group together (the win).
  PAGE_WATCH/RENDER rarely share a URL, but the mechanism is uniform.
- Downstream is unchanged: still one `PollEffects` per source, so notify/schedule steps are untouched — just fewer
  fetches.

### §2 Conditional-GET state under dedup

`etag`/`Last-Modified` logically belong to the **feed URL**, not the source. Keep the per-source columns (no schema
change here) but treat them as a shared cache:

- **Choose validators the whole group agrees on.** Prefer `etag` (send `If-None-Match`) when **all** sources in the
  group share the same non-null `etag`; else use `lastModified` (send `If-Modified-Since`) when all share the same
  non-null `lastModified`; else fetch **full** (no validators). So if any source is new (`etag`/`lastModified = null`)
  or they diverge, we fetch full — a newly-added series on an existing feed gets a body to diff.
- After the fetch, **write the response's new `etag`/`lastModified` back to every source in the group** — they
  converge.
- **`304`** → no new items for anyone (same feed content); mark every source succeeded, no new chapters.
- **`200`** → parse once; each source diffs against its **own** stored chapters (a new source finds the items it
  hasn't stored; existing sources find only genuinely new ones — idempotent, no dup rows via the `@@unique`
  guard + diff).

### §3 Politeness gates (persist across stateless invocations)

- **Per-host min-interval cap (uses existing `lastCheckedAt`, no migration).** Before fetching a group, skip it if the
  host's most-recent `lastCheckedAt` is within **`MIN_POLL_INTERVAL_MINUTES` (default 15)**. This is the floor that
  makes an over-eager external trigger safe: polls fired more often than the floor per host simply no-op.
- **Honor 429 / Retry-After (additive migration `Source.backoffUntil DateTime?`).** On a `429` (or a `Retry-After`
  header on any response), compute a backoff deadline and write `backoffUntil` to **all sources on the host**; skip a
  group whose host is in backoff until it passes. `politeFetch` must surface `429` + parse `Retry-After` (both the
  delta-seconds and HTTP-date forms). The health state machine still runs; this adds explicit respect for an
  asked-for pause.

### §4 Health under dedup

The single fetch's outcome (success / failure / `304`) applies to **every source in the group** via the existing
`step(health, outcome)` — a feed failure marks all its series down together, which is correct (they all failed to
poll). `crossedDown` / alerts fire per source as today.

### §5 Cadence tiers — render excluded from the fast tier

RENDER sources read a **series-scoped, complete TOC** → no dense-window fall-off to outrun, and at ~5–15 s with no
`304` they're far too costly to run often. So:

- The **fast tier** targets only cheap, fall-off-prone sources: **`type = FEED` AND `fetchMode = PLAIN`.**
- **RENDER (and render-escalated page-watch) stays on the daily run.**

Mechanically this is a filter the fast trigger passes (poll only PLAIN feeds). It gates cadence by **cost**; WP-27
gates cadence by **reading status** — complementary.

### §6 Testing (TDD)

The decision logic is pure and tested with fakes via the existing `PollPorts` injection:

- **Grouping** — sources → groups by `(fetchMode, fetchUrl)`; K-sharing collapses to one group.
- **Conditional-state decision** — all-same-etag → conditional; any-null/divergent → full; write-back to all.
- **Gate logic** — min-interval skip (host polled < N min ago); backoff skip (host in `backoffUntil`); Retry-After
  parse (delta-seconds + HTTP-date).
- **Fan-out** — one `200` body → per-source filter+diff yields correct, independent effects; one `304` → all
  no-new; one failure → all sources' health stepped down.

Fetch/DB stay at the edge (ports), as today.

### Deliverables

- Refactor `pollAllSources`/`pollSource` into group-fetch + per-source-process (keep `PollEffects` shape).
- Pure helpers: `groupPollSources`, `chooseConditionalState`, `hostGate` (min-interval + backoff), `parseRetryAfter`.
- Additive migration: `Source.backoffUntil DateTime?`.
- `politeFetch`: surface `429` and `Retry-After`.
- Constants: `MIN_POLL_INTERVAL_MINUTES = 15` (documented, tunable).

## WP-43 — Frequent polling (follow-up, build after WP-42 is verified)

- **External scheduler** (GitHub Actions scheduled workflow, or cron-job.org) hits `/api/cron/poll` every ~1–2 h with
  the existing `CRON_SECRET`, because **Vercel Hobby cron is capped at daily**. The daily Vercel cron remains for the
  full run (including RENDER).
- The **fast trigger polls only the PLAIN-feed tier** (§5); RENDER is left to the daily run.
- **Composes with WP-41 (budget guard + rotation):** more invocations don't extend the 60 s per-invocation ceiling,
  but they let the expensive RENDER tail be processed **a few per invocation, rotated across the day**, instead of
  cramming it into one daily 60 s run (WP-41's exact failure). WP-27 (cadence-by-status) trims the total render
  volume that Hobby's monthly *compute* allowance caps.
- **Separate lever to verify:** the render route is pinned `maxDuration: 60`, but Vercel's current default is 300 s on
  all plans — if Hobby honors it, raising it gives ~5× headroom directly. Confirm against the actual Hobby cap before
  relying on it.

## Decisions / non-goals

- **No identifying (bot) User-Agent** — keep the browser-like UA. On CF-guarded sites an honest bot UA risks *more*
  challenges; upside is marginal for a private, low-frequency, single-user app. The three behavioral measures (dedup,
  Retry-After, min-interval) make us a well-behaved client without it.
- **No per-feed poll table** — the shared-cache-on-per-source-columns approach avoids a bigger schema change; only
  `backoffUntil` is added.
- **WP-42 first, WP-43 second** — frequency is only polite once dedup + the min-interval floor exist.
