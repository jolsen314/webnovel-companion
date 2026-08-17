# Webnovel Companion

A personal, installable web app (PWA) that tracks the translated webnovels you read across many different sites and sends a push notification the moment a tracked series releases a new chapter — including when a paid "advance" chapter becomes free.

Built with Next.js (App Router) + TypeScript, Postgres/Prisma, and Web Push; deployed on Vercel + Neon.

> A personal, single-user project. Please read **[Legal posture & scope](#legal-posture--scope)** below.

---

## What it does

- **One library across many sites.** Paste a series' URL and it's tracked on a single shelf, wherever the translation lives.
- **Automatic new-chapter detection.** Each series resolves to a *source*:
  - a **release feed** (RSS/Atom) auto-discovered from the page, or
  - a **watched TOC page** (page-watch) that's diffed when there's no feed.

  Site-wide, multi-novel feeds are isolated to the one series by per-novel category or URL-path. A scheduled job polls sources, diffs against stored chapters (on a stable per-chapter key, not title or position), and pushes on genuinely new ones.
- **"Now free" for advance/paid chapters.** On sites that release chapters paid-first, free-later, it tracks each chapter's free/locked state off the TOC and fires a distinct notification when the free frontier advances — separate from "new chapter."
- **Handles blocked / JS-heavy sites.** A headless renderer reads JavaScript-rendered or Cloudflare-challenged tables of contents. When a site can't be read at all, you can still add it as a **link-only** shelf entry (organize it + keep a quick link, no auto-tracking).
- **Source health.** Each source is monitored with hysteresis — transient blips are ignored; sustained or strong failures (NXDOMAIN, a parking page) raise a "source may be down" signal.
- **Installable + Web Push.** Runs as a PWA; on iOS, push works after Add-to-Home-Screen (16.4+). Subscriptions are device-verified.
- **Manual reading state.** Per-series status, star rating, mark-read with unread counts, hand-editable title, and one-click delete.
- **Single-user auth gate.** A passphrase gate that fails **closed** in production.

## How it works

Two independent tracks meet at your library:

- **Releases (what's new)** — a per-series *source* (a feed or a watched TOC). A daily [Vercel Cron](vercel.json) job runs the full poll: it diffs each source against stored chapters and sends Web Push for new chapters and free-frontier advances. An optional GitHub Actions workflow ([`poll.yml`](.github/workflows/poll.yml)) fires a lighter feed-only poll every ~2 hours for faster notifications (see [Deployment](#deployment-vercel--postgres)). Polling is status- and cadence-gated and self-limits to a time budget so a busy shelf stays within the hosting quota.
- **Progress (where you are)** — a manual current-chapter marker, plus per-series status, rating, and unread counts.

The interesting logic — feed diffing, TOC parsing, the source-health state machine — lives in `src/lib/**`, kept pure and framework-free so it unit-tests without a browser or database. Route handlers stay thin and call `src/server/services`. Fetching user-supplied URLs goes through an SSRF guard.

## Running it locally

Requires Node 22+ and a local Postgres.

```bash
cp .env.example .env          # fill in DATABASE_URL (+ optional keys below)
npm install
npx prisma migrate dev        # create the schema in your dev database
npm run dev                   # http://localhost:3000
```

Optional environment (each has a safe local default):

- **Web Push** — generate keys with `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and `VAPID_SUBJECT`.
- **Auth gate** — set `AUTH_PASSWORD_HASH` (`npm run auth:hash -- "your passphrase"`) and `AUTH_SECRET` (a random 32-byte base64url string). Without them the gate is **off in dev** (for convenience) and **fails closed in production**.
- **Headless renderer** (for JS-rendered / Cloudflare TOCs) — set `RENDER_URL` (and optional `RENDER_SECRET`). Unset means page-watch is plain-fetch only.

Tests:

```bash
npm test                      # unit (Vitest) — the pure lib/ logic
npm run typecheck
DATABASE_URL="postgresql://…/webnovel_test" npm run test:integration   # Postgres whose name contains "test"
npm run test:e2e              # Playwright — see e2e/README.md
```

## Deployment (Vercel + Postgres)

1. **Provision Postgres** (Neon, Vercel Postgres, or Supabase — any plain Postgres) and copy its connection string.
2. **Import the repo into Vercel.** Set `DATABASE_URL`, `AUTH_SECRET` + `AUTH_PASSWORD_HASH` (required — the gate fails closed without them), `CRON_SECRET` (a random string Vercel Cron sends as a Bearer token that `/api/cron/poll` checks), and the `VAPID_*` keys for push.
3. **Migrations run on deploy** via `vercel-build` (`prisma migrate deploy && next build`); `postinstall` runs `prisma generate`.
4. **Daily cron** is configured in [`vercel.json`](vercel.json): `/api/cron/poll` runs once a day (08:00 UTC), a full poll of every source — which is all the Vercel Hobby plan allows.
5. **(Optional) More frequent polling — free.** Since Hobby cron only fires daily, the included [`Frequent poll`](.github/workflows/poll.yml) GitHub Actions workflow calls the poll endpoint every ~2 hours on the cheap **feed-only** tier (`?tier=plain`) — catching feed releases faster, without the heavier render/TOC work or extra database compute. Enable it by adding two **repository secrets**: `POLL_URL` (your deployed `…/api/cron/poll` URL) and `CRON_SECRET` (the same value as the Vercel env). It also runs on-demand via *Run workflow*.
6. **Install as a PWA** from the browser's Add-to-Home-Screen / Install App.

**CI** (GitHub Actions) runs typecheck, unit tests, `next build`, and — in separate jobs with a Postgres service — the integration and Playwright E2E suites.

## Tech stack

- **Next.js (App Router) + TypeScript (strict)** — PWA frontend + API
- **Tailwind** — styling
- **Postgres + Prisma** — data + migrations
- **web-push (VAPID)** — server-side Web Push
- **rss-parser** — feed parsing (with conditional GET)
- **Vercel + Vercel Cron** (+ a GitHub Actions poll trigger) — hosting + the poll jobs
- **Vitest** (unit + integration) **+ Playwright** (E2E) — GitHub Actions CI

## Design notes & etiquette

Track and link — never rehost chapter content. Prefer feeds; use conditional requests (`ETag` / `If-Modified-Since`), honor `304`, respect `robots.txt` and rate limits, and back off on errors. Page-watch mode is a scoped fallback (one TOC page per series), not a crawler.

## Legal posture & scope

Fan translations of unlicensed web novels are unauthorized derivative works, and public aggregators that link to them navigate real facilitator/takedown exposure. This project is built and scoped for **personal, single-user** use — it links to sites you already visit and hosts or redistributes nothing. Running it beyond that (a shared/multi-user instance, or a public service) changes the legal profile significantly and should be treated as a new undertaking, with qualified legal counsel consulted first. *(Nothing here is legal advice.)*

---

## License

Licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

The AGPL's network-copyleft means anyone who runs a modified version as a network service must make their source available. Copyright holder inquiries about alternative/commercial licensing are welcome.