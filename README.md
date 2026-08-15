# Webnovel Companion

Track the webnovels you read across sites, get a push notification when a tracked series releases a new chapter, and — as it grows — turn the words you look up while reading into spaced-repetition flashcards. Built as an installable PWA with a companion browser extension.

> Status: early development. MVP = library + release feeds + push notifications.

---

## Why

Nothing tracks translated CN/KR/JP webnovels well across the many sites they live on, and aggregators sometimes point at the wrong/outdated translator. This is the tool I wished existed: one library, one notification stream, and eventually a reading-driven vocabulary trainer.

---

## Features

**Now (MVP)**
- Add a series and track it in one library
- Automatic new-chapter detection via each series' release feed
- Web Push notification when a tracked series updates
- Manual reading-progress marker + unread counts

**Roadmap** (see [Roadmap](#roadmap) for detail)
- Feed auto-discovery for arbitrary translator sites, with a page-watch fallback for feedless sites
- Completed shelf with per-series status, star rating, and notes; backfill already-read novels
- "Move to Completed?" suggestion when a finished series is fully read
- Search + filters, and a "you've already read this" check when adding a series
- Browser extension for automatic progress capture
- Vocabulary mining + SM-2 spaced repetition (Chinese first, then Korean)

---

## Architecture

Two independent tracks that meet at your account:

1. **Releases (what's new):** each series has a *source*. A source is either a **feed** (RSS/Atom) or a **watched page** (a TOC we diff when no feed exists). A scheduled job polls sources, diffs against stored chapters, and pushes on new ones.
2. **Progress (where you are):** a manual marker in the MVP; the browser extension automates it later by reading the current chapter on known sites.

**Release sources (validated, not assumed):**
- **NovelUpdates** — the canonical release tracker for translated CN/KR/JP novels; exposes **per-series release RSS**, and aggregates across translation groups. This is the primary source.
- **Royal Road / ScribbleHub** — per-fiction RSS feeds for originals and English web serials.
- **The gap this fills:** *list-level* "all my follows in one feed" RSS is inconsistent across sites and frequently-requested-but-missing — which is exactly the value here. Build on the reliable **per-series** feeds and provide the aggregation (one library, one notification stream) ourselves.

**Source resolution** when you add a URL: try feed auto-discovery (`<link rel="alternate">` tags, then common paths like `/feed/`); if none is found, offer page-watch mode. Push works identically regardless of source type. In practice many feeds are **site-wide and multi-novel**, so on add we also capture how to isolate this series (`matchType`/`matchValue` — per-novel `<category>`, else a URL-path prefix), and prefer a per-series/category feed over filtering a capped site feed (a slow series can otherwise fall off the feed window). Some hosts sit behind Cloudflare and may block automated page loads while still serving `/feed/`; discovery and page-watch use realistic headers and, where needed, a headless browser.

**Advance/paid chapters:** on sites that release chapters as paid first and free later, the same poll-and-diff engine tracks a second dimension — each chapter's free/locked state, usually collapsed to a single "free frontier" (the highest unlocked chapter) read off the TOC's lock markers. When the frontier advances, it fires a distinct **"now free"** notification, separate from "new chapter." Sites that gate advance chapters on Patreon/another platform need nothing extra (their public site only ever shows free chapters); same-site coin/membership gating needs a small per-site adapter in the page-watch tier; closed platforms (e.g. Webnovel.com) are best-effort/out of scope.

**Plan-to-read completion watch:** for a PLANNED series whose raw is complete, store a `targetChapterCount` (from NovelUpdates or entered manually) and watch the translation's progress. Fire a single **"translation likely complete — ready to binge"** notification when the source/NU marks the *translation* status COMPLETE (reliable), or the translated count reaches ~the target and releases have stalled (heuristic — "likely," since translators split/merge chapters so counts rarely match exactly; the numbers are shown so you can judge). Plan-to-read items use a **different notification policy** than active reads: no per-chapter pings (you're not reading them yet), just the one completion alert.

**Source health & migration:** each `Source` is monitored across polls. Single failures are ignored (transient); a source escalates HEALTHY → DEGRADED → LIKELY_DOWN based on *consecutive* failures weighted by type — a DNS/NXDOMAIN failure or a domain-parking page counts far more than a timeout or 5xx. Because you track many series, **health aggregates by host**: if *every* series on a domain fails at once, the site is down; if one series 404s while others on the same host are fine, that novel was removed/moved. Crossing LIKELY_DOWN fires a "source may be down" notification. The dead URL stays visible with a "find new source" helper (a title/translator search), and re-pointing to a translator's new site is a non-destructive edit — add a new `Source`, flip `isActive`; progress, notes, and rating live on the `Series` and are preserved. (Chapter numbering can differ across translations, so re-pointing offers a manual current-chapter reconcile.)

**Language layer (later):** Chinese tokenization runs in-process (`Intl.Segmenter` / `jieba-wasm`, CC-CEDICT). Korean needs morphological lemmatization, which doesn't fit serverless, so it calls a small **Python NLP sidecar** (kiwipiepy/mecab-ko) — the one place the app steps outside TypeScript.

---

## Repo structure

```
webnovel-companion/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── public/
│   ├── manifest.webmanifest        # PWA manifest
│   └── icons/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── page.tsx                # library (reading)
│   │   ├── completed/page.tsx      # completed shelf
│   │   ├── series/[id]/page.tsx    # series detail (status, rating, notes, progress)
│   │   └── api/
│   │       ├── series/route.ts             # list / add (with dedup check)
│   │       ├── series/[id]/route.ts        # update status/rating/notes/progress
│   │       ├── feeds/discover/route.ts     # feed auto-discovery from a URL
│   │       ├── search/route.ts             # search + filter
│   │       ├── push/subscribe/route.ts     # store Web Push subscription
│   │       └── cron/poll/route.ts          # Vercel Cron target: poll → diff → push
│   ├── lib/                        # framework-agnostic + unit-tested (no Next imports)
│   │   ├── feeds/
│   │   │   ├── discover.ts         # find a feed from a page
│   │   │   ├── parse.ts            # rss-parser wrapper
│   │   │   ├── diff.ts             # new-chapter diffing (pure) ← write test-first
│   │   │   └── pageWatch.ts        # TOC-diff fallback for feedless sites
│   │   ├── srs/sm2.ts              # SM-2 scheduler (pure) ← write test-first
│   │   ├── tokenize/{zh.ts,ko.ts}  # zh in-process; ko calls the sidecar
│   │   ├── dict/cedict.ts          # CC-CEDICT lookup
│   │   ├── completion.ts           # "looks finished?" heuristic (pure)
│   │   ├── dedup.ts                # canonical-id match for "already read this?"
│   │   ├── health.ts               # source-health state machine (pure) ← write test-first
│   │   └── search.ts               # filter/query building (pure)
│   ├── server/
│   │   ├── db.ts                   # Prisma client singleton
│   │   ├── push.ts                 # web-push send
│   │   └── services/               # orchestration: pollAllSources(), addSeries()...
│   ├── components/                 # React UI
│   └── sw.ts                       # service worker: push + offline shell
├── tests/
│   ├── unit/                       # sm2, diff, completion, dedup, search, tokenize
│   └── integration/                # api routes against a test Postgres
├── extension/                      # (later) MV3 extension for progress capture
├── services/korean-nlp/            # (later) Python FastAPI + kiwipiepy sidecar
├── vitest.config.ts                # projects: unit (fast) + integration (serialized)
├── playwright.config.ts            # (later) E2E
└── .env.example
```

Design rule: keep the interesting logic (`lib/`) pure and Next-free so it unit-tests without any framework or browser harness. Route handlers stay thin and call `server/services`.

---

## Data model (Prisma sketch)

```prisma
enum SeriesStatus { READING COMPLETED PAUSED DROPPED PLANNED }
enum SourceType   { FEED PAGE_WATCH }
enum SourceMatch   { WHOLE_FEED CATEGORY PATH_PREFIX }   // how to isolate one series within a multi-novel feed
enum Language      { ZH KO JA EN OTHER }
enum AccessState   { FREE LOCKED UNKNOWN }   // for advance/paid-then-free chapters
enum SourceHealth  { HEALTHY DEGRADED LIKELY_DOWN }
enum FailureType   { NONE DNS TIMEOUT HTTP_4XX HTTP_5XX PARKED TLS }
enum TranslationStatus { ONGOING STALLED COMPLETE UNKNOWN }   // for plan-to-read completion watch

model Series {
  id           String        @id @default(cuid())
  userId       String
  title        String
  canonicalId  String?                        // NU id / normalized URL — dedup key
  language     Language      @default(OTHER)
  status       SeriesStatus  @default(READING)
  rating       Int?                           // 1–5, for the completed shelf
  notes        String?                        // your freeform notes
  tags         String[]                       // for filtering
  coverUrl     String?
  finishedAt   DateTime?
  targetChapterCount Int?                      // raw/native total (NU or manual) — plan-to-read completion watch
  translationStatus  TranslationStatus @default(UNKNOWN)
  sources      Source[]                       // current + past sources (survives translator moves)
  chapters     Chapter[]
  progress     ReadingProgress?
}

model Source {
  id                  String       @id @default(cuid())
  seriesId            String
  url                 String                      // page you read on — kept visible even if down
  host                String                      // domain, for site-level health aggregation
  type                SourceType   @default(FEED)
  feedUrl             String?
  matchType           SourceMatch  @default(WHOLE_FEED) // a feedUrl can be site-wide/multi-novel...
  matchValue          String?                      // ...CATEGORY → category name; PATH_PREFIX → url-path prefix
  isActive            Boolean      @default(true) // re-pointing = add a new source, flip active
  health              SourceHealth @default(HEALTHY)
  consecutiveFailures Int          @default(0)
  lastFailureType     FailureType  @default(NONE)
  lastCheckedAt       DateTime?
  lastSuccessAt       DateTime?
  etag                String?                     // polite conditional GET
  lastModified        String?
}

model Chapter {
  id           String   @id @default(cuid())
  seriesId     String
  title        String
  number       Float?
  url          String
  publishedAt  DateTime?
  discoveredAt DateTime @default(now())
  access       AccessState @default(UNKNOWN) // FREE/LOCKED for advance-chapter sites
  becameFreeAt DateTime?                     // set when a locked chapter unlocks
}

model ReadingProgress {
  userId           String
  seriesId         String   @unique
  lastReadChapterId String?
  updatedAt        DateTime @updatedAt
}

model PushSubscription {
  id       String @id @default(cuid())
  userId   String
  endpoint String @unique
  p256dh   String
  auth     String
}

// --- vocab layer (later) ---
model VocabCard {
  id             String   @id @default(cuid())
  userId         String
  term           String
  reading        String?                       // pinyin / romanization
  definition     String
  language       Language
  sourceSentence String
  sourceChapterId String?
  intervalDays   Int      @default(0)          // SM-2 state
  easeFactor     Float    @default(2.5)
  repetitions    Int      @default(0)
  dueAt          DateTime
  lastReviewedAt DateTime?
}
```

---

## Tech stack

- **Next.js (App Router) + TypeScript (strict)** — PWA frontend + API
- **Tailwind** — styling
- **Postgres + Prisma** — data + migrations
- **web-push (VAPID)** — server-side push
- **rss-parser** — feed parsing (with conditional GET)
- **Vercel + Vercel Cron** — hosting + the periodic poll job
- **Vitest** (unit + integration) **+ Playwright** (E2E — gate-off `next dev`, `e2e/`)
- **Python + FastAPI + kiwipiepy** — Korean NLP sidecar (later)

---

## Getting started

```bash
cp .env.example .env            # set DATABASE_URL, VAPID keys
npm install
npx prisma migrate dev          # create the schema
npm run dev                     # http://localhost:3000
npm test                        # unit tests (Vitest)
```

Generate VAPID keys once with `npx web-push generate-vapid-keys` and put them in `.env`.

---

## Testing

- **Unit** (`tests/unit`): the pure logic — `sm2` scheduling, feed `diff`, `completion` heuristic, `dedup`, `search`. Test properties, not hard-coded snapshots (e.g. diff detects new items with no duplicates; SM-2 advances due dates and clamps ease).
- **Integration** (`tests/integration`): API routes against a real test Postgres, run as a serialized Vitest project so DB state doesn't race.
- **E2E** (`e2e/`, Playwright — `npm run test:e2e`): drives the real UI against a dedicated `webnovel_e2e` DB, with the auth gate off (`next dev`, no `AUTH_SECRET`). Covers delete (detail + shelf), title edit, library/detail controls + chapter links, and the source-action buttons (network stubbed). See [e2e/README.md](e2e/README.md). CI-enforced. *(Future: push/vocab flows.)*

---

## Deployment

Deploy to Vercel against a hosted Postgres:

1. **Provision Postgres** (Neon, Vercel Postgres, or Supabase — any plain Postgres) and copy its connection string.
2. **Import the repo into Vercel.** Set env vars: `DATABASE_URL`, `CRON_SECRET` (a random string — Vercel Cron sends it as a Bearer token the `/api/cron/poll` route checks), and later the `VAPID_*` keys for push.
3. **Migrations run on deploy** via the `vercel-build` script (`prisma migrate deploy && next build`); `postinstall` runs `prisma generate`.
4. **Cron** is configured in [`vercel.json`](vercel.json): `/api/cron/poll` runs **once a day** (08:00 UTC) — a daily digest of new chapters, which fits the Hobby plan.
5. **Install as a PWA.** On iOS, Web Push requires Add-to-Home-Screen (iOS 16.4+).

**CI** (GitHub Actions) runs typecheck, unit tests, `next build`, and — in a separate job with a Postgres service — the integration tests (`prisma migrate deploy` + `npm run test:integration`).

Local integration tests: start Postgres, then `DATABASE_URL="postgresql://…/webnovel_test" npm run test:integration` (the DB name must contain `test`).

---

## Design notes & etiquette

Track and link — never rehost chapter content. Prefer feeds; use conditional requests (`ETag`/`If-Modified-Since`), honor `304`, respect `robots.txt` and rate limits, and back off on errors. Page-watch mode is a scoped fallback (one TOC page per series), not a crawler.

**Legal posture & scope.** Fan translations of unlicensed web novels are unauthorized derivative works, and public aggregators that link to them (e.g. NovelUpdates) manage real facilitator/takedown exposure — which is why such sites pull direct links, delist licensed titles, and honor DMCA requests. This app is scoped to **personal, single-user** use: it links to sites you already visit and hosts/redistributes nothing, a fundamentally lower-risk profile. Keep it that way — link-don't-host, feeds over scraping. **Going public or multi-user would change the calculus** (you'd become an aggregator: get real IP counsel first, add a takedown process, and don't link officially-licensed titles). The source-down + re-pointing features exist partly because licensing takedowns and site deaths are a normal part of this space. (Not legal advice.)

---

## Prior art & differentiation

The pieces exist separately, which validates each of them: **NovelUpdates** and various reader extensions already do release tracking; **Yomitan** (formerly Yomichan) + **Anki** already do dictionary lookup and card export (strongest for Japanese). The differentiation here is the **integration** — one app that tracks your cross-site reading *and* turns that same reading into vocabulary practice, tuned for translated CN/KR/JP webnovels, on your phone. Nothing stitches those two halves together today.

---

## Roadmap

**Tier 0 — MVP:** library, feed polling + diff, Web Push, manual progress.

**Tier 1 — Sources & shelves:**
- Feed **auto-discovery** from any URL; **page-watch** fallback for feedless translator sites (fixes "NU tracks the wrong translator")
- **Completed shelf**: status, star rating, notes; **backfill** already-read novels (manual add, no feed needed)
- **"Move to Completed?"** suggestion when a source-flagged-complete series is fully read (confirmation, not silent auto-move)
- **Search + filters** (status, language, tags, rating) and a **"you've already read this"** dedup check on add (canonical-id match; fuzzy title as a soft hint)
- **Paid→free unlock tracking**: for advance-chapter sites, track each chapter's free/locked state (via a "free frontier" read off the TOC) and notify when chapters unlock — a distinct event from "new chapter." Patreon-model sites need nothing extra; same-site gating needs a per-site adapter (page-watch tier); closed platforms are best-effort
- **Source-down detection**: per-source health with hysteresis (ignore transient blips; flag on sustained or strong failures like NXDOMAIN or a parking page); host-level aggregation to tell "site down" from "this novel removed"; a distinct "source may be down" alert
- **Non-destructive re-pointing**: dead links stay visible with a "find new source" helper (title/translator search on NovelUpdates or the web); switching a series to a translator's new site is one edit that preserves progress, notes, and rating, with a manual current-chapter reconcile for numbering differences
- **Plan-to-read completion watch**: for planned novels whose raw is finished, track the translation toward a target chapter count (NovelUpdates or manual) and send one "likely fully translated — ready to binge" alert (translation-status-COMPLETE when available; a near-target + stalled heuristic otherwise). Plan-to-read gets a single completion ping, not per-chapter noise

**Tier 2 — Progress automation:** MV3 browser extension captures current chapter on known sites; one-click "track this series."

**Tier 3 — Vocabulary + SRS:**
- **Chinese first** (in-process): `Intl.Segmenter` → `jieba-wasm`, CC-CEDICT, pinyin; tap a word → SM-2 card with sentence context
- **Then Korean**: Python NLP sidecar (kiwipiepy/mecab-ko) for lemmatization; kengdic/KRDICT data
- Known-word tracking, comprehension % per chapter, reading streaks

**Tier 4 — Extras:** TTS, offline chapter caching, export cards to Anki (`.apkg`), multi-user.
