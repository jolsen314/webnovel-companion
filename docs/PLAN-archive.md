# PLAN archive — shipped work-package detail

Detail sections for **DONE** work packages — plus **hard-blocked / abandoned (parked)** ones that will not be picked
up — moved out of [PLAN.md](../PLAN.md) to keep the active tracker lean.
Nothing here is active work — it's the shipped-brief record (git history has the full trail). Each item's one-line
index lives in PLAN.md's ✅ Completed table.

---

### WP-57 — `parseToc` cross-series-card exclusion + series-slug scoping (DONE 2026-08-31)

**DONE (2026-08-31).** `parseToc` ([`pageWatch.ts`](../src/lib/feeds/pageWatch.ts)) no longer scrapes
recommendation / "other novels" widgets ("you may also like" / "popular" / site-latest) as chapters, and scopes
ingest to the novel's own chapter links. Data-correctness fix (wrong series' chapters ingested). Extends WP-36's
region scoping with an anchor-level, cross-series exclusion.

**Root cause:** those widget cards are `/novel/<other-slug>` links whose "… Chapters: N" text trips `CHAPTER_TEXT`.
They sit *inline in content* (not in a sidebar), so WP-36's `CHROME_SELECTOR` scoping missed them. On a JS/SPA
source whose render captured only the page shell (real chapter list never hydrated), those cards were the *only*
chapter-like links, so the widget was ingested as the whole series (and its `<h1>` scraped as the title).

**What shipped:**
- **`seriesSlugScope(baseUrl)`** — derives the series' own slug scope from the source URL when it has a recognized
  `/<collection>/<slug>/…` shape. `collection` must be in a keyword set (`novel`/`novels`/`series`/`book`/`manga`/
  `manhwa`/`manhua`/`comic`/`story`/`webnovel`/`title`/`read`/…). This keyword gate is the discriminator that keeps
  scoping **off** for identity-less bases (a bare `/toc/`) and for date-path structures (Blogger `/YYYY/MM/slug`),
  where the first segment is not a real collection dir — so those hosts keep today's behavior.
- **Filter** (generic path only — skipped when an explicit `slugFamilies` config is present): drop a chapter link
  only when it's a **bare sibling landing** — exactly one path segment after the collection prefix, and a *different*
  slug (`/<collection>/<other-slug>`). Links under a different structure (relative/flat) are kept, and so are deeper
  same-collection links (two+ segments) — critically, **global-chapter-id hosts route own chapters at
  `/<collection>/chapter/<id>`**, which must survive. (An earlier draft dropped *any* different-slug segment, which a
  read-only prod pass caught wrongly flagging such a host's real chapters — hence the bare-landing narrowing.)
- **No empty-fallback** (unlike CHROME scoping): if the filter removes everything — the SPA-shell case — returning
  **0** chapters is the correct outcome (better than ingesting the wrong series), and the empty result flows through
  the existing under-read / needsConfirm handling in `addSeries`.

**Drivers:** B07 (×2), B08; the 2026-08-22 XHR-SPA source (was 16 recommendation cards as "chapters" → now 0).

**Tests (test-first):** 3 exclusion cases (inline widget dropped, SPA-shell → `[]`, leaked cross-series *chapter*
link dropped) + 1 guard (scoping stays off for an identity-less `/toc/` base). Pure `pageWatch.ts` change; the
`<h1>`-as-title symptom is a separate title-extraction concern (WP-30 family), not touched here.

### WP-28i — Private theme-asset proxy (licensed images in prod)

**DONE (2026-08-29).** WP-28h's licensed `scroll` images (`wax-seal.png`, `scroll-tree.png`) now render in production
without being hosted publicly. Their licenses don't permit public redistribution, so they live in a **private** Vercel
Blob store and are streamed only to authenticated callers through a new app route.

**What shipped:**
- **Auth-gated proxy route** `src/app/api/theme-asset/[name]/route.ts` (Node runtime, `force-dynamic`). Reads the
  private blob server-side with `get(path, { access: 'private' })` (`@vercel/blob@2.8.0`, `BLOB_READ_WRITE_TOKEN` from
  env) and **streams the bytes through** — chosen over a signed-URL redirect, whose short-lived URL is briefly a
  public bearer link to a license-restricted image, defeating the point. It runs behind the existing gate: the
  `src/middleware.ts` matcher covers `/api/*` and the path is **not** in the `isPublicPath` allowlist, so an
  unauthenticated request is denied (401) before the handler runs (verified: route sits under the gate; smoke-tested
  that middleware executes on it).
- **Exact-match filename allowlist** — a pure, test-first `themeAssetBlobPath(name)` in `src/lib/themeAssets.ts` maps
  only the two known names → `themes/<name>`; everything else (unknown name, `themes/…` prefix, case variants,
  traversal-ish) → null → 404. Prevents the route from becoming an open reader over the whole private store.
- **Graceful degradation** — any failure (missing token, store gone, network) is caught → 404, never a 500, so the
  existing `<img onError>` fallback in `WaxBadge.tsx`/`ThemeScene.tsx` holds (no tree, red-circle badge). No change
  needed to those consumers or to `resolveAssetUrl`.
- **Caching** — `Cache-Control: private, max-age=86400` + ETag/`If-None-Match`→304 pass-through (browser cache OK;
  `private` keeps it off shared/CDN caches so the gate can't be bypassed; ETag keeps private-blob egress down).
- **Provisioning** — `scripts/upload-theme-assets.mjs` flipped `access:'public'` → `access:'private'`; prod sets
  `NEXT_PUBLIC_THEME_ASSET_BASE=/api/theme-asset` (was the Blob URL base) so `resolveAssetUrl` builds
  `/api/theme-asset/wax-seal.png`. Local dev unchanged (`/themes`). `docs/theme-assets.md` updated.

**Verification:** 526 unit tests pass (incl. the new allowlist tests) + typecheck clean; runtime smoke under Next
16.3.2 confirmed the route mounts and that unknown/tokenless names both degrade to a graceful 404 (no 500s). The
authed-success streaming path and the unauth→401 are prod/owner-provisioned (private store + `BLOB_READ_WRITE_TOKEN`
+ `AUTH_SECRET`), same pattern as WP-28h's owner-run asset upload. New: `src/app/api/theme-asset/[name]/route.ts`;
touched `src/lib/themeAssets.ts`, `tests/unit/themeAssets.test.ts`, `scripts/upload-theme-assets.mjs`,
`docs/theme-assets.md`.

### WP-PW — Playwright E2E harness + backfill UI coverage

**DONE (2026-08-15).** Stood up the Playwright E2E harness the README had long deferred: `playwright.config.ts`
serves the app via **`next dev` gate-off** (no `AUTH_SECRET` → middleware open in dev; `next start` can't be
used — it forces production and fail-closes the gate) against a dedicated **`webnovel_e2e`** Postgres DB, with
`e2e/support/db.ts` (guarded `resetDb` + `seedSeries`) and a per-test reset fixture. All four shipped UI-only
flow-groups are covered (`e2e/*.spec.ts`), plus a new CI **`e2e` job** (Postgres service + Playwright + migrate
+ run). WP-34's network-triggering buttons are covered with `page.route()` stubs (deterministic + offline; the
server-side add/reconcile stays owned by the integration tests). The harness is structured so a future
**auth-aware** switch is config-localized (add `AUTH_SECRET`/`AUTH_PASSWORD_HASH` to `webServer.env` + a
`globalSetup` login → `storageState`; test bodies unchanged). Also untracked the generated `next-env.d.ts`
(dev/build flips its route-types path, so running E2E kept dirtying the tree). **Standing close-out rule:**
every UI-only WP appends its flow(s) to the checklist below at completion, so deferred coverage stays tracked.

**UI-coverage checklist:**
- [x] WP-10 — library grid renders; chapters render as clickable links; Status / Rating / mark-read persist.
- [x] WP-34 — "Track unlocks (switch to TOC)" + "Backfill from TOC" buttons fire + surface their result (stubbed).
- [x] WP-30 — inline title edit (`EditableTitle`): pencil → edit → save → title updates + persists.
- [x] WP-51 — delete: detail inline confirm → redirected to shelf, series gone; shelf trash → confirm →
      card disappears, tapping trash does NOT open the card; Cancel guards on both surfaces.
- [x] WP-50 — link-only add: no-chapters → confirm panel → Add anyway → link-only series on the shelf (stubbed).
- [x] WP-NOTES — notes: collapsed-when-empty, save on blur → persists, defaults open when present, collapsed preview truncates.
- [x] WP-28a — shelf sort reorders the grid + persists across reload; status / rating / search filters narrow the grid, update the count, and show the no-match message.

### WP-GH — Git + private GitHub repo, first push

**Goal:** get commits flowing to a personal GitHub repo early so history is captured and the review/security hooks apply.

**DONE (2026-07-16):** `git init -b main`; `.gitignore` covers `node_modules`, `.env`, `.claude/settings.local.json`.
`gh` 2.96.0 installed; owner authed as **jolsen314** (Jayden Olsen). Global git identity set to the GitHub **noreply**
email. Initial commit `1244258` (docs + harness + diff engine, suite green). Private repo created and pushed:
**https://github.com/jolsen314/webnovel-companion** (`main` tracks `origin/main`).

CI is split out as **WP-CI** (GitHub Actions running `npm test` + `npm run typecheck` on push/PR).

---

### WP-04 — Prisma schema + migration + db client

**Pause resolved 2026-07-16.** Decisions: **plain Postgres** (README stack kept; PlanetScale declined — its Postgres
flavor was fine but not needed). DB **host deferred to WP-11** (schema is host-agnostic: Neon/Vercel/Supabase all
take the same schema, differ only by `DATABASE_URL`). Skills: **`mattpocock-skills:domain-modeling`** for the
model + Prisma's own conventions; the ai-toolkit DB skills were rejected (Kotlin/Exposed + company-rule flavored,
poor Prisma/Postgres fit).

**Deliverables:** `prisma/schema.prisma` reconciling the README data model **with the spike findings** (Source
`matchType`/`matchValue`; health `score` accumulator; Chapter access state; possibly `lastReconciledAt` for WP-46);
an initial migration; `server/db.ts` Prisma client singleton.

**Migration note (no DB yet):** `prisma migrate dev` needs a live Postgres. Until the host exists (WP-11) we can
`prisma generate` the client and produce the initial migration SQL via `prisma migrate diff --from-empty
--to-schema-datamodel` (no connection needed), or spin up a local Docker Postgres. Decide when we get there.

---

### WP-00 — Repo bootstrap (test harness)

**Goal:** the smallest scaffold that lets `npm test` run Vitest against `src/lib/**`. Deliberately excludes Next.js,
Prisma, Tailwind, and any UI — those arrive in WP-04/06 so this stays a fast, clean base for the pure functions.

**Deliverables**
- `package.json` (scripts: `test`, `test:watch`, `typecheck`), `tsconfig.json` (**strict**), `vitest.config.ts`
  with two projects declared — `unit` (fast, default) and `integration` (serialized) — even though only `unit` has
  tests yet.
- Folder skeleton per the README [Repo structure](README.md#repo-structure): `src/lib/{feeds,srs}`, `tests/unit`,
  `tests/integration`.
- One trivial smoke test so `npm test` exits green.
- `.gitignore`, `.env.example` (placeholders for `DATABASE_URL`, VAPID keys — not consumed yet).

**Definition of Done:** `npm install && npm test` passes on a clean checkout; `npm run typecheck` is clean; no
framework deps pulled in beyond Vitest + TypeScript.

---

### WP-01 — `lib/feeds/diff.ts` (pure, test-first)

**Goal:** given the chapters already stored for a series and the items just fetched from its feed, return the
genuinely new chapters — correctly, with no framework or I/O.

**Signature (proposed, refine in the WP):**
`diffChapters(stored: KnownChapter[], fetched: FeedItem[]): { new: FeedItem[] }` — pure, order-independent.

**Test properties (write these first)**
- **Identity is a stable key**, not title or position — dedupe on `guid`/canonical `url`, so an item is "new" iff its
  key isn't in `stored`.
- **New items detected** on first run (empty `stored` → all new) and on subsequent updates (only the added ones).
- **No duplicates** — an item already stored is never re-reported.
- **Reorder-tolerant** — shuffling the fetched feed order changes nothing.
- **Edit-tolerant** — same key with a changed title/date is *not* new (it's an edit of a seen chapter).
- **Idempotent** — running the diff, "storing" the results, and running again yields zero new.
- **Number parsing is tolerant** — decimal/extra chapters (e.g. `12.5`), missing numbers, non-numeric titles.

**Definition of Done:** all properties covered by Vitest cases (properties, not brittle snapshots); pure (no imports
from `next`, `prisma`, `fs`, network); exported types are reused by later WPs.

---

### WP-03 — `lib/health.ts` (pure, test-first)

**Goal:** the per-source health state machine — `HEALTHY → DEGRADED → LIKELY_DOWN` with hysteresis, weighted by
failure type, recovering on success. (Per-source only; **host-level aggregation is WP-16**.)

**Signature (proposed):**
`step(state: HealthState, outcome: PollOutcome): HealthState` where `PollOutcome` is a success or a `FailureType`
(`DNS | TIMEOUT | HTTP_4XX | HTTP_5XX | PARKED | TLS`), and `HealthState` carries `health`, `consecutiveFailures`,
and an accumulated weighted score.

**Test properties (write these first)**
- **Blip tolerance / hysteresis** — a single transient failure (`TIMEOUT`/`HTTP_5XX`) does **not** flip to
  `LIKELY_DOWN`; escalation requires *sustained* weighted failure.
- **Failure weighting** — strong signals (`DNS`, `PARKED`, `TLS`) weigh far more than soft ones (`TIMEOUT`, `5xx`);
  a couple of strong failures escalate faster than many soft ones. (`4xx` is middling — could mean removal.)
- **Escalation ladder** — accumulated weighted score crosses a `DEGRADED` threshold, then a `LIKELY_DOWN` threshold.
- **Recover on success** — any successful poll resets to `HEALTHY` and clears the failure counters (recovery is
  immediate; escalation is not — that's the hysteresis).
- **Pure** — deterministic; thresholds/weights are named constants so they're tunable and asserted explicitly.

**Definition of Done:** properties above under Vitest; thresholds/weights exported as documented constants; state
shape matches the `Source` health fields in the README (`health`, `consecutiveFailures`, `lastFailureType`).

---

### WP-27a — Reading-status cadence gating (DONE 2026-07-31)

**DONE.** Pure `statusPollGate` + `STATUS_CADENCE_MINUTES` (a map: READING → every run, PLANNED → weekly rolling per-source window, PAUSED/COMPLETED/DROPPED → never) gate `pollAllSources`. **Status-gated polling:** `pollAllSources` skips COMPLETED and DROPPED (no new chapters wanted); motivation is **compute + politeness**, not storage. **Status→cadence, not just skip:** beyond skip/poll, PLANNED/backlog poll rarely (slow cadence, not daily). RENDER sources can't 304 (every poll is a full ~5–15s headless render — `renderFetch` sends no validators), so gating cadence by status saves render cost. READING polls every run; PLANNED polls at most weekly (rolling per-source window, WP-41 rotation guarantees deferred pickup); PAUSED/COMPLETED/DROPPED never polled. **Query filter + fetch gating:** `loadActiveSources` filters COMPLETED/DROPPED/PAUSED out; a group with no due source is not fetched (the win = skipping expensive RENDER/TOC fetches), but once a group *is* fetched every source it covers is processed (a not-due PLANNED sibling rides a shared fetch for free — keeps its backlog current; new-chapter/now-free pushes stay READING-only). *Caveat:* source-down alerts aren't status-filtered yet, so a shared-feed outage can surface co-hosted PLANNED siblings in lockstep — dedup is WP-16 (host-level health), non-READING suppression is WP-27b. **Per-source `seriesStatus` on `PollableSource`** + **`PollEffects.seriesStatus`** propagate status through the pipeline; `notifyForEffects` pushes only for READING (PLANNED polls quietly).

**Dropped:** the WP-27 summary-seeding idea (storage isn't the binding constraint — the limit is **compute/poll-budget**, not DB space). Refiled per-status positive notify rules as **WP-27b** (PLANNED paid → fire at 0 LOCKED; PLANNED free → fire at targetChapterCount; wire with WP-20/WP-21).

> Explicitly **not** doing: pruning stored chapters for COMPLETED. It saves negligible space (see backlog) and costs
> reading position (`lastReadChapterId` → a real `Chapter` row), the chapter list, and re-diff ability. YAGNI.

### WP-28a — Shelf sort + filter (DONE 2026-08-25)

**DONE — shipped expanded from "ordering" to full sort + filter** (owner expanded scope at pickup: the three pure sort
modes **plus sort-by-rating**, and **filtering** on reading status / title / rating). Pure core in
[`lib/shelf.ts`](src/lib/shelf.ts): **`sortSeries(rows, mode)`** with four modes — `recent` (latest-chapter time desc,
no-chapter rows last), `unread` (unread desc, activity tie-break), `title` (case-insensitive codepoint compare,
deliberately not `localeCompare` — matches the `reading.ts` determinism rule), `rating` (desc, unrated last) — title as
the final tie-break throughout; and **`filterSeries(rows, filter)`** on `status` (exact or `ALL`), `query`
(case-insensitive title substring), `minRating` (≥ N, unrated excluded when set). Both pure/order-independent/non-mutating,
**12 unit tests** (TDD caught a real `-Infinity − -Infinity = NaN` comparator bug in the no-chapter tie-break). The server
[`page.tsx`](<src/app/(app)/page.tsx>) now delegates the non-empty case to a client [`Shelf.tsx`](<src/app/(app)/Shelf.tsx>)
that owns the control bar (sort + status + rating `<select>`s + a **transient** search box) and the card render; the
count line switches to "showing N of M series" while filtering, with a no-match message distinct from the empty-shelf
hero. **Persistence** mirrors the chapter display-mode toggle: sort / status / min-rating in localStorage with the
SSR-safe default pattern (server renders `recent`/unfiltered, a mount effect applies stored prefs → no hydration
mismatch); the search box is intentionally not persisted. **Subsumes WP-15** (`lib/search.ts`). 2 Playwright specs
([`e2e/shelf.spec.ts`](e2e/shelf.spec.ts)); `seedSeries` gained optional `status`/`rating`. **Manual pin/drag ordering
deliberately deferred** (would need a persisted per-series order column + drag UI — re-file if wanted).

### WP-28b — Theme system (DONE 2026-08-28)

**Shipped:** a pluggable **`[data-theme]` token architecture** replacing the single baked-in "night reading" identity —
per-theme CSS custom-property sets keyed off `data-theme` on `<html>` (components keep referencing `var(--color-…)`
unchanged), plus a new shared `--color-on-glow` token (foreground for text sitting on the accent glow, tokenized per
theme rather than hard-coded). Pure `src/lib/theme.ts` (unit-tested) is the single source of truth for the theme
registry (`night` default, `scroll` ancient-scroll, `sci-fi` holo-panel — each with its own palette, `next/font/google`
family, and motif) and `buildThemeScript()`, which derives an **inline pre-paint script** injected in `layout.tsx`: it
reads `localStorage`, validates against the known theme IDs, and sets `data-theme` (+ the `theme-color` meta) **before
first paint**, so there's no FOUC and no hydration mismatch. The settings-page **`ThemePicker`** (client component)
swaps the attribute + persists to `localStorage` instantly, with a mount-sync fix for its own hydration edge case
(default vs. stored value). Covered by unit tests (`tests/unit/theme.test.ts`), Playwright theme-persistence e2e
(`e2e/theme.spec.ts`), and a themed-screenshot review spec (`e2e/theme-screens.spec.ts`, gitignored output). **Scope
held per the spec's non-goals:** no OS `prefers-color-scheme` auto-follow (explicit choice only), no header
quick-switch (settings-page only — filed as **WP-28g**), no cross-device sync (per-origin localStorage only — filed as
**WP-THEMESYNC**), no per-theme mono font (shared Plex Mono). A fourth theme, **bookshelf** (gothic/Victorian palette +
book-stack shelf layout), was spiked but scoped out to its own WP — filed as **WP-28f** with the spike findings.

### WP-28c — Feed digest home and shelf tab (DONE 2026-08-31)

**Shipped:** decided the "one view or two?" IA question as **two views behind a shared tab control** — a new
cross-series **feed digest at `/`** and the existing per-series card grid moved to **`/shelf`** — rather than merging
them into one river. Design spec + implementation plan:
[`docs/superpowers/specs/2026-08-29-wp28c-feed-vs-shelf-design.md`](../docs/superpowers/specs/2026-08-29-wp28c-feed-vs-shelf-design.md),
[`docs/superpowers/plans/2026-08-30-wp28c-feed-vs-shelf.md`](../docs/superpowers/plans/2026-08-30-wp28c-feed-vs-shelf.md).

**What shipped:**
- **Pure digest core** — [`src/lib/feed.ts`](../src/lib/feed.ts): `buildFeed(inputs, now)` orders `FeedEvent`s
  (`NEW_CHAPTER` | `NOW_FREE`) newest-first, groups them into UTC day buckets with human labels ("Today" /
  "Yesterday" / weekday-date), and `countNewSince(events, watermark)` for the per-device "seen" count. A chapter that
  ever unlocked (`becameFreeAt != null`) surfaces **only** as its `NOW_FREE` event, never also as `NEW_CHAPTER` — the
  guard that keeps one chapter from double-notifying. Next-/Prisma-free, unit-tested
  ([`tests/unit/feed.test.ts`](../tests/unit/feed.test.ts)).
- **`getFeed()` service** — [`src/server/services/feed.ts`](../src/server/services/feed.ts): READING-series only, a
  30-day / 150-event bounded window, `access === 'LOCKED'` chapters excluded (mirrors the push-notify filter — a
  still-locked new chapter isn't a readable event), each series' read/unread split via `orderChaptersForReading` +
  `lastReadChapterId`, and a consolidated **`downSources`** list (active, non-link-only, `health === 'LIKELY_DOWN'`)
  for the attention strip. Derived on read from existing `Chapter`/`Source` columns — **no schema change**.
  Integration-tested ([`tests/integration/services.test.ts`](../tests/integration/services.test.ts)).
- **Feed UI** — [`Feed.tsx`](../src/app/(app)/Feed.tsx) renders the source-down "needs attention" strip, day-grouped
  rows (chapter title/number primary, series name secondary, click-through to the chapter URL), a per-device **seen
  divider** (`localStorage` watermark, SSR-safe mount pattern — no hydration mismatch), already-read rows dimmed, and
  an empty state distinct from the shelf's. `/` ([`page.tsx`](<../src/app/(app)/page.tsx>)) now renders it behind a
  shared **[`ViewTabs.tsx`](../src/app/(app)/ViewTabs.tsx)** control also mounted on the new
  [`/shelf`](<../src/app/(app)/shelf/page.tsx>) route, which took over the prior shelf grid render.
- **Shelf card simplified:** the latest-chapter line + relative time dropped in favor of a plain **chapter count**
  (the WP-28c slot later reserved for **WP-TAGS**); the unread badge is now hidden on non-READING series (`Shelf.tsx`,
  `globals.css`).
- **Post-add + sort:** [`add/page.tsx`](<../src/app/(app)/add/page.tsx>) now redirects a successful add to
  `/shelf?added=<id>` with the new card highlighted, instead of landing on the feed; a new **"Recently added"** sort
  mode (`createdAt` desc) was added to `lib/shelf.ts` / `SORT_OPTIONS`, with `listSeries` now selecting `createdAt`.
- **Filed WP-TAGS** — series genre tags (detail-page editor + shelf-card display in the freed slot + a shelf filter)
  was scoped out as its own UI-only WP (the `tags String[]` column already exists on `Series`, unused — no
  migration).

**Testing:** unit (`feed.test.ts`, `shelf.test.ts` sort addition), integration (`getFeed` in `services.test.ts`), and
Playwright E2E (`e2e/feed.spec.ts`, plus `controls.spec.ts`/`delete.spec.ts`/`link-only-add.spec.ts`/`shelf.spec.ts`/
`smoke.spec.ts`/theme-scene specs repointed from `/` to `/shelf` where they exercise the shelf grid).

### WP-28d — Locked-chapter display (dim / marker) + filter/sort (DONE 2026-08-21)

**Shipped (2026-08-21):** lucide `Lock` marker on `LOCKED` rows (accent glyph, no dim) + a persisted **"Hide locked"**
checkbox, clutter-guarded to series that actually have a locked chapter. **Marker-only, no sort** (owner call), so
`arrangeChapters` was left untouched — the filter is a component-level `.filter`. E2E-covered in `controls.spec.ts`.
See the changelog entry for the full note. Original brief below.

**Goal (owner, 2026-08-20):** surface which chapters are **locked** on the series detail page — dim them and/or show a
lock marker — and optionally **filter them out** or **sort them to the bottom**.

**Data is already there (no schema work).** `Chapter.access` is an `AccessState` enum (`FREE | LOCKED | UNKNOWN`) set by
the WP-20 paid→free tracking, with `becameFreeAt` when a locked chapter unlocks. The detail page just doesn't carry it
to the UI yet: [`page.tsx`](<src/app/(app)/series/[id]/page.tsx>) maps `series.chapters` → `ChapterLite`
(id/title/number/url only), dropping `access`. So the gap is **presentation + one field of plumbing**, not persistence.

**Scope to design when picked up:**
- **Plumb** `access` (and maybe `becameFreeAt`) through `ChapterLite` + the page map into
  [`SeriesDetail.tsx`](<src/app/(app)/series/[id]/SeriesDetail.tsx>).
- **Display** — dim `LOCKED` rows (muted color / reduced opacity) and/or a lock glyph/badge in the row
  (`[num] [title] [🔒] [mark]`). Decide dim vs marker vs both; keep it legible against the read/unread dimming the row
  already does. `UNKNOWN`-access chapters (feed-only sources with no lock data) render normally — no marker.
- **Filter** — an optional "hide locked" toggle, sibling to the existing Show: Oldest/Newest/Unread-first segmented
  control, persisted in localStorage like the display-mode toggle.
- **Sort** — optionally push `LOCKED` chapters to the bottom. Cleanest as an extension to `arrangeChapters`
  ([`lib/reading.ts`](src/lib/reading.ts)) — a lock-aware reordering layered on the chosen display mode — under **TDD**
  (the reading lib is pure + already test-covered; locked-to-bottom is a natural new property). Decide whether it's a
  new mode, a modifier on existing modes, or coupled to the filter toggle.

**Skills:** `frontend-design`. **Depends:** WP-20 (lock state — done), WP-10 (detail UI — done). Builds directly on the
shipped WP-28 long-title readability facet — same `SeriesDetail` chapter rows + `globals.css` `.chapter*`. (Not related
to WP-28a, which sorts the *series cards on the shelf* — a different surface; WP-28d sorts/filters *chapters within one
series*.) **DoD:** locked chapters are visually distinguishable on the detail page; the filter and/or sort behavior
ships with its persistence; any `arrangeChapters` change is a tested pure function; `UNKNOWN`-access sources are
unaffected.

### WP-30 — Series title backfill from TOC + manual title edit

**DONE** (backend core 2026-07-31; manual title-edit UI 2026-08-13). Pure `extractSeriesTitle(html, {siteName?})` (`lib/feeds/title.ts`) reads
`<h1>` → `og:title` → `<title>`, with a conservative **host-matched** suffix strip across pipe and
hyphen/en-dash/em-dash separators (only strips a trailing `" | <Site>"`/`" – <Site>"` when it matches the source's
own host) and returns `null` when there's no usable heading; a companion `matchesSiteName` does a loose
case-insensitive compare (strips `www.`/TLD/non-alphanumerics) so a channel `<title>` that's just the site name is
recognized as such. `Series.titleIsManual Boolean @default(false)` shipped as an additive migration. **At add-time**,
stored-title precedence is now `input.title → page <h1>/og/title → per-path fallback`, and the WHOLE_FEED path no
longer adopts a feed channel `<title>` that equals the site name — it falls back to the URL-slug title instead of
mislabeling the series with its host's name. **At backfill-time** (`backfillFromToc`), a non-manual title is repaired
from the **landing page** (landing-primary, per WP-37's reverse-info finding): the self-heal path (no `tocUrl` yet)
reuses the already-fetched landing body for the title extraction at **zero extra fetch**; a backfill where `tocUrl`
was already set does one extra `source.url` fetch just for the title. Silent — no push — and returns
`titleUpdated?` from the backfill result. **Manual title-edit UI shipped 2026-08-13** — an inline detail-page
`<h1>` edit (pencil → input, Enter/Esc/Save/Cancel) PATCHes `/api/series/[id]` with `{ title }` (extending
`parseSeriesUpdate` to accept `title`); the service persists it and sets `titleIsManual = true` so auto-backfill
won't clobber the hand-fix. Enables a cleaner **WP-39b(a)** (page-watch home-vs-TOC dedup can now lean on a WP-30-clean title match, not
just canonical URL). Unit tests for `extractSeriesTitle`/`matchesSiteName`; integration tests for the add-time
preference (incl. the site-name-channel-title guard) and both backfill repair paths (self-heal-free and
tocUrl-already-set) plus the manual-title-not-clobbered case.

**Motivation (owner, 2026-07-26):** a series shows its title as an **acronym** (from the multi-novel add-time
fallback, which derives the title from the URL slug — see "Add-time isolation fallback"), not the human title.

- **Primary — auto-backfill from the page-watch TOC.** When a series is (or reverts to) the **page-watch** path, the
  TOC page carries the real series title (page `<h1>` / `og:title` / `<title>`), which `parseToc` doesn't extract
  today. Add a `parseTocTitle(html)` (or extend `parseToc` to return `{ title, chapters }`) and have the page-watch
  poll/backfill update a **URL-derived/placeholder** stored title to the real one — **only overwrite an auto-derived
  title**, never a user-edited one (needs a flag distinguishing auto vs. manual titles so we don't clobber a manual
  fix). Feasible: `pageWatch.ts` already loads the TOC with cheerio.
- **Fallback — manual title edit on the client.** If auto-backfill can't get a clean title (JS-rendered/CF TOC with no
  usable heading), let the user edit the series title in the detail UI (WP-10) and persist it (PATCH `/api/series/[id]`
  — extend `parseSeriesUpdate` to accept `title`). A manual edit sets the "user-edited" flag so auto-backfill leaves it
  alone. Ship this half even if auto-backfill lands — it's the escape hatch.
- **Second cause — a feed channel `<title>` that's the *site* name (owner testing, 2026-07-29: a concatenated-title
  custom source).** A *successful* add can still get a bad title: the series page advertises a proper **per-series**
  feed, so `addSeries` adopts it as WHOLE_FEED and takes `parsed.title` (the feed's channel `<title>`) — but that
  channel title is **the *site* name**, not the series. The real name sat in the page `<h1>`, `og:title`/`<title>`
  (with a " | &lt;Site&gt;" suffix), the advertised feed's `title` **attribute**, and even the feed **item** titles
  ("&lt;Series&gt; Chapter N"). Two fixes, both here: (a) the same **page `<h1>`/`og:title` backfill** above rescues
  it — but must **strip a trailing " | &lt;Site&gt;" / " – &lt;Site&gt;"** suffix; (b) at **add-time**, don't blindly
  trust a channel `<title>` — if it equals the host/site name, prefer `titleFromUrl(url)` (the `/series/<slug>` here
  already yields a decent name) or an item-title common prefix / the `<link rel=alternate>` title attr. Distinct from
  the acronym-slug case (that was a *failed* page fetch → `titleFromUrl` slug); here the fetch succeeded and a real
  feed's channel title was the culprit.
- **Third cause — the page's only `<h1>` is a consent/cookie banner (owner testing, 2026-08-13: a render-cleared
  WordPress source).** **(Now tracked as WP-30b.)** `extractSeriesTitle` reads `<h1>` first, but on some sites the sole `<h1>` is a **CCPA/consent-
  manager banner** ("Opt out of the sale or sharing of personal information", "We value your privacy", cookie strings)
  — the series name is in **no** heading, only `<title>`. So the stored title becomes the consent-banner text.
  **Fix:** treat a boilerplate/consent-banner `<h1>` as *not a title* (small known-phrase reject-list, and/or skip an
  `<h1>` inside a consent/cookie container) and fall through to `og:title` → `<title>` (the existing host-matched
  suffix strip then yields the right name). Cheap, and it also hardens the h1-first path generally.

### WP-33 / WP-34 — Feed ↔ TOC: backfill + switch to lock-monitoring

Full design + rationale: [feed-toc-transition-design](docs/superpowers/specs/2026-07-26-feed-toc-transition-design.md)
(owner-approved 2026-07-26). Summary of the decisions:

- **A feed can't report lock state** (lives only in the TOC) → two operations, both "fetch TOC → `parseToc` → diff →
  persist": **backfill** (one-time TOC union, feed stays the ongoing source) and **switch** (flip to `PAGE_WATCH`,
  feed deactivated) for the subset needing "now free".
- **Backfill (WP-33):** seed the full chapter list at add for READING series (the page `addSeries` already fetched is
  the TOC), + a per-series **"Backfill from TOC"** action (explicit, not re-add). PLANNED still seeds a summary (WP-27).
- **Switch trigger (WP-34):** **add-time** — if `parseToc(page.body)` shows `LOCKED`, choose `PAGE_WATCH` even when a
  feed exists — **plus a manual per-series "Track unlocks" override** for the JS/CF/tab misses.
- **Building block (WP-33):** a **silent `accessReconciled`** diff dimension — an already-seen chapter whose stored
  access was `UNKNOWN` and whose TOC access is now `FREE`/`LOCKED` gets updated **with no push** (it's *learning*, not
  an unlock). This **arms** WP-20 (a chapter must be known-`LOCKED` before its unlock can fire) and prevents a
  notification storm on the first post-switch poll.
- **Main risk:** feed-url ↔ TOC-url identity coherence (structural permalink differences → duplicate chapters). Needs a
  transition-time reconcile + validation against a real dual-source series.
- **Cloudflare gating (owner, 2026-07-26):** the owner's only feed-with-locked sites are **also CF-challenged** (TOC
  unreachable) → **WP-33 (backfill + reconcile) is buildable/testable now** on non-CF feed sites; **WP-34's end-to-end
  "now free on a switched feed series" is dormant** until a *non-CF* locked+feed site appears or the CF-unblock story
  lands (those sites stay WP-29 manual-schedule territory meanwhile).

### WP-35 — TOC-order chapters + display toggle

Full design: [wp35-toc-order-display-design](docs/superpowers/specs/2026-07-27-wp35-toc-order-display-design.md)
(owner-approved 2026-07-27). Follow the **site's own TOC order** instead of inferring reading order from chapter
numbers/titles (WP-33's `orderChaptersForReading`), and make the on-screen direction a user choice.

- **Part A (backend):** additive migration `Chapter.position Int?`; assign from `parseToc`'s DOM order on every TOC
  read (backfill / at-add seed / page-watch poll — **re-index each full read** so site re-sorts self-heal).
  **Direction-normalize** to reading order (oldest = 0) using the chapter-number *trend* as one global bit (skip
  positioning if the signal's too weak → comparator fallback). Feed-discovered chapters append at `max+1`.
  `getSeries`/`listSeries` order by `position` when positioned, else `orderChaptersForReading` (**kept as fallback**).
- **Part B (frontend):** **read-state anchored to canonical position**, not array index (retires the fragile
  `i <= lastReadIdx`); the reading-progress **high-water-mark pointer model is unchanged** (mark N read → all ≤ N in
  canonical order read; earlier chapter rewinds the boundary). **Three display modes** — oldest→newest (default),
  newest→oldest, unread-first (`[unread asc]++[read asc]`) — as a segmented control in `detail__controls`. Preference
  is **global, localStorage, per-device** (default oldest-first → no SSR flash).
- **Migration** (unlike WP-33). Interacts with WP-32 (split TOC → position spans unioned pages).

### WP-36 / WP-37 / WP-38 — TOC backfill correctness + cleanup (found in production testing, 2026-07-27)

> WP-36 + WP-38 design: [wp36-38-toc-scoping-cleanup-design](docs/superpowers/specs/2026-07-27-wp36-38-toc-scoping-cleanup-design.md) (owner-approved).

> ✅ **WP-36 landed — the sidebar/"recent entries" leak is fixed;** the backfill button no longer ingests cross-series
> chapters from page chrome. **WP-37 still open:** where the landing page isn't the chapter TOC, point the source at the
> real TOC by hand (`db:cleanup set-source-url …`) before backfilling. **WP-38 landed** — the `db:cleanup` maintenance
> script (dry-run default, `--apply` to commit) recovers already-contaminated listings: `list` / `prune-chapters` /
> `merge-series` / `delete-series` / `reset-chapters` / `set-source-url` / `backfill`.

**What happened (real backfill test):** pressing "Backfill from TOC" on a single series added **3 chapters, each from
a *different* series**. Root cause = two independent bugs on a **dense-feed WordPress site** where the series landing
page is not the chapter list:

- **Wrong page (WP-37).** `backfillFromToc` fetches `source.url` — but here that's the series **landing/overview**
  page, which has **no chapter list**. The real TOC is a **separate URL** the landing page links to (a "table of
  contents" page). Nothing auto-discovers it; the series was registered with the home URL. So `parseToc` ran on a
  page with no chapters. **Fix:** resolve/store a dedicated chapter-TOC URL per source (distinct from the reading
  `url`) — discovery follows the on-page "table of contents"/"chapter list" link, or the user sets it. Backfill/
  page-watch fetch that URL. (Relates to WP-19 re-pointing, WP-34 which also stores a TOC URL.)

- **`parseToc` has no series scoping (WP-36, latent — bites even with the right URL).** It scans *every* chapter-ish
  `<a>` on the page, **including a global sidebar "recent entries" widget** present on every page that lists the
  newest chapters **across all series**. So even pointed at the correct TOC, ~3–5 cross-series widget links get
  ingested as phantom chapters. **Fix:** restrict `parseToc` to the **main content** (exclude `aside` /
  `.widget-area` / `.widget_recent_entries` / `#secondary` / nav / footer) and/or scope to the series' **URL slug
  family** — supporting **multiple families** (this series' TOC spans two slug prefixes, a Part 1 / Part 2 split).
  Extends the per-site `SiteTocConfig`. The **feed path is immune** (items are per-post and the poller maps them to
  the series); backfill-via-TOC has no equivalent scoping — this is its own gap. **WP-36 is the higher-priority fix**
  (data correctness; also helps any multi-widget site independently of WP-37).

- **Cleanup (WP-38) — maintenance script now, UI later.** The owner has **bad production listings** already: phantom
  cross-series chapters merged into real series, **and a duplicate series** (the same work added twice — once with the
  home URL, once with the TOC URL). A one-shot script (run locally against the prod DB) that: (a) lists a series'
  chapters and **prunes** the ones the owner picks (phantoms — URL outside the series' slug family); (b) **merges or
  deletes a duplicate series** (fold chapters/progress/source from one into the other by canonical-URL union, or just
  delete the redundant copy); (c) optional **reset** a series' chapters and re-seed; (d) **correct the source's TOC
  URL** (manual — the WP-37 concern, done by hand here) and **clean re-backfill** (clean once WP-36 lands). Destructive
  prune/delete can land first; the clean re-backfill wants WP-36. A small detail-page UI (delete-chapter / reset /
  edit-source-URL) is a **follow-up** once the fixes settle.

### WP-37 — Per-series chapter-TOC URL (landing page ≠ chapter TOC)

**DONE (2026-07-31).** `Source.tocUrl String?` shipped as an additive migration. A pure `findTocUrl(html, baseUrl)`
(`src/lib/feeds/discover.ts`) discovers the on-page chapter-TOC link via an anchor-text heuristic ("table of
contents" / "chapter list" / "all chapters"), guarded to same-host and against self-links/cross-host
anchors. `tocUrl` is **resolved at add-time** on both the feed and page-watch add paths, and **self-healed at
backfill-time** — a null `tocUrl` is discovered then, followed one hop, and persisted (never re-discovered on every
poll). Consumers: `backfillFromToc` fetches `tocUrl ?? url`; the page-watch poll's fetch URL is
`feedUrl ?? tocUrl ?? url`. The reverse-info exploration (§5 of the spec) is written up in-repo.

**Post-review hardening (2026-07-31):** dropped the bare `toc`/`index` heuristic tokens — a footer/nav link
literally texted "Index" or "TOC" was resolving a spurious TOC URL for feed series; see WP-32 for the
follow-up (nav/chrome anchor-filtering) that would let them be reinstated safely.

**Add-time under-fetch caveat (→ WP-46, not a WP-37 bug).** At add-time, a landing≠TOC series still seeds its initial
chapters from the **landing page only** (the discovered `tocUrl` isn't fetched until backfill/poll), so such a series
shows **0 chapters until its first backfill or poll**, which then fills it via `tocUrl`. This is the already-tracked
WP-46 add-time under-fetch gap, not a regression introduced here — noted so it isn't mistaken for one.

**Reverse-info finding → steers WP-30.** On the probed source, the standalone TOC page's own title/`<h1>` is a
slug-abbreviation plus a "Table of Contents" label (no `og:title`), while the **landing page** carries the real series
title *and* the cover. Recommendation for WP-30: extract the title from the **landing page's** content heading, using
the TOC page only as a fallback; keep `url` (not `tocUrl`) as the page fetched for title/cover.

**Problem.** A `Source` has one `url` (the page the user reads / the landing page) plus an optional `feedUrl`. But some
series are registered with a **landing/overview URL that has no chapter list** — the real table of contents is a
**separate linked page**. `backfillFromToc` and page-watch both fetch `source.url` and run `parseToc` on it, so they
parse a page with no chapters (or the wrong ones). Today's only fix is manual: `db:cleanup set-source-url` to repoint
the source before backfilling. WP-37 makes the TOC URL a first-class, resolvable field.

**Proposed approach (refine in the brainstorm).**
- **Schema (additive migration):** add `Source.tocUrl String?` (nullable; `null` → fall back to `url`). Migrations are
  live now (Neon; WP-35 already ran one), so this is a normal `prisma migrate`.
- **Resolution:** at add-time (and on demand), discover the TOC link on the landing page — follow an on-page anchor
  whose text matches "table of contents" / "chapter list" / "all chapters" (case-insensitive), guarded like the other
  anchor heuristics. If none is found, leave `tocUrl` null and let the user set/override it from the detail UI (extend
  `parseSeriesUpdate` to accept a TOC URL, mirroring WP-30's manual title edit).
- **Consumers:** `backfillFromToc` and the page-watch poll fetch `tocUrl ?? url`. The reading `url` stays the
  user-facing link (unchanged in the UI).
- **Reconcile with WP-34** (feed→TOC switch also stores a TOC URL) — one field, not two. **Enables WP-39b(a)**
  (page-watch home-vs-TOC dedup keys on the shared TOC URL) and relates to WP-19 re-pointing.

**Definition of Done.** A series whose landing page ≠ its TOC can be added and then backfilled/polled against the
**correct** chapter list **without** a manual `set-source-url`: `tocUrl` is auto-resolved at add when the TOC link is
discoverable, else editable from the detail UI; `backfillFromToc` + page-watch use `tocUrl ?? url`; additive migration
applied; TOC-link discovery unit-tested (pure), and backfill-uses-tocUrl covered by an integration test.

### WP-39 — Prevent duplicate series on add (DONE 2026-07-31)

**What shipped:** pure `canonicalSeriesId` (`src/lib/dedup.ts`) keys a feed series on `canonical(feedUrl)#matcher` and a page-watch series on `canonical(sourceUrl)` (scheme/www-insensitive); `addSeries` computes it post-resolution, and a new `findSeriesByCanonicalId` port makes a duplicate return the existing series (`alreadyExisting`, route 200 not 201) instead of creating a second row — `createSeries` never runs. Persists `canonicalId` on create. Catches all re-adds (http/https/www/trailing slash/tracking params) + home-vs-TOC for feed series; keeps multi-novel-feed siblings distinct via the matcher. No schema change (column + index already existed).

**Residual:** page-watch-only series with different landing vs chapter-TOC URLs (no shared feed) are not unified by canonical URL alone — title/url reconciliation is deferred as **WP-39b** (gated on WP-37's TOC-URL resolution and WP-30's title backfill). WP-19 noted for alternate-source-on-dup UX.

### WP-39b — Deeper add-dedup (residuals from WP-39): tocUrl keying + create-then-annotate

**DONE (re-scoped, 2026-08-10).** Shipped:
- **(a) tocUrl page-watch keying.** `canonicalSeriesId` now keys a page-watch series on `canonical(tocUrl ?? sourceUrl)`
  — **going-forward only, no migration/backfill** of existing rows. A home-URL add and a later TOC-URL add for the
  same no-feed series now resolve to the same canonical id and collapse silently through the existing
  `alreadyExisting` path (WP-39).
- **Pure `findSimilarTitle`.** Normalized-equality + leading-token-prefix matching (drops a leading article, e.g.
  "The"); deliberately **no fuzzy matching**. Documented limit: it **cannot** catch two *different translations* of
  the same work (different title strings entirely) — that's out of scope here, see WP-WORKID below.
- **Create-then-annotate.** An add whose title is similar to an existing series (per `findSimilarTitle`) still
  **creates** the new series — it never blocks or auto-dedupes on title alone, too risky a false-positive — but the
  result carries a `similarTo: {id, title}` hint. The add page renders a non-blocking notice ("Open the existing" /
  "Keep both") so the possible duplicate is surfaced without gating the add. Merging from the app itself is
  deferred (see WP-CLEANUP-UI).
- **No schema change.**

**Explicitly deferred / re-scoped from the original WP-39b scope:**
- Original **(b)** multi-novel re-add matcher-**type-flip** (WHOLE_FEED↔CATEGORY↔PATH_PREFIX) across feed windows —
  not separately fixed; covered **in spirit** by the annotate net (a flipped-matcher re-add still creates but gets
  flagged via title similarity) rather than by a tighter canonical key.
- Original **(c)** true multi-novel matcher intelligence (two undetectably-distinct novels on one advertised feed
  both resolving to `#WHOLE_FEED`, i.e. false dedup) — **deferred**; revisit reactively if it actually bites (no
  known live case yet).

Filed two follow-ups out of this scoping: **WP-CLEANUP-UI** (the in-app merge that resolves a flagged `similarTo`,
including the genuine same-work/different-translation case) and **WP-WORKID** (future, low — automatic
cross-translation identity via a community aggregator's canonical work ID).

### WP-41 — Poll time-budget guard + rotation

> ✅ **DONE (2026-07-30).** Two pure helpers added to [poll.ts](src/server/services/poll.ts), both unit-tested:
> `orderGroupsByStaleness` (least-recently-polled-first ordering, keyed on the existing per-host `lastCheckedAt`
> aggregate — **no schema change / no persisted cursor**) and `groupCostMs` (RENDER 15s / PLAIN 5s worst-case
> estimate). `pollAllSources` orders groups by staleness, then per group applies the existing host-gate, then a
> **budget guard** — `clock()-start + groupCostMs > POLL_BUDGET_MS (270s)` ⇒ **skip (not break)**, so a later cheap
> group still fits and the skipped group's untouched `lastCheckedAt` makes rotation re-poll it first next run. A
> `clock` is injected (defaults to `Date.now`) so the guard is deterministically testable. Cron route `maxDuration`
> **60→300** (the 60s was self-imposed; Hobby's ceiling is 300s per Vercel docs). *Deferred as YAGNI:* a separate
> bounded RENDER pass (the plan's "optionally") — the single ordered loop with per-group cost already degrades
> gracefully. 296 unit + 50 integration green, typecheck clean.

**Motivation (owner, 2026-07-28):** `pollAllSources` is a **strictly sequential** loop (`for … await pollSource`) with
**no deadline**, under a **60s function ceiling**. Plain sources are cheap (mostly 304s), but **RENDER sources can't
304** and cost ~5–15s each, so as the active set grows (especially RENDER/CF sources) the run can exceed 60s and be
**killed mid-loop** — and because the source order is stable, the **same tail is silently dropped every day** (no error
surfaced; those series just never poll).

**Work:** track elapsed time in `pollAllSources` and **stop before the ceiling** (leave headroom for the push/schedule
steps), and **rotate the starting point** across runs (persist a cursor or order by a last-polled timestamp) so no
source is perpetually starved — the backlog drains fairly instead of the tail never polling. Optionally split RENDER
sources into their own bounded pass. Cheap, and it's a **latent correctness** issue (silent non-polling) that arrives
the moment there are more sources than fit in 60s — worth doing before it bites, not after. Pairs with WP-27 (cadence
gating trims the daily set) and WP-40 (making CF-static cheap/304 shrinks per-source cost).

### WP-45 — API-first adapter for render sources (plain-REST slice)

**DONE (2026-08-18).** A source can now be tracked by reading its chapter data **API (JSON)** directly instead of
headless render + DOM scrape. Shipped as the **plain public REST slice** (render-eliminating). An API source is
modeled as "a TOC delivered as JSON": the parser emits the existing `TocChapter[]` shape, so `diffChapters` +
"now free" + notify are untouched. `type` (how to parse: `FEED | PAGE_WATCH | API`) stays orthogonal to `fetchMode`
(how to transport: `PLAIN | RENDER`).
- **Schema (additive):** `SourceType.API`; `Source.apiUrl` (endpoint) + `Source.apiMap` (`Json` field descriptor).
  `fetchUrl` = `apiUrl ?? feedUrl ?? tocUrl ?? url`.
- **Pure `parseApiChapters(body, descriptor, baseUrl)`** (`lib/feeds/apiAdapter.ts`) — JSON → `TocChapter[]`; access
  from a per-chapter `isFree` flag (`isFreeWhen:'falsy'` inverts a `locked` field), tolerant number parsing (field →
  title → url), relative-URL resolution, shape-drift/bad-JSON → `[]`.
- **Pure `probeForApi(html, baseUrl)`** (`lib/feeds/apiProbe.ts`) — generic, host-agnostic add-time detection (first
  detector: a page shell pointing at a `.json` data file); extensible; `null` → today's add ladder runs unchanged.
  No per-host code.
- **Add-time wiring** — `addSeries` probes the plainly-fetched page first; a hit resolves an API source (no
  feed/render), a miss falls through byte-for-byte to the existing ladder.
- **Manual escape hatch** — `set-api-descriptor <sourceId> --endpoint <url> --map <json> [--render]` (service
  `setApiDescriptor` + the `db:cleanup` CLI) configures an API source for a bespoke endpoint the page doesn't
  advertise. Endpoint/map are arguments — no host in git.
- **Poll wiring** — `processFetched` parses an `API` source via its descriptor into the same `diffChapters`, so
  `becameFree`/notify fire natively; conditional-GET (304) works (a win over render). No render escalation, no
  matcher for API.
- Tested: unit (`parseApiChapters`, `probeForApi`); add-time (probe→API source; no-signal→FEED unchanged); poll
  (API diff + LOCKED→FREE `becameFree`); integration proving the real WP-20 unlock end-to-end off an API source (a
  poll sees `isFree:false`→stores the chapter LOCKED; a later poll sees `isFree:true`→`becameFree` +
  `becameFreeAt`, no render, no manual state).

**`freeAt` deferred (noted for later):** the plain public REST API also exposes a **per-chapter `freeAt`**
scheduled-unlock timestamp. This slice consumes only `isFree` (native WP-20). Capturing `freeAt` later (a
`Chapter.freeAt` column) enables **predicted** unlocks — feeding WP-29 (manual release schedule) / WP-27b. Not
built here.

**Follow-up (WP-SIMPLIFY):** `SourceType` is hand-duplicated as inline string-literal unions
(`PollableSource.type`, `SeriesDetail.sourceType`) rather than one canonical `lib/` type like
`SeriesStatus`/`SourceHealth`/`FailureType`; consolidating it would make the next enum change a one-line edit.
Pre-existing; deferred.

### WP-45b — CF-gated render transport + paginated API sources

**DONE (2026-08-20).** A Cloudflare-gated, paginated chapter API is now tracked end-to-end. The renderer clears CF once and reads clean JSON (spike-validated against a real CF endpoint), and API sources fetch + union every page.
- **Render JSON transport:** `renderPage` detects a JSON resource (by content-type) and returns the raw body via an in-page same-origin `fetch` that reuses the `cf_clearance` cookie `goto` obtained — `page.content()` would return the browser's JSON-viewer HTML instead. The HTML/DOM render path is unchanged.
- **Pagination (both transports):** an optional `ApiDescriptor.pagination` (`{pageParam, perPage, maxPages?, listPath?}`) drives `fetchApiPages`, which returns one combined root-array body. PLAIN loops Node-side GETs; RENDER makes **exactly one** render call and the render service loops in-page — one browser per series per poll, never one-per-page (guaranteed by a `renderFetch`-called-once test). Stop = a short page (`< perPage`); cap = `maxPages` (default 20) with a log on cap-hit. `perPage` is per-descriptor. Also closes the latent WP-45 gap (a paginated plain API previously read only page 1).
- **Poll seam:** a paginated API group routes to `fetchApiPages`; the flattened root-array body is parsed with `listPath` as root. Non-paginated + non-API sources are byte-for-byte unchanged.
- **CLI:** `set-api-descriptor --render` is functional; the `--map` JSON carries the `pagination` block (validated: string `pageParam` + positive `perPage`).
- The union/stop logic is unit-tested (`collectJsonResult` with an injected page-fetch, `fetchApiPages` with fake ports); the one-browser guarantee is the call-count test; the real CF end-to-end is owner-validated on deploy (a `[render] json pages=N` log confirms one browser + N in-page pages).

### WP-48 — Blogger feed-path in `guessFeedUrls`

**Motivation (owner testing, 2026-08-10):** a Blogger (`*.blogspot.com`) series can't be added — throws "couldn't
reach … or find a feed" — though residentially it's **200 under any UA, 0 redirects, 357 chapter links, and a valid
advertised feed** (`/feeds/posts/default?alt=rss`). Two things combine: (1) the **page fetch fails from Vercel** (Google
serves the datacenter IP a non-200), so `addSeries` never runs `discoverFeeds` — advertised feeds are read only when
`pageOk`; (2) it falls to `guessFeedUrls`, which yields **WordPress-style `/feed/` (404 on Blogger)** and `${page}feed/`,
never Blogger's real `/feeds/posts/default`. So a perfectly good feed is unreachable on the failure path → throw.

**Fix:** in `guessFeedUrls` (`lib/feeds/discover.ts`), detect `*.blogspot.com` and add `{origin}/feeds/posts/default`
(+ the `?alt=rss` variant) to the candidates. A Blogger series then binds via its feed **even when the page fetch is
blocked** — no render needed, and the feed is 304-able. Pure change, test-first. (WP-46's render fallback would also
rescue it by fetching the page, but the feed path is cheaper for Blogger.)

**DONE (2026-08-10).** `guessFeedUrls` now offers Blogger's `/feeds/posts/default` (Atom) + `?alt=rss` (RSS) —
**first** for a `*.blogspot.com` host (skips the two WordPress 404s), **last** for every other host as a **universal
fallback**. That universal tail (owner decision) also rescues **custom-domain / ccTLD Blogger** blogs that hostname
detection can't catch, making the blogspot check a pure speed optimization. No `addSeries` change (it already falls back
to `guessFeedUrls` when `pageOk` is false) and no schema. Accepted low risk: a non-Blogger host that serves valid feed
XML at exactly `/feeds/posts/default` could silently wrong-bind — mitigated by **strict-last** ordering + `looksLikeFeed`
(rejects 404 HTML), rare for translator sites, and recoverable. Pure, unit-tested (blogspot-first + universal-last order,
unparseable → `[]`).

### WP-49 — Don't bind `WHOLE_FEED` to a multi-novel advertised feed (prefer page-watch)

**Motivation (owner testing, 2026-08-10):** a multi-novel WordPress series, added via its TOC **post** URL, came in with
its ~150 real chapters **plus** a handful from *other* novels on the site (e.g. a different novel's "Ch. 57.1").
Confirmed in prod (Neon): the source is a **`WHOLE_FEED`** binding to the site-wide `/feed/`.

**Mechanism:** the post advertises the **site-wide** `/feed/` (every WordPress post does), which `addSeries` picks first
and trusts. That feed is a rolling ~10-item window across **all** novels — items tagged `Uncategorized`, on date-based
permalinks — so `chooseSeriesMatch` can't isolate the series (no per-novel category, no shared path prefix), and
`match = positive ?? (usedGuesses ? fallback : WHOLE_FEED)` defaults to **`WHOLE_FEED`**. `filterBySeriesMatch` then
returns the *entire* window and `mergeFeedAndToc` unions it with the (clean) page TOC → the series absorbs every novel's
recent chapters. Worse, it's an **ongoing leak**: each poll re-pulls the current window (which may contain *none* of the
tracked series' own chapters, only others'). The "advertised feed = the series' own feed → trust `WHOLE_FEED`"
assumption is simply false on a multi-novel WordPress site.

**Fix:** when a page-advertised feed **can't positively isolate** the series (positive `null`) **and looks multi-novel**
(items span clearly distinct works / don't share the series path), **do not default to `WHOLE_FEED`** — prefer
**PAGE_WATCH** (the source page is a series TOC post: clean, series-scoped, and its ongoing poll stays scoped) or a
series-scoped fallback match. Shares WP-39b's root ("better multi-novel detection in the matcher") — coordinate the
detection heuristic. **Not** covered by WP-36 (parseToc/page scoping) — this is the feed-vs-`WHOLE_FEED` *binding*
decision. **Cleanup:** existing `WHOLE_FEED`-bound multi-novel series need re-pointing to page-watch + a prune of the
cross-novel chapters (WP-38 `db:cleanup`).

**Tooling gap found during the first prod cleanup (2026-08-10):** the WP-38 `db:cleanup` CLI can prune chapters and
change a source `url`, but it has **no way to flip a source's *type*** — `set-source-url` only updates `url`/`host`,
not `type`/`feedUrl`, so a `FEED`/`WHOLE_FEED` source can't be converted to `PAGE_WATCH` through the CLI. The first
recovery had to do it as a **manual one-row DB update** (`type=PAGE_WATCH`, `feedUrl=null`, clear the stale feed
`etag`/`lastModified`). Add a **`reclassify-source`** command (set `type`, clear `feedUrl`, reset validators — and
optionally `deactivate-source`) so WP-49-style recoveries are fully tool-supported instead of hand-edited on prod.

### WP-40 — Cheap CF bypass for static CF-blocked hosts (browser-fingerprint GET, not render)

**Motivation (owner testing, 2026-07-27/28):** some hosts (e.g. the dense-feed WordPress translator behind Cloudflare)
serve a **static, server-rendered TOC** but **challenge our plain `fetch` from Vercel's datacenter IP** — a
*network-access* problem, not a *rendering* one. Proven: a bare `curl` from a residential IP returns the full chapter
list (no JS needed), and `/api/render` **from Vercel** also returns it (200, real title, all chapters) — so Vercel's IP
isn't hard-blocked; only our plain bot `fetch` is challenged. Today the only bypass we have is the **headless renderer**
(WP-17b), which works but is the wrong-sized tool: Chromium is expensive and — critically — **can't do conditional GET**
(`renderFetch` sends no validators, always `notModified:false`), so every poll is a full ~5–15s render. A backlog of
such novels blows the poll budget (**WP-41**) for no reason.

**Second driver, harsher (owner testing, 2026-07-28): a no-feed CF host.** Also CF-fronted + Vercel-blocked, but with
**no usable feed** (advertises none; per-series `/feed/` 404s; site `/feed/` is empty) — so a CF-blocked page fetch
can't fall back to page-watch *or* a feed and `addSeries` **hard-throws** ("may be blocking automated requests"). The
series is **unaddable** today, not just empty. This makes WP-40 a *correctness/blocker* fix for some sites, not only an
efficiency one. (Open: whether this host is rescued by the fingerprint GET or is the harder 403 set — confirm via a
Vercel `/api/render` curl.)

**Work:** add a lighter fetch rung for **CF-static** hosts — a single GET with a **browser TLS/JA3 + header
fingerprint** (e.g. a `curl-impersonate` binary or an impersonation-capable HTTP client) that clears CF's bot challenge
**and supports `If-None-Match`/`If-Modified-Since` → 304**. This is a **local** fetch (request goes straight from our
server to the target, just with a browser-like handshake) — **not** a third-party unblocker/proxy, so it keeps the
**WP-17b privacy stance** (that decision declined *third-party* unblockers, not local impersonation). Wire it as a
`fetchMode`/host-policy rung between PLAIN and RENDER: CF-static hosts use it; **reserve real RENDER (Chromium) for
genuinely JS-rendered TOCs** (the tab / load-more sites — WP-31). **Must cover the add path, not just poll:** today's
render escalation is **poll-only** (`pollSource` PLAIN→RENDER at ≤5 chapters), while **`addSeries` uses the plain
`fetch` only** — so a CF-blocked host like this **can't be added at all** (it never reaches the poll to escalate).
The bypass rung has to be reachable from `addSeries` (or `addSeries` needs a render/bypass fallback on page-fetch
failure for CF hosts). Caveat: a browser *UA alone* likely won't pass (CF keys on the TLS fingerprint), so verify the
impersonation actually clears the challenge from Vercel before relying on it. Relates to WP-17b (escalation ladder),
WP-34/WP-29 (CF-gated sites), and the harder **403 `cf-mitigated`** set which may still
need more than a fingerprint. **Confirmed hosts where render works from Vercel (only plain fetch blocked): a
dense-feed source and a no-feed source.**

**Spike result — PARKED (2026-07-28).** Research pointed to [`impit`](https://github.com/apify/impit) (Apify; Rust/rustls
patched for a real browser ClientHello + HTTP/2 ordering; napi-rs Node binding, prebuilt linux-x64-gnu, ~0 runtime deps,
Apache-2.0) as the best serverless fit — strictly better than spawning `curl-impersonate`. A throwaway probe route
(`/api/bypass-probe`, both a plain `politeFetch` and an `impit` GET, bearer-gated + SSRF-guarded) was deployed to a
Vercel preview and run against both confirmed hosts. **Result: impit did NOT clear either** — both returned Cloudflare's
**JS *managed challenge*** ("Just a moment…", HTTP 403, ~5.9 KB interstitial), `cleared:false`, 0 chapters; plain fetch
was a bare 403. So the WP-40 premise was **wrong**: these hosts aren't "static, merely IP-challenged" — from Vercel's
**datacenter IP** they're served a challenge that requires **executing JavaScript**, which TLS impersonation can't do
(nor could `impers`/curl-impersonate — also no JS). Confirmed by research: pure-code solvers (`cloudscraper`) are dead
for the modern managed challenge; FlareSolverr/Byparr are just headless browsers (= render cost); and **`cf_clearance`
is bound to IP+UA+TLS**, so "solve once, cache the cookie" fails on Vercel's rotating egress IPs. The real blocker is
**IP reputation**, full stop.

**Disposition.** The only mechanisms that clear these hosts are (a) a real browser — the **render** path we already
have — or (b) a **residential IP we control**. (b) — a self-hosted residential egress (home box + Tailscale/CF-Tunnel,
a `RESIDENTIAL` fetch rung) is the *only* cheap + 304-capable + privacy-respecting option, but was **declined** (owner
has no always-on home machine; a Pi + tunnel + SSRF-locked relay + home-uptime dependency isn't worth it for two
sites). So: **keep CF hosts on render**, and pivot to making render sustainable — **WP-41** (poll budget guard) +
**WP-27** (cadence gating). Spike torn down (branch `wp40-cf-impit-spike` deleted; no `impit` dep, probe route, or
middleware exemption on `main`).

**Revisit — third-party unblockers (deferred, not chosen).** A hosted unblocker (ZenRows / ScraperAPI / Scrapfly /
Bright Data) *would* clear CF (their own browsers + residential IPs), but (1) it reverses the **WP-17b privacy stance**
— the URLs of what the owner reads would go to a vendor — and (2) **open question:** it likely hits the **same
time-budget limit as render** — a per-request unblocker call is *also* multi-second, so a large CF/PLANNED set still
blows the 60 s poll ceiling. So even reconsidering it, **WP-41 + WP-27 remain prerequisites**, not alternatives.
Real-host probe detail (statuses, byte sizes) is kept in local, uncommitted notes.
