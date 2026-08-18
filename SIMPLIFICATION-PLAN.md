# Simplification Plan — findings & proposed work

> Produced by a read-only `code-simplifier` pass over `src/**` (lib / server / app-and-routes),
> 2026-08-17. **No code was changed.** Every item preserves behavior; this is a menu, not a
> mandate. All `lib/` logic is TDD-gated, so most items are "write the refactor test-first, then
> move code." Nothing here is a correctness bug — these are clarity/consistency/DRY refinements.

## Overall health

The codebase is in **good shape** and follows a deliberate ports-and-adapters discipline:
pure, fake-tested cores (`poll`, `addSeries`, `scheduleNotify`, `pushSend`, most of `lib/`)
behind ports, with Prisma/HTTP/Puppeteer bound only at the edges. Route handlers overwhelmingly
follow "parse → validate → call service → shape response." `canonicalUrl`/`slugify` are already
shared identity primitives rather than being copy-pasted.

The real debt is **narrow and concentrated**:
- **`services/index.ts`** (597 lines, ~30% of the server layer) has accumulated genuine,
  untested business logic in `backfillFromToc` that the file's own header says shouldn't live there.
- **`api/render/route.ts`** is the one genuinely fat route handler (~55 lines of inline Puppeteer logic).
- A **boilerplate tax** on mutating route handlers (body-parse + `parse → 400`, repeated 6×/4×).
- Two **small duplication clusters**: delete-confirm client components, and a domain-status tuple
  defined in **three** places.

---

## Tier A — high value, do first

### A1. Extract a `backfill` core out of `services/index.ts` (own WP, test-first)
- **Where:** `src/server/services/index.ts:433-597` (`backfillFromToc`, `backfillWithEscalation`, `switchToPageWatch`)
- **Problem:** The file header declares itself "the thin edge… logic lives in ./poll and ./addSeries
  (unit-tested with fakes)." But `backfillFromToc` (110 lines) holds real, un-unit-tested decision
  logic: the self-heal TOC-discovery hop (456-466), three-way title-source selection (472-479), and
  the `tocReindexable` collision reasoning (501-502) — the subtlest branches in the file.
- **Proposal:** New `services/backfill.ts` with a pure `computeBackfill(stored, toc, opts)` core +
  `BackfillPorts` (mirroring `SchedulePorts`/`PollPorts`), unit-tested with fakes. `index.ts` shrinks
  toward its intended edge-binding role.
- **Risk/effort:** MED risk / HIGH effort. This is the strategic item — **its own work package, TDD**,
  stop-at-WP-boundary per CLAUDE.md. Sequence the mechanical `index.ts` cleanups (B1–B3) either
  before it (to reduce noise) or fold them in.

### A2. Move Puppeteer logic out of `api/render/route.ts` into a server module
- **Where:** `src/app/api/render/route.ts:47-103`
- **Problem:** The only fat handler. Everything from `puppeteer.launch` down — serverless Chromium
  launch, per-request SSRF re-validation interception, the 60-iteration "load more" loop, DOM
  extraction — is inline. Only lines 24-45 (auth + parse + SSRF pre-check) are route-shaped. Directly
  violates the "handlers stay thin" rule and is untestable without an HTTP request.
- **Proposal:** Extract `renderPage(url): Promise<{ status; finalUrl; html }>` into
  `src/server/render/renderPage.ts` (Node-only, so **not** `lib/`). Handler becomes:
  verify secret → parse `url` → `assertPublicUrl` → `return NextResponse.json(await renderPage(url))`.
- **Risk/effort:** MED / MED. Pure code-move, behavior identical.

### A3. Add `server/api/http.ts` — collapse body-parse + `parse→400` boilerplate
- **Where:** body-read in `series/route.ts:13-18`, `series/[id]/route.ts:17-22`,
  `notification-prefs/route.ts:14-19`, `auth/login/route.ts:16-21`, `push/subscribe/route.ts:8-13`,
  `render/route.ts:30-35`; the `parse→400` line in `series/route.ts:20-21`,
  `series/[id]/route.ts:24-25`, `notification-prefs/route.ts:21-22`, `push/subscribe/route.ts:15-16`.
- **Problem:** Identical 5-line `try { await request.json() } catch { 400 }` in **6** handlers;
  identical `if (!parsed.ok) return …{ error }, { status: 400 }` in **4**.
- **Proposal:** `readJson(request): ParseResult<unknown>` (reuse the existing `ParseResult` from
  `validation.ts`) + `jsonError(error, status = 400)`. Each site becomes one line.
- **Risk/effort:** LOW / LOW. Cheapest, highest-frequency win — touches the most files. Do first.

### A4. Consolidate the `SeriesStatus` tuple — defined in **three** places (four counting the server dup)
- **Where:** `server/api/validation.ts:46` (`SERIES_STATUSES`), `series/[id]/page.tsx:9` (`STATUSES`),
  `series/[id]/SeriesDetail.tsx:8` (`STATUSES`); plus a separate hand-mirrored union at
  `server/services/poll.ts:60`.
- **Problem:** The `READING|COMPLETED|PAUSED|DROPPED|PLANNED` domain enum is copied independently.
  Add a status in one place and the validator/UI silently diverge.
- **Proposal:** One pure, Next-free `lib/series.ts` exporting `SERIES_STATUSES` tuple + `SeriesStatus`
  type; import it in `validation.ts`, both UI files, and (as the type) `poll.ts`. Keeps `lib/`
  Prisma-free — it's a hand-mirrored union today anyway, so this is a lateral move, not a lib→prisma import.
- **Risk/effort:** LOW / LOW.

---

## Tier B — safe mechanical cleanups (high confidence)

### B1. De-duplicate `$transaction` op-builders in `services/index.ts`
- **Where:** `index.ts:179-193` vs `523-528` — `becameFree` / `accessReconciled` op arrays are
  character-for-character identical in `applyPollEffects` and `backfillFromToc`. The
  `chapter.createMany` mapping (162-176 vs 508-519) differs only by `position`.
- **Proposal:** Module-private `becameFreeOps(chapters, now)`, `accessReconciledOps(chapters)`,
  `createChapterData(seriesId, sourceId, c, position?)`. Removes ~25 lines and a real drift hazard
  (the two access-reconcile blocks must stay in lockstep).
- **Risk/effort:** LOW / LOW (integration-tested).

### B2. Extract `toKnownChapter(c)` projection in `services/index.ts`
- **Where:** `index.ts:138-144` (`loadStoredChapters`) and `486-491` (`backfillFromToc`) — identical
  row→`KnownChapter` map, including the `access === 'UNKNOWN' ? undefined` convention.
- **Proposal:** One `toKnownChapter(c): KnownChapter` helper. Removes drift risk on the UNKNOWN convention.
- **Risk/effort:** LOW / LOW.

### B3. Ownership-check helpers (`ownsSeries` / `ownsSource`)
- **Where:** Series-scoped `findFirst({ where:{ id, userId }, select:{ id:true } })` in `series.ts:74`,
  `cleanup.ts:25`, `index.ts:437-440`; source-scoped identical guard in `cleanup.ts:46` **and** `cleanup.ts:65`.
- **Proposal:** `ownsSeries(id): Promise<boolean>` / `ownsSource(id): Promise<boolean>` (e.g.
  `services/ownership.ts`). Collapses each guard to one line and single-sources the security-critical
  ownership invariant. Keep richer selects (backfill needs `title`/`titleIsManual`) as-is.
- **Risk/effort:** LOW / LOW.

### B4. `reading.ts` — extract the "nulls-last ascending" comparator
- **Where:** `reading.ts:54-71` — the same 3-line null-handling block is written out **three** times
  (`position`, `number`, `publishedAt`).
- **Proposal:** `nullsLastAsc(a, b)` returning `a - b` when both present, `±1` for a single null, `0`
  when equal/both-null. Each tie-breaker becomes one readable line.
- **Risk/effort:** LOW / LOW-MED (pure sort, well-tested).

### B5. `feeds/*` — extract `pathnameOf(url): string | null`
- **Where:** `discover.ts` (93-98, 114-123, 165-170) and `pageWatch.ts:103-108` repeat
  `try { return new URL(u).pathname } catch { … }`.
- **Proposal:** Shared `pathnameOf` returning `null` on parse failure; each caller keeps its own
  fallback (`false` / skip / `path = c.url`) — **don't** collapse those, they genuinely differ.
- **Risk/effort:** LOW / LOW.

### B6. `discover.ts` — de-dup the `seriesPath` + `slug` derivation
- **Where:** `discover.ts:74-80` and `140-147` — identical `new URL(seriesUrl).pathname.replace(...)`
  + `slug = …split('/').filter(Boolean).pop()` open both `chooseSeriesMatch` and `fallbackSeriesMatch`.
- **Proposal:** Helper returning `{ seriesPath, slug } | null`. **Caveat:** the two functions diverge
  on parse failure (`null` vs `{ type: 'WHOLE_FEED' }`) — have callers branch on `null`.
- **Risk/effort:** LOW / LOW.

---

## Tier C — style/consistency (nested-ternary rule, naming)

The project style explicitly forbids nested ternaries ("prefer switch/if-else"); these violate it.

### C1. `pageWatch.ts:164-165` — flatten nested ternary in `tocReadingOrder`
Replace the `ascending = … ? true : … ? false : null` + separate `=== null` return with an
if/else-if/else-return chain (folds the early-return in). LOW / LOW.

### C2. `dedup.ts:30-36` — nested ternary → `switch (m.type)`
`canonicalSeriesId`'s `suffix` is a nested ternary over a discriminated union; a `switch` is house
style **and** exhaustiveness-checkable. LOW / LOW.

### C3. `reading.ts:75` — final id tie-break nested ternary
Prefer a tiny `compareStrings(a, b)` helper. **Trap flagged:** do **not** swap to `localeCompare` —
it's locale-dependent and would change ordering vs. the current codepoint comparison. LOW / LOW.

### C4. `renderFetch.ts:60-73` — repeated HTTP-status→outcome mapping
The `>=500 → HTTP_5XX / >=400 → HTTP_4XX` map is written twice; extract a file-local
`httpFailureOutcome(status)`. (A third similar map in `fetch.ts:132-133` — leave; cross-file coupling
at the impure edge isn't worth it.) LOW / LOW.

### C5. `discover.ts:42` — move the mid-file `import type { FeedItem }` to the top
Lone convention/import-ordering break across the feeds modules. TRIVIAL.

### C6. Route micro-consistency sweep
- `type IdParams = { params: Promise<{ id: string }> }` alias — repeated inline in
  `series/[id]/route.ts` (7,14,32), `backfill/route.ts:6`, `switch/route.ts:6`. LOW / LOW.
- Unused-param naming drift: `_req` (`backfill`, `switch`) vs `_request` (`series/[id]/route.ts`).
  Pick one. TRIVIAL.
- `SeriesDetail.tsx:187` `const read = c.read;` used once next line — inline. TRIVIAL.

---

## Tier D — client-component duplication (medium effort, optional)

### D1. Extract `useDeleteSeries({ onDeleted })` hook
- **Where:** `(app)/DeleteSeriesButton.tsx` (shelf) and `(app)/series/[id]/DeleteSeries.tsx` (detail)
  hold the same `confirming/busy/error` state machine, both call `requestDeleteSeries(id)`, both
  support Escape-to-cancel. Only markup + post-success action differ (`router.refresh()` vs `router.push('/')`).
- **Proposal:** Extract the logic into a hook returning `{ confirming, busy, error, open, cancel, confirm }`;
  each component keeps its own JSX (markup differs enough that merging components isn't worth it).
  Also standardizes the Escape handling (shelf uses `useEffect`+`window`; detail uses `onKeyDown`).
- **Risk/effort:** MED / MED.

### D2. `add/page.tsx` — one typed `AddSeriesResponse` union + `postSeries(body)` helper
- **Where:** `add/page.tsx:24-52` and `59-75` — `onSubmit` and `addLinkOnly` build the same
  `fetch('/api/series', POST)`; the response is progressively `as`-cast three ways (30/34/35).
- **Proposal:** One typed response union + small `postSeries` helper; the three outcomes
  (needsConfirm / similarTo / success) read as a clean branch. Client-only — verify each branch routes the same.
- **Risk/effort:** MED / MED.

### D3. `SeriesDetail.tsx` — shared `runAction(url, onResult, failMsg)`
- **Where:** `SeriesDetail.tsx:66-96` — `backfill` and `trackUnlocks` share the exact
  `setBusy/try-POST-parse-setMsg-refresh/catch/finally` structure.
- **Proposal:** A small `postAction` helper; keep distinct message formatting via callback.
- **Risk/effort:** LOW / MED.

---

## Explicitly NOT worth changing (leave as-is)

- **`notify.ts`** four category loops — distinct title/body/tag logic; explicit form is clearer than a
  generic mapper (aligns with "clarity over brevity"). Only trivial win: hoist `DEFAULT_PUSH_PREFS` const.
- **`renderFetch.ts`/`fetch.ts` AbortController+timeout scaffolding** — a `withAbortTimeout` helper is
  possible but the `finally`/`catch` control flow at the impure edge is subtle; MED/MED, low payoff.
- **`validation.ts`** per-field `if (typeof …) return err(…)` verbosity — the verbosity **is** the
  point (unit-testable, explicit error strings). Do not abstract.
- **Base64url decoders** duplicated in `auth/session.ts:18-24` (edge) and `pushClient.ts:20-26`
  (browser) — different runtimes, one returns padded input; merging would couple client→server. Leave.
- **`session.ts` hand-rolled base64url**, **`ssrfGuard.ts`**, **`poll.ts`**, **`schedule.ts`**,
  **`health.ts`**, **`merge.ts`**, **`format.ts`**, **`parse.ts`**, **`title.ts`** — all at good altitude.

---

## Suggested sequencing

1. **A3** (http helpers) — cheapest, touches the most route files, unblocks cleaner handlers.
2. **A4** (status tuple) + **C** sweep — small, mechanical, low-risk.
3. **B1–B3** (`index.ts` op-builders / projection / ownership) — mechanical, sets up A1.
4. **A2** (render extraction).
5. **A1** (backfill core) — **its own TDD work package**, stop at the WP boundary first.
6. **B4–B6** (lib comparators/url helpers) as pure-logic TDD refactors.
7. **D1–D3** (client hooks) — optional, when touching those components anyway.

> Each of these should follow the project rituals: TDD for `lib/` logic (red → green → refactor),
> `npm test` + `npm run typecheck` before any "done" claim, and a check-in at every WP boundary.
