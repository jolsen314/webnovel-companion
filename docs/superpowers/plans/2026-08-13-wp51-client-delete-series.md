# WP-51 Client-Side Delete Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner delete a series from the UI — a confirm-gated delete on the detail page (above the chapters) and a per-card trash on the shelf — backed by a thin `DELETE` route over the existing `deleteSeries` service.

**Architecture:** One `DELETE` handler on the existing `/api/series/[id]` route calls the already-tested, user-scoped `deleteSeries` (cascades chapters/sources/progress). A shared `requestDeleteSeries(id)` browser helper is consumed by two focused client components: `DeleteSeries` (detail, inline two-step reveal, redirects to `/`) and `DeleteSeriesButton` (shelf card, corner trash + compact confirm popover, refreshes the list). The shelf card is restructured so the trash button is a **sibling** of the card `<Link>`, not nested inside it.

**Tech Stack:** Next.js App Router (client components), TypeScript strict, Prisma/Postgres, Vitest.

## Global Constraints

- **Keep `lib/` pure and Next-free.** (Not touched — the route is in `app/api`, components in `app/(app)`, the fetch helper is a browser util.)
- **No new pure/`lib` logic here**, so no new TDD unit cycle. `deleteSeries` is already integration-tested (cascade + not-owned). The `DELETE` route is thin glue like `GET`/`PATCH` (untested by repo convention). Components have no React harness (Playwright deferred → tracked in WP-PW) and are verified by driving the app.
- **Verify before claiming done.** No "passing"/"done" claim without fresh `npm test` + `npm run typecheck` output in the same message.
- **Delete is irreversible** (hard cascade) → every delete path is explicit-confirm-gated; never a one-click delete.
- **Shelf trash must not navigate:** the trash/confirm must be a sibling of the card `<Link>`, never a child — a tap on it must not open the series.
- **Commit gating:** per-task **local** commits on the `wp-51-client-delete-series` branch (owner-approved pattern from WP-30); nothing pushed until the owner chooses at finish.
- **Anonymity:** no real site/series names in committed content.
- **Design tokens:** reuse existing CSS vars — `--color-down` (danger accent), `--color-surface-2`/`--color-line` (panels), `--color-paper`/`--color-muted` (text), `--font-mono`. Match the existing `.control__action` button idiom; don't invent a new visual language.

---

### Task 1: `DELETE /api/series/[id]` route handler

**Files:**
- Modify: `src/app/api/series/[id]/route.ts` (add import + `DELETE` export; the file already has `GET`/`PATCH`)

**Interfaces:**
- Consumes: `deleteSeries(seriesId): Promise<{ deleted: boolean }>` from `server/services` (already exported).
- Produces: `DELETE /api/series/[id]` → `200 { ok: true }` on success, `404 { error: 'Series not found.' }` when `deleted` is false. Tasks 3–4's `requestDeleteSeries` calls this.

- [ ] **Step 1: Add `deleteSeries` to the services import**

In `src/app/api/series/[id]/route.ts`, extend the existing services import:

```ts
import { getSeries, updateSeries, deleteSeries } from '../../../../server/services';
```

- [ ] **Step 2: Add the `DELETE` handler**

Append to the same file:

```ts
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteSeries(id);
  if (!result.deleted) return NextResponse.json({ error: 'Series not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck + confirm the existing suite is green**

Run: `npm run typecheck` → clean.
Run: `npm test` → unit suite still green (no regressions).
(No new test: `deleteSeries` success-cascade + not-owned are already covered in `tests/integration/cleanup.test.ts`; the route is thin glue like `GET`/`PATCH`.)

- [ ] **Step 4: Commit** *(local only — see Global Constraints)*

```bash
git add "src/app/api/series/[id]/route.ts"
git commit -m "WP-51: DELETE /api/series/[id] over deleteSeries service"
```

---

### Task 2: Detail-page delete — `requestDeleteSeries` helper + `DeleteSeries` component

**Files:**
- Create: `src/app/(app)/requestDeleteSeries.ts`
- Create: `src/app/(app)/series/[id]/DeleteSeries.tsx`
- Modify: `src/app/(app)/series/[id]/SeriesDetail.tsx` (add `title` prop; render `<DeleteSeries>` between the controls block and the chapter `<ol>`)
- Modify: `src/app/(app)/series/[id]/page.tsx` (pass `title={series.title}` into `SeriesDetail`)
- Modify: `src/app/globals.css` (danger-zone styles)

**Interfaces:**
- Consumes: `DELETE /api/series/[id]` (Task 1).
- Produces: `requestDeleteSeries(id: string): Promise<boolean>` (shared, also used by Task 3); `<DeleteSeries id title chapterCount />`.

- [ ] **Step 1: Create the shared fetch helper**

Create `src/app/(app)/requestDeleteSeries.ts`:

```ts
/** DELETE a series via the API. Returns true on a 2xx, false on any error/non-ok. */
export async function requestDeleteSeries(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/series/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Create the `DeleteSeries` component (inline two-step reveal)**

Create `src/app/(app)/series/[id]/DeleteSeries.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestDeleteSeries } from '../../requestDeleteSeries';

export function DeleteSeries(props: { id: string; title: string; chapterCount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setConfirming(false);
    setError(null);
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    const ok = await requestDeleteSeries(props.id);
    if (ok) {
      router.push('/'); // series page is gone → back to the shelf; keep busy so buttons stay disabled
      return;
    }
    setError('Could not delete the series.');
    setBusy(false);
  }

  if (!confirming) {
    return (
      <div className="detail__danger">
        <button type="button" className="danger-button" onClick={() => setConfirming(true)}>
          Delete series
        </button>
      </div>
    );
  }

  return (
    <div
      className="detail__danger detail__danger--open"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) cancel();
      }}
    >
      <p className="detail__danger-warning">
        Delete “{props.title}”? This removes {props.chapterCount} chapters, its source, and your reading
        progress. This can’t be undone.
      </p>
      <div className="detail__danger-actions">
        <button
          type="button"
          className="danger-button danger-button--solid"
          disabled={busy}
          autoFocus
          onClick={() => void doDelete()}
        >
          {busy ? 'Deleting…' : 'Delete forever'}
        </button>
        <button type="button" className="control__action" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
      {error && (
        <span className="control__hint" role="status">
          {error}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Render it inside `SeriesDetail`, above the chapters**

In `src/app/(app)/series/[id]/SeriesDetail.tsx`:

(a) Add the import at the top:

```ts
import { DeleteSeries } from './DeleteSeries';
```

(b) Add `title` to the props type — change the component signature's props object to include `title: string` (add the line alongside `id: string;`):

```ts
export function SeriesDetail(props: {
  id: string;
  title: string;
  status: Status;
  rating: number | null;
  chapters: ChapterLite[];
  lastReadChapterId: string | null;
  sourceType: 'FEED' | 'PAGE_WATCH';
}) {
```

(c) Render `<DeleteSeries>` **between** the closing `</div>` of `<div className="detail__controls">…</div>` and the `<ol className="chapters">`. Concretely, locate the line `      <ol className="chapters">` and insert immediately before it:

```tsx
      <DeleteSeries id={props.id} title={props.title} chapterCount={props.chapters.length} />

```

- [ ] **Step 4: Pass `title` from the detail page**

In `src/app/(app)/series/[id]/page.tsx`, add `title={series.title}` to the `<SeriesDetail …>` element (it currently passes `id`, `status`, `rating`, `chapters`, `lastReadChapterId`, `sourceType`):

```tsx
      <SeriesDetail
        id={series.id}
        title={series.title}
        status={status}
        rating={series.rating}
        chapters={chapters}
        lastReadChapterId={series.progress?.lastReadChapterId ?? null}
        sourceType={active?.type ?? 'PAGE_WATCH'}
      />
```

- [ ] **Step 5: Add danger-zone styles**

In `src/app/globals.css`, near the `.control__action` rules (~L298-315), add:

```css
.detail__danger {
  margin: 0.4rem 0 1rem;
  padding-top: 0.8rem;
  border-top: 1px solid var(--color-line);
}
.detail__danger--open {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.detail__danger-warning {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.85rem;
  max-width: 42rem;
}
.detail__danger-actions {
  display: flex;
  gap: 0.5rem;
}
.danger-button {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--color-down);
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  cursor: pointer;
}
.danger-button:hover:not(:disabled) {
  border-color: var(--color-down);
}
.danger-button--solid {
  color: var(--color-ink);
  background: var(--color-down);
  border-color: var(--color-down);
}
.danger-button--solid:hover:not(:disabled) {
  filter: brightness(1.06);
}
.danger-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
```

- [ ] **Step 6: Typecheck + suite**

Run: `npm run typecheck` → clean.
Run: `npm test` → unit suite green.

- [ ] **Step 7: Commit** *(local only)*

```bash
git add "src/app/(app)/requestDeleteSeries.ts" "src/app/(app)/series/[id]/DeleteSeries.tsx" "src/app/(app)/series/[id]/SeriesDetail.tsx" "src/app/(app)/series/[id]/page.tsx" src/app/globals.css
git commit -m "WP-51: detail-page delete (inline confirm, above chapters)"
```

---

### Task 3: Shelf delete — `DeleteSeriesButton` + card restructure

**Files:**
- Create: `src/app/(app)/DeleteSeriesButton.tsx`
- Modify: `src/app/(app)/page.tsx` (wrap the card `<Link>` in a `.card-wrap`, render `<DeleteSeriesButton>` as the Link's sibling)
- Modify: `src/app/globals.css` (card-wrap + trash + confirm-popover styles)

**Interfaces:**
- Consumes: `requestDeleteSeries` (Task 2); `SeriesRow` fields `id`, `title`, `chapterCount` (all already returned by `listSeries`).
- Produces: `<DeleteSeriesButton id title chapterCount />` rendered per shelf card.

- [ ] **Step 1: Create the `DeleteSeriesButton` component**

Create `src/app/(app)/DeleteSeriesButton.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestDeleteSeries } from './requestDeleteSeries';

export function DeleteSeriesButton(props: { id: string; title: string; chapterCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function doDelete() {
    setBusy(true);
    setError(null);
    const ok = await requestDeleteSeries(props.id);
    if (ok) {
      setOpen(false);
      router.refresh(); // card drops out of the re-fetched list
      return;
    }
    setError('Delete failed.');
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        className="card__delete"
        aria-label={`Delete ${props.title}`}
        onClick={() => setOpen(true)}
      >
        🗑
      </button>
      {open && (
        <div className="card__confirm" role="dialog" aria-label={`Delete ${props.title}`}>
          <p className="card__confirm-text">
            Delete “{props.title}”? {props.chapterCount} chapters + progress. Can’t be undone.
          </p>
          <div className="card__confirm-actions">
            <button
              type="button"
              className="danger-button danger-button--solid"
              disabled={busy}
              onClick={() => void doDelete()}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              className="control__action"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
          {error && (
            <span className="control__hint" role="status">
              {error}
            </span>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Restructure `SeriesCard` in the library page**

In `src/app/(app)/page.tsx`, add the import:

```ts
import { DeleteSeriesButton } from './DeleteSeriesButton';
```

Then wrap the card's returned `<Link>…</Link>` in a `.card-wrap` div and add the button as a sibling. Replace `SeriesCard`'s `return (…)` so the outer element is:

```tsx
  return (
    <div className="card-wrap">
      <Link href={`/series/${series.id}`} className="card">
        {unread > 0 && <span className="card__ribbon" aria-hidden="true" />}
        <div className="card__body">
          <div className="card__top">
            <h2 className="card__title">{series.title}</h2>
            {unread > 0 && <span className="card__unread">{unread} new</span>}
          </div>
          <p className="card__latest">
            {latest ? (
              <>
                {latest.number != null && <span className="card__num">#{latest.number} </span>}
                <b>{latest.title}</b>
              </>
            ) : (
              'No chapters yet'
            )}
          </p>
          <div className="card__meta">
            {series.status !== 'READING' && <span className="status-chip">{series.status}</span>}
            {series.activeSource && (
              <>
                <span className={`health-dot health-dot--${series.activeSource.health}`} title={series.activeSource.health} />
                <span>{series.activeSource.host}</span>
              </>
            )}
            {latest?.at && <span>· {relativeTime(new Date(latest.at), now)}</span>}
          </div>
        </div>
      </Link>
      <DeleteSeriesButton id={series.id} title={series.title} chapterCount={series.chapterCount} />
    </div>
  );
```

(This is the existing card body verbatim, only wrapped in `.card-wrap` with the sibling button added. `series.chapterCount` is already on `SeriesRow`.)

- [ ] **Step 3: Add card-wrap / trash / popover styles**

In `src/app/globals.css`, near the `.card` rules (~L512-540), add:

```css
.card-wrap {
  position: relative;
}
.card__delete {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 1;
  font-size: 0.85rem;
  line-height: 1;
  padding: 0.25rem 0.4rem;
  color: var(--color-muted);
  background: color-mix(in oklab, var(--color-surface-2) 88%, transparent);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.card-wrap:hover .card__delete,
.card__delete:focus-visible {
  opacity: 1;
}
.card__delete:hover {
  color: var(--color-down);
  border-color: var(--color-down);
}
/* Touch / no-hover devices: always show the trash so it's reachable. */
@media (hover: none) {
  .card__delete {
    opacity: 1;
  }
}
.card__confirm {
  position: absolute;
  top: 2.4rem;
  right: 0.5rem;
  z-index: 2;
  width: min(20rem, calc(100% - 1rem));
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.7rem 0.8rem;
  background: var(--color-surface-2);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.card__confirm-text {
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-paper);
}
.card__confirm-actions {
  display: flex;
  gap: 0.5rem;
}
```

- [ ] **Step 4: Typecheck + suite**

Run: `npm run typecheck` → clean.
Run: `npm test` → unit suite green.

- [ ] **Step 5: Commit** *(local only)*

```bash
git add "src/app/(app)/DeleteSeriesButton.tsx" "src/app/(app)/page.tsx" src/app/globals.css
git commit -m "WP-51: shelf-card delete (corner trash + confirm popover)"
```

---

### Task 4: Plan bookkeeping — WP-51 done, create WP-PW as NEXT

**Files:**
- Modify: `PLAN.md` (active-queue table, Current focus, a new `### WP-PW` detail section, Changelog)
- Add (commit): the spec + this plan under `docs/superpowers/`

**Interfaces:** none (docs only).

- [ ] **Step 1: Active-queue table**

- Remove the `WP-51` row and add it to the ✅ Completed enumeration (`· WP-51 (client-side delete series — detail + shelf)`).
- Add a **new top row** for WP-PW, marked `NEXT`, and set the row that had been `NEXT` order accordingly (WP-PW becomes row 1). Use this row text:

```
| WP-PW | **Playwright E2E harness + backfill UI coverage** — stand up the deferred Playwright/E2E harness (config, one auth-aware setup), then work the **UI-coverage checklist** (WP detail) of shipped UI-only flows that ship without automated coverage. Standing rule: any UI-only WP appends its flow(s) to that checklist | `NEXT` | WP-10, WP-AUTH |
```

- [ ] **Step 2: Add the `### WP-PW` detail section with the seeded checklist**

Add a detail section (near the other WP detail sections) containing the UI-coverage checklist seeded with the already-shipped UI-only flows:

```
### WP-PW — Playwright E2E harness + backfill UI coverage

Stand up the Playwright E2E harness the README has long deferred (`playwright.config.ts`, an auth-aware
setup that clears the WP-AUTH gate once), then backfill coverage for UI flows that shipped **without any
automated test** (no React harness existed when they landed). **Standing close-out rule:** every UI-only WP
appends its flow(s) here at completion, so deferred coverage is tracked, not lost.

**UI-coverage checklist (cover when the harness lands):**
- [ ] WP-10 — library grid renders; detail-page Status / Rating / mark-read controls PATCH + reflect.
- [ ] WP-34 — "Track unlocks (switch to TOC)" button; "Backfill from TOC" button (detail controls).
- [ ] WP-30 — inline title edit (`EditableTitle`): pencil → edit → save → title updates + persists.
- [ ] WP-51 — delete: detail inline confirm → redirected to shelf, series gone; shelf trash → confirm →
      card disappears, and tapping trash does NOT open the card.
```

- [ ] **Step 3: Update Current focus + Changelog**

- Rewrite the top `> **NEXT: …**` line to describe **WP-PW** as the new NEXT (Playwright harness + UI-coverage backfill).
- Prepend a WP-51 entry to "Recently landed": `WP-51 (client-side delete series — DELETE route + confirm-gated detail delete above the chapters + per-card shelf trash; seeded WP-PW)`.
- Add a Changelog entry (`- **2026-08-13** — **WP-51 done: client-side delete series.** …`) covering: the `DELETE /api/series/[id]` route over the existing `deleteSeries` cascade; the inline detail confirm (placed above the chapter list per owner) and the sibling-of-Link shelf trash + confirm popover; and that a new **WP-PW** was created and made `NEXT` to build the Playwright harness and backfill the UI-coverage checklist (seeded with WP-10/WP-34/WP-30/WP-51) before that backlog grows.

- [ ] **Step 4: Commit** *(local only)*

```bash
git add PLAN.md docs/superpowers/specs/2026-08-13-wp51-client-delete-series-design.md docs/superpowers/plans/2026-08-13-wp51-client-delete-series.md
git commit -m "docs: WP-51 done (client-side delete); create WP-PW (E2E harness) as NEXT"
```

- [ ] **Step 5: WP-boundary check-in**

Per CLAUDE.md working agreement #4, stop here and check in with the owner (and offer the manual app-drive verification of both delete flows) before picking up WP-PW.

---

## Self-Review

**Spec coverage:**
- `DELETE` route (200 / 404) → Task 1. ✓
- Shared `requestDeleteSeries` → Task 2 Step 1. ✓
- Detail inline delete above the chapters, redirect to `/` → Task 2 (rendered inside `SeriesDetail` before the `<ol>`). ✓
- Shelf trash as Link-sibling + confirm popover + `router.refresh()`, no-navigate → Task 3. ✓
- Styles (danger zone, card-wrap/trash/popover, hover + `@media (hover: none)`) → Tasks 2–3. ✓
- WP-PW created, seeded, marked NEXT; WP-51 → Completed; changelog → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. The card body in Task 3 Step 2 is repeated in full (not "same as existing") so the task is self-contained. ✓

**Type consistency:** `requestDeleteSeries(id: string): Promise<boolean>` defined in Task 2, imported by Tasks 2 & 3 with the correct relative paths (`../../requestDeleteSeries` from `series/[id]/`, `./requestDeleteSeries` from `(app)/`). `DeleteSeries`/`DeleteSeriesButton` props `{ id, title, chapterCount }` match their call sites (`props.chapters.length` for detail, `series.chapterCount` for shelf). `SeriesDetail` gains `title: string`, passed from `page.tsx`. ✓