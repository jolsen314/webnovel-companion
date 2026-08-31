# WP-28c — Feed (digest) home + shelf tab — design

**Status:** design approved-in-chat; spec under review.
**Depends on:** WP-10 (library/detail UI, done). No dependency on WP-04 (no schema change).
**Skills:** `frontend-design` (primary) for the feed/shelf visuals.

## Summary

Split the app's home into two views. `/` becomes a cross-series **digest** — a
time-ordered river of what dropped across everything you read — and the current
per-series **shelf** moves to a `/shelf` tab. The digest is the in-app,
persistent counterpart to the push notifications the poll cron already sends.

The same pass simplifies the shelf card and fixes the post-add landing so a
newly added series is easy to find.

## Goals

- A digest at `/` listing, newest-first, the chapter events across **READING**
  series: **new chapter** (readable ones only) and **now free**.
- **Known-locked new chapters stay out.** A new chapter with `access = 'LOCKED'`
  is not a readable event, so it is excluded — mirroring the push pipeline
  (`notifyForEffects` already filters `access !== 'LOCKED'`). The chapter's
  meaningful feed moment is its later **now free** event. No lock affordance is
  built into the feed row; a future paying-subscriber case (see Non-goals) would
  reverse the exclusion per series, but v1 simply omits locked chapters.
- A consolidated **"needs attention"** strip for sources that are currently
  down — one notice, not one row per source.
- A `What's new` / `Shelf` tab control on both views; the shelf keeps its sort,
  filter, and delete behavior.
- A simpler shelf card (below).
- Add lands on the shelf with the new series highlighted and findable.

## Non-goals / deferred

- **No new database table.** The feed is derived on read from existing columns.
  A later WP may materialize a `FeedEvent` log; this design deliberately does
  not.
- **"Likely available" (scheduled) events are out of v1.** The predictor
  (`nextDueRelease`) is fire-once and stamps `scheduleLastNotifiedAt`, so a
  clean derivation isn't available. It returns with the materialized log,
  alongside the WP-21 "planned fully ready" event.
- **Genre tags are not built here, but this WP files their WP.** A `tags
  String[]` field already exists on `Series` (unused), so **WP-TAGS is UI-only —
  no migration**: a detail-page tag editor, shelf display in the freed slot, a
  tag filter, and later a feed use. The shelf slot freed below is reserved for
  the first assigned tags. This WP adds WP-TAGS to PLAN.md.
- **No read-state changes.** The feed reads reading progress; it never writes
  it.
- **Paying-subscriber series (future, very low priority).** For a series the
  owner pays for, a LOCKED *new chapter* is readable and worth surfacing (the
  "new chapter" matters more than the later "now free"). That needs a per-series
  "paid" flag that reverses the locked-exclusion above for that series. Recorded
  here so it isn't lost; not built, not filed as a WP yet.

## Information architecture & routing

- `/` renders the **Feed**. The shelf moves to **`/shelf`**.
- A shared **`ViewTabs`** control (`What's new` | `Shelf`) renders at the top of
  both pages, with the active tab set from the pathname. It lives in the pages,
  not the app layout, so it never appears on `/add`, `/settings`, or
  `/series/:id`.
- The header brand link still targets `/` (now the feed). Header actions (Add,
  settings, sign-out) are unchanged.
- Both pages handle the **no-series-at-all** case with the existing "add your
  first series" hero (`ThemeScene variant="hero"`).

## The feed's lifecycle (read this before the data model)

The feed is a **time-windowed activity log, not a read-driven inbox.** This is
the load-bearing decision.

- **Marking a chapter read removes nothing.** Reading progress
  (`ReadingProgress.lastReadChapterId`, which drives shelf and detail unread
  counts) is separate from feed membership. A reader forty chapters behind still
  sees the newest row. A row leaves the feed only when it **ages out of the
  window** (~30 days).
- **The "New since last visit" divider is the only seen concept.** It is a
  per-device visual watermark in `localStorage` (`feedSeenAt`), matching how the
  theme and shelf sort already persist. Opening the feed advances it. Seen is
  not read; clicking a row does not remove it.
- **The source-down strip is live state, not an event.** It lists sources
  *currently* `DOWN`, so it clears on its own when a source recovers or gets
  re-pointed.
- **Read rows are dimmed, not removed.** A new-chapter row whose chapter is
  already read renders dimmed with a check, so "3 dropped, you've read 1" reads
  at a glance. This is display only.
- **Empty** means no chapter events in the window **and** no down sources — the
  calm "you're all caught up" state, distinct from the no-series hero.

## Feed data model (derived)

### Pure core — `src/lib/feed.ts` (TDD, Next-/Prisma-free)

```ts
type FeedEventKind = 'NEW_CHAPTER' | 'NOW_FREE';

interface FeedEventInput {
  kind: FeedEventKind;
  at: Date;                 // NEW_CHAPTER: publishedAt ?? discoveredAt; NOW_FREE: becameFreeAt
  seriesId: string;
  seriesTitle: string;
  chapterNumber: number | null;
  chapterTitle: string;
  chapterUrl: string;       // row body links here (read now)
  read: boolean;            // computed by the service; drives dimming
}

interface DownSource {
  seriesId: string;
  seriesTitle: string;
  host: string;
  sourceUrl: string;        // where to check
}

interface FeedInputs {
  events: FeedEventInput[];
  downSources: DownSource[];
}

interface FeedDayGroup {
  key: string;              // stable day key (e.g. local YYYY-MM-DD)
  label: string;            // "Today" | "Yesterday" | "Aug 27"
  items: FeedEventInput[];  // newest-first within the day
}

interface Feed {
  attention: DownSource[];
  groups: FeedDayGroup[];   // newest day first
}

export function buildFeed(inputs: FeedInputs, now: Date): Feed;
```

- `buildFeed` sorts events by `at` descending, groups by **local calendar day**
  (consistent with `relativeTime`), labels each day, and passes `downSources`
  through as `attention`. Pure and deterministic: `now` is injected, no
  `Date.now()`.
- **A single chapter never yields two events.** A chapter that was ever locked
  (i.e. `becameFreeAt != null`, whose access is now `FREE`) surfaces **only** as
  its `NOW_FREE` event — it is *not* also counted as a `NEW_CHAPTER`. The
  `NEW_CHAPTER` stream is chapters that were readable from the start and never
  locked. `buildFeed` itself is agnostic (it orders whatever it's given); the
  no-double-notify guarantee lives in `getFeed`'s event construction (below).

### Service — `src/server/services/feed.ts` → `getFeed()`

Loads raw rows for **READING series only**, computes `read` per chapter, and
calls `buildFeed`:

- **new chapter** — chapters whose `publishedAt ?? discoveredAt` falls in the
  window (~30 days), capped (~150 events total across both kinds), **excluding
  `access = 'LOCKED'`** (readable events only; `UNKNOWN` is included since it
  can't be judged locked) **and excluding any chapter with `becameFreeAt != null`**
  (a formerly-locked chapter belongs to the *now free* stream — this is what keeps
  a single chapter from notifying twice). Mirrors the push filter.
- **now free** — chapters with `becameFreeAt` in the window, timestamped at
  `becameFreeAt`.
- **read flag** — from each series' reading order (`orderChaptersForReading`)
  and `lastReadChapterId`, reusing `lib/reading.ts`.
- **down sources** — active, non-`linkOnly` sources with `health = 'DOWN'` on
  READING series.

Exported from `server/services/index.ts` beside `listSeries`.

## Feed UI

- **Feed page** (`src/app/(app)/page.tsx`, server): loads `getFeed()`, renders
  `ViewTabs`, the attention strip, and a `<Feed>` client component. Handles both
  empty states.
- **`<Feed>`** (client): renders day groups and rows, owns the `feedSeenAt`
  watermark and the "New since last visit" divider, and advances the watermark
  to the newest event's time on mount. First-ever visit (null watermark) shows
  no divider.
- **Attention strip**: one pinned notice — "N sources need checking" — expanding
  to the host list, each linking to its source URL (and the series detail).
- **Rows**: the row body links to `chapterUrl` (read now); the **series name**
  links to `/series/:id`.
  - `NEW_CHAPTER`: `[Series] · #num Title · 2h`
  - `NOW_FREE`: `[Series] · now free · #num Title · 4h`
  - read rows dimmed with a check.
- **Empty (caught-up)**: a calm "nothing new — you're all caught up" state.

## Shelf simplification

`Shelf.tsx` / `SeriesCard` + `globals.css`:

- **Drop** the latest-chapter line (`card__latest`) and the "last updated"
  relative time, for every status. Recent-activity sort still uses the timestamp
  internally; it is no longer displayed.
- **Replace** that line with the **total chapter count** (`listSeries` already
  returns `chapterCount`) — e.g. "142 chapters", "No chapters yet".
- **Hide** the unread wax badge and ribbon on **non-READING** series (the unread
  count only makes sense while actively reading).
- The freed slot is reserved for the first assigned genre tags — built in
  **WP-TAGS** (filed by this WP), not here.

## Post-add flow

Add currently redirects to `/`. Two changes so a new series is easy to find:

1. **Redirect to the shelf, highlighted** — `addSeries` success redirects to
   `/shelf?added=<id>`. The shelf scrolls that card into view and briefly
   highlights it (a ring/pulse), independent of the saved sort/filter — so even
   a 0-chapter add (which sorts last) is found immediately. Unify both add paths
   (the normal add and `addLinkOnly`) on this redirect.
2. **"Recently added" sort mode** — add a fifth `ShelfSort` (`'added'`, by series
   creation time, newest first). Requires `listSeries` to return `createdAt` and
   `ShelfSeries` to carry it; add the option to `Shelf.tsx`'s `SORT_OPTIONS` and
   the `isSort` guard. Persists like the other sorts; it does not override a
   saved sort automatically.

Edge case: if the highlighted card is filtered out by the saved status filter
(e.g. the new series' status isn't the active filter), the highlight can't show
it. Acceptable for v1; note it, don't special-case.

## Testing

- **Unit (TDD) — `lib/feed.ts`**: newest-first ordering; day grouping and
  Today/Yesterday/date labels across a day boundary with injected `now`;
  both event kinds ordered together; a formerly-locked (now-free) chapter
  yielding exactly one event (NOW_FREE, not also NEW_CHAPTER);
  window and cap; empty input.
- **Unit — `lib/shelf.ts`**: the new `'added'` sort mode (newest `createdAt`
  first, title tie-break).
- **E2E (WP-PW harness, light)**: feed renders; tab switches `/` ↔ `/shelf`; a
  new-chapter row links to the chapter URL; the series name links to detail; add
  lands on `/shelf` with the new card highlighted.
- **Gate**: `npm test` + `npm run typecheck` green before any "done" claim.

## Housekeeping on completion

- Flip WP-28c → `DONE` in PLAN.md; add the changelog line to
  `docs/CHANGELOG.md`; set the next `NEXT` (WP-28e per current order).
- Archive the WP-28c detail section into `docs/PLAN-archive.md`, leaving the
  ✅ Completed one-liner.
- The "Recently added" sort extends WP-28a — note it in that WP's archived
  entry.
- **File WP-TAGS** in PLAN.md's active queue (series tags — schema field,
  detail-page editor, shelf-slot display, tag filter), reserving the shelf slot
  this WP frees.

## Risks & open questions

- **Feed window vs. cap.** ~30 days / ~150 events is a starting guess; a busy
  READING set may want a smaller window. Tunable constants in the service.
- **Read-flag cost.** Computing `read` per event loads each READING series'
  chapters. `listSeries` already does this shape; watch query count if the
  READING set is large. Acceptable at single-user scale.
- **`ViewTabs` placement.** In the pages (not the layout) to avoid leaking onto
  add/settings/detail; a small amount of duplication is the trade.
- **No-flash.** The shelf's saved-sort flash (WP-28j) is out of scope; don't
  regress it, and keep the feed's first server render hydration-clean.
