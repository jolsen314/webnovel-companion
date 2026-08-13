# WP-30 — Manual title-edit UI (frontend follow-up)

**Status:** design approved 2026-08-13. Depends on WP-10 (detail UI, done), WP-AUTH (done), and the WP-30
backend core (done 2026-07-31 — `Series.titleIsManual` flag + auto-backfill already respects it). This is the
deferred frontend half named in the [backend spec](2026-07-31-wp30-title-backfill-design.md): the in-app
manual title-edit control.

## Problem

Auto-backfill repairs a wrong series title from the page `<h1>`/`og:title`/`<title>` — but only when the page
yields a clean heading. When it can't (JS-rendered/CF TOC with no usable heading, or a title that no page
signal gets right), the reader has no way to fix the name themselves. The escape hatch — a manual title edit
in the detail UI — was specified but not built. The backend flag `titleIsManual` shipped so that a hand-fix,
once it exists, is never clobbered by a later auto-backfill; this WP writes to that flag.

## Scope

**Only** the manual title-edit control (UI + the API/service wiring it needs). Two other WP-30-adjacent
sub-threads are explicitly **out of scope** and stay where the plan records them:

- **Consent/cookie-banner `<h1>` reject-list** (backend `extractSeriesTitle` fix — the "third cause") lives in
  PLAN.md WP-30 detail. At the end of this work it will be **split into its own active-queue row (WP-30b)** so
  it isn't orphaned when WP-30's row closes.
- **HTML-entity-encoded titles rendering as raw codes** — the **extraction** half (decode at
  `extractSeriesTitle`) is now tracked under PLAN.md **WP-30b** alongside the consent-h1 reject-list (same
  `lib/feeds/title.ts` file); the **display-side decode** catch-all stays under PLAN.md WP-28 detail.

## Design

### 1. Validation — `src/server/api/validation.ts` (test-first, pure)

Extend `SeriesUpdate` with an optional `title?: string`. In `parseSeriesUpdate`, when `input.title` is
present:

- Must be a string, else `'"title" must be a string.'`.
- **Trim** it. If empty after trim → `'"title" cannot be empty.'`.
- If longer than **500** characters (after trim) → `'"title" is too long.'` (guards a paste accident; real
  titles are well under this).
- Store the trimmed value on `value.title`.

The existing "no fields to update" guard still applies (a body with only an invalid/absent title never
reaches the service).

**Unit tests** in `tests/unit/server/validation.test.ts` (extend the `parseSeriesUpdate` describe):
accepts a valid title and stores it **trimmed**; rejects empty string; rejects whitespace-only; rejects a
non-string; rejects an over-length (>500) title.

### 2. Service — `src/server/services/series.ts`

In `updateSeries`, when `patch.title !== undefined`:

- `seriesData.title = patch.title`
- `seriesData.titleIsManual = true`

Both go through the existing `seriesData`/`db.series.update` path (no new op), so a single PATCH can still
carry other fields alongside title.

**Integration test** in `tests/integration/services.test.ts`: updating `title` persists the new title and
flips `titleIsManual` to `true`; a subsequent `backfillFromToc` (or the backfill title path) leaves the
manual title untouched — asserting the flag actually protects the hand-fix end to end.

### 3. UI — `EditableTitle` client component (new)

A small, single-purpose client component rather than lifting the title into the larger `SeriesDetail`
component (the detail meta row needs server-only source data, so keep it server-side).

- **File:** `src/app/(app)/series/[id]/EditableTitle.tsx`
- **Props:** `{ id: string; initialTitle: string }`
- **Display state:** renders `<h1 className="detail__title">` with the title, plus a small edit button
  (pencil glyph, `aria-label="Edit title"`) — reusing the existing `.detail__title` class so nothing shifts
  visually.
- **Edit state:** clicking edit swaps the h1 for a text input pre-filled with the current title, with
  **Save** and **Cancel**. **Enter** saves, **Esc** cancels. Save is disabled while the input is empty
  (after trim) or unchanged from the current title. The input autofocuses.
- **Save:** `PATCH /api/series/[id]` with `{ title }` (trimmed), then `router.refresh()` so the server
  re-renders the new title (and any dependent server state). While in flight, controls are disabled.
- **Failure:** show an inline error (`role="status"`), stay in edit mode so the user can retry or cancel.
- **Wiring:** in `src/app/(app)/series/[id]/page.tsx`, replace the static
  `<h1 className="detail__title">{series.title}</h1>` with
  `<EditableTitle id={series.id} initialTitle={series.title} />`. `SeriesDetail` is untouched.
- **Styles:** minor additions to `src/app/globals.css` for the edit button + input/Save/Cancel affordances,
  following the existing `.control` / `.control__action` idiom.

No React component test harness exists yet (Playwright arrives later, WP-11+), so the component is verified by
driving the running app end to end (edit → save → refresh shows new title; reload confirms persistence and
that auto-backfill leaves it alone).

## Out of scope / non-goals

- No bulk/library-grid title editing — detail page only.
- No consent-banner reject-list or entity-decode work (see Scope).
- No new test framework for the React layer.

## Definition of Done

- `parseSeriesUpdate` accepts/validates `title` with unit coverage for the accept + four reject cases.
- `updateSeries` writes `title` + `titleIsManual = true`, with an integration test proving the manual title
  survives a backfill.
- Detail page inline-edits the title (Enter/Esc/Save/Cancel), persists via PATCH, and refreshes.
- `npm test` + `npm run typecheck` green.
- Plan updated: WP-30 UI marked done; **consent-h1 split out as its own WP-30b active-queue row**; changelog
  line added.
