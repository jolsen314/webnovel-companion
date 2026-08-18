# Simplification Plan — findings & progress

> Produced by a read-only `code-simplifier` pass over `src/**` (lib / server / app-and-routes),
> 2026-08-17. Every item preserves behavior — clarity/consistency/DRY refinements, no correctness
> bugs. Tracked under **WP-SIMPLIFY** in PLAN.md.

## Status (2026-08-18)

**Done** (all gates green — unit / typecheck / integration; Tier D verified via Playwright E2E):
A3, A4, Tier C (C1–C6), Tier B (B1–B6), A2, **A1**, **Tier D (D1–D3)**.

**Remaining:** nothing from this pass — the whole backlog is worked through. (Re-run the
`code-simplifier` when there's fresh drift and record the next round here.)

## Overall health

The codebase is in **good shape** and follows a deliberate ports-and-adapters discipline:
pure, fake-tested cores behind ports, with Prisma/HTTP/Puppeteer bound only at the edges.
The last concentrated debt — `services/index.ts`'s `backfillFromToc` decision logic — was
resolved by **A1** (done 2026-08-18): extracted to a pure, fake-tested `services/backfill.ts`
(`computeBackfillPlan` + `chooseTitleUpdate` + a `runBackfill` orchestrator behind `BackfillPorts`).

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

## ✅ A1 — Extract a `backfill` core out of `services/index.ts` — **DONE 2026-08-18**

`backfillFromToc`'s un-unit-tested decision logic (the `tocReindexable` collision predicate, the
three-way title-source choice, the self-heal TOC-discovery hop) moved into a pure, fake-tested
`services/backfill.ts`: `computeBackfillPlan(stored, toc, opts)` + `chooseTitleUpdate(meta, titleBody,
tocBody)` + a thin async `runBackfill` orchestrator driving injected `BackfillPorts` (mirrors
`pollPorts`/`schedulePorts`). `index.ts` keeps only the Prisma port binding; `loadSeriesMeta` folds the
ownership + active-source loads into one. 23 unit tests in `tests/unit/server/backfill.test.ts` (self-heal
accept/reject, title-source branches, the three reindex cases); the integration suite stays green as the
binding check. Two proposal corrections made against the code: `computeBackfillPlan`'s `stored` is
`StoredChapter` (`KnownChapter` + `position`, which the reindex predicate needs) and takes no `meta`;
`applyBackfillPlan(sourceId, plan)` threads the runtime `sourceId`.

---

## ✅ Tier D — client-component duplication — **DONE 2026-08-18** (verified via Playwright E2E)

- **D1** — `useDeleteSeries({ id, onDeleted, failMessage })` hook (`(app)/useDeleteSeries.ts`) single-sources
  the confirm/busy/error machine + `requestDeleteSeries` + Escape-to-cancel behind the shelf
  (`DeleteSeriesButton`) and detail (`DeleteSeries`) components; each keeps its own JSX. Escape standardized to
  the hook's window listener (detail dropped its `onKeyDown`).
- **D2** — `add/page.tsx`: one typed `AddSeriesResponse` union + a module-level `postSeries(body)` helper;
  `onSubmit`/`addLinkOnly` now branch the three outcomes (needsConfirm / similarTo / success) with no `as` casts.
- **D3** — `SeriesDetail.tsx`: a shared `postAction(url, setMessage, format, failMsg)` folds `backfill` +
  `trackUnlocks` (identical POST/parse/hint/refresh/catch structure); distinct copy stays in the `format` callback.

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
