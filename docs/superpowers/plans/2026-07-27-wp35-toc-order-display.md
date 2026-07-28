# WP-35 — TOC-order chapters + display toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order chapters by the site's own TOC sequence (a persisted `position`) instead of inferring it from numbers/titles, and let the detail page display that sequence oldest-first / newest-first / unread-first — with reading-progress anchored to the canonical position.

**Architecture:** (A) additive migration `Chapter.position Int?`; a pure `tocReadingOrder` (direction-normalized positions from `parseToc`'s DOM order) assigns `position` at add-time and on backfill; `orderChaptersForReading` becomes **position-aware** (position first, the existing number/Extra-Side comparator as the null-position fallback — so pure-feed series are unchanged). (B) a pure `arrangeChapters` (three display modes + read-flags-by-canonical-position) drives a detail-page toggle persisted in localStorage. Polls don't touch position (new chapters are null → sort last = newest); a re-backfill re-indexes.

**Tech Stack:** TypeScript (strict), Vitest (unit + integration), Prisma/Postgres, `cheerio`, Next App Router (client component).

## Global Constraints

- **`src/lib/**` stays pure** — no `next`/`prisma`/`fs`/network imports. `pageWatch.ts`, `reading.ts`, `diff.ts` are `lib/`.
- **TDD** — a failing test first for all pure logic + services; watched fail for the right reason.
- **Verify before done** — `npm test` + `npm run typecheck` (fresh) before any "done"/commit. Integration:
  `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration`.
- **Identity = canonical URL** — reuse the exported `canonicalUrl` from `src/lib/feeds/diff.ts`.
- **Direction is detected from the chapter-number *trend*, not per-chapter sorting** — ascending vs descending TOC; if the signal is too weak (`< 3` numbered chapters or no clear ≥70% majority), `tocReadingOrder` returns `null` and positioning is **skipped** (comparator fallback). Constants: `MIN_NUMBERED = 3`, `DIRECTION_MAJORITY = 0.7` (named, tunable).
- **Reading-progress model is unchanged** — single high-water-mark pointer (`lastReadChapterId`); read = canonical position ≤ the pointer's, independent of display mode.
- **Unread-first display = `[unread ascending] ++ [read ascending]`.** Default display mode = **oldest-first**.
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit to `main`.

---

### Task 1: Migration — `Chapter.position Int?`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_chapter_position/migration.sql` (generated)

- [ ] **Step 1: Add the column**

In `prisma/schema.prisma`, add to `model Chapter` (near `access`/`becameFreeAt`):

```prisma
  position     Int?     // reading-order index from the TOC (null = not positioned → comparator fallback)
```

- [ ] **Step 2: Generate + apply the migration (dev), then the test DB**

```bash
npm run db:migrate -- --name add_chapter_position          # prisma migrate dev against webnovel_dev + regenerates client
DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npx prisma migrate deploy
```
Expected: a new nullable `position` column on `Chapter`; `npx prisma migrate status` clean against both DBs. Existing rows get `position = NULL` (safe — they fall back to the comparator).

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck` (clean — the generated Prisma client now knows `position`).

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
WP-35: add Chapter.position (additive migration)

Nullable reading-order index; null rows fall back to the number comparator.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure `tocReadingOrder` (direction-normalized positions, test-first)

**Files:**
- Modify: `src/lib/feeds/pageWatch.ts`
- Test: `tests/unit/feeds/pageWatch.test.ts`

**Interfaces:**
- Produces: `tocReadingOrder(toc: readonly { url: string; number: number | null }[]): Map<string, number> | null` — a canonical-URL → 0-based reading-order position map (oldest = 0), reversing DOM order when the TOC is newest-first; `null` when direction can't be determined.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/feeds/pageWatch.test.ts`)

```ts
describe('tocReadingOrder', () => {
  const c = (url: string, number: number | null) => ({ url, number });

  test('ascending TOC (ch1,ch2,ch3 in DOM order) → positions 0,1,2', () => {
    const m = tocReadingOrder([c('https://x/1', 1), c('https://x/2', 2), c('https://x/3', 3)]);
    expect(m).not.toBeNull();
    expect(m!.get('https://x/1')).toBe(0);
    expect(m!.get('https://x/3')).toBe(2);
  });

  test('descending TOC (newest-first) is normalized so the oldest gets position 0', () => {
    const m = tocReadingOrder([c('https://x/3', 3), c('https://x/2', 2), c('https://x/1', 1)]);
    expect(m!.get('https://x/1')).toBe(0);
    expect(m!.get('https://x/3')).toBe(2);
  });

  test('canonical-URL keys (tracking/slash ignored)', () => {
    const m = tocReadingOrder([c('https://x/1/?utm_source=rss', 1), c('https://x/2', 2), c('https://x/3', 3)]);
    expect(m!.get('https://x/1')).toBe(0);
  });

  test('too few numbered chapters → null (skip positioning)', () => {
    expect(tocReadingOrder([c('https://x/a', null), c('https://x/b', 1)])).toBeNull();
  });

  test('ambiguous number trend → null', () => {
    const m = tocReadingOrder([c('https://x/a', 1), c('https://x/b', 5), c('https://x/c', 2), c('https://x/d', 4), c('https://x/e', 3)]);
    expect(m).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run tests/unit/feeds/pageWatch.test.ts` — `tocReadingOrder` not exported).

- [ ] **Step 3: Implement in `pageWatch.ts`** (import `canonicalUrl` is already present from WP-36/33):

```ts
const MIN_NUMBERED = 3;
const DIRECTION_MAJORITY = 0.7;

/** Map each TOC chapter's canonical URL to a 0-based reading-order position (oldest = 0), inferring the
 *  TOC's direction from the chapter-number trend and reversing when it lists newest-first. Returns null
 *  when the numeric signal is too weak to trust (→ caller skips positioning). Pure. */
export function tocReadingOrder(toc: readonly { url: string; number: number | null }[]): Map<string, number> | null {
  const nums = toc.map((c) => c.number).filter((n): n is number => n != null);
  if (nums.length < MIN_NUMBERED) return null;
  let up = 0;
  let down = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i]! > nums[i - 1]!) up++;
    else if (nums[i]! < nums[i - 1]!) down++;
  }
  const total = up + down;
  if (total === 0) return null;
  const ascending = up / total >= DIRECTION_MAJORITY ? true : down / total >= DIRECTION_MAJORITY ? false : null;
  if (ascending === null) return null;

  const map = new Map<string, number>();
  const n = toc.length;
  toc.forEach((chapter, i) => map.set(canonicalUrl(chapter.url), ascending ? i : n - 1 - i));
  return map;
}
```

- [ ] **Step 4: Run → green; typecheck; commit**

```bash
git add src/lib/feeds/pageWatch.ts tests/unit/feeds/pageWatch.test.ts
git commit -m "$(cat <<'EOF'
WP-35: tocReadingOrder — direction-normalized reading positions from a TOC

Infers ascending/descending from the chapter-number trend (skips when weak)
and maps each chapter's canonical URL to a 0-based oldest-first position.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Position-aware ordering (`orderChaptersForReading`) + `FeedItem.position` (pure, test-first)

**Files:**
- Modify: `src/lib/reading.ts`, `src/lib/feeds/diff.ts`
- Test: `tests/unit/reading.test.ts`

**Interfaces:**
- `FeedItem` gains `position?: number | null`.
- `OrderableChapter` gains `position: number | null`; `orderChaptersForReading` sorts by `position` ascending (nulls last), then the existing bucket/number comparator for equal-or-null positions.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/reading.test.ts`, reusing its `ch` helper — extend it to accept `position`)

```ts
describe('orderChaptersForReading — position-aware (WP-35)', () => {
  const ch = (over: Partial<{ id: string; number: number | null; title: string; position: number | null; publishedAt: Date | null; discoveredAt: Date }>) => ({
    id: 'x', number: null, title: 't', position: null, publishedAt: null, discoveredAt: new Date('2026-01-01T00:00:00Z'), ...over,
  });

  test('positioned chapters sort by position (overriding the number comparator)', () => {
    const out = orderChaptersForReading([ch({ id: 'b', position: 1, number: 99 }), ch({ id: 'a', position: 0, number: 1 })]);
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
  });

  test('null-position chapters sort AFTER positioned ones, by the number comparator among themselves', () => {
    const out = orderChaptersForReading([
      ch({ id: 'new2', position: null, number: 6 }),
      ch({ id: 'p0', position: 0, number: 1 }),
      ch({ id: 'new1', position: null, number: 5 }),
    ]);
    expect(out.map((c) => c.id)).toEqual(['p0', 'new1', 'new2']); // positioned first, then nulls by number
  });

  test('all-null (pure-feed) falls back to the existing comparator behavior', () => {
    const out = orderChaptersForReading([ch({ id: '2', number: 2 }), ch({ id: '1', number: 1 })]);
    expect(out.map((c) => c.id)).toEqual(['1', '2']);
  });
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run tests/unit/reading.test.ts` — `position` unknown on the sort input).

- [ ] **Step 3: Implement**

In `src/lib/feeds/diff.ts`, add to `FeedItem`:
```ts
  /** Reading-order index from the TOC (WP-35), when known. */
  position?: number | null;
```

In `src/lib/reading.ts`: add `position: number | null` to `OrderableChapter`, and make position the primary key in `orderChaptersForReading` (before the bucket logic):

```ts
export function orderChaptersForReading<T extends OrderableChapter>(chapters: readonly T[]): T[] {
  return [...chapters].sort((a, b) => {
    // Position (the site's own TOC order) wins when known; nulls sort last and fall to the comparator.
    if (a.position != null && b.position != null && a.position !== b.position) return a.position - b.position;
    if (a.position == null && b.position != null) return 1;
    if (a.position != null && b.position == null) return -1;
    const ba = readingBucket(a);
    const bb = readingBucket(b);
    if (ba !== bb) return ba - bb;
    // …existing number / publishedAt / discoveredAt / id tiebreak, unchanged…
  });
}
```
(Keep the rest of the comparator body exactly as-is below the new position block.)

- [ ] **Step 4: Run → green; typecheck; commit**

```bash
git add src/lib/reading.ts src/lib/feeds/diff.ts tests/unit/reading.test.ts
git commit -m "$(cat <<'EOF'
WP-35: position-aware orderChaptersForReading + FeedItem.position

Chapter position (TOC order) is the primary sort key; null-position chapters
sort last via the existing number/Extra-Side comparator (pure-feed unchanged).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Persist positions at add + backfill; select them for ordering (integration)

**Files:**
- Modify: `src/server/services/addSeries.ts`, `src/lib/feeds/pageWatch.ts` (a small `withReadingPositions` helper), `src/server/services/index.ts` (createSeries + backfillFromToc), `src/server/services/series.ts` (selects)
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- `withReadingPositions(chapters: FeedItem[], toc: readonly {url; number}[]): FeedItem[]` (pure, in `pageWatch.ts`) — sets `position` on each chapter from `tocReadingOrder(toc)` (unchanged when it returns null).

- [ ] **Step 1: Write the failing integration tests** (append to `tests/integration/services.test.ts`)

```ts
// at-add: a page-watch series (or feed-with-TOC) seeds chapters with positions in TOC reading order.
test('WP-35: add seeds chapter positions from the TOC order', async () => {
  const WATCH = 'https://reader.example/series/omega/';
  const rows = ['chapter-1', 'chapter-2', 'chapter-3'].map((s) => `<li><a href="${WATCH}${s}/">${s}</a></li>`).join('');
  const { seriesId } = await addSeries({ url: WATCH }, fetchFrom({ [WATCH]: okRes(`<html><body><ul>${rows}</ul></body></html>`) }));
  const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
  expect(chapters.find((c) => c.url.endsWith('chapter-1/'))!.position).toBe(0);
  expect(chapters.find((c) => c.url.endsWith('chapter-3/'))!.position).toBe(2);
});

// getSeries returns chapters in position order (not number/date), for a positioned series.
test('WP-35: getSeries orders by position', async () => {
  // (build a series whose position order differs from number order to prove position wins — e.g. via backfill of a
  //  descending TOC, or direct db inserts with positions; assert getSeries(...).chapters id order matches position.)
});

// backfillFromToc re-indexes positions of existing chapters + sets them on the newly-added tail.
test('WP-35: backfill assigns/re-indexes positions from the TOC', async () => {
  // seed a feed series (positions null), point source.url at a TOC listing the full history, backfill,
  // assert the chapters now have contiguous positions matching the TOC order.
});
```
Write concrete assertions (fill the two sketched cases against the module's helpers; use direct `db` inserts where a precise setup is easier than driving a fetch).

- [ ] **Step 2: Run → fail**, then implement:

1. **`withReadingPositions` in `pageWatch.ts`:**

```ts
import { canonicalUrl, type FeedItem } from './diff';
export function withReadingPositions(chapters: FeedItem[], toc: readonly { url: string; number: number | null }[]): FeedItem[] {
  const order = tocReadingOrder(toc);
  if (!order) return chapters;
  return chapters.map((c) => ({ ...c, position: order.get(canonicalUrl(c.url)) ?? null }));
}
```

2. **`addSeries.ts`** — apply positions in BOTH branches (the TOC is already parsed in each):
   - FEED branch: keep the `toc` from `parseToc(page.body, url)` in a local, then
     `const chapters = pageOk ? withReadingPositions(mergeFeedAndToc(feedChapters, toc), toc) : feedChapters;`
   - PAGE_WATCH branch: `const toc = parseToc(page.body, url); ... chapters: withReadingPositions(toc, toc)`.
   Add `withReadingPositions` to the existing `pageWatch` import.

3. **`index.ts` createSeries** — persist position: add `position: c.position ?? null` to the `chapters.create` map.

4. **`index.ts` backfillFromToc** — after `const toc = parseToc(...)`, compute `const order = tocReadingOrder(toc)`; add `position: order?.get(canonicalUrl(c.url)) ?? null` to the `createMany` data; and add position re-index updates for existing stored chapters in the TOC:
   ```ts
   ...(order
     ? stored.flatMap((s) => {
         const pos = order.get(canonicalUrl(s.url));
         return pos != null ? [db.chapter.updateMany({ where: { id: s.id }, data: { position: pos } })] : [];
       })
     : []),
   ```
   (Import `tocReadingOrder`/`canonicalUrl` in `index.ts` as needed.)

5. **`series.ts`** — add `position: true` to the `listSeries` chapter `select`; `getSeries` uses `include` (full rows) so it already has `position`. Confirm `orderChaptersForReading` receives `position` in both.

- [ ] **Step 3: Run → green (integration), `npm test` + `npm run typecheck` clean.**

- [ ] **Step 4: Commit**

```bash
git add src/lib/feeds/pageWatch.ts src/server/services/addSeries.ts src/server/services/index.ts src/server/services/series.ts tests/integration/services.test.ts
git commit -m "$(cat <<'EOF'
WP-35: assign chapter positions at add + backfill; order by them

withReadingPositions stamps TOC reading-order positions on seeded chapters;
backfill re-indexes existing chapters + positions the new tail. listSeries/
getSeries now order by position (comparator fallback for null positions).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend — `arrangeChapters` + detail-page display toggle

**Files:**
- Modify: `src/lib/reading.ts` (pure `arrangeChapters`), `src/app/(app)/series/[id]/SeriesDetail.tsx`, `src/app/globals.css` (toggle styling)
- Test: `tests/unit/reading.test.ts`

**Interfaces:**
- `arrangeChapters<T extends { id: string }>(canonical: readonly T[], lastReadId: string | null, mode: 'oldest' | 'newest' | 'unread'): (T & { read: boolean })[]` — computes `read` by canonical index vs the last-read pointer, then reorders for display.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/reading.test.ts`)

```ts
describe('arrangeChapters', () => {
  const cs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]; // canonical oldest→newest
  test('oldest: identity order, read = up to and including the pointer', () => {
    const out = arrangeChapters(cs, 'b', 'oldest');
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out.map((c) => c.read)).toEqual([true, true, false, false]);
  });
  test('newest: reversed, read flags follow the same chapters', () => {
    const out = arrangeChapters(cs, 'b', 'newest');
    expect(out.map((c) => c.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(out.find((c) => c.id === 'a')!.read).toBe(true);
    expect(out.find((c) => c.id === 'c')!.read).toBe(false);
  });
  test('unread: [unread asc] then [read asc]', () => {
    const out = arrangeChapters(cs, 'b', 'unread');
    expect(out.map((c) => c.id)).toEqual(['c', 'd', 'a', 'b']);
  });
  test('no/stale pointer → everything unread', () => {
    expect(arrangeChapters(cs, null, 'oldest').every((c) => !c.read)).toBe(true);
    expect(arrangeChapters(cs, 'zzz', 'oldest').every((c) => !c.read)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail**, then implement `arrangeChapters` in `src/lib/reading.ts`:

```ts
export type ChapterDisplayMode = 'oldest' | 'newest' | 'unread';

/** Compute read-state by canonical position (the pointer's index), then reorder for display. Pure. */
export function arrangeChapters<T extends { id: string }>(
  canonical: readonly T[],
  lastReadId: string | null,
  mode: ChapterDisplayMode,
): (T & { read: boolean })[] {
  const lastIdx = lastReadId ? canonical.findIndex((c) => c.id === lastReadId) : -1;
  const flagged = canonical.map((c, i) => ({ ...c, read: lastIdx >= 0 && i <= lastIdx }));
  if (mode === 'newest') return [...flagged].reverse();
  if (mode === 'unread') return [...flagged.filter((c) => !c.read), ...flagged.filter((c) => c.read)];
  return flagged;
}
```

- [ ] **Step 3: Wire the toggle into `SeriesDetail.tsx`**

- Add a `mode` state initialized from `localStorage` (`useEffect` on mount reads `localStorage.getItem('chapterDisplayMode')`, default `'oldest'`; a setter persists it). SSR-safe: initialize to `'oldest'` and read localStorage in an effect so first render matches the server.
- Replace the current index-based render (`lastReadIdx` / `i <= lastReadIdx`) with `arrangeChapters(props.chapters, lastRead, mode)` and render each row using its `read` flag.
- Add a 3-button segmented control (Oldest / Newest / Unread-first) in `detail__controls`, matching existing control styling (add a small rule to `globals.css` if needed, in the existing token style). Keep it accessible (real `<button>`s, `aria-pressed`).
- `props.chapters` already arrive in canonical (position) order from `getSeries` (Task 4) — no new prop needed.

Manually verify against a seeded local series: the three modes reorder, read markers stay on the correct chapters across modes, and the choice persists across reloads (localStorage). Run `npm run typecheck` + `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/reading.ts "src/app/(app)/series/[id]/SeriesDetail.tsx" src/app/globals.css tests/unit/reading.test.ts
git commit -m "$(cat <<'EOF'
WP-35: chapter display toggle (oldest/newest/unread-first) + canonical read-state

arrangeChapters computes read-state by canonical position then reorders for
display; SeriesDetail gets a persisted 3-mode toggle, retiring the index-based
read logic.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Close out PLAN.md

- [ ] Flip **WP-35** `TODO → DONE`; update Current-focus/`NEXT`; add a Changelog entry (position from TOC + direction-normalize; comparator kept as null-position fallback; polls leave new chapters null → sort last; 3-mode display toggle with canonical read-state; additive migration). Commit:

```bash
git add PLAN.md
git commit -m "$(cat <<'EOF'
plan: WP-35 DONE — TOC-order chapters + display toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** (against `2026-07-27-wp35-toc-order-display-design.md`):
- Migration `Chapter.position` → Task 1. ✓
- Capture from `parseToc` DOM order + direction-normalize + skip-if-ambiguous → Task 2 (`tocReadingOrder`) + Task 4 (wiring at add/backfill). ✓
- Comparator kept as fallback (null position) → Task 3. ✓
- Order source position-then-comparator in getSeries/listSeries → Task 3 + Task 4. ✓
- Read-state anchored to canonical position (retire array-index) → Task 5 (`arrangeChapters`). ✓
- 3 display modes, default oldest, unread-first = `[unread asc]++[read asc]` → Task 5. ✓
- Preference global/localStorage/per-device → Task 5. ✓
- **Deviation from spec (deliberate, performance):** the spec said "re-index every full read (page-watch poll)"; this plan re-indexes on **backfill + at-add** only, and leaves poll-discovered new chapters `position = null` (they sort last via nulls-last = newest, correct for append-only TOCs). A site that *re-sorts* its TOC won't auto-heal on poll — a re-backfill re-indexes. This avoids rewriting every chapter's position on every cron poll. Flagged here for the reviewer/owner; matches the spec's user-visible intent (chapters in TOC order) without the write cost.

**Placeholder scan:** Task 4 Step 1 sketches two integration cases in prose (getSeries-orders-by-position; backfill-re-indexes) with the concrete one written — the implementer fills them against the module helpers; flagged, not silent. Task 5's toggle UI is described against the existing `SeriesDetail`/control pattern rather than pinned line-by-line (frontend). All pure logic (Tasks 2, 3, 5 `arrangeChapters`) is concrete.

**Type consistency:** `position?: number | null` on `FeedItem` (Task 3) flows through `withReadingPositions` (Task 4) → createSeries persist (Task 4). `OrderableChapter.position` (Task 3) is fed by the `listSeries` select + `getSeries` include (Task 4). `tocReadingOrder` (Task 2) returns `Map<string, number> | null`, consumed by `withReadingPositions` + backfill (Task 4). `arrangeChapters` mode type (`'oldest'|'newest'|'unread'`, Task 5) matches the localStorage key + toggle.
