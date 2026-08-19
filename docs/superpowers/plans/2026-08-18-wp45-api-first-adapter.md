# WP-45 API-first adapter (plain-REST slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a source be tracked by reading its chapter data API (JSON) directly — complete chapter list with per-chapter access — instead of headless render + DOM scrape, for the plain public REST shape (render-eliminating).

**Architecture:** An API source is a "TOC delivered as JSON." A pure parser turns the API body into the existing `TocChapter[]` shape, so the existing `diffChapters` / "now free" / notify machinery is untouched. Two orthogonal schema axes stay orthogonal: `type` (`FEED | PAGE_WATCH | API`, how to parse) and `fetchMode` (`PLAIN | RENDER`, how to transport). No new fetch port — the API GET reuses the existing `fetch` port, so health tracking, etag/304 conditional-GET, staleness, and grouping all keep working. Discovery is a generic add-time auto-probe plus a manual CLI escape hatch for endpoints the page doesn't advertise.

**Tech Stack:** TypeScript (strict), Next.js App Router, Prisma + Postgres, Vitest (unit + integration), `tsx` for CLI scripts.

**Spec:** [docs/superpowers/specs/2026-08-18-wp45-api-first-adapter-design.md](../specs/2026-08-18-wp45-api-first-adapter-design.md)

## Global Constraints

- **`src/lib/**` stays pure and Next-free** — no `next` / `prisma` / `fs` / network imports. The two new modules (`apiAdapter.ts`, `apiProbe.ts`) are pure; fetching happens at the edge via injected ports.
- **TDD for all `lib/` logic and service logic** — failing test first, watch it fail for the right reason, then minimal implementation.
- **Verify before "done"** — `npm test` + `npm run typecheck` with fresh output in the same message before any completion claim.
- **Anonymity** — no real site names, hostnames, or series names in committed code, tests, or docs. Tests use `*.example` hosts. The CLI takes the endpoint/map as arguments, never hardcoded.
- **Additive schema only** — a new enum value + two nullable columns; no changes to existing columns.
- **Defer `freeAt`** — consume per-chapter `isFree` only; do not add a `Chapter.freeAt` column this WP.

---

### Task 1: Schema — `API` source type + `apiUrl` / `apiMap` columns

**Files:**
- Modify: `prisma/schema.prisma:27-30` (enum `SourceType`), `prisma/schema.prisma:145-150` (model `Source`)
- Create: `prisma/migrations/<timestamp>_wp45_api_source/migration.sql` (generated)

**Interfaces:**
- Produces: `SourceType.API` enum value; `Source.apiUrl String?`; `Source.apiMap Json?`. Later tasks persist/read these.

- [ ] **Step 1: Add the enum value and columns**

In `prisma/schema.prisma`, extend the enum:

```prisma
enum SourceType {
  FEED
  PAGE_WATCH
  API // WP-45: read a chapter data API (JSON) directly instead of render + DOM scrape
}
```

In `model Source`, add after the `tocUrl` block (around `schema.prisma:150`):

```prisma
  // WP-45: API-first source. `apiUrl` is the chapter-data endpoint (fetched in place of the
  // page); `apiMap` is the per-source field descriptor (see lib/feeds/apiAdapter.ts ApiDescriptor).
  apiUrl String?
  apiMap Json?
```

- [ ] **Step 2: Generate the migration against the local dev DB**

Run: `npx prisma migrate dev --name wp45_api_source`
Expected: a new migration under `prisma/migrations/` adding the enum value + two nullable columns; Prisma Client regenerated.

(The local dev DB is `webnovel_dev` per `.env`. Do **not** point this at prod.)

- [ ] **Step 3: Verify the client typechecks**

Run: `npm run typecheck`
Expected: PASS — the generated `$Enums.SourceType` now includes `API` and `Source` has `apiUrl`/`apiMap`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(wp-45): schema — API source type + apiUrl/apiMap columns"
```

---

### Task 2: `parseApiChapters` pure adapter

**Files:**
- Create: `src/lib/feeds/apiAdapter.ts`
- Test: `tests/unit/feeds/apiAdapter.test.ts`

**Interfaces:**
- Consumes: `parseChapterNumber` from `./parse`; `TocChapter` / `ChapterAccess` from `./pageWatch`.
- Produces:
  - `type ApiDescriptor = { listPath?: string; urlField: string; numberField?: string; titleField: string; isFreeField?: string; isFreeWhen?: 'truthy' | 'falsy' }`
  - `function parseApiChapters(body: string, descriptor: ApiDescriptor, baseUrl: string): TocChapter[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/feeds/apiAdapter.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { parseApiChapters, type ApiDescriptor } from '../../../src/lib/feeds/apiAdapter';

const BASE = 'https://api.example/works/1/chapters';

describe('parseApiChapters', () => {
  const map: ApiDescriptor = {
    listPath: 'data.chapters',
    urlField: 'link',
    numberField: 'num',
    titleField: 'title',
    isFreeField: 'free',
  };

  test('nested listPath → chapters with access from isFree', () => {
    const body = JSON.stringify({
      data: {
        chapters: [
          { num: 1, title: 'Ch 1: Start', link: 'https://api.example/read/1', free: true },
          { num: 2, title: 'Ch 2: Next', link: 'https://api.example/read/2', free: false },
        ],
      },
    });
    expect(parseApiChapters(body, map, BASE)).toEqual([
      { url: 'https://api.example/read/1', title: 'Ch 1: Start', number: 1, access: 'FREE' },
      { url: 'https://api.example/read/2', title: 'Ch 2: Next', number: 2, access: 'LOCKED' },
    ]);
  });

  test('root array + no isFreeField → all FREE', () => {
    const body = JSON.stringify([{ title: 'Ch 5: X', link: '/read/5' }]);
    const rootMap: ApiDescriptor = { urlField: 'link', titleField: 'title' };
    expect(parseApiChapters(body, rootMap, BASE)).toEqual([
      { url: 'https://api.example/read/5', title: 'Ch 5: X', number: 5, access: 'FREE' },
    ]);
  });

  test("isFreeWhen 'falsy' inverts a `locked` field", () => {
    const body = JSON.stringify([{ n: 3, t: 'Ch 3', u: '/r/3', locked: true }]);
    const lockedMap: ApiDescriptor = {
      urlField: 'u', numberField: 'n', titleField: 't', isFreeField: 'locked', isFreeWhen: 'falsy',
    };
    expect(parseApiChapters(body, lockedMap, BASE)[0].access).toBe('LOCKED');
  });

  test('number falls back to the title, then tolerates decimals and missing numbers', () => {
    const body = JSON.stringify([
      { title: 'Chapter 12.5: Interlude', link: '/r/a' },
      { title: 'Prologue', link: '/r/b' },
    ]);
    const m: ApiDescriptor = { urlField: 'link', titleField: 'title' };
    const out = parseApiChapters(body, m, BASE);
    expect(out[0].number).toBe(12.5);
    expect(out[1].number).toBeNull();
  });

  test('relative urlField resolved absolute against the endpoint origin', () => {
    const body = JSON.stringify([{ title: 'Ch 1', link: '/read/rel' }]);
    const m: ApiDescriptor = { urlField: 'link', titleField: 'title' };
    expect(parseApiChapters(body, m, BASE)[0].url).toBe('https://api.example/read/rel');
  });

  test('shape drift (missing listPath / non-array / bad JSON) → [] and never throws', () => {
    const m: ApiDescriptor = { listPath: 'nope.here', urlField: 'link', titleField: 'title' };
    expect(parseApiChapters('{}', m, BASE)).toEqual([]);
    expect(parseApiChapters('not json', m, BASE)).toEqual([]);
    expect(parseApiChapters(JSON.stringify({ nope: { here: 42 } }), m, BASE)).toEqual([]);
  });

  test('items missing the url field are skipped', () => {
    const body = JSON.stringify([{ title: 'Ch 1' }, { title: 'Ch 2', link: '/r/2' }]);
    const m: ApiDescriptor = { urlField: 'link', titleField: 'title' };
    expect(parseApiChapters(body, m, BASE).map((c) => c.url)).toEqual(['https://api.example/r/2']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- apiAdapter`
Expected: FAIL — `parseApiChapters` is not defined.

- [ ] **Step 3: Implement the adapter**

Create `src/lib/feeds/apiAdapter.ts`:

```ts
import { parseChapterNumber } from './parse';
import type { TocChapter } from './pageWatch';

/**
 * WP-45: read a source's chapter data API (JSON) directly. An API returns the COMPLETE
 * chapter list with lock state — TOC semantics — so this parser emits the same `TocChapter[]`
 * the page-watch path produces, and the diff / "now free" machinery downstream is untouched.
 * Pure (JSON string → chapters); the fetch lives in the injected port. The descriptor is
 * per-source (stored on Source.apiMap), so no site-specific code lives here.
 */
export interface ApiDescriptor {
  /** Dot-path to the chapter array in the JSON (e.g. "data.chapters"). Absent → the root is the array. */
  listPath?: string;
  /** Item key/path → chapter url or permalink (resolved absolute against the endpoint origin). */
  urlField: string;
  /** Item key/path → chapter number. Absent/non-numeric → parsed from the title, then the url. */
  numberField?: string;
  /** Item key/path → chapter title. */
  titleField: string;
  /** Item key/path → free/locked flag. Absent → every chapter is FREE (e.g. a static JSON file). */
  isFreeField?: string;
  /** How to read `isFreeField`: 'truthy' (default) = "is free"; 'falsy' = the field is `locked` (inverse). */
  isFreeWhen?: 'truthy' | 'falsy';
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function toBool(v: unknown): boolean {
  if (typeof v === 'string') return !['', '0', 'false', 'no'].includes(v.trim().toLowerCase());
  return Boolean(v);
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const fromTitle = parseChapterNumber(v);
    if (fromTitle !== null) return fromTitle;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseApiChapters(body: string, descriptor: ApiDescriptor, baseUrl: string): TocChapter[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const list = descriptor.listPath ? getPath(parsed, descriptor.listPath) : parsed;
  if (!Array.isArray(list)) return [];

  const chapters: TocChapter[] = [];
  for (const item of list) {
    if (item == null || typeof item !== 'object') continue;
    const rawUrl = getPath(item, descriptor.urlField);
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') continue;
    let url: string;
    try {
      url = new URL(rawUrl, baseUrl).toString();
    } catch {
      continue;
    }
    const titleVal = getPath(item, descriptor.titleField);
    const title = typeof titleVal === 'string' ? titleVal.replace(/\s+/g, ' ').trim() : '';
    const number =
      (descriptor.numberField ? coerceNumber(getPath(item, descriptor.numberField)) : null) ??
      parseChapterNumber(title) ??
      parseChapterNumber(url);

    let free = true;
    if (descriptor.isFreeField != null) {
      const flag = toBool(getPath(item, descriptor.isFreeField));
      free = descriptor.isFreeWhen === 'falsy' ? !flag : flag;
    }
    chapters.push({ url, title, number, access: free ? 'FREE' : 'LOCKED' });
  }
  return chapters;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- apiAdapter`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/feeds/apiAdapter.ts tests/unit/feeds/apiAdapter.test.ts
git commit -m "feat(wp-45): parseApiChapters — JSON chapter API → TocChapter[]"
```

---

### Task 3: `probeForApi` generic auto-probe

**Files:**
- Create: `src/lib/feeds/apiProbe.ts`
- Test: `tests/unit/feeds/apiProbe.test.ts`

**Interfaces:**
- Consumes: `ApiDescriptor` from `./apiAdapter`.
- Produces: `function probeForApi(html: string, baseUrl: string): { apiUrl: string; descriptor: ApiDescriptor } | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/feeds/apiProbe.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { probeForApi } from '../../../src/lib/feeds/apiProbe';

const BASE = 'https://spa.example/series/alpha';

describe('probeForApi', () => {
  test('a shell pointing at a .json data file → descriptor with the resolved absolute apiUrl', () => {
    const html = `<html><body><div id="app" data-title="/data/alpha.json"></div></body></html>`;
    const hit = probeForApi(html, BASE);
    expect(hit).not.toBeNull();
    expect(hit!.apiUrl).toBe('https://spa.example/data/alpha.json');
    expect(hit!.descriptor.urlField).toBeTruthy();
    expect(hit!.descriptor.titleField).toBeTruthy();
  });

  test('a page with no JSON-data signal → null', () => {
    const html = `<html><body><a href="/chapter-1">Ch 1</a></body></html>`;
    expect(probeForApi(html, BASE)).toBeNull();
  });

  test('a data attribute that is not JSON → null (no false positive)', () => {
    const html = `<html><body><div data-title="Alpha Novel"></div></body></html>`;
    expect(probeForApi(html, BASE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- apiProbe`
Expected: FAIL — `probeForApi` is not defined.

- [ ] **Step 3: Implement the probe**

Create `src/lib/feeds/apiProbe.ts`:

```ts
import * as cheerio from 'cheerio';
import type { ApiDescriptor } from './apiAdapter';

/**
 * WP-45: generic, host-agnostic detection of a chapter data API advertised by the page.
 * No site names — an ordered list of signal detectors; each returns an endpoint + descriptor,
 * or the probe returns null and the normal add-time ladder runs. Pure (HTML → descriptor?).
 *
 * Detector 1 (static-JSON SPA): a shell element points at a `.json` data file via a `data-*`
 * attribute (the 2026-07-30 Cloudflare-Pages case). Conservative: only fires on a clear
 * `.json` pointer.
 */
export interface ApiProbeHit {
  apiUrl: string;
  descriptor: ApiDescriptor;
}

/** The descriptor for the static-JSON SPA shape: a flat array of {title, url}, no lock state. */
const STATIC_JSON_DESCRIPTOR: ApiDescriptor = {
  urlField: 'url',
  titleField: 'title',
};

function detectStaticJson(html: string, baseUrl: string): ApiProbeHit | null {
  const $ = cheerio.load(html);
  let hit: ApiProbeHit | null = null;
  $('*').each((_, el) => {
    if (hit) return;
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
    for (const [name, value] of Object.entries(attribs)) {
      if (!name.startsWith('data-')) continue;
      if (typeof value !== 'string' || !/\.json(\?|$)/i.test(value.trim())) continue;
      try {
        hit = { apiUrl: new URL(value.trim(), baseUrl).toString(), descriptor: STATIC_JSON_DESCRIPTOR };
      } catch {
        // ignore an unparseable pointer and keep scanning
      }
      if (hit) return;
    }
  });
  return hit;
}

const DETECTORS: Array<(html: string, baseUrl: string) => ApiProbeHit | null> = [detectStaticJson];

export function probeForApi(html: string, baseUrl: string): ApiProbeHit | null {
  for (const detect of DETECTORS) {
    const hit = detect(html, baseUrl);
    if (hit) return hit;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- apiProbe`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feeds/apiProbe.ts tests/unit/feeds/apiProbe.test.ts
git commit -m "feat(wp-45): probeForApi — generic add-time chapter-API detection"
```

---

### Task 4: Add-time wiring — probe first, resolve an API source

**Files:**
- Modify: `src/server/services/addSeries.ts` (`ResolvedSource`/`ResolvedCore` type, `resolveFrom`, the three existing `ResolvedCore` literals)
- Modify: `src/server/services/index.ts:393-429` (`createSeries` persistence)
- Test: `tests/unit/server/addSeries.test.ts`

**Interfaces:**
- Consumes: `probeForApi` (Task 3), `parseApiChapters` + `ApiDescriptor` (Task 2), `withReadingPositions` (already imported in addSeries).
- Produces: `ResolvedSource.type` now `'FEED' | 'PAGE_WATCH' | 'API'`; `ResolvedSource.apiUrl: string | null`; `ResolvedSource.apiMap: ApiDescriptor | null`. `createSeries` persists `apiUrl`/`apiMap`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/server/addSeries.test.ts` (the `ok`/`ports` helpers already exist at the top of the file):

```ts
  test('page reveals a JSON data API → resolves an API source, no feed/render', async () => {
    const url = 'https://spa.example/series/alpha';
    const apiUrl = 'https://spa.example/data/alpha.json';
    const shell = `<html><body><div data-title="/data/alpha.json"></div></body></html>`;
    const apiBody = JSON.stringify([
      { title: 'Ch 1: Start', url: 'https://spa.example/read/1' },
      { title: 'Ch 2: Next', url: 'https://spa.example/read/2' },
    ]);
    const p = ports({ [url]: ok(shell), [apiUrl]: ok(apiBody) });

    const result = await addSeries({ url }, p);
    if (result.kind !== 'created') throw new Error('expected created');

    expect(result.resolved.type).toBe('API');
    expect(result.resolved.fetchMode).toBe('PLAIN');
    expect(result.resolved.apiUrl).toBe(apiUrl);
    expect(result.resolved.apiMap).toMatchObject({ urlField: 'url', titleField: 'title' });
    expect(result.resolved.feedUrl).toBeNull();
    expect(result.resolved.chapters.map((c) => c.url)).toEqual([
      'https://spa.example/read/1',
      'https://spa.example/read/2',
    ]);
  });

  test('no API signal → falls through to today\'s FEED resolution', async () => {
    const url = 'https://translator.example/novel/alpha/';
    const feedUrl = 'https://translator.example/feed/';
    const p = ports({
      [url]: ok(PAGE(feedUrl)),
      [feedUrl]: ok(RSS(ITEM('g1', 'https://translator.example/alpha-1/'))),
    });

    const result = await addSeries({ url }, p);
    if (result.kind !== 'created') throw new Error('expected created');
    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.apiUrl).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- addSeries`
Expected: FAIL — `type` is `'API'` unsupported / `apiUrl` missing on `ResolvedSource`.

- [ ] **Step 3: Extend the resolved-source types**

In `src/server/services/addSeries.ts`, add the import (near line 12-16):

```ts
import { probeForApi } from '../../lib/feeds/apiProbe';
import { parseApiChapters, type ApiDescriptor } from '../../lib/feeds/apiAdapter';
```

Update `ResolvedSource` (`addSeries.ts:32-44`) — change the `type` union and add two fields:

```ts
  type: 'FEED' | 'PAGE_WATCH' | 'API';
  apiUrl: string | null; // WP-45: the chapter-data endpoint when type === 'API'
  apiMap: ApiDescriptor | null; // WP-45: per-source field descriptor when type === 'API'
```

- [ ] **Step 4: Set the new fields on every existing `ResolvedCore` literal**

Add `apiUrl: null, apiMap: null,` to each of the three existing literals so they stay explicit:
- the `allowLinkOnly` core (`addSeries.ts:107-112`),
- the FEED core (`addSeries.ts:180-182`),
- the PAGE_WATCH core (`addSeries.ts:214-225`).

- [ ] **Step 5: Insert the API probe at the top of `resolveFrom`**

In `resolveFrom`, immediately after `const pageToc = pageOk ? parseToc(pageBody, url) : [];` (`addSeries.ts:128`), add:

```ts
    // WP-45: API-first. If the (plainly-fetched) page reveals a chapter data API, read it
    // directly — the complete list with access, no feed and no render. Only on the PLAIN pass:
    // a CF-gated API reached via the RENDER pass needs the render transport (WP-45b), out of scope.
    if (pageOk && bodyMode === 'PLAIN') {
      const api = probeForApi(pageBody, url);
      if (api) {
        const apiRes = await ports.fetch(api.apiUrl);
        if (apiRes.outcome === 'SUCCESS' && !apiRes.notModified) {
          const apiChapters = parseApiChapters(apiRes.body, api.descriptor, api.apiUrl);
          if (apiChapters.length > 0) {
            const core: ResolvedCore = {
              seriesTitle: input.title ?? pageTitle ?? titleFromUrl(url),
              sourceUrl: url,
              host,
              feedUrl: null,
              tocUrl: null,
              apiUrl: api.apiUrl,
              apiMap: api.descriptor,
              type: 'API',
              linkOnly: false,
              fetchMode: 'PLAIN',
              match: { type: 'WHOLE_FEED' },
              chapters: withReadingPositions(apiChapters, apiChapters),
            };
            return finalize(core, ports);
          }
        }
      }
    }
```

- [ ] **Step 6: Persist `apiUrl` / `apiMap` in `createSeries`**

In `src/server/services/index.ts`, inside the `sources.create` block (`index.ts:400-410`), add after `tocUrl: r.tocUrl,`:

```ts
              apiUrl: r.apiUrl, // WP-45
              ...(r.apiMap ? { apiMap: r.apiMap } : {}), // WP-45: Prisma Json — omit when null
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- addSeries` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/addSeries.ts src/server/services/index.ts tests/unit/server/addSeries.test.ts
git commit -m "feat(wp-45): add-time API probe → resolve an API source"
```

---

### Task 5: Poll-time wiring — process an API source

**Files:**
- Modify: `src/server/services/poll.ts` (`PollableSource` interface, `processFetched` branch, import)
- Modify: `src/server/services/index.ts:79-118` (`rowToPollable` — carry `apiUrl`/`apiMap`, derive `fetchUrl`)
- Test: `tests/unit/server/poll.test.ts`

**Interfaces:**
- Consumes: `parseApiChapters` + `ApiDescriptor` (Task 2); `apiMap`/`apiUrl` columns (Task 1).
- Produces: `PollableSource.type` now includes `'API'`; `PollableSource.apiMap: ApiDescriptor | null`. `processFetched` parses an API body via the descriptor and diffs it like a TOC.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/server/poll.test.ts`. Match the file's existing fake-`PollableSource` + `PollPorts` construction (mirror a nearby page-watch test for the exact helper shape); the two behaviors to assert:

```ts
  test('API source: JSON body → new chapters diffed and seeded', async () => {
    const api: ApiDescriptor = { urlField: 'url', titleField: 'title', isFreeField: 'free' };
    const src = pollable({
      type: 'API',
      fetchMode: 'PLAIN',
      fetchUrl: 'https://api.example/works/1/chapters',
      apiMap: api,
    });
    const body = JSON.stringify([
      { title: 'Ch 1', url: 'https://api.example/read/1', free: true },
      { title: 'Ch 2', url: 'https://api.example/read/2', free: true },
    ]);
    const effects = await processFetched(src, okRes(body), null, portsWithStored([]));
    expect(effects.newChapters.map((c) => c.url)).toEqual([
      'https://api.example/read/1',
      'https://api.example/read/2',
    ]);
  });

  test('API source: a LOCKED→FREE isFree flip produces a becameFree effect', async () => {
    const api: ApiDescriptor = { urlField: 'url', titleField: 'title', isFreeField: 'free' };
    const src = pollable({
      type: 'API',
      fetchMode: 'PLAIN',
      fetchUrl: 'https://api.example/works/1/chapters',
      apiMap: api,
    });
    const stored = [{ id: 'c1', url: 'https://api.example/read/1', access: 'LOCKED' as const }];
    const body = JSON.stringify([{ title: 'Ch 1', url: 'https://api.example/read/1', free: true }]);
    const effects = await processFetched(src, okRes(body), null, portsWithStored(stored));
    expect(effects.becameFree.map((c) => c.id)).toEqual(['c1']);
    expect(effects.newChapters).toEqual([]);
  });
```

> Adapt `pollable(...)`, `okRes(...)`, and `portsWithStored(...)` to the helpers already present in `poll.test.ts`. Import `ApiDescriptor` from `../../../src/lib/feeds/apiAdapter`. If the existing fake `PollableSource` builder is an inline object literal, add `apiMap` to it and default `apiMap: null` on the non-API cases.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- poll`
Expected: FAIL — `type: 'API'` unsupported / `apiMap` missing on `PollableSource`.

- [ ] **Step 3: Extend `PollableSource` and add the processing branch**

In `src/server/services/poll.ts`, add the import near the other `lib/feeds` imports:

```ts
import { parseApiChapters, type ApiDescriptor } from '../../lib/feeds/apiAdapter';
```

Update `PollableSource` (`poll.ts:95-120`): change the `type` doc/union and add `apiMap`:

```ts
  /** FEED → parse as a feed + matcher; PAGE_WATCH → parse the TOC; API → parse the JSON via apiMap. */
  type: 'FEED' | 'PAGE_WATCH' | 'API';
```

and, after the `match` field:

```ts
  /** WP-45: per-source API field descriptor when type === 'API'; null otherwise. */
  apiMap: ApiDescriptor | null;
```

In `processFetched` (`poll.ts:273-293`), replace the `if (src.type === 'PAGE_WATCH') { … } else { … }` with a three-way branch:

```ts
      let mine: FeedItem[];
      if (src.type === 'PAGE_WATCH') {
        mine = parseToc(res.body, src.fetchUrl);
        if (
          ports.renderFetch &&
          src.fetchMode === 'PLAIN' &&
          mine.length <= RENDER_ESCALATION_MAX &&
          mine.length < stored.length
        ) {
          escalateToRender = true;
        }
      } else if (src.type === 'API') {
        // WP-45: the API returns the complete list with access — TOC semantics. No render
        // escalation (an API source is not a render fallback) and no matcher (already scoped).
        mine = src.apiMap ? parseApiChapters(res.body, src.apiMap, src.fetchUrl) : [];
      } else {
        const parsed = await parseFeed(res.body);
        mine = filterBySeriesMatch(parsed.items, src.match);
      }
```

- [ ] **Step 4: Carry `apiUrl`/`apiMap` through `rowToPollable`**

In `src/server/services/index.ts`, in the `rowToPollable` param type (`index.ts:79-99`) add:

```ts
  apiUrl: string | null;
  apiMap: unknown; // Prisma Json — cast to ApiDescriptor below
```

Change the `fetchUrl` derivation (`index.ts:106`) to prefer the API endpoint:

```ts
    fetchUrl: row.apiUrl ?? row.feedUrl ?? row.tocUrl ?? row.url, // WP-45: API endpoint wins; then WP-37 TOC
```

and add to the returned object:

```ts
    apiMap: (row.apiMap as ApiDescriptor | null) ?? null, // WP-45
```

Add the type import at the top of `index.ts` (with the other `lib/feeds` type imports):

```ts
import type { ApiDescriptor } from '../../lib/feeds/apiAdapter';
```

(`loadActiveSources` uses `findMany` with no `select`, so `apiUrl`/`apiMap` are already fetched — no query change needed.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- poll` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/poll.ts src/server/services/index.ts tests/unit/server/poll.test.ts
git commit -m "feat(wp-45): poll — process an API source via its descriptor"
```

---

### Task 6: Manual escape hatch — `setApiDescriptor` service + CLI command

**Files:**
- Modify: `src/server/services/cleanup.ts` (add `setApiDescriptor`)
- Modify: `src/server/services/index.ts` (re-export `setApiDescriptor`)
- Modify: `scripts/cleanup-series.ts` (usage + `set-api-descriptor` command + switch case)
- Test: `tests/integration/cleanup.test.ts` (or the existing cleanup integration test file)

**Interfaces:**
- Consumes: `ApiDescriptor` (Task 2); `ownsSource` (already in `cleanup.ts`).
- Produces: `function setApiDescriptor(sourceId: string, opts: { endpoint: string; map: ApiDescriptor; render?: boolean }): Promise<{ updated: boolean }>`; CLI `set-api-descriptor <sourceId> --endpoint <url> --map <json> [--render]`.

- [ ] **Step 1: Write the failing integration test**

Add to the cleanup integration test (mirror the existing `reclassifySource` test's setup — create a series with a source, then act, then assert the row). Import `setApiDescriptor` from `../../src/server/services/index` and `db` from the test setup:

```ts
  test('setApiDescriptor flips a source to API with endpoint + descriptor', async () => {
    const series = await db.series.create({
      data: {
        userId: TEST_USER_ID,
        title: 'Alpha',
        sources: { create: { url: 'https://spa.example/series/alpha', host: 'spa.example', type: 'FEED', feedUrl: 'https://spa.example/feed/' } },
      },
      include: { sources: true },
    });
    const sourceId = series.sources[0].id;

    const res = await setApiDescriptor(sourceId, {
      endpoint: 'https://api.example/works/1/chapters',
      map: { urlField: 'url', titleField: 'title', isFreeField: 'free' },
    });
    expect(res.updated).toBe(true);

    const row = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
    expect(row.type).toBe('API');
    expect(row.apiUrl).toBe('https://api.example/works/1/chapters');
    expect(row.feedUrl).toBeNull();
    expect(row.fetchMode).toBe('PLAIN');
    expect(row.apiMap).toMatchObject({ urlField: 'url', isFreeField: 'free' });
  });
```

> Use the file's existing test-user constant and setup/teardown (see `tests/integration/setup.ts`). If the cleanup integration test uses a different owner-id helper, match it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project integration cleanup`
Expected: FAIL — `setApiDescriptor` is not exported.

- [ ] **Step 3: Implement the service**

In `src/server/services/cleanup.ts`, add the import and the function (after `reclassifySource`, `cleanup.ts:73`):

```ts
import { Prisma } from '@prisma/client';
import type { ApiDescriptor } from '../../lib/feeds/apiAdapter';
```

```ts
/** WP-45: point an owned source at a chapter data API — set type=API, the endpoint, and the
 *  field descriptor; drop the now-irrelevant feed matcher + stale validators. `render` marks a
 *  CF-gated API that must be fetched through the headless browser (WP-45b). */
export async function setApiDescriptor(
  sourceId: string,
  opts: { endpoint: string; map: ApiDescriptor; render?: boolean },
): Promise<{ updated: boolean }> {
  if (!(await ownsSource(sourceId))) return { updated: false };
  await db.source.update({
    where: { id: sourceId },
    data: {
      type: 'API',
      apiUrl: opts.endpoint,
      apiMap: opts.map as unknown as Prisma.InputJsonValue,
      feedUrl: null,
      matchType: 'WHOLE_FEED',
      matchValue: null,
      etag: null,
      lastModified: null,
      fetchMode: opts.render ? 'RENDER' : 'PLAIN',
    },
  });
  return { updated: true };
}
```

- [ ] **Step 4: Re-export from the services barrel**

In `src/server/services/index.ts`, add `setApiDescriptor` to the existing `export { … } from './cleanup'` / import-and-re-export block alongside `reclassifySource`.

- [ ] **Step 5: Wire the CLI command**

In `scripts/cleanup-series.ts`:
- import `setApiDescriptor` in the block from `'../src/server/services/index'` (`cleanup-series.ts:10-20`);
- add to the usage string (`cleanup-series.ts:35`): `  set-api-descriptor <sourceId> --endpoint <url> --map <json> [--render]`;
- add a handler modeled on `cmdReclassify`:

```ts
async function cmdSetApiDescriptor(args: string[], apply: boolean): Promise<void> {
  const sourceId = args[0];
  if (!sourceId) throw new UsageError('set-api-descriptor requires <sourceId>');
  const endpoint = flagValue(args, '--endpoint');
  const mapJson = flagValue(args, '--map');
  if (!endpoint) throw new UsageError('set-api-descriptor requires --endpoint <url>');
  if (!mapJson) throw new UsageError('set-api-descriptor requires --map <json>');
  const render = args.includes('--render');
  let map: import('../src/lib/feeds/apiAdapter').ApiDescriptor;
  try {
    map = JSON.parse(mapJson);
  } catch {
    throw new UsageError('--map must be valid JSON');
  }
  if (!map.urlField || !map.titleField) throw new UsageError('--map needs at least urlField and titleField');
  if (!apply) {
    console.log(`[dry run] set-api-descriptor would set source ${sourceId} → API`);
    console.log(`  endpoint=${endpoint}  fetchMode=${render ? 'RENDER' : 'PLAIN'}  map=${JSON.stringify(map)}`);
    return;
  }
  const res = await setApiDescriptor(sourceId, { endpoint, map, render });
  console.log(res.updated ? `Set API descriptor on source ${sourceId}.` : `No source ${sourceId} for the current user.`);
}
```

- add the switch case (near `cleanup-series.ts:235`):

```ts
    case 'set-api-descriptor':
      return cmdSetApiDescriptor(rest, apply);
```

> Match how the other cases pass their args/apply flag (`rest`, `apply`) — read the surrounding `switch` block to use the exact local variable names.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- --project integration cleanup` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/cleanup.ts src/server/services/index.ts scripts/cleanup-series.ts tests/integration/cleanup.test.ts
git commit -m "feat(wp-45): set-api-descriptor CLI + service (manual escape hatch)"
```

---

### Task 7: Integration test — end-to-end API source (add → persist → poll)

**Files:**
- Test: `tests/integration/services.test.ts`

**Interfaces:**
- Consumes: real `addSeries` + `pollAllSources` edge functions with injected `fetch` (see the file's `fetchFrom(map)` / `okRes` helpers).

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/services.test.ts`, mirroring the existing `addAlpha()` round-trip helper:

```ts
  test('add-time probe persists an API source, then a poll diffs it', async () => {
    const url = 'https://spa.example/series/alpha';
    const apiUrl = 'https://spa.example/data/alpha.json';
    const shell = `<html><body><div data-title="/data/alpha.json"></div></body></html>`;
    const apiV1 = JSON.stringify([
      { title: 'Ch 1', url: 'https://spa.example/read/1', free: false },
    ]);

    const created = await addSeries({ url }, fetchFrom({ [url]: okRes(shell), [apiUrl]: okRes(apiV1) }));
    if (created.kind !== 'created') throw new Error('expected created');

    const source = await db.source.findFirstOrThrow({ where: { seriesId: created.seriesId } });
    expect(source.type).toBe('API');
    expect(source.apiUrl).toBe(apiUrl);
    expect(source.apiMap).toMatchObject({ urlField: 'url' });

    // A poll where the API now marks Ch 1 free → becameFree flips access + stamps becameFreeAt.
    // The API source was set up via the add above with a `free: false` descriptor mapping, so
    // manually align the descriptor to what the probe stored, then re-poll with the unlocked body.
    const apiV2 = JSON.stringify([{ title: 'Ch 1', url: 'https://spa.example/read/1', free: true }]);
    // (The static-JSON probe descriptor has no isFreeField, so seed access via a descriptor set through
    //  setApiDescriptor before re-polling — see note below.)
    await setApiDescriptor(source.id, {
      endpoint: apiUrl,
      map: { urlField: 'url', titleField: 'title', isFreeField: 'free' },
    });
    await pollAllSources(fetchFrom({ [apiUrl]: okRes(apiV2) }));

    const ch = await db.chapter.findFirstOrThrow({ where: { seriesId: created.seriesId, url: 'https://spa.example/read/1' } });
    expect(ch.access).toBe('FREE');
    expect(ch.becameFreeAt).not.toBeNull();
  });
```

> The static-JSON probe descriptor intentionally has no `isFreeField` (that shape carries no lock state), so the test uses `setApiDescriptor` to attach an access-aware descriptor before exercising the LOCKED→FREE path — which also gives the integration test coverage of the CLI service against a real poll. Adjust `pollAllSources`/`addSeries` call signatures to the file's actual injected-port helpers.

- [ ] **Step 2: Run the tests to verify they fail, then pass**

Run: `npm test -- --project integration services`
Expected: initially FAIL if any wiring is incomplete; PASS once Tasks 1-6 are in.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/services.test.ts
git commit -m "test(wp-45): integration — API source add → persist → poll"
```

---

### Task 8: Full verification + PLAN.md update + file WP-45b / freeAt note

**Files:**
- Modify: `PLAN.md` (Current focus, Active-queue row, Completed table, add WP-45b + WP-NOTE-FREEAT rows, Changelog)

- [ ] **Step 1: Full verification**

Run: `npm test` then `npm run typecheck`
Expected: entire suite green; typecheck clean. Paste the fresh output.

- [ ] **Step 2: Flip WP-45 to DONE and file the follow-ons**

In `PLAN.md`:
- Remove the WP-45 row from the **▶ Active queue** table; add `WP-45` to the **✅ Completed** list.
- Add a `### WP-45` completion note (what shipped: schema `API` type + `apiUrl`/`apiMap`; `parseApiChapters` + `probeForApi`; add-time probe; `set-api-descriptor` CLI; poll branch; render eliminated for plain-REST API sources; conditional-GET works).
- Add a new **▶ Active queue** row **WP-45b** — *CF-gated REST transport*: `renderPage` returns raw JSON on an `application/json` navigation (skip the load-more loop); CLI `--render` seeding; poll render-fetches the API URL. Depends on WP-45, WP-17b.
- Add a **note** (in the WP-45 section or the Backlog) that the plain REST API exposes a per-chapter **`freeAt`** scheduled-unlock timestamp — not captured this WP — and that adding a `Chapter.freeAt` column later enables *predicted* unlocks (relates to WP-29/WP-27b).
- Update **Current focus** `NEXT` to the next queued WP.
- Add a Changelog line dated 2026-08-18.

- [ ] **Step 3: Commit**

```bash
git add PLAN.md
git commit -m "docs(wp-45): mark DONE; file WP-45b (CF-gated) + freeAt note"
```

---

## Self-Review notes (author)

- **Spec coverage:** schema (Task 1) · `parseApiChapters` (Task 2) · `probeForApi` (Task 3) · add-time probe + persist (Task 4) · poll branch + `fetchUrl`/`apiMap` carry (Task 5) · `set-api-descriptor` CLI (Task 6) · integration add→poll + WP-20 flip (Task 7) · PLAN + WP-45b + freeAt note (Task 8). All spec sections A–F, the testing section, and the DoD map to a task.
- **Type consistency:** `ApiDescriptor` defined in Task 2 is the single source of truth, imported by `apiProbe.ts`, `addSeries.ts`, `poll.ts`, `cleanup.ts`, and both test files. `parseApiChapters(body, descriptor, baseUrl)` signature is identical at every call site. `type` union extended to `'FEED' | 'PAGE_WATCH' | 'API'` in both `ResolvedSource` (Task 4) and `PollableSource` (Task 5).
- **Non-goals honored:** no render change (that's WP-45b), no `Chapter.freeAt` column (deferred), no per-host code (descriptors are data), no arbitrary-REST guessing (one conservative static-JSON detector + CLI).
- **Graceful degradation:** a probe miss or failed/empty API fetch falls through to today's ladder unchanged; the two `addSeries` regression tests assert the non-API path is byte-for-byte the same.
