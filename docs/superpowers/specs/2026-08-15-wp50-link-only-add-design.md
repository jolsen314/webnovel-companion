# WP-50 (reframed) — Link-only add when chapters can't be read

**Status:** design approved 2026-08-15. Depends on WP-07 (services), WP-10 (add/detail UI), WP-46 (add-time
render escalation). **Reframes the original WP-50** ("reject no-chapter / non-TOC adds") into a
**confirm-and-allow** flow, on the owner's call that — now that delete is one click (WP-51) — *being able to add
a blocked/unreadable series is more valuable than rejecting empty ones.*

## Problem

Two add outcomes today are both wrong for the owner:

1. **CF-blocked site** (page *and* feed unreachable, render can't clear it) → `addSeries` **throws**
   ([addSeries.ts:213](../../../src/server/services/addSeries.ts#L213)); the series can't be added **at all** —
   even though the owner wants it on the shelf for organization + a quick link.
2. **Non-TOC page** (page *loads* but has no chapter list) → **silently** creates a `PAGE_WATCH` series with
   **0 chapters** — empty junk.

Both cases end at the same place: *we couldn't get a chapter list.* The original WP-50 answered "throw it away";
the owner wants "let me keep it as a link-only entry, and tell me why tracking isn't available."

**Wants (owner):** shelf organization · quick link access · manual status/rating/notes · (lowest priority)
later auto-upgrade if the site becomes reachable.

## Design

### 1. Resolution returns a decision, not a throw / silent create

When `addSeries` resolution finds **no feed and 0 chapters** (the blocked hard-fail *and* the page-loaded-non-TOC
cases), it no longer throws or silently creates. It returns a discriminated result:

```ts
type AddSeriesResult =
  | { kind: 'created'; seriesId: string; resolved: ResolvedSource; alreadyExisting: boolean; similarTo?: … }
  | { kind: 'needsConfirm'; reason: 'blocked' | 'no-chapters'; suggestedTitle: string; url: string };
```

- **`reason: 'blocked'`** — the page never loaded (hard-fail after the render attempt). `suggestedTitle` = URL
  slug (`titleFromUrl`), since no page body was readable.
- **`reason: 'no-chapters'`** — the page loaded but `parseToc` found nothing. `suggestedTitle` = the extracted
  `og:title`/`<h1>` (`extractSeriesTitle`) — the page *did* load — falling back to the slug.

**The legit FEED-empty is preserved** (WP-43): a valid feed match with nothing in-window yet still resolves to a
normal `created` FEED source (it has a feed → it fills in later). `needsConfirm` fires only when there is **no
feed**. This is the original WP-50 "don't reject real feed empties" caveat, kept.

**Also preserved — page-watch with a separate TOC page:** `needsConfirm('no-chapters')` fires only when the
landing page has **0 chapters AND no discoverable `tocUrl`**. A landing page that links a real TOC page
elsewhere (0 chapters on the landing itself) is a legit page-watch series that fills in from the TOC on the
first `backfillFromToc`, so it creates a normal `PAGE_WATCH` (`linkOnly: false`), not a confirm. Only a page
with neither landing chapters nor a TOC link is genuinely untrackable.

### 2. Confirm → force a link-only entry

`AddSeriesInput` gains `allowLinkOnly?: boolean`. When set, `addSeries` **short-circuits resolution entirely** —
it does **not** re-fetch or re-render (the first attempt already established the site can't be read; a second
render on a blocked site would waste ~5–15s). It builds a link-only source directly from the URL + title and
finalizes it: a `PAGE_WATCH` source, 0 chapters, `feedUrl`/`tocUrl` null, `fetchMode: 'PLAIN'`, with the new
`linkOnly` marker set. Title = the user-supplied title (pre-filled with `suggestedTitle`, editable). Dedup still
applies — `finalize` computes `canonicalSeriesId` from the source URL + match and collapses onto an existing
series if one matches. (`fetchMode` is moot while `linkOnly` excludes it from polling; a future WP-RETRY re-runs
real resolution.)

### 3. Data model — `Source.linkOnly`

Additive migration (same pattern as `titleIsManual`): `linkOnly Boolean @default(false)` on `Source`.

- **Poll exclusion:** `loadActiveSources` / the poll query filter out `linkOnly` sources — a known-blocked site
  must never eat poll budget or hammer Cloudflare (respects the standing poll-budget × CF constraints). Health
  isn't tracked for them.
- A link-only source is still `isActive` (it's the series' active/only source) — `linkOnly` is the "don't fetch"
  signal, orthogonal to the re-pointing `isActive` flag.

### 4. Add-page UI — the confirm step (reason-specific)

`POST /api/series` maps a `needsConfirm` result to a **200** `{ needsConfirm: true, reason, suggestedTitle, url }`
(not the current 502-throw). The add page ([add/page.tsx](<../../../src/app/(app)/add/page.tsx>)) handles it:
render a confirm panel with a **reason-specific message**, an **editable title field** (pre-filled with
`suggestedTitle`), and **[Add anyway] / [Cancel]**. "Add anyway" re-POSTs `{ url, allowLinkOnly: true, title }`.

- **`blocked`:** *"**{host}** appears to be blocking automated requests (often Cloudflare), so we can't read its
  chapter list. Add it as a link-only entry? You'll get a shelf card and a quick link, but no automatic
  new-chapter tracking."*
- **`no-chapters`:** *"We couldn't find a chapter list on that page — it may not be the series' contents/TOC page.
  Add it as a link-only entry anyway, or cancel and paste the table-of-contents page."* (Keeps the original
  WP-50 nudge toward the right page, while still allowing the add.)

### 5. Detail / shelf UI

- A small **"link-only"** (a.k.a. "not tracked") badge on the detail page and the shelf card, so it's clear the
  series isn't auto-updating.
- The **series link** is the primary affordance (quick link access) — the detail page already links the source
  URL; the shelf card already links to the detail page. No chapter list (0 chapters) is expected, not an error.
- **Status / rating** already editable; **notes** editability is **WP-NOTES** (filed alongside — the field +
  backend exist, only the UI is missing). Delete already works (WP-51).

## Testing

- **Unit (`lib`/pure where applicable):** the resolution decision — no-feed + 0-chapters → `needsConfirm` with
  the correct `reason` (blocked vs no-chapters) and `suggestedTitle`; a feed-empty still → `created`;
  `allowLinkOnly` → a link-only `PAGE_WATCH` core. (These live in `addSeries` resolution; test via the existing
  `addSeries` port-injected pattern.)
- **Integration:** `allowLinkOnly` persists a source with `linkOnly = true`; `loadActiveSources`/poll **excludes**
  a `linkOnly` source (it's never fetched). Validation: `parseAddSeriesBody` accepts `allowLinkOnly` + `title`.
- **E2E (append to the WP-PW checklist — standing rule):** paste a URL that yields no chapters → the confirm
  panel appears with the right message → "Add anyway" → the link-only series lands on the shelf with the badge,
  and the link is present. (Uses a seeded/stubbed unreachable fetch so it's deterministic.)

## Bookkeeping (part of this WP)

- **Reframe WP-50** in PLAN.md from "reject" to this confirm-and-allow link-only add; WP-50 → the active WP.
- **File WP-NOTES** — detail-page notes textarea → existing `PATCH /api/series/[id]` (`notes` already validated
  + persisted; only the UI is missing). Own active-queue row.
- **File WP-RETRY** — manual "retry fetching chapters" that re-resolves a `linkOnly` source and upgrades it to a
  tracked FEED/PAGE_WATCH source when the site becomes reachable (renderer added, feed appears, URL fixed). The
  deferred auto-upgrade; own row, low priority (owner's lowest).
- **Append the link-only add flow** to the WP-PW E2E UI-coverage checklist.

## Out of scope / non-goals

- **Auto-upgrade / retry** of a link-only source → **WP-RETRY**.
- **Notes UI** → **WP-NOTES**.
- No polling of link-only sources; no health/notifications for them.
- No change to the legit FEED-empty (WP-43) path.

## Definition of Done

- `addSeries` returns `needsConfirm` (with `reason` + `suggestedTitle`) for no-feed/0-chapter adds instead of
  throwing/silently creating; `allowLinkOnly` force-creates a link-only `PAGE_WATCH` source.
- `Source.linkOnly` migration; link-only sources excluded from polling.
- Add page shows the reason-specific confirm with an editable title + Add-anyway/Cancel; confirm creates the entry.
- Detail + shelf show a "link-only" badge; the link is accessible; status/rating editable.
- Unit + integration cover the decision, persistence, and poll exclusion; an E2E covers the confirm→add flow.
- `npm test` + `npm run test:integration` + `npm run test:e2e` + `npm run typecheck` green.
- PLAN.md: WP-50 reframed + done; WP-NOTES + WP-RETRY filed; WP-PW checklist appended; changelog; NEXT advanced.
