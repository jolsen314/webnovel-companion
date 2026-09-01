# Plan — Webnovel Companion

Living plan + progress tracker. The **[README](README.md) is the design doc** (what & why); this file is the
**build doc** (in what order, split into pieces, and how far along); **[CLAUDE.md](CLAUDE.md) is the operating
manual** (working agreements + which skill/plugin to use when); **[CONTEXT.md](CONTEXT.md) is the domain glossary**
(canonical term definitions) and **[docs/adr/](docs/adr/)** holds architecture decision records. If README and this
file ever conflict, the README wins on design, this file wins on sequencing.

> **This is a living document.** Update status as work lands, re-order priorities when reality changes, and split
> or add work packages (WPs) as they come into focus. Keep the [Changelog](#changelog) current — it's the memory
> across sessions.

---

## How to use this doc

**Status legend**

| Status | Meaning |
|--------|---------|
| `TODO` | Not started |
| `NEXT` | Queued as the immediate next work (top of the stack) |
| `WIP` | In progress right now |
| `BLOCKED` | Can't proceed — see the blocker note |
| `DONE` | Merged and satisfies its Definition of Done |

**Each work package (WP) is sized for one context window.** A fresh session should be able to pick up a single WP
cold. The brief for any WP is: **read the [README](README.md) + that WP's entry below** — goal, files, dependencies,
Definition of Done, and (for the pure-logic WPs) the test properties. Nothing else required.

**Working a WP**
1. Confirm its dependencies are `DONE`.
2. Do the work test-first where the WP calls for it.
3. Satisfy the Definition of Done (DoD) — that's the contract, not "looks done."
4. Flip its status to `DONE`, add a Changelog line, and set the next `NEXT`.

**Re-prioritizing.** The order of rows in the [Work-package index](#work-package-index) *is* the priority order.
To re-prioritize, move rows and update the `NEXT` marker. Don't silently reorder without a Changelog note.

**Committed-doc hygiene.** This file is committed, so keep it anonymous: refer to sources by **framework/category**
descriptor ("a WordPress source", "a dense-feed CF host", "a concatenated-title source"), never by real site or
series name, and never name the gitignored local testing-notes file — say supporting detail is "kept in local,
uncommitted notes." Real names/URLs live only in those local notes and in scratchpad spikes.

---

## Current focus

> **NEXT: WP-28e — Shelf delete affordance.** Replace the always-visible per-card delete trash on touch with two
> better-hidden affordances (**both** wanted): an iOS-Mail-style **swipe-left-to-reveal-Delete** gesture, and an
> **"Edit" mode toggle** on the shelf head (also the non-touch / keyboard / a11y path) — desktop keeps its existing
> hover reveal. WP-28 was split into pickup-able children (2026-08-20) after its long-title readability facet
> shipped; the shelf-ordering facet (WP-28a) landed **expanded** into full shelf **sort + filter**, **WP-28b** (theme
> system) shipped, **WP-28h** (per-theme scenes/cards/detail — scroll's ink-tree+petals+rolled-scroll+wax-seal,
> sci-fi's holo env) shipped as a side effort, **WP-28i** (private theme-asset proxy — WP-28h's licensed images
> served through an auth-gated `api/theme-asset` route off a private Blob store) shipped 2026-08-29, and
> **[WP-28c](docs/PLAN-archive.md#wp-28c--feed-digest-home-and-shelf-tab-done-2026-08-31)** (feed digest home + shelf
> tab — `/` became a cross-series "what's new" digest, day-grouped and read-dimmed, with the per-series shelf moved
> to `/shelf`; filed **WP-TAGS** for genre tags) shipped 2026-08-31. Still queued: **WP-28e** (shelf delete
> affordance, NEXT) and **WP-28j** (no-flash shelf sort/filter — a flash of the unsorted shelf on nav when a
> filter/sort is saved) — priority = the **▶ Active queue** table, reorderable by the owner. WP-28b's spike
> also surfaced a fourth theme candidate + two low-pri extensions, filed as **WP-28f** (bookshelf theme), **WP-28g**
> (header quick-switch), and **WP-THEMESYNC** (cross-device persistence).
>
> **Recently landed:** see **[docs/CHANGELOG.md](docs/CHANGELOG.md)** (newest first) and the ✅ Completed table below.
>
> **Standing constraints to keep in mind:**
> - **Poll budget × cadence** (WP-41/43): the daily run self-limits to `POLL_BUDGET_MS` (270s) and rotates stalest-first;
>   the 2h PLAIN trigger costs ~40 Neon compute-hr/mo — **don't drop below 2h** without re-checking Neon's ~191 hr/mo.
> - **Cloudflare hosts need render** (WP-40, parked): CF blocks Vercel's **datacenter IP**, not the TLS fingerprint, so
>   only a real browser (render) or a residential IP clears it — no cheap code-only GET. See the WP-40 detail in
>   [docs/PLAN-archive.md](docs/PLAN-archive.md).

The MVP is **live on Vercel + Neon** — feed pipeline, auth gate, library/detail UI, **Web Push** (WP-09, device-verified),
the **headless renderer** (WP-17b), **paid→free "now free"** (WP-20, per-chapter off the TOC → privacy-safe push),
**status-gated + cadence polling** (WP-27a), and **add-time dedup** (WP-39). (Real site/series names for testing are kept
in local, uncommitted notes.)

---

## Milestones

Mirrors the README [Roadmap](README.md#roadmap) tiers, expressed as shippable milestones.

- **M0 — Tested core + MVP** (Tier 0): the pure engines (diff/health) under test, then library + feed polling +
  Web Push + manual progress, deployed as an installable PWA. (SM-2 moved to M3 — see below.)
- **M1 — Sources & shelves** (Tier 1): feed auto-discovery + page-watch fallback, completed shelf, dedup/search,
  paid→free tracking, source-down detection + non-destructive re-pointing, plan-to-read completion watch.
- **M2 — Progress automation** (Tier 2): MV3 browser extension for current-chapter capture.
- **M3 — Vocabulary + SRS** (Tier 3): Chinese in-process mining → SM-2 review; then Korean via the Python sidecar.
- **M4 — Extras** (Tier 4): TTS, offline caching, Anki export, multi-user.

---

## Work-package index

**Active-queue row order = priority** — the top of that table is what's next (marked `NEXT`). Completed and
later-tier tables are reference only. `⭐` = load-bearing.

### ▶ Active queue (M1) — row order = priority

| ID | Work package | Status | Depends on |
|----|--------------|--------|------------|
| WP-28e | Shelf delete affordance — hide the always-visible per-card delete (WP-51) by default and expose it two ways (**both** wanted): (1) an iOS-Mail-style **swipe-left-to-reveal-Delete** on touch, and (2) an **"Edit" mode toggle** on the shelf head that reveals the per-card delete buttons (also the non-touch / keyboard / a11y path). Keep the confirm + the tap-through guard on both | `NEXT` | WP-10, WP-51, WP-28a |
| WP-28f | Bookshelf theme — gothic/Victorian palette + book-stack shelf layout | `TODO` | WP-28b, WP-28a, WP-28e |
| WP-28j | No-flash shelf sort/filter — navigating to `/` with a saved sort/filter briefly shows the unsorted/unfiltered shelf before it snaps to the persisted view. The control state lives in `localStorage` and is applied client-side after mount; pre-apply it before paint (reuse WP-28b's no-flash pattern) or render the shelf from the persisted state | `TODO` | WP-28a, WP-28b |
| WP-TAGS | Series tags (genre) — a detail-page tag editor (like notes/rating) + shelf-card display of the first tag(s) in the slot **WP-28c** frees (the dropped latest-chapter line) + a tag filter on the shelf; a feed use later. Filed by WP-28c. **UI-only — the `tags String[]` column already exists on `Series` (unused), so no migration / no WP-04 pause.** | `TODO` | WP-10, WP-28c, WP-28a |
| WP-55 | Decode HTML entities in **API-source** chapter titles — `decodeHTML` in `parseApiChapters` (feed/TOC paths already decode) + a one-off script to fix stored API-source rows | `TODO` | WP-45 |
| WP-56 | Fix `parseToc` lock-detection false positives — **`LOCK_CLASS` matches "lock" inside "b`lock`"** so *every WordPress block-theme source* (`wp-block-*` classes) marks **all** chapters `LOCKED`; also `LOCK_TEXT` matches generic title words ("coin"/"premium" in a chapter title) and the lock **scope** is a whole shared content `<div>` (bare-anchor TOCs) that taints every row. Use class-**token boundaries** (not substring), gate lock state on markers not free text, and don't treat a giant shared container as a per-chapter row. **Data-correctness** (a real source had 556 free chapters all shown locked; fixed in prod by hand). **Drivers (local IDs):** block→lock confirmed on B01 (×5 series) + B02 (`wp-block` classes, 0 real lock markers); B03 is a **non-block variant** (0 `wp-block` — a shared big scope + a stray `LOCK_TEXT` token elsewhere on the page taints all rows) | `TODO` | WP-17, WP-20 |
| WP-58 | Chapter **title + number extraction** cleaning (pulled out of WP-32) — (a) **title cleaning**: strip trailing dates/labels/badges/CTA and de-duplicate a doubled "Chapter N Chapter N", and handle **no-separator `Ch.<seq>`+label joins** (a custom source jams `Ch.N` onto the raw label with no space → garbled titles *and*, when the label starts with a digit, a merged number); (b) **URL-slug number authority**: when the URL path has a **delimited** `/chapter-<N>-` (or `/ch-<N>-`, …), trust *that* over a title-derived number (the concatenated-title source stores ch 2 as **#202**, ~110 wrong) — the noisy title stays the display name; (c) the **slug/label off-by-one** + **non-numeric prologue** reconciliation from the split-TOC source. Matters for **WP-35** (its direction-normalize reads the number *trend*). **Data-correctness.** **Drivers (local IDs):** B03 (no-separator + slug authority), B15 (×3), B14, B13, B06, B10, B05 | `TODO` | WP-32, WP-35, WP-30 |
| WP-30c | *(sub-WP of WP-30 — landed)* Title extraction: reject **non-content headings** beyond the WP-30b consent-banner list — blog name, site tagline, feed title, "Index: <name>", bare site name, "Chapter List" — and **prefer a landing-page heading**; also fix a **pre-hydration render-timing capture** (a SPA's live h1 is correct but the render grabbed the pre-hydration DOM → stored the tagline). **Drivers (local IDs):** B04 (blog name), B05 (tagline + pre-hydration), B06 (feed title), B01 ("Index:"), B07 (site name), B08 ("Chapter List") | `TODO` | WP-30, WP-30b |
| WP-37b | *(sub-WP of WP-37 — landed; **speculative — driver migrated**)* Discovery **follows an on-page TOC link** landing→TOC when the landing has the correct title but **0 chapter links** — match a **family** of link labels, not one exact string: "chapter list", "**full** chapter list", "table of contents", "all chapters", "view/see all chapters", "read chapters". Take the **title from the landing**, chapters from the linked TOC. **Note:** the concrete driver **B08 migrated (2026-08-31) to an in-page XHR chapter API** (separate `/chapter-list` page now 308-redirects) → it's a **WP-54 / WP-45** case now, not this; WP-37b has **no confirmed driver** left (the "Full Chapter List" revamp anecdote's URLs had 404'd). Keep low-priority as a general pattern. | `TODO` | WP-37, WP-30 |
| WP-49b | *(sub-WP of WP-49 — landed; reopenable gap)* WHOLE_FEED divert still leaks two feed shapes — a multi-series site **"Latest Chapters" feed** (other novels' chapters) and a **comment-feed** bound as WHOLE_FEED (entries like "By: <user>"). WP-49 diverts *un-isolable* multi-novel advertised feeds to page-watch; these slip through. **Drivers (local IDs):** B06 (multi-series WHOLE_FEED), B09 (comment-feed WHOLE_FEED) | `TODO` | WP-49 |
| WP-59 | *(speculative — no confirmed driver)* Add via a **site-wide feed with series isolation** when the page is CF-blocked from Vercel **but the feed stays open** — `addSeries` drops to **link-only** if the page fetch fails and there's no per-series feed, even when the host publishes a dense multi-series `/feed/`; bind to that feed with a `PATH_PREFIX`/`CATEGORY` matcher. **The candidate (B15) was live-tested 2026-08-31 and its `/feed/` is *also* Vercel-gated (`HTTP_4XX`)** → B15 is a **WP-60** case, not this; so WP-59 needs a host whose page is blocked *and* dense feed stays open *and* has no per-series feed — none confirmed (B19 leaves its feed open but uses per-novel feeds). **Keep regardless for the flat-slug matcher fix:** chapters like `/<slug>-chapter-N/` need the `PATH_PREFIX` value **without** the trailing-slash `seriesPath` that `chooseSeriesMatch` uses today — an independent correctness bug for any flat-slug host isolated by path. | `TODO` | WP-49, WP-46 |
| WP-60 | **Residential TOC hand-off — capture locally, upload to ingest** — an owner-authed `POST /api/ingest-toc { sourceId, html }` that runs the pure `parseToc` on **client-supplied** HTML and seeds/backfills chapters, **bypassing the Vercel-IP CF block for the initial fill** (one-liner: `curl <toc> | curl -X POST …/ingest-toc --data-binary @-`). Reuses `parseToc`→`withReadingPositions`→`diffChapters`→persist (the `backfillFromToc` path minus the server fetch). **Design forks:** (a) *seed vs repair* — `diffChapters` is additive (never deletes), so it seeds an empty series cleanly but needs an explicit **replace mode** (guarded against under-read deletion) to fix over-capture; (b) auth via a bearer token + `isPublicPath` allowlist (like `/api/render`); (c) `sourceId` supplies baseUrl + any `SiteTocConfig`. **Scope:** fixes *reachability*, not parse quality (still over-captures until WP-58/WP-32). **Driver (local ID):** B15 — the **confirmed** case: page *and* `/feed/` are **both** Vercel-gated (feed disproved 2026-08-31), so a residential upload is the only from-your-machine path. | `TODO` | WP-33, WP-17 |
| WP-18 | Completed shelf + backfill + "Move to Completed?" | `TODO` | WP-10 |
| WP-19 | Non-destructive re-pointing + "find new source" helper (also: on a duplicate add (WP-39), optionally offer to attach the pasted URL as an **alternate source** on the existing series rather than only rejecting) | `TODO` | WP-16, WP-18 |
| WP-CLEANUP-UI | In-app cleanup surfacing `db:cleanup` (**merge** series, delete/reset chapters, edit source/TOC URL) — **merge** doubles as the manual same-work/different-translation resolver, the target of the add-page "Merge" affordance from WP-39b's create-then-annotate flow. *(Series-**delete** split out to WP-51.)* | `TODO` | WP-10 |
| WP-16 | Host-level health aggregation (site-down vs novel-moved) | `TODO` | WP-03, WP-07 |
| WP-13 | `lib/completion.ts` (pure) — plan-to-read heuristic | `TODO` | WP-00 |
| WP-21 | Plan-to-read completion watch (wire WP-13 + notify) — compare **max chapter number** vs target, not post count | `TODO` | WP-13, WP-07 |
| WP-27b | Per-status positive notify rules — PLANNED paid → fire at 0 LOCKED; PLANNED free → fire at targetChapterCount; wire with WP-20/WP-21 | `TODO` | WP-20, WP-21, WP-13 |
| WP-14 | `lib/dedup.ts` (pure) — "already read this?" | `TODO` | WP-00 |
| WP-EXPORT | One-click data export (`/api/export` → JSON) — own-your-data insurance | `TODO` | WP-AUTH |
| WP-54 | **API-source auto-probe + human docs for the API switchover** — the add-time `probeForApi` (WP-45) auto-detects only the **static-JSON SPA** shape (`data-*` → `.json`), not an **XHR-fetched** REST chapters API behind CF (the `…/v1/chapters?category=<id>` shape — manual today: render, watch the network tab, hand-build `--map`, `set-api-descriptor`; a `/local/` helper now scripts it for one site). Add a **render/XHR API detector** (infer url/title/lock fields + pagination + per-series id) + a **`db:cleanup probe-api <sourceId>`** command, and a **human guide** (new `docs/` page linked from README): the CF taxonomy, how to spot a usable JSON chapter API, the field-map/pagination/`per_page` gotchas, and a "can this site leverage the API path?" checklist. *(Auto-probe is convenience; the docs are the priority.)* **Drivers (local IDs):** B27, B08 — both **XHR-plain**, slug-keyed REST chapter APIs (B08: `GET /api/novel/chapter-list?slug=<slug>` → `{order,title,published_at}`, plain 200) that the static-JSON probe misses; both also need the `urlTemplate` enhancement below. | `TODO` | WP-45, WP-53 |
| WP-RETRY | *(low)* Retry / auto-upgrade a link-only source — a manual "retry fetching chapters" that re-runs resolution on a `linkOnly` source and upgrades it to a tracked FEED/PAGE_WATCH source when the site becomes reachable (renderer added, feed appears, URL fixed) | `TODO` | WP-50, WP-17b |
| WP-28g | *(low)* Theme header quick-switch — a header control to cycle/menu themes from anywhere, instead of only via the settings page. Owner-requested extension. **Fold in (noted from WP-28b final review):** re-sync the `theme-color` meta on client-side *soft* navigation — Next re-asserts the root `viewport.themeColor` on soft nav, briefly reverting the browser/PWA status-bar tint to night until a hard reload (app UI stays correctly themed); a header control that owns theme state is the natural place to re-apply it | `TODO` | WP-28b |
| WP-THEMESYNC | *(low)* Cross-device theme persistence — persist the theme choice server-side (e.g. alongside notification prefs) so it follows the user across devices instead of per-origin localStorage. Owner-requested extension | `TODO` | WP-28b, WP-AUTH |
| WP-32 | *(low)* `parseToc` **chapter-list** robustness — follow split/paginated sibling TOCs (bounded "next chapters" hops) + **all non-chapter anchor filtering** (pagination anchors + shortcut/CTA anchors: "Last chapter"/"Read"/"Start reading"/"New/First Chapter"/"Chapter list"→`javascript:;`/empty — drivers local IDs B03, B05, B07, B08, B10, B12, B14, B15). *Chapter title/number **extraction** cleaning moved out to **WP-58***. | `TODO` | WP-17, WP-35 |
| WP-47 | *(low)* Client resubscribe on VAPID key mismatch — `resyncSubscription` re-posts a stale browser sub whose `applicationServerKey` ≠ current key, so a 403-pruned sub churns (prune→re-add) and the client shows "subscribed" while receiving nothing; detect the key mismatch on load and unsubscribe + re-subscribe under the new key. Makes key rotation self-healing on the client | `TODO` | WP-09 |
| WP-APIZERO | *(low)* API-source parsed-zero regression signal — when an API source's fetch succeeds (200) but `parseApiChapters` yields fewer chapters than stored (or 0 while stored > 0) — a misconfigured descriptor or a drifted API shape — surface a health nudge / re-probe instead of failing silently. Today an API source has no escalation (render escalation is PAGE_WATCH-only), so a broken descriptor looks identical to a healthy-but-quiet source. Mirror PAGE_WATCH's `read < stored` regression signal (`poll.ts`). Non-destructive (`diffChapters` never deletes). Sibling to WP-16 (host health) / WP-45b | `TODO` | WP-45, WP-16 |
| WP-PAGECOST | *(low)* Poll time-budget under-counts paginated PLAIN API groups — `groupCostMs` (`poll.ts`) charges a paginated PLAIN API source group a single flat `PLAIN_COST_MS`, but `fetchApiPages` may issue up to `maxPages` (default 20) sequential GETs for that one group. Low risk today (270s budget, few cadence-gated paginated API sources), but the guard's wall-clock estimate under-costs any group whose pagination actually spans multiple pages. Revisit by weighting a paginated PLAIN group's cost by an expected/observed page count instead of the flat constant. Sibling to WP-41 (poll time-budget guard) / WP-45b | `TODO` | WP-41, WP-45b |
| WP-53 | *(low — convenience; the poll is generally sufficient)* Make backfill API-aware + re-enable its button on API sources — `backfillFromToc`/`backfillPorts` only page-watch `source.url`, so an **API source (WP-45) can't be backfilled** (CLI / route / `switchToPageWatch` seed no-op → `added 0`); only the **poll** populates it. Teach the backfill path the poll's `apiUrl ?? feedUrl ?? tocUrl ?? url` + `apiMap` + `fetchApiPages`/`parseApiChapters`, and un-hide the "Backfill from TOC" button for `type === 'API'` (gated off in `SeriesDetail.tsx` during WP-45) | `TODO` | WP-45, WP-33 |
| WP-WORKID | *(low, future)* Map a source to a community novel-aggregator's canonical work ID (lists a work's alternative/translated titles) for automatic cross-translation identity — described generically here (no real aggregator name, anonymity rule) | `TODO` | WP-05, WP-17 |
| WP-31 | Renderer per-host interaction descriptor — clicks Free/Premium **tabs** (+ tab-membership access), **client-side numbered pagination** ("Prev/Next" TOCs that replace ~50/page → click Next & union pages), **and (folded in 2026-08-25) endless-scroll + RSC load-to-completion** — scroll-to-load lists and Next.js RSC lists that render only a partial window need a scroll/settle loop until the count stops growing, then union. **Where a source exposes a chapter API, WP-45 supersedes this**; but the 2026-08-25 batch found **none** of these interaction sources exposes a usable plain API (all RSC / pagination / endless-scroll / auth-gated), so render interaction is the only path for them — a large missing-chapter cluster. **Drivers (local IDs):** B10 (6/1300, RSC), B11 (5/1364, paginate), B12 (47/1215, paginate), B13 (52/152, endless-scroll), B14 (100/~194, load-more incomplete), B05 (partial RSC). | `TODO` | WP-17b, WP-20 |
| WP-SIMPLIFY | *(low, ongoing — pick up opportunistically)* Behavior-preserving code simplification — the backlog of DRY/clarity/consistency refinements found by a read-only `code-simplifier` pass. **Details, ranked tiers, and the explicit "don't touch" list live in [SIMPLIFICATION-PLAN.md](SIMPLIFICATION-PLAN.md)** — not enumerated as WPs here. Both structural items landed (**A1** `backfill` pure-core extraction out of `services/index.ts`; **A2** Puppeteer out of `api/render/route.ts`) and the entire ranked backlog (Tiers B, C, D) is now worked through as of 2026-08-18 — the row stays open only to re-run the `code-simplifier` against future drift. Follow project rituals (TDD for `lib/`, `npm test` + `typecheck` before "done"). | `TODO` | — |

### ✅ Completed

WP-00, WP-GH, WP-CI, WP-12 (bootstrap / CI / docs) · WP-01, WP-03 (pure diff / health) · WP-04, WP-05, WP-FE (schema, feed parse/discover, fetcher) · WP-06, WP-07, WP-08 (Next shell, services, API) · WP-09, WP-10, WP-AUTH, WP-11 (Web Push, library/detail UI, auth gate, deploy) · WP-17, WP-17b (page-watch + headless renderer) · WP-20 (paid→free "now free") · WP-33 (full-TOC backfill + `accessReconciled`) · WP-35 (TOC-order chapters + display toggle) · WP-36 (`parseToc` content scoping) · WP-38 (contaminated-series recovery script) · WP-42 (poll-once-per-feed + politeness) · WP-41 (poll time-budget guard + rotation) · WP-43 (frequent PLAIN-tier polling) · WP-27a (status-gated + cadence polling) · WP-39 (add-time dedup) · WP-37 (per-series chapter-TOC URL) · WP-30b (title extraction: consent-`<h1>` reject-list + HTML-entity decode) · WP-29 (manual release-schedule editor — link-only-gated) · WP-28d (locked-chapter marker + hide-locked filter on the detail page) ·
WP-39b (deeper add-dedup, re-scoped: tocUrl page-watch keying + create-then-annotate) · WP-48 (Blogger feed-path in `guessFeedUrls`) · WP-46 (add-time render escalation + poll regression guard) · WP-49 (page-watch divert for un-isolable multi-novel advertised feeds) · WP-34 (feed→TOC switch to lock-monitoring) · WP-30 (series title backfill + manual title-edit UI) · WP-51 (client-side delete series — detail + shelf) · WP-PW (Playwright E2E harness + WP-10/30/34/51 coverage + CI job) · WP-50 (link-only add when chapters can't be read) ·
WP-45 (API-first adapter, plain-REST slice) · WP-45b (CF-gated render transport + paginated API sources) ·
WP-NOTES (detail-page notes UI — collapsible, save-on-blur, content-aware default + truncated preview) ·
WP-52 (poll-time hard-fail render escalation — PAGE_WATCH PLAIN + Cloudflare 403 → persist RENDER) ·
WP-28a (shelf sort + filter — pure `lib/shelf.ts` [4 sort modes + status/title/min-rating filter] behind a client control bar, localStorage-persisted; **subsumes WP-15** `lib/search.ts`) ·
WP-28b (theme system — `[data-theme]` token architecture + pre-paint inline-script/localStorage no-flash + settings picker; night/scroll/sci-fi; `--color-on-glow` tokenized) ·
WP-28h (per-theme scenes/cards/detail — scroll ink-tree+petals+rolled-scroll cards+wax-seal badge+opened-scroll detail; sci-fi holo env: glassy chrome + grid/binary-flicker/glitch/shimmer + HUD glass cards/detail; hydration-safe deterministic scatter; reduced-motion-gated; licensed assets via Vercel Blob with tree-hidden/red-circle onError fallback; hero "here" de-emphasized — the one night-visible change). ·
WP-28i (private theme-asset proxy — licensed images via an auth-gated Blob route) ·
WP-28c (feed digest home + shelf tab — cross-series new/now-free digest at `/`, shelf moved to `/shelf`; filed WP-TAGS) ·
WP-57 (`parseToc` cross-series-card exclusion + series-slug scoping).

### ⏭ Later tiers (M2–M4)

| ID | Work package | Milestone | Depends on |
|----|--------------|-----------|------------|
| WP-22 | MV3 browser extension (progress capture + "track this") | M2 | WP-08 |
| WP-23 | Chinese mining: `tokenize/zh.ts` + `dict/cedict.ts` | M3 | WP-04 |
| WP-02 | `lib/srs/sm2.ts` (pure, test-first) — SM-2 scheduler | M3 | WP-00 |
| WP-24 | Vocab capture + SM-2 review UI (wire WP-02) | M3 | WP-02, WP-23 |
| WP-25 | Korean sidecar (`services/korean-nlp`) + `tokenize/ko.ts` | M3 | WP-23, WP-24 |
| WP-PASSKEY | Auth upgrade: passkeys / WebAuthn (passwordless, phishing-resistant) | M4 | WP-AUTH |
| WP-26 | Extras: TTS, offline caching, Anki export, multi-user | M4 | — |

### 🚫 Parked

- **WP-40** — cheap CF bypass via a local browser-TLS-impersonation GET. Spike (2026-07-28) proved TLS impersonation
  can't clear the Cloudflare **JS managed challenge** (triggered by Vercel's datacenter IP, not the fingerprint); only
  a real browser (render) or a residential IP we control clears it. Revisit = third-party unblocker (privacy tradeoff +
  likely the same poll-budget limit). See the archived WP-40 detail ([docs/PLAN-archive.md](docs/PLAN-archive.md)) + [changelog](docs/CHANGELOG.md).

---

## Near-term work packages (detail)

> **Shipped WPs' detail lives in [docs/PLAN-archive.md](docs/PLAN-archive.md).** When a WP flips to `DONE`, move its
> `### WP-NN` detail section there, leaving only its ✅ Completed-table one-liner here — keeps this tracker from
> growing without bound.

### WP-02 — `lib/srs/sm2.ts` (pure, test-first) — ⬇ deprioritized to M3

> **Deprioritized 2026-07-16** to the vocabulary tier (M3), consumed by WP-24. Spec kept below for when we build it;
> not part of the near-term MVP queue. Decided design: **classic SM-2** (ease updates on every review, floored at 1.3).

**Goal:** the SM-2 spaced-repetition scheduler. Given a card's current SRS state and a review grade, return the next
state (interval, ease, repetitions, due date).

**Signature (proposed):**
`schedule(state: Sm2State, quality: 0|1|2|3|4|5, now: Date): Sm2State` — `now` injected for purity/testability.

**Test properties (write these first)**
- **Advance on success** (`quality >= 3`): repetitions increment; interval follows SM-2 (1 → 6 → `round(prev * ease)`).
- **Ease update + clamp**: `EF' = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02))`, floored at **1.3** (never below).
- **Lapse resets** (`quality < 3`): repetitions → 0, interval → 1; ease is *not* dropped below the floor.
- **Due date** = `now + intervalDays`, and is strictly later after a successful review.
- **Pure** — same inputs → same output; `now` is a parameter, no `Date.now()` inside.

**Definition of Done:** properties above under Vitest; state shape matches the `VocabCard` SRS fields in the README
data model (`intervalDays`, `easeFactor`, `repetitions`, `dueAt`, `lastReviewedAt`) so WP-24 can persist it directly.

---

## Spike findings — real feed fetching (2026-07-16)

Throwaway spikes (`scratchpad/feed-spike.mjs`, `feed-spike2.mjs`) probed 5 real series across a custom-app source,
a WordPress source, a multi-novel WordPress source, a JS-rendered source, a Cloudflare-challenged source. Verdicts:

- **guid varies, exactly as feared → our guid-AND-url matching is validated.** a custom-app source: guid = chapter permalink
  (`isPermaLink=true`). WordPress (a WordPress source, a multi-novel WordPress source): guid = opaque `?p=ID` (`isPermaLink=false`) ≠ link.
- **Chapter links validated; utm-stripping validated.** a WordPress source links carry `?utm_source=rss&utm_medium=…`.
  Links also arrive **HTML-entity-encoded** (`&#038;`) → WP-05 must use a real XML parser (rss-parser) to decode
  before canonicalizing, not regex.
- **Split-chapter convention confirmed in the wild:** `"…Part 2 Chapter 407: Night and Light (3)"`.
- **Conditional GET is not universal.** WordPress → clean `304`. a custom-app source (custom) → **no ETag/Last-Modified**. The
  poller must treat conditional GET as an optimization, degrading to full refetch + diff.
- **Feed granularity is the big finding:** discovered/available feeds are often **site-wide, multi-novel**
  (a multi-novel WordPress source `/feed/` = ~20 novels; a WordPress source = 4). Isolate a series by per-novel **`<category>`** (primary)
  or **URL-path prefix** (backup). BUT shared feeds are **capped (10–30 items)**, so a slow series can fall off the
  window → **prefer a per-series/category feed; filter the shared feed only when no per-series feed is reachable.**
- **Locked/paid chapters are a page-watch/DOM concern.** a JS-rendered source marks them structurally
  (`.chapter-status.premium`, gold) and advertises **no feed** → page-watch mandatory; free frontier = highest
  chapter without the lock marker. Confirms README's per-site adapter model. → affects **WP-17, WP-20**.
- **Cloudflare is a first-class obstacle.** a Cloudflare-challenged source page + a multi-novel WordPress source series page hard-403'd our bot,
  though `/feed/` sometimes still served. WP-05/WP-17 need realistic browser headers, a feed-even-when-page-blocked
  path, and headless-browser (Playwright) escalation for stubborn sites.

**Design response (proposed):** `Source` gains a **series matcher** (`WHOLE_FEED | CATEGORY | PATH_PREFIX` + value),
set at add-time; filtering runs upstream of the (still pure) `diffChapters`. See the README data-model proposal.

## Source-fetching strategy (folded from the spike)

**Fetch-strategy ladder — per Source, pick the highest reachable rung at add-time:**
1. **Per-series / category feed** — series-scoped, immune to feed density. WP category feed
   (`/category/<slug>/feed/`) or a native per-series RSS (a native per-series RSS). **Preferred.**
2. **Site feed + matcher** (`matchType` CATEGORY/PATH_PREFIX) — cheap, but the feed window is *capped* (10–30
   items), so a slow series on a busy multi-novel site can be missed between polls. Only safe when the series
   updates often relative to site volume.
3. **Page-watch the series TOC** — series-scoped source of truth: complete chapter list + the only place lock
   state lives. Same machinery as feedless/locked-site handling, reused.

**Density fallback = rung 3 (page-watch).** When we drop to it:
- **Add-time (primary):** multi-novel site feed + no reachable per-series feed → prefer rung 3 (or rung 2 *with*
  reconcile) from the start.
- **Runtime miss-detection (safety net):** trigger an immediate TOC scan on a **chapter-number gap** (stored ch50
  → next feed sighting ch55) or **feed-window saturation** (feed's oldest item advances past the series' expected
  cadence while the series never appears).
- **Periodic insurance:** at-risk Sources get a full TOC reconcile on a slow cadence (~daily) regardless.

Trade-off: feed = cheap/fast but lossy on dense sites; TOC = complete + carries lock state but heavier and more
Cloudflare-exposed. A hybrid (feed as fast trigger, TOC as periodic source of truth) is possible — defer until a
real series needs it.

**Page-watch is primary, not a fallback, for two common cases (owner, 2026-07-22):**
1. **Dense feed × daily cadence = permanent misses.** A capped window (10–30 items) polled once/day means a busy
   multi-novel site can publish more than a window's worth between polls, so a tracked novel's chapter appears *and
   rolls off* before we ever poll it — it's never caught by the feed. The series-scoped TOC (page-watch) is immune.
2. **Paid/advance sites: the feed is the wrong signal.** The RSS item fires when a chapter is *published* — usually
   **locked**. The valuable event, *becoming free* (the free frontier advancing, WP-20), never re-emits in the feed;
   it lives only in the TOC lock markers. So for paid-heavy sites (e.g. a Cloudflare-challenged source), feed tracking pings locked
   chapters you can't read and misses the unlocks that matter — **page-watch is the core mechanism, feed is degraded.**

→ This raises the real-world priority of **WP-17 (page-watch)** + **WP-20 (free frontier)** + a **Cloudflare-capable
fetch** (headless browser) above their nominal M1 slot for the owner's actual reading (dense, paid-heavy, CF-guarded
translator sites). Revisit ordering.

**Per-WP sub-tasks folded from the spike:**

- **WP-05 (feed parse + discovery):** use rss-parser (decode HTML-entity URLs like `&#038;` before canonicalizing);
  discovery detects site-wide vs per-series and probes for a category/per-series feed; extract per-item
  `<category>` and set `matchType`/`matchValue` at add-time; realistic browser headers; tolerate Cloudflare
  403-on-page while `/feed/` serves; treat ETag/Last-Modified as optional.
- **WP-17 (page-watch):** TOC fetch + chapter-list extraction (series-scoped); per-site DOM adapters; lock-marker
  parsing (e.g. `.chapter-status.premium`); Cloudflare escalation with realistic headers and a headless-browser
  (Playwright) path for hard-blocked sites. Doubles as the rung-3 density fallback and the locked-frontier reader.
- **WP-20 (paid→free):** read access state per chapter from the TOC adapter; free frontier = highest non-locked
  chapter; fire "now free" on frontier advance (distinct event from "new chapter"); feeds usually omit locked
  chapters, so lock state comes from page-watch.
- **WP-46 (dense-feed reconcile):** miss-detection (number gap + feed-window saturation) → immediate TOC scan;
  periodic reconcile for at-risk Sources; may add `lastReconciledAt` + a feed-window marker to `Source` (defer to
  the WP-04 DB pause). **Also the escalation for the add-time "couldn't isolate" case** (below): a series added with
  a best-effort slug/path filter but no chapters, that never fills after N cycles, should escalate to page-watch.

**Add-time isolation fallback (built 2026-07-22).** When a series' only reachable feed is a **site-wide, multi-novel**
one and the novel isn't in the current window, `addSeries` does *not* reject or grab the wrong novel — it adds the
series (correct title from the URL) with a **series-scoped guess** (`fallbackSeriesMatch`: category-slug if the feed
is categorized, else URL path). It shows 0 chapters until the novel next publishes, when the filter captures it from
the feed. If it never fills, WP-46 escalates to page-watch. **Cloudflare caveat:** where the *page* is JS-challenged
(e.g. a Cloudflare-challenged source — 403 `cf-mitigated: challenge`) plain page-watch also fails; ongoing releases still arrive via
`/feed/` (which isn't challenged), but backfill/true page-watch needs a **headless-browser escalation** (separate
service; not Vercel serverless) or an unblock service — best-effort per the README. Near-term workaround: track such
a novel via its NovelUpdates feed instead.

### WP-28 — Frontend styling & theming (umbrella)

UX-polish program on the shipped library/detail UI (WP-10). **Split into pickup-able children (2026-08-20)** so each
facet can be taken cold in its own session: the **long-title readability** facet shipped (below, DONE), and
**[WP-28a](docs/PLAN-archive.md#wp-28a--shelf-sort--filter-done-2026-08-25)** (shelf sort + filter) and
**[WP-28b](docs/PLAN-archive.md#wp-28b--theme-system-done-2026-08-28)** (theme system) have now shipped too, alongside
a follow-on side effort, **WP-28h** (per-theme scenes/cards/detail — scroll's ink-tree+petals+rolled-scroll cards+
wax-seal badge+opened-scroll detail, sci-fi's full holo env of glassy chrome + grid/binary-flicker/glitch/shimmer +
HUD glass cards/detail; hydration-safe deterministic scatter, reduced-motion-gated, licensed assets served via Vercel
Blob with a tree-hidden/red-circle `onError` fallback, and the one night-visible change — the hero "here" no longer
emphasized; detail in [docs/superpowers/plans/2026-08-28-wp28h-theme-scenes.md](docs/superpowers/plans/2026-08-28-wp28h-theme-scenes.md),
no `### WP-28h` PLAN section since it didn't reorder the active queue); **[WP-28c](docs/PLAN-archive.md#wp-28c--feed-digest-home-and-shelf-tab-done-2026-08-31)** (feed digest home + shelf
tab, DONE) has now shipped too; the remaining facet is
**[WP-28e](#wp-28e--shelf-delete-affordance-swipe-to-delete--edit-mode)** (shelf delete affordance — swipe-to-delete +
edit mode, NEXT) — plus a later add, **[WP-28d](docs/PLAN-archive.md#wp-28d--locked-chapter-display-dim--marker--filtersort-done-2026-08-21)**
(locked-chapter display / filter / sort, DONE). WP-28b's design pass also spawned **[WP-28f](#wp-28f--bookshelf-theme)**
(bookshelf theme, spiked feasible) and two low-priority owner-requested extensions, **WP-28g** (header quick-switch) and
**WP-THEMESYNC** (cross-device theme persistence). All use `frontend-design` (primary) + `ai-toolkit:design-workflow` for
tokens, each gets its own brainstorm → spec, and all depend on WP-10 (done). Two small **residual polish items** — the add-page "similar series"
notice and the HTML-entity display-decode catch-all — stay under this umbrella (below the readability note); they're
minor and not blocking any child.

**Long chapter titles must be fully readable (owner, 2026-07-28) — DONE 2026-08-20.** Shipped **wrap-by-default** for
the detail-page chapter rows: `.chapter__title` dropped `overflow/ellipsis/nowrap` (so long titles like "…Part 2
Chapter 407: Night and Light (3)" wrap to as many lines as needed), and `.chapter` flipped `align-items:center →
flex-start` so `#num` + `mark read` stay top-aligned on a tall wrapped row rather than vertically centered (a small
`.chapter__num` `padding-top` cap-aligns the mono number with the title's first line). The shelf **series title**
(`.card__title`) got a **2-line `-webkit-line-clamp`** (owner's call); the shelf **latest-chapter line**
(`.card__latest`) was left one-line. CSS-only ([`globals.css`](src/app/globals.css)); verified in the running app with
seeded long titles + Playwright. The other WP-28 facets (ordering, feed-vs-library split, theme system) remain.

**Add-page "similar series" notice polish (WP-39b follow-up, 2026-08-10).** When the add page shows the non-blocking
"looks similar to X" notice ([`add/page.tsx`](<src/app/(app)/add/page.tsx>)), the URL input + "Add series" form stays
mounted below it, so a second submit is possible while the notice is up. It's benign (a re-submit of the same URL hits
hard-dedup → `alreadyExisting` 200 → redirect, so no duplicate), but it reads awkwardly stacked. Polish in the design
pass: hide/disable the form (or clear the input) while the notice is shown, or fold the notice into a cleaner
post-add result state.
> **Also unify the link-only path (WP-50 parked minor, 2026-08-17).** The normal add surfaces the `similarTo`
> "looks similar to X" hint, but the **link-only** confirm path (`addLinkOnly` in `add/page.tsx`) redirects to `/`
> on success **without reading `similarTo`** — the server still computes + returns it for a link-only create, so a
> link-only entry that fuzzy-title-matches an existing series won't show the nudge. Low-impact (exact dupes are
> still collapsed by `canonicalSeriesId`; this is only the soft title hint), and fixing it needs the confirm panel
> to gain a success-with-similar-notice state. Fold into this notice rework so both add paths surface `similarTo`.

**HTML-entity-encoded titles must render as their glyphs (owner, 2026-08-11).** A title whose apostrophe shows as the
raw entity `&#8217;` (e.g. *"…I&#8217;ll…"* instead of *"…I'll…"*) — also seen with `&#8216;`/`&#8220;`/`&#038;`/`&nbsp;`
— reads as a code, not the character. **Root cause is extraction, not just display:** `extractSeriesTitle`
([`lib/feeds/title.ts`](src/lib/feeds/title.ts)) pulls the page `<h1>`/`og:title`/`<title>` and stores it **without
HTML-decoding**, so the entity is baked into the DB row (confirmed on a prod series). Two fixes, ideally both:
**(a) primary — decode at extraction** (decode named + numeric HTML entities in `extractSeriesTitle`, and audit any
other page-sourced text that isn't run through rss-parser's decoder); this cleans new adds, and the WP-30 non-manual
title backfill self-heals existing rows on the next page read. **(Now tracked as WP-30b**, alongside the consent-h1
fix — same file.**)** **(b) catch-all — decode at display** in the
library/detail title render, which fixes rows already stored encoded without waiting for a re-extract. Belongs partly
in the data layer, filed here because the visible symptom + the display-decode safety net are frontend; stays under
WP-28 (the residual display-decode half; root-cause extraction decode shipped as WP-30b).

### WP-28e — Shelf delete affordance (swipe-to-delete + edit mode)

**Goal (owner, 2026-08-25):** replace the **always-visible mobile** delete trash with better-hidden affordances —
**both** wanted, not either/or:
1. **Swipe-to-delete (touch):** drag a series card left to reveal a red **Delete** action on the right, iOS-Mail style;
   tapping it deletes (still confirm-gated).
2. **Edit mode (all inputs):** an **"Edit"** toggle on the shelf head (near the sort/filter controls) that reveals the
   per-card delete buttons; off by default. This is also the **keyboard / a11y path**, since a swipe gesture isn't
   reachable without a pointer.

**Current state (`.card__delete` in [`globals.css`](src/app/globals.css)):** the trash is `opacity: 0` by default and
revealed on **`.card-wrap:hover` / `:focus-visible`** — so on **desktop it already shows on hover** (fine), and it's
*not* always visible there. The always-visible behavior the owner wants gone is the **`@media (hover: none)`** override,
which forces the trash to `opacity: 1` on touch devices (so it's reachable without hover). So WP-28e's real target is the
**touch/no-hover** experience: drop that always-on override in favor of swipe, and add the explicit Edit toggle as the
non-pointer reveal. Since WP-28a the shelf render lives in the client [`Shelf.tsx`](<src/app/(app)/Shelf.tsx>), the
natural seam for an edit-mode flag and per-card gesture state; the trash itself is WP-51's `DeleteSeriesButton`, a
`Link`-sibling inside `.card-wrap`.

**Scope to design when picked up:**
- **Swipe:** pointer/touch handling (pointer events, avoid a heavy dep if possible), a reveal-behind-the-card layout,
  open/closed snap + a trigger threshold, and closing an open row when another opens or on scroll. Preserve the WP-51
  **tap-through guard** (revealing/deleting must not navigate into the card's `Link`).
- **Edit mode:** a toggle (likely transient per-visit) that reveals the per-card delete buttons; reuse the existing
  `DeleteSeries` confirm flow.
- **Confirm on both paths** — keep the delete confirmation (no accidental swipe-deletes).
- Decide the desktop story: keep the existing **hover reveal** as-is, or also route desktop through Edit mode for
  consistency (and whether swipe should also work as a pointer-drag on desktop).

**Skills:** `frontend-design` (primary). **Depends:** WP-10 (done), WP-51 (delete, done), WP-28a (Shelf.tsx client shell,
done). **DoD:** touch no longer shows an always-on per-card trash; swipe-left reveals Delete and (after confirm) removes
the card; the Edit toggle reveals/hides the per-card deletes and works without a pointer; the desktop hover reveal still
works; the tap-through guard holds on every path. Append the flow to the WP-PW E2E checklist at completion.

### WP-28f — Bookshelf theme

**Goal:** a fourth theme — a **gothic/Victorian palette** paired with a **book-stack shelf layout**, replacing the
plain card grid with something that reads as an actual bookshelf.

**Spike result (2026-08-28, folded out of WP-28b's design pass):** both a horizontal **"pile of books"** and a
vertical **"spines on a shelf"** treatment are feasible as **pure scoped CSS on the existing card markup, with zero
markup changes**. Tradeoff to resolve in this WP's own brainstorm: **vertical spines** are denser and the stronger
"real bookshelf" look but **truncate long titles** (fixed book height) — mitigable via hover-reveal/tooltip; the
**horizontal pile** keeps full titles on one line but shows fewer per screen. **Both hide `.card__latest`/`.card__meta`**
(a spine can't carry them) — the pile-vs-spine call is an info-density decision for this WP, not pre-decided.
*(The throwaway spike HTML/screenshots lived in the session scratchpad and were ephemeral — this note is the durable
record of the finding; nothing depends on those files persisting.)*

**Skills:** `frontend-design` (primary). **Depends:** WP-28b (theme architecture, done), WP-28a (shelf sort/filter
control bar — needs gothic styling, done), WP-28e (delete affordance must work on book rows). **DoD:** a `bookshelf`
theme option ships in the picker; the shelf renders as book pile or spines (per the brainstorm's call) with a
gothic/Victorian palette; the rest of the app (detail, add, settings, login) gets matching typography/motifs; existing
shelf interactions (sort/filter, delete) still work on the new layout.

### WP-28j — No-flash shelf sort/filter

**Goal:** kill the flash where navigating to the shelf (`/`) with a saved sort/filter briefly renders the
**unsorted/unfiltered** shelf, then snaps to the persisted view once the client mounts.

**Cause:** WP-28a persists the shelf controls (sort mode + status/title/min-rating filter) in `localStorage` and
applies them in the **client** [`Shelf.tsx`](<src/app/(app)/Shelf.tsx>) after mount. The server renders the default
order/filter, so there's a visible reflow on every navigation to `/` — the shelf equivalent of a theme FOUC.

**Fix (pick in this WP's design pass):** the cleanest is WP-28b's **no-flash** pattern — a pre-paint inline script
(or an equivalent blocking read) that applies the persisted control state to the initial markup **before first
paint**, so the first frame is already the saved view. Alternatives to weigh: render the shelf from the persisted
state so SSR and first client render agree (must stay hydration-safe — the server can't read `localStorage`, so this
likely still needs the pre-paint hand-off), or persist the controls **server-side** (overlaps **WP-THEMESYNC**'s
cross-device idea) so SSR can render the correct view directly. Keep it hydration-clean (no mismatch warnings).

**Skills:** `frontend-design`. **Depends:** WP-28a (shelf controls, done), WP-28b (the no-flash pre-paint pattern to
reuse, done). **DoD:** navigating to `/` with a non-default saved sort/filter shows the saved view on the first
painted frame (no flash of the default order); no hydration-mismatch warnings; the controls still persist + apply on
change as before.

### WP-TAGS — Series tags (genre)

**Goal (owner, 2026-08-30; filed by WP-28c):** user-assigned tags on a series — mainly genre — that show on the shelf
card in the slot WP-28c frees (it drops the latest-chapter line and, in this WP, fills that space with the first tag(s)
that fit).

**UI-only — no migration.** The `tags String[]` column already exists on `Series` (line ~112 of the schema, currently
unused), so this WP touches no schema and the WP-04 pause does **not** apply.

**Scope to design when picked up:** a **detail-page tag editor** alongside notes/rating (add/remove, free-text with
light normalization); **shelf-card display** of the first N tags in the WP-28c slot (truncate to fit, one line); a **tag
filter** on the shelf control bar (extends WP-28a's `lib/shelf.ts` filter); and a **later feed use** (e.g. group/annotate
digest rows by genre) noted but not built here. Keep `lib/shelf.ts` pure and test-first. (If tags should later be
shared/renameable across series, a `Tag`/join model is a *future* migration — out of this WP's UI-only scope.)

**Skills:** `frontend-design` (editor + shelf display). **Depends:** WP-10 (detail UI, done), WP-28c (frees + reserves
the shelf slot), WP-28a (shelf filter to extend). **DoD:** tags are assignable on the detail page and persist; the shelf
card shows the first tag(s) in the freed slot; the shelf can filter by tag; existing shelf sort/filter/delete still work.

### WP-31 — Tab-structured premium TOCs (renderer tab capture + tab-membership access)

**Motivation (owner testing, 2026-07-26):** on the **JS-rendered Free/Premium-tab source** (Next.js RSC), the
production renderer both **under-captures** and **mis-classifies**, so WP-20's "now free" can't work there:

- **Renderer captures the FREE tab only.** [`api/render/route.ts`](src/app/api/render/route.ts) does `goto` →
  settle → loop-click only `load more|show more|more chapters`, with **no tab interaction**. It lands on the default
  (Free) tab; the **Premium tab** is a **disjoint, lazily-rendered list** that is simply absent from the DOM until the
  tab is clicked. So the locked side is never seen.
- **Access is tab membership, not a row marker.** Even in the premium view, `parseToc` labels everything FREE — there
  are **no per-row lock markers** (`LOCK_CLASS`/`LOCK_TEXT` find nothing; the only "premium" string is the *tab
  label*). Free-vs-locked is **which tab a chapter is under**.
- **A real "now free" event was observed** between two tests (a couple of chapters moved premium→free while the total
  held constant) — exactly the WP-20 signal, but **undetectable as-is** because we never capture the premium side and
  there's no row marker to flip.

**Two independent gaps → two pieces of work:**
1. **Renderer reads both tabs.** Implement the `readTabs` interaction from the WP-17b spike vocabulary
   (`waitForSelector`/`clickWhileVisible`/`readTabs`): click each Free/Premium tab (by visible text — no site names in
   the repo) and union the disjoint lists. Tab labels embed counts (a near-free-frontier signal). Wants a small
   **per-host interaction descriptor** rather than the current one-size load-more loop.
2. **Tab-aware access classification.** A `SiteTocConfig` rule (or tab-scoped parse) marking premium-tab chapters
   `LOCKED`, free-tab `FREE`, since row markers don't exist. This is the concrete "real locked TOC" that WP-20
   deferred its lock-detection tuning to.
3. **Client-side numbered pagination — a third interaction the per-host descriptor must cover (owner testing,
   2026-08-13: a render-cleared WordPress source).** Its TOC is an **Alpine.js** component rendering **~50 chapters per
   page** with **"Previous"/"Next"** buttons (`@click`, `href="#"`) — *not* "load more". The renderer's loop only clicks
   `load more|show more|more chapters`, so it captured page 1 (~50 of ~200). And Next **replaces** the visible 50
   (pagination, not append), so the interaction must **click Next and *union* chapters across pages** until Next is gone
   — reading the final DOM alone isn't enough. Same `clickWhileVisible`/accumulate vocabulary as `readTabs`.
   **Better fix where a data API exists — verified on this source (2026-08-13):** its "Next" calls a custom WP-REST
   endpoint (`/wp-json/<ns>/v1/chapters?category=<termId>&per_page=100&page=N`) returning **`{title, permalink,
   locked, price}` per chapter** — all N chapters in ⌈total/100⌉ calls from the CF-cleared browser context, **and the
   per-chapter `locked` field feeds WP-20 directly** (no DOM lock-marker scraping — strictly better than the generic
   `parseToc` lock heuristics for this site). A static-JSON adapter beats click-through here; keep click-"Next"-and-union
   as the fallback for sites with no such API. (Distinct from WP-32's *server-side* sibling-page "next chapters"
   following, which needs no renderer.)

**Note:** contradicts the WP-17b "validated ~261 links" changelog line — production `route.ts` lands on the Free tab,
so that figure was free-only or taken differently; re-confirm with a prod `/api/render` curl when picked up. **Gets its
own brainstorm → spec when prioritized.** Until then, "now free" on tab-structured paid sites is a known non-detection.

### WP-32 — `parseToc` chapter-list robustness: split/paginated TOCs + non-chapter anchor filtering

**Motivation (owner testing, 2026-07-26):** the **plain SitePad split-TOC source** hosts one series' chapter list
across **two sibling slugs** linked by hand-authored anchors — page A (prologue + the early chapters, then a "Next
Chapters" link) → page B (the newest chapters, with a "Previous Chapters" back-link). A **single fetch of the given URL
captures only page A; the newest chapters on page B are never seen.** The page is plain-fetchable (no renderer needed);
there is **no usable pagination or feed** (`…/page/2/` soft-404s to the same page; the site feed is dense/wrong-series;
per-slug feeds return 0 items). The renderer wouldn't help either — its loop matches in-place "load more", not
navigation to a *new URL*.

**Work:**
1. **Follow-next-page in page-watch (the durable fix).** After parsing a TOC, follow anchors whose text matches
   `next chapters?|older|newer` (case-insensitive), for a **bounded** number of hops, and **union** the chapters
   across pages. Generic — handles this site and any future split TOCs. (Rejected: watch only the "front" slug — it
   rolls to a new slug and breaks silently; register both slugs manually — brittle as pages grow.) **This is the
   *server-side* pagination flavor** (anchors to new URLs, no renderer). The *client-side/JS* flavor — an Alpine
   "Prev/Next" TOC that swaps ~50/page in place — is a **renderer** interaction and lives in **WP-31**, not here.
2. **Filter non-chapter anchors polluting `parseToc` — this WP owns ALL anchor-level filtering.** (WP-36's region
   scoping, done, drops sidebar/nav/footer *containers*; this is the in-content anchor-level pass — keep it in one
   place, not scattered.) Two flavors seen so far:
   - **Pagination anchors** (split TOC) — "Next/Previous Chapters" text contains "Chapters" → `CHAPTER_TEXT` matches →
     `parseToc` emits a **phantom chapter row** (url = the sibling page, number = null). Filter them out (and feed them
     to step 1 instead).
   - **Shortcut/CTA anchors** (2026-07-29 concatenated-title custom source; **many more in the 2026-08-25 batch** —
     local IDs B03, B05, B07, B08, B10, B12, B14, B15). CTA buttons sit *in the content* and pass the chapter filter:
     **"Last chapter: Ch.N …"**, **"Read"/"Start reading"**, **"New/First Chapter"**, **"Chapter list" →
     `javascript:;`**, and empty-text anchors. They dupe or mis-position real chapters — e.g. a **"Read" button whose
     `href` is the same slug as real ch 1** (B03) is a **first-wins dedupe collision** (ch 1's title becomes "Read"),
     and a "Last chapter" jump-link lands the *newest* chapter at position 0 (WP-35 sorts it oldest). Drop by text
     ("last chapter", "read", "start reading", "new/first chapter", "chapter list", "next/prev") **and** drop
     non-navigational hrefs (`javascript:`, `#`, empty); on dedupe **prefer the in-list occurrence** over a chrome
     shortcut.
3. **Chapter *title / number extraction* quality → moved to WP-58.** The former items 3–4 (URL-slug number authority
   for concatenated-`Ch.<seq>` titles, the slug/label off-by-one, and the non-numeric prologue) now live in **WP-58**
   alongside the batch's title-garbling. WP-32 owns only *which anchors are chapters and following split pages*; WP-58
   owns *cleaning each chapter's title + number*.

**Anchor filtering now has many drivers** (2026-08-25 batch — local IDs B03, B05, B07, B08, B10, B12, B14, B15); the
split/paginated follow-next-page part is still single-source. Pure `lib/feeds/pageWatch.ts`, test-first. **Gets its own
brainstorm → spec when prioritized.**

**Also owns (added 2026-07-31, WP-37 final-review follow-up):** `findTocUrl` (`lib/feeds/discover.ts`) needs the
same class of nav/chrome anchor-filtering as `parseToc`'s chrome exclusion — it's currently why the bare `toc`/
`index` heuristic tokens had to be dropped (too false-positive-prone against bare nav links) rather than filtered.

### WP-CLEANUP-UI — In-app cleanup surface (delete/merge series, delete/reset chapters, edit URLs)

**Motivation.** `db:cleanup` (WP-38) is a local-only CLI script; there's still no in-app way to fix a bad listing.
WP-39b's create-then-annotate flow (the add page's "Merge" affordance on a `similarTo` hit) needs somewhere to land
— merging two series (folding chapters/progress/source by canonical-URL union, or picking one to keep) is exactly
`db:cleanup merge-series`'s logic, just reachable from the UI instead of a terminal.

**Scope.** Surface the `db:cleanup` operations in the detail/library UI: delete series, merge series (doubles as
the manual **same-work / different-translation resolver** — the case `findSimilarTitle` can't catch automatically),
delete/reset chapters, edit a source's reading URL / TOC URL. `TODO`, depends on WP-10 (detail UI, done).

### WP-WORKID — Cross-translation identity via a community aggregator's canonical work ID (future, low)

**Motivation.** `findSimilarTitle` (WP-39b) matches on the title *string* and explicitly can't catch two different
translations of the same work — e.g. two different translation groups' titles for the same source-language novel,
which share no substring. A community novel-aggregator site indexes works by a canonical work ID and lists each
work's alternative/translated titles; mapping our sources to that ID would let a second translation of an
already-tracked work be recognized automatically instead of relying on title similarity or a manual merge.

**Scope.** Add-time (or backfill) lookup: resolve a source to the aggregator's work ID, store it, and use it as an
additional (stronger) key alongside `canonicalSeriesId`/`findSimilarTitle`. Kept **generic** in this doc — no real
aggregator name (anonymity rule); real-site specifics belong in the local, uncommitted testing notes if/when this
is picked up. `TODO`, low priority, future — depends on WP-05 (feed parse) / WP-17 (page-watch) for the fetch/parse
plumbing to hang the lookup off of.

### WP-53 — Make backfill API-aware + re-enable the backfill button on API sources

**Priority: low (convenience).** The **poll already populates API sources**; this only enables *on-demand*
backfill/repair (CLI + button) instead of waiting for the next poll — nice-to-have, not blocking.

**Motivation (owner testing, 2026-08-20):** after switching a CF-gated source to an **API descriptor** (WP-45/45b:
`type=API`, `apiUrl`, `apiMap`, `fetchMode=RENDER`), a `db:cleanup backfill … --render` returned **`added 0`** — the
backfill **doesn't use the API.** `backfillPorts.loadSeriesMeta` only surfaces `sourceUrl`/`tocUrl`, and `runBackfill`
just fetches the page + `parseToc`s it, so for an API source it rendered the page **DOM** (the paginated TOC's first
page = the chapters it already had) instead of paging the JSON API → found nothing new. The **poll** is API-aware
(`pollSource` uses `apiUrl ?? feedUrl ?? tocUrl ?? url` + `apiMap` + `fetchApiPages`); the backfill path predates WP-45
and was never taught the branch. So an API source can *only* be populated by a poll — the CLI `backfill`, the
`/api/series/[id]/backfill` route, `backfillWithEscalation`, and `switchToPageWatch`'s seed are all dead ends for it.

**Work:**
1. **API-aware backfill.** Have `backfillPorts` load `apiUrl`/`apiMap`, and `runBackfill`/`backfillFromToc` branch on
   `type === 'API'` to fetch via `fetchApiPages` (render, paginated) + `parseApiChapters` — mirroring the poll's
   `apiUrl ?? feedUrl ?? tocUrl ?? url` precedence — so an API source seeds/repairs its full chapter list **with
   `locked` access** from the backfill, same as the poll. Keep the existing plain→render escalation semantics.
2. **Re-enable the button for API sources.** The in-app **"Backfill from TOC"** button is hidden for `type === 'API'`
   (`SeriesDetail.tsx` `sourceType !== 'API'` gate, added during WP-45 because backfill didn't work for API). Un-hide it
   once (1) lands.

Test-first (the API branch in `runBackfill`; the button-visibility change). Small, self-contained. Unblocks
one-shot population/repair of API sources (today they wait for the next poll).

### WP-54 — API-source auto-probe + human docs for the API switchover

**Motivation (owner, 2026-08-21):** converting a CF-gated data-API site to the API path is a manual dance — find the
per-series id (`category=<id>`) by rendering the page and watching the Network tab, hand-build the `--map` JSON, then
`set-api-descriptor` (a gitignored `/local/` helper now scripts it end-to-end for one site: it queries prod for
not-yet-API sources, renders each to capture the chapters request + total, and runs the CLI). The add-time
`probeForApi` (WP-45) only auto-detects the **static-JSON SPA** shape (a `data-*` attr → a `.json` file, the
Cloudflare-Pages case); it can't see an API the page fetches via **XHR** (the WP-REST `…/v1/chapters?category=<id>`
shape), because that only appears at runtime, behind CF.

**Update (owner testing, 2026-08-22) — two refinements from a new driver (a JS-SPA source whose chapters load via XHR):**
- **The XHR variant isn't always CF-gated.** This source fetches its chapter list via a **plain** XHR (a bare
  authenticated-optional `GET` to a per-series chapters endpoint — no CF, no auth). So render is needed only to
  *discover* the endpoint, not to *fetch* it; the detector must **not assume CF**, and the add-flow should prefer a
  plain API fetch when the discovered endpoint is un-gated. (Taxonomy: static-JSON auto-detected · **XHR-plain** ·
  XHR-CF-gated.) With no auto-detect + no CF signal, the add just fell through to render+parseToc — which scraped the
  page's **"recommendations" widget** (other-novel cards whose "Chapters: N" text trips `CHAPTER_TEXT`) as the
  chapters, and took the **widget `<h1>`** as the title.
- **Blocking descriptor gap → bare-slug URLs (a WP-45 adapter enhancement, prerequisite).** This API returns only a
  **bare chapter slug/id**, not a full `permalink` like the earlier API sites — and `ApiDescriptor.urlField` merely
  resolves a field *value* via `new URL(value, endpoint)`, so there's **no way to build the real chapter-page URL**
  (a different path prefix than the API endpoint). Needs a **`urlTemplate`** on the descriptor (e.g.
  `/<prefix>/{slugField}`, resolved against origin) before such a source can be wired **at all** — manual
  `set-api-descriptor` or auto-probe. Until then these sources can't use the API path; deactivate them.
  **(2nd driver, B08, 2026-08-31):** a slug-keyed API whose items carry only `{id, order, title, published_at}` (no url
  field) — the reader URL must be templated `/<prefix>/{slug}/{order}`, i.e. a **two-field** `urlTemplate` (path slug +
  `order`), reinforcing the need. A site that *migrated* from a separate-TOC page (WP-37b) to this in-page API.

**Work:**
1. **Render/XHR API detector.** A probe step that renders the page (clearing CF) and captures the chapter-list **XHR** —
   endpoint, per-series id, and JSON shape — then **infers the `ApiDescriptor`**: url/title fields, a lock field (+
   `isFreeWhen`), and pagination (`pageParam` + `perPage`, reading the total-count / `x-wp-totalpages` headers and
   probing the site's per-page cap). Host-agnostic (no site names), returns candidate hits like the existing detector.
2. **`db:cleanup probe-api <sourceId> [--render] [--apply]`** — render, detect, print the inferred descriptor + a
   chapter-count sanity check, and on `--apply` `set-api-descriptor`. Productizes the `/local/` helper (which stays as
   the interim tool). Idempotent (skips already-API sources).
3. **Human guide (docs) — the priority half.** A new human-facing page (e.g. `docs/api-sources.md`, linked from the
   README) for a person evaluating a new site: the **CF taxonomy** (plain-static / render-clearable / anti-headless —
   render can't beat a managed challenge); **how to tell if a site has a usable JSON chapter API** and find its
   endpoint / per-series id / fields (DevTools Network → the chapters request); the **field-map + pagination +
   `per_page`-in-two-places + `isFreeWhen:falsy`** gotchas (deep operator detail stays in `docs/db-cleanup-cli.md`);
   and a short **"can this site leverage the API path?" checklist** (JSON chapter-list endpoint? carries lock state?
   CF render-clearable? per-series id findable?). **Two durable gotchas (from the 2026-08-22 driver):**
   - **Determining the chapter-page URL for the field-map.** The API's endpoint path and its item fields don't
     necessarily give you the reader URL — an item may carry a **bare slug/id** and the chapter page may live under a
     **different path than the API**. So **open one real chapter and confirm its URL pattern**, and beware
     **"200-but-wrong" pages** (a valid 200 that isn't the chapter — e.g. an SPA route that renders "undefined"). True
     whether the descriptor uses `urlField` or `urlTemplate`.
   - **Not all data-APIs are HTML-advertised or CF-gated.** Some are a plain **runtime XHR** (no `.json` in the HTML,
     no CF) — the DevTools → Network → **Fetch/XHR** → reload discovery step is the same either way.

   Anonymized — placeholders only (no-real-site-names).

**Why:** the API path is the best source when it exists (complete list + native WP-20 lock state, cheaper than DOM
scraping), but spotting and wiring it is expert-only today. This makes it discoverable/repeatable and lets a human
triage a new site without reverse-engineering the pipeline. *(Auto-probe is convenience — the manual flow + `/local/`
helper work today; the docs are the real deliverable. Priority owner's call.)*

### WP-55 — Decode HTML entities in API-source chapter titles

**Bug (found while testing WP-28d, 2026-08-22):** chapter titles on an advance-chapter **API** source render raw entity
codes (`&#8217;`, `&mdash;`) instead of glyphs.

**Root cause (API path only).** Chapter titles enter from three parsers; two already decode, one doesn't:
- **Feed** (rss-parser) — decodes named + numeric entities. ✅ (verified empirically)
- **Page-watch TOC** (cheerio) — `.text()` and `.attr('title')` both decode on parse. ✅
- **API source** ([`parseApiChapters`](src/lib/feeds/apiAdapter.ts)) — maps the JSON `titleField` with only
  `.replace(/\s+/g,' ').trim()`; `JSON.parse` doesn't touch HTML entities → literal codes stored. ❌

This is the chapter-title analog of the **series-title** gap WP-30b fixed (`decodeHTML` from `entities` in
[`title.ts`](src/lib/feeds/title.ts)), and the concrete root cause behind the vague WP-28 "display-side entity-decode
catch-all" residual — so it supersedes that residual for chapters (root-cause decode, not a display band-aid).

**Fix (small, TDD):**
1. **`decodeHTML` in `parseApiChapters`** — one line at the title map, unit-tested with an entity-laden title. This is
   the single choke point every API consumer routes through — add-time
   ([`addSeries`](src/server/services/addSeries.ts#L145)), [`poll`](src/server/services/poll.ts#L305), and the future
   **WP-53** API-aware backfill — so future chapters land decoded everywhere (satisfies "backfill must trigger the
   decode" without extra wiring).
2. **Prod remediation — throwaway one-off script**, scoped to **`type === 'API'` source chapters only.** Poll never
   rewrites an existing chapter's title (it only inserts `new` + reconciles `access`), so historical rows won't
   self-heal; a one-off `decodeHTML` pass fixes them. No permanent `db:cleanup` command — WP-53's API-aware backfill
   will route through the fixed parser for any future repair. Script deleted after the run.

**DoD:** API-source chapters with HTML entities in their titles display decoded glyphs; `parseApiChapters` decodes
under a unit test; feed/TOC paths unchanged; existing prod API-source titles fixed by the one-off. **Depends:** WP-45
(API path — done). Small PR, queued after the WP-28 items.

### WP-47 — Client resubscribe on VAPID key mismatch (low priority)

**Priority: low.** Only bites on an intentional VAPID key rotation, or a live device holding a subscription created
under a different key (e.g. a stale sub from another environment). Not needed for the common expired-subscription case,
which already self-heals.

**Motivation (owner, 2026-07-30):** the WP-09-hardening `classifyPushFailure` now prunes a **403 Forbidden** sub
(VAPID key mismatch) server-side, alongside 404/410. But the client's self-heal `resyncSubscription`
([pushClient.ts](src/app/pushClient.ts)) re-POSTs whatever subscription the **browser** still holds on every app load
([ServiceWorkerRegister.tsx](src/app/ServiceWorkerRegister.tsx)). For a 403 (key-mismatch) sub the browser sub is still
present but was created under the **old** `applicationServerKey`, so: server prunes it → next load resync re-adds it →
next send 403s → pruned again — a **prune/re-add churn**, and the settings toggle still reads "subscribed"
([getPushState](src/app/pushClient.ts) checks the browser sub, not the server row) while no pushes ever arrive. The
client has no signal to reconnect. *(By contrast, an expired 404/410 sub self-heals cleanly: the browser also loses it →
`getSubscription()` returns null → toggle flips to "default" → the user re-enables.)*

**Work:** on load (in `resyncSubscription`, or a dedicated check), compare the browser subscription's
`options.applicationServerKey` bytes against the current `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; **on mismatch, `unsubscribe()`
then re-`subscribe()` under the new key before posting** (recreate, don't re-post the stale one). Makes a key rotation
genuinely self-healing on the client and ends the churn. Pure-ish client helper; test the key-compare in isolation.
Depends on WP-09 (and the 403-prune hardening, `dc3cb6e`).

### WP-56 — `parseToc` lock-detection false positives

**Motivation (owner testing, 2026-08-22):** a source showed **all 556 chapters as LOCKED** though every chapter is
free. Root cause is a stack of false positives in `parseToc`'s access heuristics ([`pageWatch.ts`](src/lib/feeds/pageWatch.ts)):

1. **`LOCK_CLASS` matches "lock" inside "b`lock`" (the serious one).** `LOCK_CLASS = /class="[^"]*(?:lock|premium|
   vip|coin)[^"]*"…/` does a **substring** test, so `class="wp-block-post-content"` (and *every* `wp-block-*` class a
   Gutenberg **block theme** emits) matches on the `lock` in `block`. → **every chapter on any WordPress block theme is
   marked LOCKED.** That's the default WP theme family since 2022, so this is broad, not a one-off.
2. **`LOCK_TEXT` matches generic words in titles.** `\bcoins?\b`/`premium`/`vip` legitimately appear in *chapter
   titles* (here: "Chapter 182 – Tossed coin (1)") — that's not a lock signal.
3. **The lock scope is a whole shared container.** The TOC was **559 bare `<a>` links inside one `entry-content`
   `<div>`** (no per-chapter `<li>`/`<tr>`), so `$el.closest('li, tr, article, div')` makes that **64 KB div the "row"
   for *every* chapter** — any lock-ish token anywhere in it taints all 559. (So even a legit single locked chapter
   would mislabel the whole list.)

**Fix:**
- **Class match by token, not substring:** treat a class as a lock marker only when a whole class *token* qualifies
  (e.g. `locked`, `is-locked`, `chapter--premium`, `fa-lock`), never `lock` inside `block`/`blockchain`/etc. (split on
  whitespace, or require a `[\s"'-]` boundary).
- **Don't infer lock state from free text** (titles) — gate on a **marker** (a lock icon/badge/🔒, a dedicated
  lock/premium class or element), not `LOCK_TEXT` over `scope.text()`.
- **Scope the check per chapter, not to a giant shared ancestor:** if the resolved "row" is a large content wrapper
  shared by many chapters (same element for N anchors), the lock signal isn't per-chapter → default **FREE**; prefer a
  tight per-anchor neighborhood.
- Add fixtures: a WP block-theme TOC (all-free), a bare-anchor `entry-content` TOC, and a real per-row locked TOC — so
  the heuristics are pinned both ways.

**Interacts with WP-20** (paid→free depends on correct lock state) and **WP-28d** (locked marker/hide-locked filter —
which is only meaningful once lock state is trustworthy). Pure `pageWatch.ts` change, test-first. *(Prod already
corrected by hand: the affected series' 556 rows set FREE; hold off re-backfilling any block-theme source until this
lands, or it re-locks — and could fire a "now free" storm.)*

## Backlog / open questions

- **Notification privacy** *(implemented 2026-07-26)* — the work's name is kept out of the always-visible notification
  `title` (generic category there, series in the `body`; source-down host in the body too), so a lock-screen glance
  reveals only "New chapters" / "Likely now free" and not *which* novel. Relies on the owner setting the OS to "show
  previews: when unlocked" (iOS can't be forced from the web). A "discreet" pref (hide even the category) is a possible
  future add. See `lib/notify.ts`.
- **Free-tier constraint is compute, not chapter storage** *(resolved 2026-07-23)* — worry was that many chapters
  (100–1,000/series) might exceed the DB free tier. Math says no: a `Chapter` row is ~300–400 B with indexes, so a
  1,000-chapter series ≈ ~0.4 MB and a *heavy* library (200 series × 300 ch ≈ 60k rows) ≈ ~20–30 MB against Neon
  free's **0.5 GB**. The binding free-tier limit is **compute hours** (~192/mo, autosuspend) → the reason to skip
  polling COMPLETED/DROPPED (WP-27) is compute + politeness, and pruning stored chapters for space is a non-goal.
  *Update (2026-07-28): the tighter compute ceiling is actually the **60s sequential-poll budget** (WP-41), and since
  **RENDER sources can't 304** the **RENDER/CF source count** — not raw novel count — is the real driver (WP-40 makes
  CF-static cheap; WP-27 cadence-gating keeps a PLANNED backlog from rendering daily).*
- **Auth & multi-device** — README scopes to single-user, but Web Push targets multiple subscribed devices per user.
  Decide the minimal identity story for MVP (single hardcoded user? a token?). Affects WP-08/WP-09.
- **Cron cadence** — README suggests every 10–15 min; make it configurable (freshness vs. politeness). WP-07/WP-11.
- **`diff` ↔ `pageWatch` shared shape** — WP-17 should reuse WP-01's `FeedItem`/diff so page-watch and feed sources
  converge on one diff path. Keep the diff types source-agnostic from the start.
- **Health thresholds are guesses until real data** — tune WP-03 constants against real poll logs once WP-07 runs.
- ~~**Spec fate (WP-12)**~~ — **Resolved 2026-07-16.** Validated data sources and prior-art/differentiation folded
  into the README (Architecture → "Release sources", and a new "Prior art & differentiation" section); the portfolio
  framing was interview-only and intentionally dropped. `webnovel-companion-spec.md` deleted.

---

## Changelog

Moved to **[docs/CHANGELOG.md](docs/CHANGELOG.md)** (newest first) to keep this tracker lean — git retains the full history regardless.
