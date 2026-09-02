# Adding a site via its chapter API

*A human guide for evaluating a new source and, when it has one, wiring it to a JSON chapter API
instead of scraping the page.*

This is the **triage + how-to** doc — how to look at a site, decide whether it can use the API path,
find what you need, and wire it. The **exhaustive operator reference** — every `db:cleanup` flag, the
full field-map table, and every edge-case gotcha — is [db-cleanup-cli.md](db-cleanup-cli.md). This
doc shows the worked commands inline; that doc is where you go when one of them behaves oddly.

> All examples use placeholder hosts (`example-host`) and `<id>`/`<slug>` placeholders. Real
> site/series names live only in local, uncommitted notes.

---

## Why the API path is the best source (when it exists)

A page-watch source scrapes the TOC's HTML with `parseToc` — which works, but is brittle (it fights
site markup, recommendation widgets, pagination anchors) and often can't see lock state cleanly. A
site's own **chapter data API** returns the **complete** chapter list as JSON, usually **with a
per-chapter lock flag** — so it's both more reliable and cheaper than DOM scraping, and it feeds the
"now free" detection (WP-20) directly instead of guessing from CSS classes.

So: **if a site has a usable JSON chapter API, prefer it.** This guide helps you find out whether it
does, and wire it if so.

---

## Two taxonomies to hold in your head

### 1. How hard is the site to fetch? (the Cloudflare axis)

| Tier | What it is | Can we read it? |
|---|---|---|
| **Plain-static** | No bot protection; a normal HTTP GET returns the real HTML/JSON. | Yes — plain fetch. |
| **Render-clearable** | Cloudflare's JS challenge (or a JS-only SPA) — a *real browser* solves it, a datacenter GET is blocked. | Yes — via the headless renderer (`RENDER_URL`). |
| **Anti-headless** | A *managed* challenge that a headless browser can't pass (it's triggered by the datacenter IP, not the TLS fingerprint). | No — needs a residential IP or a third-party unblocker. Out of scope. |

The renderer clears tier 2, not tier 3. If even a rendered fetch 403s with a managed challenge, the
site is anti-headless and the API path won't save you.

#### How to tell which tier a site is

You can't tell by looking at the page in your normal browser — your browser clears tiers 1 and 2
transparently. Diagnose it with two probes:

1. **Plain GET** — `curl -s <url> | head -40` (a datacenter-style GET, like the poller makes).
   - Real chapter HTML comes back → **plain-static** (tier 1). Done.
   - A Cloudflare interstitial ("Just a moment…", "Verifying you are human"), a `403`, or a
     near-empty JS shell → **not** tier 1; go to step 2.
2. **Render** — run it through the headless renderer (the quickest way is
   `db:cleanup probe-api <sourceId>`, which renders the page):
   - The render returns real content / captures a chapter XHR → **render-clearable** (tier 2).
   - The render still returns a challenge page or errors out → **anti-headless** (tier 3) — stop,
     the API path won't help; keep it on page-watch or link-only.

Rule of thumb: **loads in your browser but `curl` is blocked → tier 2** (the renderer will clear it).
**A real browser can't get past a "verify you're human" loop → tier 3.**

### 2. How is the API delivered? (the discovery axis)

| Shape | How you find it | Auto-detected? |
|---|---|---|
| **Static-JSON** | The HTML points at a `.json` data file via a `data-*` attribute (a Cloudflare-Pages / SPA pattern). | **Yes** — the add flow's `probeForApi` catches it automatically. |
| **XHR-plain** | The page fetches its chapter list via a runtime `fetch`/XHR to a JSON endpoint — **no** Cloudflare, no auth on the endpoint itself. | No — invisible to the HTML scan; needs `probe-api` or manual discovery. |
| **XHR-CF-gated** | Same as above, but the endpoint sits behind Cloudflare (only a browser context with a `cf_clearance` cookie can fetch it). | No — needs `probe-api --render` or manual discovery, and the source fetches through the renderer. |

**Key point:** an XHR endpoint only exists *at runtime*, so a scan of the static HTML can't see it —
that's the gap `probe-api` fills. And **not every data-API is Cloudflare-gated**: many are a plain
XHR you can fetch directly once you know the URL. Discovery (finding the endpoint) and fetching
(reading it on a schedule) are separate questions — a site can need a browser to *discover* the
endpoint but not to *fetch* it.

---

## Finding the API by hand (DevTools)

The discovery step is the same whether the API is HTML-advertised or a plain runtime XHR:

1. Open the series' TOC page in a browser.
2. DevTools → **Network** → filter to **Fetch/XHR**.
3. **Reload** — then **interact.** This is the step that's easy to miss: some sites don't fetch the
   chapter list on load. The request only fires when you **hover or click the "chapter list" /
   "chapters" control**, expand a tab, or scroll the list into view. If a reload shows no chapters
   request, hover/click every chapter-list-ish button before concluding there's no API.
4. Look for a request that returns a JSON array (or a JSON object wrapping one) of chapter-shaped
   items — titles, numbers, links/slugs, maybe a `locked`/`premium` flag.
5. Note three things:
   - **The endpoint** — e.g. `https://example-host/api/v1/chapters?category=<id>`.
   - **The per-series id/slug** in the query — `category=<id>` or `?slug=<series-slug>`. This is what
     scopes the endpoint to *this* novel.
   - **The item shape** — which JSON keys hold the url/slug, title, number, and lock flag.

If, after interacting, you see no such request, the site has no usable JSON chapter API — stay on
page-watch.

### Reading the item shape into a field-map

Each descriptor field is one JSON key. The commonly-needed ones:

| Field | What it points at |
|---|---|
| `titleField` | the key holding the chapter title (required) |
| `urlField` | the key holding a full chapter URL/permalink — **or** use `urlTemplate` (below) if items carry only a bare slug/id |
| `numberField` | the key holding the chapter number (optional — falls back to parsing the title, then the URL) |
| `isFreeField` + `isFreeWhen` | the lock/free flag, and how to read it: `"falsy"` when the field is `locked` (a `true` means LOCKED), `"truthy"` when it's `free` |
| `listPath` | dot-path to the array if it's nested (e.g. `"data.chapters"`); omit if the JSON root *is* the array |
| `pagination` | present only if the endpoint is paged (see the pagination gotcha) |

The full table (every field, all the pagination sub-fields) is in
[db-cleanup-cli.md → `--map`](db-cleanup-cli.md).

---

## Two gotchas that will bite you

### A. Determining the chapter-page (reader) URL

The API's endpoint path and its item fields **don't necessarily give you the reader URL.** Two
traps:

- **Bare slug/id, no full URL.** An item may carry only `{ "slug": "..." }` or `{ "order": 12 }` —
  not a full permalink — and the chapter page often lives under a **different path prefix than the
  API endpoint** (`/novel/<series-slug>/<order>`, not `/api/...`). You can't derive that prefix from
  the API; **open one real chapter and read its address bar.** Then build a `urlTemplate` (below):
  the series slug is a fixed literal for this source, and the per-item field is a `{placeholder}`.
- **"200-but-wrong" pages.** A valid `200` isn't proof you have the right URL — an SPA route can
  return `200` and render "undefined" for a bad slug. Confirm a templated URL actually loads a real
  chapter before trusting it.

### B. Pagination is easy to get subtly wrong

If the endpoint is paginated (`page=1`, `page=2`, …), the per-page size lives in **two places** —
the `per_page=<N>` in the endpoint URL *and* the `perPage:<N>` in the descriptor — and they must
match, or the fetch stops after page 1 or over-fetches. Also **leave `page` out** of the stored
endpoint (the loop adds it).

**The nastiest one: the API may silently cap `per_page` below what you ask — and *that* cap is the
number both values must equal.** Matching your endpoint to your descriptor isn't enough if the
*server* clamps `per_page`: ask for `per_page=500` and a WordPress REST API (for one) returns
**100** and ignores the rest. Now the endpoint says 500, the descriptor says 500, but every page is
really 100 — so the loop sees a 100-item page as "short" (100 < 500), **stops after page 1**, and
silently drops the rest of the series. Discover the site's **real** cap (page through by hand, or
watch a total-count header like `x-wp-total` vs. how many items a page actually returns) and set
*both* values to that number. **Symptom:** the source fills to exactly one page's worth (100, 200, …)
and no further. Full detail: [db-cleanup-cli.md → pagination](db-cleanup-cli.md).

---

## Wiring it: `set-api-descriptor`

Once you know the endpoint and the field-map, point the (already-added) source at the API with
`set-api-descriptor`. It sets `type=API`, stores the endpoint in `apiUrl` and the map in `apiMap`,
and clears the feed/matcher — the source's human reading `url` is left untouched. **Always run once
without `--apply`** to see the dry-run plan, then add `--apply`. **Quote both `--endpoint` and
`--map`** in single quotes so the shell doesn't eat the `&` or the JSON quotes. Add `--render` if the
endpoint is CF-gated (tier 2) and must be fetched through the headless browser.

**Case 1 — items carry a full URL and a lock flag, paginated:**

```bash
npm run db:cleanup -- set-api-descriptor <sourceId> \
  --endpoint 'https://example-host/api/v1/chapters?category=<id>&order=asc&per_page=200' \
  --map '{"urlField":"permalink","titleField":"title","numberField":"order","isFreeField":"locked","isFreeWhen":"falsy","pagination":{"pageParam":"page","perPage":200}}' \
  --render --apply
```

(`per_page=200` in the endpoint and `perPage:200` in the map — and confirm 200 is the site's real
per-page cap, per gotcha B.)

**Case 2 — items carry only a bare slug/id (gotcha A) → `urlTemplate`:**

The endpoint is `?slug=<series-slug>` and each item is `{ "order": 12, "title": "..." }` with no URL.
You opened a chapter and its address bar reads `https://example-host/novel/<series-slug>/12`. The
series slug is fixed for this source, so bake it into the template as a literal and interpolate the
per-item `{order}`:

```bash
npm run db:cleanup -- set-api-descriptor <sourceId> \
  --endpoint 'https://example-host/api/novel/chapter-list?slug=<series-slug>' \
  --map '{"urlTemplate":"/novel/<series-slug>/{order}","titleField":"title","numberField":"order"}' \
  --apply
```

- Supply **one of** `urlField` or `urlTemplate` (plus `titleField`); `urlTemplate` wins if both are
  set. A `{field}` placeholder resolves per item; everything else in the template is literal, so a
  series-level constant like the slug is just written into the string.
- No `isFreeField` here → every chapter is treated **FREE** (correct for a free-only source).
- After applying, poll the source (or check the series page) and confirm the chapter count looks
  right and a chapter link actually opens the real page.

The exhaustive field/pagination reference and more edge cases live in
[db-cleanup-cli.md → `set-api-descriptor` deep-dive](db-cleanup-cli.md).

---

## The `probe-api` shortcut

`db:cleanup probe-api <sourceId>` automates the discovery step for a source you've already added:
it renders the page (clearing tier-2 Cloudflare), captures the JSON XHRs it fires, and **infers a
candidate field-map** — endpoint, list path, title/url-or-slug/number/lock fields, and pagination —
printing each candidate with a parsed-chapter sanity count.

```bash
npm run db:cleanup -- probe-api <sourceId>                    # dry run: print inferred candidates
npm run db:cleanup -- probe-api <sourceId> --apply            # wire the top candidate
npm run db:cleanup -- probe-api <sourceId> --render --apply   # + mark the source CF-gated to fetch
```

It even nudges lazily-loaded lists — it drives a real (trusted) hover on chapter-list-ish controls
(and a guarded click on non-anchor ones, so it won't navigate away) to trigger an interaction-gated
XHR. But that heuristic isn't perfect, so **four things it can't do:**

- **Capture an interaction-gated XHR on an SPA that doesn't hydrate in the serverless renderer.**
  The probe renders on Vercel's headless chromium; some client apps that hydrate fine in a normal
  browser don't execute their client JS there (you'll see the diagnostic report a large rendered
  `html` that *contains* the control text, but no app-driven requests captured — only third-party
  scripts). If the request only fires *after* hydration + interaction, the probe can't reach it.
  Fall back to reading the endpoint by hand (DevTools) and wiring it with `set-api-descriptor` — the
  API itself is usually a plain fetch that works regardless.

- **Interaction-gated APIs it doesn't guess.** If the request only fires on an interaction the nudge
  doesn't match (an odd control label, a scroll, a multi-step flow), `probe-api` sees nothing. Fall
  back to the manual DevTools-with-interaction flow above.
- **Infer the reader-URL path prefix** (gotcha A) — the API response simply doesn't contain it. When
  items carry only a bare slug/id, `probe-api` emits a `urlTemplate` with a `CONFIRM-READER-PATH`
  placeholder and **refuses `--apply`** until you replace it. Open a real chapter, then finish it
  with the manual `set-api-descriptor` command (Case 2 above) using the real prefix.
- **Know the server's real `per_page` cap** (gotcha B) — it infers `perPage` from the single page it
  captured, which is only right if that page wasn't itself clamped. Sanity-check the count and adjust
  if the source fills to exactly one page.

So `probe-api` gets you most of the way; you finish the reader-URL, pagination cap, and any missed
interaction by hand. Auto-probe is a convenience — the manual DevTools + `set-api-descriptor` flow
always works and is the fallback when the inference misses.

---

## Checklist: can this site leverage the API path?

Walk these in order; a "no" at the fetch tier ends it.

- [ ] **Fetchable?** Plain-static or render-clearable (not anti-headless / managed challenge)?
- [ ] **Is there a JSON chapter-list endpoint?** (DevTools → Fetch/XHR → reload → *interact* → a JSON
      array of chapters.)
- [ ] **Is it series-scoped?** A per-series id/slug in the query (`category=<id>`, `?slug=<slug>`)?
- [ ] **Does an item give you the reader URL?** A full permalink field, *or* a slug/number you can
      template once you've opened one real chapter?
- [ ] **Does it carry lock state?** A `locked`/`premium`/`free` field (nice-to-have — without it,
      every chapter is treated FREE, fine for a free-only source)?
- [ ] **Paginated?** If so, note the page-number param and the server's **real** per-page cap.

All boxes (bar the optional lock field) checked → wire it with `set-api-descriptor` (or `probe-api`),
preferring the API over page-watch. Any fetch-tier "no" → stay on page-watch (or link-only for
anti-headless).
