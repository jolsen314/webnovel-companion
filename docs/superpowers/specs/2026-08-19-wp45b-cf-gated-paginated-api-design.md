# WP-45b — CF-gated render transport + paginated API sources

**Status:** approved-design pending review (owner, 2026-08-19) · **Depends on:** WP-45, WP-17b · **Spike:** validated
(the CF-gated JSON read works — see below)

## Problem

WP-45 shipped API sources that read a chapter API in **one fetch = the whole list**, over the PLAIN transport only.
Two gaps remain, both required by a real source:

1. **CF-gated transport.** The target API sits behind Cloudflare — a plain datacenter GET is challenged (WP-40). Only a
   real browser clears it. WP-45 designed the seam (`type=API, fetchMode=RENDER`) but the renderer returns
   `page.content()`, which on a JSON navigation is the browser's JSON-*viewer* HTML, not raw JSON.
2. **Pagination.** The API is paginated: query params `page`, `per_page` (caps at 200 for the one site we know —
   **site-specific, not a constant**), plus fixed `order` (asc/desc) and `category` (series id). A real series has 218
   chapters (2 pages); others reach ~1.3k (7 pages). A single fetch reads only page 1 — an API source must **fetch
   every page and union them**. (This also fixes a latent WP-45 gap: a paginated *plain*-REST API today silently reads
   only page 1.)

## Spike result (2026-08-19) — the CF-gated JSON read works

A throwaway probe made `renderPage` do an **in-page `fetch(url)`** after `goto` + settle, returning the raw body when
the response is JSON. Deployed to a preview and pointed at the real CF-gated endpoint, it returned **clean raw JSON** (a
root array of `{ title, permalink, locked, price }`). Confirmed: `goto(apiUrl)` clears the CF challenge (landing the
browser on the domain with the `cf_clearance` cookie), and an in-page same-origin fetch reuses that cookie for clean
JSON. **The `renderPage` change is kept and productionized here**, no longer throwaway.

The observed shape maps to an `ApiDescriptor`: `{ urlField: "permalink", titleField: "title", isFreeField: "locked",
isFreeWhen: "falsy" }` (root array; `locked:true`→LOCKED). Set per-source via `set-api-descriptor --render`; the real
host/title never enter git.

## URL model (confirmed with owner — no change needed)

Two independent fields, already the case since WP-45:

- **`Source.url`** — the human reading/landing page the user submitted. Displayed + clickable on the detail page,
  preserved forever, and **never fetched as the API**. `setApiDescriptor` never touches it.
- **`Source.apiUrl`** — the JSON chapter-data endpoint (set via `--endpoint`). **Fetch-only**, never displayed.

`fetchUrl = apiUrl ?? feedUrl ?? tocUrl ?? url` ([index.ts:111]), so for an API source the poll/render fetches
`apiUrl`. **The renderer's `goto` + JSON auto-detect therefore run on `apiUrl` (which is JSON), not on the submitted
reading page** — the two URLs are fully decoupled. Chapter links on the detail page come from the descriptor's
`urlField` (e.g. `permalink`) → each chapter's real reading page. No detail-page change in this WP.

## Key decisions (owner, 2026-08-19)

- **Both transports paginate** — one pure page-loop/union core, wired into the plain adapter loop *and* the render
  in-page loop.
- **Stop rule: short page + cap.** A page returning `< perPage` items is the last page. Hard cap **`maxPages = 20`**
  (~4000 chapters at 200/page) as a runaway backstop; **log when the cap is hit** — never silently truncate (WP-41
  lesson).
- **`perPage` is per-descriptor**, never hardcoded (the 200 cap is one site's; others differ — revisit later).
- **JSON detection: content-type auto-detect** in `renderPage` (from the spike) — an API-RENDER source "just works",
  the HTML render path is unchanged.

## The efficiency crux (why render paginates *inside one call*)

Each render call is a fresh browser launch + a CF clearance (~5–15s). N render calls for N pages = N launches — a 7-page
series would be ~70–100s and blow `POLL_BUDGET_MS`. But once the browser has cleared CF, **in-page `fetch()`es for the
other pages reuse the clearance cookie** — cheap. So the render transport clears CF once (`goto` page 1) then loops
in-page fetches page 1…N in the *same* session and returns the union. The plain transport has no such constraint — it
loops Node-side HTTP GETs.

## Design

### A. Descriptor — a pagination block (`lib/feeds/apiAdapter.ts`)

Extend `ApiDescriptor` (all optional — a non-paginated API omits it, behaving exactly as WP-45):

```ts
pagination?: {
  pageParam: string;   // "page" — the query param to increment
  perPage: number;     // page size / the site's cap (e.g. 200) — per-descriptor
  maxPages?: number;   // runaway backstop; default 20
};
```

Fixed params (`category`, `order`, `per_page` itself) stay baked into the stored `apiUrl`'s query string; only
`pageParam` is set/incremented. Prefer `order=asc` in the stored URL so the union is reading-ordered for WP-35
positions (else union then sort by chapter number).

### B. Pure page-loop core (`lib/feeds/apiPaginate.ts`, new, TDD)

No I/O — the pieces both transports share:

- `pageUrl(baseUrl: string, pageParam: string, n: number): string` — set/replace the page param via `URL.searchParams`.
- `itemsAt(parsedJson: unknown, listPath?: string): unknown[]` — the array at `listPath` (root if absent); `[]` on drift.
- `isLastPage(pageItemCount: number, perPage: number): boolean` — `pageItemCount < perPage`.
- `unionChapters(pages: TocChapter[][]): TocChapter[]` — concat, dedup by canonical URL (first-seen wins), preserve order.

### C. The paginated-fetch entry point (`fetchApiPages`)

One function owns "get all pages as a single combined body," branching on the transport it's told to use:

`fetchApiPages(baseUrl, descriptor, fetchMode, ports, log): Promise<PoliteResult>` where `ports = { fetch, renderFetch }`
and `fetchMode ∈ { PLAIN, RENDER }`.

- **PLAIN → Node-side loop.** `for n = 1 …`: `ports.fetch(pageUrl(baseUrl, pageParam, n))`; on a non-SUCCESS page,
  return that failure outcome (health scoring handles it); parse, `itemsAt(listPath)`, accumulate; stop when
  `isLastPage` or `n === maxPages` (`log('hit page cap N; list may be truncated')` on the cap). Return
  `{ outcome:'SUCCESS', status:200, body: JSON.stringify(allItems), notModified:false, etag:null, lastModified:null,
  finalUrl: baseUrl }` — the **flattened root JSON array** of every page's items.
- **RENDER → one call, service loops.** A single `ports.renderFetch(baseUrl, { pagination: descriptor.pagination })`
  — the render service does the in-page page loop (§D) and returns the same flattened-root-array body. `fetchApiPages`
  does **not** loop `renderFetch` (that would be N browser launches).

Either branch yields one `PoliteResult` with a **root-array body**, so downstream parse treats `listPath` as root (§F).
No `pagination` block on the descriptor → callers keep the WP-45 single-fetch path (this function isn't invoked).

### D. Render transport — in-page loop (`renderPage` + route + `renderFetch`)

1. **`renderPage` JSON auto-detect (from the spike, productionized).** After `goto` + settle: in-page `fetch(url)`; if
   the response `content-type` is JSON, return its raw body and skip the load-more loop; else today's DOM behavior,
   unchanged.
2. **`renderPage` pagination.** `renderPage(url, opts?)` gains `opts.pagination` (`{pageParam, perPage, maxPages, listPath?}`).
   When present and the resource is JSON: clear CF via `goto(url)`, then an in-page loop — `fetch(pageUrl(url, pageParam, n))`,
   `JSON.parse`, `itemsAt(listPath)`, accumulate, stop on short page / `maxPages` — and return the concatenated items as a
   single root JSON array string (the same flattened-root contract as §C). The page-URL + stop logic is re-implemented
   inside `page.evaluate` (browser context can't import the pure core); it mirrors §B and is covered by the live spike
   plus the poll-level tests.
3. **Interface plumbing.** `renderFetch(url, opts)` gains an optional `opts.pagination`, POSTed in the render request
   body (`{ url, pagination? }`); the `/api/render` route reads it and passes it to `renderPage`. `makeRenderFetch`
   maps the reply `html` → `PoliteResult.body` unchanged (the body is now the unioned JSON array string).

### E. Poll seam (`poll.ts` ~L395) + add-time (`addSeries.ts`)

At the poll's fetch step, branch when the group is a paginated API source (`group.sources[0].type === 'API'` &&
`apiMap.pagination`):

```
const paginated = group.sources[0].type === 'API' && group.sources[0].apiMap?.pagination;
const res = paginated
  ? await fetchApiPages(group.fetchUrl, group.sources[0].apiMap, group.fetchMode, ports, log)
  : await (group.fetchMode === 'RENDER' && ports.renderFetch ? ports.renderFetch : ports.fetch)(group.fetchUrl, cond);
```

`fetchApiPages` (§C) internally picks the loop (PLAIN) or the one-render-call-with-`pagination` (RENDER) from
`fetchMode`. An API group is effectively one source (unique `apiUrl` per series), so reading pagination from
`sources[0]` is safe. **Add-time**
(`addSeries` API-candidate loop, and the CLI-configured first poll) seeds via the same `fetchApiPages` so a paginated
source is seeded complete from the start; a CF-gated source is CLI-configured (`set-api-descriptor --render`) and seeded
by its first poll.

### F. `listPath` + flatten contract

Pagination resolves `listPath` **per page** and flattens to a root array. So `processFetched`'s API branch parses the
combined body with `listPath` treated as root — i.e. `parseApiChapters(res.body, { ...apiMap, listPath: undefined },
fetchUrl)` for a paginated source. The owner's real endpoint is a root array (no `listPath`), so the common path is a
plain concat; the `listPath` handling is the general case. Non-paginated API sources are unaffected.

### G. CLI (`set-api-descriptor`)

`--render` is now genuinely functional — replace the "not built until WP-45b" warning with an accurate note. The
`--map` JSON already carries arbitrary descriptor fields, so `pagination` is supplied inside `--map` (e.g.
`--map '{"urlField":"permalink","titleField":"title","isFreeField":"locked","isFreeWhen":"falsy","pagination":{"pageParam":"page","perPage":200}}'`).
Validate that if `pagination` is present it has `pageParam` + a positive `perPage`.

## Non-goals / edge cases

- **Conditional GET across pages.** The renderer never 304s; the plain paginated fetch does a full re-fetch each poll
  (per-page etags would need per-page validator storage — out of scope; API polls are cadence-gated already).
- **Total-count headers** (e.g. `X-WP-TotalPages`). Not relied on — headers may not survive the render/in-page path;
  the short-page heuristic is transport-agnostic.
- **Per-page failure mid-union.** A failed page returns that failure outcome for the whole source (health scores it,
  retries next poll) rather than persisting a partial list — `diffChapters` never deletes, so no data loss.
- **No detail-page UI change** — the reading-page link + clickable chapters already exist (URL model above).

## Testing (TDD)

- **Unit — `apiPaginate.ts`:** `pageUrl` sets/replaces the param (existing query params preserved); `itemsAt` root +
  `listPath` + drift→`[]`; `isLastPage`; `unionChapters` concat + dedup by canonical URL + order preserved.
- **Unit — `fetchApiPages` (plain):** a fake `fetch` map serving page 1 (`perPage` items) + page 2 (`< perPage`) →
  combined root-array body with all items, exactly 2 fetch calls, stops on the short page; a full-`perPage` run to
  `maxPages` → stops at the cap and logs; a page failure → surfaces the failure outcome.
- **Unit — poll:** a paginated `API`/`PLAIN` source → `fetchApiPages` unions pages → `diffChapters` gets all chapters;
  a paginated `API`/`RENDER` source → one `renderFetch` call carrying `pagination`, its unioned JSON body → all
  chapters + a `locked:true→false` `becameFree`.
- **Unit — content-type/JSON decision** extracted from `renderPage` where testable (the pure predicate); the
  browser-loop internals are validated by the live spike.
- **Integration:** a paginated API source seeded at add + re-polled (mirrors the WP-45 integration test, with a 2-page
  fake) → all chapters stored; an unlock across polls still fires `becameFree`.
- **Verify:** `npm test` + `npm run typecheck`, fresh output, before any "done" claim. Real CF end-to-end stays owner-validated.

## Definition of Done

- A CF-gated, paginated API source is tracked end-to-end: `set-api-descriptor --render` with a `pagination` descriptor →
  the poll clears CF once, unions all pages, and stores the complete chapter list with per-chapter access; a
  `locked→free` transition fires WP-20 "now free".
- A paginated **plain** API source unions all pages too (latent WP-45 gap closed).
- `renderPage` returns raw JSON for a JSON resource (auto-detected) and is unchanged for HTML.
- The page loop stops on a short page, caps at `maxPages`, and **logs on cap-hit**; `perPage` is descriptor-driven.
- `lib/` core is pure + test-first; non-paginated + non-API sources are byte-for-byte unchanged; PLAN.md WP-45b → DONE
  with a changelog line; `NEXT` advanced.
