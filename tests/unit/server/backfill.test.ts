import { describe, expect, test } from 'vitest';
import {
  computeBackfillPlan,
  chooseTitleUpdate,
  runBackfill,
  type StoredChapter,
  type BackfillMeta,
  type BackfillPlan,
  type BackfillPorts,
} from '../../../src/server/services/backfill';
import type { TocChapter } from '../../../src/lib/feeds/pageWatch';
import type { PoliteResult } from '../../../src/lib/feeds/fetch';

const h1 = (title: string) => `<html><body><h1>${title}</h1></body></html>`;

const C1 = 'https://t.example/a-1/';
const C2 = 'https://t.example/a-2/';
const C3 = 'https://t.example/a-3/';
const C4 = 'https://t.example/a-4/';
const C9 = 'https://t.example/a-9/';

/** A descending (newest-first) TOC — the well-formed trend `tocReadingOrder` trusts. */
function toc(...urls: string[]): TocChapter[] {
  return urls.map((url, i) => ({ url, title: `Chapter ${urls.length - i}`, number: urls.length - i, access: 'FREE' as const }));
}

function stored(...rows: Array<Partial<StoredChapter> & { url: string }>): StoredChapter[] {
  return rows.map((r, i) => ({ id: r.id ?? `id${i}`, url: r.url, guid: r.guid, access: r.access, position: r.position ?? null }));
}

const noOpts = { discoveredTocUrl: null, titleUpdate: undefined };

describe('computeBackfillPlan — new chapters + reindex', () => {
  test('reindexes every stored chapter and positions the new tail when the TOC covers all of them', () => {
    // Store has a-1, a-2 (unpositioned); TOC is a-3, a-2, a-1 descending → reading order a-1=0, a-2=1, a-3=2.
    const plan = computeBackfillPlan(stored({ url: C1 }, { url: C2 }), toc(C3, C2, C1), noOpts);

    expect(plan.newChapters.map((c) => [c.url, c.position])).toEqual([[C3, 2]]);
    expect(plan.reindex).toEqual([
      { id: 'id0', position: 0 }, // a-1
      { id: 'id1', position: 1 }, // a-2
    ]);
  });

  test('leaves positions untouched when a positioned stored chapter is absent from the TOC (windowed)', () => {
    // a-1 is stored WITH a position but the trimmed TOC (a-4, a-3, a-2) dropped it → not reindexable.
    const plan = computeBackfillPlan(
      stored({ url: C1, position: 0 }, { url: C2, position: 1 }, { url: C3, position: 2 }),
      toc(C4, C3, C2),
      noOpts,
    );

    expect(plan.reindex).toEqual([]);
    expect(plan.newChapters.map((c) => [c.url, c.position])).toEqual([[C4, null]]);
  });

  test('reindexes the TOC-covered chapters when the only absent stored chapter is unpositioned (feed-ahead)', () => {
    // a-9 is a feed-ahead chapter: stored, position null, not on the TOC → does NOT block the reindex.
    const plan = computeBackfillPlan(
      stored({ url: C1 }, { url: C2 }, { url: C9, position: null }),
      toc(C3, C2, C1),
      noOpts,
    );

    expect(plan.newChapters.map((c) => [c.url, c.position])).toEqual([[C3, 2]]);
    expect(plan.reindex).toEqual([
      { id: 'id0', position: 0 }, // a-1
      { id: 'id1', position: 1 }, // a-2
    ]);
    // a-9 keeps null (sorts last = newest) — never reindexed.
    expect(plan.reindex.find((r) => r.id === 'id2')).toBeUndefined();
  });

  test('adds the new tail with null positions when the numeric signal is too weak to trust a reading order', () => {
    // No numbers → tocReadingOrder returns null → not reindexable, new chapters get null positions.
    const flat: TocChapter[] = [
      { url: C2, title: 'Two', number: null, access: 'FREE' },
      { url: C1, title: 'One', number: null, access: 'FREE' },
    ];
    const plan = computeBackfillPlan(stored({ url: C1 }), flat, noOpts);

    expect(plan.reindex).toEqual([]);
    expect(plan.newChapters.map((c) => [c.url, c.position])).toEqual([[C2, null]]);
  });
});

describe('computeBackfillPlan — access events', () => {
  test('surfaces a LOCKED→FREE stored chapter as becameFree, carrying its row id', () => {
    const lockedToc: TocChapter[] = [{ url: C1, title: 'One', number: 1, access: 'FREE' }];
    const plan = computeBackfillPlan(stored({ id: 'row1', url: C1, access: 'LOCKED' }), lockedToc, noOpts);

    expect(plan.becameFree.map((c) => c.id)).toEqual(['row1']);
    expect(plan.newChapters).toEqual([]);
  });

  test('surfaces an UNKNOWN→known stored chapter as accessReconciled with the learned access', () => {
    const knownToc: TocChapter[] = [{ url: C1, title: 'One', number: 1, access: 'LOCKED' }];
    const plan = computeBackfillPlan(stored({ id: 'row1', url: C1, access: undefined }), knownToc, noOpts);

    expect(plan.accessReconciled.map((c) => [c.id, c.access])).toEqual([['row1', 'LOCKED']]);
  });
});

describe('computeBackfillPlan — persists', () => {
  test('passes a discovered TOC url and a chosen title through to the plan', () => {
    const plan = computeBackfillPlan(stored({ url: C1 }), toc(C1), {
      discoveredTocUrl: 'https://t.example/toc/',
      titleUpdate: 'The Real Title',
    });

    expect(plan.persistTocUrl).toBe('https://t.example/toc/');
    expect(plan.persistTitle).toBe('The Real Title');
  });

  test('omits persists when no TOC url was discovered and no title chosen', () => {
    const plan = computeBackfillPlan(stored({ url: C1 }), toc(C1), noOpts);

    expect(plan.persistTocUrl).toBeUndefined();
    expect(plan.persistTitle).toBeUndefined();
  });
});

describe('chooseTitleUpdate', () => {
  const meta = { titleIsManual: false, currentTitle: 'Old Title', host: 't.example' };

  test('never touches a manual title, even when the body would extract a different one', () => {
    expect(chooseTitleUpdate({ ...meta, titleIsManual: true }, h1('A Fresh Title'), h1('A Fresh Title'))).toBeUndefined();
  });

  test('returns the title extracted from the preferred body when it differs from the current one', () => {
    expect(chooseTitleUpdate(meta, h1('A Fresh Title'), '')).toBe('A Fresh Title');
  });

  test('returns undefined when the extracted title equals the current one', () => {
    expect(chooseTitleUpdate(meta, h1('Old Title'), '')).toBeUndefined();
  });

  test('falls back to the TOC body when no dedicated title body was fetched', () => {
    expect(chooseTitleUpdate(meta, null, h1('From The TOC'))).toBe('From The TOC');
  });

  test('returns undefined when neither body yields a title', () => {
    expect(chooseTitleUpdate(meta, null, '<html><body>no heading</body></html>')).toBeUndefined();
  });
});

// ── runBackfill orchestrator (fake ports) ────────────────────────────────────

const NOVEL = 'https://t.example/novel/';
const TOC_URL = 'https://t.example/toc/';

const okRes = (body: string): PoliteResult => ({
  outcome: 'SUCCESS', status: 200, notModified: false, body, etag: null, lastModified: null, finalUrl: NOVEL,
});
const notModifiedRes: PoliteResult = {
  outcome: 'SUCCESS', status: 304, notModified: true, body: '', etag: null, lastModified: null, finalUrl: NOVEL,
};
const failedRes: PoliteResult = { outcome: 'HTTP_4XX', status: 404 };

/** A two-chapter descending TOC page (a-2 then a-1), optionally carrying its own <h1> title. */
const tocPage = (title?: string) =>
  `<html><body>${title ? `<h1>${title}</h1>` : ''}<ul>` +
  `<li><a href="${C2}">Chapter 2</a></li><li><a href="${C1}">Chapter 1</a></li>` +
  `</ul></body></html>`;

const META: BackfillMeta = {
  currentTitle: 'Old Title', titleIsManual: false,
  sourceId: 'src1', sourceUrl: NOVEL, host: 't.example', tocUrl: TOC_URL,
};

function harness(opts: { meta: BackfillMeta | null; responses: Record<string, PoliteResult>; stored?: StoredChapter[] }) {
  const fetches: string[] = [];
  const applied: { sourceId: string; plan: BackfillPlan }[] = [];
  const ports: BackfillPorts = {
    fetch: async (url) => {
      fetches.push(url);
      return opts.responses[url] ?? failedRes;
    },
    loadSeriesMeta: async () => opts.meta,
    loadStoredChapters: async () => opts.stored ?? [],
    applyBackfillPlan: async (sourceId, plan) => {
      applied.push({ sourceId, plan });
    },
  };
  return { ports, fetches, applied };
}

describe('runBackfill — bail paths', () => {
  test('does nothing when the series is not owned or has no active source (meta null)', async () => {
    const h = harness({ meta: null, responses: {} });
    expect(await runBackfill(h.ports)).toEqual({ added: 0, reconciled: 0, titleUpdated: undefined });
    expect(h.fetches).toEqual([]);
    expect(h.applied).toEqual([]);
  });

  test('does nothing when the TOC fetch fails', async () => {
    const h = harness({ meta: META, responses: { [TOC_URL]: failedRes } });
    expect(await runBackfill(h.ports)).toMatchObject({ added: 0, reconciled: 0 });
    expect(h.applied).toEqual([]);
  });

  test('does nothing when the TOC fetch is not-modified', async () => {
    const h = harness({ meta: META, responses: { [TOC_URL]: notModifiedRes } });
    expect(await runBackfill(h.ports)).toMatchObject({ added: 0, reconciled: 0 });
    expect(h.applied).toEqual([]);
  });
});

describe('runBackfill — tocUrl-set path', () => {
  test('fetches the stored tocUrl directly, applies the plan under the right sourceId', async () => {
    const h = harness({
      meta: META,
      responses: { [TOC_URL]: okRes(tocPage()), [NOVEL]: okRes(h1('Old Title')) },
      stored: stored({ url: C1 }),
    });
    const result = await runBackfill(h.ports);

    expect(result.added).toBe(1); // a-2 was missing
    expect(h.fetches[0]).toBe(TOC_URL); // straight to the TOC, no self-heal landing hop
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]!.sourceId).toBe('src1');
    expect(h.applied[0]!.plan.newChapters.map((c) => c.url)).toEqual([C2]);
    expect(h.applied[0]!.plan.persistTocUrl).toBeUndefined(); // nothing self-healed
  });
});

describe('runBackfill — self-heal TOC discovery (tocUrl null)', () => {
  const landingWithTocLink = `<html><body><h1>Old Title</h1><a href="${TOC_URL}">Table of Contents</a></body></html>`;
  const selfHealMeta: BackfillMeta = { ...META, tocUrl: null };

  test('accepts a discovered TOC link, follows it one hop, and marks it for persistence', async () => {
    const h = harness({
      meta: selfHealMeta,
      responses: { [NOVEL]: okRes(landingWithTocLink), [TOC_URL]: okRes(tocPage()) },
      stored: stored({ url: C1 }),
    });
    const result = await runBackfill(h.ports);

    expect(h.fetches).toEqual([NOVEL, TOC_URL]); // landing, then the followed TOC — no extra title fetch
    expect(result.added).toBe(1); // parsed the followed TOC body (a-2 new)
    expect(h.applied[0]!.plan.persistTocUrl).toBe(TOC_URL);
  });

  test('rejects the discovered link when the follow fetch fails, keeping the landing body as the TOC', async () => {
    const h = harness({
      meta: selfHealMeta,
      responses: { [NOVEL]: okRes(landingWithTocLink), [TOC_URL]: failedRes },
      stored: stored({ url: C1 }),
    });
    const result = await runBackfill(h.ports);

    expect(h.fetches).toEqual([NOVEL, TOC_URL]); // tried the follow, it failed
    expect(h.applied[0]!.plan.persistTocUrl).toBeUndefined(); // follow rejected → nothing to persist
    expect(result.added).toBe(0); // landing body has no chapters
  });

  test('does not follow when the landing page exposes no TOC link', async () => {
    const h = harness({
      meta: selfHealMeta,
      responses: { [NOVEL]: okRes(tocPage('Old Title')) }, // a page with chapters but no "Table of Contents" link
      stored: stored({ url: C1 }),
    });
    await runBackfill(h.ports);

    expect(h.fetches).toEqual([NOVEL]); // no follow hop, and landing body already captured → no title fetch
    expect(h.applied[0]!.plan.persistTocUrl).toBeUndefined();
  });
});

describe('runBackfill — title-source branches', () => {
  test('tocUrl-set + non-manual: fetches the landing page for the title', async () => {
    const h = harness({
      meta: META,
      responses: { [TOC_URL]: okRes(tocPage()), [NOVEL]: okRes(h1('The New Name')) },
      stored: stored({ url: C1 }),
    });
    const result = await runBackfill(h.ports);

    expect(h.fetches).toEqual([TOC_URL, NOVEL]); // extra landing fetch just for the title
    expect(result.titleUpdated).toBe('The New Name');
    expect(h.applied[0]!.plan.persistTitle).toBe('The New Name');
  });

  test('tocUrl-set + non-manual: falls back to the TOC body when the landing fetch fails', async () => {
    const h = harness({
      meta: META,
      responses: { [TOC_URL]: okRes(tocPage('Title In The TOC')), [NOVEL]: failedRes },
      stored: stored({ url: C1 }),
    });
    const result = await runBackfill(h.ports);

    expect(result.titleUpdated).toBe('Title In The TOC'); // extracted from the TOC body we already had
  });

  test('manual title: never fetches the landing page and never updates the title', async () => {
    const h = harness({
      meta: { ...META, titleIsManual: true },
      responses: { [TOC_URL]: okRes(tocPage('Ignored Title')) },
      stored: stored({ url: C1 }),
    });
    const result = await runBackfill(h.ports);

    expect(h.fetches).toEqual([TOC_URL]); // no landing fetch for a hand-pinned title
    expect(result.titleUpdated).toBeUndefined();
    expect(h.applied[0]!.plan.persistTitle).toBeUndefined();
  });
});
