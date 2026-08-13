# WP-51 — Client-side delete series (detail + shelf)

**Status:** design approved 2026-08-13. Depends on WP-10 (library/detail UI, done) and WP-AUTH (done).
Split out of WP-CLEANUP-UI as a quick win; **merge / reset-chapters / edit-source stay in WP-CLEANUP-UI.**

## Problem

There's no way to remove a series from the app — only the `db:cleanup delete-series` CLI can. A mis-added
series, a dropped read, or test junk sits in the library forever. The `deleteSeries` service already exists
(user-scoped, cascades chapters/sources/progress, integration-tested); WP-51 exposes it through the UI.

The owner wants delete reachable from **two** places: the series **detail page** and the **shelf list**, and —
on the detail page — **without scrolling past the chapter list** to reach it.

## Design

### 1. API — `DELETE` handler on the existing route

Add a `DELETE` export to `src/app/api/series/[id]/route.ts` (which already has `GET`/`PATCH`), thin glue over
the existing service:

```ts
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteSeries(id);
  if (!result.deleted) return NextResponse.json({ error: 'Series not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

`deleteSeries` (from `server/services`) returns `{ deleted: false }` for a missing or not-owned id → 404, so
there's no cross-user delete. No service or schema change. No new backend test: `deleteSeries` is already
covered in `tests/integration/cleanup.test.ts` for the success-cascade (series + chapters + sources removed)
and the not-owned → `{ deleted: false }` (other user's series untouched) paths; the route is thin glue like
`GET`/`PATCH`, which carry no route-level tests by the same convention.

### 2. Shared client helper — `requestDeleteSeries`

A tiny browser-fetch wrapper so the two UI surfaces don't duplicate the network + error handling:

```ts
// src/app/(app)/requestDeleteSeries.ts
export async function requestDeleteSeries(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/series/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
```

Both components own their own post-success navigation (that's what differs between them), so only this
network call is shared.

### 3. Detail page — `DeleteSeries` component (inline two-step reveal), above the chapters

`SeriesDetail` (`src/app/(app)/series/[id]/SeriesDetail.tsx`) renders, as one fragment, the
`.detail__controls` block **and** the `<ol className="chapters">` list. To put delete above the chapters
without splitting that component, `DeleteSeries` is rendered **inside `SeriesDetail`, between the controls
block and the chapter `<ol>`**.

- **File:** `src/app/(app)/series/[id]/DeleteSeries.tsx` (client). Props `{ id: string; title: string; chapterCount: number }`.
- **`SeriesDetail` prop additions:** it already receives `id`; add `title: string` (and it already knows the
  chapter count via `props.chapters.length`). It renders `<DeleteSeries id={props.id} title={props.title}
  chapterCount={props.chapters.length} />` right after the controls `<div className="detail__controls">…</div>`
  and before `<ol className="chapters">`. `page.tsx` passes the new `title={series.title}` prop down.
- **Collapsed state:** a de-emphasized "Delete series" button in a `.detail__danger` row.
- **Expanded state (on click):** a styled warning — *"Delete "{title}"? This removes {chapterCount} chapters,
  its source, and your reading progress. This can't be undone."* — with **[Delete forever]** and **[Cancel]**.
- **Confirm:** calls `requestDeleteSeries(id)`; on `true` → `router.push('/')` (the detail page no longer
  exists → land on the shelf). On `false` → inline `role="status"` error, stay expanded. Buttons disabled
  while in flight. `Escape`/Cancel collapses it.

### 4. Shelf card — `DeleteSeriesButton` component (corner trash + compact confirm)

The library card (`src/app/(app)/page.tsx`, `SeriesCard`) is a full-card `<Link>`. To add delete without a
"button nested in a link" navigation conflict:

- **Restructure the card:** wrap the existing `<Link className="card">` in a `position: relative` container
  (`.card-wrap`) and render the trash button as a **sibling of the Link, not a child** — so a tap on the trash
  never reaches the Link (no `stopPropagation` needed). The card body markup is otherwise unchanged.
- **File:** `src/app/(app)/DeleteSeriesButton.tsx` (client). Props `{ id: string; title: string; chapterCount: number }`.
- **Trash affordance:** a small trash-icon button absolutely positioned in the card's top-right corner,
  `aria-label={`Delete ${title}`}`. Hover-revealed on pointer devices; always visible where hover is
  unavailable (`@media (hover: none)`), so it's reachable on touch.
- **Confirm:** tapping trash opens a compact confirm popover anchored to the card (absolutely positioned within
  `.card-wrap`) with the short warning + **[Delete]** / **[Cancel]**. On confirm → `requestDeleteSeries(id)`;
  on `true` → `router.refresh()` (the card drops out of the re-fetched list); on `false` → inline error in the
  popover. `Escape`/Cancel closes it.
- `listSeries` already returns `chapterCount` per row, so `SeriesCard` passes `series.chapterCount` and
  `series.title` down. Because the button is a client component, `SeriesCard` can stay a server component and
  just render `<DeleteSeriesButton>` as the Link's sibling.

### 5. Styles — `globals.css`

- `.card-wrap { position: relative }`; `.card__delete` (trash) top-right, opacity 0 → 1 on `.card-wrap:hover`,
  and always-visible under `@media (hover: none)`; the confirm popover panel.
- `.detail__danger` row + a de-emphasized/danger button style for the detail delete, consistent with the
  existing `.control__action` idiom but visually distinct (danger accent).

## Testing

- **Backend:** none new — `deleteSeries` cascade + not-owned paths are already covered (see §1).
- **Components:** no React test harness exists yet (Playwright is deferred — see below), so verified by driving
  the running app: (a) detail — expand → Delete forever → redirected to shelf, series gone; Cancel closes with
  no change; (b) shelf — trash reveals, confirm → card disappears (list re-fetches); tapping trash does **not**
  open the card; reload confirms deletion persisted in both cases.
- **Deferred E2E coverage (tracked, not skipped):** both delete flows are added to the new **WP-PW** UI-coverage
  checklist (below), so they get real Playwright coverage when that harness is built rather than being lost.

## Plan bookkeeping (part of this WP)

- **Create `WP-PW`** — *"Playwright E2E harness + backfill UI coverage."* A new active-queue row plus a detail
  section carrying a **UI-coverage checklist** of shipped-but-unautomated UI flows. Seed it with:
  WP-10 (status/rating/mark-read controls, library grid), WP-34 (Track-unlocks + Backfill-from-TOC buttons),
  WP-30 (inline title edit), WP-51 (delete — detail inline + shelf trash). The WP-PW section states the
  standing close-out step: **any UI-only WP appends its flow(s) to this checklist**, since those flows ship
  without automated coverage until the harness exists.
- **WP-PW is the immediate `NEXT`** (owner call, 2026-08-13) — seed it as the **top active-queue row with
  status `NEXT`** and point Current focus's NEXT at it, so the harness gets built before the coverage backlog
  grows unwieldy.
- **WP-51 → Completed**; changelog line.

## Out of scope / non-goals

- No merge / reset-chapters / edit-source UI (those stay in WP-CLEANUP-UI).
- No bulk/multi-select delete, no undo/soft-delete (the action is a hard cascade, gated by explicit confirm;
  re-adding the URL is the recovery path).
- Building the Playwright harness itself is WP-PW, not this WP — WP-51 only seeds its checklist.

## Definition of Done

- `DELETE /api/series/[id]` deletes an owned series (200) and 404s a missing/not-owned one.
- Detail page: a confirm-gated delete above the chapter list; on confirm the series is removed and the app
  lands on the shelf.
- Shelf: a per-card trash → compact confirm; on confirm the card disappears; tapping trash never navigates
  into the card.
- `npm test` + `npm run typecheck` green (no regressions; no new backend tests required).
- Plan updated: WP-51 → Completed; **WP-PW created, seeded (incl. WP-51's flows), and marked `NEXT`** (top of
  the active queue + Current focus); changelog line added.