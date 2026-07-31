# WP-43 — Frequent polling of the PLAIN-feed tier (external trigger)

**Date:** 2026-07-30
**Status:** Design accepted (brainstorm).
**Depends on / reuses:** WP-42 (poll-once-per-feed grouping + per-host politeness gate), WP-41 (poll time-budget guard + least-recently-polled rotation), WP-07 (poll orchestration + cron route). Composes with WP-27 (status→cadence gating, later).

## Problem

Vercel Hobby cron only runs **daily** (`vercel.json`: `/api/cron/poll` at `0 8 * * *`). For actively-read series on
cheap, conditional-GET-friendly RSS feeds, once-a-day freshness is worse than it needs to be — those feeds mostly
return `304` and cost almost nothing to poll, so they could be polled far more often for near-zero cost. The expensive
tier (RENDER sources, which can't `304`, and page-watch TOC reads, which are heavier and CF-exposed) should **not** be
dragged into that frequent cadence.

WP-43 adds an **external trigger** that hits the existing poll endpoint every ~2h, scoped to the **PLAIN-feed tier
only** (`type=FEED` + `fetchMode=PLAIN`). The daily Vercel cron continues to poll **everything** (a full superset) as
the reliable floor. Feed-vs-Vercel reachability was verified 2026-07-29 (the feed is reachable from Vercel; Cloudflare
gates the reading *page*, not `/feed/`).

## Design

Three pieces: a **tier filter** on the source query, a **query-param** the route reads to select the tier, and a
**GitHub Actions** scheduled workflow that calls the endpoint.

### 1. Source tier filter (the core)

Selecting the tier is a DB-query concern, so it lives in the `loadActiveSources` port, **not** the pure poll loop.
WP-41's rotation + budget guard + WP-42's per-host gate all continue to apply, unchanged, to whatever narrowed set
the port returns.

- **Pure helper** `sourceTierWhere(tier: PollTier)` where `PollTier = 'all' | 'plain'`:
  - `'all'` → `{ isActive: true }` (the current full poll — the daily default).
  - `'plain'` → `{ isActive: true, type: 'FEED', fetchMode: 'PLAIN' }`.
  Unit-tested (both branches return the exact `where` shape). Lives near the poll edge (`server/services`).
- **Wiring:** `pollAllSources(...)` in `server/services/index.ts` gains a `tier: PollTier = 'all'` argument, threaded
  into `pollPorts` so `loadActiveSources` uses `sourceTierWhere(tier)` as its Prisma `where`. The pure
  `pollAllCore(ports, now, opts)` signature (poll.ts) is **unchanged** — it just consumes `loadActiveSources()`.

### 2. Route param parse

- **Pure helper** `parsePollTier(searchParams: URLSearchParams): PollTier` in the API validation module — returns
  `'plain'` **iff** `?tier=plain`, else `'all'`. Unknown/missing/garbage → `'all'` (fail-safe to the full poll — a
  malformed trigger degrades to *more* coverage, never less). Unit-tested (plain / missing / unknown / empty).
- **Route** (`src/app/api/cron/poll/route.ts`): read `new URL(request.url).searchParams` → `parsePollTier` → pass the
  tier to `pollAllSources(...)`. **Auth is unchanged** (`isAuthorizedCron` + `CRON_SECRET`). The notify + schedule
  steps are unchanged — `?tier=plain` **only** narrows which sources are polled; everything downstream is identical.

### 3. GitHub Actions workflow

`.github/workflows/poll.yml`:

```yaml
name: Frequent poll (PLAIN tier)
on:
  schedule:
    - cron: '0 */2 * * *'   # every 2h UTC
  workflow_dispatch: {}       # manual run, for testing / on-demand
jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger PLAIN-tier poll
        run: |
          curl -fsS --max-time 300 "${{ secrets.POLL_URL }}?tier=plain" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

- `POLL_URL` (the full `https://…/api/cron/poll` endpoint) and `CRON_SECRET` are **encrypted GitHub Actions
  secrets** — nothing sensitive appears in the workflow file, so it stays safe when the repo goes public. The file
  itself is a portfolio-positive: it shows the triggering mechanism without leaking the URL or token.
- `-f` fails the job on any non-2xx (surfaces auth/endpoint breakage in the Actions tab). `--max-time 300` matches the
  route's `maxDuration`. `workflow_dispatch` allows a manual run to verify wiring.
- **Cost:** private repo ≈ ~110 Actions-min/month (vs 2000 free); **unlimited-free once public.**

## Why the daily poll stays a full superset (not the complement)

Considered: scope the daily poll to only the *expensive* tier (RENDER + page-watch) since the frequent poll already
covers PLAIN. **Rejected** — it doesn't achieve its goal and costs resilience:

- **WP-41 rotation already front-loads RENDER.** Groups are ordered least-recently-polled-first. Once PLAIN is polled
  every 2h, PLAIN hosts are always the *freshest* at daily time and RENDER/page-watch hosts (daily-only) are always
  the *stalest* → they already sort to the head and get first claim on the 270s budget. PLAIN is only reached at the
  budget tail, which the expensive tier never reaches. Removing PLAIN from the daily scope frees tail budget RENDER
  never used → **no improvement to RENDER's odds.** (If the RENDER set alone ever exceeds the budget, the fix is WP-27
  cadence-gating or a dedicated RENDER cadence — not the daily scope.)
- **The overlap is already a no-op, not redundant work.** The daily cron (`0 8`) and a 2h tick both fire ~08:00;
  whichever runs second finds PLAIN hosts polled <15 min ago and the WP-42 gate skips them. Worst case (GHA drift) is
  one extra cheap `304` per PLAIN source per day.
- **A full-superset daily is a safety net.** GitHub Actions cron is the *less* reliable trigger (drift, skips,
  private-repo scheduled workflows auto-disable after 60 days of no commits). Keeping the daily poll a superset
  guarantees every source is polled **at least daily** regardless of what happens to the frequent trigger. The
  complement split would mean any GHA hiccup silently stops PLAIN polling until GHA recovers.

## Budget analysis (Neon / Vercel / GHA)

The cost driver is **Neon's autosuspend**, not query work: Neon Free scales to zero after ~5 min idle, and *every*
poll run wakes it for that full ~5-min window regardless of how little the run does. So cost scales with **run count**,
not per-run cost.

- **Neon (binding limit ≈ ~191 compute-hrs/month, Free):**
  - Frequent poll: each run ≈ ~10–30s of cheap `304`s **+ ~5 min autosuspend window** ≈ ~5.5 min active.
    12 runs/day ≈ **~33 hr/month**.
  - Daily poll: up to 270s + ~5 min ≈ ~9.5 min/day ≈ **~5 hr/month**.
  - Plus normal app usage. **Total ≈ ~40 hr/month + usage — comfortably under ~191.** ✅
- **Cadence guardrail:** because each run wakes Neon ~5 min, hourly ≈ ~65 hr/mo (fine); **every 30 min ≈ ~140 hr/mo —
  crowds the 191 limit.** Do **not** push below 2h without re-checking this.
- **Vercel (Hobby):** negligible. ~390 poll invocations/month; polling is I/O-bound so Active-CPU billing (which
  pauses during network waits) is tiny even for the 270s daily run. The render function is invoked only from the
  *daily* poll, for RENDER sources.
- **GitHub Actions:** ~110 min/month while private (of 2000 free); unlimited-free once public.

## Behavior notes

- **Notifications fire on the frequent poll** — that's the point: fresher new-chapter pushes. `evaluateSchedules`
  (WP-29) rides along and is idempotent via `scheduleLastNotifiedAt`, so 2h cadence makes predicted-release pushes
  timelier, never duplicated.
- **RENDER / page-watch sources are untouched by the frequent tier** — they stay on the daily full poll, as intended.
- **`?tier=plain` is fail-safe** — anything but exactly `plain` runs the full poll.

## Testing

- **Unit:**
  - `sourceTierWhere('all')` and `sourceTierWhere('plain')` → exact `where` shapes.
  - `parsePollTier` → `plain` for `?tier=plain`; `all` for missing / unknown value / empty.
- **Integration (real DB):** seed a `FEED`+`PLAIN` source, a `FEED`+`RENDER` source, and a `PAGE_WATCH` source.
  - `pollAllSources(..., 'plain')` polls **only** the FEED+PLAIN source (the other two are untouched — health/
    `lastCheckedAt` unchanged).
  - `pollAllSources(..., 'all')` polls all three (guards against the filter leaking into the default path).

## Manual setup (owner, outside the code)

In GitHub → repo **Settings → Secrets and variables → Actions**, add:
- `POLL_URL` = the full production endpoint, `https://<app>/api/cron/poll`.
- `CRON_SECRET` = the same value set in the Vercel project env.

(These can't be set from the codebase — noted here so the workflow has what it needs on first run. Verify with a
manual `workflow_dispatch` run and check the Actions log for a 2xx + the JSON summary.)

## Out of scope / deferred

- **cron-job.org** and other external triggers — GitHub Actions chosen (version-controlled, privacy-clean via
  secrets, unlimited-free when public).
- **Sub-2h cadence** — gated by the Neon compute-hr math above; revisit only with headroom to spare.
- **Per-status cadence** (poll PLANNED rarely, etc.) — WP-27.
- **A dedicated RENDER cadence** (more-than-daily rendering) — separate WP if the RENDER set outgrows the daily budget.
