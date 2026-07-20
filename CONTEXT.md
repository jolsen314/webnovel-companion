# CONTEXT — domain glossary (Webnovel Companion)

Canonical terms for this domain. **Glossary only — no implementation details.** When usage in a discussion, PR, or
schema conflicts with a definition here, this file wins (or we update it deliberately). See [README](README.md) for
design, [PLAN](PLAN.md) for build order.

---

**Series** — A tracked *work* on the user's shelf: one entry per novel they follow. Owns reading progress, rating,
notes, and shelf status. Persists across translator/site changes. **Not** a specific translation or website.
De-dup identity is its `canonicalId` (a NovelUpdates id or normalized URL).

**Source** — A *fetch target* for a translation of a Series: a **feed** (RSS/Atom) or a **watched page** (TOC). A
Series accumulates Sources over time but has **exactly one active** Source at a time.

**Re-pointing** — Non-destructively switching a Series to a new Source (translator moved sites, or was taken down).
Additive: add a Source, flip which is active; never deletes history. May need a manual current-chapter reconcile
because chapter numbering differs across translations.

**Chapter** — A discovered unit of a Series, identified by its **guid and/or URL** — never by number or title.
Belongs to a Series; remembers which Source discovered it.

**Chapter number** — A *best-effort parsed ordinal* (may be decimal, missing, or absent). **Not** an identity and
**not** a guaranteed-contiguous sequence: translators split chapters (12.1/12.2, "…(3)") and use non-numeric titles.
A split part like "Chapter 407 … (3)" parses to its **base number (407)** — the "(3)" part is intentionally *not*
captured. Consequence: **completion/progress-vs-target compares the *max* parsed number, never the count of chapter
posts** — splitting a raw chapter into 3 posts adds 3 rows but they all read as 407, so post-count would overshoot
the target while max-number stays ≈ the real position. Still fuzzy by design (show the numbers, let the user judge).

**Shelf status** — The user's relationship to a Series: READING / COMPLETED / PAUSED / DROPPED / PLANNED. Say
"shelf status," not just "status."

**Translation status** — An external fact about the translation's completeness: ONGOING / STALLED / COMPLETE /
UNKNOWN. Drives plan-to-read completion watch. **Distinct** from shelf status.

**Access state** — Per-Chapter free/locked status on advance/paid-then-free sites: FREE / LOCKED / UNKNOWN.

**Free frontier** — *Derived, not stored*: the highest Chapter whose access state is FREE. Its advance fires the
"now free" event (distinct from "new chapter").

**Source match** — How to isolate one Series' items inside a feed that may be site-wide / multi-novel:
WHOLE_FEED, CATEGORY (per-novel `<category>`), or PATH_PREFIX (chapter-URL path). Chosen at add-time.

**Source health** — One Source's liveness: HEALTHY / DEGRADED / LIKELY_DOWN, driven by a weighted failure-score
accumulator with hysteresis (slow to escalate, instant to recover). Per fetch target.

**Host aggregation** — *Derived across all Sources on a host*: tells "the whole site is down" (every Source on the
host failing) from "this novel was removed/moved" (one Source fails while its host-mates are healthy). Not a stored
per-Source field.

**Owner (`userId`)** — The single user in the MVP, modeled as a bare `userId` on owned rows (no User table yet). A
Tier-4 multi-user migration stays additive: the columns already exist and the current id resolves through one
accessor, so we add a User table + FKs without reshaping data.
