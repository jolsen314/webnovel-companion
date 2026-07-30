# Poll-once-per-feed + politeness (WP-42) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pollAllSources` fetch each feed URL once and fan out to every series on it, plus honor 429/Retry-After and a per-host min-interval cap — so polling is polite and ready for a frequent external trigger (WP-43).

**Architecture:** Turn the source-centric poll loop into a feed-centric one: group active sources by `(fetchMode, fetchUrl)`, do one (conditional) fetch per group, then run the existing per-source parse/filter/diff on the shared body. Two politeness gates (min-interval via existing `lastCheckedAt`; backoff via a new `Source.backoffUntil`) decide whether to fetch a group. The grouping, conditional-validator choice, and gate logic are pure and unit-tested; fetch/DB stay behind the existing `PollPorts`.

**Tech Stack:** TypeScript (strict), Prisma/Postgres, Vitest (unit + integration).

## Global Constraints

- `src/lib/**` stays pure and Next-free (no `next`/`prisma`/`fs`/network imports); `parseRetryAfter` lives in `lib/feeds/fetch.ts` beside `politeFetch` and takes `now` as a parameter (no `Date.now()` inside).
- TDD: failing test first, watch it fail for the right reason, then implement. `npm test` (unit) + `npm run typecheck` must be green before each commit; integration tests run with `DATABASE_URL` pointing at `webnovel_test`.
- Keep the browser/bot UA and health weights **unchanged** — 429 stays classified `HTTP_4XX` for health; backoff is an *additional* signal, not a health change.
- Migrations are **additive** (`backoffUntil` is nullable/defaulted — safe for existing rows).
- No real site/series names in committed code, tests, or messages.

---

### Task 1: Retry-After parsing + surfacing on `PoliteResult`

**Files:**
- Modify: `src/lib/feeds/fetch.ts`
- Test: `tests/unit/feeds/fetch.test.ts`

**Interfaces:**
- Produces: `parseRetryAfter(value: string | null | undefined, now: Date): Date | null`; `PoliteResult` (both variants) gains `retryAfter?: string | null` (the raw header, or null).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/feeds/fetch.test.ts — add
import { parseRetryAfter, politeFetch, type HttpResponse } from '../../../src/lib/feeds/fetch';

describe('parseRetryAfter', () => {
  const now = new Date('2026-07-29T12:00:00Z');
  test('delta-seconds → now + seconds', () => {
    expect(parseRetryAfter('120', now)).toEqual(new Date('2026-07-29T12:02:00Z'));
  });
  test('HTTP-date → that date', () => {
    expect(parseRetryAfter('Wed, 29 Jul 2026 12:05:00 GMT', now)).toEqual(new Date('2026-07-29T12:05:00Z'));
  });
  test('null / empty / garbage → null', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
  });
});

test('politeFetch surfaces the Retry-After header on a 429', async () => {
  const fake = async (): Promise<HttpResponse> => ({
    status: 429,
    url: 'https://x.example/feed/',
    headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? '120' : null) },
    text: async () => '',
  });
  const res = await politeFetch('https://x.example/feed/', {}, fake);
  expect(res.outcome).toBe('HTTP_4XX'); // health classification unchanged
  expect(res.retryAfter).toBe('120');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- fetch`
Expected: FAIL — `parseRetryAfter` not exported; `retryAfter` undefined on the result.

- [ ] **Step 3: Implement**

In `src/lib/feeds/fetch.ts`:

```ts
/** Parse an HTTP `Retry-After` (delta-seconds or HTTP-date) to an absolute Date. Pure. */
export function parseRetryAfter(value: string | null | undefined, now: Date): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return new Date(now.getTime() + Number(trimmed) * 1000);
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms);
}
```

Add `retryAfter?: string | null` to **both** `PoliteResult` variants. In `politeFetch`, capture it once after the fetch and include it on every returned result:

```ts
// after `const { status } = res;`
const retryAfter = res.headers.get('retry-after');
```
Add `retryAfter` to each returned object (the `304`, `HTTP_5XX`, `HTTP_4XX`, `PARKED`, and `SUCCESS` returns). For the error-catch return (`classifyError`), add `retryAfter: null`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- fetch` → PASS. Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feeds/fetch.ts tests/unit/feeds/fetch.test.ts
git commit -m "feat(fetch): parse + surface Retry-After on PoliteResult"
```

---

### Task 2: `Source.backoffUntil` migration + widen `PollableSource`

**Files:**
- Modify: `prisma/schema.prisma` (Source model), `src/server/services/poll.ts` (`PollableSource`), `src/server/services/index.ts` (`rowToPollable`, `loadActiveSources` select)
- Migration: `prisma/migrations/<timestamp>_source_backoff_until/migration.sql`

**Interfaces:**
- Produces: `Source.backoffUntil DateTime?`; `PollableSource` gains `host: string`, `lastCheckedAt: Date | null`, `backoffUntil: Date | null`.

- [ ] **Step 1: Add the column to the schema**

In `prisma/schema.prisma`, in `model Source`, beside the conditional-GET fields:

```prisma
  // Politeness: a 429/Retry-After sets this; the poller skips the host until it passes (WP-42).
  backoffUntil DateTime?
```

- [ ] **Step 2: Generate the migration + client**

Run:
```bash
npx prisma migrate dev --name source_backoff_until
```
Expected: a new `migration.sql` with `ALTER TABLE "Source" ADD COLUMN "backoffUntil" TIMESTAMP(3);`, applied to `webnovel_dev`, client regenerated. (Prod applies it via `vercel-build`'s `prisma migrate deploy` on the next deploy.)

- [ ] **Step 3: Widen `PollableSource` + map the row**

In `src/server/services/poll.ts`, add to the `PollableSource` interface:

```ts
  /** Host (for per-host politeness gating). */
  host: string;
  /** Last poll attempt (any outcome) — drives the min-interval cap. Null = never polled. */
  lastCheckedAt: Date | null;
  /** Skip this host until this time (429/Retry-After). Null = no backoff. */
  backoffUntil: Date | null;
```

In `src/server/services/index.ts` `rowToPollable(...)`, add `host`, `lastCheckedAt`, `backoffUntil` to the param type and the returned object; and add them to the `loadActiveSources` `findMany` (it currently selects the whole row via `db.source.findMany({ where: { isActive: true } })`, so the columns come automatically — confirm `host`, `lastCheckedAt`, `backoffUntil` are read and passed through `rowToPollable`).

- [ ] **Step 4: Verify typecheck + existing tests**

Run: `npm run typecheck` (clean) and `npm test -- poll` (existing poll unit tests still green; update any `PollableSource` fixtures to include the three new fields — set `host: 'x.example'`, `lastCheckedAt: null`, `backoffUntil: null`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/server/services/poll.ts src/server/services/index.ts tests/unit/server/poll.test.ts
git commit -m "feat(poll): add Source.backoffUntil + widen PollableSource (host, lastCheckedAt, backoffUntil)"
```

---

### Task 3: `groupPollSources` (pure)

**Files:**
- Modify: `src/server/services/poll.ts`
- Test: `tests/unit/server/poll.test.ts`

**Interfaces:**
- Produces: `interface PollGroup { key: string; fetchMode: PollableSource['fetchMode']; fetchUrl: string; host: string; sources: PollableSource[] }` and `groupPollSources(sources: PollableSource[]): PollGroup[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/server/poll.test.ts — add. Assumes a helper makeSource(partial) that
// returns a PollableSource with sane defaults; add one if absent.
import { groupPollSources } from '../../../src/server/services/poll';

test('groupPollSources collapses sources sharing (fetchMode, fetchUrl)', () => {
  const a = makeSource({ id: 'a', fetchUrl: 'https://s.example/feed/', fetchMode: 'PLAIN' });
  const b = makeSource({ id: 'b', fetchUrl: 'https://s.example/feed/', fetchMode: 'PLAIN' });
  const c = makeSource({ id: 'c', fetchUrl: 'https://s.example/feed/', fetchMode: 'RENDER' });
  const groups = groupPollSources([a, b, c]);
  expect(groups).toHaveLength(2); // (PLAIN,feed) has a+b; (RENDER,feed) has c
  const shared = groups.find((g) => g.fetchMode === 'PLAIN')!;
  expect(shared.sources.map((s) => s.id).sort()).toEqual(['a', 'b']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- poll` → FAIL (`groupPollSources` not defined).

- [ ] **Step 3: Implement**

```ts
export interface PollGroup {
  key: string;
  fetchMode: PollableSource['fetchMode'];
  fetchUrl: string;
  host: string;
  sources: PollableSource[];
}

/** Group active sources so each distinct (fetchMode, fetchUrl) is fetched once. Pure. */
export function groupPollSources(sources: PollableSource[]): PollGroup[] {
  const byKey = new Map<string, PollGroup>();
  for (const s of sources) {
    const key = `${s.fetchMode}::${s.fetchUrl}`;
    const g = byKey.get(key);
    if (g) g.sources.push(s);
    else byKey.set(key, { key, fetchMode: s.fetchMode, fetchUrl: s.fetchUrl, host: s.host, sources: [s] });
  }
  return [...byKey.values()];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- poll` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/poll.ts tests/unit/server/poll.test.ts
git commit -m "feat(poll): groupPollSources — dedup by (fetchMode, fetchUrl)"
```

---

### Task 4: `chooseConditionalState` (pure)

**Files:**
- Modify: `src/server/services/poll.ts`
- Test: `tests/unit/server/poll.test.ts`

**Interfaces:**
- Produces: `chooseConditionalState(sources: PollableSource[]): { etag: string | null; lastModified: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { chooseConditionalState } from '../../../src/server/services/poll';

test('all sources share one etag → send that etag', () => {
  const g = [makeSource({ etag: 'W/"v1"' }), makeSource({ etag: 'W/"v1"' })];
  expect(chooseConditionalState(g)).toEqual({ etag: 'W/"v1"', lastModified: null });
});
test('etags diverge → no conditional (full fetch)', () => {
  const g = [makeSource({ etag: 'W/"v1"' }), makeSource({ etag: 'W/"v2"' })];
  expect(chooseConditionalState(g)).toEqual({ etag: null, lastModified: null });
});
test('a new source (null etag) → full fetch even if others match', () => {
  const g = [makeSource({ etag: 'W/"v1"' }), makeSource({ etag: null })];
  expect(chooseConditionalState(g)).toEqual({ etag: null, lastModified: null });
});
test('no etags but a shared lastModified → send If-Modified-Since', () => {
  const g = [makeSource({ etag: null, lastModified: 'Mon, 28 Jul 2026 10:00:00 GMT' }),
             makeSource({ etag: null, lastModified: 'Mon, 28 Jul 2026 10:00:00 GMT' })];
  expect(chooseConditionalState(g)).toEqual({ etag: null, lastModified: 'Mon, 28 Jul 2026 10:00:00 GMT' });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- poll` → FAIL (`chooseConditionalState` not defined).

- [ ] **Step 3: Implement**

```ts
/** Validators the whole group agrees on: prefer a shared non-null etag, else a shared
 *  non-null lastModified, else none (full fetch). Any null/divergence → full. Pure. */
export function chooseConditionalState(
  sources: PollableSource[],
): { etag: string | null; lastModified: string | null } {
  const allSame = <T>(vals: (T | null)[]): T | null =>
    vals.length > 0 && vals.every((v) => v != null && v === vals[0]) ? (vals[0] as T) : null;
  const etag = allSame(sources.map((s) => s.etag));
  if (etag) return { etag, lastModified: null };
  const lastModified = allSame(sources.map((s) => s.lastModified));
  return { etag: null, lastModified };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- poll` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/poll.ts tests/unit/server/poll.test.ts
git commit -m "feat(poll): chooseConditionalState — shared conditional-GET validators"
```

---

### Task 5: `hostGate` (pure) + `MIN_POLL_INTERVAL_MINUTES`

**Files:**
- Modify: `src/server/services/poll.ts`
- Test: `tests/unit/server/poll.test.ts`

**Interfaces:**
- Produces: `MIN_POLL_INTERVAL_MINUTES = 15`; `hostGate(args: { hostLastCheckedAt: Date | null; hostBackoffUntil: Date | null; now: Date; minIntervalMs: number }): { skip: boolean; reason: 'ok' | 'min-interval' | 'backoff' }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { hostGate, MIN_POLL_INTERVAL_MINUTES } from '../../../src/server/services/poll';

const now = new Date('2026-07-29T12:00:00Z');
const min = MIN_POLL_INTERVAL_MINUTES * 60_000;

test('backoff in the future → skip:backoff (takes precedence)', () => {
  expect(hostGate({ hostLastCheckedAt: null, hostBackoffUntil: new Date('2026-07-29T12:30:00Z'), now, minIntervalMs: min }))
    .toEqual({ skip: true, reason: 'backoff' });
});
test('polled 5 min ago (< interval) → skip:min-interval', () => {
  expect(hostGate({ hostLastCheckedAt: new Date('2026-07-29T11:55:00Z'), hostBackoffUntil: null, now, minIntervalMs: min }))
    .toEqual({ skip: true, reason: 'min-interval' });
});
test('polled 20 min ago, no backoff → ok', () => {
  expect(hostGate({ hostLastCheckedAt: new Date('2026-07-29T11:40:00Z'), hostBackoffUntil: null, now, minIntervalMs: min }))
    .toEqual({ skip: false, reason: 'ok' });
});
test('never polled, expired backoff → ok', () => {
  expect(hostGate({ hostLastCheckedAt: null, hostBackoffUntil: new Date('2026-07-29T11:00:00Z'), now, minIntervalMs: min }))
    .toEqual({ skip: false, reason: 'ok' });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- poll` → FAIL.

- [ ] **Step 3: Implement**

```ts
/** Minimum minutes between polls of one host — the floor that keeps a frequent external
 *  trigger polite. Polls fired more often than this per host simply no-op. */
export const MIN_POLL_INTERVAL_MINUTES = 15;

/** Whether to skip a host this cycle: backoff (429/Retry-After) first, then the min-interval
 *  cap. Both compare against pre-run state. Pure. */
export function hostGate(args: {
  hostLastCheckedAt: Date | null;
  hostBackoffUntil: Date | null;
  now: Date;
  minIntervalMs: number;
}): { skip: boolean; reason: 'ok' | 'min-interval' | 'backoff' } {
  const { hostLastCheckedAt, hostBackoffUntil, now, minIntervalMs } = args;
  if (hostBackoffUntil && hostBackoffUntil.getTime() > now.getTime()) return { skip: true, reason: 'backoff' };
  if (hostLastCheckedAt && now.getTime() - hostLastCheckedAt.getTime() < minIntervalMs) {
    return { skip: true, reason: 'min-interval' };
  }
  return { skip: false, reason: 'ok' };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- poll` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/poll.ts tests/unit/server/poll.test.ts
git commit -m "feat(poll): hostGate — per-host min-interval + backoff gating"
```

---

### Task 6: Feed-centric `pollAllSources` (fetch once → fan out) + apply backoff

**Files:**
- Modify: `src/server/services/poll.ts` (`pollAllSources`, split `pollSource` into fetch + `processFetched`; add `backoffUntil` to `PollEffects`), `src/server/services/index.ts` (`applyPollEffects` writes `backoffUntil`; pass `now`)
- Test: `tests/unit/server/poll.test.ts`

**Interfaces:**
- Consumes: `groupPollSources`, `chooseConditionalState`, `hostGate`, `parseRetryAfter`, `MIN_POLL_INTERVAL_MINUTES`.
- Produces: `PollEffects` gains `backoffUntil?: Date | null`; `pollAllSources(ports, now?: Date)` groups + gates + fetches once + fans out. `processFetched(src: PollableSource, res: PoliteResult, retryAfterAt: Date | null, ports: PollPorts): Promise<PollEffects>` (the former post-fetch half of `pollSource` — async because it calls `ports.loadStoredChapters`).

- [ ] **Step 1: Write the failing tests** (dedup fan-out + 429 backoff)

```ts
import { pollAllSources } from '../../../src/server/services/poll';

test('two series on one feed → the feed is fetched ONCE, both get their new chapter', async () => {
  const s1 = makeSource({ id: 's1', seriesId: 'ser1', type: 'FEED', fetchUrl: FEED, match: { type: 'WHOLE_FEED' } });
  const s2 = makeSource({ id: 's2', seriesId: 'ser2', type: 'FEED', fetchUrl: FEED, match: { type: 'WHOLE_FEED' } });
  let fetches = 0;
  const ports = makePorts({
    sources: [s1, s2],
    fetch: async () => { fetches++; return okFeed([ITEM_A]); }, // helper returning a SUCCESS PoliteResult
    stored: { ser1: [], ser2: [] },
  });
  await pollAllSources(ports, NOW);
  expect(fetches).toBe(1); // ONE fetch for the shared feed
  expect(ports.applied.filter((e) => e.newChapters.length === 1)).toHaveLength(2); // both series diffed it
});

test('429 with Retry-After → every source on the host gets backoffUntil', async () => {
  const s1 = makeSource({ id: 's1', seriesId: 'ser1', fetchUrl: FEED, host: 'h.example' });
  const ports = makePorts({
    sources: [s1],
    fetch: async () => ({ outcome: 'HTTP_4XX', status: 429, retryAfter: '120' }),
    stored: { ser1: [] },
  });
  await pollAllSources(ports, NOW);
  expect(ports.applied[0]!.backoffUntil).toEqual(new Date(NOW.getTime() + 120_000));
});
```

(Add `makePorts`/`okFeed` helpers if absent — `makePorts` records `applied` effects and exposes the injected `fetch`/`renderFetch`, `loadActiveSources`, `loadStoredChapters`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- poll` → FAIL (single-fetch/backoff behavior not present).

- [ ] **Step 3: Implement the refactor**

In `poll.ts`:
- Add `backoffUntil?: Date | null` to `PollEffects`.
- Extract the post-fetch half of `pollSource` (lines that build `newChapters`/`becameFree`/`accessReconciled`/health/etag from a `PoliteResult`) into `processFetched(src: PollableSource, res: PoliteResult, retryAfterAt: Date | null): PollEffects`; set `backoffUntil: retryAfterAt` on the effects.
- Rewrite `pollAllSources`:

```ts
export async function pollAllSources(
  ports: PollPorts & { loadActiveSources: () => Promise<PollableSource[]> },
  now: Date = new Date(),
): Promise<PollEffects[]> {
  const sources = await ports.loadActiveSources();
  // Pre-run per-host aggregates (max lastCheckedAt / backoffUntil across the host's sources).
  const hostLast = new Map<string, Date | null>();
  const hostBackoff = new Map<string, Date | null>();
  for (const s of sources) {
    hostLast.set(s.host, maxDate(hostLast.get(s.host) ?? null, s.lastCheckedAt));
    hostBackoff.set(s.host, maxDate(hostBackoff.get(s.host) ?? null, s.backoffUntil));
  }
  const minIntervalMs = MIN_POLL_INTERVAL_MINUTES * 60_000;
  const effects: PollEffects[] = [];
  for (const group of groupPollSources(sources)) {
    const gate = hostGate({
      hostLastCheckedAt: hostLast.get(group.host) ?? null,
      hostBackoffUntil: hostBackoff.get(group.host) ?? null,
      now, minIntervalMs,
    });
    if (gate.skip) continue; // silent no-op; lastCheckedAt untouched
    const cond = chooseConditionalState(group.sources);
    const fetcher = group.fetchMode === 'RENDER' && ports.renderFetch ? ports.renderFetch : ports.fetch;
    const res = await fetcher(group.fetchUrl, { etag: cond.etag, lastModified: cond.lastModified });
    const retryAfterAt = parseRetryAfter('retryAfter' in res ? res.retryAfter : null, now);
    for (const src of group.sources) {
      const e = await processFetched(src, res, retryAfterAt, ports);
      await ports.applyPollEffects(e);
      effects.push(e);
    }
  }
  return effects;
}
```

Add a `maxDate(a, b)` local helper (returns the later non-null, or null). `processFetched` needs `ports.loadStoredChapters` for the diff, so pass `ports` (or just the loader) into it. Keep `pollSource` as a thin wrapper (`fetch once for one source → processFetched`) if other callers/tests use it; otherwise inline.

In `src/server/services/index.ts` `applyPollEffects`, add `backoffUntil` to the `db.source.update` data when present:
```ts
...(e.backoffUntil !== undefined ? { backoffUntil: e.backoffUntil } : {}),
```

- [ ] **Step 4: Run to verify pass + full unit suite + typecheck**

Run: `npm test` (all unit green) and `npm run typecheck` (clean). Fix any `pollSource` call sites.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/poll.ts src/server/services/index.ts tests/unit/server/poll.test.ts
git commit -m "feat(poll): feed-centric loop — fetch each feed once, fan out, apply backoff"
```

---

### Task 7: Integration test — dedup + politeness against a real DB

**Files:**
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `addSeries`, `pollAllSources`, `db` (existing integration harness + `fetchFrom`/`okRes` helpers).

- [ ] **Step 1: Write the failing/So-far-uncovered test**

```ts
// tests/integration/services.test.ts — new describe
describe('pollAllSources dedup + politeness (real DB)', () => {
  test('two series sharing one feed are fetched once and both advance', async () => {
    // Add two series bound to the SAME site feed with WHOLE_FEED-ish matches whose items
    // are disjoint, so each gets its own new chapter from one fetch.
    // (Build via addSeries with a shared FEED_URL, or direct db inserts of two Series +
    //  Sources with the same feedUrl.) Then:
    let fetches = 0;
    const fetch = ((url: string) => { if (url === FEED_URL) fetches++; return Promise.resolve(okRes(RSS(/* both series' items */))); }) as FetchImpl;
    await pollAllSources(fetch);
    expect(fetches).toBe(1);
    // assert each series now has its expected chapter(s)
  });

  test('a host polled < 15 min ago is skipped (min-interval)', async () => {
    // Seed a source with lastCheckedAt = now-5min; poll; assert its lastCheckedAt did NOT advance
    // and no fetch happened for it.
  });
});
```

Flesh these out using the existing `fetchFrom`/`okRes`/`RSS`/`ITEM` helpers and direct `db` inserts for the two-series-one-feed setup (mirror the `WP-35` real-DB tests' style). Assert fetch count via a counting `FetchImpl`.

- [ ] **Step 2: Run to verify it fails / drives the behavior**

Run: `DATABASE_URL=<…webnovel_test> npm run test:integration -- -t "dedup"`
Expected: FAIL until Task 6's loop is in place (then PASS).

- [ ] **Step 3: Implement** — no new production code; adjust the test setup until it exercises the real dedup/gate paths and passes.

- [ ] **Step 4: Run full integration suite**

Run: `DATABASE_URL=<…webnovel_test> npm run test:integration` → all green.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/services.test.ts
git commit -m "test(poll): dedup + min-interval integration coverage"
```

---

## Notes for the executor

- **Do not** change the health weights or the UA in this WP (out of scope; a separate UA decision is pending).
- The **fast-tier filter** (RENDER off the frequent interval) and the **external trigger** are **WP-43**, not here — WP-42 leaves the daily cron polling everything, just deduped + gated.
- After all tasks: `npm test` + `npm run typecheck` green; run the integration suite once against `webnovel_test`; update PLAN.md (flip WP-42 → DONE, changelog line, set the next `NEXT`).
