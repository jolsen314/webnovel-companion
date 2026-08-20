---
name: db-cleanup-cli
description: >-
  Use when the owner wants to change or repair series, sources, or chapters already in THIS
  project's database via its `db:cleanup` maintenance CLI (scripts/cleanup-series.ts, run as
  `npm run db:cleanup`). Covers intents like: delete/nuke a series and its chapters, merge two
  series, prune or reset a series' chapters, backfill missing chapters, or repoint/reclassify a
  source whose URL moved or changed — even when phrased casually and no command is named.
  ESPECIALLY use it for pointing or converting a series/source at a JSON chapter API
  (`set-api-descriptor`): writing the `--map` field-mapping (which JSON keys become chapter
  url/title/lock state), configuring pagination (per-page + page param) so ALL chapters sync
  instead of only the first page, routing through the headless renderer for Cloudflare-gated
  endpoints, or debugging why only the first page came in. These commands write to a real
  database with silent dry-run-vs-apply and pagination pitfalls, so build the command from this
  skill and docs/db-cleanup-cli.md rather than from memory. Not for adding a brand-new series
  (that's the add flow) or writing app code.
---

# db:cleanup maintenance CLI

**Full reference (read this before building a command):
[docs/db-cleanup-cli.md](../../../docs/db-cleanup-cli.md).** It documents every command's syntax,
flags, an anonymized dry-run→apply example, and the per-command gotchas. This SKILL is the trigger +
the must-not-get-wrong subset; the doc is the source of truth. Keep both in sync — put new detail in
the doc, not here.

## Always-true safety model

- **Dry-run by default.** No `--apply` → it prints the plan and writes **nothing**. Always show/run
  the dry-run first, then re-run identically with `--apply`. `list` is always read-only.
- **Which database?** It writes to whatever `DATABASE_URL` points at — default `.env` = local
  `webnovel_dev`; prod (Neon) is in gitignored `.env.prod` (`source` it deliberately to touch prod).
  The dry-run output does **not** name the DB — confirm you're on the intended one before `--apply`.
- **Anonymity.** Real hosts/series names are runtime arguments only — never write them into committed
  code, docs, or examples (use `*.example`).

## `set-api-descriptor` — the sharp edges (the rest is in the doc)

Points a source at a JSON chapter API (`type=API`, `apiUrl`, `apiMap`); leaves the human reading
`url` untouched. `--map` is the `ApiDescriptor` JSON (`urlField`/`titleField` required;
`isFreeField`+`isFreeWhen` for lock state — `"falsy"` when the field is `locked`; optional `listPath`
and `pagination`).

1. **`perPage` is set in TWO places that MUST match** — `per_page=<N>` in the `--endpoint` URL (how
   many the API returns per page) **and** `pagination.perPage:<N>` (the "short page = last page"
   threshold). Mismatch fails silently: URL smaller than descriptor → stops after page 1 (missing
   chapters); URL larger → runs to the `maxPages` cap (default 20) doing wasted fetches.
2. **`pageParam` is the page-*number* param** (usually `"page"`), the one that increments — not the
   per-page param. The per-page param name lives only in the URL. **Leave `page` out of `--endpoint`.**
3. **`--render`** = fetch the API through the headless renderer to clear Cloudflare (CF-gated
   endpoints); omit it for an un-gated public API. Needs `RENDER_URL`/`RENDER_SECRET` to render.

When a request involves any of these, read the doc and build the command from it rather than from
memory — the failure modes above are silent.
