# WP-37 — Per-series chapter-TOC URL (landing page ≠ chapter TOC)

**Status:** design approved 2026-07-31. Depends on WP-17 (page-watch / `parseToc`, done) and WP-33
(backfill path, done). Scope for this pass: **backend + auto-discovery** (add-time and backfill-time),
plus a **reverse-info exploration**. The polished detail-UI edit control is deferred (folds into WP-30's
manual-title-edit UI, which also extends `parseSeriesUpdate`); the existing `db:cleanup set-source-url`
remains the manual escape hatch meanwhile.

## Problem

A `Source` has one `url` (the page the user reads / the landing page) plus an optional `feedUrl`. Some
series are registered with a **landing / overview URL that has no chapter list** — the real table of
contents is a **separate linked page**. Both `backfillFromToc` and the page-watch poll fetch `source.url`
and run `parseToc` on it, so they parse a page with no chapters (or the wrong ones). Today's only fix is
manual: `db:cleanup set-source-url` to repoint the source before backfilling. WP-37 makes the TOC URL a
first-class, resolvable field.

## Design

### 1. Schema & data model

Additive migration: `Source.tocUrl String?` — nullable; `null` means "the landing page **is** the TOC,"
so consumers fall back to `url`. No backfill of existing rows: `null` is the correct default. One field,
shared with WP-34's future feed→TOC switch (not two). The reading `url` is unchanged and stays the
user-facing link.

### 2. Discovery function (pure, test-first)

`findTocUrl(html: string, baseUrl: string): string | null` in `src/lib/feeds/discover.ts`, following the
file's existing anchor-scan style (`attr` + tag iteration, as in `discoverFeeds`):

- Iterate `<a>` tags; normalize each link's text (strip tags, collapse whitespace, lowercase).
- Match against an anchored heuristic set: `table of contents`, `chapter list`, `all chapters`.
  Deliberately **not** matching bare "chapters" mid-sentence or "Chapter N" links (guarded so a
  single-chapter link is never mistaken for the TOC).
- Resolve `href` against `baseUrl` via `new URL(href, baseUrl)`. **Skip** a candidate that resolves to the
  current page (same URL ignoring fragment) or to a **different host**. Return the first survivor, else
  `null`.

**Post-review hardening (2026-07-31):** the bare `toc`/`index` tokens were dropped from the heuristic set —
a site footer/nav link literally texted "Index" or "TOC" was resolving a spurious TOC URL for feed series.
Adding nav/chrome anchor-filtering to `findTocUrl` (mirroring `parseToc`'s chrome exclusion) is a tracked
WP-32 follow-up, which would let bare tokens be reinstated safely.

Rejected alternatives: structural nav-landmark weighting (more code, marginal gain over the anchor-text
match that motivated this) and probing guessed TOC paths like `guessFeedUrls` (network-heavy, brittle,
site-specific).

### 3. When `findTocUrl` runs

Add-time and backfill-time only — **never on poll** (the poll reads the stored value and stays cheap/pure).

- **Add-time** (`addSeries`): whenever a usable page body exists (`pageOk`), on **both** the feed and
  page-watch paths (backfill benefits feed series too), compute `tocUrl = findTocUrl(page.body, url)`.
  Thread `tocUrl: string | null` through `ResolvedCore` / `ResolvedSource`; `createSeries` persists it.
  Cost: one pure call, no extra fetch.
- **Backfill-time self-heal** (`backfillFromToc`): when `source.tocUrl` is null (e.g. a series added before
  this feature, or whose landing page only later linked a TOC), fetch `source.url` as today, then run
  `findTocUrl` on that body. If it finds a TOC link, **follow it one hop** (fetch the TOC page, `parseToc`
  that body against the TOC URL) **and persist `tocUrl`** in the same transaction, so every future
  backfill/poll goes straight there. If no link is found, the landing page *is* the TOC (or an oddball) —
  proceed exactly as today against `source.url`. This repairs already-added series with no manual
  `set-source-url`.
- **Poll:** never calls `findTocUrl`; it reads the stored `tocUrl ?? url` (see §4).

### 4. Consumers

- **Backfill** (`index.ts` `backfillFromToc`): the fetch target becomes `source.tocUrl ?? source.url`
  (with the §3 discover-and-follow when `tocUrl` is null), and the same URL is passed to
  `parseToc(body, <that url>)` so relative hrefs resolve against the TOC page.
- **Page-watch poll** (`index.ts` `rowToPollable`): the `fetchUrl` derivation changes from
  `row.feedUrl ?? row.url` to `row.feedUrl ?? row.tocUrl ?? row.url`. A FEED source keeps hitting its feed;
  a PAGE_WATCH source (feedUrl null) now hits `tocUrl ?? url`. `poll.ts` core is unchanged — it already
  fetches `fetchUrl` and parses against it.

### 5. Reverse-info exploration ("this problem in reverse")

Splitting chapters onto `tocUrl` raises: is a **standalone TOC page** a complete source of the *other*
series info, or does the split cost metadata that lived on the landing page? The series carries a **title**
(WP-30's concern), the user-facing **reading url** (stays = landing `url`), and **chapters** (= TOC).

**Deliverable — a findings note (in this spec's follow-up + a scratchpad probe against the real TOC URLs in
the gitignored local testing notes), not code**, answering:

- Does a standalone TOC page reliably carry the real series **title** (`<h1>` / `og:title` / `<title>` minus
  a trailing `" | Site"` / `" – Site"` suffix)?
- Does pointing backfill/page-watch at the TOC page **lose** anything the landing page gave?
- Is there info only the landing page has (cover, description) worth continuing to fetch `url` for?

**Why exploration, not code:** title-from-TOC is explicitly WP-30, and cover/description aren't in the data
model. Output is a documented recommendation feeding WP-30 / WP-39b (e.g. "the TOC `<h1>` is the clean
title; the landing page adds nothing we model, so keep `url` only as the reader link"). No new extraction
code ships in WP-37 unless the probe surprises us.

## Testing & verification

- **Unit (pure, TDD)** — `findTocUrl`: finds a "table of contents" anchor; case/whitespace tolerant; ignores
  same-page self-links, cross-host links, and bare "Chapter N" links; resolves relative hrefs; returns
  `null` when the landing page *is* the TOC (no regression).
- **Integration** — `backfillFromToc` fetches `tocUrl` when set (not `url`); the null-`tocUrl` self-heal
  discovers, follows one hop, and persists `tocUrl`; page-watch `fetchUrl` resolves `feedUrl ?? tocUrl ?? url`.
  Uses the existing injected-port test style.
- **Gates** — `npm test` + `npm run typecheck` green before any done claim (agreement #3). Prisma migration
  applied against the live Neon dev DB.

## Definition of Done

A series whose landing page ≠ its TOC can be added and then backfilled/polled against the **correct**
chapter list **without** a manual `set-source-url`: `tocUrl` is auto-resolved at add when the TOC link is
discoverable, self-heals at backfill for pre-existing series, and consumers use `tocUrl ?? url`. Additive
migration applied; TOC-link discovery unit-tested (pure); backfill-uses-`tocUrl` (incl. the self-heal)
covered by integration tests; the reverse-info exploration is written up with a recommendation for WP-30.

## Out of scope (deferred)

- Detail-UI TOC-URL edit control + `parseSeriesUpdate` extension → folds into WP-30's manual-title-edit UI.
- Title/cover extraction from the TOC page → WP-30.
- Page-watch home-vs-TOC dedup keyed on the shared TOC URL → WP-39b(a) (this WP supplies the `tocUrl`
  identity it will key on).

## Findings (reverse-info exploration)

Probed the one clear landing≠TOC case available in local test notes: **a dense-feed WordPress source**
where the series has a landing/overview page (no chapter list) and a separately-linked real chapter TOC
page (the same pairing behind the WP-33/WP-36 backfill fix). Fetched both pages with a realistic browser
`User-Agent` (throwaway probe, session scratchpad only — not committed) and inspected `<title>`, `og:title`,
first `<h1>`, and the WordPress `entry-title` `<h1>` specifically.

**Raw results:**

| Signal | Landing page | TOC page |
|---|---|---|
| `<title>` (minus `" – Site"` suffix) | the real series title | an abbreviated slug + generic "Table of Contents" label — **not** the series title |
| `og:title` | absent | absent |
| Naive "first `<h1>` on the page" | site name (theme's site-title landmark, `#site-title`) | site name (same landmark) |
| `entry-title` `<h1>` (the actual post heading) | the real series title | same abbreviated-slug + "Table of Contents" label as the `<title>` |
| Cover image | present (a dedicated series cover image) | absent (only sitewide logo/merch/community-link images) |
| Meta description | absent | absent |

**(a) Does a standalone TOC page reliably carry the real series title?** **No — not on this source.** The
TOC page's own title (`<title>`/`entry-title` `<h1>`, after suffix-stripping) is an abbreviated form of the
series slug glued to a generic "Table of Contents" label, not the series name; the site names the TOC page
after itself rather than reusing the real title. A naive "grab the first `<h1>`" heuristic makes this worse:
on this WordPress theme the *first* `<h1>` in DOM order is the site's own site-title landmark, not the entry
heading, on **both** pages — so the naive signal is doubly wrong before even reaching the TOC-vs-landing
question. Only the landing page's `entry-title` `<h1>` (or its suffix-stripped `<title>`) gives the real
series name here. `og:title` is no help either — this source has no Open Graph tags on any page. This
generalizes the existing WP-32 (a concatenated-title custom source) and WP-35 lesson (don't trust a page's
surface text naively; scope to the right DOM element) to title extraction specifically.

**(b) Does pointing backfill/page-watch at the TOC page lose anything the landing page gave?** **Yes, for
this source: the series title and the cover image.** Chapters themselves are not lost (that's the entire
point of WP-37 — the TOC page is the *only* correct chapter source here). But if a future feature ever
derived title or cover from whatever page backfill/poll happens to be pointed at, switching that pointer to
`tocUrl` would silently start reading the wrong title (or none) from this source. WP-37's design already
keeps `url` as the untouched reading link for exactly this reason; this exploration confirms that decision
was necessary, not just conservative.

**(c) Is there landing-only info worth continuing to fetch `url` for?** **Yes — cover art**, confirmed
present on the landing page and absent on the TOC page for this source. Description is a wash here (neither
page has a meta description; the landing page's body text is a release-schedule blurb, not series-blurb
copy) — not strong evidence either way for description specifically, but the cover-image result alone is
enough to keep `url` fetchable for metadata, independent of `tocUrl`.

**Caveat:** local test notes contain exactly one clear landing≠TOC pairing (this source); other
landing≠TOC-shaped entries in the notes (e.g. a split-TOC-across-sibling-pages source, a JS-rendered
SPA-backed-by-static-JSON source) are TOC-vs-TOC or TOC-vs-metadata-JSON splits, not landing-vs-TOC, so they
don't bear on questions (a)–(c) the same way and were not probed for this exploration. The finding above
should be treated as "confirmed on one real source, not yet a general law" — worth a second data point before
leaning on it hard in WP-30.

**Recommendation for WP-30:** don't default to "TOC page title" as a source of truth — extracting a
series title needs to target the landing page's real content heading (not a naive first-`<h1>`, and not
`og:title`, which may not exist), with the TOC page only as a fallback when there's no separate landing page
(`tocUrl === null`) to defer to.
