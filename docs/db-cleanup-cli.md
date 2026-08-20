# `db:cleanup` — maintenance CLI reference

A local, dry-run-by-default maintenance tool over the recovery services (WP-38+). It fixes
contaminated or mis-configured series/sources: pruning chapters, deleting/merging series,
re-pointing or re-classifying sources, backfilling, and pointing a source at a chapter data API.

```
npm run db:cleanup -- <command> [args] [--apply]
```

> **Anonymity:** every example below uses `*.example` placeholders. Never commit real host or
> series names — pass real URLs/ids as arguments at runtime; they don't belong in this doc.

---

## Safety model (read before running anything)

- **Dry-run by default.** Without `--apply`, every mutating command prints the plan it *would*
  execute and makes **no writes**. Add `--apply` to actually commit. Always dry-run first.
- **`list` is always read-only** (no `--apply`, never writes).
- **Ownership-scoped.** Every command only touches the current user's series (the single-user
  owner). A wrong id that belongs to nobody just prints "not found" and does nothing.
- **Which database?** The tool writes to whatever `DATABASE_URL` points at:
  - Default (`.env`) → your **local** `webnovel_dev`. Safe to experiment.
  - **Production (Neon)** lives in the gitignored `.env.prod`. To deliberately operate on prod,
    `source .env.prod` first (or set `DATABASE_URL` inline). **Know which DB you're on before
    `--apply`** — the dry-run output does not tell you the database; you do.
  - Integration/e2e DBs (`webnovel_test`, `webnovel_e2e`) are for the test suites, not manual use.
- Runs via `tsx`. There is no confirmation prompt beyond the dry-run/`--apply` split.

---

## Commands

Ids: a **seriesId**/**sourceId**/**chapterId** are `cuid`s. Get them from the app's detail-page
URL, or from `list <seriesId>` (which prints a series' source and chapter ids).

| Command | What it does | Writes on `--apply` |
|---|---|---|
| `list <seriesId>` | Print a series' title, chapters (id/#/title/url), and sources (id/type/url/feed). | — (read-only) |
| `prune-chapters <chapterId...>` | Delete specific chapters by id. | Deletes those chapters. |
| `delete-series <seriesId>` | Delete a whole series (cascades its chapters, sources, reading progress). | Deletes the series. |
| `reset-chapters <seriesId>` | Delete **all** of a series' chapters; the series row stays (forces a clean re-seed on next poll). | Deletes the chapters. |
| `set-source-url <sourceId> <url>` | Repoint a source's **reading** URL (e.g. after a site move); re-derives `host`. | Updates `url`/`host`. |
| `merge-series --from <fromId> --into <intoId>` | Fold `from` into `into`: unique chapters (by canonical URL) move over, duplicates drop, `from` is deleted. | Moves chapters, deletes `from`. |
| `backfill <seriesId> [--render]` | Fetch the series' active source page (optionally via the renderer) and add missing chapters, reconciling FREE/LOCKED. | Fetches + adds/reconciles. |
| `reclassify-source <sourceId> [--render]` | Flip a `FEED` source to `PAGE_WATCH`: deactivate the feed, drop the series matcher, and (with `--render`) set `fetchMode=RENDER`. | Updates the source. |
| `set-api-descriptor <sourceId> --endpoint <url> --map <json> [--render]` | Point a source at a chapter data **API** (JSON): sets `type=API`, `apiUrl`, `apiMap`; clears the feed/matcher/validators. See the deep-dive below. | Converts the source to API. |

### Examples

```bash
# Inspect a series (read-only) — find its source/chapter ids:
npm run db:cleanup -- list <seriesId>

# Repoint a source after a site move (dry-run, then apply):
npm run db:cleanup -- set-source-url <sourceId> 'https://new-host.example/series/foo/'
npm run db:cleanup -- set-source-url <sourceId> 'https://new-host.example/series/foo/' --apply

# Merge a duplicate series into the canonical one:
npm run db:cleanup -- merge-series --from <dupId> --into <keepId>            # dry-run
npm run db:cleanup -- merge-series --from <dupId> --into <keepId> --apply

# Backfill missing chapters through the renderer (needs RENDER_URL/RENDER_SECRET):
npm run db:cleanup -- backfill <seriesId> --render --apply
```

### Per-command gotchas

- **`merge-series`** — the `--into` series should have an **active source**; otherwise moved
  chapters land with no source to keep them current. Direction matters: `--from` is deleted.
- **`backfill --render`** and **`reclassify-source --render`** / **`set-api-descriptor --render`**
  need `RENDER_URL` (+ `RENDER_SECRET`) in the environment (pointing at the deployed `/api/render`).
  `backfill --render` fails fast with a usage error if they're unset.
- **`reset-chapters`** loses reading position and the chapter list (they re-seed on the next poll).
  Prefer it over deleting a series when you only need to re-fetch.
- **`delete-series`** cascades — chapters, sources, and reading progress all go. There is no undo.

---

## `set-api-descriptor` deep-dive

Points a source at a JSON chapter API instead of a feed/page-watch. It sets `type=API`, stores the
endpoint in `apiUrl` and the field mapping in `apiMap`, and clears `feedUrl`/matcher/validators. The
source's human **reading `url` is left untouched** — `apiUrl` is a separate, fetch-only field.

```bash
npm run db:cleanup -- set-api-descriptor <sourceId> \
  --endpoint '<API_URL>?category=<CATEGORY_ID>&order=asc&per_page=200' \
  --map '{"urlField":"permalink","titleField":"title","isFreeField":"locked","isFreeWhen":"falsy","pagination":{"pageParam":"page","perPage":200}}' \
  --render
```

Run without `--apply` first to see the plan. **Quote both `--endpoint` and `--map`** (single quotes)
so the shell doesn't eat the `&` or the JSON's double-quotes.

### `--map` — the `ApiDescriptor`

The `--map` value is JSON describing how to read one chapter item out of the API's JSON:

| Field | Required | Meaning |
|---|---|---|
| `urlField` | ✅ | Item key → the chapter URL / permalink (resolved absolute against the endpoint origin). |
| `titleField` | ✅ | Item key → the chapter title. |
| `numberField` | | Item key → the chapter number. Absent/non-numeric → parsed from the title, then the URL. |
| `isFreeField` | | Item key → a free/locked flag. **Absent → every chapter is treated FREE.** |
| `isFreeWhen` | | How to read `isFreeField`: `"truthy"` (default) = the field means "is free"; `"falsy"` = the field is `locked` (inverse). |
| `listPath` | | Dot-path to the chapter array in the JSON (e.g. `"data.chapters"`). Absent → the JSON root is the array. |
| `pagination` | | Present → the API is paginated; fetch every page and union (see below). Absent → one fetch = the whole list. |

Example: an API returning `[{ "title": …, "permalink": …, "locked": true/false }]` maps to
`urlField:"permalink"`, `titleField:"title"`, `isFreeField:"locked"`, `isFreeWhen:"falsy"` (a
`locked:true` chapter is LOCKED).

### `pagination` — fetch + union multiple pages

| Field | Required | Meaning |
|---|---|---|
| `pageParam` | ✅ | The **page-number** query param to increment (usually `"page"`). |
| `perPage` | ✅ | The page size — **and** the "last page" threshold (a page with fewer than this many items is the last). No default; you set it. |
| `maxPages` | | Runaway backstop (**default 20**). Raise it for very long series (e.g. 1.3k chapters at 200/page = 7 pages). |
| `listPath` | | Per-page array path; falls back to the top-level `listPath`. |

**The three pagination gotchas:**

1. **`perPage` is set in two places and they must match.** The `per_page=<N>` in `--endpoint`
   controls how many items the API returns per page; the `perPage:<N>` in the descriptor is the
   threshold the loop uses to decide "this page was short → stop." If they differ:
   - URL `per_page=50` but descriptor `perPage:200` → every full 50-item page looks "short"
     (50 < 200) → it **stops after page 1** and silently misses the rest.
   - URL `per_page=200` but descriptor `perPage:50` → a full 200-item page never looks short →
     it runs all the way to the `maxPages` cap doing wasted fetches.

2. **`pageParam` is the page-*number* param, not the per-page param.** It's the key that gets
   incremented (`page=1`, `page=2`, …). The per-page param (`per_page`, or `limit`/`pageSize`
   elsewhere) lives **only in the endpoint URL** — the descriptor never names it, it just carries
   the numeric `perPage`. A differently-named per-page param needs no descriptor change.

3. **Leave `page` out of `--endpoint`.** The loop sets/increments it. Bake the *fixed* params
   (`category`, `order`, `per_page`) into the URL; prefer `order=asc` so the unioned list is in
   reading order.

### `--render`

Fetches the API through the headless renderer, which clears Cloudflare — use it when the endpoint
is **behind a CF challenge** (a plain datacenter GET is blocked). It sets `fetchMode=RENDER`; the
poll then render-fetches the API (one browser per poll, looping pages in-page). For an un-gated
public API, omit `--render` (plain fetch, cheaper, `304`-able). `--render` needs
`RENDER_URL`/`RENDER_SECRET` configured for the poll to actually render.

### After conversion

Chapters populate on the **next poll**, not immediately. If you're validating on a Vercel *preview*
(where cron doesn't run), either trigger the poll endpoint manually or test the render primitive
directly via a `POST /api/render` with a `{ url, pagination }` body.
