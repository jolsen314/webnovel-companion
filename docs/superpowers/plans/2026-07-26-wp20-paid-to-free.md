# WP-20 — Paid→free "now free" unlock detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect already-seen chapters flipping `LOCKED → FREE` on a page-watch poll, stamp `becameFreeAt`, and fire a privacy-safe "Now free" push — while storing brand-new *locked* chapters silently.

**Architecture:** Four mostly-additive layers, edges-inward: (1) the pure `diffChapters` gains a `becameFree` output computed from stored-vs-fetched access; (2) `pollSource` threads it into `PollEffects`; (3) the pure `buildPushMessages` gains a `nowFree` category riding the `newChapters` toggle; (4) the Prisma binding persists the unlock (`becameFreeAt`) and maps effects → notifications, suppressing "new chapter" pushes for locked chapters. No DB migration — `Chapter.access` and `Chapter.becameFreeAt` already exist.

**Tech Stack:** TypeScript (strict), Vitest (unit + integration projects), Prisma/Postgres, `cheerio` (page-watch), `web-push`.

## Global Constraints

- **`src/lib/**` stays pure** — no `next`/`prisma`/`fs`/network imports. `diff.ts` and `notify.ts` are `lib/`.
- **TDD** — a failing test first, watched fail for the right reason, then minimal code to green.
- **Verify before done** — `npm test` (unit) + `npm run typecheck` must pass (fresh output) before any "done"/commit.
- **Access values:** `FeedItem.access` / `KnownChapter.access` use `'FREE' | 'LOCKED'` (undefined = unknown). The DB `AccessState` enum is `FREE | LOCKED | UNKNOWN`; map DB `UNKNOWN` → `undefined` at the binding.
- **Notification privacy:** the series title never appears in a message `title` — generic category in `title`, series name in `body` only. (Existing regression test enforces this.)
- **"Now free" copy:** `title` is always `'Now free'`; `body` is `seriesTitle` when `count === 1`, else `` `${seriesTitle} — ${count} now free` ``; `url` = `/series/${seriesId}`; `tag` = `free-${seriesId}`.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit directly to `main` (repo convention).
- **Test commands:** unit `npx vitest run <path>`; integration `npm run test:integration` (needs local Postgres per the repo runbook).

---

### Task 1: `diffChapters` — compute `becameFree` (pure)

**Files:**
- Modify: `src/lib/feeds/diff.ts`
- Test: `tests/unit/feeds/diff.test.ts`

**Interfaces:**
- Consumes: existing `FeedItem` (already has `access?: 'FREE' | 'LOCKED'`), `canonicalUrl` (private in this file).
- Produces:
  - `KnownChapter` gains `access?: 'FREE' | 'LOCKED'`.
  - `DiffResult` gains `becameFree: FeedItem[]` (fetched items, already-seen, whose stored access was `LOCKED` and fetched access is `FREE`).
  - `diffChapters(stored: KnownChapter[], fetched: FeedItem[]): DiffResult` — signature unchanged; `.becameFree` now populated.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/feeds/diff.test.ts` (it already imports `diffChapters`, `FeedItem`, `KnownChapter` — reuse the existing imports; add any missing to the top `import` line):

```ts
describe('diffChapters — becameFree (locked→free unlocks)', () => {
  const stored = (url: string, access?: 'FREE' | 'LOCKED', guid?: string) => ({ url, access, guid });
  const fetchedItem = (url: string, access?: 'FREE' | 'LOCKED', guid?: string): FeedItem => ({ url, title: url, access, guid });

  test('a stored LOCKED chapter now FREE is reported in becameFree (not new)', () => {
    const r = diffChapters([stored('https://x/ch-2', 'LOCKED')], [fetchedItem('https://x/ch-2', 'FREE')]);
    expect(r.new).toEqual([]);
    expect(r.becameFree.map((c) => c.url)).toEqual(['https://x/ch-2']);
  });

  test('unchanged access produces no becameFree (FREE→FREE, LOCKED→LOCKED)', () => {
    const r = diffChapters(
      [stored('https://x/a', 'FREE'), stored('https://x/b', 'LOCKED')],
      [fetchedItem('https://x/a', 'FREE'), fetchedItem('https://x/b', 'LOCKED')],
    );
    expect(r.becameFree).toEqual([]);
  });

  test('UNKNOWN (feed) stored access never counts as an unlock', () => {
    const r = diffChapters([stored('https://x/a', undefined)], [fetchedItem('https://x/a', 'FREE')]);
    expect(r.becameFree).toEqual([]);
  });

  test('a re-lock (stored FREE, fetched LOCKED) is ignored', () => {
    const r = diffChapters([stored('https://x/a', 'FREE')], [fetchedItem('https://x/a', 'LOCKED')]);
    expect(r.becameFree).toEqual([]);
  });

  test('a brand-new locked chapter lands in new, not becameFree', () => {
    const r = diffChapters([], [fetchedItem('https://x/a', 'LOCKED')]);
    expect(r.new.map((c) => c.url)).toEqual(['https://x/a']);
    expect(r.becameFree).toEqual([]);
  });

  test('stored access resolves by guid when the url differs', () => {
    const r = diffChapters(
      [stored('https://x/old', 'LOCKED', 'g1')],
      [fetchedItem('https://x/new', 'FREE', 'g1')],
    );
    expect(r.becameFree.map((c) => c.guid)).toEqual(['g1']);
  });

  test('idempotent: once stored FREE, re-diff yields no becameFree', () => {
    const r = diffChapters([stored('https://x/a', 'FREE')], [fetchedItem('https://x/a', 'FREE')]);
    expect(r.becameFree).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/feeds/diff.test.ts`
Expected: FAIL — `becameFree` is `undefined` (property doesn't exist yet), assertions on `.map` throw / mismatch.

- [ ] **Step 3: Implement `becameFree` in `diff.ts`**

In `src/lib/feeds/diff.ts`:

1. Add `access` to `KnownChapter`:

```ts
/** The minimum needed to recognize an already-seen chapter. */
export interface KnownChapter {
  guid?: string;
  url: string;
  /** Stored access state (page-watch sources). Undefined for feed sources that never tracked locks. */
  access?: 'FREE' | 'LOCKED';
}
```

2. Add `becameFree` to `DiffResult`:

```ts
export interface DiffResult {
  /** Chapters present in the fetch but not yet stored, in fetched order. */
  new: FeedItem[];
  /** Already-seen chapters whose stored access was LOCKED and is now FREE (the "now free" event). */
  becameFree: FeedItem[];
  // Extension point: keep this an object so future diff dimensions attach as new
  // fields without breaking callers — e.g. `disappeared` (for source-health / removal).
}
```

3. Replace the body of `diffChapters` with (adds stored-access lookup + the becameFree scan):

```ts
export function diffChapters(stored: KnownChapter[], fetched: FeedItem[]): DiffResult {
  // Track guids and canonical URLs separately, and treat a chapter as seen if
  // EITHER matches. This keeps identity stable when a feed starts/stops emitting
  // guids, or when a feed source (guid) and a page-watch source (url-only) mix
  // for one series — either recorded key still recognizes the chapter.
  const seenGuids = new Set<string>();
  const seenUrls = new Set<string>();
  // Stored access, so we can spot a LOCKED→FREE unlock on an already-seen chapter.
  const storedAccessByGuid = new Map<string, 'FREE' | 'LOCKED'>();
  const storedAccessByUrl = new Map<string, 'FREE' | 'LOCKED'>();

  const remember = (c: KnownChapter | FeedItem): void => {
    if (c.guid !== undefined) seenGuids.add(c.guid);
    seenUrls.add(canonicalUrl(c.url));
  };
  const isSeen = (c: FeedItem): boolean =>
    (c.guid !== undefined && seenGuids.has(c.guid)) || seenUrls.has(canonicalUrl(c.url));

  for (const c of stored) {
    remember(c);
    if (c.access !== undefined) {
      if (c.guid !== undefined) storedAccessByGuid.set(c.guid, c.access);
      storedAccessByUrl.set(canonicalUrl(c.url), c.access);
    }
  }

  const storedAccessOf = (c: FeedItem): 'FREE' | 'LOCKED' | undefined => {
    if (c.guid !== undefined && storedAccessByGuid.has(c.guid)) return storedAccessByGuid.get(c.guid);
    return storedAccessByUrl.get(canonicalUrl(c.url));
  };

  const fresh: FeedItem[] = [];
  const becameFree: FeedItem[] = [];
  const unlockedUrls = new Set<string>(); // guard against a duplicated fetched row double-counting
  for (const item of fetched) {
    if (isSeen(item)) {
      const key = canonicalUrl(item.url);
      if (item.access === 'FREE' && storedAccessOf(item) === 'LOCKED' && !unlockedUrls.has(key)) {
        unlockedUrls.add(key);
        becameFree.push(item);
      }
      continue; // already stored, or a duplicate earlier in this batch
    }
    remember(item);
    fresh.push(item);
  }
  return { new: fresh, becameFree };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/feeds/diff.test.ts`
Expected: PASS (the new `becameFree` describe block + all pre-existing diff tests still green).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (0 errors). `KnownChapter.access` is optional, so existing constructors still compile.

- [ ] **Step 6: Commit**

```bash
git add src/lib/feeds/diff.ts tests/unit/feeds/diff.test.ts
git commit -m "$(cat <<'EOF'
WP-20: diffChapters detects LOCKED→FREE unlocks (becameFree)

KnownChapter gains stored access; DiffResult gains becameFree — already-seen
chapters whose stored access was LOCKED and is now FREE. Resolves stored
access by guid-then-url; UNKNOWN/feed and re-locks produce nothing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `pollSource` — thread `becameFree` into `PollEffects`

**Files:**
- Modify: `src/server/services/poll.ts`
- Modify: `tests/integration/services.test.ts` (the `effect()` PollEffects factory — add the new required field so typecheck stays green)
- Test: `tests/unit/server/poll.test.ts`

**Interfaces:**
- Consumes: `diffChapters(...).becameFree` from Task 1.
- Produces: `PollEffects` gains `becameFree: FeedItem[]` (required). `pollSource`/`pollAllSources` signatures unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/server/poll.test.ts` inside the top-level `describe('pollSource', ...)` block (reuse the file's existing `source`, `ports`, `ok`, and `toc` helpers). Note `ports(...)`'s second arg is the stored chapters — now `KnownChapter` carries `access`:

```ts
  test('PAGE_WATCH: a stored LOCKED chapter now FREE in the TOC is reported in becameFree', async () => {
    const tocHtml = `<ul>
      <li><a href="https://x.example/novel/a/chapter-1/">Chapter 1</a></li>
      <li><a href="https://x.example/novel/a/chapter-2/">Chapter 2</a></li>
    </ul>`;
    const p = ports(ok(tocHtml), [{ url: 'https://x.example/novel/a/chapter-2/', access: 'LOCKED' }]);

    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchUrl: 'https://x.example/novel/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );

    expect(effects.newChapters.map((c) => c.url)).toEqual(['https://x.example/novel/a/chapter-1/']);
    expect(effects.becameFree.map((c) => c.url)).toEqual(['https://x.example/novel/a/chapter-2/']);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/server/poll.test.ts`
Expected: FAIL — `effects.becameFree` is `undefined` (`.map` throws) / property missing on `PollEffects`.

- [ ] **Step 3: Add `becameFree` to `PollEffects` and populate it**

In `src/server/services/poll.ts`:

1. Add the field to the `PollEffects` interface (right after `newChapters`):

```ts
  newChapters: FeedItem[];
  /** Already-seen chapters that flipped LOCKED→FREE this poll (the "now free" event). */
  becameFree: FeedItem[];
```

2. In `pollSource`, add a `becameFree` accumulator and read it from the diff. Change the declarations near the top of the function:

```ts
  let newChapters: FeedItem[] = [];
  let becameFree: FeedItem[] = [];
  let notModified = false;
```

3. Replace the diff line inside the `if (res.outcome === 'SUCCESS') { if (!notModified) {...} }` block:

```ts
      const stored = await ports.loadStoredChapters(src.seriesId);
      const diff = diffChapters(stored, mine);
      newChapters = diff.new;
      becameFree = diff.becameFree;
```

4. Add `becameFree` to the `effects` object literal (right after `newChapters`):

```ts
    newChapters,
    becameFree,
```

- [ ] **Step 4: Keep `tests/integration/services.test.ts` typecheck-green**

In `tests/integration/services.test.ts`, the `effect()` factory (~line 231) builds a `PollEffects` literal. Add the new required field so it compiles — insert after the `newChapters: [],` line:

```ts
    newChapters: [],
    becameFree: [],
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npx vitest run tests/unit/server/poll.test.ts`
Expected: PASS (new test + all pre-existing pollSource tests green — the 304 / failure paths leave `becameFree` at `[]`).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean — the integration `effect()` factory now supplies `becameFree`.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/poll.ts tests/unit/server/poll.test.ts tests/integration/services.test.ts
git commit -m "$(cat <<'EOF'
WP-20: pollSource threads becameFree into PollEffects

pollSource reads diffChapters().becameFree and surfaces it on PollEffects
(empty on 304/failure/feed polls). Integration effect() factory updated for
the new required field.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `buildPushMessages` — the "Now free" category (pure)

**Files:**
- Modify: `src/lib/notify.ts`
- Test: `tests/unit/notify.test.ts`

**Interfaces:**
- Consumes: existing `PushPrefs` (the `newChapters` toggle gates now-free too), `seriesTitle` resolver.
- Produces: `NotifyInput` gains `nowFree?: { seriesId: string; count: number }[]` (optional — omitted → none, keeps existing callers compiling). `buildPushMessages` emits "Now free" messages between the new-chapter and scheduled categories, gated by `push.newChapters`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/notify.test.ts` (reuse the file's `base` helper and `titles`):

```ts
describe('buildPushMessages — now free (WP-20)', () => {
  test('a single unlock: "Now free" title, work name only in the body', () => {
    const msgs = buildPushMessages(base({ nowFree: [{ seriesId: 's1', count: 1 }] }));
    expect(msgs).toEqual([
      { title: 'Now free', body: 'Silver Moon Saga', url: '/series/s1', tag: 'free-s1' },
    ]);
  });

  test('multiple unlocks digest the count in the body', () => {
    const msgs = buildPushMessages(base({ nowFree: [{ seriesId: 's2', count: 3 }] }));
    expect(msgs[0]!.body).toBe('Cannon Fodder — 3 now free');
  });

  test('a zero/negative count produces no now-free message', () => {
    expect(buildPushMessages(base({ nowFree: [{ seriesId: 's1', count: 0 }] }))).toEqual([]);
  });

  test('now-free rides the newChapters toggle — off suppresses it', () => {
    const msgs = buildPushMessages(
      base({ nowFree: [{ seriesId: 's1', count: 1 }], push: { newChapters: false, scheduledReleases: true, sourcesDown: true } }),
    );
    expect(msgs).toEqual([]);
  });

  test('privacy: the work title never appears in a now-free title', () => {
    const msgs = buildPushMessages(base({ nowFree: [{ seriesId: 's1', count: 2 }] }));
    for (const m of msgs) expect(m.title).not.toContain('Silver Moon Saga');
  });

  test('category order: new chapters → now free → scheduled → down', () => {
    const msgs = buildPushMessages(
      base({
        sourcesDown: [{ seriesId: 's3', host: 'reader.example' }],
        scheduledReleases: [{ seriesId: 's2', eventKind: 'UNLOCKED' }],
        nowFree: [{ seriesId: 's2', count: 1 }],
        newChapters: [{ seriesId: 's1', count: 2 }],
      }),
    );
    expect(msgs.map((m) => m.tag)).toEqual(['new-s1', 'free-s2', 'sched-s2', 'down-s3']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/notify.test.ts`
Expected: FAIL — `nowFree` isn't a known `NotifyInput` field (type error) and no "Now free" messages are produced.

- [ ] **Step 3: Add the `nowFree` category to `notify.ts`**

In `src/lib/notify.ts`:

1. Add the field to `NotifyInput` (after `newChapters`):

```ts
  newChapters: { seriesId: string; count: number }[];
  /** Chapters that just became free (WP-20). Rides the newChapters push toggle. */
  nowFree?: { seriesId: string; count: number }[];
```

2. In `buildPushMessages`, immediately AFTER the existing `for (const { seriesId, count } of push.newChapters ? input.newChapters : [])` loop and BEFORE the `scheduledReleases` loop, add:

```ts
  // "Now free": a confirmed locked→free unlock (distinct from the predicted scheduled UNLOCKED).
  // Rides the newChapters toggle — it's new readable content. Series name stays in the body only.
  for (const { seriesId, count } of push.newChapters ? (input.nowFree ?? []) : []) {
    if (count <= 0) continue;
    messages.push({
      title: 'Now free',
      body: count === 1 ? seriesTitle(seriesId) : `${seriesTitle(seriesId)} — ${count} now free`,
      url: `/series/${seriesId}`,
      tag: `free-${seriesId}`,
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/notify.test.ts`
Expected: PASS (new now-free block + all pre-existing notify tests, including the "new → scheduled → down" order test which has no `nowFree` input).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean — `nowFree` is optional, so `notifyForEffects` (not yet passing it) still compiles.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notify.ts tests/unit/notify.test.ts
git commit -m "$(cat <<'EOF'
WP-20: buildPushMessages emits a "Now free" category

NotifyInput.nowFree (optional) → a per-series "Now free" push, placed between
new-chapters and scheduled, gated by the newChapters toggle. Series name kept
out of the title (privacy).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Binding — persist the unlock + wire notifications (`index.ts`) + integration

**Files:**
- Modify: `src/server/services/index.ts`
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: `PollEffects.becameFree` (Task 2), `NotifyInput.nowFree` (Task 3), Prisma `db.chapter` (`access`, `becameFreeAt` columns).
- Produces: `loadStoredChapters` returns stored `access`; `applyPollEffects` stamps `becameFreeAt`/`access=FREE` on unlocked rows; `notifyForEffects` builds `nowFree` and excludes `LOCKED` new chapters from the new-chapter push.

- [ ] **Step 1: Write the failing integration tests**

Append to `tests/integration/services.test.ts` inside the existing `describe('page-watch source (real DB)', ...)` block (reuse its `WATCH_URL`, `W1`, `W2`, `TOC`, `ROW`, and the file's `okRes`/`fetchFrom`). These drive the full add → poll → persist → notify path:

```ts
  test('WP-20: a stored LOCKED chapter turning FREE stamps becameFreeAt and does not re-fire', async () => {
    // Add with W1 free, W2 locked.
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2, true))) }));

    // Next poll: W2 is now free.
    const effects = await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }));
    expect(effects[0]!.becameFree.map((c) => c.url)).toEqual([W2]);
    expect(effects[0]!.newChapters).toEqual([]);

    const w2 = await db.chapter.findFirstOrThrow({ where: { seriesId, url: W2 } });
    expect(w2.access).toBe('FREE');
    expect(w2.becameFreeAt).not.toBeNull();

    // A subsequent identical poll must not re-detect it (already FREE in storage).
    const again = await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }));
    expect(again[0]!.becameFree).toEqual([]);
  });
```

And append to the `describe('notifyForEffects (real DB)', ...)` block (reuse its `effect()` factory and `captureAll()` helper):

```ts
  test('WP-20: becameFree → a "Now free" push; a locked-only new chapter is not pushed', async () => {
    const seriesId = await addAlpha(); // title "Alpha"
    const { ports, captured } = captureAll();

    await notifyForEffects(
      [
        effect({
          seriesId,
          becameFree: [{ url: 'u-unlocked', title: 'C2', access: 'FREE' }],
          newChapters: [{ url: 'u-locked', title: 'C3', access: 'LOCKED' }],
        }),
      ],
      [],
      ports,
    );

    // Only the unlock is pushed; the new *locked* chapter is stored-silently (no new-chapter push).
    expect(captured.map((m) => ({ title: m.title, body: m.body, tag: m.tag }))).toEqual([
      { title: 'Now free', body: 'Alpha', tag: `free-${seriesId}` },
    ]);
  });

  test('WP-20: a new FREE chapter still pushes as a normal new chapter', async () => {
    const seriesId = await addAlpha();
    const { ports, captured } = captureAll();

    await notifyForEffects([effect({ seriesId, newChapters: [{ url: 'u', title: 'C', access: 'FREE' }] })], [], ports);

    expect(captured.map((m) => m.title)).toEqual(['New chapter']);
  });
```

- [ ] **Step 2: Run the integration tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — `becameFreeAt` never set (stays null); the "Now free" message isn't produced; the locked new chapter still pushes a "New chapter". (If the integration DB isn't running, start it per the repo runbook first — the failure must be an assertion failure, not a connection error.)

- [ ] **Step 3: Return stored `access` from `loadStoredChapters`**

In `src/server/services/index.ts`, update the `loadStoredChapters` port (~line 94) to select and map `access` (DB `UNKNOWN` → `undefined`):

```ts
    loadStoredChapters: async (seriesId) =>
      (await db.chapter.findMany({ where: { seriesId }, select: { guid: true, url: true, access: true } })).map((c) => ({
        guid: c.guid ?? undefined,
        url: c.url,
        access: c.access === 'UNKNOWN' ? undefined : c.access,
      })),
```

- [ ] **Step 4: Persist the unlock in `applyPollEffects`**

In the same file, inside `applyPollEffects`'s `db.$transaction([ ... ])` array, add unlock updates AFTER the `createMany` block (still inside the array). Each unlocked row gets `access=FREE` + `becameFreeAt=now`, guarded so it never overwrites an earlier unlock time:

```ts
        ...e.becameFree.map((c) =>
          db.chapter.updateMany({
            where: { seriesId: e.seriesId, url: c.url, becameFreeAt: null },
            data: { access: 'FREE' as const, becameFreeAt: now },
          }),
        ),
```

- [ ] **Step 5: Wire `nowFree` + locked-suppression into `notifyForEffects`**

In the same file, in `notifyForEffects` (~line 252): change the `newChapters` mapping to exclude LOCKED, add a `nowFree` mapping, include its ids in the title resolver, and pass `nowFree` to `buildPushMessages`.

Replace the `newChapters` const:

```ts
  const newChapters = pollEffects
    .map((e) => ({ seriesId: e.seriesId, count: e.newChapters.filter((c) => c.access !== 'LOCKED').length }))
    .filter((n) => n.count > 0);
  const nowFree = pollEffects
    .filter((e) => e.becameFree.length > 0)
    .map((e) => ({ seriesId: e.seriesId, count: e.becameFree.length }));
```

Add `nowFree` ids to the `seriesTitleResolver([...])` call:

```ts
  const seriesTitle = await seriesTitleResolver([
    ...newChapters.map((n) => n.seriesId),
    ...nowFree.map((n) => n.seriesId),
    ...scheduledReleases.map((s) => s.seriesId),
    ...sourcesDown.map((s) => s.seriesId),
  ]);
```

Pass `nowFree` into `buildPushMessages`:

```ts
  const messages = buildPushMessages({
    seriesTitle,
    newChapters,
    nowFree,
    scheduledReleases,
    sourcesDown,
    push: {
      newChapters: prefs.pushNewChapter,
      scheduledReleases: prefs.pushScheduled,
      sourcesDown: prefs.pushSourceDown,
    },
  });
```

- [ ] **Step 6: Run the integration tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS (the two new page-watch/notify WP-20 tests + all pre-existing integration tests green).

- [ ] **Step 7: Full verification**

Run: `npm test` (unit) then `npm run typecheck`
Expected: unit suite green, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/index.ts tests/integration/services.test.ts
git commit -m "$(cat <<'EOF'
WP-20: persist unlocks + wire "Now free" notifications

loadStoredChapters returns stored access; applyPollEffects stamps
becameFreeAt/access=FREE on unlocked rows; notifyForEffects maps becameFree →
nowFree and excludes LOCKED new chapters from the new-chapter push (store
silently, notify on unlock).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Close out WP-20 in the plan

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Flip status + changelog**

In `PLAN.md`:
- Work-package index: set **WP-20** status `TODO` → `DONE`.
- "Current focus": update `NEXT` to the next queued item (**WP-29 editor UI**, or the next owner-chosen WP — confirm at the WP boundary).
- Add a Changelog entry dated 2026-07-26 summarizing WP-20 (per-chapter LOCKED→FREE detection; `becameFreeAt` persistence; "Now free" push riding the newChapters toggle; new-locked chapters stored silently; no migration). Note what stays open: WP-27 status rules, the per-series "notify on new locked" opt-in, lock-detection tuning against a real locked TOC.

- [ ] **Step 2: Commit**

```bash
git add PLAN.md
git commit -m "$(cat <<'EOF'
plan: WP-20 DONE — "now free" unlock detection landed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Layer 1 (diff `becameFree`, `KnownChapter.access`, non-events) → Task 1. ✓
- Layer 2 (`PollEffects.becameFree`, `pollSource` threads it) → Task 2. ✓
- Layer 3 (`nowFree` category, copy, gated by newChapters) → Task 3. ✓
- Layer 4 persistence (`loadStoredChapters` access, `applyPollEffects` becameFreeAt guard) → Task 4 Steps 3–4. ✓
- Layer 4 notify (nowFree map, LOCKED-suppression) → Task 4 Step 5. ✓
- Edge cases (UNKNOWN, re-lock, idempotency, new-FREE) → Task 1 tests + Task 4 integration. ✓
- No migration → confirmed (columns exist; used only). ✓
- Privacy (title never carries series name) → Task 3 test. ✓
- Out-of-scope (WP-27 rules, per-series opt-in, stored frontier) → not built; noted in Task 5. ✓

**Placeholder scan:** none — every code/test step shows concrete code and exact run commands.

**Type consistency:** `becameFree: FeedItem[]` (Task 1 `DiffResult` → Task 2 `PollEffects` → Task 4 consumption); `access?: 'FREE' | 'LOCKED'` consistent across `KnownChapter`/`FeedItem`; DB `UNKNOWN`→`undefined` mapping only at the binding (Task 4 Step 3); `nowFree: { seriesId; count }[]` identical in Task 3 (`NotifyInput`) and Task 4 (mapping). Copy strings (`'Now free'`, `free-${id}`) match between Task 3 and the Task 4 integration assertions.
