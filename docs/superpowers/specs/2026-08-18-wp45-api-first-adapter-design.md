# WP-45 — API-first adapter for render sources (plain-REST slice)

**Status:** approved (owner, 2026-08-18) · **Depends on:** WP-17b, WP-20 · **Supersedes (where an API exists):** WP-31
· **Fast-follow:** WP-45b (CF-gated REST transport)

## Problem

Several render/interaction sources expose a **chapter data API** that is strictly better than headless render +
DOM-scrape. A network probe (2026-08-13) found three anonymized shapes:

1. **A plain, public REST API** (a JS-rendered paid source): one un-authed GET returns **all** chapters (free +
   premium) with per-chapter `isFree` / `freeAt` / `price`. No Cloudflare, no render, no tab-clicking — this source
   should leave the render tier entirely, and its `isFree` flags feed WP-20 "now free" natively.
2. **A CF-gated REST API** (a WordPress paid source): all chapters + per-chapter lock, but the endpoint sits **behind
   the CF challenge** — reachable only from the CF-cleared browser (still needs render).
3. **A static JSON file** (a Cloudflare-Pages SPA host): a ~2.4 KB shell injects its chapter list client-side from a
   static `<slug>.json` the shell points at; `etag`/304-able, CORS-open.

Today the pipeline can only reach these lists via **render** (`fetchMode: 'RENDER'`, WP-17b/WP-46): a ~5–15s headless
Chromium fetch with no conditional-GET, plus (for the tab/pagination sources) interaction heuristics we haven't built
(WP-31). An API read is cheaper, `304`-able, correct-titled, and carries lock state directly.

**This WP builds the adapter framework and the plain-REST shape end to end** — the biggest win, and the one that
eliminates render. CF-gated (shape 2) and static-JSON auto-discovery are defined follow-ons (see Scope boundary).

## Key decisions (owner, 2026-08-18)

- **Descriptor lives in the DB, per-Source, set at add-time.** No committed `host → descriptor` map — that would leak
  real site names (anonymity rule) and violates the established "site-specifics belong in data, not code" philosophy
  ([renderPage.ts:10](../../../src/server/render/renderPage.ts#L10)).
- **First slice = plain public REST API** (render-eliminating). CF-gated is a fast-follow (WP-45b).
- **Discovery = generic auto-probe + manual CLI escape hatch.** Auto-probe runs host-agnostic detectors on the
  plain-fetched page; the CLI sets a descriptor by hand for endpoints the page doesn't reveal.
- **Defer `freeAt`.** Consume per-chapter `isFree` only (drives existing WP-20 access). The scheduled-unlock `freeAt`
  timestamp is **not** captured this WP — noted in PLAN.md for a future *predicted-unlock* feature (WP-29/WP-27b).

## The model: an API source is a TOC delivered as JSON

An API returns the **complete** chapter list with lock state — TOC semantics, not a windowed/matcher-filtered feed. So
the adapter produces the same `TocChapter[]` the page-watch path already produces
([pageWatch.ts:17](../../../src/lib/feeds/pageWatch.ts#L17)), and everything downstream — `diffChapters`, LOCKED→FREE
`becameFree`, `notifyForEffects` — is **untouched**.

Two schema concerns stay orthogonal, exactly as they are today:

- **`type`** = *how to parse the body* → today `FEED | PAGE_WATCH`; add **`API`**.
- **`fetchMode`** = *how to transport* → today `PLAIN | RENDER`; unchanged.

The three shapes are then combinations, and no new fetch **port** is needed — the API GET is just
`ports.fetch`/`ports.render` returning JSON in `PoliteResult.body`, so health tracking, etag/304 conditional-GET,
staleness ordering, and per-feed grouping keep working unchanged:

| Shape | `type` | `fetchMode` | transport | slice |
|---|---|---|---|---|
| Plain public REST | `API` | `PLAIN` | `ports.fetch(apiUrl)` — no render, 304-able | **this WP** |
| Static JSON file | `API` | `PLAIN` | `ports.fetch(apiUrl)` | parser in-WP; auto-probe detector in-WP |
| CF-gated REST | `API` | `RENDER` | render fetches `apiUrl`, returns JSON | WP-45b |

## Non-goals (explicitly other WPs / follow-ons)

- **CF-gated REST transport (WP-45b).** Its discovery is manual-only by necessity — the probe reads the *plain page
  HTML*, and a CF-gated source's page fetch is the thing that 403s, so there is no HTML to probe and the endpoint can't
  be reached without the CF-cleared browser. And **every** fetch (including any add-time seed) needs render-returns-JSON
  (below). Both are absent from the plain slice, so CF-gated is a clean separate piece.
- **Render-returns-JSON.** `renderPage` today does goto + load-more clicks + returns DOM HTML
  ([renderPage.ts:22](../../../src/server/render/renderPage.ts#L22)). Making it detect an `application/json` navigation,
  skip the load-more loop, and return the raw body is the one change WP-45b needs and this WP does **not**.
- **`Chapter.freeAt` / predicted unlocks.** Only retroactive `becameFreeAt` exists
  ([schema.prisma:198](../../../prisma/schema.prisma#L198)); no scheduled-unlock field. Deferred (see decisions).
- **Renderer tab/pagination interaction (WP-31).** Superseded wherever a source has an API; still needed for
  interaction sites with no API (a load-more source that embeds data in-page and exposes no endpoint).
- **Arbitrary REST endpoint sniffing.** The auto-probe ships one reliable, generic detector (the static-JSON signal).
  A bespoke REST endpoint the page doesn't advertise is configured via the CLI, not guessed.

## Design

### A. Schema (additive migration)

- `enum SourceType` gains **`API`** ([schema.prisma:27](../../../prisma/schema.prisma#L27)).
- `Source.apiUrl String?` — the endpoint (or static-JSON URL). `fetchUrl` derivation in `rowToPollable`
  ([index.ts:106](../../../src/server/services/index.ts#L106)) becomes `apiUrl ?? feedUrl ?? tocUrl ?? url`.
- `Source.apiMap Json?` — the descriptor field mapping (see B). `Json` column (Prisma-native).

No `Chapter` change. Migration is additive (new nullable columns + new enum value), safe to apply ahead of any API
source existing. Generate SQL via `prisma migrate diff` / `migrate dev` per the WP-04 note.

### B. `ApiDescriptor` + pure parser — `src/lib/feeds/apiAdapter.ts` (new, TDD)

The descriptor persisted in `Source.apiMap`:

```ts
type ApiDescriptor = {
  listPath?: string;          // dot-path to the chapter array in the JSON (e.g. "data.chapters"); root array if absent
  urlField: string;           // item key → chapter url/permalink (absolute, or resolved against apiUrl origin)
  numberField?: string;       // item key → chapter number; falls back to parsing it out of the title
  titleField: string;         // item key → chapter title
  isFreeField?: string;       // item key → boolean-ish free flag; absent ⇒ all FREE
  isFreeWhen?: 'truthy' | 'falsy'; // interpretation of isFreeField (some APIs carry `locked`, the inverse); default 'truthy'
};
```

`parseApiChapters(body: string, descriptor: ApiDescriptor, baseUrl: string): TocChapter[]`:

- `JSON.parse` the body; walk `listPath` to the array (tolerate missing/renamed → `[]`, never throw on shape drift).
- Per item → `{ url, title, number, access }`:
  - `url` from `urlField`, resolved to absolute against the `apiUrl` origin if relative (mirror `parseToc`'s URL
    handling, [pageWatch.ts:45](../../../src/lib/feeds/pageWatch.ts#L45)).
  - `number` from `numberField` if present and numeric, else parse from the title (reuse the existing
    number-extraction the feed/TOC path already uses — tolerant of decimals like `12.5` and missing numbers, per WP-01).
  - `access = free ? 'FREE' : 'LOCKED'`, where `free` = `isFreeField` interpreted via `isFreeWhen` (default treat the
    flag as "is free"; `isFreeWhen: 'falsy'` supports APIs whose field is `locked`). No `isFreeField` ⇒ all `FREE`
    (the static-JSON shape).
- Pure: no `next`/`prisma`/`fs`/network imports. Output is the existing `TocChapter` shape, so `diffChapters` drives
  new-chapter + LOCKED→FREE detection identically to feed and page-watch.

### C. Auto-probe — `src/lib/feeds/apiProbe.ts` (new, TDD)

`probeForApi(html: string, baseUrl: string): { apiUrl: string; descriptor: ApiDescriptor } | null` — generic,
host-agnostic, no site names.

- **Detector 1 (static-JSON signal):** find a shell attribute / reference pointing at a `.json` data file (the
  2026-07-30 case: a `data-*` attribute whose value ends `.json`). Resolve it to an absolute `apiUrl` and emit a
  descriptor for the known static-JSON shape (`titleField`/`urlField`/no `isFreeField`). Conservative: only fires on a
  clear JSON-data pointer, else `null`.
- Returns `null` for everything else → the existing add-time ladder runs unchanged.
- Extensible: the module is a small ordered list of detectors so future generic signals slot in without touching
  callers. **No** speculative arbitrary-REST guessing (that's the CLI's job).

### D. Add-time wiring — `src/server/services/addSeries.ts`

Probe for an API **first**, on the plain-fetched page body, at the top of `resolveFrom`
([addSeries.ts:119](../../../src/server/services/addSeries.ts#L119)) — before feed discovery
([addSeries.ts:136](../../../src/server/services/addSeries.ts#L136)):

1. `const api = probeForApi(page.body, url)`.
2. If `api`: fetch `api.apiUrl` (`ports.fetch`), `parseApiChapters` it, and resolve an **`API` source** —
   `type: 'API', fetchMode: 'PLAIN', apiUrl, apiMap: api.descriptor`, seeded with the parsed chapters. Done — no
   feed/page-watch/render.
3. Else: today's ladder runs byte-for-byte (feed discovery → WP-49 divert → page-watch → WP-46 render escalation).

`ResolvedSource`/`ResolvedCore` gain `apiUrl?` + `apiMap?`; the `createSeries` port
([index.ts:399](../../../src/server/services/index.ts#L399)) persists them. `AddSeriesPorts` needs no new port — the
API GET reuses the existing `fetch` port.

> **CF-gated note (not this slice).** A CF-gated source's plain page fetch 403s, so `probeForApi` never gets HTML and
> step 1 no-ops; the add falls through to today's WP-46 hard-fail render path. Such a source is configured **after** the
> add via the CLI (E) as `type=API, fetchMode=RENDER`, and seeded by its first poll — WP-45b.

### E. Manual escape hatch — CLI `set-api-descriptor`

For a bespoke REST endpoint the page doesn't advertise (the plain-REST "biggest win" source, whose endpoint the owner
has from the network probe), a CLI command sets the descriptor on an existing series' source — the reliable path for
the first render-eliminating source. Lives alongside the WP-38/WP-49 `db:cleanup` / `reclassify-source` tooling.

- `set-api-descriptor <sourceId> --endpoint <apiUrl> --map <spec> [--render]`: sets `type=API`, `apiUrl`,
  `apiMap` (parsed from `--map`), and `fetchMode` (`PLAIN` default, `RENDER` with `--render` for a future CF-gated
  source); clears the now-irrelevant `feedUrl` and stale `etag`/`lastModified` validators (mirroring `reclassify-source`).
- Anonymity: the command takes the endpoint/map as **arguments**, so no real host is committed.

### F. Poll-time wiring — `src/server/services/poll.ts`

One new branch in `processFetched` ([poll.ts:264](../../../src/server/services/poll.ts#L264)), paralleling the existing
PAGE_WATCH/FEED split at [poll.ts:275](../../../src/server/services/poll.ts#L275):

- `src.type === 'API'` → `parseApiChapters(res.body, src.apiMap, src.fetchUrl)` → the **same** `diffChapters`
  ([diff.ts:91](../../../src/lib/feeds/diff.ts#L91)) → new chapters + `becameFree` + `accessReconciled`.

The `fetcher` ternary ([poll.ts:387](../../../src/server/services/poll.ts#L387)) already routes `RENDER`→render,
`PLAIN`→fetch, so the plain slice needs **no transport change** — `fetchUrl` is `apiUrl` and `fetchMode` is `PLAIN`.
`rowToPollable` ([index.ts:79](../../../src/server/services/index.ts#L79)) carries `type` + `apiMap` onto the
`PollableSource`. Conditional-GET works for free: the plain REST API is `etag`/304-able, so a `NOT_MODIFIED` poll costs
nothing — a strict improvement over render, which can't 304.

### Scope boundary — plain in-WP, CF-gated as WP-45b

**In this WP (plain REST, render-free):** schema; `apiAdapter.ts` + `apiProbe.ts` (pure, TDD); add-time probe; the
`set-api-descriptor` CLI; the poll `API` branch; tests proving render is eliminated and `isFree`→"now free" fires.

**WP-45b (CF-gated REST, fast-follow):** render-returns-JSON in `renderPage` (detect `application/json`, skip
load-more, return raw body); CLI `--render` seeding path; a poll that render-fetches the API URL and parses JSON. All
of the above already accommodates it (`type=API, fetchMode=RENDER`), so WP-45b is additive.

## Testing (TDD)

**Unit — `parseApiChapters`** (`tests/unit/feeds/apiAdapter.test.ts`, mirroring
[pageWatch.test.ts](../../../tests/unit/feeds/pageWatch.test.ts)):
- Root-array and nested `listPath` JSON → correct `TocChapter[]`.
- `isFreeField` truthy → `FREE`; falsy → `LOCKED`; `isFreeWhen: 'falsy'` inverts a `locked` field.
- No `isFreeField` → all `FREE` (static-JSON shape).
- `number` from `numberField`; fallback to title-parsed number; decimals (`12.5`) and missing numbers tolerated.
- Relative `urlField` resolved absolute against the endpoint origin.
- Shape drift (missing `listPath`, renamed fields, non-array) → `[]`, never throws.

**Unit — `probeForApi`** (`tests/unit/feeds/apiProbe.test.ts`):
- A page with a `.json` data-pointer attribute → `{ apiUrl, descriptor }` with the resolved absolute URL.
- A page without the signal → `null` (add-time ladder unaffected).

**Unit — addSeries** (extend the `ports()` factory,
[addSeries.test.ts:21](../../../tests/unit/server/addSeries.test.ts#L21), with API bodies in the fetch map):
- Page probes to an API → an `API`/`PLAIN` source with `apiUrl`/`apiMap` and chapters seeded from the API; **no** feed
  discovery or render call.
- Page does not probe → today's FEED/PAGE_WATCH resolution unchanged (regression guard).

**Unit — poll** (extend [poll.test.ts](../../../tests/unit/server/poll.test.ts)):
- An `API` source's JSON body → `parseApiChapters` → new chapters diffed; a LOCKED→FREE `isFree` flip across two polls
  produces `becameFree` → notify. No render call for a `PLAIN` API source.

**Integration** ([services.test.ts](../../../tests/integration/services.test.ts)): add-time probe persists an `API`
source row (`type`, `apiUrl`, `apiMap`); a poll reads the API, diffs, and flips a chapter's `access` to `FREE`,
stamping `becameFreeAt` once — the WP-20 path working natively off the API with no render.

**Verify:** `npm test` + `npm run typecheck`, fresh output in the same message, before any "done" claim.

## Definition of Done

- A source with a public chapter API is tracked **without render**: `type=API`, `fetchMode=PLAIN`, chapters +
  per-chapter access read from the API, conditional-GET (304) honored on re-poll.
- Add-time auto-probe binds an API source when the page carries the static-JSON signal; otherwise the add ladder is
  byte-for-byte today's (graceful, no behavior change for non-API sources).
- `set-api-descriptor` configures an API source for an endpoint the page doesn't advertise (no real host in git).
- A LOCKED→FREE transition observed via the API's `isFree` fires WP-20 "now free" through the existing machinery.
- `apiAdapter.ts` / `apiProbe.ts` are pure (no `next`/`prisma`/`fs`/network); written test-first; all properties above
  pass.
- PLAN.md WP-45 flipped to DONE with a changelog line; **WP-45b filed** (CF-gated REST: render-returns-JSON + CLI
  `--render` seeding); a note recorded that the plain REST API exposes a per-chapter `freeAt` scheduled-unlock enabling
  future predicted unlocks (WP-29/WP-27b); next `NEXT` set.
