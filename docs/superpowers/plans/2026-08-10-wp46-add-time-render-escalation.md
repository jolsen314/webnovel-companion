# WP-46 — Add-time Render Escalation + Poll Regression Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CF-blocked and JS-rendered-TOC series addable by escalating `addSeries` to our own headless renderer (last resort before it throws, and when a plain TOC under-reads), and stop the poll from pinning genuinely-small series to expensive renders.

**Architecture:** Thread the existing `renderPort()` into `addSeries` as a new optional `render` port. Refactor the add-time resolution into an inner `resolveFrom(pageResult, bodyMode)` so it can run twice — once on the plain fetch, once on a rendered body after a hard fetch failure. A PAGE_WATCH branch whose plain TOC reads ≤5 render-and-compares, keeping the rendered chapters only if there are strictly more. Persist `Source.fetchMode = 'RENDER'` when we adopt render. Separately, change the poll's escalation trigger from `read ≤ 5` to `read ≤ 5 AND read < stored count` (a regression signal), which is memory-free and never pins a genuinely-small series.

**Tech Stack:** TypeScript (strict), Vitest (unit + integration projects), Prisma/Postgres, the existing `makeRenderFetch` → `/api/render` headless renderer.

## Global Constraints

- **Keep `src/lib/**` pure and Next-free** — no `next`/`prisma`/`fs`/network imports. (This WP edits `src/server/services/**`, which is allowed to be Prisma-bound at the `index.ts` edge; the orchestration in `addSeries.ts`/`poll.ts` stays pure over injected ports.)
- **TDD** — no production code without a failing test first; red → green → refactor.
- **Verify before "done"** — `npm test` + `npm run typecheck` with fresh output in the same message before any completion claim.
- **Anonymity** — no real site/series names in committed code or docs; use `*.example` hosts in tests.
- **`RENDER_ESCALATION_MAX = 5`** — the shared under-read threshold (already in `poll.ts`).
- **Graceful degradation** — when no `render` port is present (`RENDER_URL` unset, tests that don't inject one), add behavior must be byte-for-byte today's.

---

### Task 1: Structural prep — extract `resolveFrom`, add `fetchMode`, export the threshold

Refactor `addSeries` into an inner `resolveFrom(pageResult, bodyMode)` (no behavior change), add a `fetchMode` field to the resolved source, persist it, and export `RENDER_ESCALATION_MAX` for reuse. No render logic yet.

**Files:**
- Modify: `src/server/services/addSeries.ts` (the whole `addSeries` body, `ResolvedSource` interface)
- Modify: `src/server/services/index.ts:376-408` (the `createSeries` port)
- Modify: `src/server/services/poll.ts:242` (export the constant)
- Test: `tests/unit/server/addSeries.test.ts`

**Interfaces:**
- Produces: `ResolvedSource` gains `fetchMode: 'PLAIN' | 'RENDER'`. `RENDER_ESCALATION_MAX` is exported from `poll.ts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/server/addSeries.test.ts` inside the top `describe('addSeries', …)`:

```ts
test('a normally-resolved source carries fetchMode PLAIN', async () => {
  const url = 'https://translator.example/novel/alpha/';
  const feedUrl = 'https://translator.example/feed/';
  const p = ports({
    [url]: ok(PAGE(feedUrl)),
    [feedUrl]: ok(RSS(ITEM('g1', 'https://translator.example/alpha-1/'))),
  });

  const result = await addSeries({ url }, p);

  expect(result.resolved.fetchMode).toBe('PLAIN');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- addSeries`
Expected: FAIL — `fetchMode` does not exist on `result.resolved` (type error / undefined).

- [ ] **Step 3: Export the threshold from `poll.ts`**

In `src/server/services/poll.ts`, change line 242 from:

```ts
const RENDER_ESCALATION_MAX = 5;
```

to:

```ts
export const RENDER_ESCALATION_MAX = 5;
```

- [ ] **Step 4: Add `fetchMode` to `ResolvedSource` and refactor `addSeries` to `resolveFrom`**

In `src/server/services/addSeries.ts`, add the field to the interface (after `type`):

```ts
export interface ResolvedSource {
  seriesTitle: string;
  sourceUrl: string;
  host: string;
  feedUrl: string | null;
  tocUrl: string | null; // WP-37: separate chapter-TOC page, when discoverable
  type: 'FEED' | 'PAGE_WATCH';
  fetchMode: 'PLAIN' | 'RENDER'; // WP-46: RENDER when the source needs our headless renderer
  match: SeriesMatch;
  chapters: FeedItem[];
  canonicalId: string; // WP-39
}
```

Then replace the entire `addSeries` function body (lines 83-156) with the extracted version. `bodyMode` records where the page body came from so a PAGE_WATCH resolution can persist RENDER; only `'PLAIN'` is passed for now, so behavior is unchanged:

```ts
export async function addSeries(input: AddSeriesInput, ports: AddSeriesPorts): Promise<AddSeriesResult> {
  const { url } = input;
  const host = new URL(url).host;

  /** Resolve a fetched page into a FEED or PAGE_WATCH source, or null when neither a feed nor
   *  the page itself is reachable. `bodyMode` records whether `pageResult` came from a headless
   *  render, so a PAGE_WATCH resolution can persist RENDER (a feed is always fetched plainly). */
  const resolveFrom = async (
    pageResult: PoliteResult,
    bodyMode: 'PLAIN' | 'RENDER',
  ): Promise<AddSeriesResult | null> => {
    const pageOk = pageResult.outcome === 'SUCCESS' && !pageResult.notModified;
    const pageBody = pageOk ? pageResult.body : '';
    const pageTitle = pageOk ? extractSeriesTitle(pageBody, { siteName: host }) : null;

    // Candidate feeds: advertised <link alternate> if we could read the page, else common
    // WordPress/Blogger guesses. Guesses are tried even when the page fetch FAILED —
    // Cloudflare frequently challenges the HTML page while `/feed/` still serves.
    const advertised = pageOk ? discoverFeeds(pageBody, url).map((f) => f.url) : [];
    const candidates = advertised.length > 0 ? advertised : guessFeedUrls(url);

    let feedUrl: string | null = null;
    let feedBody: string | null = null;
    for (const candidate of candidates) {
      const r = await ports.fetch(candidate);
      if (r.outcome === 'SUCCESS' && !r.notModified && looksLikeFeed(r.body)) {
        feedUrl = candidate;
        feedBody = r.body;
        break;
      }
    }

    // A feed is reachable → track via FEED (works even if the page itself was blocked). A feed
    // is fetched plainly at poll time (render never helps XML), so FEED is always PLAIN.
    if (feedUrl !== null && feedBody !== null) {
      const parsed = await parseFeed(feedBody);
      const usedGuesses = advertised.length === 0;
      const positive = chooseSeriesMatch(parsed.items, url);
      const match = positive ?? (usedGuesses ? fallbackSeriesMatch(parsed.items, url) : { type: 'WHOLE_FEED' });
      const feedChapters = filterBySeriesMatch(parsed.items, match);
      const toc = pageOk ? parseToc(pageBody, url) : [];
      const chapters = pageOk ? withReadingPositions(mergeFeedAndToc(feedChapters, toc), toc) : feedChapters;
      const seriesTitle =
        input.title ??
        pageTitle ??
        (positive?.type === 'CATEGORY'
          ? positive.value
          : match.type === 'WHOLE_FEED'
            ? (parsed.title != null && !matchesSiteName(parsed.title, host) ? parsed.title : titleFromUrl(url))
            : titleFromUrl(url));
      const tocUrl = pageOk ? findTocUrl(pageBody, url) : null;
      const core: ResolvedCore = {
        seriesTitle, sourceUrl: url, host, feedUrl, tocUrl, type: 'FEED', fetchMode: 'PLAIN', match, chapters,
      };
      return finalize(core, ports);
    }

    // No feed, but the page loads → page-watch mode. Seed from the TOC so the first poll diffs
    // against a known set instead of re-reporting the whole backlog.
    if (pageOk) {
      const tocUrl = findTocUrl(pageBody, url);
      const toc = parseToc(pageBody, url);
      const core: ResolvedCore = {
        seriesTitle: input.title ?? pageTitle ?? titleFromUrl(url),
        sourceUrl: url,
        host,
        feedUrl: null,
        tocUrl,
        type: 'PAGE_WATCH',
        fetchMode: bodyMode,
        match: { type: 'WHOLE_FEED' },
        chapters: withReadingPositions(toc, toc),
      };
      return finalize(core, ports);
    }

    return null;
  };

  const plain = await ports.fetch(url);
  const resolved = await resolveFrom(plain, 'PLAIN');
  if (resolved) return resolved;

  // Neither the page nor any feed is reachable.
  throw new Error(
    `Couldn’t reach ${host} or find a feed for it — the site may be blocking automated requests (e.g. Cloudflare).`,
  );
}
```

- [ ] **Step 5: Persist `fetchMode` in `createSeries`**

In `src/server/services/index.ts`, inside the `sources.create` object (around line 383-391), add the field:

```ts
          sources: {
            create: {
              url: r.sourceUrl,
              host: r.host,
              type: r.type,
              fetchMode: r.fetchMode, // WP-46
              feedUrl: r.feedUrl,
              tocUrl: r.tocUrl, // WP-37
              matchType: r.match.type,
              matchValue: 'value' in r.match ? r.match.value : null,
            },
          },
```

- [ ] **Step 6: Run tests + typecheck to verify green**

Run: `npm test && npm run typecheck`
Expected: PASS — the new `fetchMode PLAIN` test passes and every existing `addSeries` test still passes (pure refactor).

- [ ] **Step 7: Commit**

```bash
git add src/server/services/addSeries.ts src/server/services/index.ts src/server/services/poll.ts tests/unit/server/addSeries.test.ts
git commit -m "WP-46: extract resolveFrom, add ResolvedSource.fetchMode, export RENDER_ESCALATION_MAX

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Hard-fail render escalation

Add an optional `render` port. When the plain resolution fails outright (no feed and the page was blocked), render the page once and re-resolve against the rendered body; a rendered TOC becomes a PAGE_WATCH source with `fetchMode: 'RENDER'`. Wire the real `renderPort()` into the index wrapper.

**Files:**
- Modify: `src/server/services/addSeries.ts` (`AddSeriesPorts`, the tail of `addSeries`)
- Modify: `src/server/services/index.ts:367` (the `addSeries` wrapper — new `render` param)
- Test: `tests/unit/server/addSeries.test.ts` (extend the `ports()` factory + new cases)

**Interfaces:**
- Consumes: `resolveFrom(pageResult, bodyMode)`, `RENDER_ESCALATION_MAX` (Task 1).
- Produces: `AddSeriesPorts` gains `render?: (url: string, opts?: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>`. The `ports()` test factory gains a 3rd positional arg `render?: Record<string, PoliteResult>` and returns a `renderCalls: string[]` recorder.

- [ ] **Step 1: Extend the test `ports()` factory to support a render port**

In `tests/unit/server/addSeries.test.ts`, replace the `ports(...)` factory (lines 21-36) with:

```ts
function ports(
  map: Record<string, PoliteResult>,
  existing: (canonicalId: string) => { seriesId: string } | null = () => null,
  render?: Record<string, PoliteResult>,
): AddSeriesPorts & { created: ResolvedSource[]; renderCalls: string[] } {
  const created: ResolvedSource[] = [];
  const renderCalls: string[] = [];
  const base = {
    created,
    renderCalls,
    fetch: async (url: string) => map[url] ?? ({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult),
    findSeriesByCanonicalId: async (canonicalId: string) => existing(canonicalId),
    listExistingSeries: async () => [],
    createSeries: async (resolved: ResolvedSource) => {
      created.push(resolved);
      return { seriesId: 'new1' };
    },
  };
  if (!render) return base;
  return {
    ...base,
    render: async (url: string) => {
      renderCalls.push(url);
      return render[url] ?? ({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult);
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

Add to the top `describe('addSeries', …)`:

```ts
test('hard-fail: page + feeds blocked, but render recovers the TOC → PAGE_WATCH, fetchMode RENDER', async () => {
  const url = 'https://cf.example/series/omega/';
  const rendered = `<html><body><h1>Omega</h1><ul>
    <li><a href="https://cf.example/series/omega/chapter-1/">Chapter 1</a></li>
    <li><a href="https://cf.example/series/omega/chapter-2/">Chapter 2</a></li>
  </ul></body></html>`;
  const p = ports(
    { [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult }, // page CF-blocked; feeds 404 by default
    () => null,
    { [url]: ok(rendered) }, // our render clears the challenge
  );

  const result = await addSeries({ url }, p);

  expect(result.resolved.type).toBe('PAGE_WATCH');
  expect(result.resolved.fetchMode).toBe('RENDER');
  expect(result.resolved.seriesTitle).toBe('Omega'); // from the rendered <h1>
  expect(result.resolved.chapters.map((c) => c.url)).toEqual([
    'https://cf.example/series/omega/chapter-1/',
    'https://cf.example/series/omega/chapter-2/',
  ]);
  expect(p.renderCalls).toEqual([url]);
});

test('hard-fail: render reveals a non-guessable advertised feed → FEED source, fetchMode PLAIN', async () => {
  const url = 'https://cf.example/novel/psi/';
  const feedUrl = 'https://cf.example/custom-feed.xml'; // not one guessFeedUrls would produce
  const p = ports(
    {
      [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult,
      [feedUrl]: ok(RSS(ITEM('g1', 'https://cf.example/psi-1/', 'Psi'))),
    },
    () => null,
    { [url]: ok(PAGE(feedUrl)) }, // rendered body advertises the feed
  );

  const result = await addSeries({ url }, p);

  expect(result.resolved.type).toBe('FEED');
  expect(result.resolved.feedUrl).toBe(feedUrl);
  expect(result.resolved.fetchMode).toBe('PLAIN'); // the feed serves plainly
});

test('hard-fail: render also fails → throws', async () => {
  const url = 'https://cf.example/novel/void/';
  const p = ports(
    { [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult },
    () => null,
    { [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult }, // render blocked too
  );

  await expect(addSeries({ url }, p)).rejects.toThrow(/reach|feed/i);
});
```

(The existing "neither the page nor any feed is reachable → throws" test at line 151 already covers the no-render-port case — it must stay green.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- addSeries`
Expected: FAIL — the hard-fail cases still hit the throw (no render escalation yet); `p.render` is defined but unused.

- [ ] **Step 4: Add the `render` port to `AddSeriesPorts`**

In `src/server/services/addSeries.ts`, add to the `AddSeriesPorts` interface:

```ts
export interface AddSeriesPorts {
  fetch: (url: string, opts?: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>;
  render?: (url: string, opts?: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>; // WP-46: headless renderer, last resort
  createSeries: (resolved: ResolvedSource) => Promise<{ seriesId: string }>;
  findSeriesByCanonicalId: (canonicalId: string) => Promise<{ seriesId: string } | null>; // WP-39
  listExistingSeries: () => Promise<{ id: string; title: string }[]>; // WP-39b
}
```

- [ ] **Step 5: Add the hard-fail render escalation**

In `src/server/services/addSeries.ts`, replace the tail of `addSeries` (the `const plain = …` / throw block) with:

```ts
  const plain = await ports.fetch(url);
  const resolved = await resolveFrom(plain, 'PLAIN');
  if (resolved) return resolved;

  // Hard-fail: neither the page nor any feed was reachable plainly. Our own render clears
  // Cloudflare's JS managed challenge (WP-40 spike), so try it once before giving up.
  if (ports.render) {
    const rendered = await ports.render(url);
    if (rendered.outcome === 'SUCCESS' && !rendered.notModified) {
      const viaRender = await resolveFrom(rendered, 'RENDER');
      if (viaRender) return viaRender;
    }
  }

  // Only claim a render attempt when we actually had a renderer (prod always does; local/tests may not).
  throw new Error(
    ports.render
      ? `Couldn’t reach ${host} or find a feed for it, even after a render attempt — the site may be blocking automated requests (e.g. Cloudflare).`
      : `Couldn’t reach ${host} or find a feed for it — the site may be blocking automated requests (e.g. Cloudflare).`,
  );
```

- [ ] **Step 6: Wire `renderPort()` into the index wrapper**

In `src/server/services/index.ts`, change the `addSeries` wrapper signature (line 367) to accept an injectable render impl (defaulting to the real one), and pass it into the core ports:

```ts
export function addSeries(
  input: AddSeriesInput,
  fetchImpl: FetchImpl = fetchPort,
  renderImpl: FetchImpl | undefined = renderPort(),
): Promise<AddSeriesResult> {
  return addSeriesCore(input, {
    fetch: fetchImpl,
    render: renderImpl,
    findSeriesByCanonicalId: async (canonicalId) => {
```

(Leave the rest of the wrapper body unchanged.)

- [ ] **Step 7: Run tests + typecheck to verify green**

Run: `npm test && npm run typecheck`
Expected: PASS — all three new hard-fail tests pass; the existing no-render throw test still passes.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/addSeries.ts src/server/services/index.ts tests/unit/server/addSeries.test.ts
git commit -m "WP-46: hard-fail add escalates to our headless renderer before throwing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Under-fetch render-and-compare (PAGE_WATCH branch)

When a plain PAGE_WATCH TOC reads ≤5 chapters and a renderer exists, render it and keep the rendered chapters only if there are strictly more; adopting render sets `fetchMode: 'RENDER'`. The FEED branch never render-escalates.

**Files:**
- Modify: `src/server/services/addSeries.ts` (the PAGE_WATCH branch inside `resolveFrom`)
- Test: `tests/unit/server/addSeries.test.ts`

**Interfaces:**
- Consumes: `RENDER_ESCALATION_MAX` (import into `addSeries.ts`), `ports.render` (Task 2).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/server/addSeries.test.ts`:

```ts
test('under-fetch: plain TOC ≤5 and render yields more → adopt rendered chapters, fetchMode RENDER', async () => {
  const url = 'https://reader.example/series/rho/';
  const plainToc = `<html><body><ul>
    <li><a href="https://reader.example/series/rho/chapter-1/">Chapter 1</a></li>
  </ul></body></html>`;
  const renderedToc = `<html><body><ul>${Array.from(
    { length: 8 },
    (_, i) => `<li><a href="https://reader.example/series/rho/chapter-${i + 1}/">Chapter ${i + 1}</a></li>`,
  ).join('')}</ul></body></html>`;
  const p = ports({ [url]: ok(plainToc) }, () => null, { [url]: ok(renderedToc) });

  const result = await addSeries({ url }, p);

  expect(result.resolved.type).toBe('PAGE_WATCH');
  expect(result.resolved.fetchMode).toBe('RENDER');
  expect(result.resolved.chapters).toHaveLength(8);
  expect(p.renderCalls).toEqual([url]); // no tocUrl on the page → renders url
});

test('under-fetch: plain TOC ≤5 and render yields no more → keep plain, fetchMode PLAIN', async () => {
  const url = 'https://reader.example/series/sigma/';
  const plainToc = `<html><body><ul>
    <li><a href="https://reader.example/series/sigma/chapter-1/">Chapter 1</a></li>
    <li><a href="https://reader.example/series/sigma/chapter-2/">Chapter 2</a></li>
  </ul></body></html>`;
  const renderedToc = `<html><body><ul>
    <li><a href="https://reader.example/series/sigma/chapter-1/">Chapter 1</a></li>
  </ul></body></html>`; // fewer — render didn't help
  const p = ports({ [url]: ok(plainToc) }, () => null, { [url]: ok(renderedToc) });

  const result = await addSeries({ url }, p);

  expect(result.resolved.fetchMode).toBe('PLAIN');
  expect(result.resolved.chapters).toHaveLength(2);
  expect(p.renderCalls).toEqual([url]); // we tried, but kept plain
});

test('rich plain TOC (>5) → no render call, fetchMode PLAIN', async () => {
  const url = 'https://reader.example/series/tau/';
  const richToc = `<html><body><ul>${Array.from(
    { length: 7 },
    (_, i) => `<li><a href="https://reader.example/series/tau/chapter-${i + 1}/">Chapter ${i + 1}</a></li>`,
  ).join('')}</ul></body></html>`;
  const p = ports({ [url]: ok(richToc) }, () => null, { [url]: ok('<ul></ul>') });

  const result = await addSeries({ url }, p);

  expect(result.resolved.fetchMode).toBe('PLAIN');
  expect(result.resolved.chapters).toHaveLength(7);
  expect(p.renderCalls).toEqual([]); // never rendered — plain was already rich
});

test('FEED branch never render-escalates, even when it seeds few chapters', async () => {
  const url = 'https://translator.example/novel/upsilon/';
  const feedUrl = 'https://translator.example/feed/';
  const p = ports(
    { [url]: ok(PAGE(feedUrl)), [feedUrl]: ok(RSS(ITEM('g1', 'https://translator.example/ups-1/'))) },
    () => null,
    { [url]: ok('<ul></ul>') },
  );

  const result = await addSeries({ url }, p);

  expect(result.resolved.type).toBe('FEED');
  expect(result.resolved.fetchMode).toBe('PLAIN');
  expect(p.renderCalls).toEqual([]); // feed is the source of truth; no render
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- addSeries`
Expected: FAIL — the under-fetch cases resolve PLAIN with the tiny plain TOC; `renderCalls` is empty where RENDER was expected.

- [ ] **Step 3: Import the threshold**

In `src/server/services/addSeries.ts`, add to the imports at the top:

```ts
import { RENDER_ESCALATION_MAX } from './poll';
```

- [ ] **Step 4: Add the under-fetch render-and-compare to the PAGE_WATCH branch**

In `resolveFrom`, replace the `if (pageOk) { … }` block with:

```ts
    if (pageOk) {
      const tocUrl = findTocUrl(pageBody, url);
      let toc = parseToc(pageBody, url);
      let fetchMode: 'PLAIN' | 'RENDER' = bodyMode;
      // Under-fetch: a plain TOC that reads almost nothing is usually a JS-rendered list that
      // didn't render. Render it and keep the rendered chapters only if there are strictly more.
      // Skipped when we already rendered (bodyMode === 'RENDER') — no double render.
      if (bodyMode === 'PLAIN' && ports.render && toc.length <= RENDER_ESCALATION_MAX) {
        const rendered = await ports.render(tocUrl ?? url);
        if (rendered.outcome === 'SUCCESS' && !rendered.notModified) {
          const rtoc = parseToc(rendered.body, tocUrl ?? url);
          if (rtoc.length > toc.length) {
            toc = rtoc;
            fetchMode = 'RENDER';
          }
        }
      }
      const core: ResolvedCore = {
        seriesTitle: input.title ?? pageTitle ?? titleFromUrl(url),
        sourceUrl: url,
        host,
        feedUrl: null,
        tocUrl,
        type: 'PAGE_WATCH',
        fetchMode,
        match: { type: 'WHOLE_FEED' },
        chapters: withReadingPositions(toc, toc),
      };
      return finalize(core, ports);
    }
```

- [ ] **Step 5: Run tests + typecheck to verify green**

Run: `npm test && npm run typecheck`
Expected: PASS — all four new tests pass. Note the existing PAGE_WATCH tests at addSeries.test.ts:92-120 pass no `render` map, so `ports.render` is undefined and they behave exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/addSeries.ts tests/unit/server/addSeries.test.ts
git commit -m "WP-46: add-time under-fetch render-and-compare for PAGE_WATCH (adopt only if more)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Poll regression guard

Change the poll's escalation trigger from `read ≤ 5` to `read ≤ 5 AND read < stored count`, so only a genuine regression (a plain read that dropped below what we already stored) escalates. Load `stored` before the decision. Update the existing poll unit test to seed a regression, add a genuinely-small no-escalate test, and update the integration test that assumed the old trigger.

**Files:**
- Modify: `src/server/services/poll.ts` (`processFetched`, ~lines 263-288)
- Test: `tests/unit/server/poll.test.ts` (the WP-17b escalation block, ~lines 209-216)
- Test: `tests/integration/services.test.ts:361-367`

**Interfaces:**
- Consumes: `PollPorts.loadStoredChapters`, `RENDER_ESCALATION_MAX`.

- [ ] **Step 1: Update the unit tests (write the failing state)**

In `tests/unit/server/poll.test.ts`, replace the "escalates … when a plain fetch yields ≤5" test (lines 209-216) with a regression version, and add a genuinely-small case right after it:

```ts
test('escalates a PAGE_WATCH source to RENDER when a plain read regresses below stored', async () => {
  const stored = [
    { guid: 's1', url: 'https://x.example/a/chapter-1/' },
    { guid: 's2', url: 'https://x.example/a/chapter-2/' },
    { guid: 's3', url: 'https://x.example/a/chapter-3/' },
  ];
  const p = renderPorts(ok(toc('https://x.example/a/chapter-1/')), ok('<ul></ul>'), stored);
  const effects = await pollSource(
    source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
    p,
  );
  expect(effects.escalateToRender).toBe(true); // plain read 1 < stored 3
});

test('does not escalate a genuinely small series (plain read == stored count)', async () => {
  const stored = [{ guid: 's1', url: 'https://x.example/a/chapter-1/' }];
  const p = renderPorts(ok(toc('https://x.example/a/chapter-1/')), ok('<ul></ul>'), stored);
  const effects = await pollSource(
    source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
    p,
  );
  expect(effects.escalateToRender).toBe(false); // plain read 1, stored 1 → no regression
});
```

- [ ] **Step 2: Run to verify the new regression test fails**

Run: `npm test -- poll`
Expected: FAIL — under the current `≤5` trigger, the genuinely-small case escalates (`escalateToRender` is `true` where `false` is expected).

- [ ] **Step 3: Apply the regression guard in `processFetched`**

In `src/server/services/poll.ts`, restructure the `if (res.outcome === 'SUCCESS')` body (lines 263-288) so `stored` is loaded before the escalation decision and the trigger adds the regression clause:

```ts
  if (res.outcome === 'SUCCESS') {
    if (res.notModified) {
      notModified = true;
    } else {
      etag = res.etag ?? etag;
      lastModified = res.lastModified ?? lastModified;
      const stored = await ports.loadStoredChapters(src.seriesId);
      // FEED: parse the feed and isolate this series. PAGE_WATCH: parse the TOC
      // (already series-scoped) — its chapters carry FREE/LOCKED access.
      let mine: FeedItem[];
      if (src.type === 'PAGE_WATCH') {
        mine = parseToc(res.body, src.fetchUrl);
        // Escalate only when a plain read comes back SMALLER than what we already stored — a
        // real "the TOC stopped rendering" signal. A genuinely small series (read == stored)
        // never regresses, so it is never pinned to expensive renders. (WP-46)
        if (
          ports.renderFetch &&
          src.fetchMode === 'PLAIN' &&
          mine.length <= RENDER_ESCALATION_MAX &&
          mine.length < stored.length
        ) {
          escalateToRender = true;
        }
      } else {
        const parsed = await parseFeed(res.body);
        mine = filterBySeriesMatch(parsed.items, src.match);
      }
      const diff = diffChapters(stored, mine);
      newChapters = diff.new;
      becameFree = diff.becameFree;
      accessReconciled = diff.accessReconciled;
    }
  }
```

- [ ] **Step 4: Update the integration test that assumed the old trigger**

In `tests/integration/services.test.ts`, replace the "a plain page-watch that under-reads escalates …" test (lines 361-367) so the poll read genuinely regresses below the seeded set:

```ts
  test('a plain page-watch that regresses below stored escalates the source to RENDER (renderer available)', async () => {
    // Seed 3 chapters plainly (no render port at add → stays PLAIN, stored = 3).
    const { seriesId } = await addSeries(
      { url: WATCH_URL },
      fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2) + ROW(W3))) }),
    );
    // Next poll's plain read returns only 1 chapter (the TOC failed to render) → 1 < 3 → escalate.
    await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) }), async () => okRes(TOC(ROW(W1))));

    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('RENDER');
  });
```

(The "does not escalate when no renderer is configured" test at lines 369-374 stays green as-is: with no `renderFetch` port the first guard clause short-circuits regardless of counts.)

- [ ] **Step 5: Run tests + typecheck to verify green**

Run: `npm test && npm run typecheck`
Expected: PASS — unit regression + genuinely-small cases pass; the ">5" / "FEED" / "no renderer" unit cases still pass; the updated integration escalation test passes.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/poll.ts tests/unit/server/poll.test.ts tests/integration/services.test.ts
git commit -m "WP-46: poll escalates on regression (read < stored), never pins a genuinely-small series

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add-time escalation integration coverage + PLAN.md + final verify

Prove `fetchMode` persists on the real `Source` row for both add-time escalation paths, flip WP-46 to DONE, and run the full verification.

**Files:**
- Test: `tests/integration/services.test.ts` (new cases in the `addSeries (real DB)` describe)
- Modify: `PLAN.md`

**Interfaces:**
- Consumes: `addSeries(input, fetchImpl, renderImpl)` (Task 2 wrapper), `TOC`/`ROW`/`okRes`/`fetchFrom`/`WATCH_URL`/`W1`/`W2` helpers already in the integration file.

- [ ] **Step 1: Write the failing integration tests**

Add inside `describe('addSeries (real DB)', …)` in `tests/integration/services.test.ts`:

```ts
  test('WP-46: an under-reading plain TOC at add adopts render and persists fetchMode RENDER', async () => {
    const { seriesId } = await addSeries(
      { url: WATCH_URL },
      fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) }), // plain reads 1
      fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }), // render reads 2 (more)
    );
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.fetchMode).toBe('RENDER');
    expect(await db.chapter.count({ where: { seriesId } })).toBe(2);
  });

  test('WP-46: a hard-fail add recovered by render persists a PAGE_WATCH RENDER source', async () => {
    const url = 'https://cf.example/series/omega/';
    const { seriesId } = await addSeries(
      { url },
      fetchFrom({ [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult }), // page + feeds blocked
      fetchFrom({ [url]: okRes(TOC(ROW('https://cf.example/series/omega/chapter-1/'))) }),
    );
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.type).toBe('PAGE_WATCH');
    expect(source.fetchMode).toBe('RENDER');
  });
```

- [ ] **Step 2: Run to verify they pass (behavior already implemented in Tasks 2-3)**

Run: `npm test -- integration`
Expected: PASS — these assert the already-implemented add-time escalation against the real DB, confirming the `createSeries` `fetchMode` wire. If either fails, fix the wire before proceeding (do not edit the test to match).

- [ ] **Step 3: Update `PLAN.md`**

Make these edits in `PLAN.md`:

1. In the **▶ Active queue** table, change the WP-46 row `Status` from `NEXT` to `DONE` and pick the next priority row (WP-34 is the natural next — it lists WP-46 as its dependency); set that row's status to `NEXT`.
2. Move WP-46 from the Active queue into the **✅ Completed** list line.
3. Update **Current focus** → replace the "NEXT: WP-46" block with the new NEXT, and add WP-46 to "Recently landed (newest first)".
4. Add a **Changelog** entry dated **2026-08-10**:

```markdown
- **2026-08-10** — **WP-46 done: add-time render escalation + poll regression guard.** `addSeries` gained an optional
  `render` port (our own `/api/render`, no third party). Two escalations: (1) **hard-fail** — when the plain page is
  CF-blocked and no feed is reachable, render once and re-resolve the rendered body (a rendered TOC → PAGE_WATCH
  `fetchMode: 'RENDER'`; a revealed advertised feed → FEED PLAIN) before throwing; (2) **under-fetch** — a plain
  PAGE_WATCH TOC reading ≤5 renders and keeps the rendered chapters only if strictly more, persisting `fetchMode`
  accordingly. `ResolvedSource.fetchMode` is now persisted on the `Source` row. Separately, the **poll escalation
  trigger** changed from `read ≤ 5` to `read ≤ 5 AND read < stored count` (a memory-free regression signal), so a
  genuinely-small series is never pinned to RENDER. Add path refactored into an inner `resolveFrom(pageResult,
  bodyMode)` run once on the plain fetch and once on the rendered body. **Limits:** silent-growth-behind-JS (plain
  never regresses) isn't auto-caught — remedy is a one-time render-backfill, which bumps `stored` and thereby arms the
  regression guard; a periodic render-reconcile is a possible future WP. Full detail in the WP-46 design spec.
```

- [ ] **Step 4: Full verification**

Run: `npm test && npm run typecheck`
Expected: PASS — entire unit + integration suite green, typecheck clean. Paste the fresh output when claiming done.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/services.test.ts PLAN.md
git commit -m "WP-46: add-time escalation integration coverage; mark WP-46 done

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Order matters:** Task 1 is a pure refactor whose safety net is the *existing* suite — run the full `npm test` after it, not just `-- addSeries`. Tasks 2-4 are strictly additive behind the optional `render` port, so any test that doesn't inject a render map exercises today's behavior unchanged.
- **`bodyMode` is the whole trick:** a source's `fetchMode` records how *its own* poll URL must be fetched. A feed is always fetched plainly (render never helps XML), so the FEED branch is always `PLAIN` even when the landing page had to be rendered to discover the feed. Only the PAGE_WATCH branch carries `RENDER`.
- **No double render:** the under-fetch block (Task 3) is guarded by `bodyMode === 'PLAIN'`, so a hard-fail path that already rendered (Task 2, `bodyMode === 'RENDER'`) never renders a second time.
- **Don't "fix" a red test by editing the assertion** (Task 5 Step 2). If the DB `fetchMode` doesn't persist, the bug is in the `createSeries` wire (Task 1 Step 5) or the wrapper (Task 2 Step 6).
```