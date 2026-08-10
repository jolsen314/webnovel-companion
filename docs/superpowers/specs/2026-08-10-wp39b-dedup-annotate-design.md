# WP-39b (re-scoped) — deeper add-dedup: tocUrl page-watch key + create-then-annotate

**Status:** design approved 2026-08-10. Depends on WP-37 (per-series `tocUrl`, done) and WP-30 (clean titles,
done). Builds on WP-39 (add-time `canonicalSeriesId` dedup).

**Re-scope decision (owner, 2026-08-10).** The original WP-39b listed three residuals: (a) page-watch
home-vs-TOC, (b) multi-novel re-add matcher-type-flip, (c) two undetectably-multi-novel novels both →
`#WHOLE_FEED`. (b) and (c) pull in opposite directions (a looser key to catch (b) is exactly a looser key
that wrongly merges (c)), and (c)'s "real fix" — teaching the matcher to infer novel identity from a
signal-less feed — is an open-ended lift for rare single-user edge cases. So this pass does **(a)** plus a
**create-then-annotate soft net** that captures (b)'s spirit and structurally de-risks (c) (a false match
becomes a non-blocking notice, never a silent block or silent merge). True matcher intelligence (c) is
deferred until a real incident proves it necessary.

## Design

### 1. (a) `tocUrl`-keyed page-watch dedup (silent hard-dedup)

`canonicalSeriesId` (`src/lib/dedup.ts`) currently keys a page-watch series on `canonical(sourceUrl)`.
Change it to key on `canonical(tocUrl ?? sourceUrl)` — `addSeries` already resolves `tocUrl` (WP-37) and
threads it through `ResolvedCore`, so pass it in. Effect: a series added via its home URL (whose `tocUrl`
resolved to the chapter TOC) and one added via the TOC URL directly both key on the TOC → silently
collapse to one series, no duplicate row. Feed series are unaffected (still keyed on `feedUrl#matcher`).

**Going-forward only (owner decision).** `canonicalId` is computed and *stored* at add-time, so this only
hard-matches when both sides used the new formula. Existing page-watch rows keep their stored
`canonical(home)` key and are **not** recomputed — the §2 title-annotate net backstops those via title.
No migration, no backfill.

Low false-positive risk: two *different* page-watch series colliding on one `tocUrl` requires `findTocUrl`
to resolve the same TOC for both, which means they genuinely share a chapter list.

### 2. Title-similarity detection (pure, surface-variant net)

New pure `findSimilarTitle(candidate: string, existing: { id: string; title: string }[]): { id: string;
title: string } | null` in `src/lib/dedup.ts`. Normalize both sides — lowercase, strip
punctuation/whitespace, drop a leading article (`the `/`a `/`an `) — then match when **either** normalized
string **equals** the other, or one **contains** the other as a whole (catches "Silver Moon Saga" ↔ "The
Silver Moon Saga" / an added subtitle). Returns the first/best match, else `null`.

**Deliberately not fuzzy.** Edit-distance / token-overlap only catch surface variants (which containment
already covers) while adding false-positive noise. Crucially, **this cannot catch a different *translation*
of the same work** — different English renderings often share no characters (e.g. an invented pair like
"Crimson Lotus Chronicle" vs "The Blooddark Saint"), scoring ~0 under any string comparator. That is an
accepted, documented limit; the
cross-translation case is handled by **manual merge** (WP-CLEANUP-UI, §4) and, later, a canonical work ID
(WP-WORKID, §4) — not by a smarter string match.

### 3. Create-then-annotate flow (`addSeries` + route + client)

Today: exact `canonicalId` match → return existing (`alreadyExisting`, HTTP 200); else create (201). Add a
middle path on the **create** branch only (the hard-dedup of §1 still takes precedence and is unchanged):

- Before returning the created series, run `findSimilarTitle(resolvedTitle, <the user's existing series>)`
  (a new port supplies the existing `{ id, title }` list).
- If a similar title is found, **still create** (create-then-annotate — never block), and include
  `similarTo: { id, title }` in the 201 response.
- The add UI surfaces it as a **non-blocking notice**: *"Added '<new>'. Looks similar to '<existing>' you
  already track — Open / Merge."* "Open" navigates to the existing series now; "Merge" is a link that lands
  when WP-CLEANUP-UI ships (until then, `db:cleanup merge-series` remains the merge tool).

Nothing is ever blocked or silently merged; the response gains an optional hint. When hard-dedup already
matched, or nothing is similar, `similarTo` is absent.

### 4. New WPs to file (scope only — not built in this pass)

- **WP-CLEANUP-UI** — in-app cleanup surfacing the `db:cleanup` operations (delete series, **merge series**,
  delete/reset chapters, edit source/TOC URL). Its **merge** is explicitly scoped to double as the manual
  **same-work / different-translation resolver** — fold one series into another by canonical-URL union of
  chapters + reading progress + source. This is the target of §3's "Merge" affordance. Depends on WP-10.
- **WP-WORKID** *(future, low)* — map a source to a community novel-aggregator's **canonical work ID**
  (which lists a work's alternative/translated titles) to get an *automatic* cross-translation identity.
  External dependency + mapping logic; described generically in committed docs (anonymity rule). Depends on
  WP-05/WP-17.

## Testing & verification

- **Unit (pure, TDD)** — extend `tests/unit/dedup.test.ts`:
  - `canonicalSeriesId` keys page-watch on `tocUrl ?? sourceUrl`: a home-add (with a resolved `tocUrl`) and
    a TOC-add sharing that TOC collapse to one id; two different TOCs stay distinct; feed keying unchanged.
  - `findSimilarTitle`: normalized-equality + containment match; article/punctuation/whitespace
    insensitivity; returns `null` for genuinely different titles **including a different-translation pair
    (documents the known limit)**; `null` when the list has nothing similar.
- **Integration** — `addSeries` includes `similarTo` on the create branch when an existing title is similar,
  and omits it when hard-dedup already matched or nothing is similar. Existing add/dedup tests stay green.
- **Gates** — `npm test` + `npm run typecheck` green (agreement #3). **No schema change** (going-forward
  keying + a response field + a pure title match — no migration).

## Definition of Done

A page-watch series re-added via a different URL that resolves to the same `tocUrl` is silently deduped
(going forward); an add whose title closely matches an existing series still succeeds but returns a
`similarTo` hint the add UI shows as a non-blocking "Open / Merge" notice; `findSimilarTitle` and the
`tocUrl` keying are unit-tested (pure), the `similarTo` response path is integration-tested, and the two
follow-up WPs (WP-CLEANUP-UI, WP-WORKID) are filed in PLAN.md. No migration.

## Out of scope (deferred)

- True multi-novel matcher intelligence for undetectable-multi-novel feeds — the original (c); revisit
  reactively if a real incident occurs.
- Matcher-type-flip keying — the original (b); the title-annotate net covers its spirit without a looser,
  riskier key.
- In-app cleanup/merge UI → WP-CLEANUP-UI. Automatic cross-translation identity → WP-WORKID.
- Fuzzy / edit-distance title matching → rejected (noise without solving the translation case).