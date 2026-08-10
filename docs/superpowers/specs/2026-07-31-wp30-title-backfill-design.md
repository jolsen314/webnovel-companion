# WP-30 — Series title backfill (backend core)

**Status:** design approved 2026-07-31. Depends on WP-17 (page-watch / `parseToc`, done), WP-10 (detail UI,
done), and builds on WP-37 (per-series `tocUrl`, done). **Scope for this pass: the backend title-backfill
core.** The frontend manual title-edit control (detail-UI input + PATCH `/api/series/[id]` via
`parseSeriesUpdate`) is a **deferred follow-up sub-project** with its own spec — but the `titleIsManual`
flag it needs ships here so backfill never clobbers a future hand-fix.

## Problem

Series show wrong titles from two add-time causes:
1. **Acronym / URL slug.** The multi-novel add-time fallback derives the title from the URL slug
   (`titleFromUrl`), yielding an acronym, not the human title.
2. **Feed channel `<title>` = the site name.** A successful add off a per-series feed adopts the feed's
   channel `<title>` (WHOLE_FEED path), but on some sources that channel title is the *site* name, not the
   series. The real name sat in the page `<h1>` / `og:title` / `<title>`.

The real title lives on the **landing/reading page** (`source.url`). WP-37's reverse-info probe confirmed
this and, importantly, found the *opposite* on a split landing≠TOC site: the standalone **TOC** page's
`<h1>` was a slug-abbreviation while the **landing** page carried the real title (and the cover). So the
title source is the landing page, with the TOC page only as a fallback.

## Design

### 1. Pure title extraction — `src/lib/feeds/title.ts` (new, test-first)

`extractSeriesTitle(html: string, opts?: { siteName?: string }): string | null` — pure, no I/O.
Precedence, first non-empty wins:

1. **`<h1>`** — typically the clean title with no site suffix (preferred precisely because it sidesteps the
   suffix problem).
2. **`og:title`** meta content.
3. **`<title>`**.

For signals 2–3, strip a trailing **site-name suffix** conservatively, to avoid eating a legitimate dash in
a title (e.g. "Volume 1 – Dawn"):

- Separators handled: pipe `|` (U+007C), hyphen-minus `-` (U+002D), en-dash `–` (U+2013), em-dash `—`
  (U+2014) — three lookalike dashes plus the pipe, one character class `[|\-–—]`.
- Strip a trailing `" <sep> X"` segment **only when `X` matches the known site name** (`opts.siteName`,
  compared loosely — case-insensitive, ignoring a leading `www.`, a TLD, and non-alphanumerics, so
  "verdantscrolls.example" ≈ "Verdant Scrolls").
- If no `siteName` is known: strip a trailing `" | X"` (a pipe is almost always a site separator) but leave
  dash-suffixes intact (a dash is too often part of a real title to strip blind).

Returns `null` when nothing usable is found (JS-rendered / empty heading) → the caller keeps the existing
title. `parseToc` stays chapters-only; title extraction is its own single-responsibility unit.

### 2. Schema — auto-vs-manual title flag

Additive migration: `Series.titleIsManual Boolean @default(false)`. Auto-backfill overwrites the stored
title **only when `titleIsManual === false`**. The deferred manual-edit UI will set it `true` so backfill
never clobbers a hand-fixed title. A boolean, not an enum — exactly two states, no third on the horizon
(YAGNI). The flag lands now so the backfill logic is correct from day one and the column exists when the UI
arrives.

### 3. Add-time integration — `addSeries`

Both fixes use `extractSeriesTitle` on the landing page body `addSeries` already fetches (no extra fetch):

1. **Prefer the real page title.** Stored-title precedence becomes: **`input.title`** (user-supplied) →
   **`extractSeriesTitle(page.body, { siteName: host })`** → the existing per-path fallback (`parsed.title`
   for WHOLE_FEED, the CATEGORY value, or `titleFromUrl`). A good page `<h1>` now wins over both a
   site-name channel title and a URL slug.
2. **Guard the channel-title-is-site-name case.** Even when the page heading is absent, do **not** adopt a
   `parsed.title` that equals the host/site name (loose match, same comparison as the suffix rule) — fall
   through to `titleFromUrl(url)` instead.

`titleIsManual` stays `false` at add (auto-derived). Fixes new adds immediately; existing bad-title series
are repaired by §4.

### 4. Backfill integration — `backfillFromToc`

A silent title-repair step, landing-page-primary, with fetch ordering that keeps the common case free:

- Fetch `tocUrl ?? url` → `res`.
- **If `source.tocUrl == null` (self-heal path):** this `res` **is** the landing page. Capture
  `landingBody = res.body` **before** the `findTocUrl`/follow step reassigns `res` to the TOC body. Title
  comes from `landingBody` — **zero extra fetch**.
- **If `tocUrl` is already set:** `res` is the TOC body, no landing body in hand → do **one extra fetch of
  `source.url`** for the title (backfill is a manual, infrequent action — the cost is fine), falling back to
  the TOC body (`res.body`) if that fetch fails.
- Extract via `extractSeriesTitle(<landing body, else extra-fetch body, else TOC body>, { siteName: host })`.
  Update `Series.title` **only if** `titleIsManual === false` **and** the extracted title is non-empty
  **and** it differs from the stored title — persisted in the **same transaction** as the chapter writes.
  Silent (no push — metadata learning, like `accessReconciled`).
- Extend the return to surface the change, e.g. `{ added, reconciled, titleUpdated?: string }`, so the
  route/UI can reflect it.

**Poll is deliberately not touched** — it fetches `tocUrl` and stays cheap; titles change rarely, and
add-time + the explicit backfill action cover the real cases.

## Testing & verification

- **Unit (pure, TDD)** — `extractSeriesTitle`: `<h1>` wins over og/title; og:title and `<title>` fallbacks;
  host-matched suffix strip across `|`/`-`/`–`/`—`; a legit dash-in-title is **not** stripped when the tail
  doesn't match the site name; bare-pipe strip when no `siteName` given; `null` on no usable heading;
  loose site-name match ("verdantscrolls.example" ≈ "Verdant Scrolls").
- **Integration** — add-time: a feed whose channel title equals the site name adopts the page `<h1>`
  instead; a good `<h1>` beats a URL slug. Backfill: a non-manual bad title is repaired from the landing
  body on the self-heal path (assert no extra landing fetch occurred); `titleIsManual === true` is left
  untouched; the `tocUrl`-already-set path does the extra landing fetch and repairs from it.
- **Gates** — `npm test` + `npm run typecheck` green before any done claim (agreement #3). Additive Prisma
  migration applied (local `webnovel_dev`; prod Neon on next deploy via `vercel-build`).

## Definition of Done

A newly added series gets its real title from the page heading (not a site-name channel title or a URL
slug); an existing bad-title series is repaired to the real title by a "Backfill from TOC" run, sourced from
the landing page with a TOC fallback, **without** overwriting a title flagged manual. `Series.titleIsManual`
column added (additive migration); `extractSeriesTitle` unit-tested (pure); add-time title-preference and
backfill title-repair (both self-heal-free-fetch and tocUrl-set-extra-fetch paths) covered by integration
tests.

## Out of scope (deferred)

- **Manual title-edit UI** (detail-UI input + PATCH `/api/series/[id]` extending `parseSeriesUpdate` to
  accept `title`, setting `titleIsManual = true`) → its own follow-up sub-project. The flag ships here.
- Cover/description extraction from the landing page → not in the data model yet (own WP if wanted).
- Title backfill during the page-watch poll → intentionally excluded (poll stays cheap; add-time + backfill
  action suffice).
