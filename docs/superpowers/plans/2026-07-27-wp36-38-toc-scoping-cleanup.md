# WP-36 + WP-38 — TOC content scoping + contaminated-series recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `parseToc` from ingesting cross-series sidebar links (WP-36), then give the owner a dry-run-default maintenance path to clean up the already-contaminated production data (WP-38).

**Architecture:** WP-36 is a pure change to `parseToc` (chrome-filter with empty-fallback + optional per-site refinements). WP-38 puts the recovery operations in a tested `cleanup` **service** (prune / delete / reset / set-source-url / merge) with a thin dry-run CLI over it (so a future detail-page UI reuses the same service). One pure helper (chapter-union by canonical URL) is test-first.

**Tech Stack:** TypeScript (strict), Vitest (unit + integration), Prisma/Postgres, `cheerio`, `tsx` (new devDep, to run the TS maintenance script).

## Global Constraints

- **`src/lib/**` stays pure** — no `next`/`prisma`/`fs`/network imports. `pageWatch.ts` and the new union helper are `lib/`.
- **TDD** — a failing test first (for pure logic and services), watched fail for the right reason, then minimal code.
- **Verify before done** — `npm test` + `npm run typecheck` (fresh output) before any "done"/commit. Integration:
  `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration`.
- **Identity = canonical URL** — reuse the exported `canonicalUrl` from `src/lib/feeds/diff.ts`; do not reinvent it.
- **Chrome regions (WP-36 constant):** `aside, nav, header, footer, .sidebar, #sidebar, #secondary, .widget-area, .widget_recent_entries, .recent-posts`.
- **`parseToc` chrome-filter is single-pass with empty-fallback:** keep anchors NOT inside a chrome region; if that set is empty, fall back to all anchors (never worse than today). No second parse, no network.
- **WP-38 script is dry-run by default;** a destructive op only writes with an explicit `--apply` flag.
- **Cleanup ops are user-scoped** (`getCurrentUserId()`), matching `getSeries`/`updateSeries`.
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit to `main`.

---

### Task 1: WP-36 — `parseToc` content scoping (pure, test-first)

**Files:**
- Modify: `src/lib/feeds/pageWatch.ts`
- Test: `tests/unit/feeds/pageWatch.test.ts`

**Interfaces:**
- Consumes: existing `parseToc`/`SiteTocConfig`/cheerio.
- Produces: `SiteTocConfig` gains `contentSelector?: string` and `slugFamilies?: string[]`; `parseToc` filters out chrome-region anchors (empty-fallback), optionally scopes to `contentSelector`, and optionally keeps only URLs whose path matches a `slugFamilies` entry.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/feeds/pageWatch.test.ts` (reuse the file's `parseToc` import + fixture style):

```ts
describe('parseToc — content scoping (WP-36)', () => {
  const base = 'https://site.example/toc/';
  const page = (main: string, sidebar = '') =>
    `<html><body><div class="entry-content">${main}</div>` +
    `<aside class="widget-area"><div class="widget_recent_entries">${sidebar}</div></aside></body></html>`;

  test('drops chapter links inside a "recent entries" sidebar (cross-series leak)', () => {
    const html = page(
      `<a href="https://site.example/book1-chapter-1/">Chapter 1</a><a href="https://site.example/book1-chapter-2/">Chapter 2</a>`,
      `<a href="https://site.example/other-series-99/">Chapter 99</a>`,
    );
    const out = parseToc(html, base);
    expect(out.map((c) => c.url)).toEqual(['https://site.example/book1-chapter-1/', 'https://site.example/book1-chapter-2/']);
  });

  test('empty-fallback: when the ONLY chapters are inside a widget, still return them', () => {
    const html =
      `<html><body><aside class="widget-area">` +
      `<a href="https://site.example/ch-1/">Chapter 1</a></aside></body></html>`;
    expect(parseToc(html, base).map((c) => c.url)).toEqual(['https://site.example/ch-1/']);
  });

  test('contentSelector restricts the scan to a container', () => {
    const html =
      `<div class="entry-content"><a href="https://site.example/a-1/">Chapter 1</a></div>` +
      `<div class="other"><a href="https://site.example/b-2/">Chapter 2</a></div>`;
    const out = parseToc(html, base, { chapterSelector: 'a[href]', contentSelector: '.entry-content' });
    expect(out.map((c) => c.url)).toEqual(['https://site.example/a-1/']);
  });

  test('slugFamilies keeps only the series slug prefixes (multi-family Part 1/Part 2)', () => {
    const html = page(
      `<a href="https://site.example/book1-chapter-5/">c5</a>` +
        `<a href="https://site.example/book2-1/">p2c1</a>` +
        `<a href="https://site.example/rewind-3/">rewind</a>`,
    );
    const out = parseToc(html, base, { chapterSelector: 'a[href]', slugFamilies: ['book1-chapter', 'book2-'] });
    expect(out.map((c) => c.url)).toEqual(['https://site.example/book1-chapter-5/', 'https://site.example/book2-1/']);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run tests/unit/feeds/pageWatch.test.ts`
Expected: FAIL — sidebar links included; `contentSelector`/`slugFamilies` not honored (type error + wrong output).

- [ ] **Step 3: Implement in `pageWatch.ts`**

1. Extend `SiteTocConfig`:

```ts
export interface SiteTocConfig {
  /** CSS selector for the chapter link anchors. */
  chapterSelector: string;
  /** Restrict the scan to this container (drops everything outside it). */
  contentSelector?: string;
  /** Keep only chapters whose URL path contains one of these slug prefixes (supports multiple families). */
  slugFamilies?: string[];
  lockSelector?: string;
  lockText?: string[];
}
```

2. Add the chrome constant near the other regexes:

```ts
/** Page chrome that must not contribute chapters — sidebars / "recent entries" widgets / nav / footer. */
const CHROME_SELECTOR =
  'aside, nav, header, footer, .sidebar, #sidebar, #secondary, .widget-area, .widget_recent_entries, .recent-posts';
```

3. In `parseToc`, after the existing `$('script, style, noscript').remove()`, scope the root and filter chrome. Replace the `const anchors = config ? … : …;` block with:

```ts
  const root = config?.contentSelector ? $(config.contentSelector) : $.root();
  const raw = config
    ? root.find(config.chapterSelector).filter((_, el) => $(el).is('a[href]'))
    : root.find('a[href]').filter((_, el) => {
        const $el = $(el);
        const text = ($el.text().trim() || $el.attr('title') || '').trim();
        return CHAPTER_TEXT.test(text) || CHAPTER_HREF.test($el.attr('href') ?? '');
      });

  // Drop anchors inside page chrome (sidebars/widgets). If that removes everything — a site whose TOC
  // *is* a widget — fall back to the full set. Single-pass, no re-parse.
  const inContent = raw.filter((_, el) => $(el).closest(CHROME_SELECTOR).length === 0);
  const anchors = inContent.length > 0 ? inContent : raw;
```

4. Keep the existing `anchors.each(...)` body. Then apply `slugFamilies` at the end — before `return chapters`, add:

```ts
  if (config?.slugFamilies && config.slugFamilies.length > 0) {
    const families = config.slugFamilies;
    return chapters.filter((c) => {
      let path: string;
      try {
        path = new URL(c.url).pathname;
      } catch {
        path = c.url;
      }
      return families.some((f) => path.includes(f));
    });
  }
  return chapters;
```

*(Note: `root.find(...)` replaces the previous top-level `$(...)`; `$.root()` keeps the generic behavior unchanged when no `contentSelector` is set.)*

- [ ] **Step 4: Run → green**

Run: `npx vitest run tests/unit/feeds/pageWatch.test.ts`
Expected: PASS (new scoping tests + all pre-existing `parseToc`/`mergeFeedAndToc` tests — the existing real-site fixtures must still parse the same chapter counts, since none of them put chapters in chrome regions; if one regresses, that's a real signal — investigate, don't just delete the assertion).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add src/lib/feeds/pageWatch.ts tests/unit/feeds/pageWatch.test.ts
git commit -m "$(cat <<'EOF'
WP-36: scope parseToc to content (drop sidebar/widget chapter links)

Filters out chapter anchors inside page chrome (aside/.widget_recent_entries/
#secondary/nav/footer/…) with an empty-fallback for widget-TOC sites; adds
optional SiteTocConfig contentSelector + slugFamilies (multi-family). Stops
the cross-series "recent entries" leak that contaminated TOC backfill.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: WP-38 — recovery service + pure union helper (test-first)

**Files:**
- Create: `src/lib/chapters/merge.ts` (pure) + `tests/unit/chapters/merge.test.ts`
- Create: `src/server/services/cleanup.ts` (Prisma) 
- Test: `tests/integration/cleanup.test.ts`
- Modify: `src/server/services/index.ts` (re-export the cleanup services if the file follows that pattern — check how `backfillFromToc`/`listSeries` are surfaced and match it)

**Interfaces:**
- Produces (pure): `chaptersToMove<T extends { url: string }>(from: T[], intoUrls: string[]): T[]` — the `from` chapters whose canonical URL is not already among `intoUrls` (deduped).
- Produces (services, all user-scoped, all awaited Prisma):
  - `pruneChapters(chapterIds: string[]): Promise<{ deleted: number }>`
  - `deleteSeries(seriesId: string): Promise<{ deleted: boolean }>`
  - `resetChapters(seriesId: string): Promise<{ deleted: number }>`
  - `setSourceUrl(sourceId: string, url: string): Promise<{ updated: boolean }>`
  - `mergeSeries(fromId: string, intoId: string): Promise<{ movedChapters: number; deleted: boolean }>`
  - `listSeriesForCleanup(seriesId: string)` → the series with `chapters` (id/number/title/url) and `sources` (id/type/url/feedUrl) for display.

- [ ] **Step 1: Write the failing pure test** (`tests/unit/chapters/merge.test.ts`)

```ts
import { describe, expect, test } from 'vitest';
import { chaptersToMove } from '../../../src/lib/chapters/merge';

describe('chaptersToMove', () => {
  test('returns from-chapters whose canonical URL is not already in into', () => {
    const from = [{ id: 'f1', url: 'https://x/a' }, { id: 'f2', url: 'https://x/b/' }];
    const into = ['https://x/b']; // canonically equal to b/
    expect(chaptersToMove(from, into).map((c) => c.id)).toEqual(['f1']);
  });

  test('canonical match ignores tracking params', () => {
    const from = [{ id: 'f1', url: 'https://x/a?utm_source=rss' }];
    expect(chaptersToMove(from, ['https://x/a'])).toEqual([]);
  });

  test('empty into → all from move', () => {
    const from = [{ id: 'f1', url: 'https://x/a' }];
    expect(chaptersToMove(from, [])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run → fail**, then implement `src/lib/chapters/merge.ts`:

```ts
import { canonicalUrl } from '../feeds/diff';

/** The `from` chapters not already present in `into` (matched by canonical URL). Pure. */
export function chaptersToMove<T extends { url: string }>(from: T[], intoUrls: string[]): T[] {
  const have = new Set(intoUrls.map(canonicalUrl));
  return from.filter((c) => !have.has(canonicalUrl(c.url)));
}
```

Run: `npx vitest run tests/unit/chapters/merge.test.ts` → PASS.

- [ ] **Step 3: Write the failing integration tests** (`tests/integration/cleanup.test.ts`)

Model on `tests/integration/services.test.ts` (import `db`, the cleanup services, and `addSeries`/`addAlpha`-style helpers). Cover:

```ts
// pruneChapters deletes exactly the given chapters (and nothing else on the series)
// deleteSeries removes the series + cascades its chapters/sources
// resetChapters empties a series' chapters, series remains
// setSourceUrl updates the source's url only
// mergeSeries: from's non-duplicate chapters move to into (by canonical URL); duplicates are dropped
//   with from; from is deleted; into adopts from's reading progress only if into had none.
```

Write concrete assertions (seed with `addSeries` + direct `db` inserts; assert row counts / fields after each op). Example for merge:

```ts
test('mergeSeries folds unique chapters and deletes the source series', async () => {
  const intoId = await addAlpha();          // chapters a-1, a-2
  const fromId = await addAlpha();           // a second copy (a-1, a-2) + a unique a-9
  await db.chapter.create({ data: { seriesId: fromId, title: 'C9', url: 'https://translator.example/a-9/' } });

  const res = await mergeSeries(fromId, intoId);
  expect(res).toEqual({ movedChapters: 1, deleted: true });           // only a-9 was unique
  expect(await db.series.findUnique({ where: { id: fromId } })).toBeNull();
  const intoUrls = (await db.chapter.findMany({ where: { seriesId: intoId } })).map((c) => c.url).sort();
  expect(intoUrls).toContain('https://translator.example/a-9/');
});
```

- [ ] **Step 4: Run → fail** (`DATABASE_URL=… npm run test:integration`), then implement `src/server/services/cleanup.ts`.

Each function loads via `getCurrentUserId()` scoping (a chapter/source is only touched if its series is the user's). `mergeSeries`:
1. Verify both series belong to the user; load `from` chapters (id, url) + `into` chapter urls.
2. `toMove = chaptersToMove(fromChapters, intoUrls)`.
3. In a transaction: `updateMany` the moved chapters to `seriesId: intoId` (and `sourceId: <into active source id or null>`); if `into` has no `ReadingProgress` and `from` does, upsert `into`'s progress from `from`'s (`lastReadChapterId` only if that chapter is among the moved ones, else null); `delete` the `from` series (cascades remaining dup chapters + sources + progress).
4. Return `{ movedChapters: toMove.length, deleted: true }`.

Match the repo's transaction/patterns (`$transaction`, `getCurrentUserId`). Reuse `chaptersToMove`.

- [ ] **Step 5: Run → green** (integration), `npm test` (unit) + `npm run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chapters/merge.ts src/server/services/cleanup.ts src/server/services/index.ts tests/unit/chapters/merge.test.ts tests/integration/cleanup.test.ts
git commit -m "$(cat <<'EOF'
WP-38: contaminated-series recovery services + pure merge helper

Adds user-scoped cleanup services (prune/delete/reset/setSourceUrl/merge) and
a pure chaptersToMove (canonical-URL union) for folding a duplicate series.
Integration-tested against the real DB.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: WP-38 — dry-run CLI over the cleanup service

**Files:**
- Create: `scripts/cleanup-series.ts`
- Modify: `package.json` (add `tsx` devDep + a `db:cleanup` script)

**Interfaces:**
- Consumes: the Task-2 cleanup services + `backfillFromToc` (WP-33). Thin dispatch; no new logic.

- [ ] **Step 1: Add tooling**

- Install tsx: `npm install -D tsx` (it runs TS/ESM directly; the existing `.mjs` runner can't import the TS `src/` services). Confirm it lands in `devDependencies`.
- Add to `package.json` scripts: `"db:cleanup": "tsx scripts/cleanup-series.ts"`.

- [ ] **Step 2: Write the CLI** (`scripts/cleanup-series.ts`)

A thin, **dry-run-by-default** dispatcher. Parse `process.argv`: first arg = command, rest = args, `--apply` = commit. Commands map 1:1 to the services + `list`/`backfill`:

- `list <seriesId>` — always read-only; print chapters (id, number, title, url) + sources (id, type, url).
- `prune-chapters <chapterId...>`, `delete-series <seriesId>`, `reset-chapters <seriesId>`, `set-source-url <sourceId> <url>`, `merge-series --from <id> --into <id>`, `backfill <seriesId>`.
- **Dry-run:** without `--apply`, print exactly what WOULD change (e.g. for `prune-chapters`, fetch and print the targeted chapters; for `merge-series`, print the move count via a read-only pre-check) and DO NOT call the mutating service. With `--apply`, call the service and print the result.
- Print a one-line summary and `process.exit(0)`; on unknown command, print usage and exit non-zero. Disconnect Prisma (`db.$disconnect()`) in a `finally`.

Keep it small — the logic lives in the services; this is argument parsing + print + guarded dispatch.

- [ ] **Step 3: Verify against the test DB (not prod)**

Run a couple of commands against `webnovel_test` to prove the wiring + the dry-run guard, e.g.:

```bash
# seed a throwaway series first via a small node/tsx snippet or reuse an integration-created row, then:
DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run db:cleanup -- list <seriesId>
DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run db:cleanup -- reset-chapters <seriesId>          # dry-run: prints, no delete
DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run db:cleanup -- reset-chapters <seriesId> --apply  # deletes
```

Confirm: dry-run makes no writes (row counts unchanged), `--apply` does. Capture the output in the report. `npm run typecheck` + `npm test` still clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/cleanup-series.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
WP-38: db:cleanup CLI (dry-run default) over the recovery services

tsx-run scripts/cleanup-series.ts: list / prune-chapters / delete-series /
reset-chapters / set-source-url / merge-series / backfill. Dry-run prints the
plan; --apply commits. Verified against the local test DB.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Close out PLAN.md

- [ ] Flip **WP-36** and **WP-38** `TODO → DONE`; update the Current-focus/`NEXT` (back to WP-35, or owner's call); add a Changelog entry (parseToc chrome-filter + fallback; recovery services + dry-run CLI; note WP-37 still deferred, the owner sets TOC URLs by hand via `set-source-url`, and the backfill button is now safe on chrome-sidebar sites). Note in the caution that the recovery path exists.

- [ ] Commit:

```bash
git add PLAN.md
git commit -m "$(cat <<'EOF'
plan: WP-36 + WP-38 DONE — parseToc scoping + recovery CLI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** (against `2026-07-27-wp36-38-toc-scoping-cleanup-design.md`):
- WP-36 chrome-filter + empty-fallback → Task 1 (Step 3.3). ✓
- WP-36 `contentSelector` + `slugFamilies` (multi-family) → Task 1 (Step 3.1/3.3/3.4). ✓
- WP-38 pure merge-union → Task 2 (`chaptersToMove`). ✓
- WP-38 services (prune/delete/reset/set-source-url/merge, user-scoped) → Task 2. ✓
- WP-38 dry-run CLI (list/backfill + the ops, `--apply`) → Task 3. ✓
- Out of scope (WP-37 auto-discovery, WP-39 dedup, WP-35, auto phantom-detection) → not built; `set-source-url` covers the manual TOC-URL correction. ✓

**Placeholder scan:** Task 3's CLI is described by its command interface + dry-run contract rather than full literal code (a thin arg-parse/dispatch shell whose logic is the Task-2 services) — flagged, not a silent gap; the implementer writes the dispatch. Task 2 Step 3 lists the integration cases in prose with one concrete example — the implementer writes the rest against the named services. All pure/service code is concrete.

**Type consistency:** `chaptersToMove<T extends {url}>(from, intoUrls: string[])` (Task 2) is used by `mergeSeries` (Task 2) and consumes the exported `canonicalUrl` (WP-33). Cleanup service names/signatures in the Task-2 interface block match the Task-3 CLI command mapping. `SiteTocConfig` additions (Task 1) are optional, so existing `parseToc` callers compile unchanged.
