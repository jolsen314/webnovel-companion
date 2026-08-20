---
name: db-cleanup-cli
description: >-
  Usage guidance and safety gotchas for THIS project's `db:cleanup` maintenance CLI
  (scripts/cleanup-series.ts) — list/prune-chapters/delete-series/reset-chapters/set-source-url/
  merge-series/backfill/reclassify-source/set-api-descriptor. Consult this BEFORE constructing or
  running any `npm run db:cleanup -- …` command, converting a series to an API source, writing a
  `set-api-descriptor` `--map`/`pagination` descriptor, choosing `--render`, or advising the owner
  on any of these — even when the request doesn't name the command (e.g. "point this series at its
  JSON API", "delete/merge these series", "repoint a moved source", "backfill missing chapters").
  These commands write to a real database and have sharp, silent-failure edges (dry-run vs --apply,
  which DB, set-api-descriptor's `perPage` double-set), so don't hand-build one from memory.
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
