# WP-30 — Series title backfill (backend core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give series their real human title — extracted from the landing page heading — instead of a site-name channel title or a URL-slug acronym, at add-time and via a silent backfill repair, without ever clobbering a title flagged manual.

**Architecture:** A pure `extractSeriesTitle(html, {siteName?})` (new `src/lib/feeds/title.ts`) reads `<h1>` → `og:title` → `<title>` and conservatively strips a host-matched site suffix. `addSeries` uses it (on the landing body it already fetches) to prefer the real page title over a site-name channel title / slug. `backfillFromToc` uses it (landing-page-primary, reusing the self-heal's already-fetched landing body) to repair a stored title when `Series.titleIsManual` is false. Poll is untouched.

**Tech Stack:** TypeScript (strict), Prisma + Postgres (Neon), Vitest (unit + integration). `lib/` stays Next-free and pure.

## Global Constraints

- `src/lib/**` stays pure — no `next`/`prisma`/`fs`/network imports. `extractSeriesTitle` is a pure HTML-string function.
- TDD for `lib/` logic — failing test first, watch it fail for the right reason, then implement (agreement #2).
- Verify before done — `npm test` + `npm run typecheck` with fresh output in the same message (agreement #3).
- Committed content stays anonymous — reserved `.example` domains, generic works, invented site names; no real site/series names (memory: no-real-site-names). Real URLs live only in the gitignored local testing notes.
- `titleIsManual` defaults `false`; auto-backfill overwrites the stored title ONLY when it is `false`. The manual-edit UI that sets it `true` is a deferred follow-up — not in this plan.
- Title source is the **landing page** (`source.url`), TOC page only as fallback (WP-37 finding). Poll does NOT do title extraction.
- Migration workflow: `npm run db:migrate -- --name <name>` against local `webnovel_dev`; integration tests run against `webnovel_test` (a DATABASE_URL whose name contains "test"; see `tests/integration/setup.ts`). Never touch `.env.prod`/Neon.
- Suffix separators: pipe `|` plus three lookalike dashes — hyphen-minus `-` (U+002D), en-dash `–` (U+2013), em-dash `—` (U+2014). One class `[|\-–—]`.

---

### Task 1: Schema — add `Series.titleIsManual` + migration

**Files:**
- Modify: `prisma/schema.prisma` (Series model)
- Create: `prisma/migrations/<ts>_add_series_title_is_manual/migration.sql` (generated)

**Interfaces:**
- Produces: `Series.titleIsManual: Boolean @default(false)` column; regenerated Prisma client exposing it.

- [ ] **Step 1: Add the field to the schema**

In `prisma/schema.prisma`, in `model Series`, add near the `title` field:

```prisma
  // WP-30: true once the title was set by a manual user edit (deferred UI) — auto title-backfill
  // never overwrites a manual title. Default false = auto-derived, safe to backfill.
  titleIsManual Boolean @default(false)
```

- [ ] **Step 2: Create and apply the migration**

Run: `npm run db:migrate -- --name add_series_title_is_manual`
Expected: new `migration.sql` containing `ALTER TABLE "Series" ADD COLUMN "titleIsManual" BOOLEAN NOT NULL DEFAULT false;`, applied to `webnovel_dev`, client regenerated. If it wants a reset or emits anything destructive, STOP and report BLOCKED.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (no consumer references the field yet).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "WP-30: add Series.titleIsManual column + migration"
```

---

### Task 2: Pure `extractSeriesTitle` + `matchesSiteName`

**Files:**
- Create: `src/lib/feeds/title.ts`
- Test: `tests/unit/feeds/title.test.ts`

**Interfaces:**
- Produces:
  - `export function extractSeriesTitle(html: string, opts?: { siteName?: string }): string | null`
  - `export function matchesSiteName(text: string, siteName: string): boolean` — loose match (case-insensitive, ignoring a leading `www.` and a trailing TLD), reused by add-time's channel-title guard (Task 3).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/feeds/title.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { extractSeriesTitle, matchesSiteName } from '../../../src/lib/feeds/title';

describe('extractSeriesTitle', () => {
  test('prefers <h1> over og:title and <title>', () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Name | Site">
      <title>Title Name - Site</title>
    </head><body><h1>Real Series Name</h1></body></html>`;
    expect(extractSeriesTitle(html, { siteName: 'site.example' })).toBe('Real Series Name');
  });

  test('falls back to og:title when no <h1>, stripping a host-matched suffix', () => {
    const html = `<head><meta property="og:title" content="Silver Moon Saga | Lunar Press"><title>x</title></head>`;
    expect(extractSeriesTitle(html, { siteName: 'lunarpress.example' })).toBe('Silver Moon Saga');
  });

  test('falls back to <title> when no <h1>/og, stripping a host-matched dash suffix', () => {
    const html = `<head><title>Cradle of Ash — Verdant Scrolls</title></head>`;
    expect(extractSeriesTitle(html, { siteName: 'verdantscrolls.example' })).toBe('Cradle of Ash');
  });

  test('does NOT strip a legit dash when the tail is not the site name', () => {
    const html = `<head><title>Volume 1 – Dawn</title></head>`;
    // 'Dawn' is not the site name, so the dash stays.
    expect(extractSeriesTitle(html, { siteName: 'reader.example' })).toBe('Volume 1 – Dawn');
  });

  test('strips a bare pipe suffix even with no siteName (pipe is a site separator)', () => {
    const html = `<head><title>Star Chef | Some Site</title></head>`;
    expect(extractSeriesTitle(html)).toBe('Star Chef');
  });

  test('leaves a dash suffix intact when no siteName is known', () => {
    const html = `<head><title>Volume 1 – Dawn</title></head>`;
    expect(extractSeriesTitle(html)).toBe('Volume 1 – Dawn');
  });

  test('returns null when there is no usable heading', () => {
    expect(extractSeriesTitle(`<html><body><div>loading…</div></body></html>`)).toBeNull();
  });

  test('collapses whitespace and trims', () => {
    expect(extractSeriesTitle(`<h1>  Spaced   Name  </h1>`)).toBe('Spaced Name');
  });
});

describe('matchesSiteName', () => {
  test('loose match ignores www. and TLD, case-insensitive', () => {
    expect(matchesSiteName('Lunar Press', 'www.lunarpress.example')).toBe(true);
    expect(matchesSiteName('LUNARPRESS', 'lunarpress.net')).toBe(true);
  });
  test('non-matching text is false', () => {
    expect(matchesSiteName('Silver Moon Saga', 'lunarpress.example')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- title`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement `src/lib/feeds/title.ts`**

```typescript
/**
 * Extract a series' human title from its landing/reading page HTML (WP-30). Pure.
 * Precedence: <h1> (usually clean, no site suffix) → og:title → <title>. For the meta/title
 * fallbacks, a trailing "<sep> SiteName" suffix is stripped conservatively — only when the tail
 * matches the known site name (so a legitimate dash in a title survives), except a bare pipe,
 * which is almost always a site separator, is stripped even without a known site name.
 */

/** Loose site-name match: case-insensitive, ignoring a leading www., a trailing TLD, and any
 *  non-alphanumerics — so a spaced display name ("Verdant Scrolls") matches a concatenated host
 *  ("verdantscrolls.example"). TLD strip runs BEFORE the alnum strip (it needs the dot). */
export function matchesSiteName(text: string, siteName: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/^www\./, '')
      .replace(/\.[a-z]{2,}$/, '') // drop a trailing TLD (dot still present here)
      .replace(/[^a-z0-9]/g, ''); // then drop spaces/punctuation
  const a = norm(text);
  const b = norm(siteName);
  return a.length > 0 && a === b;
}

const SEP = /\s*[|\-–—]\s*/; // pipe + hyphen-minus/en-dash/em-dash

function clean(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

function attrContent(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m ? clean(m[1]) : null;
}

/** Strip a trailing "<sep> X" suffix: only when X matches siteName, OR (for a pipe) always. */
function stripSiteSuffix(title: string, siteName?: string): string {
  const m = /^(.*?)(\s*[|\-–—]\s*)([^|\-–—]+)$/.exec(title);
  if (!m) return title;
  const [, head, sep, tail] = m;
  const isPipe = sep.includes('|');
  if (isPipe || (siteName != null && matchesSiteName(tail!.trim(), siteName))) {
    const stripped = clean(head);
    if (stripped) return stripped;
  }
  return title;
}

export function extractSeriesTitle(html: string, opts?: { siteName?: string }): string | null {
  const h1 = attrContent(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1 ? clean(h1.replace(/<[^>]*>/g, '')) : null;
  if (h1Text) return h1Text; // <h1> is trusted as-is (no site suffix in practice)

  const og = attrContent(html, /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i)
    ?? attrContent(html, /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  if (og) return stripSiteSuffix(og, opts?.siteName);

  const title = attrContent(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return stripSiteSuffix(title, opts?.siteName);

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- title`
Expected: PASS (all cases). Note the `SEP` const may be unused if you inline the class — remove it if so to keep output pristine (no unused-var).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/feeds/title.ts tests/unit/feeds/title.test.ts
git commit -m "WP-30: pure extractSeriesTitle + matchesSiteName (h1/og/title, host-matched suffix strip)"
```

---

### Task 3: Add-time title preference in `addSeries`

**Files:**
- Modify: `src/server/services/addSeries.ts`
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `extractSeriesTitle`, `matchesSiteName` (Task 2).
- Produces: add-time stored title precedence = `input.title` → landing-page `<h1>`/og/title → existing per-path fallback, with a channel-title-equals-site-name guard.

- [ ] **Step 1: Write the failing integration tests**

Add to `tests/integration/services.test.ts` in the `addSeries` describe block:

```typescript
test('WP-30: add adopts the page <h1> over a feed channel title that is the site name', async () => {
  const URL = 'https://titlesite.example/series/omega/';
  const FEED = 'https://titlesite.example/series/omega/feed';
  // Page advertises a per-series feed; the feed channel <title> is the SITE name, but the page <h1> is the real series.
  const page = `<html><head><link rel="alternate" type="application/rss+xml" href="${FEED}"></head>`
    + `<body><h1>The Omega Chronicle</h1></body></html>`;
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>TitleSite</title>`
    + `<item><title>The Omega Chronicle Chapter 1</title><link>https://titlesite.example/omega-1/</link><guid>o1</guid></item>`
    + `</channel></rss>`;
  const { seriesId } = await addSeries({ url: URL }, fetchFrom({ [URL]: okRes(page), [FEED]: okRes(feed) }));
  const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
  expect(series.title).toBe('The Omega Chronicle'); // not "TitleSite"
  expect(series.titleIsManual).toBe(false);
});

test('WP-30: page-watch add uses the page <h1> over the URL slug', async () => {
  const URL = 'https://pw2.example/novels/xyz-acronym/';
  const page = `<html><body><h1>Extremely Yielding Zenith</h1>`
    + `<a href="/novels/xyz-acronym/chapter-1">Chapter 1</a></body></html>`;
  const { seriesId } = await addSeries({ url: URL }, fetchFrom({ [URL]: okRes(page) }));
  const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
  expect(series.title).toBe('Extremely Yielding Zenith'); // not "Xyz Acronym"
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --project integration -t "WP-30: "`
Expected: FAIL — titles are "TitleSite" / "Xyz Acronym" (page heading not consulted yet).

- [ ] **Step 3: Implement the add-time preference**

In `src/server/services/addSeries.ts`:

Add to the discover import (join the existing import from `../../lib/feeds/discover`) and add a title import:
```typescript
import { extractSeriesTitle, matchesSiteName } from '../../lib/feeds/title';
```

Right after `const pageOk = page.outcome === 'SUCCESS' && !page.notModified;` (near the top of `addSeries`), compute the page title once:
```typescript
const pageTitle = pageOk ? extractSeriesTitle(page.body, { siteName: host }) : null;
```

FEED path — replace the `seriesTitle` assignment with:
```typescript
    const seriesTitle =
      input.title ??
      pageTitle ??
      (positive?.type === 'CATEGORY'
        ? positive.value
        : match.type === 'WHOLE_FEED'
          ? // channel title, unless it's just the site name → humanize the URL instead
            (parsed.title != null && !matchesSiteName(parsed.title, host) ? parsed.title : titleFromUrl(url))
          : titleFromUrl(url));
```

Page-watch path — replace `seriesTitle: input.title ?? titleFromUrl(url),` with:
```typescript
      seriesTitle: input.title ?? pageTitle ?? titleFromUrl(url),
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- --project integration -t "WP-30: "`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green (existing add-time title tests must still pass — a page with no `<h1>` still falls to the old behavior).

- [ ] **Step 6: Commit**

```bash
git add src/server/services/addSeries.ts tests/integration/services.test.ts
git commit -m "WP-30: prefer the page title at add-time over a site-name channel title / URL slug"
```

---

### Task 4: Title repair in `backfillFromToc`

**Files:**
- Modify: `src/server/services/index.ts` (`backfillFromToc`)
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `extractSeriesTitle` (Task 2), `Series.titleIsManual` (Task 1).
- Produces: `backfillFromToc` return becomes `{ added: number; reconciled: number; titleUpdated?: string }`; repairs a non-manual title from the landing page (self-heal path reuses the already-fetched landing body; tocUrl-set path does one extra `source.url` fetch).

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/services.test.ts` in the `backfillFromToc` describe block:

```typescript
test('WP-30: backfill repairs a non-manual title from the landing body (self-heal path, no extra fetch)', async () => {
  const LANDING = 'https://bft.example/series/rho/';
  const TOC = 'https://bft.example/series/rho/contents/';
  // Add page-watch with a bad slug title (no <h1> at add) so the stored title is the slug.
  const { seriesId } = await addSeries(
    { url: LANDING },
    fetchFrom({ [LANDING]: okRes(`<a href="/series/rho/contents/">Table of Contents</a>`) }),
  );
  await db.source.updateMany({ where: { seriesId }, data: { tocUrl: null } }); // force self-heal
  // Count fetches; landing now HAS an <h1>; self-heal fetches landing (for the TOC link) → title is free.
  const seen: string[] = [];
  const fetch = ((u: string) => {
    seen.push(u);
    if (u === LANDING) return Promise.resolve(okRes(`<h1>The Rho Saga</h1><a href="/series/rho/contents/">Table of Contents</a>`));
    if (u === TOC) return Promise.resolve(okRes(`<a href="/series/rho/chapter-1">Chapter 1</a>`));
    return Promise.resolve(okRes('', { status: 404, outcome: 'SUCCESS' as const }));
  }) as FetchImpl;
  const result = await backfillFromToc(seriesId, fetch);
  const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
  expect(series.title).toBe('The Rho Saga');
  expect(result.titleUpdated).toBe('The Rho Saga');
  expect(seen.filter((u) => u === LANDING)).toHaveLength(1); // landing fetched once (for the TOC link) — no extra title fetch
});

test('WP-30: backfill does NOT overwrite a manual title', async () => {
  const LANDING = 'https://bft2.example/series/sigma/';
  const { seriesId } = await addSeries(
    { url: LANDING },
    fetchFrom({ [LANDING]: okRes(`<h1>Auto Name</h1><a href="/series/sigma/chapter-1">Chapter 1</a>`) }),
  );
  await db.series.updateMany({ where: { id: seriesId }, data: { title: 'My Hand-Fixed Name', titleIsManual: true } });
  const result = await backfillFromToc(
    seriesId,
    fetchFrom({ [LANDING]: okRes(`<h1>Auto Name</h1><a href="/series/sigma/chapter-1">Chapter 1</a><a href="/series/sigma/chapter-2">Chapter 2</a>`) }),
  );
  const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
  expect(series.title).toBe('My Hand-Fixed Name'); // untouched
  expect(result.titleUpdated).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --project integration -t "WP-30: backfill"`
Expected: FAIL — `result.titleUpdated` is undefined / title not repaired (no title logic yet). (The manual-title test may pass vacuously now; it must still pass after Step 3.)

- [ ] **Step 3: Implement title repair**

In `src/server/services/index.ts`, add the import (join the existing `../../lib/feeds/discover` line is separate — add a new line near it):
```typescript
import { extractSeriesTitle } from '../../lib/feeds/title';
```

Change the ownership query to load the current title + flag:
```typescript
  const owned = await db.series.findFirst({
    where: { id: seriesId, userId: getCurrentUserId() },
    select: { id: true, title: true, titleIsManual: true },
  });
  if (!owned) return { added: 0, reconciled: 0 };
```

Capture the landing body BEFORE the self-heal reassigns `res`. Immediately after the `if (res.outcome !== 'SUCCESS' || res.notModified) return ...;` guard, add:
```typescript
  // WP-30: the landing page (source.url) is the title source. On the self-heal path this first
  // `res` IS the landing page — capture it before findTocUrl/follow reassigns `res` to the TOC body.
  const landingBody: string | null = source.tocUrl == null ? res.body : null;
```

After the self-heal block and `const toc = parseToc(res.body, tocUrl);`, compute the title source and extracted title:
```typescript
  // Title source: the captured landing body (self-heal, free) → else one extra source.url fetch
  // (tocUrl-set path) → else the TOC body we already have.
  let titleBody = landingBody;
  if (titleBody == null && !owned.titleIsManual) {
    const landing = await fetchImpl(source.url, {});
    titleBody = landing.outcome === 'SUCCESS' && !landing.notModified ? landing.body : res.body;
  }
  const extractedTitle = owned.titleIsManual ? null : extractSeriesTitle(titleBody ?? res.body, { siteName: source.host });
  const titleUpdated =
    !owned.titleIsManual && extractedTitle != null && extractedTitle !== owned.title ? extractedTitle : undefined;
```

Add the title update to the `db.$transaction([...])` array (append before the closing `])`):
```typescript
    ...(titleUpdated != null
      ? [db.series.update({ where: { id: seriesId }, data: { title: titleUpdated } })]
      : []),
```

Change the function's return type and final return:
```typescript
): Promise<{ added: number; reconciled: number; titleUpdated?: string }> {
```
and the final `return { added: diff.new.length, reconciled: diff.accessReconciled.length };` becomes:
```typescript
  return { added: diff.new.length, reconciled: diff.accessReconciled.length, titleUpdated };
```
(The early `return { added: 0, reconciled: 0 }` guards stay as-is — `titleUpdated` is optional.)

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- --project integration -t "WP-30: backfill"`
Expected: PASS (both).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green (existing backfill tests still pass; the route `NextResponse.json(result)` transparently carries the new field).

- [ ] **Step 6: Commit**

```bash
git add src/server/services/index.ts tests/integration/services.test.ts
git commit -m "WP-30: backfill repairs a non-manual title from the landing page (landing-primary, self-heal-free)"
```

---

### Task 5: Update PLAN.md — WP-30 backend core done

**Files:**
- Modify: `PLAN.md`

**Interfaces:** none (tracker hygiene, agreement #6).

- [ ] **Step 1: Record the outcome**

In `PLAN.md`:
- Active queue: leave the WP-30 row but change its label to note the backend core landed and the manual-edit UI remains; set its status to reflect partial completion (keep `NEXT` on the next priority row, or mark WP-30 `TODO`/note per the doc's convention). Set the next row (WP-39b) appropriately per row order.
- In the `### WP-30` detail section, add a `**DONE (backend core, 2026-07-31).**` summary: `extractSeriesTitle` (h1/og/title, host-matched suffix strip); `Series.titleIsManual`; add-time prefers the page title over a site-name channel title / slug; backfill repairs a non-manual title landing-primary; **manual-edit UI still deferred** (its own sub-project; the flag shipped).
- Update **Current focus**: reflect WP-30 backend core landed; set the next NEXT.
- Add a Changelog line dated 2026-07-31 for WP-30 (backend core).
- Keep it anonymous (framework/category descriptors only).

- [ ] **Step 2: Commit**

```bash
git add PLAN.md
git commit -m "docs: WP-30 backend core done — title backfill; manual-edit UI still deferred"
```

---

## Self-Review

**Spec coverage:**
- §1 `extractSeriesTitle` (h1/og/title, conservative host-matched suffix strip, dash-not-stripped, bare-pipe, null) → Task 2. ✅
- §2 `Series.titleIsManual` → Task 1. ✅
- §3 add-time: page title beats site-name channel title (guard) + beats URL slug → Task 3. ✅
- §4 backfill: landing-primary repair, self-heal reuses landing body (no extra fetch), tocUrl-set does extra fetch, manual gate, return shape → Task 4. ✅
- Testing (unit for extractSeriesTitle; integration for add-time preference + backfill repair both paths + manual untouched) → Tasks 2, 3, 4. ✅
- DoD (real title at add; existing repaired via backfill; manual not clobbered; migration; unit + integration tests) → all tasks. ✅
- Tracker hygiene → Task 5. ✅

**Placeholder scan:** No TBD/TODO; every code step shows real code. ✅

**Type consistency:** `extractSeriesTitle(html, {siteName?}): string | null` and `matchesSiteName(text, siteName): boolean` defined in Task 2, consumed with those signatures in Tasks 3 (`matchesSiteName(parsed.title, host)`, `extractSeriesTitle(page.body,{siteName:host})`) and 4 (`extractSeriesTitle(titleBody,{siteName:source.host})`). `Series.titleIsManual` (Task 1) read in Task 4 (`owned.titleIsManual`) and asserted in Task 3. Backfill return `{added,reconciled,titleUpdated?}` (Task 4) consumed transparently by the route. ✅

**Note on the manual test's non-vacuity (Task 4):** the "does NOT overwrite a manual title" test seeds `titleIsManual: true` and asserts `titleUpdated` undefined AND the title unchanged; it would fail if the gate were dropped (backfill would extract "Auto Name" and overwrite "My Hand-Fixed Name"). Genuine.
