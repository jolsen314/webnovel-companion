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

---

## Current focus

> **NEXT: WP-29's schedule-editor UI** (lib + schema + cron wiring done; editor UI + push delivery remain), then the
> reading-status lifecycle (**WP-27**) and **WP-28** (styling/theming). **Elevated (owner wants soon): WP-40** — cheap
> local CF-static bypass (browser-TLS-impersonation, 304-capable) so CF-fronted-but-static hosts (e.g.
> cf-wordpress-source) fetch reliably without the uncacheable render. Also queued: **WP-30** (title backfill + manual
> edit), **WP-34** (feed→TOC switch, CF-gated), **WP-37** (auto-discover the chapter-TOC URL), and **WP-39** (add-time
> dedup). **Owner has a pending cleanup** to run: the `db:cleanup` CLI (WP-38) against prod to recover the
> phantom-chapter listings + the duplicate series.

The MVP is **live on Vercel + Neon** — feed pipeline, auth gate, library/detail UI, **Web Push (WP-09, verified on a
device)**, the **headless renderer (WP-17b, live-validated)**, and **paid→free "now free" detection (WP-20)**. The
locked→free transition is now caught per-chapter off the TOC (`parseToc`'s access marking → `becameFreeAt` →
privacy-safe "Now free" push, riding the new-chapter toggle); new *locked* chapters are stored silently and notify only
on unlock. Remaining near-term: **WP-29 editor UI**. (Real site/series names for testing live in the gitignored
`TESTING-NOTES.local.md`.)

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

Priority order = row order. `⭐` = load-bearing / do-first.

| ID | Work package | Milestone | Status | Depends on |
|----|--------------|-----------|--------|------------|
| WP-12 | Fold spec's unique content into README, delete spec | M0 | `DONE` | — |
| ⭐ WP-00 | Repo bootstrap + test harness | M0 | `DONE` | — |
| WP-GH | Git + private GitHub repo, first push | M0 | `DONE` | — |
| WP-CI | GitHub Actions: test + typecheck on push/PR | M0 | `DONE` | WP-GH |
| ⭐ WP-01 | `lib/feeds/diff.ts` (pure, test-first) | M0 | `DONE` | WP-00 |
| ⭐ WP-03 | `lib/health.ts` (pure, test-first) | M0 | `DONE` | WP-00 |
| WP-04 | Prisma schema + migration + db client | M0 | `DONE` | WP-00 |
| WP-05 | Feed parse + auto-discovery + series-match (`lib/feeds/{parse,discover}.ts`, pure) | M0 | `DONE` | WP-00 |
| WP-FE | Feed/page fetcher (HTTP: realistic headers, conditional GET, Cloudflare-tolerant; injected fetch) | M0 | `DONE` | WP-05 |
| WP-06 | Next.js + Tailwind + PWA shell (manifest + service worker) | M0 | `DONE` | WP-00 |
| WP-07 | Services: `pollAllSources()`, `addSeries()` | M0 | `DONE` | WP-01, WP-04, WP-05, WP-FE |
| WP-08 | API routes (series CRUD, push/subscribe, cron/poll) | M0 | `DONE` | WP-06, WP-07 |
| ⭐ WP-17 | Page-watch — **primary** for dense/paid sites (`lib/feeds/pageWatch.ts`; framework adapters + generic) | M1↑ | `DONE` | WP-01, WP-05 |
| WP-17b | Hard sources: self-run headless renderer (`fetchMode` PLAIN→RENDER) for JS-rendered TOCs — [design](docs/superpowers/specs/2026-07-23-wp17b-hard-sources-design.md). **Live-validated on Vercel** | M1↑ | `DONE` | WP-17 |
| WP-29 | Manual release schedule (no-fetch fallback for blocked sites) — `lib/schedule.ts` (INTERVAL + WEEKLY), notify day-after, new/unlocked tag. **Lib + schema + cron wiring DONE; editor UI + push delivery (WP-09) remain** | M1↑ | `WIP` | WP-07, WP-10 |
| ⭐ WP-20 | Paid→free frontier + "now free" (per-chapter LOCKED→FREE off the TOC; `becameFreeAt` + "Now free" push) | M1↑ | `DONE` | WP-07, WP-17 |
| WP-09 | Web Push end-to-end (VAPID, sw handler, subscribe flow, per-type prefs in Settings, privacy copy, test button) — **verified live on a device** | M0 | `DONE` | WP-06, WP-08 |
| ⭐ WP-10 | Library + series-detail UI (unread counts, mark progress) | M0 | `DONE` | WP-06, WP-08 |
| ⭐ WP-AUTH | Single-user password gate (scrypt hash + signed cookie + middleware) — **deploy prerequisite** | M0 | `DONE` | WP-06, WP-08 |
| WP-11 | Deploy to Vercel + Cron + PWA install verification | M0 | `DONE` | WP-08, WP-AUTH |
| WP-13 | `lib/completion.ts` (pure) — plan-to-read heuristic | M1 | `TODO` | WP-00 |
| WP-14 | `lib/dedup.ts` (pure) — "already read this?" | M1 | `TODO` | WP-00 |
| WP-15 | `lib/search.ts` (pure) — filter/query building | M1 | `TODO` | WP-00 |
| WP-16 | Host-level health aggregation (site-down vs novel-moved) | M1 | `TODO` | WP-03, WP-07 |
| WP-18 | Completed shelf + backfill + "Move to Completed?" | M1 | `TODO` | WP-10 |
| WP-28 | Frontend styling & theming — ordering, feed-page vs library split, theme system (night default + cultivation ancient-scroll, sci-fi holographic-panel) | M1 | `TODO` | WP-10 |
| WP-19 | Non-destructive re-pointing + "find new source" helper | M1 | `TODO` | WP-16, WP-18 |
| WP-30 | Series title backfill from TOC (fix acronym/URL-derived titles) + manual title edit | M1 | `TODO` | WP-17, WP-10 |
| WP-31 | Tab-structured premium TOCs — renderer clicks Free/Premium tabs + tab-membership access marking (unblocks WP-20 "now free" where locked chapters live behind a tab, not row markers) | M1↑ | `TODO` | WP-17b, WP-20 |
| WP-32 | Split/paginated TOCs across sibling pages — page-watch follows "next chapters" navigation (bounded hops) + stops pagination anchors polluting `parseToc` | M1↑ | `TODO` | WP-17 |
| WP-33 | Full-TOC backfill (feed series seed whole history at add + on-demand action) + silent `accessReconciled` diff dimension (`UNKNOWN`→`FREE`/`LOCKED`) — [design](docs/superpowers/specs/2026-07-26-feed-toc-transition-design.md) | M1 | `DONE` | WP-07, WP-17, WP-20 |
| WP-34 | Feed→TOC switch to lock-monitoring — add-time lock detect (prefer PAGE_WATCH) + per-series "Track unlocks" switch + transition identity reconcile — **mechanism buildable; end-to-end "now free" CF-gated** | M1↑ | `TODO` | WP-33, WP-19 |
| WP-35 | TOC-order chapters (`Chapter.position` from TOC DOM order, direction-normalized) + detail-page display toggle (oldest/newest/unread-first, canonical read-state) — [design](docs/superpowers/specs/2026-07-27-wp35-toc-order-display-design.md) | M1 | `DONE` | WP-17, WP-33, WP-10 |
| ⭐ WP-36 | `parseToc` series scoping — restrict to main content (drop sidebar/"recent entries" widgets, nav/footer) + optional slug-family filter, so backfill/page-watch stop ingesting **cross-series phantom chapters**. **Data-correctness fix** | M1 | `DONE` | WP-17 |
| WP-37 | Per-series chapter-TOC URL (landing page ≠ chapter TOC) — resolve/store a dedicated TOC URL distinct from the reading `url`; discovery follows an on-page "table of contents" link or the user sets it | M1 | `TODO` | WP-17, WP-33 |
| WP-38 | Recover contaminated series (maintenance script) — prune phantom/cross-series chapters, **merge/delete duplicate series**, reset+re-seed, correct the source TOC URL + clean re-backfill (owner has bad production listings + a dup from the WP-33 button) | M1 | `DONE` | WP-36 |
| WP-39 | Prevent duplicate series on add — wire `canonicalId` (normalized-URL/NU-id) dedup into `addSeries` so the same series can't be added twice (home URL vs TOC URL → one series); consumes WP-14's pure dedup | M1 | `TODO` | WP-07, WP-14 |
| WP-RC | Dense-feed miss-detection + TOC reconcile fallback | M1 | `TODO` | WP-05, WP-07, WP-17 |
| WP-21 | Plan-to-read completion watch (wire WP-13 + notify) — compare **max chapter number** vs target, not post count (split-chapter safe; see CONTEXT.md) | M1 | `TODO` | WP-13, WP-07 |
| WP-27 | Reading-status lifecycle for poll + store — status→**cadence** gating (skip COMPLETED/DROPPED; PLANNED/backlog polled rarely, not daily — matters because RENDER can't 304), PLANNED seeds a **summary** not the full TOC (backfill on →READING), per-status notify rules | M1 | `TODO` | WP-07, WP-17, WP-18 |
| WP-40 | Cheap CF bypass for **static** CF-blocked hosts — a **local** browser-TLS-impersonation GET (304-capable) so CF-static sites (server-rendered, just IP-challenged) skip the uncacheable headless render; reserve RENDER for genuinely JS TOCs. *Not* a third-party unblocker (keeps WP-17b privacy stance) | M1↑ | `TODO` | WP-17b |
| WP-41 | Poll time-budget guard + rotation — the sequential `pollAllSources` loop has no deadline under the 60s ceiling; stop before it and rotate the start offset so the tail (esp. RENDER sources) degrades gracefully instead of being silently dropped daily | M1 | `TODO` | WP-07 |
| WP-22 | MV3 browser extension (progress capture + "track this") | M2 | `TODO` | WP-08 |
| WP-23 | Chinese mining: `tokenize/zh.ts` + `dict/cedict.ts` | M3 | `TODO` | WP-04 |
| WP-02 | `lib/srs/sm2.ts` (pure, test-first) — SM-2 scheduler | M3 | `TODO` | WP-00 |
| WP-24 | Vocab capture + SM-2 review UI (wire WP-02) | M3 | `TODO` | WP-02, WP-23 |
| WP-25 | Korean sidecar (`services/korean-nlp`) + `tokenize/ko.ts` | M3 | `TODO` | WP-23, WP-24 |
| WP-PASSKEY | Auth upgrade: passkeys / WebAuthn (passwordless, phishing-resistant) | M4 | `TODO` | WP-AUTH |
| WP-EXPORT | One-click data export (`/api/export` → JSON) — own-your-data insurance | M1 | `TODO` | WP-AUTH |
| WP-26 | Extras: TTS, offline caching, Anki export, multi-user | M4 | `TODO` | — |

---

## Near-term work packages (detail)

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
`matchType`/`matchValue`; health `score` accumulator; Chapter access state; possibly `lastReconciledAt` for WP-RC);
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
- **WP-RC (dense-feed reconcile):** miss-detection (number gap + feed-window saturation) → immediate TOC scan;
  periodic reconcile for at-risk Sources; may add `lastReconciledAt` + a feed-window marker to `Source` (defer to
  the WP-04 DB pause). **Also the escalation for the add-time "couldn't isolate" case** (below): a series added with
  a best-effort slug/path filter but no chapters, that never fills after N cycles, should escalate to page-watch.

**Add-time isolation fallback (built 2026-07-22).** When a series' only reachable feed is a **site-wide, multi-novel**
one and the novel isn't in the current window, `addSeries` does *not* reject or grab the wrong novel — it adds the
series (correct title from the URL) with a **series-scoped guess** (`fallbackSeriesMatch`: category-slug if the feed
is categorized, else URL path). It shows 0 chapters until the novel next publishes, when the filter captures it from
the feed. If it never fills, WP-RC escalates to page-watch. **Cloudflare caveat:** where the *page* is JS-challenged
(e.g. a Cloudflare-challenged source — 403 `cf-mitigated: challenge`) plain page-watch also fails; ongoing releases still arrive via
`/feed/` (which isn't challenged), but backfill/true page-watch needs a **headless-browser escalation** (separate
service; not Vercel serverless) or an unblock service — best-effort per the README. Near-term workaround: track such
a novel via its NovelUpdates feed instead.

### WP-27 — Reading-status lifecycle for poll + store

Keyed on **reading status** (`SeriesStatus`: READING / PLANNED / PAUSED / DROPPED / COMPLETED = *I* finished reading), not
`translationStatus`. Three parts:

- **Status-gated polling.** `pollAllSources` polls every active source today regardless of shelf. Gate it: **skip
  COMPLETED and DROPPED** (no new chapters wanted). Motivation is **compute + politeness**, not storage — see the
  free-tier note in the backlog. Cheap: filter the active-sources query by the parent series' status. *(Open:
  PAUSED — poll-but-suppress-notify, or skip? Leaning poll-quietly so the backlog is there on resume.)*
- **Status→cadence, not just skip (owner, 2026-07-28).** Beyond skip/poll, **PLANNED/backlog should poll *rarely*
  (slow cadence or on-demand), not daily.** This sharpened once we confirmed **RENDER sources can't 304** (every poll
  is a full ~5–15s headless render — `renderFetch` sends no validators): a pile of PLANNED reads on a CF/JS host (e.g.
  many cf-wordpress-source novels) would otherwise cost a full daily render *each*. Gate cadence by status — READING
  daily; PLANNED/PAUSED slow or on-promote. This also caps the RENDER load **WP-41**'s time-budget guard must absorb,
  and pairs with **WP-40** (make CF-static hosts cheap/304). PLANNED already seeds a summary not the TOC (next bullet),
  so it has little to poll anyway — the win is *not paying to render a backlog you're not reading yet*.
- **PLANNED seeds a summary, not the full TOC.** For a plan-to-read series, seeding the whole TOC of a finished
  ~1,000-chapter translation at add-time is a large insert for something you may never open, and the PLANNED signal is
  a **milestone**, not per-chapter. Seed a summary (max chapter number, total vs `targetChapterCount`, free/locked
  counts); **backfill the full TOC when it flips to READING** (shares the WP-18 backfill path). This is the *only*
  place "store less" earns its keep.
- **Per-status notify rules** (wire with WP-09/WP-20/WP-21): READING → per new chapter (+ locked→free, WP-20);
  PLANNED + paid → **fire only when 0 LOCKED remain** (whole work bingeable free — the real "start now" trigger, not
  "all chapters published"); PLANNED + free ongoing → fire at `targetChapterCount` (WP-21).

> Explicitly **not** doing: pruning stored chapters for COMPLETED. It saves negligible space (see backlog) and costs
> reading position (`lastReadChapterId` → a real `Chapter` row), the chapter list, and re-diff ability. YAGNI.

### WP-28 — Frontend styling & theming

UX-polish pass on the shipped library/detail UI (WP-10). Scope to design when picked up: **ordering** (how the shelf
sorts — recent-activity, unread-first, alphabetical, manual); **feed page vs library** (a separate "what's new across
everything" river distinct from the per-series library grid — decide whether they're one view or two); a **theme
system** beyond the current "night reading" identity — pluggable themes such as *cultivation ancient-scroll* and
*sci-fi holographic-panel*, selectable by the user. Uses `frontend-design` (primary) + `ai-toolkit:design-workflow`
for tokens; gets its own brainstorm → spec when prioritized. Depends on WP-10 (done).

### WP-30 — Series title backfill from TOC + manual title edit

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

**Note:** contradicts the WP-17b "validated ~261 links" changelog line — production `route.ts` lands on the Free tab,
so that figure was free-only or taken differently; re-confirm with a prod `/api/render` curl when picked up. **Gets its
own brainstorm → spec when prioritized.** Until then, "now free" on tab-structured paid sites is a known non-detection.

### WP-32 — Split/paginated TOCs across sibling pages (follow-next-page in page-watch)

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
   rolls to a new slug and breaks silently; register both slugs manually — brittle as pages grow.)
2. **Stop pagination anchors polluting `parseToc`.** "Next/Previous Chapters" text contains "Chapters" →
   `CHAPTER_TEXT` matches → `parseToc` emits a **phantom chapter row** (url = the sibling page, number = null). Filter
   navigation anchors out (and feed them to step 1 instead).
3. **Two parse quirks to handle** (seen on this site): a **slug/label off-by-one** (last link's `href` number is one
   ahead of its visible "Chapter N" text — decide which to trust or reconcile), and a **non-numeric prologue**
   ("Chapter α" → `parseChapterNumber` → null; already tolerated, worth a test).

**Overlaps WP-RC** (dense-feed reconcile) — both are page-watch completeness safety nets; coordinate when building.
**Gets its own brainstorm → spec when prioritized.**

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

### WP-39 — Prevent duplicate series on add

**Motivation (owner, 2026-07-27):** the same work got added twice (home URL and TOC URL → two `Series` rows). Add-time
dedup **doesn't exist** — the schema *has* a `Series.canonicalId` field ("NovelUpdates id / normalized URL — de-dup
key") + `@@index([userId, canonicalId])`, but `addSeries`/`createSeries` never set or check it. **Work:** compute a
`canonicalId` at add (normalized series URL — strip scheme/`www`/trailing slash/tracking, or a NU id when available),
set it on create, and **check for an existing series with the same `canonicalId`** before inserting — if found, don't
create a second; surface "already tracking this" (and optionally add the new URL as an alternate source). Consumes
WP-14's pure `lib/dedup.ts`. Note the URL forms to reconcile: a **landing/home URL vs a chapter-TOC URL** for the same
series are *different* URLs — canonicalization alone won't unify them, so dedup also needs a title/known-source match
or the WP-37 TOC-URL resolution to map both to one identity. (WP-38 cleans up the dup that already exists.)

### WP-40 — Cheap CF bypass for static CF-blocked hosts (browser-fingerprint GET, not render)

**Motivation (owner testing, 2026-07-27/28):** some hosts (e.g. the dense-feed WordPress translator behind Cloudflare)
serve a **static, server-rendered TOC** but **challenge our plain `fetch` from Vercel's datacenter IP** — a
*network-access* problem, not a *rendering* one. Proven: a bare `curl` from a residential IP returns the full chapter
list (no JS needed), and `/api/render` **from Vercel** also returns it (200, real title, all chapters) — so Vercel's IP
isn't hard-blocked; only our plain bot `fetch` is challenged. Today the only bypass we have is the **headless renderer**
(WP-17b), which works but is the wrong-sized tool: Chromium is expensive and — critically — **can't do conditional GET**
(`renderFetch` sends no validators, always `notModified:false`), so every poll is a full ~5–15s render. A backlog of
such novels blows the poll budget (**WP-41**) for no reason.

**Second driver, harsher (owner testing, 2026-07-28): cf-static-source.org.** Also CF-fronted + Vercel-blocked, but with **no
usable feed** (advertises none; per-series `/feed/` 404s; site `/feed/` is empty) — so a CF-blocked page fetch can't
fall back to page-watch *or* a feed and `addSeries` **hard-throws** ("may be blocking automated requests"). The series
is **unaddable** today, not just empty. This makes WP-40 a *correctness/blocker* fix for some sites, not only an
efficiency one. (Open: whether cf-static-source is rescued by the fingerprint GET or is the harder 403 set — confirm via a
Vercel `/api/render` curl, same as chrys.)

**Work:** add a lighter fetch rung for **CF-static** hosts — a single GET with a **browser TLS/JA3 + header
fingerprint** (e.g. a `curl-impersonate` binary or an impersonation-capable HTTP client) that clears CF's bot challenge
**and supports `If-None-Match`/`If-Modified-Since` → 304**. This is a **local** fetch (request goes straight from our
server to the target, just with a browser-like handshake) — **not** a third-party unblocker/proxy, so it keeps the
**WP-17b privacy stance** (that decision declined *third-party* unblockers, not local impersonation). Wire it as a
`fetchMode`/host-policy rung between PLAIN and RENDER: CF-static hosts use it; **reserve real RENDER (Chromium) for
genuinely JS-rendered TOCs** (the tab / load-more sites — WP-31). **Must cover the add path, not just poll:** today's
render escalation is **poll-only** (`pollSource` PLAIN→RENDER at ≤5 chapters), while **`addSeries` uses the plain
`fetch` only** — so a CF-blocked host like cf-static-source **can't be added at all** (it never reaches the poll to escalate).
The bypass rung has to be reachable from `addSeries` (or `addSeries` needs a render/bypass fallback on page-fetch
failure for CF hosts). Caveat: a browser *UA alone* likely won't pass (CF keys on the TLS fingerprint), so verify the
impersonation actually clears the challenge from Vercel before relying on it. Relates to WP-17b (escalation ladder),
WP-34/WP-29 (CF-gated sites), and the harder **403 `cf-mitigated`** set (render-clearable-source/cf-blocked-source) which may still
need more than a fingerprint. **Confirmed WP-40 hosts (render works from Vercel, only plain fetch blocked):
cf-wordpress-source, cf-static-source.**

### WP-41 — Poll time-budget guard + rotation

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

- **2026-07-28** — **Added WP-40/41 + extended WP-27 (poll scale/cost, from an owner design discussion).** Working
  through the render/CF story surfaced two structural facts: **RENDER sources can't use conditional GET** (`renderFetch`
  sends no validators, always `notModified:false` → every RENDER poll is a full ~5–15s headless render), and the daily
  cron is a **sequential loop with no time budget** under the 60s ceiling — so a pile of RENDER/CF sources (e.g. many
  PLANNED cf-wordpress-source reads) blows the budget and **silently drops the tail**. Three tracked responses:
  **WP-27 extended** to status→*cadence* gating (PLANNED/backlog polled rarely/on-demand, not just skip-COMPLETED —
  motivated by the render cost); **WP-40** — a cheap, 304-capable **local browser-TLS-impersonation** GET for
  CF-**static** hosts (server-rendered but IP-challenged, like cf-wordpress-source), so they skip the uncacheable
  render, reserving Chromium for genuinely JS TOCs, and explicitly **not** a third-party unblocker (keeps the WP-17b
  privacy stance); **WP-41** — a poll time-budget guard + rotating start offset so the run degrades gracefully instead
  of starving a fixed tail. All `TODO`, "if scale bites" priority; WP-41 is also a latent-correctness safeguard. Also
  clarified in `TESTING-NOTES.local.md`: cf-wordpress-source is CF-**static** (needs bypass, not render) and the
  render path can't 304. (Real-site detail stays in that gitignored file.)
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
  `canonicalId` field). **Owner chose to do WP-36 + WP-38 before WP-35.** (Real-site detail in the gitignored
  `TESTING-NOTES.local.md`.)
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
  *correct* novel, empty, with a slug filter. 127 tests. (Page-watch escalation for still-blocked sites → WP-RC/WP-17.)
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
  ladder + density-fallback triggers) and per-WP sub-tasks for WP-05/17/20; added **WP-RC** (dense-feed
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
