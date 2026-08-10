# WP-39b — tocUrl dedup + create-then-annotate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silently dedup a page-watch series re-added via a different URL that resolves to the same `tocUrl`, and — when an add's title closely matches an existing series — still add it but return a non-blocking `similarTo` hint the add UI surfaces as an "Open / Merge" notice.

**Architecture:** Extend the pure `canonicalSeriesId` (page-watch keyed on `tocUrl ?? sourceUrl`) and add a pure `findSimilarTitle` (normalized-equality + token-prefix containment, no fuzzy). `addSeries.finalize` runs `findSimilarTitle` against the user's existing series on the create branch only and threads `similarTo` through the result → route response → add page. No schema change.

**Tech Stack:** TypeScript (strict), Prisma + Postgres (Neon), Next.js App Router (client add page), Vitest (unit + integration). `lib/` stays Next-free and pure.

## Global Constraints

- `src/lib/**` stays pure — no `next`/`prisma`/`fs`/network imports. `canonicalSeriesId` and `findSimilarTitle` are pure.
- TDD for `lib/` logic — failing test first, watch it fail for the right reason, then implement (agreement #2).
- Verify before done — `npm test` + `npm run typecheck` with fresh output in the same message (agreement #3).
- Committed content stays anonymous — reserved `.example` domains, generic/invented works, no real site/series names (memory: no-real-site-names).
- **No schema change / no migration** — going-forward keying, a response field, and a pure title match only.
- Hard-dedup (`canonicalId` exact match) is unchanged and always takes precedence; the `similarTo` annotate runs only on the create branch and NEVER blocks or merges.
- Title matching is normalized-equality + token-prefix containment only — **no fuzzy / edit-distance** (it cannot catch cross-translation dups; that is a documented limit handled later by merge/WP-WORKID).
- Integration tests run against `webnovel_test` (a DATABASE_URL whose name contains "test"; see `tests/integration/setup.ts`).

---

### Task 1: `canonicalSeriesId` keys page-watch on `tocUrl ?? sourceUrl`

**Files:**
- Modify: `src/lib/dedup.ts` (`canonicalSeriesId` signature + page-watch base)
- Modify: `src/server/services/addSeries.ts` (`finalize` call site passes `tocUrl`)
- Test: `tests/unit/dedup.test.ts`

**Interfaces:**
- Produces: `canonicalSeriesId(input: { feedUrl: string | null; tocUrl?: string | null; sourceUrl: string; match: SeriesMatch }): string` — page-watch (feedUrl null) now keys on `canonical(tocUrl ?? sourceUrl)`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/dedup.test.ts` inside the `describe('canonicalSeriesId', …)` block:

```typescript
test('WP-39b: page-watch keys on tocUrl — home-add and TOC-add sharing a TOC collapse to one id', () => {
  const home = canonicalSeriesId({ feedUrl: null, tocUrl: 'https://s.example/toc/', sourceUrl: 'https://s.example/', match: { type: 'WHOLE_FEED' } });
  const tocAdd = canonicalSeriesId({ feedUrl: null, tocUrl: null, sourceUrl: 'https://s.example/toc/', match: { type: 'WHOLE_FEED' } });
  expect(home).toBe('s.example/toc');
  expect(home).toBe(tocAdd);
});

test('WP-39b: two page-watch series with different TOCs stay distinct', () => {
  const a = canonicalSeriesId({ feedUrl: null, tocUrl: 'https://s.example/a/toc/', sourceUrl: 'https://s.example/a/', match: { type: 'WHOLE_FEED' } });
  const b = canonicalSeriesId({ feedUrl: null, tocUrl: 'https://s.example/b/toc/', sourceUrl: 'https://s.example/b/', match: { type: 'WHOLE_FEED' } });
  expect(a).not.toBe(b);
});

test('WP-39b: page-watch with no tocUrl still keys on sourceUrl (unchanged)', () => {
  const id = canonicalSeriesId({ feedUrl: null, sourceUrl: 'https://s.example/x/', match: { type: 'WHOLE_FEED' } });
  expect(id).toBe('s.example/x');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- dedup`
Expected: FAIL — the first test's `home` keys on `s.example` (sourceUrl), not `s.example/toc`, so `home !== tocAdd` / wrong value.

- [ ] **Step 3: Implement the tocUrl keying**

In `src/lib/dedup.ts`, change the `canonicalSeriesId` signature and base line. Current:
```typescript
export function canonicalSeriesId(input: { feedUrl: string | null; sourceUrl: string; match: SeriesMatch }): string {
  const base = stripSchemeWww(canonicalUrl(input.feedUrl ?? input.sourceUrl));
  if (input.feedUrl === null) return base; // page-watch: the URL is the identity (match is always WHOLE_FEED)
```
Change to:
```typescript
export function canonicalSeriesId(input: { feedUrl: string | null; tocUrl?: string | null; sourceUrl: string; match: SeriesMatch }): string {
  // Feed series key on the feed; page-watch series key on the chapter TOC when known (WP-39b), so a
  // home-URL add (whose tocUrl resolved to the TOC) and a direct TOC-URL add collapse to one id.
  const base = stripSchemeWww(canonicalUrl(input.feedUrl ?? input.tocUrl ?? input.sourceUrl));
  if (input.feedUrl === null) return base; // page-watch: keyed on tocUrl ?? sourceUrl
```
Leave the rest of the function (the feed `#suffix` logic) unchanged.

- [ ] **Step 4: Pass `tocUrl` at the `finalize` call site**

In `src/server/services/addSeries.ts`, in `finalize`, update the `canonicalSeriesId` call to include `tocUrl`:
```typescript
  const canonicalId = canonicalSeriesId({ feedUrl: core.feedUrl, tocUrl: core.tocUrl, sourceUrl: core.sourceUrl, match: core.match });
```

- [ ] **Step 5: Run to verify they pass + full suite**

Run: `npm test -- dedup` then `npm test && npm run typecheck`
Expected: dedup tests PASS; full unit suite + typecheck green (existing `canonicalSeriesId` tests without `tocUrl` still pass — the new param is optional).

- [ ] **Step 6: Commit**

```bash
git add src/lib/dedup.ts src/server/services/addSeries.ts tests/unit/dedup.test.ts
git commit -m "WP-39b: page-watch dedup keys on tocUrl ?? sourceUrl"
```

---

### Task 2: Pure `findSimilarTitle`

**Files:**
- Modify: `src/lib/dedup.ts` (add `findSimilarTitle`)
- Test: `tests/unit/dedup.test.ts`

**Interfaces:**
- Produces: `findSimilarTitle(candidate: string, existing: { id: string; title: string }[]): { id: string; title: string } | null` — normalized-equality or token-prefix containment; returns the first match, else null.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/dedup.test.ts` (import `findSimilarTitle` alongside `canonicalSeriesId` at the top):

```typescript
describe('findSimilarTitle', () => {
  const existing = [
    { id: 's1', title: 'Silver Moon Saga' },
    { id: 's2', title: 'Golden Sun Chronicle' },
  ];

  test('matches an added leading article (normalized equality)', () => {
    expect(findSimilarTitle('The Silver Moon Saga', existing)).toEqual({ id: 's1', title: 'Silver Moon Saga' });
  });

  test('matches an added subtitle (token prefix)', () => {
    expect(findSimilarTitle('Silver Moon Saga: Volume 2', existing)).toEqual({ id: 's1', title: 'Silver Moon Saga' });
  });

  test('is punctuation/whitespace/case insensitive', () => {
    expect(findSimilarTitle('  silver-moon   saga ', existing)).toEqual({ id: 's1', title: 'Silver Moon Saga' });
  });

  test('returns null for a genuinely different title', () => {
    expect(findSimilarTitle('Crimson Lotus Chronicle', existing)).toBeNull();
  });

  test('returns null for a different TRANSLATION of the same work (documented limit — no fuzzy)', () => {
    // Same underlying work, different English rendering → no shared tokens → correctly not matched here.
    expect(findSimilarTitle('The Blooddark Saint', [{ id: 'x', title: 'Crimson Lotus Chronicle' }])).toBeNull();
  });

  test('returns null when the existing list is empty', () => {
    expect(findSimilarTitle('Silver Moon Saga', [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- dedup`
Expected: FAIL — `findSimilarTitle is not a function` / import error.

- [ ] **Step 3: Implement `findSimilarTitle`**

Add to `src/lib/dedup.ts`:

```typescript
/** Normalize a title to lowercase alphanumeric tokens, dropping a single leading article. */
function normalizeTitleTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0);
}

/** True when `short` is a leading token-prefix of `long` (equal arrays included). */
function isTokenPrefix(short: string[], long: string[]): boolean {
  if (short.length === 0 || short.length > long.length) return false;
  return short.every((t, i) => t === long[i]);
}

/**
 * Find an existing series whose title is a surface-variant of `candidate` (WP-39b): normalized equality
 * or one being a leading token-prefix of the other (an added article or subtitle). Pure. Returns the first
 * match, else null. Deliberately NOT fuzzy — this cannot catch a different *translation* of the same work
 * (different renderings share no tokens); that case is resolved by manual merge (WP-CLEANUP-UI).
 */
export function findSimilarTitle(
  candidate: string,
  existing: { id: string; title: string }[],
): { id: string; title: string } | null {
  const cand = normalizeTitleTokens(candidate);
  if (cand.length === 0) return null;
  for (const e of existing) {
    const et = normalizeTitleTokens(e.title);
    if (et.length === 0) continue;
    const [short, long] = cand.length <= et.length ? [cand, et] : [et, cand];
    if (isTokenPrefix(short, long)) return { id: e.id, title: e.title };
  }
  return null;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- dedup`
Expected: PASS (all `findSimilarTitle` cases + the Task 1 + existing `canonicalSeriesId` cases).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dedup.ts tests/unit/dedup.test.ts
git commit -m "WP-39b: pure findSimilarTitle (normalized equality + token-prefix, no fuzzy)"
```

---

### Task 3: Create-then-annotate flow (`addSeries` + port + route)

**Files:**
- Modify: `src/server/services/addSeries.ts` (`AddSeriesPorts`, `AddSeriesResult`, `finalize`)
- Modify: `src/server/services/index.ts` (real `addSeries` ports — add `listExistingSeries`)
- Modify: `src/app/api/series/route.ts` (include `similarTo` in the 201 response)
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `findSimilarTitle` (Task 2).
- Produces: `AddSeriesPorts.listExistingSeries: () => Promise<{ id: string; title: string }[]>`; `AddSeriesResult.similarTo?: { id: string; title: string } | null`; the POST /api/series 201 response gains an optional `similarTo`.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/services.test.ts` in the `addSeries` describe block (fixtures `okRes`, `fetchFrom` already exist):

```typescript
test('WP-39b: adding a title similar to an existing series returns a similarTo hint (still creates)', async () => {
  // Series 1 — page-watch, title from the <h1>.
  await addSeries(
    { url: 'https://one.example/series/alpha/' },
    fetchFrom({ 'https://one.example/series/alpha/': okRes(`<h1>Alpha Saga</h1><a href="/series/alpha/chapter-1">Chapter 1</a>`) }),
  );
  // Series 2 — DIFFERENT host (different canonicalId → creates), similar title ("The Alpha Saga").
  const r2 = await addSeries(
    { url: 'https://two.example/series/alpha/' },
    fetchFrom({ 'https://two.example/series/alpha/': okRes(`<h1>The Alpha Saga</h1><a href="/series/alpha/chapter-1">Chapter 1</a>`) }),
  );
  expect(r2.alreadyExisting).toBe(false); // it WAS created, not blocked
  expect(r2.similarTo?.title).toBe('Alpha Saga');
  // A genuinely different title gets no hint.
  const r3 = await addSeries(
    { url: 'https://three.example/series/beta/' },
    fetchFrom({ 'https://three.example/series/beta/': okRes(`<h1>Golden Sun</h1><a href="/series/beta/chapter-1">Chapter 1</a>`) }),
  );
  expect(r3.similarTo == null).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --project integration -t "WP-39b: adding a title similar"`
Expected: FAIL — `r2.similarTo` is undefined (no annotate logic / port yet).

- [ ] **Step 3: Add the port + result field + finalize logic**

In `src/server/services/addSeries.ts`:

Add the import (join the existing dedup import):
```typescript
import { canonicalSeriesId, findSimilarTitle } from '../../lib/dedup';
```

Add `listExistingSeries` to `AddSeriesPorts`:
```typescript
export interface AddSeriesPorts {
  fetch: (url: string, opts?: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>;
  createSeries: (resolved: ResolvedSource) => Promise<{ seriesId: string }>;
  findSeriesByCanonicalId: (canonicalId: string) => Promise<{ seriesId: string } | null>; // WP-39
  listExistingSeries: () => Promise<{ id: string; title: string }[]>; // WP-39b: for the similar-title annotate
}
```

Add `similarTo` to `AddSeriesResult`:
```typescript
export interface AddSeriesResult {
  seriesId: string;
  resolved: ResolvedSource;
  alreadyExisting: boolean; // WP-39
  similarTo?: { id: string; title: string } | null; // WP-39b (create branch only)
}
```

Update `finalize` — compute `similarTo` before create (so the new row isn't in the list), on the create branch only:
```typescript
async function finalize(core: ResolvedCore, ports: AddSeriesPorts): Promise<AddSeriesResult> {
  const canonicalId = canonicalSeriesId({ feedUrl: core.feedUrl, tocUrl: core.tocUrl, sourceUrl: core.sourceUrl, match: core.match });
  const resolved: ResolvedSource = { ...core, canonicalId };
  const existing = await ports.findSeriesByCanonicalId(canonicalId);
  if (existing) return { seriesId: existing.seriesId, resolved, alreadyExisting: true };
  const similarTo = findSimilarTitle(resolved.seriesTitle, await ports.listExistingSeries());
  const { seriesId } = await ports.createSeries(resolved);
  return { seriesId, resolved, alreadyExisting: false, similarTo };
}
```

- [ ] **Step 4: Implement the real `listExistingSeries` port**

In `src/server/services/index.ts`, in the `addSeries` ports object (alongside `findSeriesByCanonicalId` / `createSeries`), add:
```typescript
    listExistingSeries: async () =>
      db.series.findMany({ where: { userId: getCurrentUserId() }, select: { id: true, title: true } }),
```

- [ ] **Step 5: Surface `similarTo` in the route response**

In `src/app/api/series/route.ts`, in the POST handler's success (create) branch, destructure `similarTo` and include it when present. Change:
```typescript
    const { seriesId, resolved, alreadyExisting } = await addSeries(parsed.value);
```
to:
```typescript
    const { seriesId, resolved, alreadyExisting, similarTo } = await addSeries(parsed.value);
```
and the 201 return to:
```typescript
    return NextResponse.json(
      { seriesId, title: resolved.seriesTitle, sourceType: resolved.type, chapters: resolved.chapters.length, alreadyExisting: false, ...(similarTo ? { similarTo } : {}) },
      { status: 201 },
    );
```

- [ ] **Step 6: Run the test + full suite**

Run: `npm test -- --project integration -t "WP-39b: adding a title similar"` then `npm test && npm run typecheck`
Expected: the new test PASSES; existing tests green. Any other `AddSeriesPorts` literal in tests must now supply `listExistingSeries` — fix compile errors by adding `listExistingSeries: async () => []` to those port literals (the pure `addSeries` unit/integration harnesses).

- [ ] **Step 7: Commit**

```bash
git add src/server/services/addSeries.ts src/server/services/index.ts src/app/api/series/route.ts tests/integration/services.test.ts
git commit -m "WP-39b: create-then-annotate — addSeries returns a similarTo hint on the create branch"
```

---

### Task 4: Add-page "similar series" notice (client)

**Files:**
- Modify: `src/app/(app)/add/page.tsx`

**Interfaces:**
- Consumes: the POST /api/series 201 response's optional `similarTo: { id: string; title: string }`.

- [ ] **Step 1: Add a `similarTo` result state and render a non-blocking notice**

In `src/app/(app)/add/page.tsx`, add state and handle the response instead of always redirecting on `res.ok`. Replace the `onSubmit` success handling and add a notice block:

```tsx
  const [similar, setSimilar] = useState<{ addedTitle: string; existing: { id: string; title: string } } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSimilar(null);
    try {
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          title?: string;
          similarTo?: { id: string; title: string };
        };
        if (data.similarTo) {
          // Non-blocking: the series WAS added; just flag a possible duplicate.
          setSimilar({ addedTitle: data.title ?? 'the series', existing: data.similarTo });
          setBusy(false);
          return;
        }
        router.push('/');
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Could not add that series.');
    } catch {
      setError('Couldn’t reach the server. Try again.');
    }
    setBusy(false);
  }
```

Then render the notice when `similar` is set — place it above the form (or replace the form) inside the `<section>`:

```tsx
      {similar && (
        <div className="notice" role="status">
          <p>
            Added <strong>{similar.addedTitle}</strong>. This looks similar to{' '}
            <strong>{similar.existing.title}</strong>, which you already track — it may be the same work.
          </p>
          <div className="notice__actions">
            <Link href={`/series/${similar.existing.id}`} className="btn">
              Open “{similar.existing.title}”
            </Link>
            <Link href="/" className="btn btn--primary" onClick={() => router.refresh()}>
              Keep both, go to library
            </Link>
          </div>
          <p className="hero__note">Merging duplicates from the app is coming soon; for now the two are kept separate.</p>
        </div>
      )}
```

(The `notice`/`notice__actions` classes are presentational — reuse existing card/button styling; do not add heavy new CSS. If no `notice` class exists, use existing container classes like `login` and the existing `btn` classes, which are already in `globals.css`.)

- [ ] **Step 2: Verify the build/typecheck**

Run: `npm run typecheck`
Expected: clean. (This client change has no unit test; it is verified by typecheck + manual reasoning. Do NOT add a brittle DOM snapshot test.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/add/page.tsx"
git commit -m "WP-39b: add-page shows a non-blocking 'similar series' notice with Open/Merge affordances"
```

---

### Task 5: PLAN.md — WP-39b done (re-scoped) + file WP-CLEANUP-UI, WP-WORKID

**Files:**
- Modify: `PLAN.md`

**Interfaces:** none (tracker hygiene, agreement #6).

- [ ] **Step 1: Re-read PLAN.md fresh and update WITHOUT clobbering**

**Important:** PLAN.md may have unrelated edits from another session. Read the whole file first and make surgical edits only — do not remove or rewrite sections you didn't author.

In `PLAN.md`:
- Mark **WP-39b** done in the Active queue with a note that it was **re-scoped**: (a) `tocUrl` page-watch dedup + create-then-annotate landed; the original (b) matcher-type-flip is covered-in-spirit by the annotate net, and (c) true multi-novel matcher intelligence is **deferred** (revisit reactively). Set the next-priority row to `NEXT` per current row order.
- Add WP-39b to the ✅ Completed line.
- In the `### WP-39b` detail section, add a `**DONE (re-scoped, 2026-08-10).**` summary of what shipped (tocUrl keying going-forward; pure `findSimilarTitle` normalized/prefix, no fuzzy, cannot catch cross-translation; create-then-annotate `similarTo` + add-page notice; no migration) and what was explicitly deferred.
- **File two new WPs** in the Active queue / later-tiers as appropriate:
  - **WP-CLEANUP-UI** — in-app cleanup surfacing `db:cleanup` (delete/merge series, delete/reset chapters, edit source/TOC URL); its **merge** doubles as the manual **same-work / different-translation resolver** (target of the add-page "Merge" affordance). Depends on WP-10.
  - **WP-WORKID** *(future, low)* — map a source to a community aggregator's **canonical work ID** (lists a work's alternative/translated titles) for an automatic cross-translation identity; described generically (anonymity). Depends on WP-05/WP-17.
- Update **Current focus** and add a Changelog line dated 2026-08-10 for WP-39b.
- Keep everything anonymous (framework/category descriptors only; no real site/series names).

- [ ] **Step 2: Commit**

```bash
git add PLAN.md
git commit -m "docs: WP-39b done (re-scoped) — tocUrl dedup + annotate; file WP-CLEANUP-UI, WP-WORKID"
```

---

## Self-Review

**Spec coverage:**
- §1 tocUrl page-watch keying → Task 1. ✅
- §2 pure `findSimilarTitle` (normalized/prefix, no fuzzy, cross-translation limit) → Task 2. ✅
- §3 create-then-annotate flow (finalize + port + result + route + client notice) → Task 3 (backend/route) + Task 4 (client). ✅
- §4 file WP-CLEANUP-UI + WP-WORKID → Task 5. ✅
- Testing (unit for both pure fns; integration for `similarTo` on the create branch) → Tasks 1, 2, 3. ✅
- DoD (going-forward tocUrl dedup; `similarTo` hint + notice; unit+integration; no migration; WPs filed) → all tasks. ✅

**Placeholder scan:** No TBD/TODO; every code step shows real code. ✅

**Type consistency:** `canonicalSeriesId(input: {feedUrl, tocUrl?, sourceUrl, match})` (Task 1) is called with `tocUrl` in `finalize` (Task 1 Step 4). `findSimilarTitle(candidate, existing): {id,title}|null` (Task 2) is consumed in `finalize` (Task 3). `AddSeriesPorts.listExistingSeries: () => Promise<{id,title}[]>` (Task 3) implemented in index.ts (Task 3 Step 4) and stubbed in other port literals (Task 3 Step 6). `AddSeriesResult.similarTo?` (Task 3) flows to the route response (Task 3 Step 5) and is read by the client as `similarTo: {id,title}` (Task 4). Consistent. ✅

**Non-vacuity note:** Task 3's integration test asserts `alreadyExisting === false` AND `similarTo.title === 'Alpha Saga'` (the series was created, not blocked), and `r3.similarTo == null` for a different title — it would fail if the annotate were absent or if it wrongly blocked. Genuine.