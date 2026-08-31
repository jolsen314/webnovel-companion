# WP-28c — Feed (digest) home + shelf tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` a cross-series digest of what's new across READING series, move the per-series shelf to a `/shelf` tab, simplify the shelf card, and land adds on the shelf with the new series highlighted.

**Architecture:** The digest is derived on read from existing `Chapter` timestamps — no new table, no migration. A pure `lib/feed.ts` orders and day-groups events; a thin `getFeed()` service loads READING-series rows and calls it; a client `Feed` component renders rows, a consolidated source-down strip, a localStorage "new since last visit" divider, and dims already-read rows. Two server routes (`/` feed, `/shelf` shelf) share a `ViewTabs` control.

**Tech Stack:** Next.js (App Router, customized — see constraints) · TypeScript strict · Tailwind-adjacent hand-written `globals.css` · Prisma/Postgres (read-only here) · Vitest (unit + integration) · Playwright (E2E).

**Spec:** [docs/superpowers/specs/2026-08-29-wp28c-feed-vs-shelf-design.md](../specs/2026-08-29-wp28c-feed-vs-shelf-design.md)

## Global Constraints

- **`src/lib/**` stays pure and Next-free** — no `next`/`prisma`/`fs`/network imports. `lib/feed.ts` and `lib/shelf.ts` must remain importable by unit tests with zero I/O.
- **TDD for all `lib/` logic** — write the failing test first, watch it fail for the right reason, then implement (red → green).
- **Verify before "done"** — run `npm test` (unit) **and** `npm run typecheck`, read the exit codes, and only then claim a task complete. UI tasks additionally run `npm run build`.
- **Branch:** all work lands on `wp-28c-feed-vs-shelf` (already created; the design spec + PLAN update are its first commit). Commit after every task.
- **Committed-doc anonymity** — no real site or series names in code, comments, tests, or docs. Use `example.test`-style hosts and invented titles.
- **This Next.js is customized.** Before writing any routing / navigation code (new route segment, `Link`, `useSearchParams`), read the relevant guide under `node_modules/next/dist/docs/` (resolve from the repo, not root) and heed deprecations.
- **Feed is derived — no schema change.** Do not add a Prisma model or migration in this WP. `Series.tags` and `Series.createdAt` already exist.
- **The whole plan is one WP (WP-28c).** Stop at the end and check in before any follow-on WP.

---

### Task 1: "Recently added" shelf sort (pure) + `listSeries` returns `createdAt`

Adds a fifth sort mode ordering by series creation time, and threads the `createdAt` the mode needs from the real query. Kept in one task so typecheck stays green (the new `ShelfSeries.createdAt` field is satisfied by the `listSeries` change in the same commit).

**Files:**
- Modify: `src/lib/shelf.ts`
- Test: `tests/unit/shelf.test.ts`
- Modify: `src/server/services/series.ts:34-54` (the `listSeries` return map)

**Interfaces:**
- Produces: `ShelfSort` gains `'added'`; `ShelfSeries` gains `createdAt: Date`; `listSeries()` rows gain `createdAt: Date`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/shelf.test.ts` — first extend the fixture `s(...)` to supply a `createdAt`, then the new case:

```ts
// in the `s` fixture object literal, add a default:
//   createdAt: new Date('2026-01-01T00:00:00Z'),
// (place it alongside title/unread/rating/status/latestChapter)

test('added: newest createdAt first, tie-break title', () => {
  const rows = [
    s({ id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') }),
    s({ id: 'newB', title: 'Beta', createdAt: new Date('2026-06-01T00:00:00Z') }),
    s({ id: 'newA', title: 'Alpha', createdAt: new Date('2026-06-01T00:00:00Z') }),
  ];
  expect(sortSeries(rows, 'added').map((r) => r.id)).toEqual(['newA', 'newB', 'old']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- shelf`
Expected: FAIL — `'added'` is not assignable to `ShelfSort` (type error) / wrong order.

- [ ] **Step 3: Implement in `src/lib/shelf.ts`**

In the `ShelfSeries` interface add the field:

```ts
  /** Series creation time — for the "Recently added" sort. */
  createdAt: Date;
```

Widen the sort union:

```ts
export type ShelfSort = 'recent' | 'unread' | 'title' | 'rating' | 'added';
```

Add a case to `sortSeries`'s `switch` (before `case 'title':`), descending by time, falling through to the title tie-break:

```ts
      case 'added': {
        const ca = a.createdAt.getTime();
        const cb = b.createdAt.getTime();
        if (ca !== cb) return cb - ca;
        break;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- shelf`
Expected: PASS (all shelf tests, including the existing ones now carrying a `createdAt` default).

- [ ] **Step 5: Thread `createdAt` through `listSeries`**

In `src/server/services/series.ts`, in the `rows.map(...)` return object (around line 37), add:

```ts
      createdAt: s.createdAt,
```

(`createdAt` is a scalar on `Series`, already loaded by `findMany` with `include`; no `select` change needed.)

- [ ] **Step 6: Verify + commit**

Run: `npm test && npm run typecheck`
Expected: PASS, no type errors (the `SeriesRow` used by `Shelf.tsx` now satisfies `ShelfSeries`).

```bash
git add src/lib/shelf.ts tests/unit/shelf.test.ts src/server/services/series.ts
git commit -m "feat(WP-28c): 'Recently added' shelf sort + listSeries createdAt"
```

---

### Task 2: Feed core (pure) — `lib/feed.ts`

The ordering + day-grouping engine and the seen-count helper. Pure, `now` injected, no I/O.

**Files:**
- Create: `src/lib/feed.ts`
- Test: `tests/unit/feed.test.ts`

**Interfaces:**
- Produces:
  - `type FeedEventKind = 'NEW_CHAPTER' | 'NOW_FREE'`
  - `interface FeedEvent { kind; at: Date; seriesId; seriesTitle; chapterNumber: number | null; chapterTitle; chapterUrl; read: boolean }`
  - `interface DownSource { seriesId; seriesTitle; host; sourceUrl }`
  - `interface FeedInputs { events: FeedEvent[]; downSources: DownSource[] }`
  - `interface FeedDayGroup { key: string; label: string; items: FeedEvent[] }`
  - `interface Feed { attention: DownSource[]; groups: FeedDayGroup[] }`
  - `function buildFeed(inputs: FeedInputs, now: Date): Feed`
  - `function countNewSince(feed: Feed, seenAt: Date | null): number`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/feed.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildFeed, countNewSince, type FeedEvent, type DownSource } from '../../src/lib/feed';

const ev = (over: Partial<FeedEvent> & { at: string }): FeedEvent => ({
  kind: 'NEW_CHAPTER',
  seriesId: 's1',
  seriesTitle: 'Alpha',
  chapterNumber: 1,
  chapterTitle: 'Ch',
  chapterUrl: `https://ex.test/${over.at}`,
  read: false,
  ...over,
  at: new Date(over.at),
});

const NOW = new Date('2026-08-30T12:00:00Z');

describe('buildFeed', () => {
  test('orders newest-first and groups by UTC day with Today/Yesterday/date labels', () => {
    const feed = buildFeed(
      {
        events: [
          ev({ at: '2026-08-28T09:00:00Z', chapterTitle: 'older' }),
          ev({ at: '2026-08-30T01:00:00Z', chapterTitle: 'today-early' }),
          ev({ at: '2026-08-30T08:00:00Z', chapterTitle: 'today-late' }),
          ev({ at: '2026-08-29T20:00:00Z', chapterTitle: 'yesterday' }),
        ],
        downSources: [],
      },
      NOW,
    );
    expect(feed.groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Fri, Aug 28']);
    expect(feed.groups[0].items.map((i) => i.chapterTitle)).toEqual(['today-late', 'today-early']);
    expect(feed.groups[1].items.map((i) => i.chapterTitle)).toEqual(['yesterday']);
  });

  test('keeps both event kinds (a locked→unlocked chapter yields two rows)', () => {
    const feed = buildFeed(
      {
        events: [
          ev({ at: '2026-08-20T00:00:00Z', kind: 'NEW_CHAPTER', chapterUrl: 'https://ex.test/c9' }),
          ev({ at: '2026-08-30T00:00:00Z', kind: 'NOW_FREE', chapterUrl: 'https://ex.test/c9' }),
        ],
        downSources: [],
      },
      NOW,
    );
    const kinds = feed.groups.flatMap((g) => g.items.map((i) => i.kind));
    expect(kinds).toEqual(['NOW_FREE', 'NEW_CHAPTER']);
  });

  test('passes down sources through as attention, sorted by series title', () => {
    const down: DownSource[] = [
      { seriesId: 'b', seriesTitle: 'Beta', host: 'b.test', sourceUrl: 'https://b.test' },
      { seriesId: 'a', seriesTitle: 'Alpha', host: 'a.test', sourceUrl: 'https://a.test' },
    ];
    const feed = buildFeed({ events: [], downSources: down }, NOW);
    expect(feed.attention.map((d) => d.seriesTitle)).toEqual(['Alpha', 'Beta']);
    expect(feed.groups).toEqual([]);
  });

  test('pure: does not mutate inputs', () => {
    const events = [ev({ at: '2026-08-30T00:00:00Z' }), ev({ at: '2026-08-29T00:00:00Z' })];
    const before = events.map((e) => e.chapterUrl);
    buildFeed({ events, downSources: [] }, NOW);
    expect(events.map((e) => e.chapterUrl)).toEqual(before);
  });
});

describe('countNewSince', () => {
  test('null watermark → 0 (first visit shows no divider)', () => {
    const feed = buildFeed({ events: [ev({ at: '2026-08-30T00:00:00Z' })], downSources: [] }, NOW);
    expect(countNewSince(feed, null)).toBe(0);
  });

  test('counts events strictly newer than the watermark', () => {
    const feed = buildFeed(
      {
        events: [
          ev({ at: '2026-08-30T05:00:00Z' }),
          ev({ at: '2026-08-30T03:00:00Z' }),
          ev({ at: '2026-08-29T00:00:00Z' }),
        ],
        downSources: [],
      },
      NOW,
    );
    expect(countNewSince(feed, new Date('2026-08-30T02:00:00Z'))).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- feed`
Expected: FAIL — `Cannot find module '../../src/lib/feed'`.

- [ ] **Step 3: Implement `src/lib/feed.ts`**

```ts
/**
 * Pure feed (digest) core — orders cross-series chapter events newest-first and
 * groups them by day, and counts events newer than a "seen" watermark. Next-/
 * Prisma-free: the service edge (`server/services/feed.ts`) loads rows and calls
 * this. `now` is injected for purity; day math is UTC (server renders in UTC —
 * a near-midnight local mismatch is an accepted v1 limit, noted in the spec).
 */

export type FeedEventKind = 'NEW_CHAPTER' | 'NOW_FREE';

export interface FeedEvent {
  kind: FeedEventKind;
  at: Date; // NEW_CHAPTER: publishedAt ?? discoveredAt; NOW_FREE: becameFreeAt
  seriesId: string;
  seriesTitle: string;
  chapterNumber: number | null;
  chapterTitle: string;
  chapterUrl: string; // the row body links here (read now)
  read: boolean; // drives dimming; computed by the service
}

export interface DownSource {
  seriesId: string;
  seriesTitle: string;
  host: string;
  sourceUrl: string;
}

export interface FeedInputs {
  events: FeedEvent[];
  downSources: DownSource[];
}

export interface FeedDayGroup {
  key: string; // UTC YYYY-MM-DD
  label: string; // "Today" | "Yesterday" | "Fri, Aug 28"
  items: FeedEvent[]; // newest-first within the day
}

export interface Feed {
  attention: DownSource[];
  groups: FeedDayGroup[]; // newest day first
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const dayKey = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

function dayLabel(d: Date, now: Date): string {
  const k = dayKey(d);
  if (k === dayKey(now)) return 'Today';
  if (k === dayKey(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return `${WEEKDAY[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Newest-first, day-grouped feed. Ties break by series title then chapter url (deterministic). */
export function buildFeed(inputs: FeedInputs, now: Date): Feed {
  const events = [...inputs.events].sort((a, b) => {
    if (b.at.getTime() !== a.at.getTime()) return b.at.getTime() - a.at.getTime();
    if (a.seriesTitle !== b.seriesTitle) return a.seriesTitle < b.seriesTitle ? -1 : 1;
    return a.chapterUrl < b.chapterUrl ? -1 : a.chapterUrl > b.chapterUrl ? 1 : 0;
  });

  const groups: FeedDayGroup[] = [];
  for (const ev of events) {
    const key = dayKey(ev.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(ev);
    else groups.push({ key, label: dayLabel(ev.at, now), items: [ev] });
  }

  const attention = [...inputs.downSources].sort((a, b) => {
    if (a.seriesTitle !== b.seriesTitle) return a.seriesTitle < b.seriesTitle ? -1 : 1;
    return a.host < b.host ? -1 : a.host > b.host ? 1 : 0;
  });

  return { attention, groups };
}

/** How many events are newer than the seen watermark (null → 0, i.e. no divider on a first visit). */
export function countNewSince(feed: Feed, seenAt: Date | null): number {
  if (!seenAt) return 0;
  const cut = seenAt.getTime();
  return feed.groups.reduce((n, g) => n + g.items.filter((e) => e.at.getTime() > cut).length, 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- feed`
Expected: PASS.

- [ ] **Step 5: Verify + commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src/lib/feed.ts tests/unit/feed.test.ts
git commit -m "feat(WP-28c): pure feed core — buildFeed + countNewSince"
```

---

### Task 3: `getFeed()` service (derived) + export + integration test

Loads READING-series rows, maps them to `FeedEvent`s (excluding LOCKED new chapters), collects `LIKELY_DOWN` sources, and calls `buildFeed`.

**Files:**
- Create: `src/server/services/feed.ts`
- Modify: `src/server/services/index.ts` (add an export line)
- Test: `tests/integration/services.test.ts` (append a `getFeed` describe block)

**Interfaces:**
- Consumes: `buildFeed`, `FeedEvent`, `DownSource`, `Feed` from `lib/feed`; `orderChaptersForReading` from `lib/reading`.
- Produces: `getFeed(now?: Date): Promise<Feed>`, re-exported from `server/services`.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/services.test.ts`. Add `getFeed` to the import list from `../../src/server/services`, then:

```ts
describe('getFeed (real DB)', () => {
  test('new-chapter + now-free rows for READING series, newest-first; excludes locked + non-reading', async () => {
    const userId = getCurrentUserId();
    const now = new Date('2026-08-30T12:00:00Z');
    const recent = new Date('2026-08-30T06:00:00Z');
    const older = new Date('2026-08-29T06:00:00Z');

    await db.series.create({
      data: {
        userId,
        title: 'Reading One',
        status: 'READING',
        chapters: {
          create: [
            { title: 'free-recent', url: 'https://ex.test/r/2', access: 'FREE', discoveredAt: recent },
            { title: 'free-older', url: 'https://ex.test/r/1', access: 'FREE', discoveredAt: older },
            { title: 'locked', url: 'https://ex.test/r/3', access: 'LOCKED', discoveredAt: recent },
          ],
        },
      },
    });
    await db.series.create({
      data: {
        userId,
        title: 'Completed One',
        status: 'COMPLETED',
        chapters: { create: [{ title: 'done', url: 'https://ex.test/c/1', access: 'FREE', discoveredAt: recent }] },
      },
    });

    const feed = await getFeed(now);
    const titles = feed.groups.flatMap((g) => g.items.map((i) => i.chapterTitle));
    expect(titles).toEqual(['free-recent', 'free-older']); // newest-first, no 'locked', no 'done'
    expect(feed.groups[0].label).toBe('Today');
  });

  test('surfaces a LIKELY_DOWN source of a READING series as an attention row', async () => {
    const userId = getCurrentUserId();
    await db.series.create({
      data: {
        userId,
        title: 'Down Series',
        status: 'READING',
        sources: {
          create: {
            url: 'https://down.test/novel/',
            host: 'down.test',
            type: 'PAGE_WATCH',
            health: 'LIKELY_DOWN',
          },
        },
      },
    });
    const feed = await getFeed(new Date('2026-08-30T12:00:00Z'));
    expect(feed.attention.some((a) => a.host === 'down.test' && a.seriesTitle === 'Down Series')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- services` (needs the test Postgres — see `tests/integration/setup.ts`; env like the existing services tests)
Expected: FAIL — `getFeed` is not exported.

- [ ] **Step 3: Implement `src/server/services/feed.ts`**

```ts
import { db } from '../db';
import { getCurrentUserId } from '../user';
import { orderChaptersForReading } from '../../lib/reading';
import { buildFeed, type DownSource, type Feed, type FeedEvent } from '../../lib/feed';

/** Derived digest (WP-28c): READING-series chapter events in a bounded window, plus a
 *  consolidated list of currently-down sources. No schema change — read-only over Chapter
 *  timestamps + Source health. Decision logic (order/group) lives in the pure `buildFeed`. */
const WINDOW_DAYS = 30;
const MAX_EVENTS = 150;

export async function getFeed(now: Date = new Date()): Promise<Feed> {
  const userId = getCurrentUserId();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const series = await db.series.findMany({
    where: { userId, status: 'READING' },
    include: {
      progress: true,
      chapters: {
        select: {
          id: true,
          title: true,
          url: true,
          number: true,
          position: true,
          publishedAt: true,
          discoveredAt: true,
          access: true,
          becameFreeAt: true,
        },
      },
      // Currently-down sources only → the consolidated "needs attention" strip.
      sources: { where: { isActive: true, linkOnly: false, health: 'LIKELY_DOWN' }, select: { host: true, url: true } },
    },
  });

  const events: FeedEvent[] = [];
  const downSources: DownSource[] = [];

  for (const s of series) {
    const ordered = orderChaptersForReading(s.chapters);
    const lastReadIdx = s.progress?.lastReadChapterId
      ? ordered.findIndex((c) => c.id === s.progress!.lastReadChapterId)
      : -1;
    // Everything up to and including the pointer is read (empty set when there's no progress).
    const readIds = new Set(ordered.slice(0, lastReadIdx + 1).map((c) => c.id));

    for (const c of s.chapters) {
      const newAt = c.publishedAt ?? c.discoveredAt;
      if (c.access !== 'LOCKED' && newAt >= since) {
        events.push({
          kind: 'NEW_CHAPTER',
          at: newAt,
          seriesId: s.id,
          seriesTitle: s.title,
          chapterNumber: c.number,
          chapterTitle: c.title,
          chapterUrl: c.url,
          read: readIds.has(c.id),
        });
      }
      if (c.becameFreeAt && c.becameFreeAt >= since) {
        events.push({
          kind: 'NOW_FREE',
          at: c.becameFreeAt,
          seriesId: s.id,
          seriesTitle: s.title,
          chapterNumber: c.number,
          chapterTitle: c.title,
          chapterUrl: c.url,
          read: readIds.has(c.id),
        });
      }
    }

    for (const src of s.sources) {
      downSources.push({ seriesId: s.id, seriesTitle: s.title, host: src.host, sourceUrl: src.url });
    }
  }

  // Cap to the newest MAX_EVENTS before grouping; buildFeed sorts authoritatively.
  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return buildFeed({ events: events.slice(0, MAX_EVENTS), downSources }, now);
}
```

- [ ] **Step 4: Export it**

In `src/server/services/index.ts`, beside the other re-exports (near the `export { listSeries, ... }` line):

```ts
export { getFeed } from './feed';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:integration -- services`
Expected: PASS.

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/server/services/feed.ts src/server/services/index.ts tests/integration/services.test.ts
git commit -m "feat(WP-28c): getFeed() derived digest service"
```

---

### Task 4: Routing swap + feed UI (feed at `/`, shelf at `/shelf`)

The IA swap — coherent in one task because `/` cannot be half-migrated. Extracts the no-series hero, adds the tab control, moves the shelf render to `/shelf`, rewrites `/` as the feed, builds the `Feed` client component, and styles the feed + tabs.

**Files:**
- Create: `src/app/(app)/EmptyHero.tsx` (extracted from the current `page.tsx` `EmptyState`)
- Create: `src/app/(app)/ViewTabs.tsx`
- Create: `src/app/(app)/Feed.tsx`
- Create: `src/app/(app)/shelf/page.tsx`
- Rewrite: `src/app/(app)/page.tsx`
- Modify: `src/app/globals.css` (append feed + tabs styles)

**Interfaces:**
- Consumes: `getFeed`, `listSeries` from `server/services`; `Feed` type from `lib/feed`; `relativeTime` from `lib/format`.
- Produces: `EmptyHero`, `ViewTabs` (`active: 'feed' | 'shelf'`), `Feed` (`{ data: FeedData; now: Date }`).

- [ ] **Step 1: Read the Next routing docs**

Run: `ls node_modules/next/dist/docs/` and read the App-Router page/segment guide (e.g. the `app` routing + `Link` files). Confirm the current conventions for a new route segment and `Link`. Note anything that differs from older Next before writing the components.

- [ ] **Step 2: Extract the no-series hero → `src/app/(app)/EmptyHero.tsx`**

Move the current `EmptyState` component out of `page.tsx` verbatim (it renders `<ThemeScene variant="hero" />` + the `.hero` section), exported as `EmptyHero`:

```tsx
import Link from 'next/link';
import { ThemeScene } from './ThemeScene';

/** Shown by both the feed and the shelf when the user has zero series. */
export function EmptyHero() {
  return (
    <>
      <ThemeScene variant="hero" />
      <section className="hero">
        <p className="hero__eyebrow">Your shelf</p>
        <h1 className="hero__title">
          It&rsquo;s quiet in here.
          <br />
          Let&rsquo;s fix that.
        </h1>
        <p className="hero__lede">
          Add a series and I&rsquo;ll watch its release feed. When a new chapter drops, your phone lights up&nbsp;— no
          more checking a dozen sites to see if today&rsquo;s the day.
        </p>
        <div className="hero__actions">
          <Link href="/add" className="btn btn--primary">
            Add your first series
          </Link>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 3: Add the tab control → `src/app/(app)/ViewTabs.tsx`**

A plain (server) component — just two `Link`s with an active flag from the page:

```tsx
import Link from 'next/link';

/** Segmented control shared by the feed (/) and shelf (/shelf) pages. Rendered inside each
 *  page (not the app layout) so it never appears on /add, /settings, or /series/:id. */
export function ViewTabs({ active }: { active: 'feed' | 'shelf' }) {
  return (
    <nav className="viewtabs" aria-label="Views">
      <Link href="/" className={`viewtabs__tab${active === 'feed' ? ' is-active' : ''}`} aria-current={active === 'feed' ? 'page' : undefined}>
        What&rsquo;s new
      </Link>
      <Link href="/shelf" className={`viewtabs__tab${active === 'shelf' ? ' is-active' : ''}`} aria-current={active === 'shelf' ? 'page' : undefined}>
        Shelf
      </Link>
    </nav>
  );
}
```

- [ ] **Step 4: Build the feed client component → `src/app/(app)/Feed.tsx`**

```tsx
'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { relativeTime } from '../../lib/format';
import { countNewSince, type DownSource, type Feed as FeedData, type FeedEvent } from '../../lib/feed';

const SEEN_KEY = 'feedSeenAt';

function AttentionStrip({ sources }: { sources: DownSource[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="feed-attention">
      <button type="button" className="feed-attention__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {sources.length} source{sources.length === 1 ? '' : 's'} need checking today
      </button>
      {open && (
        <ul className="feed-attention__list">
          {sources.map((s) => (
            <li key={`${s.seriesId}:${s.host}`}>
              <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                {s.host}
              </a>
              {' — '}
              <Link href={`/series/${s.seriesId}`}>{s.seriesTitle}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventRow({ ev, now }: { ev: FeedEvent; now: Date }) {
  return (
    <li className={`feed-row${ev.read ? ' feed-row--read' : ''}`}>
      <a className="feed-row__main" href={ev.chapterUrl} target="_blank" rel="noreferrer">
        {ev.kind === 'NOW_FREE' && <span className="feed-row__tag">now free</span>}
        {ev.chapterNumber != null && <span className="feed-row__num">#{ev.chapterNumber}</span>}
        <span className="feed-row__title">{ev.chapterTitle}</span>
        {ev.read && (
          <span className="feed-row__check" aria-label="read">
            ✓
          </span>
        )}
      </a>
      <div className="feed-row__meta">
        <Link href={`/series/${ev.seriesId}`} className="feed-row__series">
          {ev.seriesTitle}
        </Link>
        <span className="feed-row__time">{relativeTime(ev.at, now)}</span>
      </div>
    </li>
  );
}

export function Feed({ data, now }: { data: FeedData; now: Date }) {
  // Per-device seen watermark: read the pre-visit value on mount, then advance storage to the
  // newest event so the next visit measures "new" from now. seenAt state keeps the pre-visit value.
  const [seenAt, setSeenAt] = useState<Date | null>(null);
  useEffect(() => {
    const raw = window.localStorage.getItem(SEEN_KEY);
    setSeenAt(raw ? new Date(raw) : null);
    const newest = data.groups[0]?.items[0]?.at;
    if (newest) window.localStorage.setItem(SEEN_KEY, new Date(newest).toISOString());
  }, [data]);

  const totalEvents = data.groups.reduce((n, g) => n + g.items.length, 0);
  if (data.attention.length === 0 && totalEvents === 0) {
    return <p className="feed-empty">Nothing new — you&rsquo;re all caught up.</p>;
  }

  const newCount = countNewSince(data, seenAt);
  let idx = 0;

  return (
    <div className="feed">
      {data.attention.length > 0 && <AttentionStrip sources={data.attention} />}
      {data.groups.map((g) => (
        <section key={g.key} className="feed-day">
          <h2 className="feed-day__label">{g.label}</h2>
          <ul className="feed-day__list">
            {g.items.map((ev) => {
              const showDivider = newCount > 0 && idx === newCount;
              idx += 1;
              return (
                <Fragment key={`${ev.chapterUrl}:${ev.kind}`}>
                  {showDivider && (
                    <li className="feed-divider" aria-hidden="true">
                      Seen before this
                    </li>
                  )}
                  <EventRow ev={ev} now={now} />
                </Fragment>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create the shelf route → `src/app/(app)/shelf/page.tsx`**

```tsx
import { listSeries } from '../../../server/services';
import { Shelf } from '../Shelf';
import { ThemeScene } from '../ThemeScene';
import { EmptyHero } from '../EmptyHero';

export const dynamic = 'force-dynamic';

export default async function ShelfPage() {
  const series = await listSeries();
  if (series.length === 0) return <EmptyHero />;
  return (
    <>
      <ThemeScene variant="appwide" />
      <Shelf rows={series} now={new Date()} />
    </>
  );
}
```

- [ ] **Step 6: Rewrite `/` as the feed → `src/app/(app)/page.tsx`**

```tsx
import { listSeries, getFeed } from '../../server/services';
import { Feed } from './Feed';
import { ViewTabs } from './ViewTabs';
import { ThemeScene } from './ThemeScene';
import { EmptyHero } from './EmptyHero';

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const series = await listSeries();
  if (series.length === 0) return <EmptyHero />;

  const now = new Date();
  const feed = await getFeed(now);
  return (
    <>
      <ThemeScene variant="appwide" />
      <section className="stream">
        <div className="stream__head">
          <ViewTabs active="feed" />
          <div className="stream__headline">
            <h1 className="stream__title">What&rsquo;s new</h1>
          </div>
        </div>
        <Feed data={feed} now={now} />
      </section>
    </>
  );
}
```

- [ ] **Step 7: Style the feed + tabs — append to `src/app/globals.css`**

Append (near the shelf styles, after the `.card` block):

```css
/* ── WP-28c: view tabs (feed ↔ shelf) ── */
.viewtabs {
  display: flex;
  gap: 0.4rem;
  border-bottom: 1px solid var(--color-line);
}
.viewtabs__tab {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  letter-spacing: 0.02em;
  color: var(--color-muted);
  text-decoration: none;
  padding: 0.5rem 0.2rem;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
}
.viewtabs__tab.is-active {
  color: var(--color-paper);
  border-bottom-color: var(--color-glow);
}

/* ── WP-28c: feed (digest) ── */
.feed {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
}
.feed-empty,
.feed-day__label {
  color: var(--color-muted);
}
.feed-empty {
  font-size: 0.9rem;
  padding: 2rem 0;
  text-align: center;
}
.feed-day__label {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  margin: 0 0 0.5rem;
}
.feed-day__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.feed-row {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.6rem 0.85rem;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 10px;
}
.feed-row--read {
  opacity: 0.55;
}
.feed-row__main {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  text-decoration: none;
  color: var(--color-paper);
  min-width: 0;
}
.feed-row__tag {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-on-glow);
  background: var(--color-glow);
  border-radius: 999px;
  padding: 0.08rem 0.4rem;
  flex: none;
}
.feed-row__num {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--color-glow);
  flex: none;
}
.feed-row__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feed-row__check {
  color: var(--color-muted);
  flex: none;
}
.feed-row__meta {
  display: flex;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-muted);
}
.feed-row__series {
  color: var(--color-muted);
  text-decoration: none;
}
.feed-row__series:hover {
  color: var(--color-paper);
}
.feed-divider {
  list-style: none;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  border-top: 1px dashed var(--color-line);
  padding-top: 0.5rem;
  margin-top: 0.2rem;
}
.feed-attention {
  border: 1px solid var(--color-down);
  border-radius: 10px;
  padding: 0.6rem 0.85rem;
  background: color-mix(in oklab, var(--color-down) 10%, var(--color-surface));
}
.feed-attention__head {
  font: inherit;
  font-size: 0.85rem;
  color: var(--color-paper);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.feed-attention__list {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.82rem;
}
```

- [ ] **Step 8: Verify + commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: unit PASS, no type errors, build succeeds (routes `/` and `/shelf` compile).
Manual sanity (optional): `npm run dev`, confirm `/` shows the feed and the Shelf tab reaches `/shelf`. (Existing E2E specs that assume `/` is the shelf will now fail — Task 7 repoints them.)

```bash
git add "src/app/(app)/EmptyHero.tsx" "src/app/(app)/ViewTabs.tsx" "src/app/(app)/Feed.tsx" "src/app/(app)/shelf/page.tsx" "src/app/(app)/page.tsx" src/app/globals.css
git commit -m "feat(WP-28c): feed digest at /, shelf at /shelf, shared view tabs"
```

---

### Task 5: Shelf card simplification + "Recently added" option + post-add highlight

Drops the latest-chapter line and relative time, shows the chapter count, hides the unread badge/ribbon on non-READING series, exposes the `'added'` sort, and highlights the `?added=<id>` card.

**Files:**
- Modify: `src/app/(app)/Shelf.tsx`
- Modify: `src/app/globals.css` (card `.card__count`, theme repoints, highlight animation)

**Interfaces:**
- Consumes: `useSearchParams` (next/navigation); `ShelfSort` `'added'` (Task 1).

- [ ] **Step 1: Simplify `SeriesCard` in `src/app/(app)/Shelf.tsx`**

Replace the `SeriesCard` component's body/meta with the chapter-count line, status-gated unread, a stable id, and a highlight flag. Change the signature to accept `highlight`:

```tsx
function SeriesCard({ series, now, highlight }: { series: SeriesRow; now: Date; highlight: boolean }) {
  const { unread } = series;
  const showUnread = series.status === 'READING' && unread > 0;
  const count = series.chapterCount;
  return (
    <div className={`card-wrap${highlight ? ' card-wrap--added' : ''}`} id={`series-${series.id}`}>
      <Link href={`/series/${series.id}`} className="card">
        <span className="roll roll--l" aria-hidden="true" />
        <span className="roll roll--r" aria-hidden="true" />
        {showUnread && <span className="card__ribbon" aria-hidden="true" />}
        <div className="card__body">
          <div className="card__top">
            <h2 className="card__title">{series.title}</h2>
            {showUnread && <WaxBadge count={unread} />}
          </div>
          <p className="card__count">{count > 0 ? `${count} chapter${count === 1 ? '' : 's'}` : 'No chapters yet'}</p>
          <div className="card__meta">
            {series.status !== 'READING' && <span className="status-chip">{series.status}</span>}
            {series.activeSource?.linkOnly && <span className="status-chip">link-only</span>}
            {series.activeSource && (
              <>
                {!series.activeSource.linkOnly && (
                  <span className={`health-dot health-dot--${series.activeSource.health}`} title={series.activeSource.health} />
                )}
                <span>{series.activeSource.host}</span>
              </>
            )}
          </div>
        </div>
      </Link>
      <div className="hud" aria-hidden="true">
        <span className="accent" />
        <span className="br br--tl" />
        <span className="br br--br" />
        <span className="chev">//</span>
        <span className="hatch" />
        <span className="flare" />
      </div>
      <DeleteSeriesButton id={series.id} title={series.title} chapterCount={series.chapterCount} />
    </div>
  );
}
```

Remove the now-unused `relativeTime` import at the top of the file (the card no longer renders a time).

- [ ] **Step 2: Add the `'added'` sort option + highlight wiring in the `Shelf` component**

Update the imports at the top to add `useSearchParams`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
```

Extend the `isSort` guard and `SORT_OPTIONS`:

```ts
const SORT_OPTIONS: { value: ShelfSort; label: string }[] = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'added', label: 'Recently added' },
  { value: 'unread', label: 'Unread first' },
  { value: 'title', label: 'A–Z' },
  { value: 'rating', label: 'Rating' },
];
```

```ts
function isSort(v: string | null): v is ShelfSort {
  return v === 'recent' || v === 'unread' || v === 'title' || v === 'rating' || v === 'added';
}
```

Inside `Shelf(...)`, read the `?added` param and scroll/highlight after render:

```tsx
  const params = useSearchParams();
  const addedId = params.get('added');
  useEffect(() => {
    if (!addedId) return;
    const el = document.getElementById(`series-${addedId}`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [addedId, visible]);
```

(Place this after `visible` is computed so it re-runs once the filtered list is on screen.)

Pass the flag when mapping cards:

```tsx
          {visible.map((s) => (
            <SeriesCard key={s.id} series={s} now={now} highlight={s.id === addedId} />
          ))}
```

- [ ] **Step 3: Card CSS — append/repoint in `src/app/globals.css`**

Remove the base `.card__latest` and `.card__latest b` rules (lines ~918–929) and add a `.card__count` rule in their place:

```css
.card__count {
  color: var(--color-muted);
  font-size: 0.9rem;
  margin: 0.35rem 0 0;
}
```

Repoint the theme-scoped rules so the count line stays themed. In the **scroll** block, replace the `.card__latest` rules (lines ~1261–1267) with:

```css
:root[data-theme="scroll"] .card__count {
  color: #5c5140;
}
```

In the **sci-fi** block, replace the `.card__latest` rules (lines ~1310–1316) with:

```css
:root[data-theme="sci-fi"] .card__count {
  color: #a7c4d6;
}
```

Append the post-add highlight animation (reduced-motion-gated, matching the repo's motion conventions):

```css
@keyframes cardAddedPulse {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  30% { box-shadow: 0 0 0 3px var(--color-glow); }
}
.card-wrap--added .card {
  border-color: var(--color-glow);
}
@media (prefers-reduced-motion: no-preference) {
  .card-wrap--added .card {
    animation: cardAddedPulse 1.6s ease-out 2;
  }
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. Manual (optional): `npm run dev`, visit `/shelf` — cards show a chapter count (no latest-chapter line / no time); a non-READING series shows no unread badge; `/shelf?added=<an-id>` scrolls to and rings that card.

```bash
git add "src/app/(app)/Shelf.tsx" src/app/globals.css
git commit -m "feat(WP-28c): simplify shelf card, add 'Recently added' sort + post-add highlight"
```

---

### Task 6: Add-flow lands on `/shelf?added=<id>`

Redirect successful adds to the shelf with the new series highlighted, on all three success paths.

**Files:**
- Modify: `src/app/(app)/add/page.tsx`

- [ ] **Step 1: Add `seriesId` to the response type**

In `AddSeriesResponse`, add `seriesId` to the non-confirm variant (the API returns it on 201 and on the `alreadyExisting` 200):

```ts
type AddSeriesResponse =
  | { needsConfirm: true; reason: 'blocked' | 'no-chapters'; suggestedTitle: string; url: string }
  | { needsConfirm?: false; seriesId?: string; title?: string; similarTo?: { id: string; title: string } };
```

- [ ] **Step 2: Redirect the plain-add + similar paths to the shelf**

In `onSubmit`, capture the id in the similar-state and redirect to the shelf on plain success. Replace the `similarTo` block and the final `router.push('/')`:

```tsx
    if (data.similarTo) {
      // Non-blocking: the series WAS added; flag a possible duplicate but still let them jump to it.
      setSimilar({ addedId: data.seriesId, addedTitle: data.title ?? 'the series', existing: data.similarTo });
      setBusy(false);
      return;
    }
    router.push(data.seriesId ? `/shelf?added=${data.seriesId}` : '/shelf');
    router.refresh();
```

Update the `similar` state type to carry the id:

```tsx
  const [similar, setSimilar] = useState<{
    addedId?: string;
    addedTitle: string;
    existing: { id: string; title: string };
  } | null>(null);
```

In the similar notice JSX, point "Keep both, go to library" at the shelf, highlighting the newly added series:

```tsx
            <Link href={similar.addedId ? `/shelf?added=${similar.addedId}` : '/shelf'} className="btn btn--primary" onClick={() => router.refresh()}>
              Keep both, go to library
            </Link>
```

- [ ] **Step 3: Redirect the link-only path too**

In `addLinkOnly`, replace the `router.push('/')` success branch:

```tsx
    if (result.ok) {
      const sid = result.data.needsConfirm ? undefined : result.data.seriesId;
      router.push(sid ? `/shelf?added=${sid}` : '/shelf');
      router.refresh();
      return;
    }
```

(Also change the form's "Cancel" `<Link href="/">` and the confirm-panel context copy only if desired — not required; leaving Cancel at `/` returns to the feed, which is fine.)

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm run build`
Expected: PASS.

```bash
git add "src/app/(app)/add/page.tsx"
git commit -m "feat(WP-28c): land adds on /shelf with the new series highlighted"
```

---

### Task 7: E2E — repoint shelf specs to `/shelf` + cover the feed

Existing specs assume `/` is the shelf; repoint them. Add feed coverage.

**Files:**
- Modify: `e2e/shelf.spec.ts`, `e2e/controls.spec.ts`, `e2e/delete.spec.ts`, `e2e/theme-scenes.spec.ts`, `e2e/theme-scenes-screens.spec.ts`, `e2e/theme-screens.spec.ts`, `e2e/smoke.spec.ts` (any that `page.goto('/')` and assert shelf/card content)
- Create: `e2e/feed.spec.ts`

- [ ] **Step 1: Repoint shelf-dependent navigations**

In each listed spec, change shelf-expecting `await page.goto('/')` to `await page.goto('/shelf')`. These are the specs that interact with `.card*`, the sort/filter controls (`getByLabel('Sort'|'Status'|'Rating'|'Search titles')`), the delete affordance, or per-card theme scenes. Leave feed-agnostic navigations alone. (`smoke.spec.ts`: repoint only the assertions that expect the shelf; if it only checks the app chrome/hero, it may not need changing.)

- [ ] **Step 2: Write the feed E2E → `e2e/feed.spec.ts`**

```ts
import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

// WP-28c — the digest at / lists readable new-chapter events across READING series,
// excludes locked chapters and non-reading series, and tabs to the shelf.
test('WP-28c: feed lists readable new chapters, excludes locked + non-reading', async ({ page }) => {
  await seedSeries({
    title: 'Reading One',
    status: 'READING',
    chapters: [
      { title: 'free-a', url: 'https://ex.test/r/1', access: 'FREE' },
      { title: 'free-b', url: 'https://ex.test/r/2', access: 'FREE' },
      { title: 'locked-c', url: 'https://ex.test/r/3', access: 'LOCKED' },
    ],
  });
  await seedSeries({
    title: 'Completed One',
    status: 'COMPLETED',
    chapters: [{ title: 'done', url: 'https://ex.test/c/1', access: 'FREE' }],
  });

  await page.goto('/');
  const titles = page.locator('.feed-row__title');
  await expect(titles).toHaveText(['free-a', 'free-b']); // no locked, no completed-series chapter

  // Row body links out to the chapter to read; the series name links to detail.
  await expect(page.locator('.feed-row__main').first()).toHaveAttribute('href', 'https://ex.test/r/1');
  await expect(page.locator('.feed-row__series').first()).toHaveText('Reading One');
});

test('WP-28c: tabs switch between the feed and the shelf', async ({ page }) => {
  await seedSeries({ title: 'Reading One', status: 'READING', chapters: [{ title: 'c', url: 'https://ex.test/r/1' }] });

  await page.goto('/');
  await expect(page.locator('.feed-row__title')).toHaveCount(1);
  await page.getByRole('link', { name: 'Shelf' }).click();
  await expect(page).toHaveURL(/\/shelf$/);
  await expect(page.locator('.card__title')).toHaveText(['Reading One']);
  await page.getByRole('link', { name: 'What’s new' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('WP-28c: shelf card shows a chapter count and hides unread on non-reading', async ({ page }) => {
  await seedSeries({
    title: 'Planned Two',
    status: 'PLANNED',
    chapters: [{ title: 'c1', url: 'https://ex.test/p/1' }, { title: 'c2', url: 'https://ex.test/p/2' }],
  });
  await page.goto('/shelf');
  await expect(page.locator('.card__count')).toHaveText('2 chapters');
  await expect(page.locator('.card__unread')).toHaveCount(0); // non-READING → no unread badge
  await expect(page.locator('.card__latest')).toHaveCount(0); // latest-chapter line removed
});

test('WP-28c: ?added highlights the target shelf card', async ({ page }) => {
  const { id } = await seedSeries({ title: 'Fresh Add', status: 'READING', chapters: [{ title: 'c', url: 'https://ex.test/f/1' }] });
  await page.goto(`/shelf?added=${id}`);
  await expect(page.locator(`#series-${id}`)).toHaveClass(/card-wrap--added/);
});
```

- [ ] **Step 3: Run the E2E suite**

Run: `npm run test:e2e` (needs the e2e Postgres — `DATABASE_URL` must contain `e2e`/`test`; see `e2e/support/db.ts`).
Expected: PASS. Fix any remaining spec that broke because `/` is now the feed (repoint to `/shelf`). Rerun until green.

- [ ] **Step 4: Commit**

```bash
git add e2e/
git commit -m "test(WP-28c): feed E2E + repoint shelf specs to /shelf"
```

---

### Task 8: Housekeeping — flip WP-28c, changelog, archive, set NEXT

**Files:**
- Modify: `PLAN.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/PLAN-archive.md`

- [ ] **Step 1: Flip the WP-28c row + set the next NEXT**

In `PLAN.md`'s ▶ Active queue table, change the WP-28c row's status `NEXT` → `DONE`, and change the WP-28e row's status `TODO` → `NEXT` (the next in row order). Update the "Current focus" `NEXT:` sentence to point at WP-28e.

- [ ] **Step 2: Add the changelog line**

Prepend to `docs/CHANGELOG.md` (newest first), anonymised:

```md
- **WP-28c — Feed (digest) home + shelf tab.** `/` is now a cross-series digest of readable new-chapter + now-free
  events across READING series (newest-first, day-grouped; known-locked new chapters excluded, mirroring the push
  filter), with a consolidated source-down "needs attention" strip and a per-device "seen" divider; already-read rows
  are dimmed. The per-series shelf moved to `/shelf` behind a view-tab control. Derived on read — no schema change.
  Shelf card simplified: chapter count replaces the latest-chapter line + relative time; unread badge hidden on
  non-READING series. Adds now land on `/shelf` with the new series highlighted, and a "Recently added" sort was added.
  Filed WP-TAGS (series genre tags — UI only; the `tags` column already exists).
```

- [ ] **Step 3: Archive the WP-28c detail section**

Move the `### WP-28c — Feed page vs library split` detail block out of `PLAN.md` into `docs/PLAN-archive.md`, leaving only the ✅ Completed-table one-liner. Add a WP-28c entry to the ✅ Completed prose list in `PLAN.md` (next to the other WP-28 children).

- [ ] **Step 4: Verify + commit**

Run: `npm test && npm run typecheck`
Expected: PASS (docs-only; sanity that nothing regressed).

```bash
git add PLAN.md docs/CHANGELOG.md docs/PLAN-archive.md
git commit -m "docs(WP-28c): mark DONE, changelog, archive detail, set WP-28e NEXT"
```

- [ ] **Step 5: Stop at the WP boundary**

WP-28c is complete. **Do not** start WP-28e — check in with the owner first (open a PR for this branch if that's the owner's flow).

---

## Self-Review

**Spec coverage:**
- IA / routing (feed at `/`, shelf at `/shelf`, `ViewTabs` in pages) → Task 4. ✓
- Derived feed core (buildFeed, ordering, day-grouping, seen-count) → Task 2. ✓
- `getFeed` service (READING-only, locked-excluded, window/cap, down sources, read flag) → Task 3. ✓
- Feed UI (attention strip, rows read-now/series-secondary, seen divider, read dimming, empty states) → Task 4. ✓
- Locked new chapters excluded → Task 3 (query filter) + Task 2 (kinds are only the two). ✓
- Shelf simplification (drop latest line + time, chapter count, hide unread on non-READING) → Task 5. ✓
- Post-add: redirect to `/shelf?added=` + highlight (Task 5 + Task 6) and "Recently added" sort (Task 1 + Task 5). ✓
- Tags filed as WP-TAGS (UI-only) → done in the design commit already on the branch; referenced, not rebuilt here. ✓
- Testing (unit buildFeed + shelf sort; integration getFeed; E2E feed + repoint) → Tasks 1–3, 7. ✓
- Housekeeping → Task 8. ✓
- Deferred (likely-available, paying-subscriber, materialized log) → correctly NOT in any task. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step carries real code. ✓

**Type consistency:** `ShelfSort`/`ShelfSeries.createdAt` (Task 1) consumed by Task 5's `SORT_OPTIONS`/`isSort`. `Feed`/`FeedEvent`/`DownSource`/`buildFeed`/`countNewSince` (Task 2) consumed by `getFeed` (Task 3) and `Feed.tsx` (Task 4). `getFeed` signature `(now?: Date)` matches its call in `page.tsx`. `AddSeriesResponse.seriesId` (Task 6) matches the API's `seriesId` (verified in `api/series/route.ts`). ✓
