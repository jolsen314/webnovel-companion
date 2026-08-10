# WP-48 — Blogger feed-path in `guessFeedUrls`

**Status:** design approved 2026-08-10. Depends on WP-05 (feed parse/discover, done). Pure, one-function change.

## Problem

A Blogger (`*.blogspot.com`) series can't be added. Observed: the site is 200 under any UA, 0 redirects, ~357
chapter links, and advertises a valid feed at `/feeds/posts/default?alt=rss` — **residentially**. But from
Vercel two things combine:

1. The **page fetch fails from Vercel** (Google serves the datacenter IP a non-200), so `addSeries` never runs
   `discoverFeeds` — advertised `<link>` feeds are only read when `pageOk` is true.
2. It then falls to `guessFeedUrls`, which only yields **WordPress-style** candidates — `${page}feed/` and
   `${origin}/feed/` — both **404 on Blogger**. Blogger's real feed lives at `/feeds/posts/default`.

So a perfectly good feed is unreachable on the failure path, and `addSeries` throws "couldn't reach … or find
a feed."

## Design

### The change — `guessFeedUrls` (`src/lib/feeds/discover.ts`), pure

Add Blogger's blog-level feed candidates. Two paths:

- `${origin}/feeds/posts/default` — Blogger's native **Atom** feed.
- `${origin}/feeds/posts/default?alt=rss` — the **RSS** variant (`rss-parser` reads both; Atom-first, RSS as a
  safety net).

Ordering by host:

- **`*.blogspot.com` host** → Blogger paths **first**, then the existing WordPress guesses:
  `[blogger…, ${page}feed/, ${origin}/feed/]`. This is a **speed optimization** — a real blogspot blog binds on
  the first candidate and never wastes two fetches on WordPress paths that 404.
- **Any other host** → WordPress guesses first, then Blogger paths as a **strict last resort**:
  `[${page}feed/, ${origin}/feed/, blogger…]`.

`addSeries` needs **no change** — it already falls back to `guessFeedUrls(url)` exactly when `pageOk` is false
(or the page advertised nothing), and binds to the first candidate whose body `looksLikeFeed`.

### Why universal last resort (owner decision)

Appending the Blogger paths for **every** host (not just `.blogspot.com`) also rescues **custom-domain Blogger**
blogs (a Blogger blog served on its own domain) and legacy ccTLD blogspot domains — cases hostname detection
can't catch. The `.blogspot.com` detection then only controls *order/speed*, while the universal tail is the
correctness net.

**Risk (accepted, low):** on the failure path, a **non-Blogger** host that happens to serve valid feed XML at
exactly `/feeds/posts/default` would bind to that (possibly wrong / site-wide) feed instead of throwing — a
silent wrong-bind rather than a clean failure. Two mitigations keep it small: the Blogger paths are **strictly
last** (tried only after advertised feeds + WordPress guesses all fail), and `looksLikeFeed` (body starts with
`<?xml`/`<rss`/`<feed`) rejects a 404 HTML page, so only a host genuinely serving feed XML at that path could
mis-bind. Rare for translator sites, and recoverable (remove/re-add). The upside (custom-domain Blogger
coverage) outweighs it.

## Testing & verification

- **Unit (pure, TDD)** — extend `tests/unit/feeds/discover.test.ts` `guessFeedUrls`:
  - A `*.blogspot.com` URL yields `/feeds/posts/default` and `?alt=rss`, ordered **before** the WordPress
    guesses.
  - A non-blogspot URL keeps the WordPress guesses **first** and appends the two Blogger paths **last** (order
    asserted).
  - The existing "offers WordPress-style fallbacks" test stays green (it uses `.toContain`).
- **Gates** — `npm test` + `npm run typecheck` green (agreement #3). No integration test needed (pure function;
  `addSeries` wiring is unchanged and already covered). No schema change.

## Definition of Done

`guessFeedUrls` returns Blogger's `/feeds/posts/default` (+`?alt=rss`) — first for `*.blogspot.com` hosts, last
for all others — so a Blogger series (blogspot or custom-domain) binds via its feed even when the page fetch is
blocked from Vercel; ordering + presence unit-tested (pure); existing tests green; no `addSeries`/schema change.

## Out of scope (deferred)

- Detecting custom-domain Blogger by content sniffing → unnecessary; the universal last-resort candidate covers
  it without a probe.
- The CF-on-Vercel render escalation for the *other* two failing add sites → that's WP-46 (this WP only covers
  the Blogger/feed case).