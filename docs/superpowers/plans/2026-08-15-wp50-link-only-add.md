# WP-50 (reframed) — Link-only add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an add can't read a chapter list (CF-blocked site or non-TOC page), stop throwing/silently-creating — return a `needsConfirm` decision, and on confirmation create a **link-only** series (a shelf card + link, no polling).

**Architecture:** `addSeries` resolution returns a discriminated union (`created` | `needsConfirm{reason}`). A new `allowLinkOnly` input short-circuits resolution to create a `PAGE_WATCH` source marked `Source.linkOnly` (excluded from polling). The add page shows a reason-specific confirm with an editable title; detail + shelf show a "link-only" badge.

**Tech Stack:** Next.js App Router, TypeScript strict, Prisma/Postgres, Vitest (unit + integration), Playwright (E2E).

## Global Constraints

- **Keep `lib/` pure.** All changes live in `server/` + `app/` + schema + tests; no new `next`/`prisma` imports in `lib/`.
- **TDD for logic.** The resolution decision (Task 2, `addSeries` core) and validation (Task 3) are test-first (red → green) in the existing `tests/unit/server/*` suites. Persistence/poll-exclusion (Task 1) is integration-tested.
- **Preserve the legit FEED-empty (WP-43).** `needsConfirm` fires only when there is **no feed**. A valid feed match with 0 in-window chapters still resolves to a normal `created` FEED source.
- **Link-only sources are never polled.** `loadActiveSources` excludes `linkOnly: true` — a known-blocked site must never eat poll budget or hammer Cloudflare.
- **`allowLinkOnly` short-circuits — no re-fetch/re-render.** The confirmed add creates the entry directly from URL + title.
- **Verify before done.** `npm test` + `npm run test:integration` + `npm run test:e2e` + `npm run typecheck` green.
- **Commit gating:** per-task **local** commits on the `wp-50-link-only-add` branch; nothing pushed until finish.
- **Anonymity:** tests/docs use `*.example` hosts + generic names.
- **E2E env:** the link-only E2E spec runs under the existing WP-PW harness (`webnovel_e2e`, gate-off `next dev`).

---

### Task 1: `Source.linkOnly` — schema, persistence, poll exclusion

**Files:**
- Modify: `prisma/schema.prisma` (add `linkOnly` to `Source`); new migration
- Modify: `src/server/services/addSeries.ts` (add `linkOnly: boolean` to `ResolvedSource`)
- Modify: `src/server/services/index.ts` (`createSeries` persists `linkOnly`; `loadActiveSources` excludes it)
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Produces: `ResolvedSource.linkOnly: boolean`; a persisted `Source.linkOnly`; poll queries that skip link-only sources. Task 2 sets `linkOnly` on the resolved core.

- [ ] **Step 1: Add the schema field + migration**

In `prisma/schema.prisma`, add to `model Source` (near `isActive`):

```prisma
  linkOnly Boolean @default(false) // WP-50: a link-only entry (blocked/non-TOC add) — never polled
```

Generate the migration SQL (a local Postgres is available; `.env` → `webnovel_dev`):

```bash
npx prisma migrate dev --name add_source_link_only
```

- [ ] **Step 2: Thread `linkOnly` through the resolved type**

In `src/server/services/addSeries.ts`, add to `interface ResolvedSource` (after `type`):

```ts
  linkOnly: boolean; // WP-50: link-only entry — created via allowLinkOnly, excluded from polling
```

Then set `linkOnly: false` on **every existing `ResolvedCore` literal** in that file (the FEED branch core and the PAGE_WATCH branch core) so the type is satisfied. (Task 2 adds the `linkOnly: true` core.)

- [ ] **Step 3: Persist it in `createSeries`**

In `src/server/services/index.ts`, in the `createSeries` port's `sources.create`, add:

```ts
              linkOnly: r.linkOnly,
```

- [ ] **Step 4: Exclude link-only sources from polling**

In `src/server/services/index.ts`, `loadActiveSources` query (~L134), add `linkOnly: false` to the `where`:

```ts
          where: { ...sourceTierWhere(tier), linkOnly: false, series: { status: { in: POLLABLE_STATUSES } } },
```

- [ ] **Step 5: Write the integration test**

In `tests/integration/services.test.ts`, add a test (near the poll/add tests) — a link-only source persists and is skipped by polling:

```ts
test('WP-50: a linkOnly source persists and is excluded from polling', async () => {
  const series = await db.series.create({
    data: {
      userId: getCurrentUserId(),
      title: 'Blocked Series',
      sources: { create: { url: 'https://cf.example/series/x/', host: 'cf.example', type: 'PAGE_WATCH', linkOnly: true } },
    },
    include: { sources: true },
  });
  expect(series.sources[0]!.linkOnly).toBe(true);

  // A poll cycle must not fetch a link-only source.
  const fetched: string[] = [];
  const fetch = (async (u: string) => { fetched.push(u); return okRes(''); }) as FetchImpl;
  await pollAllSources(fetch);
  expect(fetched).not.toContain('https://cf.example/series/x/');
});
```

> Confirm the exact `pollAllSources` signature/import used elsewhere in the file; match it. If a helper already seeds+polls, reuse it.

- [ ] **Step 6: Run + typecheck**

Run: `npm run test:integration -t "linkOnly"` → pass. Then `npm run typecheck` → clean (the `ResolvedSource.linkOnly` additions compile). `npm test` → unit green.

- [ ] **Step 7: Commit** *(local only)*

```bash
git add prisma/schema.prisma prisma/migrations src/server/services/addSeries.ts src/server/services/index.ts tests/integration/services.test.ts
git commit -m "WP-50: Source.linkOnly — schema, persist, poll exclusion"
```

---

### Task 2: Resolution decision — `needsConfirm` union + `allowLinkOnly` short-circuit

**Files:**
- Modify: `src/server/services/addSeries.ts` (result union; `addSeries` flow)
- Modify: `src/server/services/index.ts` (wrapper return type)
- Test: `tests/unit/server/addSeries.test.ts`

**Interfaces:**
- Consumes: `ResolvedSource.linkOnly` (Task 1).
- Produces: `AddSeriesResult = AddSeriesCreated | AddSeriesNeedsConfirm`. Task 3's route branches on `kind`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/server/addSeries.test.ts`, add (the `ports(...)` helper + `ok`/`PAGE`/`RSS` already exist):

```ts
test('WP-50: a page with no feed and no chapters → needsConfirm no-chapters', async () => {
  const url = 'https://plain.example/browse/index/';
  const p = ports({ [url]: ok('<html><head><title>Some Index</title></head><body>no chapters here</body></html>') });
  const result = await addSeries({ url }, p);
  expect(result.kind).toBe('needsConfirm');
  if (result.kind !== 'needsConfirm') throw new Error('expected needsConfirm');
  expect(result.reason).toBe('no-chapters');
  expect(result.suggestedTitle.length).toBeGreaterThan(0);
  expect(p.created).toHaveLength(0); // nothing created
});

test('WP-50: an unreachable page and no feed → needsConfirm blocked', async () => {
  const url = 'https://cf.example/series/blocked/';
  const p = ports({}); // every fetch 404s; no render port
  const result = await addSeries({ url }, p);
  expect(result.kind).toBe('needsConfirm');
  if (result.kind !== 'needsConfirm') throw new Error('expected needsConfirm');
  expect(result.reason).toBe('blocked');
});

test('WP-50: allowLinkOnly short-circuits → creates a link-only PAGE_WATCH without fetching', async () => {
  const url = 'https://cf.example/series/blocked/';
  const p = ports({});
  const result = await addSeries({ url, allowLinkOnly: true, title: 'My Blocked Novel' }, p);
  expect(result.kind).toBe('created');
  expect(p.fetchCalls).toHaveLength(0); // no re-fetch
  expect(p.created).toHaveLength(1);
  expect(p.created[0]!.linkOnly).toBe(true);
  expect(p.created[0]!.type).toBe('PAGE_WATCH');
  expect(p.created[0]!.seriesTitle).toBe('My Blocked Novel');
});
```

- [ ] **Step 2: Run → verify they fail**

Run: `npm test -- addSeries` → the three new tests FAIL (today: no-chapters silently creates; blocked throws; no `allowLinkOnly`). Also the existing tests still reference `result.resolved`/`result.seriesId` directly — they'll break under the new union in Step 3; that's expected and fixed in Step 4.

- [ ] **Step 3: Implement the union + flow**

In `src/server/services/addSeries.ts`:

(a) Replace the `AddSeriesResult` interface with the union, and add `allowLinkOnly` to the input:

```ts
export interface AddSeriesInput {
  url: string;
  title?: string;
  allowLinkOnly?: boolean; // WP-50: confirmed → create a link-only entry
}

export interface AddSeriesCreated {
  kind: 'created';
  seriesId: string;
  resolved: ResolvedSource;
  alreadyExisting: boolean;
  similarTo?: { id: string; title: string } | null;
}
export interface AddSeriesNeedsConfirm {
  kind: 'needsConfirm';
  reason: 'blocked' | 'no-chapters';
  suggestedTitle: string;
  url: string;
}
export type AddSeriesResult = AddSeriesCreated | AddSeriesNeedsConfirm;
```

(b) In `finalize`, tag the created results — change both `return { seriesId..., ... }` to include `kind: 'created'`:

```ts
  if (existing) return { kind: 'created', seriesId: existing.seriesId, resolved, alreadyExisting: true };
  const similarTo = findSimilarTitle(resolved.seriesTitle, await ports.listExistingSeries());
  const { seriesId } = await ports.createSeries(resolved);
  return { kind: 'created', seriesId, resolved, alreadyExisting: false, similarTo };
```

(c) At the **top of `addSeries`** (after `const host = …`), add the short-circuit:

```ts
  // WP-50: confirmed link-only add — create directly, no re-fetch/re-render.
  if (input.allowLinkOnly) {
    const core: ResolvedCore = {
      seriesTitle: input.title ?? titleFromUrl(url),
      sourceUrl: url, host, feedUrl: null, tocUrl: null,
      type: 'PAGE_WATCH', fetchMode: 'PLAIN', match: { type: 'WHOLE_FEED' },
      chapters: [], linkOnly: true,
    };
    return finalize(core, ports);
  }
```

(d) In `resolveFrom`, the PAGE_WATCH branch: after `toc` is finalized (post inner render-escalation) and **before** building the core, return `needsConfirm` when there's genuinely nothing to track — **no landing chapters AND no discoverable TOC page**:

```ts
      if (toc.length === 0 && tocUrl === null) {
        return { kind: 'needsConfirm', reason: 'no-chapters', suggestedTitle: pageTitle ?? titleFromUrl(url), url };
      }
```

> **Refinement (surfaced during Task 2):** the condition also requires `tocUrl === null`. A landing page with a discoverable `tocUrl` (a real TOC page elsewhere) but 0 chapters on the landing itself is a **legit page-watch series** that fills in from the TOC on the first `backfillFromToc` — it must create a normal `PAGE_WATCH` (0 chapters now, `linkOnly: false`), not a needsConfirm. Only a page with no landing chapters *and* no TOC link is genuinely untrackable.

(Set `linkOnly: false` on that PAGE_WATCH core — done in Task 1 Step 2.)

(e) Replace the **final `throw new Error(...)`** at the end of `addSeries` with:

```ts
  // Hard-fail: neither page nor feed reachable (even via render) → blocked. Let the user confirm a link-only add.
  return { kind: 'needsConfirm', reason: 'blocked', suggestedTitle: titleFromUrl(url), url };
```

Update the wrapper in `src/server/services/index.ts` if it annotates the return type (`Promise<AddSeriesResult>` still holds).

- [ ] **Step 4: Fix existing tests broken by the union**

Existing `addSeries.test.ts` cases access `result.resolved` / `result.seriesId`. Narrow each with a guard right after the `addSeries(...)` call:

```ts
  const result = await addSeries({ url }, p);
  if (result.kind !== 'created') throw new Error('expected created');
  // …existing assertions on result.resolved / result.seriesId now typecheck…
```

Apply to every existing test that reads `.resolved`/`.seriesId`/`.alreadyExisting`.

- [ ] **Step 5: Run → green + typecheck**

Run: `npm test -- addSeries` → all pass (new + fixed existing). `npm run typecheck` → clean. `npm run test:integration` → the integration `addSeries` callers (services.test.ts) also read `.seriesId`/`.resolved`; narrow those the same way if typecheck flags them, and re-run integration green.

- [ ] **Step 6: Commit** *(local only)*

```bash
git add src/server/services/addSeries.ts src/server/services/index.ts tests/unit/server/addSeries.test.ts tests/integration/services.test.ts
git commit -m "WP-50: addSeries returns needsConfirm (blocked/no-chapters) + allowLinkOnly short-circuit"
```

---

### Task 3: Validation + route — accept `allowLinkOnly`, map `needsConfirm`

**Files:**
- Modify: `src/server/api/validation.ts` (`parseAddSeriesBody` accepts `allowLinkOnly`)
- Modify: `src/app/api/series/route.ts` (branch on `kind`)
- Test: `tests/unit/server/validation.test.ts`

**Interfaces:**
- Consumes: the `AddSeriesResult` union (Task 2).
- Produces: `POST /api/series` returns `200 { needsConfirm, reason, suggestedTitle, url }` for a needsConfirm, else the existing created responses. Task 4's UI consumes it.

- [ ] **Step 1: Failing validation test**

In `tests/unit/server/validation.test.ts`, inside the `parseAddSeriesBody` describe:

```ts
test('accepts allowLinkOnly + title', () => {
  expect(parseAddSeriesBody({ url: 'https://x.example/a', allowLinkOnly: true, title: 'A' })).toEqual({
    ok: true,
    value: { url: 'https://x.example/a', allowLinkOnly: true, title: 'A' },
  });
});
test('rejects a non-boolean allowLinkOnly', () => {
  expect(parseAddSeriesBody({ url: 'https://x.example/a', allowLinkOnly: 'yes' }).ok).toBe(false);
});
```

- [ ] **Step 2: Run → fail**

Run: `npm test -- validation` → the two new tests FAIL (`allowLinkOnly` dropped/ignored today).

- [ ] **Step 3: Implement validation**

In `src/server/api/validation.ts`, add `allowLinkOnly?: boolean` to `AddSeriesBody`, and in `parseAddSeriesBody` (before the final `return ok(value)`):

```ts
  if (input.allowLinkOnly !== undefined) {
    if (typeof input.allowLinkOnly !== 'boolean') return err('"allowLinkOnly" must be a boolean.');
    value.allowLinkOnly = input.allowLinkOnly;
  }
```

- [ ] **Step 4: Branch the route on `kind`**

In `src/app/api/series/route.ts` `POST`, replace the `const { seriesId, resolved, alreadyExisting, similarTo } = await addSeries(parsed.value);` block with:

```ts
    const result = await addSeries(parsed.value);
    if (result.kind === 'needsConfirm') {
      return NextResponse.json(
        { needsConfirm: true, reason: result.reason, suggestedTitle: result.suggestedTitle, url: result.url },
        { status: 200 },
      );
    }
    const { seriesId, resolved, alreadyExisting, similarTo } = result;
    // …existing alreadyExisting / created responses unchanged…
```

(The `try/catch → 502` stays for unexpected errors; the "couldn't reach" throw is gone from `addSeries`.)

- [ ] **Step 5: Run → green + typecheck**

Run: `npm test -- validation` → pass. `npm run typecheck` → clean. `npm run test:integration` → green.

- [ ] **Step 6: Commit** *(local only)*

```bash
git add src/server/api/validation.ts src/app/api/series/route.ts tests/unit/server/validation.test.ts
git commit -m "WP-50: parseAddSeriesBody accepts allowLinkOnly; route maps needsConfirm → 200"
```

---

### Task 4: Add-page confirm UI (reason-specific)

**Files:**
- Modify: `src/app/(app)/add/page.tsx`
- Modify: `src/app/globals.css` (confirm panel styles, if needed beyond existing `.notice`)

**Interfaces:** Consumes the `needsConfirm` 200 response (Task 3).

- [ ] **Step 1: Handle `needsConfirm` + render the confirm panel**

In `src/app/(app)/add/page.tsx`, add state and handling. After the existing `if (res.ok)` parse, before the `similarTo` check:

```tsx
        if ((data as { needsConfirm?: boolean }).needsConfirm) {
          const d = data as { reason: 'blocked' | 'no-chapters'; suggestedTitle: string; url: string };
          setConfirm({ reason: d.reason, suggestedTitle: d.suggestedTitle, url: d.url });
          setConfirmTitle(d.suggestedTitle);
          setBusy(false);
          return;
        }
```

Add state near the top:

```tsx
  const [confirm, setConfirm] = useState<{ reason: 'blocked' | 'no-chapters'; suggestedTitle: string; url: string } | null>(null);
  const [confirmTitle, setConfirmTitle] = useState('');
```

Add the confirmed-add handler:

```tsx
  async function addLinkOnly() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: confirm.url, allowLinkOnly: true, title: confirmTitle.trim() || confirm.suggestedTitle }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push('/');
      router.refresh();
    } catch {
      setError('Could not add the link-only entry.');
      setBusy(false);
    }
  }
```

Render the panel (place above the `<form>`, and hide the form while confirming). Reason-specific message:

```tsx
      {confirm && (
        <div className="notice" role="status">
          <p>
            {confirm.reason === 'blocked'
              ? `${new URL(confirm.url).host} appears to be blocking automated requests (often Cloudflare), so we can’t read its chapter list. Add it as a link-only entry — a shelf card and a quick link, but no automatic new-chapter tracking.`
              : 'We couldn’t find a chapter list on that page — it may not be the series’ contents/TOC page. Add it as a link-only entry anyway, or cancel and paste the table-of-contents page.'}
          </p>
          <label className="control">
            <span className="control__label">Title</span>
            <input className="login__input" value={confirmTitle} onChange={(e) => setConfirmTitle(e.target.value)} />
          </label>
          <div className="notice__actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void addLinkOnly()}>
              Add anyway
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
```

Wrap the existing `<form>` so it's hidden while `confirm` is set: `{!confirm && (<form …>…</form>)}`.

- [ ] **Step 2: Typecheck + drive it**

Run: `npm run typecheck` → clean. Then verify in the app (or defer to the Task 6 E2E): paste a non-TOC URL → panel appears with the right message → Add anyway → link-only series on the shelf.

- [ ] **Step 3: Commit** *(local only)*

```bash
git add "src/app/(app)/add/page.tsx" src/app/globals.css
git commit -m "WP-50: add-page reason-specific confirm → link-only add"
```

---

### Task 5: Link-only badge on detail + shelf

**Files:**
- Modify: `src/server/services/series.ts` (`listSeries` + `getSeries` expose `linkOnly` of the active source)
- Modify: `src/app/(app)/page.tsx` (shelf card badge)
- Modify: `src/app/(app)/series/[id]/page.tsx` (detail badge)
- Modify: `src/app/globals.css` (badge style)

**Interfaces:** Consumes `Source.linkOnly` (Task 1).

- [ ] **Step 1: Expose `linkOnly` from the services**

In `src/server/services/series.ts`:
- `listSeries`: add `linkOnly: true` to the `sources` `select` (the `{ url, host, health }` select) so `activeSource.linkOnly` is available.
- `getSeries` already `include: { sources: true }`, so `linkOnly` is present on each source — no change needed there.

- [ ] **Step 2: Shelf card badge**

In `src/app/(app)/page.tsx` `SeriesCard`, in `.card__meta`, when the active source is link-only, show a badge:

```tsx
            {series.activeSource?.linkOnly && <span className="status-chip">link-only</span>}
```

(Placed alongside the existing `status-chip` / health-dot in `.card__meta`.)

- [ ] **Step 3: Detail badge**

In `src/app/(app)/series/[id]/page.tsx`, in `.detail__meta`, when the active source is link-only:

```tsx
        {active?.linkOnly && <span className="status-chip">link-only</span>}
```

- [ ] **Step 4: Style (if `.status-chip` doesn't already suffice)**

Reuse the existing `.status-chip` class (already styled). No new CSS unless a distinct look is wanted; if so, add a `.status-chip--link` modifier in `globals.css`.

- [ ] **Step 5: Typecheck + suites**

Run: `npm run typecheck` → clean. `npm test` + `npm run test:integration` → green.

- [ ] **Step 6: Commit** *(local only)*

```bash
git add src/server/services/series.ts "src/app/(app)/page.tsx" "src/app/(app)/series/[id]/page.tsx" src/app/globals.css
git commit -m "WP-50: link-only badge on shelf + detail"
```

---

### Task 6: E2E — link-only add flow

**Files:** Create `e2e/link-only-add.spec.ts`

**Interfaces:** Consumes the WP-PW harness (`test`/`expect` fixtures). Stubs the add API to drive the confirm flow deterministically (the real add would hit the network).

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from './support/fixtures';

test('a no-chapters add offers a link-only confirm, and Add anyway creates the entry', async ({ page }) => {
  await page.goto('/add');

  // First POST → needsConfirm (stub, so no real network).
  await page.route('**/api/series', async (route) => {
    const req = route.request();
    const body = req.postDataJSON() as { allowLinkOnly?: boolean; title?: string };
    if (body.allowLinkOnly) {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ seriesId: 's1', title: body.title, sourceType: 'PAGE_WATCH', chapters: 0, alreadyExisting: false }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ needsConfirm: true, reason: 'no-chapters', suggestedTitle: 'Some Page', url: 'https://plain.example/x/' }) });
    }
  });

  await page.getByRole('textbox').first().fill('https://plain.example/x/');
  await page.getByRole('button', { name: 'Add series' }).click();

  // Confirm panel appears with the no-chapters message + editable title.
  await expect(page.getByText(/couldn’t find a chapter list/i)).toBeVisible();
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Some Page');

  await page.getByRole('button', { name: 'Add anyway' }).click();
  await expect(page).toHaveURL('/'); // landed on the shelf after the confirmed add
});
```

> The add page's URL input has no accessible name beyond its role; `getByRole('textbox').first()` targets it (the Title input only appears after the confirm). Adjust selectors to the actual DOM while implementing. This spec stubs `/api/series` (the real add hits the network) — consistent with WP-34's stubbing rationale.

- [ ] **Step 2: Run**

Run: `DATABASE_URL="…/webnovel_e2e" npm run test:e2e -- link-only-add` → pass.

- [ ] **Step 3: Commit** *(local only)*

```bash
git add e2e/link-only-add.spec.ts
git commit -m "WP-50: e2e link-only add confirm flow (stubbed)"
```

---

### Task 7: Docs + PLAN bookkeeping

**Files:** Modify `PLAN.md`; commit spec + this plan.

- [ ] **Step 1: Reframe WP-50 in the active queue + mark done**

- Rewrite the WP-50 active-queue row to the reframed scope (confirm-and-allow link-only add), then move WP-50 to the ✅ Completed enumeration (`· WP-50 (link-only add when chapters can't be read)`).
- Set the new `NEXT` to the next active-queue row (WP-45, unless re-prioritized); rewrite the Current-focus `NEXT:` block; prepend a WP-50 entry to "Recently landed".

- [ ] **Step 2: File WP-NOTES + WP-RETRY**

Add two active-queue rows:

```
| WP-NOTES | Detail-page notes UI — a notes textarea on the series detail page → the existing `PATCH /api/series/[id]` (`notes` is already validated + persisted; only the UI is missing). Pairs with link-only entries (manual tracking) | `TODO` | WP-10 |
| WP-RETRY | *(low)* Retry / auto-upgrade a link-only source — a manual "retry fetching chapters" that re-runs resolution on a `linkOnly` source and upgrades it to a tracked FEED/PAGE_WATCH source when the site becomes reachable (renderer added, feed appears, URL fixed) | `TODO` | WP-50, WP-17b |
```

- [ ] **Step 3: Append the WP-PW E2E checklist + Changelog**

- In the `### WP-PW` detail checklist, add: `- [x] WP-50 — link-only add: no-chapters → confirm → link-only series on the shelf (stubbed).`
- Add a Changelog entry (`- **2026-08-1X** — **WP-50 done: link-only add.** …`) covering the reframe, `needsConfirm`/`allowLinkOnly`, `Source.linkOnly` + poll exclusion, the reason-specific confirm, the badge, and that WP-NOTES + WP-RETRY were filed.

- [ ] **Step 4: Commit** *(local only)*

```bash
git add PLAN.md docs/superpowers/specs/2026-08-15-wp50-link-only-add-design.md docs/superpowers/plans/2026-08-15-wp50-link-only-add.md
git commit -m "docs: WP-50 done (link-only add); file WP-NOTES + WP-RETRY"
```

- [ ] **Step 5: WP-boundary check-in**

Stop and check in (finish action) before the next WP.

---

## Self-Review

**Spec coverage:**
- `needsConfirm` union (blocked/no-chapters) + `allowLinkOnly` short-circuit → Task 2. ✓
- FEED-empty preserved (needsConfirm only when no feed) → Task 2 (PAGE_WATCH branch only). ✓
- `Source.linkOnly` + persist + poll exclusion → Task 1. ✓
- Validation + route mapping → Task 3. ✓
- Reason-specific confirm UI + editable title → Task 4. ✓
- Badge (detail + shelf) → Task 5. ✓
- E2E confirm flow → Task 6. ✓
- Reframe WP-50, file WP-NOTES + WP-RETRY, WP-PW checklist, changelog → Task 7. ✓

**Placeholder scan:** No TBD/TODO; full code for schema, flow, validation, route, UI, badge, E2E. Selector/`pollAllSources`-signature notes point at real code to confirm during implementation, not placeholders. ✓

**Type/consistency:** `AddSeriesResult` union defined in Task 2, consumed by the route (Task 3) via `result.kind`; existing `.resolved` readers narrowed (Task 2 Step 4 / Step 5). `ResolvedSource.linkOnly` (Task 1) set by every core and persisted (Task 1) + produced by the short-circuit (Task 2). `allowLinkOnly` flows input (Task 2) → validation (Task 3) → UI (Task 4). `linkOnly` surfaced by services (Task 5) for the badge. ✓