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

- **Where:** `src/server/services/index.ts` — `backfillFromToc` (currently ~438–539),
  called by `backfillWithEscalation` (~547) and `switchToPageWatch` (~574). Line numbers drift; grep
  the function names.
- **Problem:** The file header declares itself "the thin edge… logic lives in ./poll and ./addSeries
  (unit-tested with fakes)." But `backfillFromToc` holds real, un-unit-tested decision logic — the
  subtlest branches in the file — currently reachable only through the integration test. (The Tier B
  extractions removed the mechanical duplication; the *decision* logic is what's left.)

### The crux: I/O and decisions are interleaved

`backfillFromToc` is **not** "load everything → decide once → write once." Two of its fetches are
*conditional on prior pure decisions*, so a single `computeBackfill(stored, toc, opts)` over
pre-fetched inputs does not fit. Current flow (I = I/O, D = pure decision):

1. **I** load owned series (ownership + `title`/`titleIsManual`); bail if not owned
2. **I** load active source; bail if none
3. **D** `tocUrl = source.tocUrl ?? source.url`
4. **I** `fetch(tocUrl)`; bail unless SUCCESS & not-304
5. **D** `landingBody = source.tocUrl == null ? res.body : null`
6. **self-heal, only if `source.tocUrl == null`:** **D** `findTocUrl(res.body)` → **I** `fetch(link)` →
   **D** accept the follow (reassign `tocUrl`/`res`/`discoveredTocUrl`)
7. **D** `parseToc(res.body, tocUrl)` → `toc`
8. **title:** **D** pick `titleBody` (captured landing → else needs a fetch) → **I** *conditional*
   `fetch(source.url)` → **D** `extractSeriesTitle` → `titleUpdated`
9. **D** `tocReadingOrder(toc)` → `order`
10. **I** load stored chapters
11. **D** `diffChapters`, the `tocReindexable` collision predicate, the reindex position map
12. **D** assemble the write list (createMany-with-position, `becameFreeOps`, `accessReconciledOps`,
    reindex updates, optional `tocUrl`/`title` persists)
13. **I** `db.$transaction([...])`

Steps 6 and 8 are the reason this is HIGH-effort: the seam has to let pure decisions drive fetches,
not run after them.

### A viable seam (starting proposal, not the mandate)

Split into **(a) a thin async orchestrator** that owns the interleaving, behind ports, and
**(b) pure, unit-tested pieces** it drives. The already-pure lib building blocks it composes —
`findTocUrl`, `parseToc`, `tocReadingOrder`, `diffChapters`, `extractSeriesTitle`, `canonicalUrl` —
stay put; the new pure code is the *glue decisions* plus the write-planner:

```ts
// services/backfill.ts — pure, NO db import (mirrors scheduleNotify.ts's shape)
export interface BackfillMeta {          // what a DB loader supplies up front
  currentTitle: string; titleIsManual: boolean;
  sourceId: string; sourceUrl: string; host: string; tocUrl: string | null;
}
export interface BackfillPlan {          // pure description of intended writes (no Prisma)
  newChapters: { title: string; url: string; guid: string | null; number: number | null;
                 access: 'FREE' | 'LOCKED' | 'UNKNOWN'; position: number | null }[];
  becameFree: KnownChapter[]; accessReconciled: KnownChapter[];
  reindex: { id: string; position: number }[];
  persistTocUrl?: string; persistTitle?: string;
}
/** Steps 9,11,12 as one pure function over already-fetched inputs. */
export function computeBackfillPlan(
  stored: KnownChapter[], toc: FeedItem[], meta: BackfillMeta,
  opts: { discoveredTocUrl: string | null; titleUpdate: string | undefined },
): BackfillPlan { /* diff + tocReindexable + reindex map + persists */ }
/** Step 8's decision, isolated and pure. */
export function chooseTitleUpdate(
  meta: { titleIsManual: boolean; currentTitle: string; host: string },
  titleBody: string | null, tocBody: string,
): string | undefined { /* extractSeriesTitle + the != current guard */ }

export interface BackfillPorts {         // the interleaved I/O, injected
  fetch: FetchImpl;
  loadSeriesMeta: (seriesId: string) => Promise<BackfillMeta | null>;  // ownership + active source
  loadStoredChapters: (seriesId: string) => Promise<KnownChapter[]>;
  applyBackfillPlan: (seriesId: string, plan: BackfillPlan) => Promise<void>;
}
```

`index.ts` keeps only the thin orchestrator (the step 1–13 sequence, driving `BackfillPorts` +
the pure helpers) and the Prisma binding of the four ports — exactly how `pollPorts`/`evaluateSchedules`
are wired today. `applyBackfillPlan` is where `createMany`/`becameFreeOps`/`accessReconciledOps`/the
reindex/persist ops get built from the plan.

### Test baseline

- **Current safety net:** `tests/integration/services.test.ts` exercises `backfillWithEscalation`
  (hence `backfillFromToc`) against the real test DB — keep it green as the binding check.
  `tests/unit/server/addSeries.test.ts` covers the adjacent add path, not backfill's decisions.
- **Goal:** unit-test `computeBackfillPlan` + `chooseTitleUpdate` with fakes (no DB) — the
  self-heal accept/reject, the three title-source branches, and the `tocReindexable` collision cases
  (listed / absent-unpositioned / absent-with-position) — the way `poll`/`scheduleNotify` cores are tested.

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
