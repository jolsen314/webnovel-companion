# WP-35 — TOC-order chapters + display toggle

**Date:** 2026-07-27
**Status:** Design accepted (brainstorm).
**Depends on / reuses:** WP-17 (`parseToc`), WP-33 (backfill, page-watch persistence, `orderChaptersForReading`), WP-10 (series-detail UI). Interacts with WP-32 (split TOC).

## Problem

Chapter display order is currently *inferred* at read-time from chapter numbers + a title heuristic
(`orderChaptersForReading`, WP-33): un-numbered first, numbered by number, Extra/Side last. It works but carries
per-chapter edge cases (prologues, specials, unparseable numbers, false-positive "extra"/"side" matches). The TOC is
the **site's own canonical ordering** and already places every chapter — including oddballs — correctly. WP-35 follows
that order instead, and makes the on-screen display direction a user choice, with reading-progress anchored to the
canonical sequence rather than array position.

## Design

Two parts: **(A)** persist the TOC's canonical order; **(B)** a display toggle over it, with read-state anchored to
canonical position.

### Part A — Canonical order from the TOC (backend)

- **Migration (additive):** `Chapter.position Int?` — nullable. `null` = the series has never had a successful TOC
  read → fall back to `orderChaptersForReading`.
- **Capture:** `parseToc` returns chapters in DOM order. On every TOC parse — `backfillFromToc`, the at-add
  `mergeFeedAndToc` seed, and each page-watch poll — assign `position` from that order and persist. Page-watch reads
  the full TOC each poll, so it **re-indexes every read** → site insertions / re-sorts self-heal.
- **Direction normalize:** TOCs vary (many list newest-first). Detect direction from the **chapter-number trend**
  across the parsed array (do numbers rise or fall as DOM index rises?). Store `position` ascending in **reading
  order** (oldest = 0), reversing the DOM index when the TOC is newest-first. Numbers are used only for this single
  global direction bit — robust to a few unparseable ones. **If the numeric signal is too weak to decide, skip
  positioning** (leave `position` null → comparator fallback) rather than guess.
- **Feed-discovered chapters** (a feed series' new chapters between TOC reads): appended at `max(position)+1` (newest);
  the next full TOC read re-indexes everything.
- **Re-index scope:** on a full TOC read, set `position` for every stored chapter of the series — matched TOC rows get
  their normalized index; any stored chapter not in the current TOC is appended after the TOC block (kept, ordered
  last). So after any TOC read the series is fully positioned; nulls persist only for never-TOC'd (pure-feed) series.
- **Ordering source:** `getSeries`/`listSeries` order by `position` ascending when the series is positioned; else
  `orderChaptersForReading`. A small helper decides: positioned (any non-null position) → position order; else
  comparator. `latestChapter` = last in canonical order.

### Part B — Display toggle (frontend)

- **Read-state anchored to canonical position.** The server returns chapters in canonical order (Part A) plus
  `lastReadChapterId`. The client finds the last-read chapter's index in that canonical array (`lastReadIdx`) and marks
  `read = canonicalIdx ≤ lastReadIdx` **before** reordering for display. A stale/absent `lastReadChapterId`
  (`findIndex → -1`) → nothing read (mirrors `unreadCount`'s all-unread fallback). This retires the current
  array-index read logic, which only works oldest-first.
- **Reading-progress model (unchanged, confirmed):** a single high-water-mark pointer (`ReadingProgress.
  lastReadChapterId`). Marking chapter N read sets the pointer to N; everything at/before N in canonical order is read.
  Setting an earlier chapter rewinds the boundary (later chapters become unread). No per-chapter read flags.
- **Three display modes** over the canonical sequence:
  - **Oldest→newest** (default): canonical ascending.
  - **Newest→oldest**: canonical reversed.
  - **Unread-first**: `[unread ascending] ++ [read ascending]` — unread chapters (canonicalIdx > lastReadIdx) oldest→
    newest at the top, then the read chapters oldest→newest below. (Read-section order is easy to flip to descending
    later if preferred.)
- **Toggle UI:** a small segmented control in the `detail__controls` area, matching existing control styling.
- **Preference:** global, stored in `localStorage`, read on mount; default oldest-first — so the SSR render (server
  returns canonical oldest-first) matches the default with no reorder flash. A non-default stored mode reorders on the
  client after hydration (acceptable for a view toggle).

### Defaults committed (owner-approved)

- `position` is **Int**, re-indexed on each full TOC read (no float-gap scheme — YAGNI given full re-index).
- Unread-first = `[unread asc] ++ [read asc]`.
- Undetectable TOC direction → **skip positioning** (comparator fallback), never guess.

## Interactions & scope

- `orderChaptersForReading` (WP-33) is **kept as the fallback** for pure-feed / never-TOC'd series — not deleted.
- One additive migration (`Chapter.position`), unlike WP-33.
- WP-32 (split TOC across sibling pages) — when built, `position` spans the unioned pages; note the dependency.
- The display toggle is **detail-page scoped**. The library/shelf order (`listSeries`, by `updatedAt`) and the
  per-card `latestChapter`/`unread` are unaffected except that they now derive from canonical position.

## Testing

- **Pure (lib):**
  - Direction detection: an ascending TOC, a descending (newest-first) TOC, and an ambiguous/low-number TOC (→ skip).
  - Position normalization: DOM order → reading-order positions (reversed when newest-first).
  - Canonical-order-vs-fallback selection (positioned → position order; unpositioned → comparator).
  - Display transforms: oldest / newest / unread-first, and read-state = `canonicalIdx ≤ lastReadIdx` across all three.
- **Integration (real DB):** backfill and page-watch persist positions; `getSeries` returns position order; a
  feed-discovered chapter appends at the end; a re-poll re-indexes after a simulated TOC re-sort.
- **Frontend:** the three-mode toggle reorders correctly and read flags stay correct in every mode (the pure transform
  tests carry the logic; a manual verify against a seeded series confirms the wiring + localStorage persistence).

## Out of scope

- Per-chapter read/unread flags (a different, bigger progress model) — the pointer model stays.
- Server-synced / per-series display preference (global localStorage now; easy to upgrade later).
- Changing the library/shelf ordering.
