# Plan — Webnovel Companion

Living plan + progress tracker. The **[README](README.md) is the design doc** (what & why); this file is the
**build doc** (in what order, split into pieces, and how far along); **[CLAUDE.md](CLAUDE.md) is the operating
manual** (working agreements + which skill/plugin to use when). If README and this file ever conflict, the README
wins on design, this file wins on sequencing.

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

> **NEXT:** [WP-00 Bootstrap](#wp-00--repo-bootstrap-test-harness) → then the three pure functions in parallel:
> [WP-01 diff](#wp-01--libfeedsdiffts-pure-test-first), [WP-02 sm2](#wp-02--libsrssm2ts-pure-test-first),
> [WP-03 health](#wp-03--libhealthts-pure-test-first).

The three pure, test-first functions are the queued immediate action. They need a minimal Vitest harness to run,
so **WP-00 is a thin bootstrap** (package.json + tsconfig + vitest config + folder skeleton — *no* Next.js, no
Prisma, no UI). Once WP-00 is green, WP-01/02/03 are independent and can be done in any order or by separate
sessions.

---

## Milestones

Mirrors the README [Roadmap](README.md#roadmap) tiers, expressed as shippable milestones.

- **M0 — Tested core + MVP** (Tier 0): the pure engines (diff/sm2/health) under test, then library + feed polling +
  Web Push + manual progress, deployed as an installable PWA.
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
| ⭐ WP-02 | `lib/srs/sm2.ts` (pure, test-first) | M0 | `NEXT` | WP-00 |
| ⭐ WP-03 | `lib/health.ts` (pure, test-first) | M0 | `NEXT` | WP-00 |
| ⏸ WP-04 | Prisma schema + migration + db client | M0 | `TODO` | WP-00 |
| WP-05 | Feed parse + auto-discovery (`lib/feeds/{parse,discover}.ts`) | M0 | `TODO` | WP-00 |
| WP-06 | Next.js + Tailwind + PWA shell (manifest + service worker) | M0 | `TODO` | WP-00 |
| WP-07 | Services: `pollAllSources()`, `addSeries()` | M0 | `TODO` | WP-01, WP-04, WP-05 |
| WP-08 | API routes (series CRUD, push/subscribe, cron/poll) | M0 | `TODO` | WP-06, WP-07 |
| WP-09 | Web Push end-to-end (VAPID, sw handler, subscribe flow) | M0 | `TODO` | WP-06, WP-08 |
| WP-10 | Library + series-detail UI (unread counts, mark progress) | M0 | `TODO` | WP-06, WP-08 |
| WP-11 | Deploy to Vercel + Cron + PWA install verification | M0 | `TODO` | WP-08, WP-09, WP-10 |
| WP-13 | `lib/completion.ts` (pure) — plan-to-read heuristic | M1 | `TODO` | WP-00 |
| WP-14 | `lib/dedup.ts` (pure) — "already read this?" | M1 | `TODO` | WP-00 |
| WP-15 | `lib/search.ts` (pure) — filter/query building | M1 | `TODO` | WP-00 |
| WP-16 | Host-level health aggregation (site-down vs novel-moved) | M1 | `TODO` | WP-03, WP-07 |
| WP-17 | Page-watch fallback (`lib/feeds/pageWatch.ts`) | M1 | `TODO` | WP-01, WP-05 |
| WP-18 | Completed shelf + backfill + "Move to Completed?" | M1 | `TODO` | WP-10 |
| WP-19 | Non-destructive re-pointing + "find new source" helper | M1 | `TODO` | WP-16, WP-18 |
| WP-20 | Paid→free frontier tracking + "now free" notification | M1 | `TODO` | WP-07, WP-17 |
| WP-21 | Plan-to-read completion watch (wire WP-13 + notify) | M1 | `TODO` | WP-13, WP-07 |
| WP-22 | MV3 browser extension (progress capture + "track this") | M2 | `TODO` | WP-08 |
| WP-23 | Chinese mining: `tokenize/zh.ts` + `dict/cedict.ts` | M3 | `TODO` | WP-04 |
| WP-24 | Vocab capture + SM-2 review UI (wire WP-02) | M3 | `TODO` | WP-02, WP-23 |
| WP-25 | Korean sidecar (`services/korean-nlp`) + `tokenize/ko.ts` | M3 | `TODO` | WP-23, WP-24 |
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

### ⏸ WP-04 — Prisma schema + migration + db client (PAUSE FIRST)

**⏸ Pause before starting:** per owner, stop and select good database skills before writing any schema/migrations.
Evaluate at that point — candidates to weigh: `mattpocock-skills:domain-modeling` (model vocabulary/invariants),
`ai-toolkit:database-patterns` and `ai-toolkit:spartan:migration` (note: several ai-toolkit DB skills are
Kotlin/Exposed- or company-rule-flavored — confirm fit for **Prisma + Postgres** before following them). Don't
auto-proceed from WP-03/WP-GH into WP-04.

Deliverables (once unpaused): `prisma/schema.prisma` matching the README data model, an initial migration, and the
`server/db.ts` Prisma client singleton.

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

### WP-02 — `lib/srs/sm2.ts` (pure, test-first)

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

## Backlog / open questions

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
