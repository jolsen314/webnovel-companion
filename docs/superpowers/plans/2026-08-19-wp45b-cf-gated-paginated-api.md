# WP-45b — CF-gated render transport + paginated API sources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read a Cloudflare-gated, paginated chapter API end-to-end — clear CF once via the renderer, union all pages, store the complete chapter list with per-chapter access — and close the latent WP-45 gap where a paginated *plain* API read only page 1.

**Architecture:** An API source's fetch becomes "get all pages as one combined body." A pure core (`pageUrl`/`itemsAt`/`isLastPage`) is shared; `fetchApiPages` owns the union, branching by transport — **PLAIN** loops Node-side HTTP GETs, **RENDER** makes *one* `renderFetch` call and the render service does the in-page loop (one browser, one CF clearance, cheap in-page fetches reusing the cookie). Both return one flattened root-array body, so the poll's fetch-once seam and `parseApiChapters` barely change.

**Tech Stack:** TypeScript (strict), Next.js App Router, Prisma/Postgres, Puppeteer (`@sparticuz/chromium`), Vitest.

**Spec:** [docs/superpowers/specs/2026-08-19-wp45b-cf-gated-paginated-api-design.md](../specs/2026-08-19-wp45b-cf-gated-paginated-api-design.md)

## Global Constraints

- **`src/lib/**` stays pure and Next-free** — the pagination core (`lib/feeds/apiPaginate.ts`) is pure. Fetch orchestration lives in `src/server/**`.
- **TDD** for all `lib/` + service logic; failing test first.
- **Verify before "done":** `npm test` + `npm run typecheck`, fresh output, same message.
- **Anonymity:** no real site/series names in code, tests, or docs — `*.example` only. (Runtime logs of a real URL to Vercel are fine; the log *statement* carries no literal host.)
- **One browser per series per poll (load-bearing):** a paginated RENDER source must call `renderFetch` **exactly once** regardless of page count — proven by a call-count test.
- **Additive / non-regressive:** non-paginated API sources and all non-API sources are byte-for-byte unchanged (the `pagination` block is optional; absent → today's single-fetch path).
- **`perPage` is descriptor-driven** (never a hardcoded constant); `maxPages` defaults to 20; a cap-hit is **logged**.

---

### Task 1: Pagination descriptor field + pure core

**Files:**
- Modify: `src/lib/feeds/apiAdapter.ts` (add `PaginationSpec` + `ApiDescriptor.pagination`)
- Create: `src/lib/feeds/apiPaginate.ts`
- Test: `tests/unit/feeds/apiPaginate.test.ts`

**Interfaces:**
- Produces: `export interface PaginationSpec { pageParam: string; perPage: number; maxPages?: number; listPath?: string }`; `ApiDescriptor.pagination?: PaginationSpec`; `pageUrl(baseUrl, pageParam, n)`, `itemsAt(parsed, listPath?)`, `isLastPage(count, perPage)`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/feeds/apiPaginate.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { pageUrl, itemsAt, isLastPage } from '../../../src/lib/feeds/apiPaginate';

describe('pageUrl', () => {
  test('sets the page param, preserving existing query params', () => {
    expect(pageUrl('https://api.example/ch?category=7&order=asc&per_page=200', 'page', 3))
      .toBe('https://api.example/ch?category=7&order=asc&per_page=200&page=3');
  });
  test('replaces an existing page param', () => {
    expect(pageUrl('https://api.example/ch?page=1', 'page', 2)).toBe('https://api.example/ch?page=2');
  });
});

describe('itemsAt', () => {
  test('root array when no listPath', () => {
    expect(itemsAt([{ a: 1 }], undefined)).toEqual([{ a: 1 }]);
  });
  test('nested listPath', () => {
    expect(itemsAt({ data: { chapters: [{ a: 1 }] } }, 'data.chapters')).toEqual([{ a: 1 }]);
  });
  test('drift → []', () => {
    expect(itemsAt({ nope: 1 }, 'data.chapters')).toEqual([]);
    expect(itemsAt(42, undefined)).toEqual([]);
  });
});

describe('isLastPage', () => {
  test('short page is the last', () => {
    expect(isLastPage(18, 200)).toBe(true);
    expect(isLastPage(200, 200)).toBe(false);
    expect(isLastPage(0, 200)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`not defined`): `npm test -- apiPaginate`

- [ ] **Step 3: Implement** — `src/lib/feeds/apiPaginate.ts`:

```ts
/**
 * WP-45b: pure helpers for paginated API sources — build each page's URL, locate the item
 * array, and decide the last page. Shared by the PLAIN Node-side loop (fetchApiPages); the
 * RENDER in-page loop re-implements the same tiny logic inside page.evaluate (browser context
 * can't import this). Pure — no I/O.
 */
export function pageUrl(baseUrl: string, pageParam: string, n: number): string {
  const u = new URL(baseUrl);
  u.searchParams.set(pageParam, String(n));
  return u.toString();
}

export function itemsAt(parsed: unknown, listPath?: string): unknown[] {
  let node: unknown = parsed;
  if (listPath) {
    for (const key of listPath.split('.')) {
      node = node != null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined;
    }
  }
  return Array.isArray(node) ? node : [];
}

export function isLastPage(pageItemCount: number, perPage: number): boolean {
  return pageItemCount < perPage;
}
```

And in `src/lib/feeds/apiAdapter.ts`, add above `ApiDescriptor`:

```ts
export interface PaginationSpec {
  /** Query param to increment (e.g. "page"). */
  pageParam: string;
  /** Page size / the site's cap (e.g. 200) — per-descriptor, never hardcoded. */
  perPage: number;
  /** Runaway backstop (default 20). */
  maxPages?: number;
  /** Dot-path to each page's item array; mirrors ApiDescriptor.listPath. */
  listPath?: string;
}
```

and add to `ApiDescriptor`:

```ts
  /** WP-45b: when present, the source is paginated — fetch every page and union (see fetchApiPages). */
  pagination?: PaginationSpec;
```

- [ ] **Step 4: Run — expect PASS**: `npm test -- apiPaginate`
- [ ] **Step 5: Commit**

```bash
git add src/lib/feeds/apiPaginate.ts src/lib/feeds/apiAdapter.ts tests/unit/feeds/apiPaginate.test.ts
git commit -m "feat(wp-45b): pagination descriptor field + pure page-loop core"
```

---

### Task 2: `fetchApiPages` (union across pages) + the one-browser guarantee

**Files:**
- Modify: `src/server/services/index.ts` (widen `FetchImpl` opts with `pagination?`)
- Create: `src/server/services/apiFetch.ts`
- Test: `tests/unit/server/apiFetch.test.ts`

**Interfaces:**
- Consumes: `pageUrl`/`itemsAt`/`isLastPage` (Task 1); `PaginationSpec`/`ApiDescriptor` (Task 1); `PoliteResult`.
- Produces: `fetchApiPages(baseUrl: string, descriptor: ApiDescriptor, fetchMode: 'PLAIN'|'RENDER', ports: { fetch: FetchImpl; renderFetch?: FetchImpl }, log?: (msg: string) => void): Promise<PoliteResult>`.

- [ ] **Step 1: Widen `FetchImpl`** — in `src/server/services/index.ts` (~line 61), add `pagination?` and the type import:

```ts
import type { ApiDescriptor, PaginationSpec } from '../../lib/feeds/apiAdapter';
// ...
export type FetchImpl = (
  url: string,
  opts?: { etag?: string | null; lastModified?: string | null; pagination?: PaginationSpec },
) => Promise<PoliteResult>;
```
(`fetchPort`/plain fetch ignores `pagination`; the render port will honor it in Task 4.)

- [ ] **Step 2: Write the failing tests** — `tests/unit/server/apiFetch.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';
import { fetchApiPages } from '../../../src/server/services/apiFetch';
import type { ApiDescriptor } from '../../../src/lib/feeds/apiAdapter';
import type { PoliteResult } from '../../../src/lib/feeds/fetch';

const ok = (body: string): PoliteResult => ({ outcome: 'SUCCESS', status: 200, notModified: false, body, etag: null, lastModified: null, finalUrl: 'x' });
const desc = (perPage: number, maxPages?: number): ApiDescriptor => ({ urlField: 'url', titleField: 't', pagination: { pageParam: 'page', perPage, maxPages } });
const items = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ url: `/c${i}`, t: `C${i}` })));

describe('fetchApiPages — PLAIN', () => {
  test('unions pages, stops on the short page, exact fetch count', async () => {
    const fetch = vi.fn(async (u: string) => ok(u.includes('page=2') ? items(18) : items(200)));
    const res = await fetchApiPages('https://api.example/ch?per_page=200', desc(200), 'PLAIN', { fetch });
    expect(fetch).toHaveBeenCalledTimes(2); // page 1 (full) + page 2 (short) → stop
    expect(JSON.parse(res.body!)).toHaveLength(218);
  });
  test('caps at maxPages and logs', async () => {
    const fetch = vi.fn(async () => ok(items(200))); // never short → would run forever
    const log = vi.fn();
    const res = await fetchApiPages('https://api.example/ch', desc(200, 3), 'PLAIN', { fetch }, log);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(res.body!)).toHaveLength(600);
  });
  test('a page failure surfaces the failure outcome', async () => {
    const fetch = vi.fn(async (u: string) => (u.includes('page=2') ? ({ outcome: 'HTTP_5XX', status: 502 } as PoliteResult) : ok(items(200))));
    const res = await fetchApiPages('https://api.example/ch', desc(200), 'PLAIN', { fetch });
    expect(res.outcome).toBe('HTTP_5XX');
  });
});

describe('fetchApiPages — RENDER (the one-browser guarantee)', () => {
  test('calls renderFetch EXACTLY ONCE for a multi-page series, passing pagination', async () => {
    const renderFetch = vi.fn(async () => ok(items(1300))); // service returns the full union
    const fetch = vi.fn();
    const res = await fetchApiPages('https://api.example/ch', desc(200), 'RENDER', { fetch, renderFetch });
    expect(renderFetch).toHaveBeenCalledTimes(1); // ← ONE browser invocation, not one-per-page
    expect(renderFetch.mock.calls[0][1]).toMatchObject({ pagination: { pageParam: 'page', perPage: 200 } });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(res.body!)).toHaveLength(1300);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**: `npm test -- apiFetch`

- [ ] **Step 4: Implement** — `src/server/services/apiFetch.ts`:

```ts
import type { FetchImpl } from './index';
import type { ApiDescriptor } from '../../lib/feeds/apiAdapter';
import type { PoliteResult } from '../../lib/feeds/fetch';
import { pageUrl, itemsAt, isLastPage } from '../../lib/feeds/apiPaginate';

/**
 * WP-45b: fetch every page of a paginated API source and return ONE combined PoliteResult whose
 * body is the flattened root JSON array of all pages' items. Branches by transport:
 *  - PLAIN  → loop ports.fetch page 1..N Node-side (cheap HTTP).
 *  - RENDER → ONE ports.renderFetch call carrying `pagination`; the render service does the
 *             in-page page loop inside a single browser session (clears CF once). We do NOT loop
 *             renderFetch — that would be one browser launch per page and blow the poll budget.
 */
export async function fetchApiPages(
  baseUrl: string,
  descriptor: ApiDescriptor,
  fetchMode: 'PLAIN' | 'RENDER',
  ports: { fetch: FetchImpl; renderFetch?: FetchImpl },
  log: (msg: string) => void = (m) => console.warn(m),
): Promise<PoliteResult> {
  const pg = descriptor.pagination!;
  const maxPages = pg.maxPages ?? 20;

  if (fetchMode === 'RENDER' && ports.renderFetch) {
    // One call — the render service returns the already-unioned root array.
    return ports.renderFetch(baseUrl, { pagination: pg });
  }

  const all: unknown[] = [];
  for (let n = 1; n <= maxPages; n++) {
    const res = await ports.fetch(pageUrl(baseUrl, pg.pageParam, n));
    if (res.outcome !== 'SUCCESS' || res.notModified) return res; // health scores the failure; retry next poll
    let items: unknown[];
    try {
      items = itemsAt(JSON.parse(res.body ?? ''), pg.listPath);
    } catch {
      items = [];
    }
    all.push(...items);
    if (isLastPage(items.length, pg.perPage)) break;
    if (n === maxPages) log(`fetchApiPages: hit page cap ${maxPages} for ${baseUrl}; list may be truncated`);
  }
  return { outcome: 'SUCCESS', status: 200, notModified: false, body: JSON.stringify(all), etag: null, lastModified: null, finalUrl: baseUrl };
}
```

- [ ] **Step 5: Run — expect PASS**: `npm test -- apiFetch` then `npm run typecheck`
- [ ] **Step 6: Commit**

```bash
git add src/server/services/apiFetch.ts src/server/services/index.ts tests/unit/server/apiFetch.test.ts
git commit -m "feat(wp-45b): fetchApiPages — page union; one renderFetch call per series (budget guard)"
```

---

### Task 3: Wire pagination into the poll

**Files:**
- Modify: `src/server/services/poll.ts` (fetch seam ~L394-396; `processFetched` API branch ~L294; import `fetchApiPages`)
- Test: `tests/unit/server/poll.test.ts`

**Interfaces:**
- Consumes: `fetchApiPages` (Task 2). `PollableSource.apiMap` already carries the descriptor (WP-45).

- [ ] **Step 1: Write the failing tests** — extend `tests/unit/server/poll.test.ts` (mirror the existing API poll tests; the fake `PollPorts` already has `fetch`/`renderFetch`, and the `source()` builder defaults `apiMap: null`):

```ts
  test('paginated API/PLAIN source unions pages then diffs all chapters', async () => {
    const api = { urlField: 'url', titleField: 't', pagination: { pageParam: 'page', perPage: 200 } };
    const src = source({ type: 'API', fetchMode: 'PLAIN', fetchUrl: 'https://api.example/ch?per_page=200', apiMap: api });
    const page = (n: number, count: number) => okRes(JSON.stringify(Array.from({ length: count }, (_, i) => ({ url: `https://api.example/c${n}-${i}`, t: `C` }))));
    // fake fetch serves page 1 = 200 items, page 2 = 5 items (short → stop)
    const ports = portsWith({ fetch: async (u: string) => (u.includes('page=2') ? page(2, 5) : page(1, 200)), stored: [] });
    const effects = await pollOnce(src, ports); // helper that runs the group fetch + processFetched
    expect(effects.newChapters).toHaveLength(205);
  });

  test('paginated API/RENDER source: renderFetch called once, union diffed, becameFree fires', async () => {
    const api = { urlField: 'url', titleField: 't', isFreeField: 'locked', isFreeWhen: 'falsy', pagination: { pageParam: 'page', perPage: 200 } };
    const src = source({ type: 'API', fetchMode: 'RENDER', fetchUrl: 'https://api.example/ch', apiMap: api });
    const renderFetch = vi.fn(async () => okRes(JSON.stringify([{ url: 'https://api.example/c1', t: 'C1', locked: false }])));
    const stored = [{ id: 'x', url: 'https://api.example/c1', access: 'LOCKED' as const }];
    const effects = await pollOnce(src, portsWith({ renderFetch, stored }));
    expect(renderFetch).toHaveBeenCalledTimes(1);
    expect(effects.becameFree.map((c) => c.id)).toEqual(['x']);
  });
```
> Adapt `source`/`portsWith`/`pollOnce`/`okRes` to the real helpers in `poll.test.ts` (some may need a thin wrapper that runs the group-level fetch path, not just `processFetched`, so the `fetchApiPages` branch is exercised). If the file only has a `processFetched`-level harness, add a minimal group-runner in the test that mirrors the `poll.ts` fetch seam. Import `vi` from vitest.

- [ ] **Step 2: Run — expect FAIL**: `npm test -- poll`

- [ ] **Step 3: Implement — fetch seam** in `src/server/services/poll.ts` (~L394), replacing the `fetcher`/`res` lines:

```ts
import { fetchApiPages } from './apiFetch';
// ...
    const cond = chooseConditionalState(group.sources);
    const first = group.sources[0];
    const paginated = first.type === 'API' && first.apiMap?.pagination != null;
    const res = paginated
      ? await fetchApiPages(group.fetchUrl, first.apiMap!, group.fetchMode, ports)
      : await (group.fetchMode === 'RENDER' && ports.renderFetch ? ports.renderFetch : ports.fetch)(
          group.fetchUrl,
          { etag: cond.etag, lastModified: cond.lastModified },
        );
```

- [ ] **Step 4: Implement — `processFetched` listPath-as-root** (~L294), so a paginated (already-flattened) body parses as a root array:

```ts
      } else if (src.type === 'API') {
        // WP-45/45b: the API returns the complete list with access. A paginated source's body is
        // already flattened to a root array by fetchApiPages, so parse with listPath as root.
        const map = src.apiMap;
        mine = map ? parseApiChapters(res.body, map.pagination ? { ...map, listPath: undefined } : map, src.fetchUrl) : [];
      } else {
```

- [ ] **Step 5: Run — expect PASS**: `npm test -- poll` then `npm run typecheck`
- [ ] **Step 6: Commit**

```bash
git add src/server/services/poll.ts tests/unit/server/poll.test.ts
git commit -m "feat(wp-45b): poll unions paginated API pages (one render call for RENDER)"
```

---

### Task 4: Render path honors pagination + productionize JSON auto-detect

**Files:**
- Modify: `src/lib/feeds/renderFetch.ts` (`makeRenderFetch` reads `opts.pagination` → POST body)
- Modify: `src/app/api/render/route.ts` (read `pagination` from body → `renderPage`)
- Modify: `src/server/render/renderPage.ts` (productionize the spike JSON detect; add the in-page page loop; one-line render-summary log)
- Test: `tests/unit/feeds/renderFetch.test.ts`

**Interfaces:**
- Consumes: `PaginationSpec` (Task 1).
- Produces: `renderPage(url, opts?: { pagination?: PaginationSpec })`; `makeRenderFetch(...)(url, opts?)` posts `{ url, pagination? }`.

- [ ] **Step 1: Write the failing test** — extend `tests/unit/feeds/renderFetch.test.ts` (it already injects a fake `RenderHttp`; assert the POST body carries `pagination`):

```ts
  test('forwards pagination in the POST body', async () => {
    let sentBody = '';
    const http = async (_endpoint: string, init: { body: string }) => {
      sentBody = init.body;
      return { status: 200, ok: true, json: async () => ({ status: 200, finalUrl: 'u', html: '[]' }) };
    };
    const rf = makeRenderFetch({ endpoint: 'https://r.example' }, http);
    await rf('https://api.example/ch', { pagination: { pageParam: 'page', perPage: 200 } });
    expect(JSON.parse(sentBody)).toMatchObject({ url: 'https://api.example/ch', pagination: { pageParam: 'page', perPage: 200 } });
  });
```

- [ ] **Step 2: Run — expect FAIL**: `npm test -- renderFetch`

- [ ] **Step 3: Implement — `renderFetch.ts`.** Change the returned function to accept opts and include pagination:

```ts
import type { PaginationSpec } from './apiAdapter';
// makeRenderFetch return type:
): (url: string, opts?: { pagination?: PaginationSpec }) => Promise<PoliteResult> {
  return async (url, opts) => {
    // ...
      body: JSON.stringify({ url, ...(opts?.pagination ? { pagination: opts.pagination } : {}) }),
    // ... (rest unchanged)
```

- [ ] **Step 4: Implement — `/api/render/route.ts`.** Read + shallow-validate `pagination`, pass through:

```ts
  const value = body.value as { url?: unknown; pagination?: unknown };
  const url = value?.url;
  if (typeof url !== 'string') return jsonError('A "url" string is required.');
  const pagination =
    value.pagination && typeof value.pagination === 'object' &&
    typeof (value.pagination as { pageParam?: unknown }).pageParam === 'string' &&
    typeof (value.pagination as { perPage?: unknown }).perPage === 'number'
      ? (value.pagination as import('../../../lib/feeds/apiAdapter').PaginationSpec)
      : undefined;
  // ... after the SSRF guard:
  return NextResponse.json(await renderPage(url, { pagination }));
```

- [ ] **Step 5: Implement — `renderPage.ts`.** Rewrite the SPIKE comment into a WP-45b comment; make the in-page probe loop when `opts.pagination` is present; log a one-line summary:

```ts
export async function renderPage(
  url: string,
  opts: { pagination?: PaginationSpec } = {},
): Promise<{ status: number; finalUrl: string; html: string }> {
  // ... launch, interception, goto, settle (unchanged) ...

  // WP-45b: JSON resource. `page.content()` on a JSON navigation is the browser's JSON-VIEWER
  // HTML, not the raw body. Once `goto` has (for a CF-gated endpoint) triggered + solved the
  // challenge and left us on the domain with the cf_clearance cookie, in-page same-origin
  // fetch(es) reuse that cookie and return raw JSON. When `pagination` is set we loop pages
  // INSIDE this one browser session (clear CF once) and return the unioned root array — never
  // one render per page. Still SSRF-guarded via the request interception above.
  const jsonResult = await page.evaluate(
    async (u, pg) => {
      const isJson = (r: Response) => /\bjson\b/i.test(r.headers.get('content-type') ?? '');
      const itemsAt = (parsed: unknown, listPath?: string): unknown[] => {
        let node: unknown = parsed;
        if (listPath) for (const k of listPath.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[k] : undefined;
        return Array.isArray(node) ? node : [];
      };
      try {
        if (!pg) {
          const r = await fetch(u, { credentials: 'include' });
          if (!isJson(r)) return null;
          return { status: r.status, body: await r.text(), pages: 1 };
        }
        const all: unknown[] = [];
        let status = 200;
        const max = pg.maxPages ?? 20;
        let n = 1;
        for (; n <= max; n++) {
          const pu = new URL(u); pu.searchParams.set(pg.pageParam, String(n));
          const r = await fetch(pu.toString(), { credentials: 'include' });
          status = r.status;
          if (!isJson(r)) return null;
          const items = itemsAt(JSON.parse(await r.text()), pg.listPath);
          all.push(...items);
          if (items.length < pg.perPage) break;
        }
        return { status, body: JSON.stringify(all), pages: Math.min(n, max) };
      } catch {
        return null;
      }
    },
    url,
    opts.pagination ?? null,
  );
  if (jsonResult) {
    console.log(`[render] json pages=${jsonResult.pages}`); // one browser, N in-page pages — the budget signal
    return { status: jsonResult.status, finalUrl: page.url(), html: jsonResult.body };
  }

  // ... existing load-more loop + page.content() (unchanged DOM path) ...
```
Add `import type { PaginationSpec } from '../../lib/feeds/apiAdapter';` at the top.

- [ ] **Step 6: Run — expect PASS**: `npm test -- renderFetch` then full `npm test` + `npm run typecheck`
- [ ] **Step 7: Commit**

```bash
git add src/lib/feeds/renderFetch.ts src/app/api/render/route.ts src/server/render/renderPage.ts tests/unit/feeds/renderFetch.test.ts
git commit -m "feat(wp-45b): render path returns paginated JSON in one browser session"
```

---

### Task 5: CLI — functional `--render` + pagination validation

**Files:**
- Modify: `scripts/cleanup-series.ts` (`cmdSetApiDescriptor`: replace the "not built" warning; validate `pagination` in `--map`)
- Test: `tests/integration/services.test.ts` (a `setApiDescriptor` with a `pagination` descriptor persists it — `apiMap` is `Json`, so no service change; this asserts the round-trip)

**Interfaces:** none new — `setApiDescriptor` already stores the whole `--map` (incl. `pagination`).

- [ ] **Step 1: Write the failing test** — add to the cleanup/services integration test: `setApiDescriptor(sourceId, { endpoint, map: { urlField:'permalink', titleField:'title', isFreeField:'locked', isFreeWhen:'falsy', pagination: { pageParam:'page', perPage:200 } }, render: true })` → row `type='API'`, `fetchMode='RENDER'`, `apiMap.pagination.perPage === 200`.

- [ ] **Step 2: Run — expect FAIL** (assertion on `apiMap.pagination`): `npm test -- --project integration services`

- [ ] **Step 3: Implement** in `scripts/cleanup-series.ts` `cmdSetApiDescriptor`:
  - Replace the current `--render` warning ("not built until WP-45b") with: `console.log('note: --render uses the headless renderer to clear Cloudflare and read the JSON API (WP-45b).');`
  - After parsing `--map`, if `map.pagination` is present, validate `typeof map.pagination.pageParam === 'string' && typeof map.pagination.perPage === 'number' && map.pagination.perPage > 0` else `throw new UsageError('--map pagination needs a string pageParam and a positive perPage')`.

- [ ] **Step 4: Run — expect PASS**: `npm test -- --project integration services` then `npm run typecheck`
- [ ] **Step 5: Commit**

```bash
git add scripts/cleanup-series.ts tests/integration/services.test.ts
git commit -m "feat(wp-45b): set-api-descriptor --render functional + pagination validation"
```

---

### Task 6: Integration test + PLAN.md + close-out

**Files:**
- Test: `tests/integration/services.test.ts`
- Modify: `PLAN.md`

- [ ] **Step 1: Write the failing integration test** — a paginated API/PLAIN source, seeded then re-polled with a 2-page fake `fetch` (page 1 = a full `perPage` of chapters, page 2 = a short page), asserts **all** chapters across both pages are stored; a later poll where a chapter's `locked` flips false → `becameFree` + `becameFreeAt` (mirror the WP-45 unlock integration test, but with a paginated descriptor + a `fetchFrom` map keyed by `page=1`/`page=2` URLs, advancing `now` past the min-poll interval as the WP-20 test does).

- [ ] **Step 2: Run — expect PASS** (wiring from Tasks 1-5 is in): `npm test -- --project integration services`

- [ ] **Step 3: Full verification**: `npm test` + `npm run typecheck` — paste fresh output.

- [ ] **Step 4: PLAN.md** — flip **WP-45b → DONE** (remove from Active queue, add to ✅ Completed); replace the `### WP-45b` section body with a DONE write-up (spike-validated CF-gated JSON read; pagination across both transports; one-render-per-series proven by the call-count test; `perPage` per-descriptor; cap 20 + log); advance `NEXT` to the next Active-queue row; add a 2026-08-19 changelog line. Keep anonymized.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/services.test.ts PLAN.md
git commit -m "test(wp-45b): integration paginated API add→poll; PLAN.md → DONE"
```

---

## Self-Review notes (author)

- **Spec coverage:** descriptor+core (T1) · `fetchApiPages` + budget guarantee (T2) · poll seam + listPath-as-root (T3) · render transport JSON+pagination (T4) · CLI (T5) · integration + PLAN (T6). Spec §A–G, the testing section, and every DoD item map to a task. The **one-browser guarantee** is T2's call-count test (`renderFetch` called exactly once) + T3's poll-level re-assertion; the empirical log is the `[render] json pages=N` line in T4.
- **Type consistency:** `PaginationSpec` (T1) is the single source, imported by `apiAdapter`/`apiFetch`/`index` FetchImpl/`renderFetch`/`renderPage`/route. `fetchApiPages(baseUrl, descriptor, fetchMode, ports, log?)` signature identical at its poll call site. `parseApiChapters` unchanged; paginated bodies parse with `{ ...map, listPath: undefined }`.
- **Non-regression:** no `pagination` block → `fetchApiPages` isn't invoked and every existing path is byte-for-byte unchanged; the render JSON detect returns `null` for HTML (DOM path untouched); FetchImpl's new `pagination?` is optional and ignored by plain fetch.
