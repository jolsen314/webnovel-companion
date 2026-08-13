# WP-34 — Feed→TOC Switch to Lock-Monitoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a series be switched from FEED to PAGE_WATCH lock-monitoring — auto at add when the TOC shows locks, and manually (in-app button + CLI) for CF/paid sites — seeding the full rendered TOC silently so WP-20 "now free" arms.

**Architecture:** A small trigger in `addSeries.resolveFrom` (divert to PAGE_WATCH when the page TOC has a LOCKED chapter); a `reclassifySource` DB-flip primitive + a `switchToPageWatch` service that flips then silently backfills with plain→render escalation; a `POST /api/series/[id]/switch` route and a detail-page "Track unlocks" button that calls it; CLI commands (`reclassify-source [--render]`, `backfill --render`); and a `parseToc` stub filter. Auth is handled by middleware; per-user isolation via `getCurrentUserId()` in the service layer.

**Tech Stack:** TypeScript (strict), Next.js App Router, Prisma/Postgres, Vitest (unit + integration).

## Global Constraints

- **Keep `src/lib/**` pure/Next-free.** Service/DB code lives in `src/server/**`; route handlers stay thin and call services.
- **TDD** for `lib`/service logic — failing test first; red → green → refactor.
- **Verify before "done":** `npm test` (unit) + integration (`DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration`) + `npm run typecheck`, fresh output, before any completion claim.
- **Anonymity:** `*.example` hosts only in tests/docs; no real site names.
- **Silent means silent:** the switch/backfill path must emit **no** push effects (seeding ~100 chapters must not storm).
- **`RENDER_ESCALATION_MAX` = 5**, exported from `src/server/services/poll.ts`.
- **Deferred (do NOT build):** number-keyed transition reconcile; broader anchor filtering (WP-32) beyond the one stub filter here.

---

### Task 1: `parseToc` stub hardening — drop `chapter.permalink`-style hrefs

The validated CF page interleaves unrendered Alpine.js template stubs (`<a href="chapter.permalink">`) with real links. Extend `parseToc`'s existing stub guard to also drop bare dotted-identifier hrefs.

**Files:**
- Modify: `src/lib/feeds/pageWatch.ts:70`
- Test: `tests/unit/feeds/pageWatch.test.ts`

**Interfaces:** none changed — `parseToc(html, baseUrl, config?)` still returns `TocChapter[]`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/feeds/pageWatch.test.ts` inside `describe('parseToc — generic extraction', …)`:

```ts
test('drops unrendered dotted-expression stubs like href="chapter.permalink"', () => {
  const html = `<html><body><main><ul>
    <li><a href="chapter.permalink">Chapter</a></li>
    <li><a href="/novel/x/chapter-1/">Chapter 1</a></li>
    <li><a href="/novel/x/chapter-2/">Chapter 2</a></li>
  </ul></main></body></html>`;

  expect(parseToc(html, base).map((c) => c.url)).toEqual([
    'https://site.example/novel/x/chapter-1/',
    'https://site.example/novel/x/chapter-2/',
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- pageWatch`
Expected: FAIL — the output includes a phantom `https://site.example/chapter.permalink` row (the stub resolved as a relative URL).

- [ ] **Step 3: Extend the stub guard**

In `src/lib/feeds/pageWatch.ts`, replace the guard at line 70:

```ts
    if (/[{}]|\$\{/.test(href)) return; // unrendered client-side template stub (e.g. "…/{{chapter_slug}}/")
```

with:

```ts
    // Unrendered client-side template stub: "{{chapter_slug}}"/"${…}", or a bare dotted-identifier
    // expression like "chapter.permalink" (an Alpine/Vue `x-bind:href` value that didn't render).
    if (/[{}]|\$\{/.test(href) || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(href.trim())) return;
```

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `npm test && npm run typecheck`
Expected: PASS — the new test passes; existing `parseToc` tests (incl. the `{{chapter_slug}}` stub test) still pass. Note a real URL (`https://…`, has `:`/`/`) and a relative path (`chapter-1/`, has `/`) never match the bare-identifier pattern.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feeds/pageWatch.ts tests/unit/feeds/pageWatch.test.ts
git commit -m "WP-34: parseToc drops bare dotted-expression href stubs (chapter.permalink)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add-time lock-detect → prefer PAGE_WATCH

In `resolveFrom`'s FEED branch, add a third divert trigger: a page TOC that shows any LOCKED chapter → PAGE_WATCH (seeded with access, armed for "now free"), even when the feed is isolable.

**Files:**
- Modify: `src/server/services/addSeries.ts` (the FEED-branch divert condition)
- Test: `tests/unit/server/addSeries.test.ts`

**Interfaces:** none changed.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/server/addSeries.test.ts` in the top `describe('addSeries', …)`:

```ts
test('WP-34: a feed whose page TOC shows a LOCKED chapter → PAGE_WATCH (track unlocks), even with a feed', async () => {
  const url = 'https://paid.example/novel/x/';
  const feedUrl = 'https://paid.example/feed/';
  const page = `<html><head><link rel="alternate" type="application/rss+xml" href="${feedUrl}"></head><body><ul>
    <li><a href="https://paid.example/novel/x/ch-1/">Chapter 1</a></li>
    <li class="premium"><a href="https://paid.example/novel/x/ch-2/">Chapter 2</a></li>
  </ul></body></html>`;
  const p = ports({
    [url]: ok(page),
    [feedUrl]: ok(RSS(ITEM('g1', 'https://paid.example/novel/x/ch-1/'))),
  });

  const result = await addSeries({ url }, p);

  expect(result.resolved.type).toBe('PAGE_WATCH');
  expect(result.resolved.feedUrl).toBeNull();
  expect(result.resolved.chapters.map((c) => c.access)).toEqual(['FREE', 'LOCKED']);
});

test('WP-34: a feed whose page TOC is all FREE stays FEED (no lock → no divert)', async () => {
  const url = 'https://free.example/novel/y/';
  const feedUrl = 'https://free.example/feed/';
  const page = `<html><head><link rel="alternate" type="application/rss+xml" href="${feedUrl}"></head><body><ul>
    <li><a href="https://free.example/novel/y/ch-1/">Chapter 1</a></li>
  </ul></body></html>`;
  const p = ports({
    [url]: ok(page),
    [feedUrl]: ok(RSS(ITEM('g1', 'https://free.example/novel/y/ch-1/'))),
  });

  const result = await addSeries({ url }, p);

  expect(result.resolved.type).toBe('FEED');
});
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `npm test -- addSeries`
Expected: FAIL — the locked-TOC case currently resolves `FEED` (no lock trigger yet). The all-FREE case already passes.

- [ ] **Step 3: Add the lock-detect trigger**

In `src/server/services/addSeries.ts`, in the FEED branch, replace the divert guard. Change:

```ts
      const cantIsolateAdvertised = positive === null && !usedGuesses;
      if (!(cantIsolateAdvertised && pageToc.length > RENDER_ESCALATION_MAX)) {
```

to:

```ts
      const cantIsolateAdvertised = positive === null && !usedGuesses;
      // WP-34: a readable page TOC that shows LOCKED chapters → prefer page-watch (track unlocks),
      // even when the feed is isolable — the unlock event lives only in the TOC, not the feed.
      const tocHasLocks = pageToc.some((c) => c.access === 'LOCKED');
      const divertToPageWatch = (cantIsolateAdvertised && pageToc.length > RENDER_ESCALATION_MAX) || tocHasLocks;
      if (!divertToPageWatch) {
```

(The rest of the FEED branch body and the trailing `// else: … page-watch it.` comment are unchanged.)

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `npm test && npm run typecheck`
Expected: PASS — both new tests pass; WP-49's divert tests and all existing FEED tests still pass (their pages have no `LOCKED` chapters, so `tocHasLocks` is false).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/addSeries.ts tests/unit/server/addSeries.test.ts
git commit -m "WP-34: add-time lock-detect — divert a locked-TOC feed to PAGE_WATCH

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `reclassifySource` service + CLI (`reclassify-source`, `backfill --render`), export `renderPort`

The low-level flip primitive and its CLI surface, plus render-capable backfill.

**Files:**
- Modify: `src/server/services/cleanup.ts` (add `reclassifySource`)
- Modify: `src/server/services/index.ts` (`export` `renderPort`; re-export `reclassifySource`)
- Modify: `scripts/cleanup-series.ts` (new `reclassify-source` command; `--render` on `backfill`)
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Produces: `reclassifySource(sourceId: string, opts?: { render?: boolean }): Promise<{ updated: boolean }>` — flips an owned source `type→PAGE_WATCH`, `feedUrl→null`, `matchType→WHOLE_FEED`, `matchValue→null`, and (if `render`) `fetchMode→RENDER`. `renderPort(): FetchImpl | undefined` becomes exported.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/services.test.ts` (import `reclassifySource` from `../../src/server/services` and reuse the existing `addSeries`/`db`/`fetchFrom`/`okRes`/`PAGE`/`RSS`/`ITEM` helpers):

```ts
  test('WP-34: reclassifySource flips a FEED source to PAGE_WATCH (render → fetchMode RENDER)', async () => {
    const url = 'https://paid.example/novel/z/';
    const feedUrl = 'https://paid.example/feed/';
    const { seriesId } = await addSeries(
      { url },
      fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS(ITEM('g1', 'https://paid.example/z-1/'))) }),
    );
    const before = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(before.type).toBe('FEED');

    const res = await reclassifySource(before.id, { render: true });
    expect(res.updated).toBe(true);

    const after = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(after.type).toBe('PAGE_WATCH');
    expect(after.feedUrl).toBeNull();
    expect(after.matchType).toBe('WHOLE_FEED');
    expect(after.matchValue).toBeNull();
    expect(after.fetchMode).toBe('RENDER');
  });

  test('WP-34: reclassifySource without render keeps fetchMode PLAIN', async () => {
    const url = 'https://free.example/novel/w/';
    const feedUrl = 'https://free.example/feed/';
    const { seriesId } = await addSeries(
      { url },
      fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS(ITEM('g1', 'https://free.example/w-1/'))) }),
    );
    const src = await db.source.findFirstOrThrow({ where: { seriesId } });

    await reclassifySource(src.id);

    const after = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(after.type).toBe('PAGE_WATCH');
    expect(after.fetchMode).toBe('PLAIN');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration -- services`
Expected: FAIL — `reclassifySource` is not exported/defined.

- [ ] **Step 3: Implement `reclassifySource`**

In `src/server/services/cleanup.ts`, add (mirroring `setSourceUrl`'s ownership scoping):

```ts
/** Flip an owned source FEED→PAGE_WATCH: deactivate the feed, drop the series matcher, and
 *  (when `render`) set RENDER — for CF/JS TOCs the plain fetch can't read (WP-34). */
export async function reclassifySource(
  sourceId: string,
  opts: { render?: boolean } = {},
): Promise<{ updated: boolean }> {
  const userId = getCurrentUserId();
  const owned = await db.source.findFirst({ where: { id: sourceId, series: { userId } }, select: { id: true } });
  if (!owned) return { updated: false };
  await db.source.update({
    where: { id: sourceId },
    data: {
      type: 'PAGE_WATCH',
      feedUrl: null,
      matchType: 'WHOLE_FEED',
      matchValue: null,
      ...(opts.render ? { fetchMode: 'RENDER' as const } : {}),
    },
  });
  return { updated: true };
}
```

- [ ] **Step 4: Export `reclassifySource` and `renderPort`**

In `src/server/services/index.ts`: add `reclassifySource` to the re-export from `./cleanup` (the block near line 41 that already re-exports `setSourceUrl`/`deleteSeries`), and change `function renderPort()` (line ~60) to `export function renderPort()`.

- [ ] **Step 5: Run integration to verify green**

Run: `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration -- services` and `npm run typecheck`
Expected: PASS — both reclassify tests pass.

- [ ] **Step 6: Add the CLI `reclassify-source` command + `--render` on `backfill`**

In `scripts/cleanup-series.ts`:

1. Import `reclassifySource` and `renderPort` from `../src/server/services/index` (add to the existing import block).
2. In `main`, strip `--render` too and detect it:

```ts
  const apply = rest.includes('--apply');
  const render = rest.includes('--render');
  const args = rest.filter((a) => a !== '--apply' && a !== '--render');
```

3. Add the command dispatch + change `backfill` to pass `render`:

```ts
    case 'reclassify-source':
      return cmdReclassifySource(args[0], render, apply);
    case 'backfill':
      return cmdBackfill(args[0], render, apply);
```

4. Add `cmdReclassifySource` and update `cmdBackfill`:

```ts
async function cmdReclassifySource(sourceId: string | undefined, render: boolean, apply: boolean): Promise<void> {
  if (!sourceId) throw new UsageError('reclassify-source requires <sourceId>');
  const userId = getCurrentUserId();
  const src = await db.source.findFirst({ where: { id: sourceId, series: { userId } }, select: { id: true, type: true, feedUrl: true, fetchMode: true } });
  if (!src) { console.log(`No source ${sourceId} found for the current user.`); return; }
  if (!apply) {
    console.log(`[dry run] reclassify-source would flip source ${sourceId}:`);
    console.log(`  type ${src.type} → PAGE_WATCH; feedUrl ${src.feedUrl ?? '—'} → null; matcher → WHOLE_FEED; fetchMode ${src.fetchMode}${render ? ' → RENDER' : ' (unchanged)'}`);
    console.log('Re-run with --apply to update.');
    return;
  }
  const res = await reclassifySource(sourceId, { render });
  console.log(res.updated ? `Reclassified source ${sourceId} → PAGE_WATCH${render ? '/RENDER' : ''}.` : `Source ${sourceId} not found.`);
}

async function cmdBackfill(seriesId: string | undefined, render: boolean, apply: boolean): Promise<void> {
  if (!seriesId) throw new UsageError('backfill requires <seriesId>');
  if (render && !renderPort()) throw new UsageError('backfill --render needs RENDER_URL (+ RENDER_SECRET) in the env (point it at the deployed /api/render).');
  if (!apply) {
    console.log(`[dry run] backfill would fetch series ${seriesId}'s active source page${render ? ' via the renderer' : ''} and add missing chapters, reconciling FREE/LOCKED. No network request in dry-run.`);
    console.log('Re-run with --apply to fetch and apply.');
    return;
  }
  const result = await backfillFromToc(seriesId, render ? renderPort() : undefined);
  console.log(`Backfill complete: added ${result.added} chapter(s), reconciled ${result.reconciled}.`);
}
```

5. Add to `usage()`: `  reclassify-source <sourceId> [--render]` and note `[--render]` on the `backfill` line.

Note: `backfillFromToc(seriesId, fetchImpl?)` defaults `fetchImpl` to `fetchPort`; passing `undefined` uses that default (plain). `render ? renderPort() : undefined` therefore selects render-or-plain. `getCurrentUserId` is already imported in the CLI.

- [ ] **Step 7: Verify CLI compiles + run a dry-run**

Run: `npm run typecheck` and `npm run db:cleanup -- reclassify-source nonexistent-id` (dry-run, local dev DB — prints "No source … found", makes no writes).
Expected: typecheck clean; the CLI runs without error.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/cleanup.ts src/server/services/index.ts scripts/cleanup-series.ts tests/integration/services.test.ts
git commit -m "WP-34: reclassifySource flip + CLI (reclassify-source, backfill --render); export renderPort

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `switchToPageWatch` service + `POST /api/series/[id]/switch`

The "Track unlocks" action: flip + silent backfill with plain→render escalation, exposed as an endpoint.

**Files:**
- Modify: `src/server/services/cleanup.ts` (add `switchToPageWatch`)
- Modify: `src/server/services/index.ts` (re-export `switchToPageWatch`)
- Create: `src/app/api/series/[id]/switch/route.ts`
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `reclassifySource`, `backfillFromToc`, `renderPort`, `fetchPort`.
- Produces: `switchToPageWatch(seriesId, ports?): Promise<{ ok: boolean; added: number; reconciled: number; fetchMode: 'PLAIN' | 'RENDER'; rendered: boolean }>` where `ports = { fetchImpl?: FetchImpl; renderImpl?: FetchImpl }` defaults to `{ fetchImpl: fetchPort, renderImpl: renderPort() }`.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/services.test.ts` (import `switchToPageWatch`):

```ts
  test('WP-34: switchToPageWatch flips FEED→PAGE_WATCH and render-seeds a CF TOC silently', async () => {
    const url = 'https://paid.example/novel/q/';
    const feedUrl = 'https://paid.example/feed/';
    // Add as FEED with an EMPTY feed window → 0 chapters seeded (clean baseline for the switch).
    const { seriesId } = await addSeries(
      { url },
      fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS('')) }),
    );

    // Plain fetch of the TOC fails (CF-blocked); render returns the real TOC.
    const plain = fetchFrom({}); // everything 404 → backfill reads nothing
    const rendered = fetchFrom({
      [url]: okRes(`<html><body><ul>
        <li><a href="https://paid.example/novel/q/ch-1/">Chapter 1</a></li>
        <li class="premium"><a href="https://paid.example/novel/q/ch-2/">Chapter 2</a></li>
      </ul></body></html>`),
    });

    const res = await switchToPageWatch(seriesId, { fetchImpl: plain, renderImpl: rendered });

    expect(res.ok).toBe(true);
    expect(res.rendered).toBe(true);
    expect(res.fetchMode).toBe('RENDER');
    const src = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(src.type).toBe('PAGE_WATCH');
    expect(src.fetchMode).toBe('RENDER');
    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([
      'https://paid.example/novel/q/ch-1/',
      'https://paid.example/novel/q/ch-2/',
    ]);
    expect(chapters.find((c) => c.url.endsWith('ch-2/'))!.access).toBe('LOCKED');
  });

  test('WP-34: switchToPageWatch with a plain-readable TOC stays PLAIN (no render)', async () => {
    const url = 'https://free.example/novel/r/';
    const feedUrl = 'https://free.example/feed/';
    const { seriesId } = await addSeries(
      { url },
      fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS('')) }),
    );
    const plain = fetchFrom({
      [url]: okRes(`<html><body><ul><li><a href="https://free.example/novel/r/ch-1/">Chapter 1</a></li></ul></body></html>`),
    });

    const res = await switchToPageWatch(seriesId, { fetchImpl: plain, renderImpl: fetchFrom({}) });

    expect(res.rendered).toBe(false);
    expect(res.fetchMode).toBe('PLAIN');
    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('PLAIN');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration -- services`
Expected: FAIL — `switchToPageWatch` not defined.

- [ ] **Step 3: Implement `switchToPageWatch`**

In `src/server/services/cleanup.ts` (it can import `backfillFromToc`, `fetchPort`, `renderPort`, `reclassifySource` — if any are in `index.ts`, import from `./index`; keep no cycle by importing the specific module where each lives). Given `backfillFromToc`/`fetchPort`/`renderPort` live in `index.ts` and `cleanup.ts` is imported *by* `index.ts`, put `switchToPageWatch` in **`index.ts`** instead (below `backfillFromToc`) to avoid a cycle:

```ts
/** WP-34 "Track unlocks": flip the active FEED source to PAGE_WATCH and silently seed the TOC.
 *  Reads plain first; if that produced nothing (CF-blocked / empty) and a renderer is available,
 *  retries via render and persists fetchMode RENDER. Silent — backfill fires no pushes. */
export async function switchToPageWatch(
  seriesId: string,
  ports: { fetchImpl?: FetchImpl; renderImpl?: FetchImpl } = {},
): Promise<{ ok: boolean; added: number; reconciled: number; fetchMode: 'PLAIN' | 'RENDER'; rendered: boolean }> {
  const fetchImpl = ports.fetchImpl ?? fetchPort;
  const renderImpl = 'renderImpl' in ports ? ports.renderImpl : renderPort();
  const userId = getCurrentUserId();
  const source = await db.source.findFirst({
    where: { seriesId, isActive: true, series: { userId } },
    select: { id: true, type: true },
  });
  if (!source || source.type !== 'FEED') {
    return { ok: false, added: 0, reconciled: 0, fetchMode: 'PLAIN', rendered: false };
  }

  await reclassifySource(source.id); // → PAGE_WATCH / PLAIN
  const plain = await backfillFromToc(seriesId, fetchImpl);
  let added = plain.added;
  let reconciled = plain.reconciled;
  let fetchMode: 'PLAIN' | 'RENDER' = 'PLAIN';
  let rendered = false;

  // Plain read produced nothing (CF-blocked or empty). Escalate to render if we have one.
  if (renderImpl && plain.added === 0 && plain.reconciled === 0) {
    const r = await backfillFromToc(seriesId, renderImpl);
    if (r.added > 0 || r.reconciled > 0) {
      await db.source.update({ where: { id: source.id }, data: { fetchMode: 'RENDER' } });
      added = r.added;
      reconciled = r.reconciled;
      fetchMode = 'RENDER';
      rendered = true;
    }
  }
  return { ok: true, added, reconciled, fetchMode, rendered };
}
```

- [ ] **Step 4: Run integration to verify green**

Run: `DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration -- services` and `npm run typecheck`
Expected: PASS — both switch tests pass (CF case → RENDER + 2 chapters incl. a LOCKED one; plain case → PLAIN).

- [ ] **Step 5: Add the route**

Create `src/app/api/series/[id]/switch/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { switchToPageWatch } from '../../../../../server/services';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await switchToPageWatch(id);
  if (!result.ok) {
    return NextResponse.json({ error: 'Series has no active FEED source to switch.' }, { status: 400 });
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/index.ts "src/app/api/series/[id]/switch/route.ts" tests/integration/services.test.ts
git commit -m "WP-34: switchToPageWatch (flip + silent render-backfill) + POST /api/series/[id]/switch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: In-app "Track unlocks" button

Add a detail-page button (shown only for FEED series) that POSTs to `/switch`, mirroring the existing "Backfill from TOC" button.

**Files:**
- Modify: `src/app/(app)/series/[id]/page.tsx` (thread the active source `type` into `SeriesDetail`)
- Modify: `src/app/(app)/series/[id]/SeriesDetail.tsx` (props, `switch()` handler, state, button)

**Interfaces:** Consumes `POST /api/series/[id]/switch` (Task 4).

- [ ] **Step 1: Thread the source type into `SeriesDetail`**

In `src/app/(app)/series/[id]/page.tsx`, pass the active source's type to the client component. Add to the `<SeriesDetail … />` props (near where `id`/chapters are passed):

```tsx
        sourceType={active?.type ?? 'PAGE_WATCH'}
```

- [ ] **Step 2: Add the prop, handler, state, and button to `SeriesDetail`**

In `src/app/(app)/series/[id]/SeriesDetail.tsx`:

1. Add `sourceType: 'FEED' | 'PAGE_WATCH';` to the props interface (around line 24-30).
2. Add state near the other `useState`s: `const [switchMessage, setSwitchMessage] = useState<string | null>(null);`
3. Add the handler (mirror `backfill()`):

```ts
  async function trackUnlocks() {
    setBusy(true);
    setSwitchMessage(null);
    try {
      const res = await fetch(`/api/series/${props.id}/switch`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()) as { added: number; fetchMode: string; rendered: boolean };
      setSwitchMessage(`Switched · ${r.added} chapters${r.rendered ? ' · rendered' : ''}`);
      router.refresh();
    } catch {
      setSwitchMessage('Switch failed');
    } finally {
      setBusy(false);
    }
  }
```

4. Render the button only for a FEED series, next to the existing "Backfill from TOC" control:

```tsx
        {props.sourceType === 'FEED' && (
          <div className="control">
            <span className="control__label">Lock-monitoring</span>
            <button type="button" className="control__action" disabled={busy} onClick={() => void trackUnlocks()}>
              Track unlocks (switch to TOC)
            </button>
            {switchMessage && <span className="control__hint" role="status">{switchMessage}</span>}
          </div>
        )}
```

- [ ] **Step 3: Typecheck + build-lint**

Run: `npm run typecheck`
Expected: clean (the new prop is provided by `page.tsx`; `router`/`busy`/`useState` are already in scope from the backfill pattern).

- [ ] **Step 4: Verify in the running app (browser)**

Use the `run` skill (or `example-skills:webapp-testing`) to launch the app, open a FEED series' detail page, confirm the "Track unlocks (switch to TOC)" button renders (and is absent on a PAGE_WATCH series), and that clicking it hits `/api/series/[id]/switch` and shows the result hint. (The switch *logic* is covered by Task 4's integration tests; this step confirms the button wiring + conditional render.) Capture the outcome.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/series/[id]/page.tsx" "src/app/(app)/series/[id]/SeriesDetail.tsx"
git commit -m "WP-34: detail-page 'Track unlocks' button (FEED series → POST /switch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: PLAN.md + final verification

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Update `PLAN.md`**

1. In the **▶ Active queue** table, remove the WP-34 row (completed WPs live in the Completed sentence) and set the next-priority row to `NEXT` (WP-49 is done; the next actionable is WP-30 or WP-29 per current order — set whichever is now top-of-queue).
2. Add WP-34 to the **✅ Completed** list line.
3. Update **Current focus**: replace the "NEXT: WP-34 …" block with the new NEXT; add WP-34 to "Recently landed (newest first)".
4. Add a **Changelog** entry dated **2026-08-12**:

```markdown
- **2026-08-12** — **WP-34 done: feed→TOC switch to lock-monitoring (backend + CLI + in-app button).** Add-time
  lock-detect diverts a readable locked-TOC feed to PAGE_WATCH; a `reclassifySource` flip primitive + `switchToPageWatch`
  (flip + silent render-escalating backfill) power a detail-page **"Track unlocks"** button (`POST /api/series/[id]/switch`)
  and CLI (`reclassify-source [--render]`, `backfill --render`); `parseToc` drops `chapter.permalink`-style stubs.
  **Render-clears-CF validated** against a real CF site (deployed `/api/render` returned the full TOC where a plain
  fetch 403s) — but it's a **subset**: stronger CF challenges still defeat headless, and those stay WP-29. `--render`
  from the CLI needs `RENDER_URL`/`RENDER_SECRET` in the local env pointing at the deployed renderer. **Deferred:**
  number-keyed transition reconcile (unvalidatable without a dual-source site); broader anchor filtering → WP-32.
```

- [ ] **Step 2: Full verification**

Run: `npm test && DATABASE_URL="postgresql://jolsen@localhost:5432/webnovel_test" npm run test:integration && npm run typecheck`
Expected: all green. Paste the fresh output when claiming done.

- [ ] **Step 3: Commit**

```bash
git add PLAN.md
git commit -m "WP-34: mark done in PLAN.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **`switchToPageWatch` lives in `index.ts`, not `cleanup.ts`** — it depends on `backfillFromToc`/`fetchPort`/`renderPort` which live in `index.ts`, and `index.ts` imports `cleanup.ts` (not vice-versa). Putting it in `cleanup.ts` would create an import cycle. `reclassifySource` (pure DB, no such deps) goes in `cleanup.ts` and is re-exported by `index.ts`.
- **The escalation heuristic** (`plain.added === 0 && plain.reconciled === 0` → render) reliably means "the plain TOC read produced nothing" — on a switch, a *successful* plain read of a series that still holds its feed chapters reconciles them (UNKNOWN→access), so `reconciled > 0`. The only false-render is a genuinely-empty series, which is harmless.
- **CLI `--render` needs local render creds.** `renderPort()` reads `RENDER_URL`/`RENDER_SECRET`; those aren't in `.env.prod` today, so `backfill --render` / a `--render` reclassify+backfill flow from the CLI requires adding them (pointing at the deployed `/api/render`). The **in-app button** runs on Vercel where `RENDER_URL` is set, so it needs no local config. The CLI errors clearly if `--render` is set without a configured renderer.
- **Do not prune on switch** — `switchToPageWatch` reconciles the existing (feed) chapters against the TOC; the wrong-feed re-point (which *does* prune) is the separate CLI `reclassify-source` + `prune-chapters` flow.
```