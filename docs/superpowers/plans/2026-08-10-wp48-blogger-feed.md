# WP-48 — Blogger feed-path in `guessFeedUrls` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `guessFeedUrls` offer Blogger's `/feeds/posts/default` (+`?alt=rss`) — first for `*.blogspot.com` hosts, last for all others — so a Blogger series binds via its feed even when the page fetch is blocked from Vercel.

**Architecture:** One pure function edit in `src/lib/feeds/discover.ts` plus its unit tests. `addSeries` already falls back to `guessFeedUrls` when the page fetch fails, so no wiring change.

**Tech Stack:** TypeScript (strict), Vitest. `lib/` stays Next-free and pure.

## Global Constraints

- `src/lib/**` stays pure — no `next`/`prisma`/`fs`/network imports. `guessFeedUrls` returns candidate URL strings only.
- TDD — failing test first, watch it fail for the right reason, then implement (agreement #2).
- Verify before done — `npm test` + `npm run typecheck` with fresh output in the same message (agreement #3).
- Committed content anonymous — reserved `.example`/generic hosts and the platform names Blogger/WordPress (framework descriptors, like existing docs); NO real translator site name (memory: no-real-site-names).
- Blogger paths are a **strict last resort** for non-blogspot hosts (appended after the WordPress guesses); for `*.blogspot.com` they go **first**. No schema change, no `addSeries` change.

---

### Task 1: `guessFeedUrls` offers Blogger feed candidates

**Files:**
- Modify: `src/lib/feeds/discover.ts` (`guessFeedUrls`)
- Test: `tests/unit/feeds/discover.test.ts`

**Interfaces:**
- Produces: `guessFeedUrls(pageUrl: string): string[]` — for a `*.blogspot.com` host returns `[${origin}/feeds/posts/default, ${origin}/feeds/posts/default?alt=rss, ${page}feed/, ${origin}/feed/]`; for any other host returns `[${page}feed/, ${origin}/feed/, ${origin}/feeds/posts/default, ${origin}/feeds/posts/default?alt=rss]`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/feeds/discover.test.ts` inside the `describe('guessFeedUrls', …)` block (the existing `.toContain` test stays as-is):

```typescript
test('WP-48: a *.blogspot.com host offers Blogger feed paths FIRST', () => {
  const guesses = guessFeedUrls('https://example-blog.blogspot.com/');
  expect(guesses).toEqual([
    'https://example-blog.blogspot.com/feeds/posts/default',
    'https://example-blog.blogspot.com/feeds/posts/default?alt=rss',
    'https://example-blog.blogspot.com/feed/',
    'https://example-blog.blogspot.com/feed/',
  ]);
});

test('WP-48: a non-blogspot host appends Blogger feed paths LAST (universal fallback)', () => {
  const guesses = guessFeedUrls('https://site.example/novel/example-novel/');
  expect(guesses).toEqual([
    'https://site.example/novel/example-novel/feed/',
    'https://site.example/feed/',
    'https://site.example/feeds/posts/default',
    'https://site.example/feeds/posts/default?alt=rss',
  ]);
});

test('WP-48: an unparseable URL still returns an empty list', () => {
  expect(guessFeedUrls('not a url')).toEqual([]);
});
```

Note: for the blogspot root URL `https://example-blog.blogspot.com/`, `page` = `${origin}/` so `${page}feed/` = `${origin}/feed/`, making the two WordPress entries identical — the expected array reflects that (both `.../feed/`). This is existing behavior, not something to “fix.”

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- discover`
Expected: FAIL — the blogspot and non-blogspot `toEqual` tests fail (current output has no Blogger paths); the unparseable-URL test passes (existing behavior).

- [ ] **Step 3: Implement the Blogger candidates**

In `src/lib/feeds/discover.ts`, replace the body of `guessFeedUrls`:

```typescript
export function guessFeedUrls(pageUrl: string): string[] {
  try {
    const u = new URL(pageUrl);
    const page = `${u.origin}${u.pathname.replace(/\/?$/, '/')}`; // ensure trailing slash
    const wp = [`${page}feed/`, `${u.origin}/feed/`]; // WordPress-style
    // Blogger's blog-level feed (Atom + the RSS variant; rss-parser reads both).
    const blogger = [`${u.origin}/feeds/posts/default`, `${u.origin}/feeds/posts/default?alt=rss`];
    // *.blogspot.com → Blogger first (skip the WP 404s). Any other host → Blogger LAST, a universal
    // last-resort that also rescues custom-domain / ccTLD Blogger. `looksLikeFeed` (in addSeries) plus
    // strict-last ordering keep the rare non-Blogger wrong-bind risk small.
    const isBlogspot = u.hostname === 'blogspot.com' || u.hostname.endsWith('.blogspot.com');
    return isBlogspot ? [...blogger, ...wp] : [...wp, ...blogger];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run to verify they pass + full suite**

Run: `npm test -- discover` then `npm test && npm run typecheck`
Expected: the three new tests PASS, the existing "offers WordPress-style fallbacks" `.toContain` test still PASSES, full unit suite + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feeds/discover.ts tests/unit/feeds/discover.test.ts
git commit -m "WP-48: guessFeedUrls offers Blogger /feeds/posts/default (blogspot-first, universal-last)"
```

---

### Task 2: PLAN.md — WP-48 done

**Files:**
- Modify: `PLAN.md`

**Interfaces:** none (tracker hygiene, agreement #6).

- [ ] **Step 1: Record the outcome**

Read `PLAN.md` fully first (match its structure/conventions), then:
- Active queue: remove the WP-48 row (it moves to Completed); confirm the next-priority row's `NEXT` marker is correct (WP-34 remains `NEXT` unless it was already flipped).
- Add WP-48 to the ✅ Completed line.
- In the `### WP-48` detail section, add a `**DONE (2026-08-10).**` summary: `guessFeedUrls` now offers Blogger `/feeds/posts/default` (+`?alt=rss`), first for `*.blogspot.com` (speed) and last for every other host (universal fallback covering custom-domain / ccTLD Blogger); pure, no `addSeries`/schema change; accepted low risk (silent wrong-bind only if a non-Blogger host serves feed XML at that path — mitigated by strict-last + `looksLikeFeed`).
- Add a Changelog line dated 2026-08-10 for WP-48.
- Keep everything anonymous (framework/platform descriptors only — Blogger/WordPress fine; no real translator site name; don't name the local testing-notes file).

- [ ] **Step 2: Commit**

```bash
git add PLAN.md
git commit -m "docs: WP-48 done — Blogger feed-path in guessFeedUrls"
```

---

## Self-Review

**Spec coverage:**
- The change (Blogger Atom + RSS paths; blogspot-first / universal-last ordering) → Task 1. ✅
- Testing (blogspot order, non-blogspot order, unparseable → [], existing test green) → Task 1. ✅
- DoD (both orderings, pure, unit-tested, existing green, no addSeries/schema change) → Task 1. ✅
- Tracker hygiene → Task 2. ✅

**Placeholder scan:** No TBD/TODO; every code step shows real code. ✅

**Type consistency:** `guessFeedUrls(pageUrl: string): string[]` — signature unchanged; only the returned array content/order changes. Callers (`addSeries`) already consume `string[]`, unaffected. ✅

**Non-vacuity note:** the two ordering tests assert exact `toEqual` arrays (order-sensitive), so they fail if the Blogger paths are missing OR mis-ordered (e.g. universal instead of blogspot-first) — genuine, not a bare `.toContain`.