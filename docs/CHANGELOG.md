# Changelog — Webnovel Companion

Append-only history, moved out of [PLAN.md](../PLAN.md). Newest first.

- **2026-08-31** — **Two WPs filed from a B15 diagnosis (WP-59, WP-60).** A B15 source sat `LIKELY_DOWN` while the
  site was fine in-browser: the host tightened Cloudflare and now 403s **Vercel's datacenter IP even via render**
  (residential unaffected; 15/16 other RENDER sources healthy → not our render config). Filed **WP-59** (add via a
  site-wide feed with `PATH_PREFIX` isolation when the page is CF-blocked but the feed stays open — incl. a flat-slug
  matcher fix: B15's flat `/<slug>-chapter-N/` posts need the prefix without the trailing-slash `seriesPath`) and
  **WP-60** (residential TOC hand-off — an owner-authed `ingest-toc` endpoint that runs `parseToc` on uploaded HTML to
  seed/repair chapters, bypassing the IP block for the initial fill). A live experiment (a link-only B15 source
  converted to FEED+`PATH_PREFIX`) is testing whether B15's `/feed/` is Vercel-reachable; a background watcher
  auto-reverts it to link-only if gated.
- **2026-08-31** — **WP-28c shipped: feed (digest) home + shelf tab.** `/` is now a cross-series digest of readable
  new-chapter + now-free events across READING series (newest-first, day-grouped; known-locked new chapters excluded;
  a formerly-locked chapter notifies once, as now-free), with a consolidated source-down "needs attention" strip and
  a per-device "seen" divider; already-read rows are dimmed. The shelf moved to `/shelf` behind a view-tab control.
  Derived on read — no schema change. Shelf card simplified: chapter count replaces the latest-chapter line +
  relative time; unread badge hidden on non-READING. Adds land on `/shelf` with the new series highlighted; added a
  "Recently added" sort. Filed WP-TAGS (series genre tags — UI only). **Next: WP-28e** (shelf delete affordance).
- **2026-08-29** — **Next 16 deprecation cleanup: `middleware` → `proxy`.** Renamed `src/middleware.ts` →
  `src/proxy.ts` and the `middleware` export → `proxy` (Next 16 deprecated the `middleware` convention). Behavior
  unchanged — same single-user gate, same `/api/*` matcher — but Proxy runs on the Node runtime (edge isn't supported
  for `proxy`), which is fine here: the HMAC session verify already ran in both, and no `runtime='edge'` was ever set.
  Refreshed stale "edge middleware" comments in `session.ts`/`passphrase.ts` and the two route docstrings that named
  the old file. Typecheck + 530 unit tests pass; `next build` recognizes it (`ƒ Proxy (Middleware)`, no deprecation
  warning). No PLAN/WP change — housekeeping.
- **2026-08-29** — **WP-28i shipped: private theme-asset proxy.** WP-28h's licensed `scroll` images (`wax-seal.png`,
  `scroll-tree.png`) now render in prod without being hosted publicly — the licenses forbid public redistribution, so
  they live in a **private** Vercel Blob store and are streamed only to authenticated callers through a new auth-gated
  route, `src/app/api/theme-asset/[name]/route.ts`. The route reads the private blob server-side
  (`get(path, { access: 'private' })`, `@vercel/blob@2.8.0`) and **streams the bytes through** rather than issuing a
  signed-URL redirect (a short-lived signed URL is briefly a public bearer link to a license-restricted image — ruled
  out). It sits behind the existing middleware gate (matcher covers `/api/*`, path not in the public allowlist → 401
  for unauthenticated requests). A pure, **test-first** exact-match allowlist (`themeAssetBlobPath` in
  `src/lib/themeAssets.ts`) maps only the two known names → `themes/<name>`; anything else 404s, so the route can't be
  coerced into reading arbitrary objects from the private store. Any failure (missing token, store gone, network) →
  404, never 500, so the existing `<img onError>` fallback in `WaxBadge.tsx`/`ThemeScene.tsx` still degrades
  gracefully (no tree, red-circle badge) — consumers unchanged. `Cache-Control: private, max-age=86400` + ETag/304
  keeps browser caching on but shared/CDN caches off (gate can't be bypassed) and private-blob egress down.
  Provisioning: `scripts/upload-theme-assets.mjs` flipped to `access:'private'`; prod now sets
  `NEXT_PUBLIC_THEME_ASSET_BASE=/api/theme-asset` (local dev stays `/themes`); `docs/theme-assets.md` updated. 526
  unit tests pass + typecheck clean; route smoke-tested under Next 16.3.2 (allowlist reject + graceful-404 fallback,
  no 500s). The authed-success render + unauth→401 are prod/owner-provisioned (private store token + `AUTH_SECRET`),
  same as WP-28h's owner-run upload. **Next: WP-28c** (feed vs library split).
- **2026-08-29** — **Queue reprioritized: WP-28i → NEXT; filed WP-28j.** Moved **WP-28i** (private theme-asset proxy —
  serve WP-28h's licensed images from a private Blob via an auth-gated route) to the top of the active queue ahead of
  WP-28c. Filed **WP-28j** (no-flash shelf sort/filter — navigating to `/` with a saved sort/filter flashes the
  unsorted shelf before snapping to the persisted view; fix via WP-28b's pre-paint no-flash pattern). No code change.
- **2026-08-28** — **WP-28h shipped: per-theme scenes, cards, and detail** (a follow-on to WP-28b's token
  architecture — scroll and sci-fi now have a full scene identity, not just a recolored night). **Scroll** gained a
  mauve page ground with parchment reserved for card/panel surfaces, an ink-tree with drifting cinnabar petals behind
  the hero, rolled-scroll shelf cards, a wax-seal unread badge, and an opened-scroll detail view (rods + deckle edge).
  **Sci-fi** gained a full holographic environment: glassy translucent chrome on the header/buttons/inputs, a
  perspective grid + shimmer-binary backdrop with flicker plus a glitch bar, iridescent shimmer on the title/rims, and
  HUD-glass shelf cards + a holo detail view. Both themes' motion (petal fall; binary flicker + glitch) is gated
  behind `prefers-reduced-motion`. **Hydration-safe by construction:** a new deterministic-scatter helper
  (`lib/scatter.ts`) seeds petal/binary placement so the SSR baseline and the post-mount client render agree, and
  `ThemeScene`/`WaxBadge` render an SSR-safe baseline that only fills in after mount; card markup is identical
  SSR↔client across all themes and only *styled* differently via CSS — no markup branching on theme, no
  hydration-mismatch warnings. **Licensed art (wax seal, ink tree) is gitignored** and served from Vercel Blob in
  prod (`scripts/upload-theme-assets.mjs`, `docs/theme-assets.md`); an `onError` fallback degrades gracefully for a
  set-but-unreachable base too, not just an unset one (tree hides, the wax seal falls back to a plain red circle).
  **The one night-visible change:** the hero's emphasized "here" (italic amber) is now plain text in *every* theme —
  every other rule stays scoped under `:root[data-theme="scroll"/"sci-fi"]`. New: `lib/scatter.ts`,
  `lib/themeAssets.ts`, `ThemeScene.tsx`, `WaxBadge.tsx`, e2e `theme-scenes.spec.ts` + review-screenshot
  `theme-scenes-screens.spec.ts`. Surface mapping (spikes were composite reference, not literal layout): the hero
  scene renders only on the empty-library `EmptyState`; shelf cards and the hero are mutually exclusive states of the
  same `/` route; the populated shelf/detail sit on a toned-down app-wide backdrop, not the full hero scene.
- **2026-08-28** — **WP-28b shipped: pluggable theme system.** Replaced the single baked-in "night reading" identity
  with a `[data-theme]` token architecture — per-theme CSS custom-property sets keyed off `data-theme` on `<html>`, so
  components keep referencing `var(--color-…)` unchanged — plus a new shared `--color-on-glow` token (tokenized
  per-theme foreground for text on the accent glow, previously hard-coded). Persistence + no-flash via an inline
  **pre-paint script** (`buildThemeScript`, derived from the pure `src/lib/theme.ts` registry) injected in
  `layout.tsx`: reads `localStorage`, validates the stored value, and sets `data-theme` (+ the `theme-color` meta)
  before first paint — no FOUC, no hydration mismatch. Settings-page **`ThemePicker`** swaps + persists instantly.
  Two new themes ship alongside the unchanged default **night**: **scroll** (ancient-scroll parchment) and **sci-fi**
  (holo-panel), each with its own palette, font, and motif, covering the whole app (shelf, detail, add, settings,
  login). Unit-tested (`tests/unit/theme.test.ts`) + Playwright-covered (persistence e2e + a themed-screenshot review
  spec). **Filed from the design pass:** WP-28f (bookshelf theme — gothic/Victorian palette + book-stack layout;
  feasibility spiked, both a horizontal "pile" and vertical "spines" treatment work as pure scoped CSS with zero
  markup changes), and two low-priority owner-requested extensions, WP-28g (header quick-switch) and WP-THEMESYNC
  (cross-device theme persistence). **Post-review polish:** the picker gained WAI-ARIA arrow-key roving-tabindex
  navigation (keyboard-selectable radiogroup), and a minor `theme-color`-meta reversion on client-side soft navigation
  was noted for follow-up under WP-28g. **NEXT → WP-28c** (feed vs library split).
- **2026-08-25** — **Docs split to stop PLAN.md's unbounded growth.** PLAN.md had reached ~2,250 lines / ~58k tokens
  and is read every session, ~half of it append-only history. Moved this **Changelog** here (105 entries) and the
  **detail sections for the 21 DONE work packages** (plus the hard-blocked parked **WP-40**) to
  [docs/PLAN-archive.md](../docs/PLAN-archive.md), and dropped the
  duplicative "Recently landed" blob from Current focus (→ a pointer here). PLAN.md is now ~750 lines / ~18k tokens
  (~69% smaller) and holds only active work + the stable index. Standing rule added to CLAUDE.md: **archive a WP's
  detail on `DONE`, log changes here not in PLAN.md.** Nothing lost — content moved to sibling docs + git.
- **2026-08-25** — **PLAN restructure from a 25-source batch triage** (findings in local, uncommitted notes, keyed by
  anonymized `B##` IDs so committed rows can cite drivers without site names). **New:** WP-57 (recommendation-widget
  exclusion + series-scoping — cross-series cards scraped as chapters) and WP-58 (chapter **title + number extraction**
  cleaning — garbled titles, no-separator `Ch.N`+label joins, URL-slug number authority — **pulled out of WP-32**).
  **Sub-WPs for gaps in landed WPs:** WP-30c (reject non-content-heading titles + pre-hydration render timing),
  WP-37b (follow a "Full Chapter List"/TOC link landing→TOC), WP-49b (WHOLE_FEED divert still leaks multi-series
  "Latest Chapters" + comment feeds). **Reframed/folded:** WP-32 now owns only chapter-list robustness (split TOCs +
  anchor filtering; number/title cleaning → WP-58); WP-31 **folds in endless-scroll + RSC load-to-completion** and
  **loses its low-priority tag** (the batch found *no* usable API for these interaction sources → render is the only
  path, a large missing-chapter cluster); WP-56 gained block→lock drivers + a non-block shared-scope variant.
- **2026-08-25** — **WP-28a shipped, expanded from shelf *ordering* to shelf *sort + filter*.** Owner widened scope at
  pickup: the three pure sort modes **plus sort-by-rating**, and **filtering** on reading status / title / rating. Pure
  [`lib/shelf.ts`](src/lib/shelf.ts) — `sortSeries` (recent / unread / A–Z / rating, title tie-break, no-chapter +
  unrated rows last) and `filterSeries` (status exact-or-ALL, case-insensitive title substring, min-rating) — both
  order-independent and non-mutating, 12 unit tests (TDD caught a `-Infinity − -Infinity = NaN` comparator bug in the
  no-chapter tie-break). Server `page.tsx` delegates to a client [`Shelf.tsx`](<src/app/(app)/Shelf.tsx>) control bar
  (sort + status + rating selects + a transient search); sort/status/rating persisted in localStorage with the SSR-safe
  default pattern (no hydration mismatch), search not persisted. **Subsumes WP-15** (`lib/search.ts`, removed from the
  queue). 2 Playwright specs; `seedSeries` gained `status`/`rating`. Manual pin/drag ordering deferred. **NEXT → WP-28b**
  (theme system).
- **2026-08-22** — **WP-54 refined by a new API driver (XHR-*plain* variant + a bare-slug descriptor gap).** A JS-SPA
  source added wrong (title = a "recommendations" widget heading; "chapters" = other-novel recommendation cards whose
  "Chapters: N" text trips `CHAPTER_TEXT`) because its chapters load via **XHR** and WP-45's probe only auto-detects the
  **static-JSON** shape → fell through to render+parseToc. Two refinements to **WP-54**: (1) the XHR variant **isn't
  always CF-gated** — this one is a **plain** un-gated `GET` (render needed only to *discover* the endpoint, not fetch
  it) → detector must not assume CF; (2) a **prerequisite WP-45 descriptor gap** — its API returns a **bare chapter
  slug**, not a full permalink, and `urlField` can't build the real chapter URL → needs a **`urlTemplate`** on
  `ApiDescriptor`. Until that lands the source can't use the API path (deactivate). (Real-site detail in local notes.)
- **2026-08-22** — **Filed WP-56: `parseToc` lock-detection false positives (from owner testing).** A source showed
  **all 556 chapters LOCKED** despite being entirely free. Root cause: `LOCK_CLASS` does a **substring** test, so it
  matches the `lock` in **`block`** → *every WordPress block-theme source* (`wp-block-*` classes) marks all chapters
  locked. Compounded by `LOCK_TEXT` matching generic title words (a chapter titled "Tossed coin") and the lock scope
  being a **single shared `entry-content` div** (559 bare-anchor chapters, no per-row `<li>`/`<tr>`) that taints the
  whole list. Fix (WP-56): class match by **token** not substring, gate lock on a marker not free text, and scope
  per-chapter not to a giant shared ancestor. **Prod corrected by hand** (the 556 rows set FREE). (Real-site detail in
  local, uncommitted notes.)
- **2026-08-22** — **Filed WP-55: decode HTML entities in API-source chapter titles.** Found while testing WP-28d:
  chapter titles on an advance-chapter (API) source render raw entity codes (`&#8217;`, `&mdash;`) instead of glyphs.
  Root-caused (systematic-debugging): the bug is **API-path-only** — feed titles (rss-parser) and page-watch TOC titles
  (cheerio `.text()`/`.attr`) are both already decoded, but [`parseApiChapters`](src/lib/feeds/apiAdapter.ts) maps the
  JSON `titleField` with only `.replace(/\s+/g,' ').trim()`, and `JSON.parse` doesn't touch HTML entities — so API
  sources store literal codes. It's the chapter-title analog of the series-title gap WP-30b fixed with `decodeHTML`
  (from `entities`) in [`title.ts`](src/lib/feeds/title.ts); this is the concrete, non-display root cause behind the
  vague WP-28 "display-side entity-decode catch-all" residual (which it supersedes for chapters). **Fix:** one-line
  `decodeHTML` in `parseApiChapters` (TDD) — the single choke point every API consumer routes through (add-time
  [`addSeries`](src/server/services/addSeries.ts#L145), [`poll`](src/server/services/poll.ts#L305), and the future
  WP-53 API-aware backfill), so future chapters land clean everywhere. **Prod remediation:** a throwaway one-off script
  decoding stored chapter titles **on API-type sources only** (poll never rewrites existing chapter titles, so it won't
  self-heal historical rows; a permanent CLI command is unnecessary because WP-53 backfill will route through the fixed
  parser). Small PR, queued after the WP-28 items. Depends: none (WP-45 API path exists). `TODO`.
- **2026-08-21** — **WP-28d DONE — locked-chapter display (marker + hide-locked filter).** Picked up out of order
  (owner request; WP-28a stays NEXT). `LOCKED` chapters on the detail page now carry a lucide `Lock` glyph in the
  `--color-glow` accent (distinct from the read/unread color dimming the row already has), and a persisted **"Hide
  locked"** checkbox filters them out. Scope trimmed at owner's call: **marker only** (no row dimming) and **no
  sort** — so `arrangeChapters`/`lib/reading.ts` is untouched (the filter is a one-line presentation-level `.filter`,
  not a pure seam). Plumbing was one field: `access` added to `ChapterLite` + the `page.tsx` map (`getSeries` already
  returns it). The toggle is **clutter-guarded** — only rendered when the series actually has a `LOCKED` chapter, so
  feed-only / all-`UNKNOWN` series are byte-for-byte unchanged. Persisted like the display-mode toggle
  (`chapterHideLocked` localStorage key, hydration-safe: off on server render, applied in a mount effect). E2E-covered
  in `controls.spec.ts` (seed helper gained `SeedChapter.access`): marker present on locked / absent on free, toggle
  filters + persists across reload, and a negative assertion that a no-locked series never shows the toggle. Verified
  in the running app (both states screenshotted). `npm test` 490 pass · typecheck clean · 15 E2E pass. No schema change.
- **2026-08-21** — **Filed WP-54: API-source auto-probe + human docs for the API switchover.** Converting a CF-gated
  data-API site to the API path is a manual render-and-watch-the-Network + hand-build-the-map dance (a gitignored
  `/local/` helper now scripts it for one site); the add-time `probeForApi` (WP-45) only auto-detects the static-JSON
  SPA shape, not an XHR-fetched REST API behind CF. WP-54: a render/XHR API detector (infer fields + pagination +
  per-series id) + a `db:cleanup probe-api` command, **plus the priority half — a human guide** (new docs page linked
  from README) on the switchover: CF taxonomy, how to spot a usable JSON chapter API, the field-map/pagination/`per_page`
  gotchas, and a "can this site leverage the API path?" checklist. Filed as a regular TODO (docs value beyond the
  convenience). `TODO`.
- **2026-08-20** — **WP-28d filed — locked-chapter display (dim / marker) + filter/sort.** New WP-28 child (owner
  request): show which chapters are `LOCKED` on the detail page (dim and/or a lock marker) and optionally hide them or
  sort them to the bottom. Lock state already exists — `Chapter.access` (`FREE/LOCKED/UNKNOWN` + `becameFreeAt`) from
  WP-20 — but the detail page drops it when mapping `series.chapters` → `ChapterLite`, so the work is presentation + one
  field of plumbing (+ an optional pure `arrangeChapters` locked-to-bottom extension under TDD). Depends WP-20/WP-10
  (both done); no schema change.
- **2026-08-20** — **WP-28 split into pickup-able children.** With the long-title readability facet shipped, the three
  remaining WP-28 facets were split into distinct, self-contained WPs so each can be picked up cold in its own session:
  **WP-28a** (shelf ordering — user-selectable library sort + persisted control), **WP-28b** (theme system — pluggable
  themes + picker, FOUC-safe token architecture, adds cultivation ancient-scroll + sci-fi holographic-panel), **WP-28c**
  (feed page vs library split — cross-series "what's new" river vs the per-series grid). WP-28 stays as a thin umbrella
  holding the readability note + two residual minor polish items (add-page notice, display-decode catch-all). Active
  queue + Current focus updated; NEXT = WP-28a.
- **2026-08-20** — **WP-28 (slice) — long chapter/series title readability.** First facet of WP-28 (WP stays open;
  ordering, feed-vs-library split, and the theme system remain). CSS-only, [globals.css](src/app/globals.css):
  detail-page chapter rows now **wrap** — `.chapter__title` drops `overflow/ellipsis/nowrap` (adds `line-height:1.4`),
  and `.chapter` flips `align-items:center → flex-start` so `#num` + `mark read` sit at the **top** of a wrapped row
  (a small `.chapter__num` `padding-top` cap-aligns the mono number with the title's first line). The shelf series
  title `.card__title` swaps one-line truncation for a **2-line `-webkit-line-clamp`**; the shelf latest-chapter line
  (`.card__latest`) is left one-line by owner's call. No `lib/` logic → no unit tests; verified by driving the running
  app against `webnovel_e2e` (seeded long titles) + Playwright screenshots (wrap, top-alignment, and the 2-line clamp
  all confirmed). Remaining WP-28 title item — display-time HTML-entity decode as a catch-all — is untouched (root-cause
  extraction decode already shipped as WP-30b).
- **2026-08-20** — **WP-29 DONE — manual release-schedule editor (no-fetch fallback for blocked sites).** The last
  piece of WP-29: the editor UI + its API seam (the pure `lib/schedule.ts`, `evaluateSchedules`, cron wiring, **and**
  push delivery with kind-specific copy + the `pushScheduled` pref had all landed earlier — push delivery came with the
  WP-09 push work, so the PLAN's "push delivery remains" was stale). **API seam:** `parseSeriesUpdate`
  ([validation.ts](src/server/api/validation.ts)) accepts an optional `releaseSchedule` discriminated union — `NONE`
  (clear), `INTERVAL {cadenceDays 1–365, anchoredOn (ISO date→Date), eventKind}`, `WEEKLY {weekdays (unique 0–6),
  eventKind}` — with `eventKind` defaulting to `NEW_CHAPTER`; `updateSeries` ([series.ts](src/server/services/series.ts))
  maps it onto the six schedule columns, clearing all of them (incl. `scheduleLastNotifiedAt`) on `NONE` and **stamping
  `scheduleLastNotifiedAt = now`** when setting one, so `evaluateSchedules` fires for the *next* predicted release
  rather than a backfill ping for a release that already happened. **UI:** a collapsible `ScheduleEditor`
  ([ScheduleEditor.tsx](src/app/(app)/series/[id]/ScheduleEditor.tsx)) mirroring the Notes block — kind select →
  conditional cadence-days + anchor-date inputs or 7 weekday toggles, a Predicts (New chapter / Now free) select, an
  explicit Save; **rendered only when the active source is link-only** (`showSchedule={!!active?.linkOnly}` in the
  detail page), so a still-fetching series can't double-notify. A pure `describeSchedule` (in `lib/schedule.ts`) drives
  the collapsed one-line preview. **TDD:** `parseSeriesUpdate` unit (each kind, bounds, rejects), `updateSeries`
  integration (INTERVAL/WEEKLY persist + stamp, `NONE` clears all six), `describeSchedule` unit; 2 Playwright specs
  (link-only sets+persists a weekly schedule; a fetching source shows no editor). **490 unit + 120 integration + 14
  E2E green, typecheck clean.** Queue advances to **WP-28**.
- **2026-08-20** — **WP-30b DONE — `lib/feeds/title.ts` extraction fixes (consent-`<h1>` reject-list + HTML-entity
  decode).** Two pure-`lib/` hardenings of `extractSeriesTitle` ([title.ts](src/lib/feeds/title.ts)), TDD (8 new unit
  tests in [title.test.ts](tests/unit/feeds/title.test.ts)). **(1) Consent/cookie-banner `<h1>` reject-list:** on some
  sites the sole `<h1>` is a CCPA/cookie notice, so it was grabbed as the series title. Added `looksLikeConsentBanner`
  — a small case-insensitive known-phrase substring list ("we value your privacy", "opt out of the sale or sharing of
  personal information", cookie-notice strings, …) — folded into the `qualifies` guard so a consent-banner candidate is
  rejected at every precedence level, falling through `<h1>` → `og:title` → `<title>`. **(2) HTML-entity decode at
  extraction:** entities baked into the DB raw (`&#8217;`/`&#038;`/`&nbsp;`). Now `clean()` runs `entities.decodeHTML`
  (added `entities ^2.2.0` as a direct dep — already in-tree via cheerio) **before** the whitespace collapse, so a
  decoded `&nbsp;` (U+00A0, which `\s` matches) folds into a normal space. Both callers — add-time
  [`addSeries`](src/server/services/addSeries.ts) and WP-30 backfill
  [`backfillFromToc`](src/server/services/backfill.ts) — share `extractSeriesTitle`, so new adds are clean and existing
  rows self-heal on the next non-manual backfill (display-side decode fallback stays WP-28). `npm test` 471 pass,
  `typecheck` clean. Queue advances to **WP-29**.
- **2026-08-20** — **WP-52 DONE — poll-time hard-fail render escalation.** Closed the poll escalation's blind spot:
  it handled *"rendered too few"* (under-fetch / regression, WP-46) but not *"the fetch was blocked."* A **PLAIN
  page-watch** poll blocked by Cloudflare now escalates to RENDER. In [`processFetched`](src/server/services/poll.ts)
  the failure path sets `escalateToRender = true` when `ports.renderFetch && src.fetchMode === 'PLAIN' && src.type
  === 'PAGE_WATCH' && res.outcome === 'HTTP_4XX' && res.status === 403`; `applyPollEffects` already persists
  `fetchMode = RENDER` from that flag ([index.ts](src/server/services/index.ts)), so the **next** poll renders and
  self-heals (deferred, matching the existing `escalateToRender` semantics — no extra render this poll). The
  poll-time analog of WP-46's add-time hard-fail render. **Scoping decisions (owner-approved):** gated on **403
  specifically, not any 4xx** — `PoliteResult` carries the real status, and a 404/410 gone page can't be rendered
  back while the flip is one-way, so a dead PLAIN page would otherwise get pinned to expensive renders forever; and
  **PAGE_WATCH only** — a FEED source keeps polling its feed plainly even when the page is CF-blocked (the
  feed-even-when-page-blocked strategy; API render-escalation stays out of scope, sibling to WP-APIZERO). Health
  still steps on the 403 (accrues toward the down alert) — escalation doesn't suppress the signal. Test-first:
  6 unit cases (403→escalate; 404/FEED/already-RENDER/no-renderer/timeout+5xx→no) + 2 integration cases (a
  CF-blocked PAGE_WATCH poll persists `fetchMode = RENDER`; a 404 stays PLAIN) — RED watched at both the pure-decision
  and DB-persistence layers before GREEN. `npm test` (463) + `npm run typecheck` + integration (117) green. `NEXT`
  advances to **WP-30b**. *(Also reordered the active queue: WP-30b to the top, WP-29 after it — WP-29's "picking
  up later" deferral dropped, per owner.)*
- **2026-08-20** — **WP-NOTES DONE — detail-page notes UI.** Added a collapsible **Notes** block to the series
  detail page ([`SeriesDetail.tsx`](<src/app/(app)/series/[id]/SeriesDetail.tsx>)) over the already-persisted
  `notes` field (validation + service shipped earlier; only the UI was missing). The page now passes
  `notes={series.notes ?? ''}` into the client component. **Save-on-blur** via the existing `patch()` helper, but
  only when the text actually changed (empty is a valid clear); a `savedNotes` ref tracks the last-persisted value
  and a `Saving…/Saved` `control__hint` (`role="status"`) reports the write. The label is a disclosure toggle
  (`aria-expanded`/`aria-controls`) with a **content-aware default** derived from the server prop — open when the
  series already has notes, collapsed when empty (deterministic across server/client → no hydration mismatch, no
  `localStorage`). When collapsed with notes present, a one-line **ellipsis-truncated preview** sits beside the
  toggle so content is discoverable without expanding. No `lib/` logic (nothing to TDD there); covered by a new
  **E2E spec** (`e2e/notes.spec.ts` — collapsed-when-empty → expand → type → blur-persist → reload defaults open →
  collapse shows a `scrollWidth > clientWidth` truncated preview) appended to the WP-PW checklist. `npm test` (457)
  + `npm run typecheck` + full E2E (12) green. `NEXT` advances to **WP-52**. *(Also fixed a pre-existing malformed
  `WP-52 || WP-29` run-on row in the active-queue table.)*
- **2026-08-20** — **Filed WP-53: make backfill API-aware + re-enable its button on API sources.** After switching a
  CF-gated source to an API descriptor (WP-45) and running `db:cleanup backfill … --render`, it returned **`added 0`**:
  `backfillFromToc`/`backfillPorts` page-watch `source.url` and never read `apiUrl`/`apiMap`, so an API source rendered
  the page DOM (first TOC page = what it already had) instead of paging the JSON API. The **poll** is API-aware
  (`apiUrl ?? feedUrl ?? tocUrl ?? url` + `fetchApiPages`); backfill predates WP-45. **WP-53:** teach the backfill path
  the same branch, and **un-hide the "Backfill from TOC" button for `type === 'API'`** (gated off in `SeriesDetail`
  during WP-45). So an API source can be populated/repaired on demand, not only by the next poll. `TODO`.
- **2026-08-20** — **WP-45b DONE — CF-gated render transport + paginated API sources.** The renderer clears Cloudflare and returns clean JSON (in-page fetch reusing the cf_clearance cookie; spike-validated); API sources paginate + union every page across both transports — PLAIN loops Node-side, RENDER makes one render call that loops in-page (one browser per series per poll, proven by a call-count test), short-page stop + cap 20 + log, per-descriptor perPage. `set-api-descriptor --render` now functional; the latent WP-45 plain-pagination gap is closed too.
- **2026-08-18** — **WP-45 follow-up: probe hardening (multi-candidate).** `probeForApi` now returns *all*
  `.json` `data-*` candidates on the page (deduped, document order, capped at 5) instead of only the first; add-time
  resolution tries each in turn and takes the first that actually parses to chapters, so a decoy `.json` pointer
  (e.g. a settings/config file) ahead of the real chapter-data file no longer wrongly falls through to feed/page-watch.
  Micro-cleanup: `apiAdapter.ts`'s `getPath` uses `Object.hasOwn` instead of `key in` (own-property check). Filed
  **WP-APIZERO** (API-source parsed-zero regression signal, low priority).
- **2026-08-18** — **WP-45 DONE — API-first adapter (plain-REST slice).** A source can be tracked by reading its
  chapter data API (JSON) directly instead of render + DOM scrape: schema `SourceType.API` + `Source.apiUrl`/`apiMap`;
  pure `parseApiChapters` + generic `probeForApi`; add-time auto-probe + a `set-api-descriptor` CLI escape hatch; the
  poll reads the API and fires WP-20 unlocks natively (render eliminated, 304-able). Filed **WP-45b** (CF-gated REST
  transport: `renderPage` returns raw JSON) and a **`freeAt`** note (per-chapter scheduled-unlock, deferred →
  predicted unlocks). `NEXT` → WP-45b.
- **2026-08-18** — **WP-SIMPLIFY Tier D done: client-component de-duplication (D1–D3).** (1) A `useDeleteSeries`
  hook single-sources the confirm/busy/error delete machine behind the shelf + detail delete components (each
  keeps its own JSX; Escape-to-cancel standardized to a window listener). (2) `add/page.tsx` gets a typed
  `AddSeriesResponse` union + a `postSeries` helper, removing three progressive `as` casts. (3) `SeriesDetail.tsx`
  folds `backfill` + `trackUnlocks` into a shared `postAction` helper. Behavior-preserving; no unit harness for
  client components, so verified against the full **Playwright E2E suite (11 passed)** + typecheck. This closes out
  the SIMPLIFICATION-PLAN backlog — both structural items (A1, A2) and every tier (B, C, D) are now landed.
- **2026-08-18** — **WP-SIMPLIFY A1 done: `backfill` pure-core extraction out of `services/index.ts`.**
  The last concentrated debt from the simplification pass — `backfillFromToc`'s un-unit-tested decision logic
  (the reindex-collision predicate, the three-way title-source choice, the self-heal TOC-discovery hop) — now
  lives in a pure, fake-tested `server/services/backfill.ts`: `computeBackfillPlan` (diff + `tocReindexable` +
  reindex map + persists), `chooseTitleUpdate` (the title decision), and a thin async `runBackfill` orchestrator
  driven by injected `BackfillPorts` (mirrors `pollPorts`/`schedulePorts`). `index.ts` keeps only the Prisma
  binding of the four ports (`loadSeriesMeta` folds the ownership + active-source loads into one). 23 new unit
  tests cover the self-heal accept/reject, the title-source branches, and the three reindex cases that were
  previously reachable only through the integration DB. Behavior-preserving: all 84 integration tests stay green.
  Remaining WP-SIMPLIFY backlog: the optional Tier D (client-component hooks).
- **2026-08-17** — **WP-50 done: link-only add (reframed from "reject no-chapter adds").** The original WP-50
  scope — reject a PAGE_WATCH resolution that seeds 0 chapters — was reframed on the owner's call: now that
  delete is one click (WP-51), being able to add a blocked/unreadable series as a link-only shelf entry is more
  valuable than rejecting it outright. When resolution can't read a chapter list, `addSeries` returns
  `needsConfirm` instead of throwing or silently creating an empty series, with a reason: `blocked` (site
  unreachable / Cloudflare) or `no-chapters` (the page loaded but has no chapter list **and** no discoverable
  TOC page). The add page shows a reason-specific confirm with an editable title and Add-anyway/Cancel;
  confirming re-POSTs `allowLinkOnly: true`, which **short-circuits** resolution (no re-fetch, since the first
  attempt already established the site can't be read) and creates a `PAGE_WATCH` source flagged
  `Source.linkOnly`, excluded from polling. A "link-only" badge surfaces on both the shelf and the detail page.
  **Refinement during build:** a landing page with a discoverable `tocUrl` but 0 landing chapters still creates a
  normal (non-link-only) `PAGE_WATCH` — it fills in via backfill — so `needsConfirm` fires only when there are
  **0 chapters and no `tocUrl`**. The legit FEED-empty case (WP-43: a valid feed match with nothing in-window
  yet) is preserved and still resolves normally. E2E (WP-PW) covers the confirm flow. Filed two follow-ups:
  **WP-NOTES** (detail-page notes UI over the already-persisted `notes` field — pairs with link-only manual
  tracking) and **WP-RETRY** (low priority — a manual "retry fetching chapters" to auto-upgrade a `linkOnly`
  source once its site becomes reachable). WP-50 moves to ✅ Completed; `NEXT` advances to **WP-45**.
- **2026-08-15** — **Filed WP-52 (poll-time hard-fail render escalation).** WP-46 escalates a PLAIN source to
  RENDER at *add-time* on a hard-fail/under-fetch, and at *poll-time* only on a regression/under-fetch signal
  ("rendered too few"). But a PLAIN source whose poll **fetch is blocked** (Cloudflare 403 / HTTP_4XX) is never
  escalated — so a CF-guarded source that landed as PLAIN silently stops getting chapters until a manual backfill.
  WP-52 adds the poll-time hard-fail → RENDER escalation (the analog of WP-46's add-time one), persisting
  `fetchMode = RENDER`. Affects every CF-blocked PLAIN source, not just the one observed in local testing.
- **2026-08-15** — **WP-PW done: Playwright E2E harness + UI coverage + CI.** Stood up the deferred E2E harness:
  `playwright.config.ts` serves the app via **`next dev` gate-off** (no `AUTH_SECRET` → middleware open in dev;
  `next start` is unusable — it forces production, fail-closing the gate) against a dedicated **`webnovel_e2e`**
  Postgres DB, with a guarded `resetDb` + `seedSeries` (`e2e/support/db.ts`) and a per-test reset fixture. Nine
  specs cover all four shipped UI-only flow-groups — WP-51 delete (detail + shelf + Cancel guards + no-navigate),
  WP-30 title edit, WP-10 library/detail controls + clickable chapter links, WP-34 source-action buttons (Backfill
  / Track-unlocks **stubbed via `page.route()`** — deterministic + offline; the server-side add/reconcile stays
  owned by the integration tests). Added a CI **`e2e` job** (Postgres service + `playwright install` + `migrate
  deploy` + run, report artifact on failure), so the coverage is enforced on every PR — the WP-PW checklist is
  cleared. Harness is structured for a cheap future **auth-aware** switch (config-localized). Untracked the
  generated `next-env.d.ts` (its dev/build route-types path flip was dirtying the tree on every E2E run). `NEXT`
  advances to **WP-50**.
- **2026-08-13** — **WP-51 done: client-side delete series.** Added a `DELETE /api/series/[id]` route over the
  existing `deleteSeries` cascade (already backed `db:cleanup delete-series`). Two confirm-gated entry points:
  a **detail-page** delete — rendered **above the chapter list** per owner call — that inline two-step-reveals
  a confirm and, on success, redirects to the shelf; and a **shelf-card** delete — a trash button that's a
  *sibling* of the card `Link` (so tapping it never opens the series) behind a compact confirm popover, then
  `router.refresh()` on success. WP-51 moves to ✅ Completed. Since no React test harness existed when this (and
  the other recent UI-only WPs) landed, coverage was verified by app-driving rather than automated tests — so a
  new **WP-PW** (Playwright E2E harness + backfill UI coverage) was filed and made `NEXT`: stand up the deferred
  harness, then work through a seeded **UI-coverage checklist** (WP-10, WP-34, WP-30, WP-51) so that deferred
  coverage is tracked instead of lost, and lands before the backlog grows further.
- **2026-08-13** — **WP-30 done: manual title-edit UI (inline detail-page `<h1>` edit → PATCH title →
  `titleIsManual` pinned).** Closes out WP-30 (title-backfill core landed 2026-07-31; this ships the escape-hatch UI):
  a pencil affordance on the series detail-page `<h1>` swaps to an input (Enter/Esc/Save/Cancel), PATCHes
  `/api/series/[id]` with `{ title }`, and the service persists it while setting `titleIsManual = true` so
  auto-backfill won't clobber a hand-fix. Validation (trim/empty/non-string/≤500) + service + component, unit +
  integration tested (no React harness, so the component is verified by app-driving). WP-30 moves to ✅ Completed;
  `NEXT` advances to **WP-51**. Its "third cause" (consent/cookie-banner `<h1>` reject-list) is split out as a
  standalone active-queue row, **WP-30b**, so it isn't orphaned now that WP-30 itself is done — and the WP-28
  HTML-entity-decode-at-extraction note (same file, `lib/feeds/title.ts`) is folded into WP-30b alongside it, since
  both are small pure extraction fixes to the same module; the display-side entity-decode fallback stays under WP-28.
- **2026-08-13** — **API-first probe across render sources → raised WP-45, lowered WP-31.** Checked whether the
  JS/render/interaction sources expose a **chapter data API** to skip render + tab/pagination/load-more. Result varied:
  a JS paid source has a **plain public REST API** (no CF, no auth) returning all free+premium chapters with
  `isFree`/`freeAt`(scheduled-unlock)/`price` → **eliminates render**, moots its tab-capture, and gives native WP-20 +
  predicted unlocks; a WordPress paid source has a **CF-gated** REST API (all + `locked`, still needs render to reach);
  the earlier static-JSON SPA is a third shape. But a load-more source **embeds** its data (no API), and static-HTML
  sources don't need one. So **WP-45 was generalized** from "static-SPA JSON" to a broad **API-first adapter** (probe
  for a data source before render + interaction; feed access/`freeAt` into WP-20) and **moved up** the queue; **WP-31**
  (renderer tab/pagination interaction) was **moved down** and marked *superseded by WP-45 where a source has an API*
  (the main tab/pagination sources do). Also verified a split-TOC source has **no** API (sitemap 500 / `wp-json` 401 /
  empty feeds) → its follow-next-page (WP-32) stands. (Real-site detail in local, uncommitted notes.)
- **2026-08-13** — **Folded two render-source findings into WP-30 + WP-31 (from a render-cleared WordPress source).**
  A newly-RENDER series came in with a wrong title and only ~50 of ~200 chapters. **(1) Title:** the page's *only*
  `<h1>` was a **CCPA/consent-manager banner** ("Opt out of the sale…"); `extractSeriesTitle` (h1-first) grabbed it —
  the real name was only in `<title>`. → **WP-30** gains a "third cause": reject boilerplate/consent-banner h1s and
  fall through to `og:title`/`<title>`. **(2) Pagination:** the TOC is **Alpine.js client-side pagination** (~50/page,
  "Prev/Next" `@click`, not "load more") that **replaces** the page → the renderer only got page 1. → **WP-31** (now
  the general renderer per-host interaction descriptor) gains a third interaction: click "Next" and **union across
  pages** — but the **better fix (verified)** is the site's **WP-REST chapters API**, which returns all chapters *and*
  a per-chapter **`locked`** flag → full list + native **WP-20** access in a few JSON calls, no DOM scraping;
  cross-referenced from WP-32 (which owns the *server-side* sibling-page flavor). Both `TODO`. Also **corrected the
  source's classification** in local notes: render **clears** it → it's the render-clearable class (server-side WP-20
  unlocks feasible), not the anti-headless "needs-unblocker" set.
- **2026-08-13** — **Filed WP-50 + WP-51 (small add-path/cleanup WPs), slotted just below WP-30 (owner).** **WP-50** —
  reject no-chapter / non-TOC adds: `addSeries` silently creates an empty (0-chapter) series from a chapter link,
  a "browse all series" index, or an arbitrary page; guard a PAGE_WATCH-0-chapter resolution (plain + render) with a
  reject/help message, while still allowing the legit FEED not-in-window empty (WP-43). **WP-51** — client-side delete
  series: a detail-page Delete → `DELETE /api/series/[id]` → the existing `deleteSeries` service; split out of
  WP-CLEANUP-UI (which keeps merge/reset/edit) for a quick win. `NEXT` unchanged (**WP-30**).
- **2026-08-12** — **WP-34 done: feed→TOC switch to lock-monitoring (backend + CLI + in-app button).** Add-time
  lock-detect diverts a readable locked-TOC feed to PAGE_WATCH; a `reclassifySource` flip primitive + `switchToPageWatch`
  (flip + silent render-escalating backfill) power a detail-page **"Track unlocks"** button (`POST /api/series/[id]/switch`)
  and CLI (`reclassify-source [--render]`, `backfill --render`); `parseToc` drops `chapter.permalink`-style stubs.
  **Render-clears-CF validated** against a real CF site (deployed `/api/render` returned the full TOC where a plain
  fetch 403s) — but it's a **subset**: stronger CF challenges still defeat headless, and those stay WP-29. `--render`
  from the CLI needs `RENDER_URL`/`RENDER_SECRET` in the local env pointing at the deployed renderer. **Deferred:**
  number-keyed transition reconcile (unvalidatable without a dual-source site); broader anchor filtering → WP-32.
- **2026-08-11** — **Fix: `parseToc` now matches the full word "Episode".** The two chapter-filter regexes in
  `pageWatch.ts` (`CHAPTER_TEXT`/`CHAPTER_HREF`) matched `ch<d>` and the short `ep<d>` but not `episode`, so a TOC of
  `Episode 244` → `/episode-244-…/` links captured **0** chapters. `parseChapterNumber` already knew `episode`; aligned
  the filters with `ep → ep(?:isode)?` (optional, so short `ep N` still matches — no regression). Test-first.
- **2026-08-11** — **WP-49 done: page-watch divert for un-isolable multi-novel advertised feeds.** In `addSeries`,
  when an **advertised** feed can't be positively isolated (`chooseSeriesMatch` null, not a guessed feed) and the
  series page is a **real TOC** (`parseToc` > `RENDER_ESCALATION_MAX`), resolve to a series-scoped `PAGE_WATCH`
  source (`feedUrl` null, seeded from the page TOC) instead of defaulting to `WHOLE_FEED` — which had ingested every
  novel on a site-wide `/feed/`. The page TOC is parsed once and reused (merge / divert check / page-watch seed);
  `chooseSeriesMatch` is unchanged. **Limit:** a tiny brand-new series (TOC ≤ 5) still WHOLE_FEEDs until it grows.
  **Deferred:** acronym/slug-prefix feed-matcher intelligence (fragile, and page-watch is the better source anyway;
  the series *is* identifiable in the feed by acronym, but density + fragility make the matcher not worth it) →
  folds into WP-39b / WP-WORKID; page-blocked multi-novel feeds; existing contaminated series (→ WP-38 /
  `db:cleanup`; the `reclassify-source` CLI gap stays → WP-CLEANUP-UI). Consequence: a diverted series polls on the
  general (daily) cadence, not WP-43's 2h PLAIN-FEED trigger — fine for slow multi-novel series.
- **2026-08-10** — **WP-46 done: add-time render escalation + poll regression guard.** `addSeries` gained an optional
  `render` port (our own `/api/render`, no third party). Two escalations: (1) **hard-fail** — when the plain page is
  CF-blocked and no feed is reachable, render once and re-resolve the rendered body (a rendered TOC → PAGE_WATCH
  `fetchMode: 'RENDER'`; a revealed advertised feed → FEED PLAIN) before throwing; (2) **under-fetch** — a plain
  PAGE_WATCH TOC reading ≤5 renders and keeps the rendered chapters only if strictly more, persisting `fetchMode`
  accordingly. `ResolvedSource.fetchMode` is now persisted on the `Source` row. Separately, the **poll escalation
  trigger** changed from `read ≤ 5` to `read ≤ 5 AND read < stored count` (a memory-free regression signal), so a
  genuinely-small series is never pinned to RENDER. Add path refactored into an inner `resolveFrom(pageResult,
  bodyMode)` run once on the plain fetch and once on the rendered body. **Limits:** silent-growth-behind-JS (plain
  never regresses) isn't auto-caught — remedy is a one-time render-backfill, which bumps `stored` and thereby arms the
  regression guard; a periodic render-reconcile is a possible future WP. Full detail in the WP-46 design spec.
- **2026-08-10** — **Reprioritized: WP-46 → `NEXT`, WP-34 moved below it.** WP-34's end-to-end "now free" is
  CF-gated and dormant until the CF-unblock story lands; that story is WP-46 (add-time render escalation clears CF's
  JS challenge). So WP-46 is the actionable next, and WP-34 now lists WP-46 as a dependency.
- **2026-08-10** — **First prod `db:cleanup`: de-contaminated a WHOLE_FEED-bound multi-novel series (WP-49 driver).**
  Pruned 10 cross-novel phantom chapters (the site feed's rolling window, pulled in by `WHOLE_FEED`) and flipped the
  source `FEED`/`WHOLE_FEED` → `PAGE_WATCH` so it stops re-contaminating and now catches the series' real updates (the
  dense feed was rolling them off before we'd poll — the exact case WP-49/page-watch is for). The flip had to be a
  **manual one-row DB update** — the CLI has no source-type reclassify → noted the `reclassify-source` gap on WP-49.
  Series verified clean (141 chapters, no cross-novel strays, source `PAGE_WATCH`).
- **2026-08-10** — **WP-48 done: Blogger feed-path in `guessFeedUrls`.** The function now offers Blogger's
  `/feeds/posts/default` (Atom) + `?alt=rss` (RSS) — **first** for `*.blogspot.com` (skips the WordPress `/feed/` 404s),
  **last** for every other host as a **universal fallback** that also rescues custom-domain / ccTLD Blogger (owner chose
  universal-last over blogspot-only). So a Blogger series binds via its feed even when the page fetch is blocked from
  Vercel — no render, 304-able. Pure change, no `addSeries`/schema change; the rare non-Blogger wrong-bind is held off by
  strict-last ordering + `looksLikeFeed`. `NEXT` → WP-34 (dormant/CF-gated) or the freshly-filed WP-46/WP-49 add-path
  fixes — owner's call.
- **2026-08-10** — **Added WP-49 (WHOLE_FEED contamination on multi-novel advertised feeds).** Owner added a multi-novel
  WordPress series via its TOC post and got ~150 real chapters **plus** cross-novel chapters (another novel's "Ch. 57.1").
  Diagnosed + **confirmed in prod (Neon)**: a **`WHOLE_FEED`** binding to the site-wide `/feed/`. The post advertises the
  site-wide feed (multi-novel, `Uncategorized`, date-permalinks); `chooseSeriesMatch` can't isolate the series, so
  `addSeries` trusts `WHOLE_FEED` and merges the whole rolling window into the series — a one-time add snapshot **and** an
  ongoing per-poll leak. New **WP-49**: don't default to `WHOLE_FEED` when a page-advertised feed can't isolate the series
  and looks multi-novel — prefer PAGE_WATCH (the series post is clean) or a scoped fallback. Shares WP-39b's multi-novel-
  detection root; not covered by WP-36 (parseToc-only). Existing bound series need re-point + prune (WP-38). `TODO`.
  (Real-site detail in local, uncommitted notes.)
- **2026-08-10** — **WP-39b done (re-scoped): tocUrl page-watch dedup + create-then-annotate.** (a)
  `canonicalSeriesId` now keys a page-watch series on `canonical(tocUrl ?? sourceUrl)` — going-forward only, no
  migration — so a home-URL add and a later TOC-URL add for the same series collapse into the existing
  `alreadyExisting` path. Pure `findSimilarTitle` (normalized-equality + leading-token-prefix, drops a leading
  article) feeds a **create-then-annotate** flow: a title-similar add still creates the series, but the result
  carries a `similarTo: {id,title}` hint, surfaced on the add page as a non-blocking "Open the existing / Keep
  both" notice — merging from the app itself is deferred. Documented limit: `findSimilarTitle` cannot catch a
  different *translation* of the same work. **No schema change.** Original (b) multi-novel matcher-type-flip is
  covered in spirit by the annotate net (no tighter canonical key); original (c) true multi-novel matcher
  intelligence is deferred, revisit reactively. Filed **WP-CLEANUP-UI** (in-app cleanup surfacing `db:cleanup`;
  its merge doubles as the manual same-work/different-translation resolver) and **WP-WORKID** (future, low —
  cross-translation identity via a community aggregator's canonical work ID). `NEXT` → WP-34.
- **2026-08-10** — **Three "couldn't reach or find a feed" add failures → extended WP-46 + added WP-48.** Owner
  couldn't add three sites; all hit the `addSeries` **final throw** (only reached when `pageOk === false` AND no feed).
  Two (a no-feed CF host + a JS-rendered CF host) are the **CF-on-Vercel add-path gap**: the plain fetch is challenged
  from Vercel's datacenter IP (both 200 residentially), there's no usable feed, and add-time never escalates to render —
  so **extended WP-46** to cover the *hard-fail* case (retry via **our own render** before throwing; render clears CF's
  JS managed challenge, so **no third party** — the WP-40 cheap-bypass was the dead end, not render). The third (a
  **Blogger** source) was the surprise: **not** Cloudflare, 200 under any UA, 357 chapters + a valid advertised feed —
  yet it throws because (a) the page fetch fails from Vercel (Google serving the datacenter IP a non-200) and (b)
  `guessFeedUrls` is **Blogger-blind** (guesses WordPress `/feed/` = 404, never `/feeds/posts/default`), so the
  advertised feed is skipped on the failure path. → new **WP-48** (add the Blogger feed path to `guessFeedUrls`; cheap,
  no render, 304-able). Both `TODO`. (Real-site detail in local, uncommitted notes.)
- **2026-07-31** — **WP-30 backend core done: series title backfill from TOC.** Pure `extractSeriesTitle(html,
  {siteName?})` (`lib/feeds/title.ts`) reads `<h1>` → `og:title` → `<title>`, with a conservative host-matched
  suffix strip across pipe + hyphen/en-dash/em-dash separators (returns `null` on no usable heading), plus a loose
  `matchesSiteName` (case-insensitive, strips `www.`/TLD/non-alphanumerics). Additive `Series.titleIsManual Boolean
  @default(false)` migration. **Add-time:** stored-title precedence is `input.title → page <h1>/og/title → per-path
  fallback`; the WHOLE_FEED path no longer adopts a feed channel `<title>` that equals the site name (falls back to
  the URL-slug title instead). **Backfill (`backfillFromToc`):** repairs a non-manual title from the **landing
  page** (landing-primary, per WP-37's reverse-info finding) — the self-heal path reuses the already-fetched landing
  body at zero extra fetch; a `tocUrl`-already-set backfill does one extra `source.url` fetch for the title; silent
  (no push); returns `titleUpdated?`. **Manual title-edit UI (detail-UI input + PATCH `/api/series/[id]` setting
  `titleIsManual = true`) is deferred as its own follow-up sub-project** — the flag shipped so it's ready. Enables a
  cleaner WP-39b(a) (page-watch home-vs-TOC dedup can lean on a WP-30-clean title match). Unit tests for
  `extractSeriesTitle`/`matchesSiteName`; integration tests for add-time preference (incl. the site-name guard) and
  both backfill repair paths + the manual-not-clobbered case. Typecheck clean.
- **2026-07-31** — **WP-37 post-review hardening.** Dropped the bare `toc`/`index` tokens from `findTocUrl`'s
  anchor-text heuristic (`lib/feeds/discover.ts`) — a footer/nav link literally texted "Index" or "TOC" was
  resolving a spurious TOC URL for feed series; the heuristic set is now `table of contents` / `chapter list` /
  `all chapters` only. Added a negative unit test proving the false-positive vector is closed, and restored an
  integration test covering skip-already-seen on the tocUrl backfill path (the two original WP-37 backfill tests
  both seeded 0 chapters at add, so neither exercised diffing against a chapter already stored). Nav/chrome
  anchor-filtering for `findTocUrl` (mirroring `parseToc`'s) filed under WP-32. Full suite + typecheck clean.
- **2026-07-31** — **WP-37 done: per-series chapter-TOC URL.** Additive `Source.tocUrl String?` migration. Pure
  `findTocUrl(html, baseUrl)` (`lib/feeds/discover.ts`) discovers the on-page chapter-TOC link via an anchor-text
  heuristic (table of contents / chapter list / all chapters / toc / index), guarded same-host and against
  self-links/cross-host anchors. Resolved at **add-time** on both the feed and page-watch paths; **self-healed at
  backfill-time** (a null `tocUrl` is discovered, followed one hop, and persisted) — never re-discovered on poll.
  `backfillFromToc` uses `tocUrl ?? url`; page-watch poll fetch is `feedUrl ?? tocUrl ?? url`. Reverse-info exploration
  written up. **Caveat:** a landing≠TOC series still seeds its add-time chapters from the landing page only, so it
  shows 0 chapters until its first backfill/poll fills it via `tocUrl` — that's the already-tracked WP-46 add-time
  under-fetch gap, not a WP-37 bug. **Steers WP-30:** the probed source's standalone TOC page title is a
  slug-abbreviation with no `og:title`, while the landing page carries the real title + cover — WP-30 should prefer
  the landing page's content heading, TOC page only as fallback. Unblocks WP-39b(a). Typecheck clean.
- **2026-07-31** — **WP-39 done: add-time dedup.** Pure `canonicalSeriesId` (`lib/dedup.ts`) keys a feed series on
  `canonical(feedUrl)#matcher` and a page-watch series on `canonical(sourceUrl)` (scheme/www-insensitive); `addSeries`
  computes it post-resolution, and a new `findSeriesByCanonicalId` port makes a duplicate return the existing series
  (`alreadyExisting`, route 200) instead of a second row — `createSeries` never runs. Catches all re-adds + home-vs-TOC
  for feed series; keeps multi-novel-feed siblings distinct. The CATEGORY value is `slugify`d so a re-add's positive
  match (category name) converges with the fallback match (URL slug). No schema change. Residuals (page-watch
  home-vs-TOC; multi-novel matcher-type flips across feed windows) filed as WP-39b (after WP-37/WP-30); WP-19 noted for
  alternate-source-on-dup. +9 unit +1 integration, typecheck clean.
- **2026-07-31** — **WP-27a refinement: gate the fetch, not the processing.** The cadence gate now decides only whether
  a group is *fetched* (`anyDue`) — once fetched, every source it covers is processed. Skipping an already-fetched
  not-due PLANNED sibling saved ~nothing (parse/diff on a body in hand) and staled a backlog we were holding fresh data
  for; now it rides the shared fetch for free (new-chapter/now-free pushes stay READING-only; sibling etags stay in
  sync). The expensive-fetch win (solo/all-not-due groups never fetch) is unchanged. *Caveat:* source-down alerts
  aren't status-filtered, so a shared-feed outage surfaces co-hosted PLANNED siblings in lockstep — routes to WP-16
  (host-level dedup) / WP-27b (non-READING suppression). 320 unit + 56 integration green.
- **2026-07-31** — **WP-27a polish (post-review).** Relocated the test-only `pollSource` out of production (`poll.ts`
  no longer exports an ungated, wire-able single-source poll — it's a local helper in the test file); the multi-run
  test fake stamps the run's `now` instead of a max-date sentinel.
- **2026-07-31** — **WP-27a done: status-gated + cadence polling.** Pure `statusPollGate` + `STATUS_CADENCE_MINUTES`
  (READING every run; PLANNED weekly; PAUSED/COMPLETED/DROPPED never) gate `pollAllSources`: COMPLETED/DROPPED/PAUSED
  filtered from `loadActiveSources`, a group with no due source is not fetched, PLANNED polls at most weekly (rolling
  per-source window; WP-41 rotation prioritizes due-and-stale and guarantees deferred pickup). `seriesStatus` rides
  `PollableSource`/`PollEffects`; `notifyForEffects` pushes only for READING (PLANNED polls quietly). No schema change.
  Dropped the WP-27 summary-seeding idea (storage isn't the constraint); refiled per-status notify rules as WP-27b.
  +11 unit +3 integration tests, typecheck clean.
- **2026-07-30** — **WP-09 push hardening + WP-47 added (low).** `classifyPushFailure` (pure, tested) now prunes a
  **403** sub (VAPID key mismatch) alongside 404/410, and the push port logs the failing HTTP status + endpoint host so
  a persistent failure is diagnosable in the Vercel logs (was a silent `failed` count). Surfaced from a live WP-43 poll
  showing `pushed:{sent:1,failed:1}` — a stray subscription failing every send. +7 unit tests (309 total), typecheck
  clean; merged to `main` (`dc3cb6e`). Filed **WP-47 (low)**: the client self-heal `resyncSubscription` re-posts a
  stale-key browser sub, so a 403-pruned sub churns and the client shows "subscribed" while receiving nothing —
  detect the `applicationServerKey` mismatch on load and unsubscribe+resubscribe under the new key.
- **2026-07-30** — **WP-43 done: frequent PLAIN-tier polling.** External GitHub Actions trigger (`.github/workflows/poll.yml`,
  every 2h, `workflow_dispatch` for manual runs) calls `/api/cron/poll?tier=plain` with secret URL + `CRON_SECRET`.
  Pure `sourceTierWhere` (FEED+PLAIN vs all) + fail-safe `parsePollTier` (only `plain` narrows) thread a `PollTier`
  through the `pollAllSources` edge into `loadActiveSources`; the WP-41/42 loop is untouched. Daily Vercel cron stays a
  full superset (safety net; WP-41 rotation already front-loads RENDER). Neon budget ≈ ~40 compute-hr/mo at 2h — don't
  go below 2h. +6 unit +2 integration tests, typecheck clean. Owner sets `POLL_URL` + `CRON_SECRET` repo secrets.
- **2026-07-30** — **WP-41 done: poll time-budget guard + rotation.** `pollAllSources` now drains hosts
  least-recently-polled-first (`orderGroupsByStaleness`, reusing `lastCheckedAt` — no schema change) and stops
  starting group fetches once the run can't finish one within `POLL_BUDGET_MS` (270s), skip-not-break so a later
  cheap group still fits; per-group cost estimated by `groupCostMs` (RENDER 15s / PLAIN 5s). Injected `clock` makes
  the guard deterministically testable. Cron `maxDuration` **60→300** after confirming (Vercel docs) 300s is Hobby's
  real ceiling and the old 60s was self-imposed. +12 unit tests (296 total) + 50 integration green, typecheck clean.
  Follow-up noted on WP-43: budget×cadence becomes a real Neon-compute number once polling goes hourly.
- **2026-07-30** — **WP index restructured (split + priority) + housekeeping.** Split the flat 40+-row index (where
  DONE rows were interleaved with active ones and row-order-as-priority had stopped meaning anything) into four tables:
  **▶ Active queue (M1)** — WIP/TODO ordered by real priority so row-order means something again (WP-41 NEXT → WP-43 →
  WP-27 → add/identity → sources → UI → pure libs → the three *low* items WP-31/32/45); **✅ Completed**; **⏭ Later
  tiers (M2–M4)**; **🚫 Parked (WP-40)**. Consolidations: **WP-44 folded into WP-32** (one `parseToc`-robustness WP =
  split TOCs + all anchor filtering + URL-slug number authority); **WP-RC renumbered → WP-46 and re-scoped** to
  *add-time* under-fetch escalation (fetch properly when `addSeries` seeds ≤5 chapters) since WP-43 now covers the
  *ongoing* dense-feed miss; **WP-45** (JSON-adapter rung, low) added to the index; **WP-29** flipped `WIP`→`TODO`
  (lib/schema/cron done, editor UI + push delivery remain — picking up later). No code change.
- **2026-07-30** — **Added WP-45 (JSON-adapter rung for static-SPA sources; low priority).** Testing a static SPA (a
  Cloudflare Pages host) whose plain fetch returns only a ~2.4 KB shell + a "Read" CTA — its hundreds of chapters are
  injected client-side from a **static, 304-able JSON** file. RENDER already captures them (validated) and the WP-17b
  escalation self-heals it, so this is filed **low priority**: a per-site JSON adapter would read the data file directly
  (cheaper + 304-able + correct titles), but the JSON shape is bespoke — only worth it if the pattern recurs. `TODO`.

- **2026-07-30** — **Added WP-44 + extended WP-30 from testing a concatenated-title custom source; consolidated anchor
  filtering.** A cleanly-fetched plain series (206 chapters) surfaced three parse issues, none a fetch problem:
  **(1) wrong numbers on ~110 chapters** — the site jams `Ch.<seq>` onto the raw source label ("Ch.2"+"02" → "Ch.202"),
  and `parseToc` reads the title number first, so it takes 202 instead of the URL slug's correct 2; **(2) a "Last
  chapter" shortcut + "Read" button** duplicate the newest chapter/ch 1 and, via first-wins dedupe, poison WP-35
  position 0; **(3) the displayed *series title* is the *site* name** — the adopted per-series feed's channel `<title>`
  is the site name, not the series (the real name was in the page `<h1>`/`og:title` and the feed item titles). Landed
  as: new **WP-44** = the *number-source* half only (prefer the delimited URL-slug `/chapter-<N>-` number over a
  concatenated title number); the **anchor-filtering** half folded into **WP-32** (now the single owner of
  non-chapter-anchor filtering — pagination + shortcut/CTA; WP-36's done region-scoping stays separate); and
  **extended WP-30** (site-name-from-feed-channel title → page-`<h1>` backfill with site-suffix strip + smarter
  add-time feed-title derivation). All `TODO`. (Real-site detail kept in local, uncommitted notes.)
- **2026-07-30** — **WP-42 DONE: poll-once-per-feed + politeness, real-DB verified.** Closed out the design with
  integration coverage: two series sharing one feed URL (isolated via distinct `PATH_PREFIX` matches) are now proven
  to be fetched **once** and both advance from that single fetch; a source polled **<15 min ago** (`lastCheckedAt`)
  is proven to be skipped by the min-interval gate — no fetch, `lastCheckedAt`/`lastSuccessAt`/chapter count all
  untouched. These sit alongside the existing unit-level dedup/backoff/hostGate coverage (Tasks 1–6) rather than
  duplicating it. **281 unit + 49 integration tests green, typecheck clean.** WP-43 (frequent external-trigger
  polling) is now unblocked on the WP-42 side; still wants WP-41 (poll time-budget guard), which is `NEXT`.
- **2026-07-29** — **Designed WP-42 (poll-once-per-feed + politeness) + WP-43 (frequent polling); verified the feed
  reaches Vercel.** The dense-feed miss is a polling-*frequency* problem, not a Cloudflare one — but before committing
  to the design we settled a real confound (an earlier feed-poll success coincided with an unusual TOC success, and the
  health machine resets failure state on success, so current columns couldn't answer it). A throwaway feed-reachability
  probe (loop N GETs, report egress IP + per-attempt class; run on a preview) gave the decisive result: from the **same
  egress IP**, the **TOC page challenged 5/5** while the **`/feed/` returned 30 items 8/8** → Cloudflare gates the
  **page, not the feed**, so the feed is **reliably reachable from Vercel regardless of IP**. Design (owner-approved):
  `2026-07-29-poll-dedup-politeness-design.md` — a **feed-centric** poll loop (group sources by `(fetchMode, fetchUrl)`,
  fetch each feed once with a shared conditional GET, fan out per-series), **honor 429/Retry-After** (additive
  `Source.backoffUntil`), a **per-host min-interval cap** (uses `lastCheckedAt`), and **RENDER excluded from the fast
  tier**. WP-43 (external trigger, since Hobby cron is daily) is the follow-up and composes with WP-41 rotation + WP-27
  cadence. Kept the browser-like UA (an honest bot UA risks *more* CF challenges for marginal gain on a private app).
  Probe fully torn down (branch deleted local + remote; nothing on `main`). *(Real-host probe detail kept in local,
  uncommitted notes.)*
- **2026-07-29** — **Fix: `chooseSeriesMatch` isolates a discovered multi-novel feed instead of defaulting to
  WHOLE_FEED.** Found when re-adding a series on a dense multi-novel WordPress site ingested ~30 cross-work chapters and
  took its title from an unrelated work's feed entry. Root cause: `addSeries` only applied the slug fallback when the
  feed was *guessed* (`usedGuesses`); a series page that advertises the **site-wide** `/feed/` yields a *discovered* yet
  multi-novel feed, and when `chooseSeriesMatch` couldn't isolate the series (absent from the ~30-item window) it
  returned `null` → `WHOLE_FEED` → every work merged in + title from the feed's channel entry. Fix (test-first, pure):
  with no positive tie, `chooseSeriesMatch` now detects a *demonstrably multi-novel* feed — **≥2 distinct novel
  categories**, or **other works under the series' parent path** — and returns the `fallbackSeriesMatch` isolation
  (CATEGORY-slug or PATH_PREFIX) rather than `null`; it still returns `null` for a single-work / custom-scheme feed so a
  real per-series feed stays WHOLE_FEED (no regression). **260 unit + 47 integration green, typecheck clean.** *(Also
  cleaned the prod contamination this surfaced. Separately confirmed the site's `/feed/` **does** reach Vercel, so the
  dense-feed miss is a polling-*frequency* problem, not a CF one — see the WP-40 detail + the frequent-poll follow-up.)*
- **2026-07-28** — **WP-40 PARKED after a Vercel spike: TLS impersonation can't clear the owner's CF hosts.** Chose
  [`impit`](https://github.com/apify/impit) (Apify; browser-TLS/JA3 + HTTP/2 via patched rustls, napi-rs Node binding,
  prebuilt linux-x64-gnu, ~0 runtime deps, Apache-2.0) after a research + dependency-vetting pass, and deployed a
  throwaway probe route (`/api/bypass-probe` — plain vs impit GET, bearer + SSRF-guarded) to a Vercel preview. **Both
  confirmed hosts (a dense-feed source + a no-feed source) returned Cloudflare's JS *managed challenge*** ("Just a moment…",
  403, ~5.9 KB), `cleared:false` — the block is Vercel's **datacenter IP**, not the TLS fingerprint, so no cheap
  code-only GET clears it (research confirmed: `cloudscraper` dead for managed challenges; FlareSolverr/Byparr = headless
  browsers = render cost; `cf_clearance` is IP+UA+TLS-bound so cookie-caching fails on Vercel's rotating IPs). The
  premise ("static, merely IP-challenged") was wrong. **Disposition:** keep CF hosts on **render**; self-hosted
  residential egress (the only cheap/304/private alternative) declined (no always-on home box); **pivot to WP-41 (poll
  budget guard) + WP-27 (cadence gating)** to make render sustainable. Third-party unblockers noted for later revisit —
  but they carry the privacy tradeoff *and* likely the same per-request budget limit, so WP-41/27 are prerequisites
  regardless. Spike fully torn down: branch `wp40-cf-impit-spike` deleted (local + remote); no `impit` dep, probe route,
  or middleware exemption on `main`. *(Detour cost: several deploy cycles chasing a 401 that turned out to be the
  single-user **auth middleware** gating `/api/bypass-probe` — the probe needed the same public-allowlist exemption as
  `/api/render`/`/api/cron`. Not a real auth bug; only surfaced because previews are SSO-protected + the route wasn't
  allowlisted.)* Real-host probe detail (statuses, sizes) kept in local, uncommitted notes.
- **2026-07-28** — **Fix (WP-35 follow-up): `backfillFromToc` now positions feed-ahead series instead of skipping.**
  **Where it was missing:** the WP-35 spec says a full TOC read positions *every* stored chapter — matched rows get
  their normalized index, any absent chapter is appended after the TOC block (kept, ordered last). The implementation
  instead gated on a strict `tocComplete` (order known **and** *every* stored chapter present in the TOC) and, when
  false, wrote **no** positions at all. That guard was added in WP-35 review to stop a real **windowed-TOC collision**
  (a site trimming its TOC to a recent window drops an *old* chapter; re-indexing the present rows into a fresh 0..N-1
  block collides with the dropped chapter's retained position). But it was **too broad**: it also fired for the benign
  **feed-ahead** case — a dual-source (feed + hand-maintained TOC) series whose newest chapter has arrived via the feed
  but isn't on the TOC page yet. One such chapter left the *entire* series unpositioned, so ordering fell back to
  `orderChaptersForReading`'s number comparator — which **interleaves a two-part series** (Part 1 and Part 2 share a
  chapter-number space). Surfaced on a real dual-source series after the prod cleanup: 1209 chapters, all `position`
  null, Part 1/Part 2 mixed. **The fix:** replace `tocComplete` with **`tocReindexable`** — re-index when every stored
  chapter is *either* in the TOC *or still unpositioned* (`position == null`). A feed-ahead chapter is unpositioned, so
  it's safely left null (nulls sort last = newest, colliding with nothing) while the rest re-index; the guard now blocks
  **only** when an absent chapter *already holds* a position (the genuine windowed-TOC danger), preserving that
  protection. Test-first: a new integration test reproduces the feed-ahead case (was red: covered chapters stayed null);
  the windowed-TOC test stays green. **257 unit + 47 integration green, typecheck clean.** Prod data repaired in place by
  re-running the `db:cleanup backfill` (fixed code, local, against prod) — the affected series now orders all of Part 1
  before Part 2, newest feed-ahead chapter last.
- **2026-07-28** — **Added WP-40/41 + extended WP-27 (poll scale/cost, from an owner design discussion).** Working
  through the render/CF story surfaced two structural facts: **RENDER sources can't use conditional GET** (`renderFetch`
  sends no validators, always `notModified:false` → every RENDER poll is a full ~5–15s headless render), and the daily
  cron is a **sequential loop with no time budget** under the 60s ceiling — so a pile of RENDER/CF sources (e.g. many
  PLANNED reads on one CF host) blows the budget and **silently drops the tail**. Three tracked responses:
  **WP-27 extended** to status→*cadence* gating (PLANNED/backlog polled rarely/on-demand, not just skip-COMPLETED —
  motivated by the render cost); **WP-40** — a cheap, 304-capable **local browser-TLS-impersonation** GET for
  CF-**static** hosts (server-rendered but IP-challenged), so they skip the uncacheable
  render, reserving Chromium for genuinely JS TOCs, and explicitly **not** a third-party unblocker (keeps the WP-17b
  privacy stance); **WP-41** — a poll time-budget guard + rotating start offset so the run degrades gracefully instead
  of starving a fixed tail. All `TODO`, "if scale bites" priority; WP-41 is also a latent-correctness safeguard. Also
  noted: the dense-feed CF host is CF-**static** (needs bypass, not render) and the render path can't 304. (Real-site
  detail kept in local, uncommitted notes.)
- **2026-07-28** — **WP-35 DONE: TOC-order chapters + display toggle.** Chapters now display in the site's own TOC
  order instead of an inferred number/title order. Additive migration `Chapter.position Int?`. Pure `tocReadingOrder`
  infers the TOC's direction from the chapter-number *trend* (skips when ambiguous) and maps each chapter's canonical
  URL to a 0-based oldest-first position; `orderChaptersForReading` is now **position-aware** (position primary, nulls
  last, the WP-33 number/Extra-Side comparator kept as the pure-feed fallback). Positions are assigned at add (both
  branches, via `withReadingPositions`) and on backfill — **re-indexed only from a *complete* TOC** (a partial/windowed
  TOC leaves positions untouched, new chapters null → sort last, avoiding collisions; owner-approved: polls don't
  re-index, so a TOC re-sort needs a re-backfill). Frontend: pure `arrangeChapters` computes read-state by **canonical
  position** (retiring the array-index logic — read-state is now correct in any display order) driving a
  localStorage-persisted **3-mode toggle** (oldest / newest / unread-first) on the detail page. Built subagent-driven,
  test-first (6 tasks); the final whole-branch review caught a partial-TOC re-index collision (fixed). **257 unit + 46
  integration green, typecheck + build clean.** *Deploy note: `prisma migrate deploy` (vercel-build) adds `position`
  to prod on the next push; existing rows are null → comparator fallback until re-backfilled. Toggle not yet
  browser-clicked — worth a look.* `NEXT` → WP-29 editor UI.
- **2026-07-27** — **WP-36 + WP-38 DONE: TOC content scoping + contaminated-series recovery.** **WP-36:** `parseToc`
  now filters out chapter anchors inside page chrome (`aside`/`.widget_recent_entries`/`#secondary`/nav/footer/…) in a
  single pass, with an **empty-fallback** (widget-TOC sites still parse) — so backfill/page-watch stop ingesting the
  cross-series "recent entries" sidebar; plus optional `SiteTocConfig.contentSelector`/`slugFamilies` (multi-family).
  **WP-38:** a pure `chaptersToMove` (canonical-URL union) + user-scoped cleanup services (prune/delete/reset/
  set-source-url/merge, `mergeSeries` guards self-merge and re-derives `host` on a domain change) behind a
  **dry-run-default `db:cleanup` CLI** (tsx; `--apply` to commit) — recovers the owner's phantom-chapter listings and
  the duplicate series. Built subagent-driven, test-first; the final whole-branch review verified **no** unscoped or
  un-`--apply`-gated destructive path, atomic merge, and no parseToc regression, and caught a stale-`host` bug (fixed).
  Incidental: switched the `web-push` import to default (CJS/ESM compat for tsx; `next build` confirmed). **245 unit +
  42 integration green, typecheck + build clean.** New devDep `tsx`. *Recovery runbook: `DATABASE_URL=<prod> npm run
  db:cleanup -- <cmd>` (dry-run), review, re-run with `--apply`.* `NEXT` → WP-35.
- **2026-07-27** — **Added WP-36/37/38 from production backfill testing (TOC contamination + cleanup).** The WP-33
  "Backfill from TOC" button, on a dense-feed WordPress site, added phantom **cross-series** chapters. Two bugs:
  **WP-37** — the series landing page isn't the chapter TOC (the real TOC is a separate linked URL; `source.url` was
  the wrong page); **WP-36** — `parseToc` scans the whole page including a global "recent entries" sidebar that lists
  other series' chapters (needs main-content restriction + slug-family scoping; supports multi-family Part 1/Part 2
  TOCs). **WP-38** — recover the owner's already-contaminated production listings (prune phantoms, reset+re-seed,
  re-point + clean re-backfill). Added a caution against broad use of the backfill button until WP-36/37. WP-36 is
  the higher-priority data-correctness fix. Also surfaced: a **duplicate series** (same work added via home URL and
  TOC URL) → folded merge/delete-dup into WP-38's script, and added **WP-39** (add-time dedup via the unused
  `canonicalId` field). **Owner chose to do WP-36 + WP-38 before WP-35.** (Real-site detail kept in local,
  uncommitted notes.)
- **2026-07-27** — **Designed WP-35 (TOC-order chapters + display toggle).** Follow-up to WP-33's number-based
  `orderChaptersForReading`: instead of inferring reading order from numbers/titles (prologue/Extra/Side edge cases),
  follow the **site's own TOC order** — persist `Chapter.position` from `parseToc`'s DOM order (direction-normalized via
  the number trend; skip if ambiguous), re-indexed on each full TOC read, with the WP-33 comparator kept as the
  pure-feed **fallback**. Plus a detail-page **display toggle** (oldest / newest / unread-first) with read-state
  **anchored to canonical position** (retires the array-index logic; pointer model unchanged), preference global in
  localStorage. One additive migration. Design:
  `docs/superpowers/specs/2026-07-27-wp35-toc-order-display-design.md`.
- **2026-07-27** — **WP-33 DONE: full-TOC backfill + silent access-reconcile.** Feed series now recover their whole
  history from the TOC and learn access on feed-originated chapters. New pure `accessReconciled` diff dimension
  (already-seen chapter, stored `UNKNOWN` → TOC `FREE`/`LOCKED`) — silent (access updated by stored id, **no
  `becameFreeAt`, no push**), disjoint from WP-20's `becameFree`; this **arms** now-free for feed series (a chapter
  must be known-`LOCKED` before its unlock can fire). On-demand `backfillFromToc` service + `POST /api/series/[id]/
  backfill` (reads the source's reading page, adds the older tail + reconciles access in one transaction, never pushes,
  never touches source health/etag, user-scoped) + a **"Backfill from TOC"** button on series detail. At-add: a pure
  `mergeFeedAndToc` seeds the full history (feed guids kept, TOC access, older tail appended), gated on a reachable TOC.
  URL identity spike-validated coherent across a WordPress and a custom site. **No migration.** Built subagent-driven,
  test-first (5 tasks); the final whole-branch review caught two real issues — backfilled (date-less) chapters sorted
  after the feed window (fixed by ordering on **chapter number**: un-numbered first, **Extra/Side content last**, per
  owner) and a canonical-duplicate double-insert in `mergeFeedAndToc` (fixed). **238 unit + 26 integration green,
  typecheck clean.** *Deploy note: the `/api/series/[id]/backfill` route ships on the next push; no env/migration
  change. UI button not yet browser-clicked — worth a quick tap.* Next feed↔TOC step is **WP-34** (the switch), still
  CF-gated.
- **2026-07-26** — **Designed feed↔TOC transition; added WP-33 + WP-34.** Discussed how feed series backfill and
  how/when they move to the TOC (where lock state lives). Decisions: **backfill** = one-time TOC union (at add for
  READING + on-demand action), feed stays default; **switch to lock-monitoring** = full flip to `PAGE_WATCH`, triggered
  add-time (TOC shows locks) with a manual per-series override. New building block: a **silent `accessReconciled`** diff
  dimension (`UNKNOWN`→`FREE`/`LOCKED`, no push) that arms WP-20's now-free for feed-originated chapters. **WP-33**
  (backfill + reconcile) is buildable now; **WP-34** (the switch) is mechanism-buildable but end-to-end CF-gated — the
  owner's only feed-with-locked sites are also Cloudflare-challenged (TOC unreachable). Design:
  `docs/superpowers/specs/2026-07-26-feed-toc-transition-design.md`.
- **2026-07-26** — **Added WP-31 + WP-32 from owner testing (two TOC-capture gaps).** Live testing surfaced behavior
  the current fetch/parse doesn't handle. **WP-31** — a **tab-structured premium source** (JS-rendered Free/Premium
  tabs): the renderer captures the Free tab only (the Premium tab is a disjoint, lazily-rendered list, absent until
  clicked) and access is **tab membership, not a row marker** — so WP-20's "now free" can't fire there (a real unlock
  was even observed between two tests but is invisible to us). Needs renderer `readTabs` + tab-aware access. **WP-32** —
  a **split-TOC source** whose chapter list spans sibling slugs via a "Next Chapters" link: one fetch misses the newest
  page, and the nav anchor pollutes `parseToc` with a phantom row. Needs follow-next-page (bounded hops) in page-watch
  + nav-anchor filtering. Both `TODO`, M1↑; each gets its own brainstorm→spec when prioritized.
- **2026-07-26** — **WP-20 DONE: paid→free "now free" per-chapter unlock detection.** The diff now detects an
  already-seen chapter flipping LOCKED→FREE (`DiffResult.becameFree`, keyed on the *stored* chapter so persistence
  targets the exact row), `pollSource` threads it through `PollEffects`, the binding stamps `Chapter.becameFreeAt` +
  `access=FREE` **by primary key** in the poll transaction, and `notifyForEffects` fires a privacy-safe **"Now free"**
  push (series name in the body only) riding the existing new-chapter toggle. New *locked* chapters are stored silently
  — the new-chapter push excludes `access==='LOCKED'`, so the unlock is the event that pushes. **No migration** (the
  `access`/`becameFreeAt` columns pre-existed). Built subagent-driven, test-first (4 tasks); a final whole-branch
  review caught a real bug — persistence had matched the *fetched* raw url while detection matched canonical-url/guid,
  which would silently miss (and re-fire every poll) on url drift — fixed by persisting via the stored row id. **219
  unit + 23 integration green, typecheck clean.** Deferred as designed: **WP-27**'s status rules (PLANNED+paid fires
  only when 0 locked remain) layer on this; a per-series "notify on new locked chapter" opt-in; and lock-detection
  tuning against a real locked TOC. Design: `docs/superpowers/specs/2026-07-26-wp20-paid-to-free-design.md`.
- **2026-07-26** — **Added WP-30 (title backfill + manual edit); starting WP-20.** Owner hit an acronym/URL-derived
  title (from the multi-novel add-time fallback). New **WP-30**: auto-backfill the real series title from the
  page-watch TOC (`parseToc` gains a title extract; only overwrite auto-derived titles, flag manual edits), with a
  **manual title edit** in the detail UI as the fallback/escape hatch. Then picked up **WP-20** (paid→free frontier).
- **2026-07-26** — **WP-17b DONE: renderer live-validated on Vercel.** Fixed the deploy (`outputFileTracingIncludes`
  ships the `@sparticuz/chromium` `bin/**` binary, which the file-tracer otherwise prunes → the "bin does not exist"
  runtime error). Direct `/api/render` curls against the two hard JS categories: the **Next.js tab site** rendered a
  full ~261-chapter TOC (plain fetch saw ~0), and the **load-more site** returned ~194 (the generic load-more loop
  fired — not stuck at the ~2 the shell shows). Chromium launches within the function budget. The render captures all
  chapters (free + locked); splitting them by access is `parseToc`/WP-20. Renderer + escalation are now wired
  end-to-end — a plain page-watch that under-reads self-upgrades to RENDER on the next poll.
- **2026-07-26** — **WP-17b Slice C: Vercel `@sparticuz/chromium` render prototype.** New public `/api/render` route
  (puppeteer-core + serverless Chromium): launches, renders, loop-clicks a generic "load more" control (paginated
  TOCs), returns `{ status, finalUrl, html }`. Auth by `RENDER_SECRET` bearer and **fail-closed** when unset (never an
  open SSRF surface); added to the middleware allowlist since the cron calls it server-to-server. Interaction selectors
  are generic (by visible text — no site names in the repo). **SSRF-guarded** (`server/render/ssrfGuard.ts`, 25 tests):
  rejects non-http(s) and any host resolving to a private/loopback/link-local/metadata IP, with puppeteer request
  interception re-validating redirects/subresources. `next.config` externalizes the chromium binary; `vercel.json`
  bumps the render function to 1024 MB / 60 s. Render execution not unit-tested (needs a browser) — verified live.
  **Pending: deploy + set `RENDER_URL`/`RENDER_SECRET` in Vercel + test against the real JS sites.** Tab-accumulation
  (Free/Premium) is a follow-up; v1 renders the default (free) view, which is the free frontier.
- **2026-07-26** — **WP-17b Slice B: `renderFetch` adapter + binding wiring (test-first).** `lib/feeds/renderFetch.ts`
  `makeRenderFetch(config, http)` POSTs a URL to the render service and maps the reply onto `PoliteResult` (target-page
  4xx/5xx → HTTP failures; service 5xx → HTTP_5XX; network → soft TIMEOUT), injected HTTP so it unit-tests without a
  socket (5 tests). Wired into the binding: `pollAllSources` defaults its render port to `makeRenderFetch` from
  `RENDER_URL`/`RENDER_SECRET` (undefined when unset → no-op). `.env.example` documents the vars. 177 unit + 20
  integration green. **Next: Slice C** — the `services/renderer/` Playwright service (per-host load-more + tabs) and
  the Vercel `@sparticuz/chromium` prototype deploy.
- **2026-07-26** — **WP-17b Slice A: fetch-mode dispatch + render escalation (test-first).** Added `Source.fetchMode`
  (PLAIN|RENDER, additive migration). `pollSource` picks the render port for RENDER sources (falls back to plain when
  no renderer is configured), and **escalates** a PAGE_WATCH source to RENDER when a plain poll returns ≤5 chapters and
  a renderer is available (persisted via an `escalateToRender` effect) — the "the JS TOC didn't render" signal. Threaded
  an optional `renderImpl` through `pollAllSources`/`pollPorts`. Safe/no-op in prod until the renderer is wired (no
  render impl → no escalation, RENDER falls back to plain). 172 unit + 20 integration green. Next: the `renderFetch`
  adapter (Slice B) + the `services/renderer/` Playwright service & Vercel `@sparticuz/chromium` prototype (Slice C).
- **2026-07-26** — **WP-09 DONE: Web Push verified live on a device.** Added a "Send a test" button + `/api/push/test`
  (fires a canned push through the real send path). Live-testing surfaced a config gotcha — a bare-email
  `VAPID_SUBJECT` makes `setVapidDetails` throw; hardened the test route to return the real error as JSON (not a bare
  500) and isolated the cron's push step so a VAPID/push misconfig can't fail the poll (the diff has already
  persisted). With `VAPID_SUBJECT=mailto:…` set in Vercel, "Send a test" delivered to the device. Full WP-09 surface —
  send-path, per-type prefs, service worker, subscribe + on-load re-sync, privacy copy — confirmed.
- **2026-07-26** — **WP-09 notification privacy: work title kept off the lock screen (test-first).** Restructured the
  push copy so the series name lives in the `body`, never the always-visible `title` — new: "New chapter(s)" /
  "{Series} — N new"; scheduled: "New chapter likely" | "Likely now free" / "{Series}"; source-down title was already
  work-agnostic. A regression test asserts the work title never appears in `title`. Cooperates with the OS "previews
  when unlocked" setting (can't be forced on iOS). 167 unit + 18 integration green.
- **2026-07-26** — **WP-09 Slice B browser: service worker + Settings page built.** `sw.js` gained `push` (renders the
  JSON `PushMessage`, tag-collapsed) + `notificationclick` (focus/open the deep link) handlers. `pushClient.ts`
  (browser): support check, permission+subscribe with the VAPID public key, unsubscribe, and **`resyncSubscription`**
  wired into `ServiceWorkerRegister` so each production load re-POSTs an existing subscription — self-healing a
  server-side prune. New **/settings** page (matches the "night reading" system: amber lamp-switch toggles): enable/
  disable push + the three per-type toggles (optimistic PUT), reached via a gear in the header. VAPID keys generated
  (owner set locally; **prod keys go in Vercel**). **166 unit + 18 integration green, typecheck + build clean.**
  Captured a **notification-privacy** follow-up (keep the work title off the lock screen — see backlog). Remaining:
  **live device verification** (push is production/installed-PWA only) + prod VAPID env.
- **2026-07-26** — **WP-09 Slice B backend: per-type push preferences (test-first).** `buildPushMessages` gained a
  per-type `push` filter — a disabled type stays an in-app surface only (source health / unread counts already show
  it), pure + tested. New `NotificationPrefs` model (keyed by `userId` like the rest — multi-user folds it under a
  `User` later, no reshape), **defaults: new-chapter ON, scheduled ON, source-down OFF** (owner's choice); additive
  migration. `parseNotificationPrefsPatch` validator (TDD), `get/updateNotificationPrefs` services, and
  `GET/PUT /api/notification-prefs`. `notifyForEffects` now loads prefs and gates each category. Also made the
  integration truncation **dynamic** (all tables) so new models can't silently leak state — caught exactly that here.
  **166 unit + 18 integration green.** Remaining: the browser half (sw handler + Settings UI + VAPID keys).
- **2026-07-25** — **WP-09 Slice A: Web Push server send-path landed (test-first).** Pure `lib/notify.ts`
  `buildPushMessages` turns normalized signals into messages — per-series new-chapter **digest** ("N new chapters"),
  kind-specific **scheduled-release** copy (WP-29), and **source-down** alerts (only on `crossedDown` = crossing into
  LIKELY_DOWN, never DEGRADED), in a fixed category order (7 tests). `server/services/pushSend.ts` `sendPushMessages`
  fans messages out to every subscription via an injected transport and **prunes EXPIRED channels** (push service
  404/410 — a *device* channel gone, unrelated to source health) (4 tests). Prisma + `web-push` binding
  (`notifyForEffects`, VAPID from env, skipped if unconfigured) wired into the cron; integration tests (real DB, +3)
  cover digest/scheduled copy, host-resolved down alerts, and expired-channel pruning. **160 unit + 15 integration
  green.** **Slice B remains:** `sw.js` push + notificationclick handlers, and a client subscribe flow that
  **re-syncs the subscription on every app load** (self-heals server-side pruning; no manual "reinstate"). Source-down
  *recovery* is separate: transient downtime self-heals on the next successful poll, permanent moves are WP-19. Env:
  `VAPID_*` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (owner adds to Vercel).
- **2026-07-25** — **WP-29 (partial): release-schedule lib + schema + cron wiring landed (test-first).** `lib/schedule.ts`
  `nextDueRelease(state, now)` — pure, INTERVAL (cadence+anchor) and WEEKLY (weekday-sets, e.g. MWF), day-after
  buffer, de-dupe (11 tests). Additive Prisma migration adds the schedule columns + `ReleaseScheduleKind`/
  `ReleaseEventKind` enums to `Series` (all nullable/defaulted — safe for existing rows). `evaluateSchedules()` service
  (unit-tested with fakes, 3 tests) loads scheduled series, emits a due-release effect per series, and stamps
  `scheduleLastNotifiedAt` in one transaction; wired into the cron alongside `pollAllSources`. Integration tests (real
  DB, +2) prove fire→stamp→no-refire. **149 unit + 12 integration green.** Per owner: **editor UI deferred**, and
  **push delivery is WP-09** (the cron computes + stamps but doesn't yet send). *Deploy note: the next push runs this
  migration on Neon via `vercel-build`.*
- **2026-07-23** — **WP-17b render spike: feasibility CONFIRMED (local Playwright, scratchpad).** A headless render
  reaches chapter lists plain fetch can't (one site 0→36, another 2→…), in ~6–19 s (inside a Vercel 60 s budget).
  Key finding: **a bare render under-reads — the full TOC needs per-host post-render interactions.** Two patterns:
  a Next.js site splits **Free/Premium into tabs** (read both; tab labels embed counts → near-free WP-20 frontier
  signal), and a CF-*served* JS site gates its list behind a **"load more" button** (one click jumped 11→140; must
  loop-click until gone). Spec updated with a per-host interaction vocabulary (`waitForSelector`/`clickWhileVisible`/
  `readTabs`). Premise holds → WP-17b proceeds.
- **2026-07-23** — **WP-17b design accepted; split out WP-29 (manual release schedule).** A live probe of the paid
  sources showed the "hard" bucket is two problems: **CF-challenged** (403 `cf-mitigated`; the site's feed still
  serves) and **JS-rendered non-CF** (200 but the chapter list is client-rendered — plain fetch under-reads). Design
  ([spec](docs/superpowers/specs/2026-07-23-wp17b-hard-sources-design.md)): **WP-17b** = a *self-run* headless
  renderer behind a fixed `render(url)` interface (per-source `fetchMode` PLAIN→RENDER, auto-escalate at ≤5 parsed
  chapters), hosting prototyped on **Vercel** (`@sparticuz/chromium` — correcting the old "not Vercel serverless"
  note) with AWS Lambda / Cloud Run fallback; **no third-party unblocker** (privacy). **WP-29** = a no-fetch,
  editable per-series **release schedule** (`lib/schedule.ts`, INTERVAL every-N-days + WEEKLY weekday-sets like MWF,
  notify the day after, tagged NEW_CHAPTER vs UNLOCKED) — the private "now free" signal for fully-blocked sites; it's
  fetch-independent so it can land first.
- **2026-07-23** — **Folded reading-status lifecycle + theming into the plan (WP-27, WP-28).** Discussed poll/store
  behavior by *reading* shelf status. Established the free-tier worry is a non-problem for chapter storage (~20–30 MB
  for a heavy library vs Neon free's 0.5 GB; compute hours are the real limit — see backlog). New **WP-27**:
  status-gated polling (skip COMPLETED/DROPPED for compute+politeness), PLANNED seeds a *summary* not the full TOC
  (backfill on →READING), and per-status notify rules — notably **PLANNED+paid fires only when 0 locked remain** (the
  bingeable-now trigger). Decided *against* pruning COMPLETED chapters (negligible space, loses reading position).
  New **WP-28**: frontend styling & theming (ordering, feed-vs-library split, pluggable themes — ancient-scroll,
  holographic-panel). `NEXT` unchanged (**WP-20**).
- **2026-07-23** — **WP-17 DONE: page-watch wired end-to-end into add + poll.** `pollSource` now branches on
  `Source.type`: `PAGE_WATCH` sources fetch the page and run `parseToc` (already series-scoped) instead of
  `parseFeed` + series-matcher; `FeedItem` carries an optional `access` (`FREE`/`LOCKED`) that flows through the diff
  and is persisted on `Chapter.access`. `addSeries` now **seeds page-watch chapters from the TOC at add-time** (was
  `chapters: []`) so the first poll diffs against a known set instead of re-reporting the whole backlog. Conditional
  GET (etag/304) applies unchanged, keeping page-watch polite. **New tests:** `pollSource` PAGE_WATCH branch, an
  `addSeries` TOC-seeding case, and two real-DB integration tests (add seeds FREE/LOCKED; poll persists only the new
  chapter with its access, no re-poll storm). **135 unit + 10 integration green, typecheck + build clean.** `NEXT` →
  **WP-20** (locked→free frontier). Lock detection remains the unverified baseline from the parser work — it gets
  tuned against a real locked TOC once WP-17b makes one reachable.
- **2026-07-23** — **WP-17 in progress: `parseToc` (page-watch parser) built + validated on real sites.** After a
  TOC spike across the owner's real sites, built `lib/feeds/pageWatch.ts` `parseToc(html, baseUrl, config?)` with
  **cheerio** (chosen over node-html-parser for malformed-HTML robustness + full CSS selectors). A generic scan
  extracts chapters (url/title/number/access) across the common frameworks — **validated live** against real TOCs on
  the dominant WordPress light-novel theme (Madara/`.eplister`), a WordPress list-posts plugin, a Blogger TOC widget,
  and a custom SSR site: all parse, numbers correct. Per-host `SiteTocConfig` overrides
  (`chapterSelector`/`lockSelector`/`lockText`) for oddballs. Fixed `parseChapterNumber` to accept `…-chapter-7`
  hyphen URLs; filter unrendered `{{…}}` template stubs. **6 page-watch tests (133 total).** **Findings:** extraction
  is solid; the reachable sites returned 0 locked — **correct** per owner (those novels have no locked chapters; the
  "premium" markers were theme boilerplate). Lock detection is a reasonable baseline but **unverified against a real
  locked TOC** — every paid/advance site is JS-rendered or Cloudflare-challenged (WP-17b), so we'll tune lock configs
  when WP-17b makes one reachable. **Remaining WP-17:** wire the PAGE_WATCH branch into `pollSource` (fetch TOC →
  parseToc → diff, persist access). **WP-17b:** headless/API for JS-rendered + Cloudflare-challenged TOCs.
- **2026-07-22** — **Fixed add-time Cloudflare failure + wrong-novel capture (bug found while testing a Cloudflare-challenged site).**
  Root cause (systematic-debugging): `addSeries` threw on the page-403 *before* trying feed guesses, even though the
  site's `/feed/` serves fine (Cloudflare only challenges HTML pages). Fixed to try feed guesses even when the page is
  blocked. Verifying that against the real site exposed a worse bug: the site `/feed/` is multi-novel and the target
  wasn't in the window, so the matcher fell to `WHOLE_FEED` and captured the **wrong novel** + the site's title. Fixed:
  `chooseSeriesMatch` now returns positive matches only (`null` when it can't isolate); `addSeries` falls back to a
  **series-scoped guess** (`fallbackSeriesMatch`, slug- or path-keyed) for guessed site feeds, trusting `WHOLE_FEED`
  only for page-advertised feeds; `filterBySeriesMatch` CATEGORY now matches by slug too, so the fallback fills in when
  the novel next publishes; title comes from the URL, not the site feed. Verified live: a Cloudflare-challenged source now adds the
  *correct* novel, empty, with a slug filter. 127 tests. (Page-watch escalation for still-blocked sites → WP-46/WP-17.)
- **2026-07-22** — **WP-10 (library + detail UI) done.** The app is now *usable*. **Library** = a release stream of
  series cards on the design system — the bookmark-ribbon + "N new" badge on unread series (the signature landing on
  real data), health dots (healthy/degraded/down), unread counts, latest chapter, status chips; empty-state when the
  shelf is bare. **Add-series form** (`/add`, was 404) posts to the API. **Series detail** (`/series/[id]`): chapter
  list with a read boundary, mark-progress ("mark read"/"current"), and status/rating controls (PATCH). Pages are
  server components calling the services directly (`dynamic`), mutations go through the gated API. Added pure
  `relativeTime` (7 tests, 121 total). **Verified with a seeded local DB**: library + detail screenshots (desktop +
  mobile) look on-brand, and the live PATCH round-trip persists (rating/status). Deploy will pick it up on next push.
- **2026-07-21** — **WP-11 (deploy) done.** Live at **https://webnovel-companion.vercel.app** — Vercel + Neon prod
  (Postgres 18), `vercel-build` applied the migration, daily cron (`vercel.json`). Verified in prod: `/`→307→/login,
  `/login`→200, `/api/series`→401 (gated, DB path wired — not 500), `/api/cron/poll`→401 (secret set), HTTPS/HTTP2;
  owner confirmed passphrase login + PWA install. **Note:** app is deployed & secure but not yet *usable* — no
  add/library UI (WP-10) and no push (WP-09); the "Add a series" link 404s until WP-10.
- **2026-07-21** — **Neon prod DB connected (WP-11 DB-host step).** Ran Neon's agent-guided `neon init` against the
  existing **webnovel-companion** project (org `Jayden`, AWS us-east-1, **Postgres 18** — matches the CI matrix). The
  offline `20260716180156_init` migration now **`migrate deploy`-ed to Neon prod**; all 5 tables (`Series`, `Source`,
  `Chapter`, `ReadingProgress`, `PushSubscription`) verified live via a direct `SELECT 1` + table listing. `neon env
  pull` wired the connection strings into `.env`; **`DATABASE_URL` defaulted to the DIRECT/unpooled endpoint**
  (single-user app + correct for Prisma migrations), pooled endpoint retained as `DATABASE_URL_POOLED`. The Neon
  wizard also added `@neondatabase/serverless` + `@prisma/adapter-neon@7` and ran `npm audit fix --force`; **both
  driver deps were removed as unused** (we use plain Prisma over the direct connection — no serverless adapter needed
  at single-user scale, and adapter@7 mismatched our Prisma 6). The `--force` only patch-bumped `next` (16.2.11, the
  real fix); the remaining **2 moderate advisories are a non-exploitable transitive Next→postcss *build-time* issue**
  (we never process untrusted CSS) — left as-is, and **`audit fix --force` avoided going forward** (it would move Next
  to a canary). Neon/agent tooling (`.neon`, `.agents/`, `skills-lock.json`) gitignored.
- **2026-07-21** — **WP-AUTH (single-user gate) done.** scrypt-hashed passphrase in env (colon-separated so it
  survives dotenv-expand — caught in live testing), HMAC-signed `HttpOnly`/`Secure`/`SameSite` session cookie (Web
  Crypto, edge+node), Next edge **middleware** gating all pages/APIs (fail-closed in prod, open in unconfigured dev;
  allowlist for login/auth/cron/PWA). Login screen + logout on the design system; app chrome moved into an `(app)`
  route group so `/login` is header-less. `npm run auth:hash` generates the hash. **24 new unit tests** (114 total)
  for passphrase/session/access; the whole gate flow **driven end-to-end against the running app** (401/redirect,
  wrong/right passphrase, cookie, logout). ADR 0002 records the model. Prereq for public deploy now met.
- **2026-07-21** — **Deploy/security decisions.** Hosting = **Vercel + managed Postgres** (Neon/Supabase; ~$0/mo on
  free tiers, optional ~$12/yr custom domain). Security: the API is currently unauthenticated (bare `userId`), so a
  **single-user password gate is a hard prerequisite for public deploy** → new **WP-AUTH**: a generated high-entropy
  passphrase stored as a **scrypt hash** in env (never the raw secret) + a signed `HttpOnly`/`Secure` session cookie +
  Next middleware gating all pages/APIs (cron keeps its own `CRON_SECRET`). Passkeys/WebAuthn deferred as **WP-PASSKEY**
  (M4). Added **WP-EXPORT** (data export) as own-your-data insurance. `getCurrentUserId()` stays `'local'` — the gate
  guards access to the single account, not multi-user.
- **2026-07-21** — **WP-11 in progress: integration tests + deploy config done; live deploy pending owner.** Stood up a
  local Postgres (`brew postgresql@17`, `webnovel_test`); the offline initial migration **applies cleanly to real
  Postgres**. Refactored `server/services` for an injectable `fetch` so integration tests use the **real DB + a fake
  network**. Added the Vitest `integration` project harness (safety-guarded truncation) and **8 integration tests**
  exercising all the previously typecheck-only Prisma glue (addSeries→create, poll→persist new chapters + health,
  304, DNS-degrade, listSeries/updateSeries/progress, push upsert). `npm test` is now unit-only; `npm run
  test:integration` is separate. **CI** gained an `integration` job (Postgres service). Deploy config: `vercel.json`
  (daily cron `/api/cron/poll`), `vercel-build` (`prisma migrate deploy && next build`), README deploy runbook.
  **Remaining (owner, interactive):** provision hosted Postgres, `vercel` deploy + env vars, verify PWA install.
- **2026-07-21** — **WP-08 (API routes) done.** Thin App Router handlers wiring the tested services to HTTP:
  `GET/POST /api/series` (list + add via `addSeries`), `GET/PATCH /api/series/[id]` (detail + shelf/progress update),
  `POST /api/push/subscribe`, `GET /api/cron/poll` (Bearer-secret auth → `pollAllSources`). Extracted the testable
  parts as pure fns: request validators (`parseAddSeriesBody`/`parseSeriesUpdate`/`parsePushSubscription`/
  `isAuthorizedCron`) and `unreadCount` — **23 new tests (90 total)**. Prisma-backed reads/writes (`series.ts`,
  `push.ts`) are thin, typecheck + `next build`-verified (build works with and without a DB — Prisma connects lazily),
  integration-tested at WP-11. Documented `CRON_SECRET` + `WEBNOVEL_USER_ID` in `.env.example`. **Deferred:** actual
  push send on new-chapter/down effects (WP-09); the Vercel cron *schedule* config (WP-11).
- **2026-07-20** — **WP-06 (Next.js + Tailwind + PWA shell) done.** Next 16 (App Router) + React 19 + Tailwind 4
  integrated into the repo; tsconfig reconciled to serve both the strict Node lib and the DOM/JSX app; CI now also
  runs `next build`. **Design system** (via frontend-design skill): a "night reading" identity — warm ink, dimmed
  paper, a single amber lamp-glow accent; Fraunces (display) + IBM Plex Sans/Mono (Plex chosen for its CJK siblings);
  bookmark-ribbon signature. Tokens + components in `globals.css`; root layout with fonts/metadata/header; empty-state
  home; PWA manifest + offline-shell service worker + registration. Verified visually (desktop + mobile screenshots).
  **Deferred:** Web Push handler (WP-09); rasterized/maskable PNG icons for iOS install (WP-11) — SVG icon for now.
- **2026-07-20** — **WP-07 (services) done.** Orchestration composed behind injected ports (unit-tested with fakes,
  no DB/network): `filterBySeriesMatch` (pure runtime counterpart to `chooseSeriesMatch`); `pollSource`/`pollAllSources`
  (fetch→health→parse→filter→diff, emits `PollEffects` incl. `crossedDown` for the down-alert); `addSeries`
  (page → feed discovery/guess → match → resolve, page-watch fallback, add-time failure surfaced). Thin Prisma+HTTP
  adapter (`server/services/index.ts`) exposes runnable `pollAllSources()`/`addSeries()` (typechecked; integration-
  tested at WP-11). Single-user id via one accessor (`server/user.ts`) per the Tier-4 discipline. 14 new tests
  (67 total), typecheck clean, CI green. The full MVP pipeline is now wired end-to-end.
- **2026-07-20** — **WP-FE (feed/page fetcher) done.** `lib/feeds/fetch.ts` `politeFetch(url, {etag, lastModified},
  fetchImpl)` — injected fetch (unit-testable, no socket). Realistic browser headers, conditional GET (304 →
  not-modified), timeout via AbortController, and every outcome classified into a health `PollOutcome`
  (SUCCESS/HTTP_4XX/HTTP_5XX/DNS/TLS/TIMEOUT/PARKED incl. a 200-parking-page heuristic) so it feeds `health.step`
  directly. 9 tests (53 total), CI green. Completes the feed pipeline's I/O seam; WP-07 wires it into orchestration.
- **2026-07-20** — **WP-05 (feed parse + discovery + match) done.** Pure, test-first, grounded in the spike fixtures:
  `parse.ts` (rss-parser wrapper → `FeedItem`, decoding entity-encoded URLs, RSS `<guid>` + Atom `<id>`, categories;
  plus best-effort `parseChapterNumber`), `discover.ts` (`discoverFeeds` from `<link alternate>`, `guessFeedUrls`
  WordPress fallbacks, and `chooseSeriesMatch` → WHOLE_FEED / CATEGORY / PATH_PREFIX). Test fixtures use anonymized
  `.example` domains + generic works (structure mirrors the custom-app / WordPress / multi-novel archetypes without
  depending on real URLs/titles). Added `categories` to `FeedItem`. **44 tests**, typecheck clean.
  Split the impure HTTP concerns (headers, conditional GET, Cloudflare) into **WP-FE** (fetcher), keeping the lib pure.
  **Completion rule captured** (CONTEXT.md + WP-21 note): compare *max parsed chapter number*, never post count —
  split chapters inflate row count but not the number.
- **2026-07-16** — **WP-04 (database) done.** DB-skills pause resolved: plain Postgres (PlanetScale declined), host
  deferred to WP-11, `domain-modeling` skill used. Wrote `prisma/schema.prisma` (Series/Source/Chapter/
  ReadingProgress/PushSubscription; reconciles README + spike: `matchType`/`matchValue`, `failureScore`, Chapter
  `access` + `sourceId` provenance; VocabCard + User table deferred). Added **CONTEXT.md** (domain glossary, via the
  domain-modeling skill) and **ADR 0001** (Source as a swappable fetch-target, separate from Series). Prisma installed
  + client generated (`postinstall` regenerates in CI); `src/server/db.ts` singleton. Initial migration generated
  **offline** via `migrate diff` (real FKs — plain-Postgres win) — deployable, applied at WP-11 (no DB host yet).
  Typecheck clean, 26 tests green, schema valid.
- **2026-07-16** — **WP-03 (health) done.** Pure source-health state machine test-first: HEALTHY→DEGRADED→LIKELY_DOWN
  with a weighted-score hysteresis accumulator (strong DNS/PARKED/TLS=3 >> HTTP_4XX=2 > soft HTTP_5XX/TIMEOUT=1),
  thresholds DEGRADED_AT=2 / LIKELY_DOWN_AT=4 exported as tunable constants, immediate recovery on success. 9 tests
  (26 total), CI green. Both early pure engines (diff, health) now complete; M0's tested-core phase done.
- **2026-07-16** — **WP-02 (sm2) deprioritized to M3.** Owner doesn't lean on the vocab layer, so SM-2 moved from
  the M0 do-first pure functions down to the vocabulary tier (next to WP-24, which consumes it); dropped its ⭐.
  Removed the in-progress sm2 test. `NEXT` is now **WP-03 (health)**, the last early pure engine.
- **2026-07-16** — **Folded spike into the plan.** Added the "Source-fetching strategy" section (fetch-strategy
  ladder + density-fallback triggers) and per-WP sub-tasks for WP-05/17/20; added **WP-46** (dense-feed
  miss-detection + TOC reconcile fallback). Design answer to "when does a too-dense multi-novel feed fall back to a
  direct page scan": page-watch is rung 3, triggered at add-time, on runtime gap/saturation, and periodically.
- **2026-07-16** — **Feed spike + Source-model change.** Ran throwaway spikes against 5 real translator sites (see
  "Spike findings"). Applied the resulting README data-model change: `SourceMatch` enum + `matchType`/`matchValue`
  on `Source` (isolate one series from a multi-novel feed), plus a Source-resolution note on multi-novel feeds and
  Cloudflare. Spike scripts + FINDINGS.md archived to a non-git local dir (`../webnovel-tracker-spikes/`), not the repo.
- **2026-07-16** — **diff.ts hardened (WP-01 follow-up).** From a design discussion: (1) match guid AND canonical
  url independently to guard guid/url mixing (feed↔page-watch, feeds toggling guids); (2) URL canonicalization now
  strips tracking params (utm_*/fbclid/…) and sorts query params while keeping meaningful ones distinct; (3) added
  empty-fetch, unparseable-url, output-order, and split-chapter (decimal + parenthetical) tests — **17 diff tests**
  total; (4) documented `FeedItem`/`DiffResult` extension points (access state, `becameFree`, `disappeared`) so the
  paid→free and removal dimensions extend the types later without reshaping. Green locally + CI.
- **2026-07-16** — **WP-CI done.** GitHub Actions workflow (`.github/workflows/ci.yml`): `npm ci` → typecheck → test
  on push-to-main and all PRs, Node 22 + npm cache, in-progress-cancel concurrency. Verified green on the runner
  (run `29530608868`, all steps success).
- **2026-07-16** — **WP-GH done.** Set global git identity (GitHub noreply), initial commit `1244258` (green suite,
  no secrets), created and pushed the **private** repo `jolsen314/webnovel-companion`. Caught and removed a stray
  `tests/unit/srs/sm2.test.ts` (leftover from the interrupted WP-02 attempt — imported a not-yet-written module and
  reddened the suite) so the first commit was green. Split CI into WP-CI.
- **2026-07-16** — **WP-GH started; WP-04 marked pause-first.** `git init -b main`, `.gitignore` hardened
  (`.claude/settings.local.json`), installed `gh` 2.96.0. Decisions: private repo, GitHub-noreply commit email,
  global git identity. Blocked on interactive `gh auth login` (owner). Flagged WP-04 (database) with ⏸ — must pause to
  select DB skills before writing schema (recorded in CLAUDE.md playbook too).
- **2026-07-16** — **WP-00 + WP-01 done.** Bootstrapped the test harness (strict tsconfig, Vitest unit/integration
  projects, `@types/node`); built `lib/feeds/diff.ts` test-first — 8 property tests green (dedup, guid edit-tolerance,
  URL canonicalization, intra-batch dedup, reorder/idempotence, number-not-identity), typecheck clean. Added
  **CLAUDE.md** as the operating manual: working agreements (skill-first, TDD, verify-before-done, stop at WP
  boundaries) + a curated skill/plugin playbook (task → skill, with duplicate skills resolved to primaries and the
  irrelevant infra/startup skill clusters flagged as out-of-scope).
- **2026-07-16** — **WP-12 done.** Folded the spec's unique content into the README — validated release sources
  (NovelUpdates per-series RSS as primary, Royal Road/ScribbleHub, the no-list-RSS aggregation gap) into Architecture,
  and a new "Prior art & differentiation" section (Yomitan + Anki). Portfolio framing dropped as interview-only.
  Deleted `webnovel-companion-spec.md`. Moved WP-12 to the top of the index as complete. `NEXT` unchanged: WP-00 → the
  three pure functions.
- **2026-07-16** — Plan created. Milestones M0–M4 mapped to README tiers; WPs 00–26 laid out. Immediate `NEXT` set:
  WP-00 bootstrap, then the three pure functions (WP-01 diff, WP-02 sm2, WP-03 health), each test-first. Flagged the
  spec for content-migration-then-delete (WP-12) rather than immediate deletion — it still holds unique
  validated-data-sources research.
