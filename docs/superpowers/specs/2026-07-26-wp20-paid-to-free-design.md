# WP-20 — Paid→free frontier / "now free" unlock detection

**Date:** 2026-07-26
**Status:** Design accepted (brainstorm)
**Depends on:** WP-07 (poll orchestration), WP-17 (page-watch), WP-17b (renderer — makes locked TOCs reachable)
**Consumes:** WP-09 send-path (`buildPushMessages`, `sendPushMessages`), existing `Chapter.access` / `Chapter.becameFreeAt` columns

## Problem

On paid/advance sites the RSS feed fires when a chapter is *published* — usually **locked**. The event that
matters to a reader, a chapter *becoming free* (the free frontier advancing), never re-emits in the feed; it lives
only in the TOC's lock markers. Page-watch (`parseToc`, WP-17) already reads FREE/LOCKED access per chapter and the
headless renderer (WP-17b) now makes locked TOCs reachable. WP-20 turns that access signal into a detected event.

## Scope

**In scope**
- Detect already-seen chapters flipping `LOCKED → FREE` on a page-watch poll (the "now free" event).
- Stamp `Chapter.becameFreeAt` and update `Chapter.access = FREE` on those rows.
- Fire a "now free" push notification (for READING series — the default poll set today).
- Store brand-new **locked** chapters silently (persist them, but suppress the "new chapter" push) so their later
  unlock can be caught.

**Out of scope (deferred)**
- WP-27's status-gated rules: PLANNED+paid "fire only when 0 locked remain", skipping COMPLETED/DROPPED polls,
  PLANNED-seeds-a-summary. WP-20 detects and notifies per-chapter unlocks for the series we already poll.
- A per-series "notify me on new *locked* chapters too" opt-in (for readers who buy advance access). Recorded as a
  future extension; not built now.
- A stored per-series `freeFrontier` column. The frontier (`max(number)` over free chapters) is derived on demand
  for copy; a denormalized cache has no consumer yet (YAGNI). Monotonicity already falls out of `becameFreeAt`
  (once a row is stamped unlocked we never re-lock it).

## Design

Per-chapter unlock detection (not a stored frontier). Four mostly-additive layers; **no migration** — `access` and
`becameFreeAt` already exist on `Chapter`.

### Layer 1 — `src/lib/feeds/diff.ts` (pure, test-first)

- `KnownChapter` gains `access?: 'FREE' | 'LOCKED'` — the stored access state. Absent (or UNKNOWN) for feed sources
  that never tracked locks.
- `DiffResult` gains `becameFree: FeedItem[]` — the previously-documented extension point, now populated.
- Detection runs alongside the existing new-chapter scan. For a fetched item that **is already seen**: if its
  **stored** access was `LOCKED` and its **fetched** access is `FREE`, it goes in `becameFree`. Stored access is
  resolved by the same dual identity the diff already uses — look up by guid, then by canonical url.
- Non-events (produce nothing): `FREE→LOCKED` (a flicker / mis-parse — never re-lock), `UNKNOWN→FREE` (feed source),
  and any unchanged state. `new` and `becameFree` are disjoint by construction (`new` = not-seen; `becameFree` = seen).

### Layer 2 — `src/server/services/poll.ts` (pure orchestration)

- `loadStoredChapters` port returns `access` in addition to `{ guid, url }`.
- `PollEffects` gains `becameFree: FeedItem[]`; `pollSource` reads it from the diff result and passes it through.

### Layer 3 — persistence (`src/server/services/index.ts` binding)

- `loadStoredChapters` Prisma `select` adds `access`.
- `applyPollEffects` gains an **update** step inside the existing `$transaction`: for each `becameFree` chapter,
  `update` the matching `Chapter` row to `access = FREE, becameFreeAt = now`, guarded with `becameFreeAt: null` in
  the `where` so a repeat poll never overwrites the original unlock time. New-chapter inserts are unchanged (locked
  ones included — "store silently").

### Layer 4 — notification (`src/lib/notify.ts` + `notifyForEffects` binding)

- `notify.ts`: `NotifyInput` gains `nowFree: { seriesId: string; count: number }[]`. `buildPushMessages` emits a
  **"Now free"** message immediately after the new-chapter category:
  - `title`: always `"Now free"` (no series name — privacy-consistent with the rest of the copy).
  - `body`: `count === 1 ? seriesTitle : \`${seriesTitle} — ${count} now free\``.
  - `url`: `/series/${seriesId}`; `tag`: `free-${seriesId}`.
  - Gated by the **existing `push.newChapters`** toggle (a chapter becoming free is new readable content — no new
    `NotificationPrefs` field, no new Settings switch).
- `notifyForEffects` binding:
  - Map `e.becameFree` (per series, count) → `nowFree`.
  - Change the new-chapter count to **exclude `access === 'LOCKED'`** items, so a poll that only added locked
    chapters yields no "new chapter" push. FREE and UNKNOWN (feed) chapters still notify.

## Data flow

```
page-watch poll → parseToc (access per chapter)
  → diffChapters(stored{+access}, fetched)
      → new         : not-seen chapters (locked ones stored, not pushed)
      → becameFree  : seen chapters that were LOCKED, now FREE
  → applyPollEffects: insert new; update becameFree rows (access=FREE, becameFreeAt=now)
  → notifyForEffects: new(FREE/UNKNOWN)→"New chapter(s)"; becameFree→"Now free"; both gated by pushNewChapter
```

## Edge cases

- **Feed source (access UNKNOWN):** never produces `becameFree` (requires stored `LOCKED`). Unaffected.
- **Re-lock flicker (`FREE→LOCKED`):** ignored; stored access stays FREE, `becameFreeAt` preserved.
- **Idempotency:** after an unlock the stored row is FREE, so a subsequent poll can't re-detect it → no double-fire.
  The `becameFreeAt: null` update guard is belt-and-suspenders.
- **New FREE chapter on page-watch:** lands in `new`, notified as a normal new chapter — not a "now free" event.

## Testing (TDD, red→green each)

- **diff unit:** LOCKED→FREE fires `becameFree`; FREE→FREE / LOCKED→LOCKED / UNKNOWN→FREE / FREE→LOCKED do not;
  a new locked chapter lands in `new` not `becameFree`; stored access resolves via both guid and url; idempotent
  (after unlock, re-diff yields empty `becameFree`).
- **poll unit:** a PAGE_WATCH poll threads stored access → populates `effects.becameFree`.
- **notify unit:** `nowFree` → "Now free" copy; gated by the `newChapters` pref; the work title never appears in
  `title` (extends the existing privacy regression).
- **integration (real DB):** add a page-watch series holding a LOCKED chapter → poll sees it FREE → `becameFreeAt`
  stamped, `access` FREE, a now-free message built, no re-fire on the next poll; a new-locked-only poll stores the
  chapter but produces no new-chapter push.

## Future extensions (not now)

- Per-series opt-in to also push new *locked* chapters (advance-access readers).
- WP-27 status rules layered on top: PLANNED+paid fires only when 0 locked remain; poll-skip COMPLETED/DROPPED.
