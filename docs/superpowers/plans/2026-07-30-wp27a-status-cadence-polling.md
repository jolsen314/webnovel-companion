# WP-27a — Status-gated + cadence polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate polling by reading status — skip COMPLETED/DROPPED/PAUSED, poll PLANNED at most weekly, and notify only READING — reusing `Source.lastCheckedAt` + `Series.status` with no schema change.

**Architecture:** A pure cadence map + `statusPollGate` in `poll.ts` is the single policy home. `loadActiveSources` filters out never-poll statuses at the query and carries `seriesStatus` on each `PollableSource`; the `pollAllSources` loop drops a group's fetch when no source in it is due and processes only the eligible ones. `PollEffects` carries `seriesStatus` so `notifyForEffects` can push for READING only.

**Tech Stack:** TypeScript (strict), Prisma/Postgres, Vitest (unit + integration). Composes with WP-41 (rotation/budget), WP-42 (host gate), WP-43 (tier filter).

## Global Constraints

- **TDD** — failing test first for all logic; watch it fail for the right reason.
- **No schema change / no migration** — reuse `Source.lastCheckedAt` + `Series.status`.
- **Cadence policy (verbatim):** `READING → 0` (every run); `PLANNED → 7*24*60` min (weekly); `PAUSED → null`; `COMPLETED → null`; `DROPPED → null`. `null` = never auto-poll. `POLLABLE_STATUSES` is **derived** from the map (non-null) → `['READING','PLANNED']`.
- **Notify rule (interim):** only `seriesStatus === 'READING'` produces new-chapter + now-free pushes. Source-down left as-is. (Positive PLANNED triggers = WP-27b, later.)
- **`SeriesStatus`** is a string-literal union local to `poll.ts` (no Prisma import): `'READING' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'PLANNED'`.
- **Strict TypeScript, no `any`.** Keep `src/lib/**` untouched (work is in `src/server/**`).
- **Verify before done:** `npm test` + `DATABASE_URL="…webnovel_test" npm run test:integration` + `npm run typecheck`, reading exit codes.
- **Update PLAN.md** when work lands (final task).

---

## File Structure

- `src/server/services/poll.ts` — pure policy (`SeriesStatus`, `STATUS_CADENCE_MINUTES`, `POLLABLE_STATUSES`, `statusPollGate`); `seriesStatus` on `PollableSource` + `PollEffects`; loop eligibility gate; `processFetched` stamps status.
- `src/server/services/index.ts` — `loadActiveSources` query filter + `series.status` include; `rowToPollable` maps it; `notifyForEffects` READING-only filter.
- `tests/unit/server/poll.test.ts` — pure gate tests; loop-gating tests; `source()` helper default.
- `tests/integration/services.test.ts` — real-DB status gating + notify-suppression; `effect()` factory default.
- `PLAN.md` — restructure WP-27 → 27a done + 27b filed; drop summary-seeding.

---

### Task 1: Pure status policy (cadence map + gate)

**Files:**
- Modify: `src/server/services/poll.ts` (add after the WP-43 `sourceTierWhere` block)
- Test: `tests/unit/server/poll.test.ts`

**Interfaces:**
- Produces: `type SeriesStatus`; `POLLABLE_STATUSES: SeriesStatus[]`; `statusPollGate(args: { status: SeriesStatus; lastCheckedAt: Date | null; now: Date }): { skip: boolean; reason: 'ok' | 'status-skip' | 'status-cadence' }`.

- [ ] **Step 1: Write the failing tests**

Add `POLLABLE_STATUSES`, `statusPollGate`, and `type SeriesStatus` to the existing import from `../../../src/server/services/poll` in `tests/unit/server/poll.test.ts`, then append:

```ts
describe('statusPollGate', () => {
  const now = new Date('2026-07-30T12:00:00Z');
  const week = 7 * 24 * 60 * 60_000;

  test('READING is always eligible (cadence 0), even just polled', () => {
    expect(statusPollGate({ status: 'READING', lastCheckedAt: now, now })).toEqual({ skip: false, reason: 'ok' });
  });

  test('COMPLETED / DROPPED / PAUSED never auto-poll → status-skip', () => {
    for (const status of ['COMPLETED', 'DROPPED', 'PAUSED'] as const) {
      expect(statusPollGate({ status, lastCheckedAt: null, now })).toEqual({ skip: true, reason: 'status-skip' });
    }
  });

  test('PLANNED never polled before → eligible', () => {
    expect(statusPollGate({ status: 'PLANNED', lastCheckedAt: null, now })).toEqual({ skip: false, reason: 'ok' });
  });

  test('PLANNED polled 3 days ago (< 7d) → status-cadence skip', () => {
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60_000);
    expect(statusPollGate({ status: 'PLANNED', lastCheckedAt: threeDaysAgo, now })).toEqual({ skip: true, reason: 'status-cadence' });
  });

  test('PLANNED at exactly 7 days → eligible (boundary, strict <)', () => {
    const exactlyWeek = new Date(now.getTime() - week);
    expect(statusPollGate({ status: 'PLANNED', lastCheckedAt: exactlyWeek, now })).toEqual({ skip: false, reason: 'ok' });
  });
});

describe('POLLABLE_STATUSES', () => {
  test('derives to exactly the non-null-cadence statuses', () => {
    expect([...POLLABLE_STATUSES].sort()).toEqual(['PLANNED', 'READING']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/server/poll.test.ts -t "statusPollGate|POLLABLE_STATUSES"`
Expected: FAIL — `statusPollGate is not a function` / `POLLABLE_STATUSES` undefined.

- [ ] **Step 3: Write the minimal implementation**

In `src/server/services/poll.ts` (after the `sourceTierWhere` function):

```ts
/** The reader's shelf status for a series (mirrors the Prisma SeriesStatus enum as a local union
 *  so poll.ts stays Prisma-free). WP-27a. */
export type SeriesStatus = 'READING' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'PLANNED';

/** Minutes between eligible polls per shelf status. 0 = every run; null = never auto-poll
 *  (re-enters only when the reader changes the status, e.g. promote to READING). WP-27a. */
const STATUS_CADENCE_MINUTES: Record<SeriesStatus, number | null> = {
  READING: 0,
  PLANNED: 7 * 24 * 60, // weekly — a plan-to-read backlog doesn't need daily freshness
  PAUSED: null, // on-promote only
  COMPLETED: null,
  DROPPED: null,
};

/** Statuses worth loading for a poll at all — derived from the cadence map (the non-null ones),
 *  so the map stays the single source of truth. Used to pre-filter the active-sources query. */
export const POLLABLE_STATUSES: SeriesStatus[] = (
  ['READING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNED'] as SeriesStatus[]
).filter((s) => STATUS_CADENCE_MINUTES[s] !== null);

/** Whether to skip a source this cycle based on its series' shelf status + cadence. `status-skip`
 *  = the status never auto-polls; `status-cadence` = polled within its cadence window. Pure. WP-27a. */
export function statusPollGate(args: {
  status: SeriesStatus;
  lastCheckedAt: Date | null;
  now: Date;
}): { skip: boolean; reason: 'ok' | 'status-skip' | 'status-cadence' } {
  const cadence = STATUS_CADENCE_MINUTES[args.status];
  if (cadence === null) return { skip: true, reason: 'status-skip' };
  if (cadence === 0) return { skip: false, reason: 'ok' };
  if (args.lastCheckedAt && args.now.getTime() - args.lastCheckedAt.getTime() < cadence * 60_000) {
    return { skip: true, reason: 'status-cadence' };
  }
  return { skip: false, reason: 'ok' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/server/poll.test.ts`
Expected: PASS (all poll unit tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/poll.ts tests/unit/server/poll.test.ts
git commit -m "WP-27a: pure status cadence policy (statusPollGate + POLLABLE_STATUSES)"
```

---

### Task 2: `seriesStatus` on PollableSource + loop eligibility gate

**Files:**
- Modify: `src/server/services/poll.ts` (`PollableSource`, `pollAllSources` loop)
- Modify: `src/server/services/index.ts` (`loadActiveSources`, `rowToPollable`, imports)
- Test: `tests/unit/server/poll.test.ts` (`source()` default + loop tests), `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `statusPollGate`, `POLLABLE_STATUSES`, `SeriesStatus` (Task 1).
- Produces: `PollableSource.seriesStatus: SeriesStatus`; `pollAllSources` skips a group with no due sources and processes only eligible sources.

- [ ] **Step 1: Write the failing tests (unit)**

In `tests/unit/server/poll.test.ts`, first add `seriesStatus: 'READING'` to the `source()` factory's returned object (so every existing test builds a valid, always-eligible source). Then append:

```ts
describe('pollAllSources — status/cadence gate (WP-27a)', () => {
  const NOW = new Date('2026-07-30T12:00:00Z');
  const OVER_A_WEEK = new Date(NOW.getTime() - 8 * 24 * 60 * 60_000);
  const THREE_DAYS = new Date(NOW.getTime() - 3 * 24 * 60 * 60_000);
  const FEED = (h: string) => `https://${h}/rss`;

  test('a solo not-due PLANNED group is not fetched', async () => {
    const s = source({ id: 'p', seriesId: 'serP', host: 'p.example', fetchUrl: FEED('p.example'), seriesStatus: 'PLANNED', lastCheckedAt: THREE_DAYS });
    let fetches = 0;
    const p = multiPorts({ sources: [s], fetch: async () => { fetches++; return ok(RSS('')); }, stored: { serP: [] } });

    const effects = await pollAllSources(p, NOW);

    expect(fetches).toBe(0);
    expect(effects).toEqual([]);
  });

  test('a mixed group [READING, not-due PLANNED] fetches once, processes only READING', async () => {
    const feed = FEED('shared.example');
    const r = source({ id: 'r', seriesId: 'serR', host: 'shared.example', fetchUrl: feed, seriesStatus: 'READING' });
    const pl = source({ id: 'pl', seriesId: 'serPl', host: 'shared.example', fetchUrl: feed, seriesStatus: 'PLANNED', lastCheckedAt: THREE_DAYS });
    let fetches = 0;
    const p = multiPorts({ sources: [r, pl], fetch: async () => { fetches++; return ok(RSS(ITEM('g1', 'https://x/c1'))); }, stored: { serR: [], serPl: [] } });

    await pollAllSources(p, NOW);

    expect(fetches).toBe(1);
    expect(p.applied.map((e) => e.seriesId)).toEqual(['serR']);
  });

  test('a PLANNED source past its weekly window is polled', async () => {
    const s = source({ id: 'p', seriesId: 'serP', host: 'p.example', fetchUrl: FEED('p.example'), seriesStatus: 'PLANNED', lastCheckedAt: OVER_A_WEEK });
    let fetches = 0;
    const p = multiPorts({ sources: [s], fetch: async () => { fetches++; return ok(RSS('')); }, stored: { serP: [] } });

    await pollAllSources(p, NOW);

    expect(fetches).toBe(1);
    expect(p.applied.map((e) => e.seriesId)).toEqual(['serP']);
  });

  test('a due PLANNED deferred by budget is picked up on the next run (not starved)', async () => {
    // Two due sources; a budget that fits only one. Run twice; the one skipped first is polled next.
    const a = source({ id: 'a', seriesId: 'serA', host: 'a.example', fetchUrl: FEED('a.example'), seriesStatus: 'PLANNED', lastCheckedAt: new Date(NOW.getTime() - 9 * 24 * 60 * 60_000) });
    const b = source({ id: 'b', seriesId: 'serB', host: 'b.example', fetchUrl: FEED('b.example'), seriesStatus: 'PLANNED', lastCheckedAt: OVER_A_WEEK });
    let t = 0;
    const clock = () => t;
    const p = multiPorts({ sources: [a, b], fetch: async () => { t += PLAIN_COST_MS; return ok(RSS('')); }, stored: { serA: [], serB: [] } });

    const first = await pollAllSources(p, NOW, { budgetMs: PLAIN_COST_MS, clock });
    expect(first).toHaveLength(1); // only the stalest fit the budget
    const firstId = first[0]!.seriesId;
    const secondId = firstId === 'serA' ? 'serB' : 'serA';

    t = 0; // fresh run
    const second = await pollAllSources(p, NOW, { budgetMs: PLAIN_COST_MS, clock });
    expect(second.map((e) => e.seriesId)).toContain(secondId); // the deferred one is now polled
  });
});
```

*(Note: this reuses the `multiPorts` helper and `source`, `ok`, `RSS`, `ITEM`, `PLAIN_COST_MS` already imported/defined in the file. `multiPorts` sources default `lastCheckedAt: null` via `source()`; the budget test relies on WP-41 rotation ordering the stalest first.)*

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/server/poll.test.ts -t "status/cadence gate"`
Expected: FAIL — before the loop change, the not-due PLANNED group is fetched (fetches=1, not 0) and both mixed sources are processed.

- [ ] **Step 3: Implement — `PollableSource` field + loop gate (poll.ts)**

Add the field to `PollableSource` (near `seriesId`):

```ts
  /** The reader's shelf status (WP-27a) — gates whether/how often this source polls. */
  seriesStatus: SeriesStatus;
```

Replace the group loop body in `pollAllSources` so eligibility is computed first:

```ts
  for (const group of groups) {
    // Status/cadence gate (WP-27a): poll only sources whose shelf status is due; skip the whole
    // group's fetch when none are due (e.g. a solo not-due PLANNED render).
    const eligible = group.sources.filter(
      (s) => !statusPollGate({ status: s.seriesStatus, lastCheckedAt: s.lastCheckedAt, now }).skip,
    );
    if (eligible.length === 0) continue;

    const gate = hostGate({
      hostLastCheckedAt: hostLast.get(group.host) ?? null,
      hostBackoffUntil: hostBackoff.get(group.host) ?? null,
      now,
      minIntervalMs,
    });
    if (gate.skip) continue; // silent no-op; lastCheckedAt untouched

    // Time-budget guard (WP-41).
    if (clock() - start + groupCostMs(group, hasRenderer) > budgetMs) continue;

    const cond = chooseConditionalState(eligible);
    const fetcher = group.fetchMode === 'RENDER' && ports.renderFetch ? ports.renderFetch : ports.fetch;
    const res = await fetcher(group.fetchUrl, { etag: cond.etag, lastModified: cond.lastModified });
    const retryAfterAt = parseRetryAfter(res.retryAfter ?? null, now);

    for (const src of eligible) {
      const e = await processFetched(src, res, retryAfterAt, ports);
      await ports.applyPollEffects(e);
      effects.push(e);
    }
  }
```

- [ ] **Step 4: Implement — wire the edge (index.ts)**

Extend the `./poll` import to add `POLLABLE_STATUSES` and `type SeriesStatus`:

```ts
import { pollAllSources as pollAllCore, sourceTierWhere, POLLABLE_STATUSES, type PollableSource, type PollEffects, type PollPorts, type PollTier, type SeriesStatus } from './poll';
```

In `rowToPollable`, add `series: { status: SeriesStatus }` to the parameter type and map it:

```ts
  series: { status: SeriesStatus };
  // …existing fields…
}): PollableSource {
  return {
    // …existing fields…
    seriesStatus: row.series.status,
  };
}
```

In `pollPorts`, update `loadActiveSources` to filter by status and include it:

```ts
    loadActiveSources: async () =>
      (
        await db.source.findMany({
          where: { ...sourceTierWhere(tier), series: { status: { in: POLLABLE_STATUSES } } },
          include: { series: { select: { status: true } } },
        })
      ).map(rowToPollable),
```

- [ ] **Step 5: Write the failing integration tests**

Append to `tests/integration/services.test.ts` (reuses the WP-43 `seedSource` helper's series-create pattern — extend it to accept a status, or add a local helper):

```ts
describe('pollAllSources status gating (real DB, WP-27a)', () => {
  async function seedStatus(status: 'READING' | 'PLANNED' | 'PAUSED' | 'COMPLETED' | 'DROPPED', host: string, lastCheckedAt: Date | null): Promise<string> {
    const series = await db.series.create({ data: { userId: getCurrentUserId(), title: status, status } });
    await db.source.create({
      data: { seriesId: series.id, url: `https://${host}/rss`, host, type: 'FEED', fetchMode: 'PLAIN', feedUrl: `https://${host}/rss`, matchType: 'WHOLE_FEED', lastCheckedAt },
    });
    return series.id;
  }

  test('COMPLETED / DROPPED / PAUSED are never polled', async () => {
    const ids = {
      completed: await seedStatus('COMPLETED', 'c.example', null),
      dropped: await seedStatus('DROPPED', 'd.example', null),
      paused: await seedStatus('PAUSED', 'pa.example', null),
    };
    const fetch = fetchFrom({}); // any fetch would 404; we assert none happen
    const effects = await pollAllSources(fetch);
    expect(effects).toEqual([]);
    for (const id of Object.values(ids)) {
      const src = await db.source.findFirstOrThrow({ where: { seriesId: id } });
      expect(src.lastCheckedAt).toBeNull();
    }
  });

  test('PLANNED is polled only when past its weekly window', async () => {
    const fresh = await seedStatus('PLANNED', 'fresh.example', new Date(Date.now() - 3 * 24 * 60 * 60_000));
    const stale = await seedStatus('PLANNED', 'stale.example', new Date(Date.now() - 8 * 24 * 60 * 60_000));
    const fetch = fetchFrom({ 'https://stale.example/rss': okRes(RSS('')), 'https://fresh.example/rss': okRes(RSS('')) });
    const effects = await pollAllSources(fetch);
    expect(effects.map((e) => e.seriesId)).toEqual([stale]);
    expect((await db.source.findFirstOrThrow({ where: { seriesId: fresh } })).lastCheckedAt).toBeNull();
  });
});
```

- [ ] **Step 6: Run unit + integration to verify green**

Run: `npx vitest run tests/unit/server/poll.test.ts`
Run: `DATABASE_URL="$(grep -o 'postgresql://[^\"]*webnovel_test' .env | head -1)" npm run test:integration`
Run: `npm run typecheck`
Expected: all PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/poll.ts src/server/services/index.ts tests/unit/server/poll.test.ts tests/integration/services.test.ts
git commit -m "WP-27a: gate polling by series status + weekly PLANNED cadence"
```

---

### Task 3: `seriesStatus` on PollEffects + notify only READING

**Files:**
- Modify: `src/server/services/poll.ts` (`PollEffects`, `processFetched`)
- Modify: `src/server/services/index.ts` (`notifyForEffects`)
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `PollableSource.seriesStatus` (Task 2).
- Produces: `PollEffects.seriesStatus: SeriesStatus`; `notifyForEffects` pushes new-chapter/now-free only for READING.

- [ ] **Step 1: Write the failing integration test**

In `tests/integration/services.test.ts`, first add `seriesStatus: 'READING'` to the `effect()` factory's default object (so existing `notifyForEffects` tests stay valid). Then append inside the `notifyForEffects (real DB)` describe (it has `effect`, `PushSendPorts`, `PushMessage` in scope):

```ts
  test('WP-27a: a non-READING series does not push new chapters or now-free', async () => {
    const readingId = await addAlpha(); // status defaults READING
    const planned = await db.series.create({ data: { userId: getCurrentUserId(), title: 'Planned', status: 'PLANNED' } });
    const captured: PushMessage[] = [];
    const ports: PushSendPorts = {
      loadSubscriptions: async () => [{ endpoint: 'e1', p256dh: 'p', auth: 'a' }],
      send: async (_t, m) => { captured.push(m); return 'SENT'; },
      deleteSubscription: async () => {},
    };

    await notifyForEffects(
      [
        effect({ seriesId: readingId, seriesStatus: 'READING', newChapters: [{ url: 'r1', title: 'R1', access: 'FREE' }] }),
        effect({ seriesId: planned.id, seriesStatus: 'PLANNED', newChapters: [{ url: 'p1', title: 'P1', access: 'FREE' }], becameFree: [{ url: 'p0', access: 'FREE' }] }),
      ],
      [],
      ports,
    );

    // Only the READING series produced a push; the PLANNED one is silent.
    expect(captured.map((m) => m.tag)).toEqual([`new-${readingId}`]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="$(grep -o 'postgresql://[^\"]*webnovel_test' .env | head -1)" npx vitest run --project integration tests/integration/services.test.ts -t "non-READING"`
Expected: FAIL — before the filter, the PLANNED series also pushes (captured has 2+ tags).

- [ ] **Step 3: Implement — `PollEffects` field + stamp (poll.ts)**

Add to the `PollEffects` interface (near `seriesId`):

```ts
  /** The reader's shelf status at poll time (WP-27a) — notify pushes only for READING. */
  seriesStatus: SeriesStatus;
```

In `processFetched`, add to the returned object:

```ts
    seriesId: src.seriesId,
    seriesStatus: src.seriesStatus,
```

- [ ] **Step 4: Implement — READING-only filter (index.ts)**

In `notifyForEffects`, filter both push sources to READING:

```ts
  const newChapters = pollEffects
    .filter((e) => e.seriesStatus === 'READING')
    .map((e) => ({ seriesId: e.seriesId, count: e.newChapters.filter((c) => c.access !== 'LOCKED').length }))
    .filter((n) => n.count > 0);
  const nowFree = pollEffects
    .filter((e) => e.seriesStatus === 'READING' && e.becameFree.length > 0)
    .map((e) => ({ seriesId: e.seriesId, count: e.becameFree.length }));
```

- [ ] **Step 5: Run unit + integration + typecheck**

Run: `npm test`
Run: `DATABASE_URL="$(grep -o 'postgresql://[^\"]*webnovel_test' .env | head -1)" npm run test:integration`
Run: `npm run typecheck`
Expected: all PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/poll.ts src/server/services/index.ts tests/integration/services.test.ts
git commit -m "WP-27a: carry seriesStatus on effects; push only for READING"
```

---

### Task 4: PLAN.md restructure + mark WP-27a done

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Restructure the WP-27 entries**

Read the relevant sections first, then:
- **Active queue:** replace the `WP-27` row (currently `NEXT`) — WP-27a moves to Completed. Set the **new** top-of-queue row to `NEXT`: that is **WP-39** (Prevent duplicate series on add). Add a new **WP-27b** row for per-status positive notify rules (PLANNED paid → 0 LOCKED; PLANNED free → `targetChapterCount`), status `TODO`, `Depends on WP-20, WP-21, WP-13` — place it near WP-21 (its dependency).
- **✅ Completed:** append `· WP-27a (status-gated + cadence polling)`.
- **WP-27 detail section:** retitle to WP-27a; mark done (2026-07-30); state summary-seeding was **dropped** (storage isn't the binding constraint) and per-status notify rules are refiled as WP-27b. Keep the "not pruning stored chapters" note.
- **Current focus:** WP-27a done; NEXT = WP-39.

- [ ] **Step 2: Add a changelog entry (top of Changelog)**

```markdown
- **2026-07-30** — **WP-27a done: status-gated + cadence polling.** Pure `statusPollGate` + `STATUS_CADENCE_MINUTES`
  (READING every run; PLANNED weekly; PAUSED/COMPLETED/DROPPED never) gate `pollAllSources`: COMPLETED/DROPPED/PAUSED
  filtered from `loadActiveSources`, a group with no due source is not fetched, PLANNED polls at most weekly (rolling
  per-source window; WP-41 rotation prioritizes due-and-stale and guarantees deferred pickup). `seriesStatus` rides
  `PollableSource`/`PollEffects`; `notifyForEffects` pushes only for READING (PLANNED polls quietly). No schema change.
  Dropped the WP-27 summary-seeding idea (storage isn't the constraint); refiled per-status notify rules as WP-27b.
  +N unit +M integration tests, typecheck clean.
```

(Resolve `+N`/`+M` to the actual counts added across Tasks 1–3.)

- [ ] **Step 3: Commit**

```bash
git add PLAN.md
git commit -m "WP-27a: mark done in PLAN.md; drop summary-seeding, file WP-27b"
```

---

## Final verification (before marking WP-27a complete)

- [ ] `npm test` — full unit suite green.
- [ ] `DATABASE_URL="$(grep -o 'postgresql://[^\"]*webnovel_test' .env | head -1)" npm run test:integration` — green.
- [ ] `npm run typecheck` — clean.
- [ ] PLAN.md: WP-27a in Completed, WP-27b filed, NEXT = WP-39, changelog present.

## Self-review notes (author)

- **Spec coverage:** cadence map + `statusPollGate` + `POLLABLE_STATUSES` (Task 1) ✓; query filter + `seriesStatus` on `PollableSource` + loop skip/eligible (Task 2) ✓; `PollEffects.seriesStatus` + notify-only-READING (Task 3) ✓; scheduling/defer-pickup behavior tested (Task 2, budget test) ✓; PLANNED weekly + hard-skip integration (Task 2) ✓; summary-seeding dropped / WP-27b filed (Task 4) ✓; no schema change ✓.
- **Type consistency:** `SeriesStatus` defined in Task 1, imported into index.ts in Task 2, used on `PollEffects` in Task 3; `statusPollGate` shape matches the spec; `source()`/`effect()` factories get `seriesStatus: 'READING'` defaults so existing tests stay valid.
- **Placeholder scan:** only `+N`/`+M` in the changelog (Task 4), resolved at execution to actual counts.
- **Green-at-each-commit:** Task 1 is additive; Task 2 adds the required `PollableSource.seriesStatus` and updates its only two constructors (the `source()` test factory + `rowToPollable`) in the same task; Task 3 adds the required `PollEffects.seriesStatus` and updates its only constructor (`processFetched`) + the `effect()` test factory in the same task.
