# WP-34 — Feed→TOC switch to lock-monitoring (backend + CLI)

**Status:** approved (owner, 2026-08-11) · **Refines:** [2026-07-26 feed-toc-transition design](2026-07-26-feed-toc-transition-design.md)
· **Depends on:** WP-33 (accessReconciled + backfill), WP-46 (render escalation), WP-20 (becameFree) — all done.

## Why this is actionable now (render clears *some* CF sites — validated)

The 2026-07-26 design marked the "switch → now-free on a feed series" slice **dormant**: the owner's locked+feed
sites are Cloudflare-challenged (their `/feed/` serves but their TOC HTML `403`s from Vercel), and it was *unproven*
whether our own renderer could clear the challenge. **Validated 2026-08-11** against a real CF site (details in local,
uncommitted notes): a POST to the deployed `/api/render` returned **`200` + the full ~100-chapter TOC** for a page that
`403`s on a plain fetch. So our renderer can pass CF's JS managed challenge from Vercel's datacenter IP for **that
class** of site.

**This is a subset, not "CF solved."** Stronger CF managed challenges still defeat headless render — some real sites
render to a challenge page, not content. So the switch below helps the **render-clearable** CF sites; the rest stay
unaddressable-via-render and remain WP-29 (manual schedule) territory. Whether a given site renders is an empirical,
per-site question — probe it before trusting the switch (see Risks).

## Problem

A `FEED` source can't see lock state or the full chapter list (both live only in the TOC), so it can't do "now free"
(WP-20). WP-33 shipped the building blocks — the **silent `accessReconciled`** dimension (UNKNOWN→FREE/LOCKED, no
push, arms the unlock event) and full-TOC backfill — but nothing yet **gets a series onto PAGE_WATCH**. Two concrete
gaps, both surfaced on real sites:

1. **CF feed site with a paywall/free-frontier** — `/feed/` serves but the TOC `403`s. `addSeries` takes the FEED
   branch (a feed was found → not a hard-fail), so **render never runs**, and the series binds to the feed with the
   TOC's chapters + lock state unread. WP-49's divert can't help (the blocked page yields an empty `pageToc`).
2. **No way to switch an existing series** FEED→PAGE_WATCH. The only mechanism is a hand-written one-row DB update (the
   `reclassify-source` gap, hit twice now in prod).

## Design (this pass: backend + CLI + in-app "Track unlocks" button)

### 1. Add-time lock-detect (`resolveFrom`)

In the FEED branch — where WP-49's divert already lives — add a trigger: `tocHasLocks = pageToc.some(c => c.access ===
'LOCKED')`. Divert to PAGE_WATCH when `(cantIsolateAdvertised && pageToc.length > RENDER_ESCALATION_MAX) ||
tocHasLocks`. A feed whose readable page-TOC shows any LOCKED chapter becomes a PAGE_WATCH source seeded from the TOC
*with* access → armed for "now free." Correct and fixture-testable; it **won't** fire for CF sites (their plain page is
blocked → no TOC read at add) — those go through the manual switch (§3/§4).

### 2. `reclassifySource` flip primitive + CLI (closes the reclassify gap)

`reclassifySource(sourceId, { render })` in `server/services` flips an owned source: `type FEED→PAGE_WATCH`,
`feedUrl→null`, `matchType→WHOLE_FEED`, `matchValue→null` (keep `url`/`tocUrl`); when `render` is set, also
`fetchMode→RENDER`. After the flip, the poll's `fetchUrl` (`feedUrl ?? tocUrl ?? url`) falls through to the TOC page.

- **Why an explicit `render`:** for a CF site the plain page `403`s, so the first PAGE_WATCH poll would read 0
  chapters — and WP-46's regression guard only escalates when `read < stored`, which fails when `stored` is 0 or the
  stored chapters are the (wrong) feed items. So the switch must set `RENDER` directly; poll auto-escalation is not
  reliable here.
- **CLI:** `db:cleanup reclassify-source <sourceId> [--render]`, dry-run by default (print the from→to plan), `--apply`
  to write. The low-level flip, for composing with `prune-chapters` — the **wrong-feed re-point** case (a single-novel
  feed carrying announcement posts while the page carries the episodes): `reclassify-source <id>` (no `--render`; page
  loads plain) + `prune-chapters <wrong ids>`.

### 3. `switchToPageWatch` — the "Track unlocks" action (flip + silent render-backfill)

`switchToPageWatch(seriesId)` composes the whole switch so the in-app button (§4) and CLI both get chapters, not just a
reclassified-but-empty source: `reclassifySource` the active FEED source, then run a **silent** backfill that
self-escalates — read the TOC plain; if that produced nothing (blocked or empty — `added === 0 && reconciled === 0`)
and a renderer exists, retry via render, persisting `fetchMode = RENDER` only when the render recovered chapters. No
pushes → no notification storm on the ~100 chapters seeded at once. Returns `{ added, fetchMode, rendered }`.

### 4. In-app "Track unlocks" button + endpoint (folded in, owner 2026-08-11)

The series detail page (WP-10) gains a per-series **"Track unlocks (switch to page-watch)"** action, shown only for a
`FEED` series → `POST /api/series/[id]/switch` → `switchToPageWatch`. Because the render-backfill can take ~5–15s, the
button carries a loading state and a result state ("Switched · N chapters · rendered"). Matches the existing
detail-page controls — no full theming pass (that's WP-28); consistency with the current "night reading" identity is
enough. This makes the switch usable without the CLI; the CLI stays for re-points and power use.

### 5. Render-capable backfill (CLI)

Extend the CLI `backfill` command with `--render`: pass `renderPort()` as `backfillFromToc`'s `fetchImpl` (the function
already accepts an injected impl) so a CF/JS TOC can be read directly (the same render-escalating read `switchToPageWatch`
uses). Backfill stays **silent** (no pushes). Run locally against prod, `renderPort()` POSTs to the deployed
`/api/render` (Vercel IP → renders the page, when that site is render-clearable).

The in-app "Backfill from TOC" button now render-escalates too, via the shared `backfillWithEscalation` helper
(same plain→render logic as the switch, factored out of `switchToPageWatch`) — it's the universal client render path.

### 6. `parseToc` stub hardening

The validated CF page interleaves unrendered Alpine.js template stubs (`<a href="chapter.permalink">`) with the real
links; `parseToc`'s current guard only skips `{{…}}`. Add a small filter for bare dotted-expression hrefs (a path
segment matching `^\w+\.\w+$` with no digit, e.g. `chapter.permalink`) so the switch doesn't seed phantom rows. Pure,
test-first.

### The arming path (already built — WP-33/WP-20)

After a switch + render-backfill, chapters are stored with the TOC's `FREE`/`LOCKED` access. A later RENDER poll that
sees a stored `LOCKED` chapter turn `FREE` fires WP-20 `becameFree` ("now free"). The first render read of any chapters
that were stored `UNKNOWN` (from a prior feed binding) reconciles silently via WP-33. No new push logic needed.

## Deferred (documented)

- **Number-keyed transition identity-reconcile** (the design's structural feed-url↔TOC-url dup risk) → rely on the
  canonical-URL diff; document the dup risk; build only when a real dual-source site exhibits it. (Owner decision,
  2026-08-11 — stays deferred: unvalidatable without a real dual-source site.)
- **Broader anchor filtering** (pagination/CTA anchors, split-TOC follow) → WP-32. WP-34 includes only the minimal
  `chapter.permalink` stub filter it needs.

(The in-app "Track unlocks" button was **folded into this WP** — §4 — per owner 2026-08-11, rather than deferred to WP-28.)

## Risks & limits

- **Render-vs-CF is site-specific — not universal.** Our renderer passes some CF managed challenges (validated) but
  **not all**; stronger challenges render to a challenge page, not content. A `--render` switch on such a site yields 0
  chapters / an unhealthy source, and it stays WP-29 (manual schedule) territory. **Probe first** (a one-off
  `/api/render` POST, or a `backfill --render` dry-run) before switching a CF site; don't assume.
- **`RENDER_URL` must target the public production domain**, not a protected deployment-hash URL (a preview URL 401s
  behind Vercel Deployment Protection). Verify before relying on poll-time render. The endpoint itself is confirmed
  working from production.
- **RENDER polls can't 304** — every poll of a switched CF series is a full render (~5–15s, counts against
  `POLL_BUDGET_MS`). Cadence gating (WP-27a) keeps this in check (READING every run; PLANNED weekly).
- **Add-time lock-detect's reach is narrow** — only non-CF locked+feed sites, of which the owner currently has none;
  its value is correctness for future such sites, not the CF sites (which the switch handles).

## Testing

- **Unit (`resolveFrom`):** a feed whose page TOC has a LOCKED chapter → PAGE_WATCH (seeded from TOC, access
  preserved); an all-FREE feed+TOC → stays FEED; WP-49's divert unaffected.
- **Unit (`parseToc`):** a TOC mixing real chapter anchors with `href="chapter.permalink"` stubs → only the real
  chapters (stub dropped); existing `{{…}}` guard still passes.
- **Integration (real DB):** `reclassifySource(id, {render:true})` flips `type`/`feedUrl`/`match`/`fetchMode`; the
  flipped source's poll `fetchUrl` resolves to the TOC page. `switchToPageWatch(id)` with an injected fake render impl
  (plain TOC under-reads → render yields more) flips the source, seeds the rendered TOC chapters **silently** (no
  effects/pushes), and persists `fetchMode = RENDER`; with a plain-sufficient TOC it stays `PLAIN`. A `--render`
  backfill seeds the TOC silently.
- **Endpoint/UI:** `POST /api/series/[id]/switch` on a FEED series returns the switch result and the source is now
  PAGE_WATCH; a non-FEED series is rejected. The button renders only for FEED series (component test or a
  webapp-testing pass).
- **CLI:** `reclassify-source` and `backfill --render` dry-run (print plan, no writes) then `--apply`.

## Definition of Done

- A **render-clearable** CF feed series can be switched to lock-monitoring **from the app** — the detail-page "Track
  unlocks" button flips it and silently seeds the full rendered TOC with access (no notification storm), and subsequent
  RENDER polls fire WP-20 "now free" on unlocks. (Sites whose CF challenge defeats headless are out of reach by design.)
- The same is reachable via CLI (`reclassify-source [--render]` + `backfill --render`), which also closes the reclassify
  gap for wrong-feed re-points.
- A readable feed site whose TOC shows locks auto-diverts to PAGE_WATCH at add.
- `parseToc` drops dotted-expression template stubs.
- All test properties pass; `lib`/service logic test-first; PLAN.md WP-34 → DONE with a changelog line + next `NEXT`.