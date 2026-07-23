# WP-17b — Hard sources: self-hosted renderer + manual release-schedule fallback

Date: 2026-07-23
Status: Draft (awaiting owner review)

## Context

Plain page-watch ([`politeFetch`](../../../src/lib/feeds/fetch.ts) → [`parseToc`](../../../src/lib/feeds/pageWatch.ts))
handles static-HTML sites. A diagnostic probe of the owner's hard sources (2026-07-23, scratchpad, uncommitted)
found the "hard" bucket is really **two different problems**:

| Category | Observed | What it needs |
|----------|----------|---------------|
| **CF-challenged** | `403 cf-mitigated: challenge` (Cloudflare interstitial). The site's `/feed/` still returns `200`. | True anti-bot solving (paid unblocker + residential proxies) — grey-zone, and it leaks the reading list to a vendor. |
| **JS-rendered, non-CF** | `200`, no bot-wall, but the chapter list is streamed client-side (Next.js RSC / client fetch) — the raw document has ~0 real chapter links. | A **plain headless browser** to execute JS. No bypass, no proxies. |

Two consequences shape this design:

1. **JS-rendered sites are winnable cleanly and privately.** Rendering JavaScript is not circumventing a protection —
   it's what a browser does. This can be **self-hosted**, so the owner's reading list never leaves infrastructure they
   control.
2. **CF-challenged sites are not worth bypassing.** Self-hosted plain Chromium generally can't clear a real CF
   challenge, and the only thing that reliably does (a vendor unblocker) is a privacy downgrade no certification fixes
   — the vendor inherently sees every URL. But those sites' **feeds are reachable**, giving a free "new chapter"
   trigger, and the owner can supply a **manual release schedule** for the "now free" signal without any fetch at all.

So WP-17b is scoped to **two independent mechanisms**, not an unblocker:

- **Tier 1 — a self-run renderer** (a browser *you* deploy — from a Vercel function to a box you own) for
  JS-rendered non-CF sites.
- **Tier 2 fallback — manual release schedule** (no-fetch) for fully-blocked sites, complementing feed-as-trigger.

## Non-goals

- **No third-party unblocker / CF-solving.** Explicitly deferred (may be never). If ever revisited, it's a separate
  decision with the privacy trade spelled out — not part of this work.
- **No proxy rotation, no CAPTCHA solving, no stealth-browser arms race.** Tier 1 is a *plain* browser.
- **Not pruning or changing the existing plain-fetch / feed paths.** Those stay the default.

## Fetch tiers (the strategy this encodes)

- **Tier 0 — PLAIN** (`politeFetch`): static HTML + all feeds. Default. Conditional GET (304) applies. *(done)*
- **Tier 1 — RENDER** (headless browser): JS-rendered non-CF pages. Unconditional GET (browsers don't 304);
  kept cheap by low cadence + reading-status/lifecycle gating (WP-27) — render only READING/PLANNED sources, and
  only where plain fetch under-reads.
- **Tier 2 — feed-trigger + manual schedule**: CF-challenged sites. The feed drives "new chapter"; the owner's
  editable schedule drives the predicted "now free", notified the day after the predicted date.

## Component 1 — the render endpoint (hosting-agnostic)

The app needs one thing: a callable **`render(url) → post-JS HTML`** endpoint it can reach over HTTPS. The *interface*
is fixed; *where it runs* is a swappable deployment choice (below), mirroring ADR-0001's "swappable fetch target"
ethos.

- **Interface:** `POST /render` with `{ url, waitForSelector?, timeoutMs? }` → `200 { status, finalUrl, html }`
  (the browser's post-render DOM), or a typed error. A `GET /health` for liveness.
- **Auth:** a shared secret (`RENDER_SECRET`) in an `Authorization: Bearer` header, checked constant-time.
- **Behavior:** navigate, wait for network-idle (or `waitForSelector` when a per-host config names the TOC element),
  return `document.documentElement.outerHTML`. One browser context per request; hard navigation timeout.
- **Implementation:** `playwright-core` + a serverless-friendly Chromium (`@sparticuz/chromium`) so the same code runs
  as a serverless function *or* a long-lived server. Lives in `services/renderer/` (own `package.json` + Dockerfile),
  importing nothing from `src/`.

### Renderer hosting — free-tier options (Decision D-1)

**Correction to the earlier plan note ("not Vercel serverless"):** headless Chromium *can* run on Vercel functions via
`@sparticuz/chromium` + `playwright-core`. It's viable, with caveats. Options, cheapest-first:

| Option | Free tier | Fit / caveats |
|--------|-----------|---------------|
| **0. Vercel function** (same project) | Included in current Hobby plan | **No new host or bill.** But function timeout (Hobby ≤ 60s) and ~1 GB memory make a cold Chromium launch on a heavy page tight; couples renderer to the app's platform. **Prototype first** — if a real target page renders within the limit, this wins on simplicity. |
| **1. Google Cloud Run** | Generous monthly free (scales to **zero** between requests; billed only while rendering) | Container, 1–2 GB/req, no idle cost. Best headroom-per-dollar for infrequent cron renders; likely fully free at one-user volume. Bundle Chromium at build time. |
| **2. AWS Lambda + `@sparticuz/chromium`** | 1M req + 400k GB-s/mo | Well-trodden; container image up to 10 GB sidesteps the 250 MB layer limit. Scale-to-zero. |
| **3. Oracle Cloud Always-Free ARM VM** | **Free forever** (Ampere A1, up to 24 GB RAM / 4 OCPU) | A real always-on box **you fully control** → anonymity-max, no cold starts, no per-request caps. Cost: setup/ops, and Oracle may reclaim idle Always-Free instances. |
| **4. Render.com / Koyeb free web service** | 1 free service, ~512 MB, spins down on idle | Simplest Docker deploy; 512 MB is tight but works for single-page renders; cold start on wake (fine for a cron). |

**Privacy note across all of these:** unlike a vendor unblocker (a product built around fetching-and-logging your
URLs), these run *your* code — no third party harvests your reading list as a service. Strictness ranking: owned box
/ Oracle VM > cloud function you deploy > managed PaaS. Because the interface is fixed, the owner can start on Vercel
(option 0) and migrate to Cloud Run or an Oracle VM later without touching app code.

**Recommendation:** prototype **option 0 (Vercel)** — it may make WP-17b nearly free of new infra. If page renders
bump the function timeout, fall back to **Cloud Run** (free, scale-to-zero, more headroom); choose the **Oracle VM**
if the owner wants a box they own with zero cold starts.

### How the app calls it (the seam)

The renderer plugs into the **existing injected-fetch architecture** — it is just another implementation of the
fetch port. A `renderFetch(url): Promise<PoliteResult>` adapter calls `POST /render`, maps the result into the same
`PoliteResult` shape `parseToc`/orchestration already consume, and classifies failures onto the health
`FailureType`s (timeout, 5xx, etc.). No conditional-GET fields (render responses have no ETag). `lib/` stays pure;
only a new adapter + orchestration branch change.

## Component 2 — per-source fetch mode + escalation

Add a **`fetchMode`** to `Source`: `PLAIN` (default) | `RENDER`. (`UNBLOCK` is intentionally *not* added — YAGNI
until Tier 2-via-vendor is ever chosen.)

- **Orchestration** ([`pollSource`](../../../src/server/services/poll.ts)) selects the fetch port by
  `src.fetchMode`: `PLAIN` → `politeFetch`, `RENDER` → `renderFetch`. Everything downstream (`parseToc`, diff,
  access) is unchanged — the renderer just supplies fuller HTML.
- **Becoming RENDER (escalation heuristic):** during a poll or at add-time, if a page-watch source fetched via PLAIN
  returns `200`, is **not** a CF challenge, is **not** a feed, and `parseToc` yields **0** chapters (or fewer than a
  low threshold), flag it `RENDER` and persist — one self-correcting upgrade, then it stays rendered. A `403
  cf-mitigated` response does **not** escalate to RENDER (rendering won't help a CF wall); it marks the source
  CF-blocked so the UI can prompt for a release schedule. A **manual override** lets the owner force a mode.
  *(Heuristic thresholds are a guess until real data — Decision D-2.)*

## Component 3 — manual release schedule (no-fetch fallback)

For fully-blocked sites (and any series the owner simply wants to predict), an **optional, editable per-series
schedule** produces "a release is likely available" notifications with **zero fetching** — the most private path.

- **Model (on `Series`):** a nullable schedule made of a **cadence** (`releaseCadenceDays: Int?`, e.g. 7 = weekly,
  1 = daily) + an **anchor** (`releaseAnchoredOn: DateTime?`, a known past release the cadence counts from), a
  free-text `releaseNote: String?` (e.g. "advance chapters go free ~2 weeks later"), and `scheduleLastNotifiedAt:
  DateTime?` to de-dupe. Editable at any time — translators change cadence. *(A cadence+anchor recurrence is chosen
  over storing explicit future dates so it keeps predicting after the owner stops updating it.)*
- **Pure logic (`lib/schedule.ts`, test-first):** `nextDueRelease(schedule, now): Date | null` — project predicted
  release dates forward from the anchor by the cadence, and return the most recent predicted date `D` for which
  **`now >= D + 1 day`** (the day-after buffer, since time-of-day is unknown and tightness isn't needed) and `D` is
  newer than `scheduleLastNotifiedAt`. Returns `null` when nothing is due. Fully pure and unit-tested; no clock,
  no I/O — `now` is injected.
- **Wiring:** the cron, after polling, evaluates schedules for CF-blocked (or any scheduled) series, emits a
  notification effect when one is due, and stamps `scheduleLastNotifiedAt`. It runs **independently of any fetch**, so
  it works even when the source is 100% blocked.
- **What it predicts:** a generic "release you're waiting for" — copy stays neutral ("a new/free chapter is likely
  up"). *(Whether to distinguish new-chapter vs locked→free is Decision D-3; MVP keeps it generic.)*
- **UI:** a small editable schedule panel on the series-detail page (cadence, anchor date, note). Ships with the
  frontend already in place (WP-10); no new framework.

## Data model changes (Prisma)

```prisma
enum SourceFetchMode { PLAIN RENDER }         // new

model Source {
  // …
  fetchMode SourceFetchMode @default(PLAIN)    // new
}

model Series {
  // …
  releaseCadenceDays     Int?                  // new — recurrence period in days
  releaseAnchoredOn      DateTime?             // new — a known release the cadence counts from
  releaseNote            String?               // new — free text, owner's own reminder
  scheduleLastNotifiedAt DateTime?             // new — de-dupe schedule notifications
}
```

One additive migration; all columns nullable; no backfill. `SourceType` (FEED/PAGE_WATCH) is unchanged and
orthogonal — `fetchMode` is *how* we fetch, `type` is *what we parse*.

## Data flow

```
cron/poll
 ├─ for each active source in {READING, PLANNED}:               (WP-27 gating)
 │    fetchMode == PLAIN  → politeFetch ─┐
 │    fetchMode == RENDER → renderFetch ─┤→ parseToc/parseFeed → diff → persist (access)
 │    (PLAIN 200 & !CF & !feed & 0 chapters ⇒ escalate to RENDER, persist)
 │    (PLAIN 403 cf-mitigated ⇒ mark CF-blocked; keep feed trigger)
 └─ for each series with a schedule:
      nextDueRelease(schedule, now) != null ⇒ emit "likely available" notify + stamp
```

## Error handling & health

- **Renderer down / timeout:** `renderFetch` maps to the same `TIMEOUT`/`HTTP_5XX` health outcomes as a normal fetch,
  so an unreachable renderer degrades that source's health exactly like any flaky fetch — no special case, and the
  rest of the poll run is unaffected.
- **Renderer returns a CF page anyway:** treated as a failed render (few/no chapters) → source flips toward
  CF-blocked, not an infinite RENDER retry loop.
- **Schedule with no anchor/cadence:** `nextDueRelease` returns `null` — inert, never notifies.
- **Clock:** schedule logic takes an injected `now`; the cron passes the real clock, tests pass fixtures.

## Testing

- `lib/schedule.ts` — pure, TDD: due/not-due across cadences, the day-after buffer boundary, de-dupe vs
  `scheduleLastNotifiedAt`, null/degenerate schedules, DST-agnostic day math.
- `renderFetch` adapter — unit-tested with a fake HTTP impl (success → `PoliteResult`; 5xx/timeout → health
  outcomes), mirroring the `politeFetch` tests.
- `pollSource` — a `RENDER`-mode source calls the render port; the PLAIN-200-but-empty escalation path sets
  `fetchMode = RENDER`; a `403 cf-mitigated` marks CF-blocked and does **not** escalate.
- Integration (real DB, fake ports) — a `RENDER` source persists chapters; a scheduled series emits a due
  notification and stamps the timestamp; re-run does not double-notify.
- Renderer service — a couple of black-box tests against a local fixture page (its own suite under
  `services/renderer/`), not in the main Vitest projects.

## Open decisions (for owner review)

- **D-1 Renderer hosting:** prototype Vercel (option 0) → Cloud Run → Oracle Always-Free VM, per the table above.
  Affects ops, not app code (interface is fixed).
- **D-2 Escalation heuristic:** auto-escalate on "0 chapters from a 200 non-CF page", plus manual override — is
  auto-escalation wanted, or manual-only to start? Thresholds need real-data tuning.
- **D-3 Schedule semantics:** keep the notification generic, or let the owner tag a schedule as "new chapter" vs
  "locked→free" for clearer copy?

## Rollout / WP breakdown

This spec covers two independently shippable pieces; suggest splitting the tracker rows:

- **WP-17b (renderer tier):** `services/renderer/` + `renderFetch` adapter + `Source.fetchMode` + escalation. Depends
  WP-17. Hosting per D-1.
- **WP-29 (manual release schedule):** `lib/schedule.ts` (pure) + `Series` schedule fields + cron wiring + detail-page
  editor. Independent of the renderer (no-fetch), so it can land first and immediately helps the CF sites. Depends
  WP-07, WP-10; pairs with WP-09 (push) for delivery.

## References

- `@sparticuz/chromium` (serverless Chromium for Lambda/Vercel) — https://github.com/Sparticuz/chromium
- Playwright on AWS Lambda (challenges/solutions) — https://www.browsercat.com/post/running-playwright-on-aws-lambda-challenges-solutions
- Playwright on Google Cloud Run (scale-to-zero) — https://www.testmuai.com/software-testing-questions/playwright-on-google-cloud-run/
- Hosting Playwright in the cloud (free options) — https://leapcell.io/blog/how-to-host-playwright-for-free
