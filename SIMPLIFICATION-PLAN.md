# Simplification Plan — findings & progress

> Produced by a read-only `code-simplifier` pass over `src/**` (lib / server / app-and-routes),
> 2026-08-17. Every item preserves behavior — clarity/consistency/DRY refinements, no correctness
> bugs. Tracked under **WP-SIMPLIFY** in PLAN.md.

## Status (2026-08-18)

**Done** (each committed to `main`, all gates green — unit / typecheck / integration):
A3, A4, Tier C (C1–C6), Tier B (B1–B6), A2.

**Remaining:** **A1** (the strategic `backfill` core extraction — its own TDD work package) and
the optional **Tier D** (client-component hooks). Full detail for both below.

## Overall health

The codebase is in **good shape** and follows a deliberate ports-and-adapters discipline:
pure, fake-tested cores behind ports, with Prisma/HTTP/Puppeteer bound only at the edges.
After the work above, the remaining concentrated debt is `services/index.ts`'s `backfillFromToc`
(genuine, untested decision logic in the edge layer) — that's A1.

---

## ✅ Completed (slimmed — see git history for specifics)

- **A3** — `server/api/http.ts` (`readJson` + `jsonError`); collapsed the body-parse + `parse→400`
  boilerplate across the 6 mutating route handlers.
- **A4** — one pure `lib/series.ts` (`SERIES_STATUSES` + `SeriesStatus`); killed the 3–4-way
  drift across `validation.ts`, `poll.ts`, and the two detail-UI files.
- **Tier C** — style/consistency sweep: nested ternaries flattened in `pageWatch.tocReadingOrder`,
  `dedup.canonicalSeriesId` (→ `switch`), and `reading` id tie-break (`compareStrings`, not
  `localeCompare`); `renderFetch` status→outcome map folded into `httpFailureOutcome`; `discover`
  stray import moved up; shared `IdParams` alias + `_request` naming + inlined `read` in the routes/UI.
- **Tier B** — de-duplication: `nullsLastAsc` comparator (`reading`), `pathnameOf` (`diff`, used by
  `discover`/`pageWatch`), `seriesPathAndSlug` (`discover`); new `ownership.ts`
  (`ownsSeries`/`ownsSource`) single-sourcing the guard; `toKnownChapter` +
  `becameFreeOps`/`accessReconciledOps` shared across `applyPollEffects`/`backfillFromToc`.
- **A2** — extracted the Puppeteer logic into `server/render/renderPage.ts`; `api/render/route.ts`
  is now a thin auth → SSRF-validate → delegate handler (104 → 42 lines).

---

## ⏳ A1 — Extract a `backfill` core out of `services/index.ts` (own WP, test-first)

- **Where:** `src/server/services/index.ts` (`backfillFromToc`, `backfillWithEscalation`, `switchToPageWatch`)
- **Problem:** The file header declares itself "the thin edge… logic lives in ./poll and ./addSeries
  (unit-tested with fakes)." But `backfillFromToc` (~110 lines) holds real, un-unit-tested decision
  logic: the self-heal TOC-discovery hop, the three-way title-source selection, and the
  `tocReindexable` collision reasoning — the subtlest branches in the file. (The Tier B extractions
  already removed the mechanical duplication here; the decision logic is what's left.)
- **Proposal:** New `services/backfill.ts` with a pure `computeBackfill(stored, toc, opts)` core +
  `BackfillPorts` (mirroring `SchedulePorts`/`PollPorts`), unit-tested with fakes. `index.ts` shrinks
  toward its intended edge-binding role.
- **Risk/effort:** MED risk / HIGH effort. The strategic item — **its own work package, TDD**,
  stop-at-WP-boundary per CLAUDE.md. Best given its own focused session, not tacked onto a sweep.

---

## ⏳ Tier D — client-component duplication (medium effort, optional)

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
  `fetch('/api/series', POST)`; the response is progressively `as`-cast three ways.
- **Proposal:** One typed response union + small `postSeries` helper; the three outcomes
  (needsConfirm / similarTo / success) read as a clean branch. Client-only — verify each branch routes the same.
- **Risk/effort:** MED / MED.

### D3. `SeriesDetail.tsx` — shared `runAction(url, onResult, failMsg)`
- **Where:** `SeriesDetail.tsx` — `backfill` and `trackUnlocks` share the exact
  `setBusy/try-POST-parse-setMsg-refresh/catch/finally` structure.
- **Proposal:** A small `postAction` helper; keep distinct message formatting via callback.
- **Risk/effort:** LOW / MED.

---

## Explicitly NOT worth changing (leave as-is)

- **`notify.ts`** four category loops — distinct title/body/tag logic; explicit form is clearer than a
  generic mapper. Only trivial win: hoist `DEFAULT_PUSH_PREFS` const.
- **`renderFetch.ts`/`fetch.ts` AbortController+timeout scaffolding** — a `withAbortTimeout` helper is
  possible but the `finally`/`catch` control flow at the impure edge is subtle; MED/MED, low payoff.
- **`validation.ts`** per-field `if (typeof …) return err(…)` verbosity — the verbosity **is** the
  point (unit-testable, explicit error strings). Do not abstract.
- **Base64url decoders** duplicated in `auth/session.ts` (edge) and `pushClient.ts` (browser) —
  different runtimes, one returns padded input; merging would couple client→server. Leave.
- **`session.ts` hand-rolled base64url**, **`ssrfGuard.ts`**, **`poll.ts`**, **`schedule.ts`**,
  **`health.ts`**, **`merge.ts`**, **`format.ts`**, **`parse.ts`**, **`title.ts`** — all at good altitude.
