# WP-28b — Theme system (pluggable themes + picker)

**Status:** design approved 2026-08-28. Depends on WP-10 (library/detail UI, done). Child of the WP-28 umbrella.
Ships the **theme architecture** + a settings picker + **three token-swap themes** (night default, cultivation
ancient-scroll, sci-fi holographic-panel). The **bookshelf theme is out of scope → WP-28f** (feasibility spiked;
see Plan bookkeeping).

## Problem

The app has a single baked-in "night reading" identity: design tokens live in one Tailwind v4 `@theme` block and
`:root { color-scheme: dark }` in [`globals.css`](../../../src/app/globals.css), with no switching machinery. The
owner wants a **pluggable theme system with a user picker**, keeping night as the unchanged default and adding two
more full identities.

**What makes this tractable:** every component styles through hand-written CSS classes that read `var(--color-*)` /
`var(--font-*)`. **Zero components read a hardcoded color and none use Tailwind color utilities in JSX** (verified by
grep). So theming is purely *redefining those custom properties per theme* — no component markup changes. The one
snag is a small handful of **baked hex constants** in `globals.css` that assume night (see §1c).

The one hard requirement is **no flash on reload** (FOUC) and no hydration mismatch — the trap the chapter-display
and notes toggles already navigate — *and* the choice must survive closing/restarting the app (incl. an installed
PWA relaunch). localStorage satisfies persistence (durable per-origin, not session-scoped); an inline pre-paint
script satisfies no-flash.

## Design

### 1. Token architecture (`globals.css`) — the load-bearing part

Keep the current `@theme` block as the **night defaults** (unchanged — DoD requires night stays byte-identical in
look). Add two override blocks keyed to a root attribute, at raised specificity so they reliably beat base `:root`:

```css
:root[data-theme="scroll"] {
  --color-ink: …; --color-surface: …; --color-paper: …; --color-glow: …; --color-on-glow: …;
  --font-display: var(--font-cinzel), Georgia, serif;
  --font-sans: var(--font-eb-garamond), Georgia, serif;
  color-scheme: light;   /* parchment is a light surface */
}
:root[data-theme="sci-fi"] {
  --color-ink: …; --color-glow: …; --color-on-glow: …;
  --font-display: var(--font-chakra), system-ui, sans-serif;
  --font-sans: var(--font-space-grotesk), system-ui, sans-serif;
  color-scheme: dark;
}
```

- `night` needs **no** override (it's the `@theme` default); `data-theme="night"` simply matches the defaults.
- Each theme sets its own `color-scheme` so native form controls / scrollbars render correctly (scroll = light;
  night + sci-fi = dark). The base `:root { color-scheme: dark }` stays as the night default.

**(1a) Candidate palettes** (final hexes are the `frontend-design` pass — these set direction):
- **night** (unchanged): warm ink `#15131a`, paper `#ece4d6`, amber lamp-glow `#e7b15c`.
- **scroll — cultivation ancient-scroll** (light): aged-parchment page `#ded2b4` / surface `#e8dcc0`, sepia-ink text
  `#3a2c1a`, muted `#8a765a`, hairline `#c8b78f`; accent = a **cinnabar wax-seal red** `#9e2b25` (or antique gold
  `#b08828` — pick in the design pass). `--color-on-glow` flips to a light parchment so text on the accent stays legible.
- **sci-fi — holographic-panel** (dark): near-black blue `#070b12` / glassy panel `#0d1522` / `#142032`, cyan-tinted
  hairline `#1e3350`, text `#d6e8f2`, muted `#6f8aa6`; accent = **cyan panel-glow** `#37e0d8` (or `#4cc4ff`).
  `--color-on-glow` = a dark slate so text on the cyan reads.

**(1b) Motifs (pure CSS, no image assets).** The accent recolor via `--color-glow` makes the existing lamp-glow
radials (hero/login `::before`) and the bookmark ribbon follow for free. Then a small, theme-scoped decorative layer:
- **scroll:** a subtle parchment paper-texture on `body` (layered CSS gradients — no bitmap), and the amber radial
  reworked as a soft ink-wash / wax-seal bloom in the accent red.
- **sci-fi:** a faint scanline/panel-glow overlay (`repeating-linear-gradient` + a cyan radial) scoped to the hero/login.

Scoped as `:root[data-theme="scroll"] .hero::before { … }` etc., bounded to: `body` background, hero/login glow, and
the ribbon accent. **If any motif is better served by a bitmap than CSS, it will be flagged with its file path and
whether it was generated — but the intent is pure-CSS/hand-drawn (no generated art in this WP.)**

**(1c) Tokenize the baked constants (small cleanup this WP needs).** Two hardcoded hexes assume night and must become
a token so themes can flip them: `.btn--primary { --btn-fg: #241a09 }` and `.card__unread { color: #241a09 }` (the
"dark ink on amber" foreground). Introduce **`--color-on-glow: #241a09`** in `@theme` (night default) and reference it
in both places; each theme block overrides it. Health-dot status colors stay as-is (semantic, theme-agnostic).

### 2. Theme registry + no-flash (`src/lib/theme.ts`, pure, Next-free — TDD target)

A single source of truth for the theme set and the inline script:

```ts
export type ThemeId = 'night' | 'scroll' | 'sci-fi';
export const DEFAULT_THEME: ThemeId = 'night';
export const THEME_STORAGE_KEY = 'theme';
export const THEMES: readonly { id: ThemeId; label: string; blurb: string; themeColor: string; swatch: string[] }[] = […];
export function isThemeId(v: unknown): v is ThemeId { … }
export function resolveTheme(v: string | null): ThemeId { return isThemeId(v) ? v : DEFAULT_THEME; }
export function buildThemeScript(): string { … } // returns the inline IIFE string, built from the constants above
```

`themeColor` per theme drives the PWA `<meta name="theme-color">` (night `#15131a`, scroll parchment, sci-fi near-black).
`buildThemeScript()` interpolates the valid-id list, storage key, default, and the id→themeColor map into a tiny
dependency-free IIFE — so the script and the app share one definition. The script:

```js
(function(){try{
  var valid=["night","scroll","sci-fi"], t=localStorage.getItem("theme");
  if(valid.indexOf(t)===-1) t="night";
  document.documentElement.setAttribute("data-theme", t);
  var m=document.querySelector('meta[name="theme-color"]'), c={night:"#15131a",scroll:"…",sci-fi:"…"};
  if(m) m.setAttribute("content", c[t]);
}catch(e){}})();
```

Purity holds (no `next`/`prisma`/`fs`/network); it only builds a string. The route/layer boundary stays clean — the
layout imports the pure builder.

### 3. Root layout (`src/app/layout.tsx`)

- Load the new theme font families via `next/font/google` alongside the existing three, each exposed as a CSS variable
  (`--font-cinzel`, `--font-eb-garamond`, `--font-chakra`, `--font-space-grotesk`); add their `.variable`s to the
  `<html className>`. **Shared mono:** keep IBM Plex Mono as the mono across all three themes to bound font weight
  (mono is least identity-bearing; a per-theme mono can be added later if wanted).
- Add `suppressHydrationWarning` to `<html>`. **Do not** render `data-theme` server-side — the inline script adds it
  before paint, so React never owns/reconciles it and there's no mismatch.
- Inject `buildThemeScript()` as the **first child of `<body>`** via `<script dangerouslySetInnerHTML>`, so it runs
  synchronously before the app paints. Body bg (`body{background:var(--color-ink)}`) then resolves against the correct
  `[data-theme]` on first paint → no flash.
- **Font-load tradeoff (noted):** `next/font` loads all theme families up front (it can't lazy-load per client-chosen
  theme); mitigated by `display:swap`, `subsets:['latin']`, and tight weight lists. Acceptable for a personal PWA.

### 4. Picker (`src/app/(app)/settings/ThemePicker.tsx`, client) — settings page only

A new panel on the settings page, matching the existing `.settings__panel` idiom:
- Initializes state from `document.documentElement.getAttribute('data-theme')` (client-only; fallback `DEFAULT_THEME`).
- Renders `THEMES.map` as a labelled option group (radio semantics), each row showing the label + blurb + a small
  **swatch** (a few palette chips from `theme.swatch`).
- On select: set `document.documentElement` `data-theme`, write `localStorage[THEME_STORAGE_KEY]`, update the
  `<meta name="theme-color">`, and update local state — **instant, no reload.**
- **Attribute-only, no React context** (decision): only the picker reads the value and CSS does the theming, so a
  global `ThemeProvider`/`useTheme` context would add a high client boundary for nothing. Rejected alternative:
  context + hook.

`SettingsPage` renders `<ThemePicker />` as a new panel (it's already a client component). No server/prop changes.

## Testing

- **TDD `src/lib/theme.ts`** (unit project): `isThemeId` accepts the three ids and rejects junk/`null`/`undefined`;
  `resolveTheme(null|unknown)` → `DEFAULT_THEME`, `resolveTheme('scroll')` → `'scroll'`; `buildThemeScript()` output
  contains the storage key, every valid id, the default fallback, and each theme's themeColor, and is a self-contained
  IIFE (functional check: run it against a minimal `document`/`localStorage` stub and assert it sets `data-theme` to
  the stored value, and to the default for a missing/garbage value).
- **E2E (WP-PW / Playwright), appended to the WP-PW checklist:** (a) fresh load with no stored theme → `html[data-theme]`
  is `night` (or absent→night default); (b) open settings, pick **sci-fi**, reload → `html[data-theme="sci-fi"]` is
  present at first document state (persistence + no-flash); (c) picking a theme updates the page live without reload.
- **Manual verification** in the running app across all screens (shelf, detail, add, settings, login) for each theme.
- `npm test` + `npm run typecheck` green before any "done" claim (project ritual).

## Plan bookkeeping (part of this WP)

- **Add `WP-28f` — Bookshelf theme** to the active queue (below the other WP-28 children), depends on **WP-28b**
  (theme architecture), **WP-28a** (shelf sort/filter control bar — needs gothic styling), **WP-28e** (delete
  affordance must work on book rows). Capture the spike result in its detail: **both a horizontal "pile of books"
  and vertical "spines on a shelf" treatment are feasible as pure scoped CSS on the existing card markup with zero
  markup changes** (spiked 2026-08-28). Tradeoff to resolve in its own brainstorm: vertical spines are denser and the
  stronger "real bookshelf" look but **truncate long titles** (fixed book height) — mitigable via hover-reveal /
  tooltip; the horizontal pile keeps full titles on one line but shows fewer per screen. Both hide `.card__latest` /
  `.card__meta` (a spine can't carry them) — an info-density decision for that WP. *(The throwaway spike HTML +
  screenshots live in the session scratchpad and are **ephemeral** — the approach is captured in prose here so nothing
  depends on those files persisting.)*
- **On completion:** WP-28b → Completed (✅ table one-liner), move any detail to `docs/PLAN-archive.md`, set the next
  `NEXT`, add a `docs/CHANGELOG.md` line. Update the WP-28 umbrella note (28b done; remaining children 28c/28e + new 28f).

## Out of scope / non-goals

- **Bookshelf theme → WP-28f** (feasibility proven; build is its own WP).
- **No OS "system/auto" follow.** Themes are explicit choices (scroll is light, night/sci-fi dark); we don't track
  `prefers-color-scheme`.
- **No header quick-switch** — picker lives on settings only (owner call).
- **No cross-device sync** — localStorage per origin; single-user app, so that's the whole story (no server persistence
  of the theme choice).
- No per-theme mono font in this pass (shared Plex Mono); can be added later.

## Definition of Done

- Switching themes from the settings picker is **instant and persistent** (survives reload and app restart) with
  **no flash** on reload and no hydration warning.
- **night is the default and visually unchanged** from today.
- **scroll** and **sci-fi** ship and cover the whole app — shelf, detail, add, settings, login — each with its palette,
  typography, and motif.
- `src/lib/theme.ts` is pure + unit-tested; the theme-apply script is derived from its constants (one source of truth).
- `npm test` + `npm run typecheck` green.
- Plan updated: WP-28b → Completed + changelog; **WP-28f (bookshelf) created** with the spike findings; next `NEXT` set.
