# Feed ↔ TOC: backfill + switch to lock-monitoring

**Date:** 2026-07-26
**Status:** Design accepted (brainstorm). Split into a buildable-now slice and a Cloudflare-gated slice — see Sequencing.
**Depends on / reuses:** WP-07 (poll), WP-17 (page-watch/`parseToc`), WP-17b (RENDER escalation), WP-20 (`becameFree`).
**Relates to:** WP-19 (non-destructive re-pointing), WP-27 (PLANNED seeds a summary), WP-31 (tab-membership access), WP-RC (dense-feed reconcile).

## Problem

A feed-based source only ever sees the **feed window** (the most recent ~10–30 items): no older-chapter backfill,
and every chapter it stores is `access: UNKNOWN` (a feed can't report lock state). Lock state and the full chapter
list live **only in the TOC**. So two things a feed series can't do on its own:

1. **Backfill** — recover the chapters older than the feed window.
2. **"Now free" (WP-20)** — detect a `LOCKED → FREE` unlock, since the feed never carries `LOCKED` and never
   re-emits the unlock.

**The driving constraint:** a feed cannot tell us a chapter is locked. So we can't auto-detect "this feed series has
locked chapters" from the feed — the lock state is only visible once we read the TOC.

## Design

Two independent operations, both built on the same "fetch TOC → `parseToc` → diff → persist" path; they differ in
what they do with the result and whether they change the active source.

### A. Backfill (one-time; feed stays the ongoing source)

Read the TOC once and **union its full chapter list** into the series' stored chapters. The `FEED` source keeps
polling afterward. Fixes the feed-window gap.

- **At add (READING series):** `addSeries` already fetches the pasted page, which for a feed series is almost always
  the TOC. Seed the **full** chapter list from `parseToc(page.body)` instead of only `filterBySeriesMatch(feed)`.
  *(PLANNED series still seed a summary per WP-27; full backfill on →READING.)*
- **On-demand (existing series):** a per-series **"Backfill from TOC"** action, for series already in production that
  were added feed-only. **Explicit action, not a re-add** — re-adding risks a duplicate `Series`; backfill unions
  into the existing one.
- Backfilled chapters are inserted with the TOC's access (`FREE`/`LOCKED`) directly — they are `new` to the diff.

### B. Switch to lock-monitoring (ongoing; TOC replaces the feed)

Flip the source to `PAGE_WATCH` so the TOC becomes what polls; the feed is deactivated. For the subset of series that
need unlock tracking. The valuable event for paid/advance series is the *unlock*, which the feed never re-emits, so
"fully switch" (not hybrid) is the right end state.

- **At add:** after `parseToc(page.body)`, if the TOC shows `LOCKED` chapters, choose `PAGE_WATCH` even though a feed
  exists. Otherwise default to `FEED`.
- **Manual override (per series):** a **"Track unlocks (switch to TOC)"** action, for what add-time detection missed —
  which will be the JS/CF/tab sites whose un-rendered page shows no lock markers (the WP-31 cases). The schema already
  stores the reading/TOC page as `Source.url`, separate from `feedUrl`, so the switch flips `type FEED→PAGE_WATCH` and
  polls `url`. A plain TOC that under-reads self-upgrades to RENDER via the existing WP-17b escalation.

### The critical building block: silent access-reconcile (`UNKNOWN → FREE/LOCKED`)

WP-20 fires only on `LOCKED → FREE`. Feed-stored chapters are `UNKNOWN`. So the **first** TOC read of a switched (or
backfilled) series must **silently** set each already-stored chapter's access from `UNKNOWN` to the TOC's `FREE`/
`LOCKED` — **no notification** (it is *learning* current state, not observing an unlock). This is what **arms** "now
free": a chapter must be known-`LOCKED` before its unlock can fire.

- New diff dimension alongside `new`/`becameFree`, e.g. `accessReconciled: KnownChapter[]` — already-seen chapters
  whose **stored access was `UNKNOWN`** and whose **fetched access is `FREE` or `LOCKED`**.
- Persistence updates those rows' `access` (by stored id, per the WP-20 identity fix) with **no `becameFreeAt`, no
  push**. `UNKNOWN → FREE` and `UNKNOWN → LOCKED` are both silent; only a later `LOCKED → FREE` is a "now free" event.
- This also prevents a **notification storm** on the first post-switch poll (dozens of chapters reconciling at once
  must not each fire a push).

### The main risk: feed-url ↔ TOC-url identity coherence

Dedup relies on the feed's chapter link and the TOC's anchor canonicalizing to the **same** URL. `canonicalUrl`
already strips `utm_*`/fragments and sorts query params (covers the spike findings), but if a site's feed permalinks
differ **structurally** from its TOC hrefs, the diff won't match them → the **same chapter stored twice** (once feed,
once TOC). Mitigations to include when built: a reconcile/merge step keyed on a looser identity (e.g. chapter number
within a series) for the switch/backfill transition, and a verification pass against a real dual-source series before
trusting the dedup. **Cannot be validated yet** — see Sequencing.

## What's new vs. reuse

- **New:** the silent `accessReconciled` diff dimension + persistence; add-time TOC-lock probe and full-backfill
  seeding in `addSeries`; the two per-series actions (backfill, switch) + their UI; a transition-time identity
  reconcile.
- **Reuse:** `parseToc`, the diff/persist path and the WP-20 stored-id persistence, RENDER escalation, the
  `url`-vs-`feedUrl` schema split, and the WP-19 "re-pointing = flip a source / `isActive`" convention.

## Sequencing (Cloudflare gating)

The owner's only current feed-with-locked sites are **also Cloudflare-challenged**: their `/feed/` serves but their
**TOC (HTML page) is CF-blocked** (403 `cf-mitigated`), so plain page-watch 403s and the renderer likely can't pass
the challenge (the deferred "unblocker" problem; those sites use WP-29 manual schedule today). This splits the work:

- **Buildable & testable now (no CF dependency):** Backfill (A) + the silent access-reconcile building block. Validate
  on any non-CF feed site — backfill fills the full history; reconcile marks access (mostly `FREE` on those sites).
- **Designed but dormant:** the switch → "now free" on a feed series (B end-to-end). The mechanism can be built and
  fixture-tested, but real validation needs a **reachable** locked-TOC-with-feed site. All current such sites are
  CF-blocked → gated on either a non-CF locked+feed site appearing, or the CF-unblock story landing. Until then those
  sites remain WP-29 (manual schedule) territory.

## Proposed work packages

- **WP-33 (buildable now)** — Full-TOC backfill: seed the full chapter list at add (READING) + a per-series "Backfill
  from TOC" action; and the **silent `accessReconciled`** diff dimension + persistence.
- **WP-34 (mechanism buildable; real value CF-gated)** — Feed→TOC switch to lock-monitoring: add-time lock detection
  (prefer `PAGE_WATCH` when the TOC shows locks) + a per-series "Track unlocks" switch action, with the transition-time
  identity reconcile. Fixture-testable; end-to-end "now free on a switched feed series" awaits a reachable locked+feed
  TOC.

## Out of scope

- The Cloudflare unblocker itself (separate deferred problem).
- A persistent hybrid (feed + TOC both ongoing). Decided against: full switch for lock-monitoring, feed-default
  otherwise, TOC touched once for backfill.
- Tab-membership access (WP-31) — a switched tab-site would still need that to classify locked chapters.
