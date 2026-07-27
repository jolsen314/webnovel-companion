# WP-36 + WP-38 — TOC content scoping + contaminated-series recovery

**Date:** 2026-07-27
**Status:** Design accepted (brainstorm).
**Depends on / reuses:** WP-17 (`parseToc`, `SiteTocConfig`), WP-33 (`backfillFromToc`, `mergeFeedAndToc`, `diffChapters`/`canonicalUrl`).
**Priority:** ahead of WP-35 (owner's call) — the WP-33 backfill button is actively producing bad data.

## Problem

Production test of the WP-33 "Backfill from TOC" button added **phantom cross-series chapters** to a real series. On a
dense-feed WordPress site, `parseToc` scans *every* chapter-ish `<a>` on the page, **including a global "recent
entries" sidebar widget** that lists the newest chapters **across all series**. So a backfill/page-watch of one series
ingests other series' chapters. (Separately, that site's series *landing* page isn't the chapter TOC — the WP-37
concern — but that's handled by a manual URL correction in the cleanup here.) The owner also has **existing bad
listings**: phantom chapters merged into real series, and a **duplicate series** (the same work added twice, once with
the home URL and once with the TOC URL).

**WP-36** stops the leak. **WP-38** recovers the already-corrupted data.

## WP-36 — `parseToc` content scoping

Restrict chapter extraction to the page's real content, excluding chrome (sidebars, "recent entries" widgets, nav,
footer). `parseToc` is a **pure function over already-fetched HTML** — no network cost here.

- **Chrome regions (constant):** `aside, nav, header, footer, .sidebar, #sidebar, #secondary, .widget-area,
  .widget_recent_entries, .recent-posts` (WordPress-generic selectors; extend as real sites need).
- **Single-pass filter with empty-fallback:** collect the chapter-ish anchors as today, then keep only those **not
  inside a chrome region** (`$(el).closest(<chrome>).length === 0`). If that leaves the set **empty** — a site whose
  TOC legitimately *is* a widget (e.g. the Blogger-widget TOC) — **fall back to the full anchor set**. One parse, no
  DOM mutation, no second fetch. Never worse than today.
- **Per-site refinements in `SiteTocConfig`** (optional, both default off):
  - `contentSelector?: string` — restrict the scan to a container (e.g. `.entry-content`) for stubborn themes.
  - `slugFamilies?: string[]` — keep only chapters whose URL path matches one of these prefixes; **supports multiple
    families** (a series whose TOC spans two slug prefixes — a Part 1 / Part 2 split). Belt-and-suspenders for a TOC
    page that mixes series in main content; the chrome filter alone fixes the reported leak.
- **Applies to the `config.chapterSelector` path too** — the chrome filter and (if set) `slugFamilies` refine whatever
  anchor set the config or generic scan produced.

**Testing (pure, TDD):** a fixture with a main-content chapter list + a "recent entries" sidebar of other-series
links → only the main-content chapters returned; a fixture whose *only* chapters are inside a widget → fallback
returns them; `slugFamilies` filters a mixed-series page to the two target families; the existing generic/lock tests
still pass.

## WP-38 — contaminated-series recovery (maintenance script)

A one-shot TypeScript script run locally against the prod DB (via `DATABASE_URL`). **Dry-run by default; `--apply`
commits.** Not wired into the app; a small detail-page UI (delete-chapter / reset / edit-source-URL) is a **follow-up**.

Operations (assisted — the owner selects targets; nothing destructive is guessed):
- **`list <seriesId>`** — print each chapter (id, number, title, url) + each source (id, type, url, feedUrl) so the
  owner can spot phantoms and confirm ids.
- **`prune-chapters <chapterId...>`** — delete the given chapters (the phantom cross-series ones).
- **`delete-series <seriesId>`** — delete a redundant duplicate (cascades chapters/sources/progress per the schema).
- **`merge-series --from <id> --into <id>`** — fold the `from` series into `into`: **union chapters by canonical URL**
  (skip dups), move its active source and reading progress if `into` lacks a more-advanced one, then delete `from`.
- **`reset-chapters <seriesId>`** — delete all of a series' chapters (to re-seed cleanly).
- **`set-source-url <sourceId> <url>`** — point a source at the correct chapter-TOC URL (manual WP-37).
- **`backfill <seriesId>`** — call `backfillFromToc` (clean once WP-36 lands) to re-populate.

Recovery flow for the owner's mess: `list` the contaminated series → `prune-chapters` the phantoms (or `reset-chapters`
+ `set-source-url` to the real TOC + `backfill`); for the duplicate, `merge-series` (or `delete-series` the bad copy).

**Testing:** the pure **merge-union** (union chapters by canonical URL, choosing the more-advanced reading progress) is
TDD'd as a helper; the DB operations are covered by an integration test (seed → op → assert) and verified by running
the script against the local `webnovel_test` DB. Destructive ops are gated behind `--apply` (dry-run prints the plan).

## Build order

**WP-36 first** (parseToc scoping — so any re-backfill is clean), **then WP-38** (recovery script, which re-backfills).

## Out of scope (captured elsewhere)

- **WP-37** (auto-discover a per-series chapter-TOC URL): here the owner sets it by hand via `set-source-url`.
- **WP-39** (add-time dedup to *prevent* duplicate series): WP-38 only cleans the existing duplicate.
- **WP-35** (TOC-order display): deferred behind these fixes.
- A general phantom-detection heuristic: cleanup is assisted (owner-selected), not automatic.
