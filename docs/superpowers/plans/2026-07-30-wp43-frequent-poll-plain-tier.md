# WP-43 — Frequent PLAIN-tier polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an external trigger poll only the cheap FEED+PLAIN source tier every ~2h via `/api/cron/poll?tier=plain`, while the daily Vercel cron keeps polling the full superset.

**Architecture:** A pure `sourceTierWhere(tier)` builds the Prisma `where` that narrows active sources; a pure `parsePollTier(searchParams)` maps `?tier=plain` to that tier (fail-safe to `all`). The `pollAllSources` edge threads the tier into `loadActiveSources`; the pure poll loop (WP-41/42) is untouched. A GitHub Actions scheduled workflow curls the endpoint with secret URL + token.

**Tech Stack:** TypeScript (strict), Next.js App Router route handler, Prisma/Postgres, Vitest (unit + integration), GitHub Actions.

## Global Constraints

- **TDD for logic** — no production logic without a failing test first; watch it fail for the right reason. (`sourceTierWhere`, `parsePollTier` are pure → unit-tested; the edge wiring → integration-tested.)
- **Keep `src/lib/**` pure and Next-free** — this WP touches only `src/server/**`, `src/app/api/**`, and `.github/`; no `lib/` changes.
- **Verify before "done"** — run `npm test` + `npm run typecheck` and read exit codes before claiming complete. Integration: `DATABASE_URL="…webnovel_test" npm run test:integration`.
- **Committed-doc anonymity** — no real site/series names in committed files. The workflow uses secrets (`POLL_URL`, `CRON_SECRET`); example URLs in tests use `*.example`.
- **`?tier=plain` is the only narrowing value** — anything else (missing/unknown/empty) → `all` (full poll). Fail-safe to more coverage, never less.
- **Fetch-mode / type literals** — `type` is `'FEED' | 'PAGE_WATCH'`, `fetchMode` is `'PLAIN' | 'RENDER'` (matches `PollableSource`).
- **Update PLAN.md when work lands** — flip WP-43 → DONE, add a changelog line, set the next `NEXT`.

---

## File Structure

- `src/server/services/poll.ts` — add `PollTier` type + pure `sourceTierWhere(tier)`. (Pure, unit-tested here already.)
- `src/server/services/index.ts` — thread `tier` through `pollAllSources(...)` → `pollPorts(...)` → `loadActiveSources`.
- `src/server/api/validation.ts` — add pure `parsePollTier(searchParams)`.
- `src/app/api/cron/poll/route.ts` — read `?tier=plain`, pass tier to `pollAllSources`, surface `tier` in the summary.
- `.github/workflows/poll.yml` — new scheduled workflow (every 2h) calling the endpoint with secret URL + token.
- `tests/unit/server/poll.test.ts` — unit tests for `sourceTierWhere`.
- `tests/unit/server/validation.test.ts` — unit tests for `parsePollTier`.
- `tests/integration/services.test.ts` — integration test: `tier='plain'` polls only FEED+PLAIN; `tier='all'` polls all.
- `PLAN.md` — status flip + changelog + next NEXT.

---

### Task 1: `PollTier` + `sourceTierWhere` (pure)

**Files:**
- Modify: `src/server/services/poll.ts` (add near the other exported pure helpers, e.g. after `MIN_POLL_INTERVAL_MINUTES` / the WP-41 constants block)
- Test: `tests/unit/server/poll.test.ts`

**Interfaces:**
- Produces: `type PollTier = 'all' | 'plain'`; `sourceTierWhere(tier: PollTier): { isActive: true; type?: 'FEED'; fetchMode?: 'PLAIN' }`.

- [ ] **Step 1: Write the failing tests**

Add at the end of `tests/unit/server/poll.test.ts`. Also add `sourceTierWhere` and `type PollTier` to the existing import from `../../../src/server/services/poll`.

```ts
describe('sourceTierWhere', () => {
  test("'all' → every active source (the daily full superset)", () => {
    expect(sourceTierWhere('all')).toEqual({ isActive: true });
  });

  test("'plain' → only the cheap 304-able FEED+PLAIN tier", () => {
    expect(sourceTierWhere('plain')).toEqual({ isActive: true, type: 'FEED', fetchMode: 'PLAIN' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/server/poll.test.ts -t sourceTierWhere`
Expected: FAIL — `sourceTierWhere is not a function` (import unresolved).

- [ ] **Step 3: Write the minimal implementation**

In `src/server/services/poll.ts`:

```ts
/** Which active sources a poll run considers. 'all' = the full daily superset; 'plain' = only the
 *  cheap, conditional-GET-friendly FEED+PLAIN tier the frequent external trigger polls (WP-43). */
export type PollTier = 'all' | 'plain';

/** Prisma `where` selecting the sources for a tier. Pure — no Prisma import; the returned literal is
 *  structurally a `Prisma.SourceWhereInput`. WP-43. */
export function sourceTierWhere(tier: PollTier): { isActive: true; type?: 'FEED'; fetchMode?: 'PLAIN' } {
  return tier === 'plain' ? { isActive: true, type: 'FEED', fetchMode: 'PLAIN' } : { isActive: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/server/poll.test.ts`
Expected: PASS (all poll unit tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/poll.ts tests/unit/server/poll.test.ts
git commit -m "WP-43: PollTier + sourceTierWhere (pure source-tier filter)"
```

---

### Task 2: `parsePollTier` (pure route param parse)

**Files:**
- Modify: `src/server/api/validation.ts` (add after `isAuthorizedCron`)
- Test: `tests/unit/server/validation.test.ts`

**Interfaces:**
- Consumes: `PollTier` (type-only import from `../services/poll`).
- Produces: `parsePollTier(searchParams: URLSearchParams): PollTier`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/server/validation.test.ts` (import `parsePollTier` from the validation module):

```ts
describe('parsePollTier', () => {
  const parse = (qs: string) => parsePollTier(new URLSearchParams(qs));

  test('?tier=plain → plain', () => {
    expect(parse('tier=plain')).toBe('plain');
  });

  test('no tier param → all (full poll)', () => {
    expect(parse('')).toBe('all');
  });

  test('unknown tier value → all (fail-safe to full poll)', () => {
    expect(parse('tier=render')).toBe('all');
  });

  test('empty tier value → all', () => {
    expect(parse('tier=')).toBe('all');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/server/validation.test.ts -t parsePollTier`
Expected: FAIL — `parsePollTier is not a function`.

- [ ] **Step 3: Write the minimal implementation**

In `src/server/api/validation.ts` — add a type-only import at the top (`import type { PollTier } from '../services/poll';`) and:

```ts
/** Map the poll route's `?tier=` query to a PollTier. Only exactly `plain` narrows to the cheap
 *  FEED+PLAIN tier; anything else (missing/unknown/empty) → `all`, so a malformed trigger degrades
 *  to MORE coverage, never less. Pure. WP-43. */
export function parsePollTier(searchParams: URLSearchParams): PollTier {
  return searchParams.get('tier') === 'plain' ? 'plain' : 'all';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/server/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/api/validation.ts tests/unit/server/validation.test.ts
git commit -m "WP-43: parsePollTier (fail-safe ?tier=plain route parse)"
```

---

### Task 3: Thread `tier` through the `pollAllSources` edge

**Files:**
- Modify: `src/server/services/index.ts` — `pollPorts(...)` and `pollAllSources(...)`
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `sourceTierWhere`, `PollTier` (from `./poll`).
- Produces: `pollAllSources(fetchImpl?, renderImpl?, now?, tier: PollTier = 'all')` — 4th positional arg, default `'all'` (existing callers unchanged). `pollPorts(fetchImpl, renderImpl?, now?, tier: PollTier = 'all')` applies `sourceTierWhere(tier)` in `loadActiveSources`.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/services.test.ts`. It seeds three sources with distinct (type, fetchMode) and asserts the tier filter. Add `sourceTierWhere`-adjacent imports as needed (`getCurrentUserId` and `db` are already imported).

```ts
describe('pollAllSources tier filter (real DB, WP-43)', () => {
  const PLAIN_FEED = 'https://plain.example/feed/';
  const RENDER_FEED = 'https://render.example/feed/';
  const WATCH_URL = 'https://watch.example/toc/';

  /** Seed one source of a given type/fetchMode bound to a fresh series. Returns the source id. */
  async function seedSource(args: {
    title: string;
    url: string;
    host: string;
    type: 'FEED' | 'PAGE_WATCH';
    fetchMode: 'PLAIN' | 'RENDER';
  }): Promise<string> {
    const series = await db.series.create({ data: { userId: getCurrentUserId(), title: args.title } });
    const source = await db.source.create({
      data: {
        seriesId: series.id,
        url: args.url,
        host: args.host,
        type: args.type,
        fetchMode: args.fetchMode,
        feedUrl: args.type === 'FEED' ? args.url : null,
        matchType: 'WHOLE_FEED',
      },
    });
    return source.id;
  }

  test("tier='plain' polls only FEED+PLAIN; RENDER and PAGE_WATCH are untouched", async () => {
    const plainId = await seedSource({ title: 'PlainFeed', url: PLAIN_FEED, host: 'plain.example', type: 'FEED', fetchMode: 'PLAIN' });
    const renderId = await seedSource({ title: 'RenderFeed', url: RENDER_FEED, host: 'render.example', type: 'FEED', fetchMode: 'RENDER' });
    const watchId = await seedSource({ title: 'PageWatch', url: WATCH_URL, host: 'watch.example', type: 'PAGE_WATCH', fetchMode: 'PLAIN' });

    // Fetch serves every url, so "not polled" can only be due to the tier filter, not a fetch miss.
    const fetch = fetchFrom({ [PLAIN_FEED]: okRes(RSS('')), [RENDER_FEED]: okRes(RSS('')), [WATCH_URL]: okRes('<html></html>') });
    const effects = await pollAllSources(fetch, undefined, undefined, 'plain');

    expect(effects.map((e) => e.sourceId)).toEqual([plainId]);
    // The excluded sources were never polled → lastCheckedAt stays null.
    expect((await db.source.findFirstOrThrow({ where: { id: renderId } })).lastCheckedAt).toBeNull();
    expect((await db.source.findFirstOrThrow({ where: { id: watchId } })).lastCheckedAt).toBeNull();
    expect((await db.source.findFirstOrThrow({ where: { id: plainId } })).lastCheckedAt).not.toBeNull();
  });

  test("tier='all' polls every active source (filter does not leak into the default path)", async () => {
    await seedSource({ title: 'PlainFeed', url: PLAIN_FEED, host: 'plain.example', type: 'FEED', fetchMode: 'PLAIN' });
    await seedSource({ title: 'RenderFeed', url: RENDER_FEED, host: 'render.example', type: 'FEED', fetchMode: 'RENDER' });
    await seedSource({ title: 'PageWatch', url: WATCH_URL, host: 'watch.example', type: 'PAGE_WATCH', fetchMode: 'PLAIN' });

    const fetch = fetchFrom({ [PLAIN_FEED]: okRes(RSS('')), [RENDER_FEED]: okRes(RSS('')), [WATCH_URL]: okRes('<html></html>') });
    const effects = await pollAllSources(fetch, undefined, undefined, 'all');

    expect(effects).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="$(grep -o 'postgresql://[^"]*webnovel_test' .env | head -1)" npx vitest run --project integration tests/integration/services.test.ts -t "tier filter"`
Expected: FAIL — `pollAllSources` currently ignores the 4th arg, so `tier='plain'` polls all three (effects length 3, not `[plainId]`).

- [ ] **Step 3: Write the minimal implementation**

In `src/server/services/index.ts`:

1. Extend the `./poll` import to include `sourceTierWhere` and `type PollTier`:

```ts
import { pollAllSources as pollAllCore, sourceTierWhere, type PollableSource, type PollEffects, type PollPorts, type PollTier } from './poll';
```

2. Add `tier` to `pollPorts` and use it in `loadActiveSources`:

```ts
function pollPorts(
  fetchImpl: FetchImpl,
  renderImpl?: FetchImpl,
  now: Date = new Date(),
  tier: PollTier = 'all',
): PollPorts & { loadActiveSources: () => Promise<PollableSource[]> } {
  return {
    fetch: fetchImpl,
    renderFetch: renderImpl,
    loadActiveSources: async () => (await db.source.findMany({ where: sourceTierWhere(tier) })).map(rowToPollable),
    // …loadStoredChapters + applyPollEffects unchanged…
```

3. Add `tier` to the exported `pollAllSources` and pass it through:

```ts
export function pollAllSources(
  fetchImpl: FetchImpl = fetchPort,
  renderImpl: FetchImpl | undefined = renderPort(),
  now: Date = new Date(),
  tier: PollTier = 'all',
): Promise<PollEffects[]> {
  return pollAllCore(pollPorts(fetchImpl, renderImpl, now, tier), now);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL="$(grep -o 'postgresql://[^"]*webnovel_test' .env | head -1)" npm run test:integration`
Expected: PASS (all integration tests, including the two new tier tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/index.ts tests/integration/services.test.ts
git commit -m "WP-43: thread poll tier through loadActiveSources"
```

---

### Task 4: Route reads `?tier=plain`

**Files:**
- Modify: `src/app/api/cron/poll/route.ts`

**Interfaces:**
- Consumes: `parsePollTier` (from `server/api/validation`), `pollAllSources` (tier arg from Task 3).

This task is glue — its behavior is covered by the unit-tested `parsePollTier` (Task 2) and the integration-tested tiered `pollAllSources` (Task 3). It is verified by `npm run typecheck` and a manual `workflow_dispatch` after Task 5. No new automated test.

- [ ] **Step 1: Wire the tier into the handler**

In `src/app/api/cron/poll/route.ts`, import `parsePollTier` and use it:

```ts
import { parsePollTier } from '../../../../server/api/validation';
```

Inside `GET`, after the auth check:

```ts
  const tier = parsePollTier(new URL(request.url).searchParams);
  const effects = await pollAllSources(undefined, undefined, undefined, tier);
```

Add `tier` to the summary object so a GHA run's log shows which tier it hit:

```ts
  const summary = {
    tier,
    polled: effects.length,
    // …existing fields unchanged…
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 3: Full unit suite (guard against regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/poll/route.ts
git commit -m "WP-43: poll route honors ?tier=plain (fail-safe to full poll)"
```

---

### Task 5: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/poll.yml`

Config, not code — no automated test. Verified by the owner via a manual `workflow_dispatch` run once the `POLL_URL` and `CRON_SECRET` repo secrets are set (see the spec's "Manual setup"). `-f` makes a non-2xx fail the job so breakage surfaces in the Actions tab.

- [ ] **Step 1: Create the workflow**

`.github/workflows/poll.yml`:

```yaml
name: Frequent poll (PLAIN tier)

on:
  schedule:
    - cron: '0 */2 * * *'   # every 2h UTC — PLAIN tier only (see docs/superpowers/specs/2026-07-30-wp43-…)
  workflow_dispatch: {}       # manual run, for testing / on-demand

jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger PLAIN-tier poll
        run: |
          curl -fsS --max-time 300 "${{ secrets.POLL_URL }}?tier=plain" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

- [ ] **Step 2: Sanity-check the YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/poll.yml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/poll.yml
git commit -m "WP-43: GitHub Actions workflow — 2h PLAIN-tier poll trigger"
```

---

### Task 6: Update PLAN.md

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Flip status + move to Completed**

- In the **▶ Active queue** table, remove the `WP-43` row (it moves to Completed).
- In the **✅ Completed** paragraph, append `· WP-43 (frequent PLAIN-tier polling)`.
- Set the next `NEXT` in the Active queue to **WP-27** (next by priority order) and update the "Current focus" block accordingly (WP-43 done; NEXT = WP-27). Keep the budget×cadence note now that it's realized in code.

- [ ] **Step 2: Add a changelog entry (top of the Changelog section)**

```markdown
- **2026-07-30** — **WP-43 done: frequent PLAIN-tier polling.** External GitHub Actions trigger (`.github/workflows/poll.yml`,
  every 2h, `workflow_dispatch` for manual runs) calls `/api/cron/poll?tier=plain` with secret URL + `CRON_SECRET`.
  Pure `sourceTierWhere` (FEED+PLAIN vs all) + fail-safe `parsePollTier` (only `plain` narrows) thread a `PollTier`
  through the `pollAllSources` edge into `loadActiveSources`; the WP-41/42 loop is untouched. Daily Vercel cron stays a
  full superset (safety net; WP-41 rotation already front-loads RENDER). Neon budget ≈ ~40 compute-hr/mo at 2h — don't
  go below 2h. +N unit +2 integration tests, typecheck clean. Owner sets `POLL_URL` + `CRON_SECRET` repo secrets.
```

(Replace `+N` with the actual count of new unit tests added — 2 for `sourceTierWhere` + 4 for `parsePollTier` = 6.)

- [ ] **Step 3: Commit**

```bash
git add PLAN.md
git commit -m "WP-43: mark done in PLAN.md (status + changelog + next NEXT)"
```

---

## Final verification (before marking WP-43 complete)

- [ ] `npm test` — full unit suite green (read the exit code / summary line).
- [ ] `DATABASE_URL="$(grep -o 'postgresql://[^"]*webnovel_test' .env | head -1)" npm run test:integration` — green.
- [ ] `npm run typecheck` — clean.
- [ ] `.github/workflows/poll.yml` parses; the schedule is `0 */2 * * *` and the URL/token come from secrets (no literals).
- [ ] PLAN.md: WP-43 in Completed, changelog line present, NEXT = WP-27.

## Self-review notes (author)

- **Spec coverage:** tier filter (Task 1) ✓; route param parse (Task 2) ✓; edge wiring (Task 3) ✓; route (Task 4) ✓; GHA workflow (Task 5) ✓; daily-superset unchanged (no task needed — the default `tier='all'` preserves it) ✓; budget/behavior notes are documented, not code ✓; testing plan (Tasks 1–3) ✓; manual secret setup (Task 5 + spec) ✓.
- **Type consistency:** `PollTier` defined in Task 1, imported in Tasks 2 & 3; `sourceTierWhere` return type matches its use as a Prisma `where`; `pollAllSources` 4th-arg `tier` default `'all'` keeps every existing positional caller (integration tests, the route's prior no-arg call) valid.
- **Placeholder scan:** the only intentional placeholder is `+N` in the changelog (Task 6 Step 2), resolved inline to 6.
