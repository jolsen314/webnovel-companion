# WP-46 — Add-time render escalation + poll regression guard

**Status:** approved (owner, 2026-08-10) · **Depends on:** WP-07, WP-17b · **Unblocks:** WP-34

## Problem

`addSeries` resolves a pasted URL against a plain (non-rendered) HTTP fetch. Two real failures fall out of that:

1. **Hard-fail — unaddable today.** When the plain page fetch fails (Cloudflare challenges Vercel's datacenter
   IP) *and* no feed is reachable, `addSeries` throws `"Couldn't reach … or find a feed"`
   ([addSeries.ts:152](../../../src/server/services/addSeries.ts#L152)). Two owner sites hit this: a no-feed CF host
   and a JS-rendered CF host — both 200 from a residential IP, both unaddable from Vercel.
2. **Under-fetch.** A PAGE_WATCH add whose TOC is JS-rendered parses ≤5 chapters from the plain body, so the series
   is seeded almost empty and stays that way until the first poll.

Our own headless renderer (`/api/render`, `makeRenderFetch`) clears CF's JS managed challenge — a real browser passes
where a code-only GET can't (WP-40 spike). It's already wired into `pollAllSources` but **not** into `addSeries`. This
WP threads it into the add path as an escalation of last resort, and fixes a related poll wart it exposes.

## Non-goals (explicitly other WPs)

- **Dense-feed window-miss** — a FEED series whose novel isn't in the feed window seeds 0 chapters. Not render-fixable
  (the chapters aren't in the feed); it fills on a later poll → WP-43.
- **Pagination / follow-next-page** split TOCs → WP-32.
- **No new `Source` column.** The poll fix is memory-free (regression signal), so no `lastReconciledAt` / `renderProbed`.

## Design

### A. Port + wiring

- Add an optional `render?: FetchImpl` to `AddSeriesPorts` ([addSeries.ts:41](../../../src/server/services/addSeries.ts#L41)).
- Thread the existing `renderPort()` (built from `RENDER_URL` / `RENDER_SECRET`) into the `addSeries` wrapper
  ([index.ts:367](../../../src/server/services/index.ts#L367)), exactly as `pollAllSources` receives it. When
  `RENDER_URL` is unset (local dev, tests that don't inject it), `render` is `undefined` → every escalation below is
  skipped and behavior is identical to today.
- Add `fetchMode: 'PLAIN' | 'RENDER'` to `ResolvedSource` (and `ResolvedCore`), defaulting to `'PLAIN'`. `createSeries`
  persists it on the `Source` row ([index.ts:387](../../../src/server/services/index.ts#L387) block, which does not set
  `fetchMode` today → currently defaults PLAIN via schema).
- Export `RENDER_ESCALATION_MAX` (= 5) from [poll.ts:242](../../../src/server/services/poll.ts#L242) and import it in
  `addSeries` so add and poll share one threshold.

### B. Hard-fail render ladder

The add path already tries cheap options in order; render is inserted as the **last resort before the throw**, so a
feed that serves while the page is CF-blocked still costs no render:

1. Plain fetch the page.
2. Feed discovery / guesses — **unchanged**. A reachable feed → FEED branch, no render.
3. `pageOk` and no feed → PAGE_WATCH (plain).
4. **New:** no feed **and** `!pageOk` **and** `ports.render` present → `render(url)`. On `SUCCESS`, treat the rendered
   body as the page (`pageOk` becomes true, `fetchMode = 'RENDER'`), re-derive the title from the rendered body, and
   **re-run discovery + branch** against the rendered body — a now-visible advertised `<link>` feed yields a FEED
   source; otherwise a PAGE_WATCH source. The created source carries `fetchMode: 'RENDER'` so every future poll renders
   (the site stays CF-blocked on plain fetch).
5. `render` absent, or the render also fails → throw, with the message updated to note a render was attempted.

Implementation shape: resolve an *effective page* first (plain, then the render fallback when plain failed and a
renderer exists), then let the existing discovery + FEED/PAGE_WATCH branch run once against that effective body. This
avoids duplicating the branch logic.

### C. Under-fetch render-and-compare (PAGE_WATCH branch only)

In the PAGE_WATCH branch, after `toc = parseToc(page.body, url)`: if the source is still `fetchMode === 'PLAIN'`
(i.e. we didn't already render in step B.4), `ports.render` is present, and `toc.length <= RENDER_ESCALATION_MAX`:

- `render(tocUrl ?? url)`, re-parse the rendered body.
- **Adopt** the rendered chapters and set `fetchMode = 'RENDER'` **only if the rendered TOC has strictly more
  chapters** than the plain one.
- Otherwise keep the plain chapters and `fetchMode = 'PLAIN'` — a genuinely small series stays cheap.

The **FEED branch does not render-escalate**: the feed is the source of truth, and rendering the landing page yields a
TOC, not more feed items. This mirrors the poll, which only escalates PAGE_WATCH.

### D. Poll regression guard

The poll's current escalation trigger is `mine.length <= RENDER_ESCALATION_MAX`
([poll.ts:276](../../../src/server/services/poll.ts#L276)): a deferred, one-way flip to `fetchMode: 'RENDER'` that never
reverses. It can't tell "JS-rendered TOC failed to load" from "genuinely tiny series", so a series that stays ≤5
chapters is pinned to expensive renders forever — and would re-pin any series add-time deliberately kept PLAIN.

Fix: change the trigger to a **regression** signal. Load `stored` before the escalation decision (move
[poll.ts:283](../../../src/server/services/poll.ts#L283) above it), then require:

```
ports.renderFetch && src.fetchMode === 'PLAIN'
  && mine.length <= RENDER_ESCALATION_MAX
  && mine.length < stored.length
```

Escalate only when a plain read comes back **smaller than what we already stored** — a real "the list stopped
rendering" signal. A genuinely small series (`read == stored`) never triggers, so it's never pinned. The deferred flip
mechanism is otherwise unchanged. A regressed read that finds 0 new chapters is harmless: `diffChapters` reports only
new / becameFree / accessReconciled and never deletes, so the next (rendered) poll simply recovers the full list.

### Limits & follow-ups

- **Silent growth behind JS is not caught by the guard.** A series genuinely small at add (correctly kept PLAIN) that
  later grows via JS-injected chapters — so plain keeps reading the small count and `stored` never grows — produces no
  regression signal. Remedy: a one-time **render-backfill** (`backfillFromToc` already accepts an injected `fetchImpl`,
  so run it with `renderPort()`). This both fills the gap and, by bumping `stored`, **arms the regression guard** — the
  next plain poll reads below the new `stored` and auto-flips the source to RENDER. So backfill needs no `fetchMode`
  change of its own. A **periodic render-reconcile** for at-risk PLAIN sources (the spike's "periodic insurance") is a
  possible future WP, out of scope here.
- **Legacy pre-WP-46 under-seeded PLAIN sources** (none in prod as of 2026-08-10) would not auto-recover for the same
  reason; the same manual render-backfill fixes them.
- **Add latency.** In the hard-fail / under-fetch cases the add request pays one render (~5–15s). Acceptable — it's the
  difference between an addable and an unaddable series, and it's a single interactive action, not a poll fan-out.

## Testing (TDD)

Add a fake `render` port to the addSeries `ports()` factory
([addSeries.test.ts:21](../../../tests/unit/server/addSeries.test.ts#L21)).

**addSeries unit:**
- Hard-fail → render succeeds → PAGE_WATCH, `fetchMode: 'RENDER'`, chapters seeded, title from the rendered body.
- Hard-fail → rendered body advertises a feed → FEED source.
- Hard-fail → render also fails → throws (updated message).
- Hard-fail → no `render` port → throws (today's behavior).
- Under-fetch → plain TOC ≤5, render yields more → adopt rendered, `fetchMode: 'RENDER'`.
- Under-fetch → plain TOC ≤5, render yields same/fewer → keep plain, `fetchMode: 'PLAIN'`.
- Plain TOC > 5 → no render call, `fetchMode: 'PLAIN'`.
- FEED branch under-seeds → no render call.

**poll unit** (extend the render-escalation cases at
[poll.test.ts:178](../../../tests/unit/server/poll.test.ts#L178)):
- Plain read < stored → escalates.
- Plain read == stored (genuinely small) → does **not** escalate.

**Integration:** `fetchMode` persists on the created `Source` row (RENDER after an add-time escalation, PLAIN otherwise).

**Verify:** `npm test` + `npm run typecheck`, fresh output, before any done claim.

## Definition of Done

- A no-feed CF host and a JS-rendered CF host can be **added** (no throw) when a renderer is configured, seeding the
  full rendered TOC, with the source persisted `fetchMode: 'RENDER'`.
- A PAGE_WATCH add whose plain TOC under-reads is seeded from the rendered TOC when render yields more, else left plain.
- The poll escalates to RENDER only on a genuine regression (`read < stored`); a genuinely small series is never pinned.
- `render` absent → add behavior is byte-for-byte today's (graceful degradation).
- All test properties above pass; `lib`/service logic written test-first; PLAN.md WP-46 flipped to DONE with a
  changelog line and the next `NEXT` set.