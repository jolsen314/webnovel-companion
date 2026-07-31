# WP-27a — Status-gated + cadence polling

**Date:** 2026-07-30
**Status:** Design accepted (brainstorm).
**Depends on / reuses:** WP-07 (poll orchestration), WP-41 (rotation + budget guard), WP-42 (per-host gate), WP-43 (tier filter). Composes with all of them — this adds one more per-source gate.
**Scope note:** The original WP-27 bundled four parts. This spec is **27a** (status skip + cadence). The old "PLANNED seeds a summary" part is **dropped** (see below). The remaining follow-up — per-status positive notify rules — is refiled as **WP-27b**.

## Problem

`pollAllSources` polls every active source regardless of the reader's shelf (`Series.status`). Two wasteful cases:

- **COMPLETED / DROPPED / PAUSED** series don't want new chapters, yet each active source is polled every run — pure
  wasted compute + politeness (and, for RENDER sources that can't 304, a full ~5–15s render each time).
- **PLANNED** (plan-to-read backlog) doesn't need daily freshness. Polling a pile of PLANNED reads daily — especially
  RENDER/CF ones — burns the poll budget (WP-41) on a backlog you're not reading yet.

WP-27a gates polling by reading status: skip the shelves that don't want updates, and poll the backlog *rarely*.

## Why summary-seeding was dropped

The original WP-27 proposed PLANNED seed only a *summary* (max chapter, free/locked counts) instead of the full TOC,
to "store less." Dropped, because its only benefit was storage and **storage is not the binding constraint** — the repo
already resolved (backlog note, 2026-07-23) that a 1,000-chapter series ≈ 0.4 MB and a heavy 200-series library ≈
20–30 MB against Neon free's 0.5 GB; the limit that bites is **compute-hours / the render budget**. Summary-seeding
saves no compute (you still fetch the TOC to compute the summary — the expensive render is unchanged; the ~1,000-row
diff/insert is trivial next to it) while adding a separate add-time seeding path, a backfill-on-promote path, and an
awkward interaction with 27a. Net: real complexity for ~zero gain on the constraint that matters. **PLANNED now seeds
the full TOC at add, identical to READING** (no special path). A promoted series already has its chapters; the next
scheduled poll closes any gap (≤24h) — no backfill-on-promote needed.

## Design

One pure policy home, one per-source gate, no schema change (reuses `Source.lastCheckedAt` + `Series.status`).

### 1. Policy — a single cadence map (pure, `poll.ts`)

`SeriesStatus` is added as a string-literal union in `poll.ts` (like the existing `type`/`fetchMode`/health unions — no
Prisma import). The cadence map is the single source of truth:

```ts
export type SeriesStatus = 'READING' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'PLANNED';

// Minutes between eligible polls per status. 0 = every run; null = never auto-poll
// (re-enters only when the reader changes the status, e.g. promote to READING).
const STATUS_CADENCE_MINUTES: Record<SeriesStatus, number | null> = {
  READING: 0,
  PLANNED: 7 * 24 * 60, // weekly
  PAUSED: null,         // on-promote only
  COMPLETED: null,
  DROPPED: null,
};

// Derived (single source of truth): the statuses worth loading for a poll at all.
export const POLLABLE_STATUSES: SeriesStatus[] =
  (['READING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNED'] as SeriesStatus[])
    .filter((s) => STATUS_CADENCE_MINUTES[s] !== null); // → ['READING', 'PLANNED']
```

- **PAUSED = on-promote only** (`null`): not polled while paused; its backlog is caught up by the next scheduled poll
  once promoted to READING. (Owner decision — PAUSED distinct from PLANNED. Its "suppress notify" is automatic: a
  source that never polls produces nothing to notify.)

Pure gate, mirroring `hostGate`'s shape:

```ts
export function statusPollGate(args: { status: SeriesStatus; lastCheckedAt: Date | null; now: Date }):
  { skip: boolean; reason: 'ok' | 'status-skip' | 'status-cadence' } {
  const cadence = STATUS_CADENCE_MINUTES[args.status];
  if (cadence === null) return { skip: true, reason: 'status-skip' };
  if (cadence === 0) return { skip: false, reason: 'ok' };
  if (args.lastCheckedAt && args.now.getTime() - args.lastCheckedAt.getTime() < cadence * 60_000) {
    return { skip: true, reason: 'status-cadence' };
  }
  return { skip: false, reason: 'ok' };
}
```

### 2. Wiring the edge (`index.ts`)

- **`PollableSource`** gains `seriesStatus: SeriesStatus`.
- **`loadActiveSources`** composes the status filter onto WP-43's tier `where` and includes the status:
  ```ts
  db.source.findMany({
    where: { ...sourceTierWhere(tier), series: { status: { in: POLLABLE_STATUSES } } },
    include: { series: { select: { status: true } } },
  })
  ```
  So COMPLETED/DROPPED/PAUSED sources are **never loaded** — the query handles the hard skips; the pure gate handles
  PLANNED's weekly cadence. `rowToPollable` maps `row.series.status → seriesStatus`.

### 3. The poll loop (`poll.ts` `pollAllSources`)

Groups can contain sources of mixed status (a shared multi-novel feed with a READING + a PLANNED series). The status
gate is **per-source**; the fetch is **per-group**. So, per group (in rotation order):

```
anyDue = group.sources.some(s => !statusPollGate({ status: s.seriesStatus, lastCheckedAt: s.lastCheckedAt, now }).skip)
if !anyDue → continue                         // NO fetch — nothing due (the real compute win for a solo not-due PLANNED render)
apply hostGate (per host) → skip if gated
apply budget guard → skip if unaffordable
fetch once
for (src of group.sources) → processFetched + applyPollEffects   // fetch already paid for → process every source it covers
```

The gate's value is skipping the (often expensive — RENDER/TOC) **fetch**, so it gates on whether *any* source is due.
Once a group is fetched, **every source it covers is processed** — the body's already in hand, so processing is cheap,
and skipping it would only stale a backlog we're holding fresh data for.

- A solo not-due PLANNED group ⇒ **no fetch** (skips the expensive render). The weekly cadence fully applies to any
  source that would need its *own* fetch.
- A mixed group ⇒ one shared fetch (a due READING sibling triggers it), and the not-due PLANNED sibling **rides
  along** — processed for free, keeping its backlog current (notifies are suppressed for non-READING anyway). Its
  `lastCheckedAt` is stamped, so a feed-shared PLANNED effectively polls at the READING cadence — free, since it's the
  same fetch, and it keeps sibling etags in sync so `chooseConditionalState(group.sources)` stays efficient.
- Order: any-due check first (cheapest, and it can avoid a fetch), then `hostGate`, then the budget guard.

### 4. Notify — "notify only READING" (minimal rule; positive PLANNED triggers = WP-27b)

Polling PLANNED weekly means deciding what it pings. The safe default now is **only READING notifies**:

- `PollEffects` gains `seriesStatus` (stamped by `processFetched` from the source).
- `notifyForEffects` filters **new-chapter** and **now-free** pushes to `seriesStatus === 'READING'`. PLANNED polls
  **quietly** — stores its backlog, no pings.
- **Source-down** alerts are left as-is (rare; revisit in 27b). WP-27b adds PLANNED's *positive* triggers
  (paid → fire at 0 LOCKED; free ongoing → fire at `targetChapterCount`, which is WP-21).

### 5. Scheduling behavior (how PLANNED's weekly cadence plays out)

The cadence is a **rolling per-source window anchored to each source's own `lastCheckedAt`** — not a fixed weekday.
A PLANNED source is eligible again exactly 7 days after *its* last poll, so PLANNED series stagger naturally by when
each was last polled. (One clustering vector: a batch of PLANNED added in one sitting tends to come due the same day
each week, re-anchoring +7d from that day.)

Clustering doesn't cause starvation, because the cadence composes with WP-41 rotation:

- A due PLANNED source is ≥7 days stale, so WP-41's least-recently-polled-first ordering sorts it **ahead of** daily
  READING series (≤1 day stale) — due PLANNED is *prioritized*, not deprioritized.
- If the budget is exhausted before reaching a due source, its group is skipped **without stamping `lastCheckedAt`**,
  so next run it's even staler → sorts even earlier → gets polled. It cannot be permanently starved (WP-41's
  guarantee).
- In a mixed group, a due PLANNED source **rides the shared fetch** its READING sibling triggers — polled at no extra
  cost.

If a real, budget-exceeding PLANNED clump ever emerged, the fix is a small ±jitter on the 7-day window — deferred as
YAGNI, since rotation already prevents starvation.

## Interactions (all additive, none break)

- **WP-43 tier:** the status `where` composes with `sourceTierWhere` — the frequent PLAIN poll also honors cadence, so
  a PLANNED PLAIN feed is still weekly on the 2h trigger.
- **WP-41 rotation / budget:** unchanged — the status gate just decides whether a group is fetched at all; rotation
  orders whatever remains, the budget guard costs the same per fetched group.
- **WP-42 host gate:** independent and still applied per host after status-eligibility.

## Testing

- **Unit (pure):** `statusPollGate` — READING never skips; PLANNED skips when `lastCheckedAt` < 7 days, polls at/after
  the boundary, polls when never-checked (null); PAUSED/COMPLETED/DROPPED → `status-skip`. `POLLABLE_STATUSES` derives
  to exactly `['READING', 'PLANNED']`.
- **Unit (`pollAllSources` with fakes):** solo not-due PLANNED group → zero fetches; mixed [READING, not-due PLANNED]
  group → one fetch, and BOTH sources in `applied` (the not-due PLANNED sibling rides the shared fetch); PLANNED older
  than 7 days → fetched + processed.
- **Unit (defer → next-run pickup):** a due (≥7d) PLANNED source skipped because the budget is exhausted keeps its
  `lastCheckedAt` untouched, and on a second `pollAllSources` run (rotation ordering it stalest-first) it is polled —
  pinning the "can't be starved" guarantee at the status-gate layer.
- **Integration (real DB):** COMPLETED/DROPPED/PAUSED sources are never polled (`lastCheckedAt` stays null);
  a PLANNED source stale > 7 days is polled and its new chapters are **stored but not pushed**, while a READING
  source's new chapters **are** pushed.

## Out of scope / deferred

- **PLANNED summary-seeding + backfill-on-promote** — dropped (see above); no longer a WP.
- **WP-27b (per-status positive notify rules)** — PLANNED paid → 0 LOCKED; PLANNED free → `targetChapterCount`. Needs
  WP-21 + `lib/completion.ts` (WP-13). Filed separately.
- **Immediate poll-on-promote** — not needed; the next scheduled poll catches a resumed series within ≤24h. A tiny
  future add if instant catch-up is ever wanted.
