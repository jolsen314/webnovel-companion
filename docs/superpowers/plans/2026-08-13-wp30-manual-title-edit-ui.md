# WP-30 Manual Title-Edit UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reader fix a series title by hand on the detail page; a manual edit pins `titleIsManual` so auto-backfill never clobbers it.

**Architecture:** Extend the pure `parseSeriesUpdate` validator to accept `title`, extend the `updateSeries` service to write `title` + `titleIsManual = true`, and add a small dedicated `EditableTitle` client component that inline-edits the detail-page `<h1>` and PATCHes `/api/series/[id]`. The API route (`PATCH`) and the `titleIsManual` schema flag already exist — no route or migration changes.

**Tech Stack:** Next.js App Router (React client component), TypeScript strict, Prisma/Postgres, Vitest (unit + integration).

## Global Constraints

- **Keep `lib/` pure and Next-free.** (Not touched here — validation lives in `server/api`, which is allowed to import server types but no `next`/`prisma`/`fs`/network in the pure validators themselves.)
- **TDD for logic.** Validation (unit) and the service change (integration) are test-first: red → green. The React component has no test harness yet (Playwright is later, WP-11+) and is verified by driving the running app.
- **Verify before claiming done.** No "passing"/"done" claim without fresh `npm test` + `npm run typecheck` output in the same message.
- **Title validation:** trim; reject empty-after-trim; cap length at **500** chars.
- **Commit gating:** the owner has asked us not to commit yet. Commit steps below are the intended units of work, but at execution time **pause and get the owner's go-ahead before running any `git commit`.**
- **Anonymity:** no real site/series names in committed content (tests use `*.example` hosts, matching the existing suite).

---

### Task 1: Validate `title` in `parseSeriesUpdate`

**Files:**
- Modify: `src/server/api/validation.ts` (the `SeriesUpdate` interface ~L44-49 and `parseSeriesUpdate` ~L51-78)
- Test: `tests/unit/server/validation.test.ts` (extend the existing `describe('parseSeriesUpdate', …)` ~L35)

**Interfaces:**
- Consumes: existing `ParseResult<T>`, `ok`/`err`, `isObject` helpers in the same file.
- Produces: `SeriesUpdate` gains `title?: string`; `parseSeriesUpdate` accepts a trimmed `title`, rejecting empty/whitespace-only/non-string/over-500-chars. Task 2's service reads `patch.title`.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('parseSeriesUpdate', …)` in `tests/unit/server/validation.test.ts`:

```ts
test('accepts a title and stores it trimmed', () => {
  expect(parseSeriesUpdate({ title: '  The Real Name  ' })).toEqual({
    ok: true,
    value: { title: 'The Real Name' },
  });
});

test('rejects an empty or whitespace-only title', () => {
  expect(parseSeriesUpdate({ title: '' }).ok).toBe(false);
  expect(parseSeriesUpdate({ title: '   ' }).ok).toBe(false);
});

test('rejects a non-string title', () => {
  expect(parseSeriesUpdate({ title: 123 }).ok).toBe(false);
});

test('rejects an over-length title', () => {
  expect(parseSeriesUpdate({ title: 'x'.repeat(501) }).ok).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- validation`
Expected: the four new tests FAIL (title currently ignored → `{ title: '…' }` yields `err('No fields to update.')`, so `.ok` is `false` for the accept case and the `.toEqual` mismatches).

- [ ] **Step 3: Implement the validation**

In `src/server/api/validation.ts`, add `title` to the interface:

```ts
export interface SeriesUpdate {
  status?: SeriesStatus;
  rating?: number;
  notes?: string;
  title?: string;
  lastReadChapterId?: string | null;
}
```

And add this block inside `parseSeriesUpdate`, before the final `Object.keys(value).length === 0` guard:

```ts
  if (input.title !== undefined) {
    if (typeof input.title !== 'string') return err('"title" must be a string.');
    const title = input.title.trim();
    if (title.length === 0) return err('"title" cannot be empty.');
    if (title.length > 500) return err('"title" is too long.');
    value.title = title;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- validation`
Expected: PASS (all `parseSeriesUpdate` tests, including the four new ones).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit** *(pause for owner go-ahead first — see Global Constraints)*

```bash
git add src/server/api/validation.ts tests/unit/server/validation.test.ts
git commit -m "WP-30: parseSeriesUpdate accepts a trimmed title"
```

---

### Task 2: `updateSeries` writes `title` + pins `titleIsManual`

**Files:**
- Modify: `src/server/services/series.ts` (`updateSeries`, the `seriesData` assembly ~L79-86)
- Test: `tests/integration/services.test.ts` (extend `describe('updateSeries (real DB)', …)` ~L496)

**Interfaces:**
- Consumes: `SeriesUpdate.title` from Task 1; existing `addSeries`, `backfillFromToc`, `fetchFrom`, `okRes` test helpers already imported in `services.test.ts`.
- Produces: a PATCH carrying `title` sets `Series.title` and `Series.titleIsManual = true` via the existing `db.series.update` op (no new op).

- [ ] **Step 1: Write the failing test**

Add inside `describe('updateSeries (real DB)', …)` in `tests/integration/services.test.ts`:

```ts
test('WP-30: setting title pins titleIsManual, and backfill then leaves it alone', async () => {
  const LANDING = 'https://ut.example/series/omega/';
  const { seriesId } = await addSeries(
    { url: LANDING },
    fetchFrom({ [LANDING]: okRes(`<h1>Auto Name</h1><a href="/series/omega/chapter-1">Chapter 1</a>`) }),
  );

  const result = await updateSeries(seriesId, { title: 'My Hand-Fixed Name' });
  expect(result).not.toBeNull();

  const afterEdit = await db.series.findFirstOrThrow({ where: { id: seriesId } });
  expect(afterEdit.title).toBe('My Hand-Fixed Name');
  expect(afterEdit.titleIsManual).toBe(true);

  // Auto-backfill must not clobber the hand-fix.
  const backfill = await backfillFromToc(
    seriesId,
    fetchFrom({ [LANDING]: okRes(`<h1>Auto Name</h1><a href="/series/omega/chapter-1">Chapter 1</a><a href="/series/omega/chapter-2">Chapter 2</a>`) }),
  );
  const afterBackfill = await db.series.findFirstOrThrow({ where: { id: seriesId } });
  expect(afterBackfill.title).toBe('My Hand-Fixed Name');
  expect(backfill.titleUpdated).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project integration -t "setting title pins titleIsManual"`
Expected: FAIL — `afterEdit.title` is still `'Auto Name'` and `titleIsManual` is `false`, because `updateSeries` ignores `patch.title` today.

- [ ] **Step 3: Implement the service change**

In `src/server/services/series.ts`, inside `updateSeries`, add to the `seriesData` assembly (after the `notes` line, before the `Object.keys(seriesData).length > 0` push):

```ts
  if (patch.title !== undefined) {
    seriesData.title = patch.title;
    seriesData.titleIsManual = true;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --project integration -t "setting title pins titleIsManual"`
Expected: PASS.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test` then `npm run typecheck`
Expected: green; clean.

- [ ] **Step 6: Commit** *(pause for owner go-ahead first)*

```bash
git add src/server/services/series.ts tests/integration/services.test.ts
git commit -m "WP-30: updateSeries writes title and pins titleIsManual"
```

---

### Task 3: `EditableTitle` client component + detail-page wiring

**Files:**
- Create: `src/app/(app)/series/[id]/EditableTitle.tsx`
- Modify: `src/app/(app)/series/[id]/page.tsx` (replace the static `<h1>` ~L31)
- Modify: `src/app/globals.css` (add title-edit affordance styles near the existing `.detail__title` / `.control` rules)

**Interfaces:**
- Consumes: `PATCH /api/series/[id]` accepting `{ title }` (Tasks 1–2); Next `useRouter().refresh()`.
- Produces: `<EditableTitle id={string} initialTitle={string} />` — a client component rendering the detail `<h1>` with an inline edit mode.

- [ ] **Step 1: Create the component**

Create `src/app/(app)/series/[id]/EditableTitle.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function EditableTitle(props: { id: string; initialTitle: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== props.initialTitle && !busy;

  function startEdit() {
    setValue(props.initialTitle);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/series/${props.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditing(false);
      router.refresh();
    } catch {
      setError('Could not save the title.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <h1 className="detail__title">
        {props.initialTitle}
        <button type="button" className="detail__title-edit" aria-label="Edit title" onClick={startEdit}>
          ✎
        </button>
      </h1>
    );
  }

  return (
    <div className="detail__title-edit-row">
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input
        className="detail__title-input"
        aria-label="Series title"
        value={value}
        autoFocus
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') cancel();
        }}
      />
      <button type="button" className="control__action" disabled={!canSave} onClick={() => void save()}>
        Save
      </button>
      <button type="button" className="control__action" disabled={busy} onClick={cancel}>
        Cancel
      </button>
      {error && <span className="control__hint" role="status">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the detail page**

In `src/app/(app)/series/[id]/page.tsx`, add the import near the top:

```tsx
import { EditableTitle } from './EditableTitle';
```

Replace the static title line:

```tsx
<h1 className="detail__title">{series.title}</h1>
```

with:

```tsx
<EditableTitle id={series.id} initialTitle={series.title} />
```

- [ ] **Step 3: Add styles**

In `src/app/globals.css`, near the existing `.detail__title` rule, add:

```css
.detail__title-edit {
  margin-left: 0.5rem;
  padding: 0 0.35rem;
  font-size: 0.7em;
  line-height: 1;
  color: var(--muted, #8a8f98);
  background: none;
  border: none;
  cursor: pointer;
  vertical-align: middle;
}
.detail__title-edit:hover { color: inherit; }

.detail__title-edit-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
}
.detail__title-input {
  flex: 1 1 16rem;
  min-width: 0;
  font-size: 1.25rem;
  padding: 0.3rem 0.5rem;
}
```

> Note: reuse whatever `--muted`/spacing tokens already exist in `globals.css`; if `--muted` isn't defined, drop the `var(...)` fallback to the literal or an existing token. Match the surrounding `.control__action` button styling — do not invent a new button look.

- [ ] **Step 4: Typecheck + build-lint**

Run: `npm run typecheck`
Expected: clean.
(If the project has a lint step, run it; the `no-autofocus` disable comment is there for that.)

- [ ] **Step 5: Verify by driving the running app**

Start the dev server, open a series detail page, and confirm:
1. The title shows a small ✎ edit button; clicking it swaps to an input with Save/Cancel.
2. Save is disabled when the field is empty or unchanged; typing a new title enables it.
3. Enter saves; the h1 updates after refresh. Esc cancels with no change.
4. Reload the page — the new title persists.
5. (Optional) Trigger "Backfill from TOC" afterward and confirm the manual title is not overwritten.

Use the `verify` skill / `run` skill to launch the app if unsure how.

- [ ] **Step 6: Commit** *(pause for owner go-ahead first)*

```bash
git add "src/app/(app)/series/[id]/EditableTitle.tsx" "src/app/(app)/series/[id]/page.tsx" src/app/globals.css
git commit -m "WP-30: inline manual title-edit on the series detail page"
```

---

### Task 4: Plan bookkeeping — close WP-30 UI, split off WP-30b

**Files:**
- Modify: `PLAN.md` (active-queue table ~L111; WP-30 detail; Changelog)
- Add (uncommitted until now): the spec + this plan under `docs/superpowers/`

**Interfaces:** none (docs only).

- [ ] **Step 1: Flip WP-30's active-queue row**

In the active-queue table, update the WP-30 row: the manual title-edit UI is done. Narrow WP-30's remaining scope to nothing (its title-backfill + UI are complete) — move WP-30 to the ✅ Completed list.

- [ ] **Step 2: Add a WP-30b active-queue row**

Add a new active-queue row so the consent/cookie-banner `<h1>` reject-list (the "third cause", currently only in WP-30 detail at ~L466-472) survives as a standalone queued item:

```
| WP-30b | Consent/cookie-banner `<h1>` reject-list in `extractSeriesTitle` — the sole `<h1>` on some sites is a CCPA/cookie banner, so it's grabbed as the title; treat a boilerplate/consent `<h1>` as not-a-title (small known-phrase reject-list and/or skip an `<h1>` inside a consent/cookie container) and fall through to `og:title` → `<title>`. Backend/pure `lib/feeds/title.ts` fix; TDD | `TODO` | WP-30 |
```

Leave the WP-30 detail's "Third cause" text in place but add a pointer that it's now tracked as WP-30b. Leave the WP-28 entity-decode note untouched (it stays under WP-28).

- [ ] **Step 3: Update the Current focus + Changelog**

- Set a new `NEXT` (the next active-queue row after WP-30 — WP-51, unless the owner re-prioritizes at the WP boundary check-in).
- Add a Changelog line: `WP-30 manual title-edit UI (inline detail-page h1 edit → PATCH title → titleIsManual pinned); filed WP-30b (consent-banner h1 reject-list) as a follow-up.`
- Move WP-30 into the ✅ Completed summary line.

- [ ] **Step 4: Commit** *(pause for owner go-ahead first)*

```bash
git add PLAN.md docs/superpowers/specs/2026-08-13-wp30-manual-title-edit-ui-design.md docs/superpowers/plans/2026-08-13-wp30-manual-title-edit-ui.md
git commit -m "docs: WP-30 manual title-edit UI done; split consent-h1 to WP-30b"
```

- [ ] **Step 5: WP-boundary check-in**

Per CLAUDE.md working agreement #4, stop here and check in with the owner before picking up the next WP.

---

## Self-Review

**Spec coverage:**
- Validation (`title`, trim, empty/non-string/over-length) → Task 1. ✓
- Service writes `title` + `titleIsManual = true`, backfill-protection asserted → Task 2. ✓
- `EditableTitle` component (inline h1, Enter/Esc/Save/Cancel, disabled-when-empty/unchanged, PATCH + refresh, inline error) + page wiring + styles → Task 3. ✓
- Out-of-scope items (consent-h1, entity-decode) preserved → Task 4 splits consent-h1 to WP-30b; entity-decode left under WP-28. ✓
- DoD (tests green, typecheck clean, plan updated, changelog) → Tasks 1–4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step has real code. The globals.css token note is guidance to match existing tokens, not a placeholder. ✓

**Type consistency:** `SeriesUpdate.title?: string` (Task 1) is exactly what Task 2 reads via `patch.title`; `EditableTitle` props `{ id, initialTitle }` match the Task 3 wiring; PATCH body `{ title }` matches the validator. `backfillFromToc` returns `{ added, reconciled, titleUpdated? }` — the test reads `.titleUpdated`. ✓
