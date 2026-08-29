# WP-28h — Per-theme Scenes, Cards & Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `scroll` and `sci-fi` themes a full *scene* identity beyond color/type — scroll = ink-tree + drifting petals on a mauve ground with rolled-parchment cards, a wax-seal badge, and an opened-scroll detail; sci-fi = a full holographic environment (glassy chrome, perspective grid + shimmer-binary backdrop with flicker + glitch, translucent HUD glass cards + detail). Night is untouched except a shared hero tweak.

**Architecture:** All treatments layer through the existing WP-28b `:root[data-theme="…"]` token/CSS mechanism — no new theming machinery. A reusable client `ThemeScene` renders the decorative layer (tree/petals or grid/binary/glitch) into the `.hero`, `.login`, and an app-wide backdrop; two pure libs supply hydration-safe deterministic scatter and env-resolved asset URLs. Licensed images (wax seal, tree) are gitignored and served from Vercel Blob in prod; a missing **or unreachable/404** endpoint degrades via `<img> onError` to *no tree* and a *plain red-circle* wax seal (no SVGs).

**Tech Stack:** Next.js App Router (modified — consult `node_modules/next/dist/docs/` before app-code changes), TS strict, Tailwind v4 `@theme`, `next/font` (fonts already loaded from WP-28b), Vitest (unit), Playwright (e2e), Vercel Blob (asset hosting).

**Design source of truth (port CSS/markup from these):** `docs/superpowers/plans/wp28h-spikes/scenes-and-cards.html` (hero scenes + cards) and `docs/superpowers/plans/wp28h-spikes/detail-treatments.html` (detail treatments). These are the approved spikes.

## Global Constraints

- **Night stays byte-identical** EXCEPT the one shared hero change below. Do not touch night's `@theme` values.
- **Hero "here" is NOT emphasized** (owner: "at all"). Neutralize `.hero__title em` (font-style normal, color inherit) — all themes incl. night. This is the only night-visible change; call it out in the completion report.
- **Scroll palette → mauve:** page ground → soft mauve; **parchment reserved for cards/scrolls/detail** (the `--color-surface` tokens), not the page. Accent stays cinnabar `#9e2b25`.
- **Sci-fi = full holographic environment:** iridescent shimmer (cyan `#37e0d8` → blue `#5aa6ff` → violet `#a98bff`) on title/rims/glows; glassy translucent chrome (header/buttons/inputs/selects); perspective grid + shimmer-binary backdrop; **binary flickers and a glitch bar jumps** (both reduced-motion-gated); translucent HUD glass cards + detail.
- **Hydration-safe:** decorative scatter (petals, binary) uses **deterministic fixed positions** (no `Math.random`/`Date.now` at runtime). Card markup (rolls, `.hud`, wax badge) is identical SSR↔client and only *styled* per theme via CSS. Zero "hydrat…" console warnings.
- **`prefers-reduced-motion: reduce`** → static scene: no petal fall, **no binary flicker, no glitch**. Reuse the existing global reduced-motion rule + explicit `animation:none` on scene elements.
- **Assets — robust fallback (owner-confirmed):** `wax-seal.png` + `scroll-tree.png` are **gitignored** (kept locally in `public/themes/` for dev). Each is loaded via `resolveAssetUrl(name, base)`:
  - **base unset** → returns `null` → no `<img>` rendered → fallback (tree: nothing; wax: red circle).
  - **base set but URL unreachable / 404 / wrong file** → `<img>` mounts and its **`onError`** fires → same fallback. So a stood-up fork with a bad/missing endpoint degrades gracefully, not just an unset base.
  - Fallbacks: **tree renders nothing**; **wax seal → plain CSS red circle** (NO svg). `public/themes/CREDITS.md` stays committed.
- **Scenes appear on:** empty hero (`.hero`), login + add (both use `.login`), and a **toned-down app-wide backdrop** behind shelf/detail. Info cards stay opaque (scroll) / glass-but-legible (sci-fi) — the backdrop never bleeds through content.
- **TDD** for `lib/` logic; **verify** (`npm test` + `npm run typecheck`) before any done-claim; **anonymity** (no real site/series names); commit per task; PLAN/CHANGELOG bookkeeping on completion.

---

### Task 0: Branch + gitignore the licensed assets

**Files:** `.gitignore` (modify); `public/themes/` (assets present locally on branch `wp-28h-theme-scenes`).

- [ ] **Step 1: Confirm** — `git branch --show-current` (expect `wp-28h-theme-scenes`); `ls public/themes/` (expect `wax-seal.png`, `scroll-tree.png`, `CREDITS.md`).
- [ ] **Step 2: Gitignore the two images (keep CREDITS)** — append to `.gitignore`:

```
# WP-28h licensed theme images — served from Vercel Blob in prod; kept locally for dev only (see public/themes/CREDITS.md)
/public/themes/*.png
```

- [ ] **Step 3: Untrack the PNGs if staged (keep local files)**

```bash
git rm --cached --ignore-unmatch public/themes/wax-seal.png public/themes/scroll-tree.png
git status --porcelain public/themes
```
Expected: `CREDITS.md` tracked; PNGs ignored; local files still present.

- [ ] **Step 4: Commit**

```bash
git add .gitignore public/themes/CREDITS.md docs/superpowers/plans/wp28h-spikes docs/superpowers/plans/2026-08-28-wp28h-theme-scenes.md
git commit -m "WP-28h: gitignore licensed theme images; add plan + spike reference"
```

---

### Task 1: `lib/scatter.ts` — deterministic hydration-safe scatter (pure, TDD)

**Files:** Create `src/lib/scatter.ts`; Test `tests/unit/scatter.test.ts`.

**Interfaces:** `interface ScatterItem { leftPct: number; topPct: number; scale: number; delaySec: number; durSec: number }`; `scatter(count: number, seed: number): ScatterItem[]` — deterministic, 2-dp, `leftPct/topPct` ∈ [0,100), `scale` ∈ [0.6,1.5), `delaySec` ∈ [-14,0], `durSec` ∈ [7,15).

- [ ] **Step 1: Failing test**

```ts
// tests/unit/scatter.test.ts
import { describe, expect, test } from 'vitest';
import { scatter } from '../../src/lib/scatter';

describe('scatter', () => {
  test('deterministic: same (count, seed) → identical output', () => {
    expect(scatter(20, 1)).toEqual(scatter(20, 1));
  });
  test('different seed → different layout', () => {
    expect(scatter(20, 1)).not.toEqual(scatter(20, 2));
  });
  test('count controls length; values stay in range', () => {
    const items = scatter(30, 7);
    expect(items).toHaveLength(30);
    for (const it of items) {
      expect(it.leftPct).toBeGreaterThanOrEqual(0); expect(it.leftPct).toBeLessThan(100);
      expect(it.topPct).toBeGreaterThanOrEqual(0); expect(it.topPct).toBeLessThan(100);
      expect(it.scale).toBeGreaterThanOrEqual(0.6); expect(it.scale).toBeLessThan(1.5);
      expect(it.durSec).toBeGreaterThanOrEqual(7); expect(it.durSec).toBeLessThan(15);
      expect(it.delaySec).toBeLessThanOrEqual(0); expect(it.delaySec).toBeGreaterThanOrEqual(-14);
    }
  });
});
```

- [ ] **Step 2: Run — fail** (`npm test -- scatter`).
- [ ] **Step 3: Implement (mulberry32 PRNG)**

```ts
// src/lib/scatter.ts
export interface ScatterItem { leftPct: number; topPct: number; scale: number; delaySec: number; durSec: number; }

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export function scatter(count: number, seed: number): ScatterItem[] {
  const next = rng(seed);
  const items: ScatterItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      leftPct: r2(next() * 100), topPct: r2(next() * 100),
      scale: r2(0.6 + next() * 0.9), delaySec: r2(-next() * 14), durSec: r2(7 + next() * 8),
    });
  }
  return items;
}
```

- [ ] **Step 4: Pass** (`npm test -- scatter`).
- [ ] **Step 5: Commit** — `git add src/lib/scatter.ts tests/unit/scatter.test.ts && git commit -m "WP-28h: deterministic hydration-safe scatter (lib/scatter.ts)"`

---

### Task 2: `lib/themeAssets.ts` — env-resolved asset URLs (pure, TDD)

**Files:** Create `src/lib/themeAssets.ts`; Test `tests/unit/themeAssets.test.ts`.

**Interfaces:** `type ThemeAssetName = 'scroll-tree.png' | 'wax-seal.png'`; `resolveAssetUrl(name: ThemeAssetName, base: string | undefined): string | null` — `<base>/<name>` (trailing slashes normalized) when base is non-empty, else `null`.

- [ ] **Step 1: Failing test**

```ts
// tests/unit/themeAssets.test.ts
import { describe, expect, test } from 'vitest';
import { resolveAssetUrl } from '../../src/lib/themeAssets';

describe('resolveAssetUrl', () => {
  test('joins base + name, normalizing a trailing slash', () => {
    expect(resolveAssetUrl('wax-seal.png', 'https://blob.example.com/themes')).toBe('https://blob.example.com/themes/wax-seal.png');
    expect(resolveAssetUrl('wax-seal.png', 'https://blob.example.com/themes/')).toBe('https://blob.example.com/themes/wax-seal.png');
  });
  test('local base works', () => {
    expect(resolveAssetUrl('scroll-tree.png', '/themes')).toBe('/themes/scroll-tree.png');
  });
  test('missing/empty base → null (caller falls back)', () => {
    expect(resolveAssetUrl('scroll-tree.png', undefined)).toBeNull();
    expect(resolveAssetUrl('scroll-tree.png', '')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — fail** (`npm test -- themeAssets`).
- [ ] **Step 3: Implement**

```ts
// src/lib/themeAssets.ts
export type ThemeAssetName = 'scroll-tree.png' | 'wax-seal.png';

/** URL from a configured base (Vercel Blob in prod, /themes in dev), or null when unset so callers
 *  render their fallback. A base that IS set but 404s/unreachable is handled by the <img> onError,
 *  not here. */
export function resolveAssetUrl(name: ThemeAssetName, base: string | undefined): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${name}`;
}
```

- [ ] **Step 4: Pass** (`npm test -- themeAssets`).
- [ ] **Step 5: Commit** — `git add src/lib/themeAssets.ts tests/unit/themeAssets.test.ts && git commit -m "WP-28h: env-resolved theme asset URLs (lib/themeAssets.ts)"`

---

### Task 3: `globals.css` — scroll mauve palette, sci-fi shimmer tokens, hero "here" de-emphasis

**Files:** Modify `src/app/globals.css`.

- [ ] **Step 1: De-emphasize the hero title `em` (all themes)** — near `.hero__title`:

```css
/* WP-28h: "here" is no longer emphasized in any theme (owner). */
.hero__title em { font-style: normal; color: inherit; }
```
Remove any theme-block rule that colored `.hero__title em`.

- [ ] **Step 2: Scroll → mauve ground; parchment stays on surfaces** — in `:root[data-theme="scroll"]`:

```css
  --color-ink: #c4afb8;      /* page ground → soft mauve (was parchment) */
  --color-ink-2: #b79fac;
  --color-surface: #f2e8cf;  /* parchment — cards/scroll/detail */
  --color-surface-2: #efe4c9;
  /* text/muted/line/glow/on-glow stay as WP-28b (sepia ink, cinnabar) — verify contrast on mauve */
```

- [ ] **Step 3: Sci-fi shimmer tokens** — in `:root[data-theme="sci-fi"]`:

```css
  --holo-1: #8ff6ee; --holo-2: #37e0d8; --holo-3: #5aa6ff; --holo-4: #a98bff;
```

- [ ] **Step 4: Verify** — `npm run dev`: night unchanged except plain "here"; scroll page mauve, cards parchment. `npm run typecheck` + `npm test` clean.
- [ ] **Step 5: Commit** — `git add src/app/globals.css && git commit -m "WP-28h: scroll mauve ground + sci-fi shimmer tokens + de-emphasize hero 'here'"`

---

### Task 4: `globals.css` — card + detail treatments

**Files:** Modify `src/app/globals.css`. **Port from spikes** (prefix every rule with the theme attribute so night stays isolated).

- [ ] **Step 1: Scroll rolled-scroll card** — port `.scroll .card`, `.scroll .roll`, `.roll--l/--r`, `.scroll .card__title/__num/__latest/__meta` from `scenes-and-cards.html`, each prefixed `:root[data-theme="scroll"]`. (Wax badge = Task 6.)
- [ ] **Step 2: Sci-fi HUD glass card** — port `.scifi .card` (chamfer `clip-path`, translucent cyan fill `linear-gradient(150deg,rgba(55,205,215,.20),rgba(90,160,225,.24))` + `backdrop-filter`, `::after` masked gradient rim), `.scifi .card-wrap` glow, `.scifi .card__body` (left pad for accent bar), and `.hud` decorations (`.accent`, `.br--tl/--br`, `.chev`, `.hatch`, `.flare` — **no squares**), each prefixed `:root[data-theme="sci-fi"]`.
- [ ] **Step 3: Scroll opened-scroll detail** — from `detail-treatments.html`, port `.scroll .detail` (top/bottom rods `::before/::after`, side deckle, parchment) + `.scroll .chapter/__num/__title/__mark`, prefixed `:root[data-theme="scroll"]`.
- [ ] **Step 4: Sci-fi holographic detail** — port `.scifi .detail` (HUD brackets + scanlines) + `.scifi .chapter/...`, prefixed `:root[data-theme="sci-fi"]`.
- [ ] **Step 5: Verify** — drive scroll/sci-fi shelf + a detail page; confirm treatments render, themes isolated, text legible. `npm run typecheck` + `npm test` clean.
- [ ] **Step 6: Commit** — `git add src/app/globals.css && git commit -m "WP-28h: card + detail treatments (rolled scroll / HUD glass; opened scroll / holo panel)"`

---

### Task 5: `globals.css` — sci-fi chrome + scene/backdrop motif (incl. glitch) + reduced-motion

**Files:** Modify `src/app/globals.css`.

- [ ] **Step 1: Glassy chrome (sci-fi only)** — prefix `:root[data-theme="sci-fi"]`. Port `scenes-and-cards.html` `.appbar/.btn2/.sel` treatments onto real classes: `.appHeader` (frosted + blur + cyan border glow), `.btn`/`.btn--primary` (glassy iridescent), `.shelf-select`/`.shelf-search`/`.control select`/`.login__input` (glassy), and `.brand__name em` + hero title get iridescent gradient-text. Night/scroll chrome unchanged.

- [ ] **Step 2: Scene + backdrop motif classes** (rendered by Task 6's `ThemeScene`):

```css
.themeScene { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.themeScene--appwide { position: fixed; z-index: -1; opacity: 0.5; }

/* scroll: tree + drifting petals */
:root[data-theme="scroll"] .themeScene__tree { position: absolute; left: -70px; bottom: 0; height: 96%; width: auto; opacity: .92; }
:root[data-theme="scroll"] .themeScene__petal { position: absolute; width: 9px; height: 12px; background: var(--color-glow);
  border-radius: 60% 60% 60% 0 / 70% 70% 40% 40%; animation: wp28h-fall linear infinite; }
@keyframes wp28h-fall { 0%{transform:translateY(-40px) rotate(0);opacity:0} 12%{opacity:.85} 100%{transform:translateY(940px) rotate(320deg) translateX(30px);opacity:.12} }

/* sci-fi: grid + horizon + flickering binary + glitch bar — port exact values from scenes-and-cards.html */
:root[data-theme="sci-fi"] .themeScene__grid { /* …port .grid… */ }
:root[data-theme="sci-fi"] .themeScene__horizon { /* …port .horizon… */ }
:root[data-theme="sci-fi"] .themeScene__bit { position: absolute; white-space: nowrap; font-family: var(--font-mono);
  color: var(--holo-2); animation: wp28h-flick 3s steps(2) infinite; }
@keyframes wp28h-flick { 0%,100%{opacity:.4} 50%{opacity:.12} }
/* GLITCH bar — a cyan line that jumps intermittently (owner wants glitch/motion kept) */
:root[data-theme="sci-fi"] .themeScene__glitch { position: absolute; left: 0; right: 0; height: 2px;
  background: rgba(120,230,255,.55); mix-blend-mode: screen; animation: wp28h-glitch 6s infinite; }
@keyframes wp28h-glitch { 0%,90%,100%{opacity:0; top:20%} 91%{opacity:1; top:38%} 94%{opacity:1; top:61%} 96%{opacity:.6; top:47%} }
```
On `--appwide`, hide the tree/grid/horizon/glitch and use the lower-density petal/binary counts (Task 6 passes fewer); cards stay opaque/legible above it.

- [ ] **Step 3: Reduced-motion — stop petals, flicker, AND glitch**

```css
@media (prefers-reduced-motion: reduce) {
  .themeScene__petal,
  :root[data-theme="sci-fi"] .themeScene__bit,
  :root[data-theme="sci-fi"] .themeScene__glitch { animation: none !important; }
  :root[data-theme="sci-fi"] .themeScene__glitch { opacity: 0 !important; }
}
```

- [ ] **Step 4: Verify** — sci-fi hero: binary flickers, glitch bar jumps, grid visible, chrome glassy; emulate reduced-motion → all motion stops. `npm run typecheck` + `npm test` clean.
- [ ] **Step 5: Commit** — `git add src/app/globals.css && git commit -m "WP-28h: sci-fi chrome + scene motif (grid/binary flicker/glitch) + reduced-motion"`

---

### Task 6: `ThemeScene` + `WaxBadge` (robust fallback) + wire scenes/cards across surfaces

**Files:** Create `src/app/(app)/ThemeScene.tsx`, `src/app/(app)/WaxBadge.tsx` (client); Modify `src/app/(app)/page.tsx`, `src/app/login/page.tsx`, `src/app/(app)/add/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/Shelf.tsx`, `src/app/globals.css`.

**Interfaces:** consumes `scatter` (T1), `resolveAssetUrl` (T2), `isThemeId`/`ThemeId` (WP-28b `lib/theme`). Produces `<ThemeScene variant="hero"|"appwide" />` and `<WaxBadge count={number} />`.

- [ ] **Step 1: `ThemeScene.tsx`** — SSR renders nothing (hydration-safe); fills post-mount from the applied theme. Sci-fi includes flickering bits + the glitch bar (motion, reduced-motion-gated by CSS). Tree `<img onError>` → hide.

```tsx
'use client';
import { useEffect, useState } from 'react';
import { scatter } from '../../lib/scatter';
import { resolveAssetUrl } from '../../lib/themeAssets';
import { isThemeId, type ThemeId } from '../../lib/theme';

const ASSET_BASE = process.env.NEXT_PUBLIC_THEME_ASSET_BASE;

/** Deterministic short binary string per index (no RNG at render → hydration-safe). */
function binaryString(i: number): string {
  const len = (i % 6) + 1; let s = ''; let n = (i * 2654435761) >>> 0;
  for (let k = 0; k < len; k++) { s += (n & 1).toString(); n = n >>> 1; }
  return s;
}

export function ThemeScene({ variant }: { variant: 'hero' | 'appwide' }) {
  const [theme, setTheme] = useState<ThemeId | null>(null);
  const [treeBroken, setTreeBroken] = useState(false);
  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    setTheme(isThemeId(attr) ? attr : 'night');
  }, []);
  if (!theme || theme === 'night') return null;

  const cls = `themeScene${variant === 'appwide' ? ' themeScene--appwide' : ''}`;
  const hero = variant === 'hero';

  if (theme === 'scroll') {
    const treeUrl = resolveAssetUrl('scroll-tree.png', ASSET_BASE);
    const petals = scatter(hero ? 26 : 12, 42);
    return (
      <div className={cls} aria-hidden="true">
        {hero && treeUrl && !treeBroken && (
          <img className="themeScene__tree" src={treeUrl} alt="" onError={() => setTreeBroken(true)} />
        )}
        {petals.map((p, i) => (
          <span key={i} className="themeScene__petal" style={{
            left: `${p.leftPct}%`, top: hero ? undefined : `${p.topPct}%`,
            transform: `scale(${p.scale})`, animationDuration: `${p.durSec}s`, animationDelay: `${p.delaySec}s`,
          }} />
        ))}
      </div>
    );
  }
  // sci-fi
  const bits = scatter(hero ? 70 : 34, 91);
  return (
    <div className={cls} aria-hidden="true">
      {hero && <><span className="themeScene__grid" /><span className="themeScene__horizon" /><span className="themeScene__glitch" /></>}
      {bits.map((b, i) => (
        <span key={i} className="themeScene__bit" style={{ left: `${b.leftPct}%`, top: `${b.topPct}%` }}>{binaryString(i)}</span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `WaxBadge.tsx` — real `<img>` so a set-but-broken URL degrades via `onError`**

```tsx
'use client';
import { useState } from 'react';
import { resolveAssetUrl } from '../../lib/themeAssets';
const ASSET_BASE = process.env.NEXT_PUBLIC_THEME_ASSET_BASE;

export function WaxBadge({ count }: { count: number }) {
  const url = resolveAssetUrl('wax-seal.png', ASSET_BASE);
  const [broken, setBroken] = useState(false);
  const hasSeal = Boolean(url) && !broken; // false when base unset OR the image failed to load
  return (
    <span className={`card__unread${hasSeal ? ' card__unread--seal' : ' card__unread--noseal'}`}>
      {hasSeal && <img className="card__unread-img" src={url as string} alt="" onError={() => setBroken(true)} />}
      <span className="card__unread-num">{count}</span>
    </span>
  );
}
```
Add CSS (Task 6 Step 5): `.card__unread-img` hidden by default; the seal look + visible img only under scroll; the `--noseal` red-circle only under scroll; night/sci-fi keep their pill/chip on `.card__unread` and show the `--num` (+ a CSS `::after{content:" new"}` under night/sci-fi, suppressed under scroll):

```css
.card__unread-img { display: none; }
/* night/sci-fi keep the existing pill/chip; append " new" after the number */
:root:not([data-theme="scroll"]) .card__unread-num::after { content: " new"; }
/* scroll: wax seal (image) or red-circle fallback, number stamped in the centre */
:root[data-theme="scroll"] .card__unread { position: relative; background: none; border: 0; padding: 0;
  width: 50px; height: 50px; display: grid; place-items: center; }
:root[data-theme="scroll"] .card__unread--seal .card__unread-img { display: block; position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
:root[data-theme="scroll"] .card__unread--noseal { width: 34px; height: 34px; background: #9e2b25; border-radius: 50%; }
:root[data-theme="scroll"] .card__unread-num { position: relative; z-index: 1; color: #fbeee2; font-family: var(--font-display); font-weight: 700;
  text-shadow: 0 1px 2px rgba(60,10,8,.8), 0 0 3px rgba(0,0,0,.5); }
```

- [ ] **Step 3: Card markup (theme-agnostic; styled per theme)** — in `Shelf.tsx` `SeriesCard`: add two `<span className="roll roll--l/--r" aria-hidden />` inside `.card` (styled only under scroll); add the `.hud` decoration block as a sibling of `.card` inside `.card-wrap` (styled only under sci-fi); replace the `{unread} new` span with `<WaxBadge count={unread} />` (rendered when `unread > 0`). Markup is identical across themes → hydration-safe.

- [ ] **Step 4: Mount scenes** — `<ThemeScene variant="hero" />` inside the `.hero` (EmptyState, `page.tsx`) and inside the `.login` container (`login/page.tsx` and the add page's `.login` section). `<ThemeScene variant="appwide" />` once in `(app)/layout.tsx` (behind `<main>`) and in the login route. Ensure hero/login are `position: relative; isolation: isolate` (already true in globals) so the scene sits behind content.

- [ ] **Step 5: Add the WaxBadge CSS** from Step 2 to `globals.css`.

- [ ] **Step 6: Verify in the running app** (set `NEXT_PUBLIC_THEME_ASSET_BASE=/themes` for dev) — night (no scene, amber pill), scroll (mauve + tree + petals + rolled cards + wax seal / opened-scroll detail), sci-fi (grid + flickering binary + glitch + glassy chrome + HUD cards / holo detail) across hero, login, add, shelf, detail. **Console: zero "hydrat…" warnings.** Then test the fallback: unset the env (or point at a bad base) and confirm scroll hero shows no tree and the badge is a red circle. `npm run typecheck` + `npm test` clean.

- [ ] **Step 7: Commit** — `git add src/app/\(app\)/ThemeScene.tsx src/app/\(app\)/WaxBadge.tsx src/app/\(app\)/page.tsx src/app/login/page.tsx src/app/\(app\)/add/page.tsx src/app/\(app\)/layout.tsx src/app/\(app\)/Shelf.tsx src/app/globals.css && git commit -m "WP-28h: ThemeScene + WaxBadge (onError red-circle fallback) + wire scenes/cards"`

---

### Task 7: Owner-review screenshots (real app, per surface + fallback)

**Files:** Create `e2e/theme-scenes-screens.spec.ts` (`screenshots/` already gitignored).

- [ ] **Step 1: Spec** — for `['scroll','sci-fi']` × screens (`/` empty hero, `/settings`, `/login`, a seeded `/series/[id]`, `/add`): `addInitScript` sets `localStorage.theme`, assert `html[data-theme]`, screenshot to `screenshots/wp28h/<theme>-<screen>.png`. Add a **fallback** capture: run once with an unreachable base (`page.addInitScript` won't set env; instead run this spec/project with `NEXT_PUBLIC_THEME_ASSET_BASE` unset) → capture scroll hero (no tree) + a card (red-circle wax). Wait on assertions, not sleeps.
- [ ] **Step 2: Run + report** — e2e DB (per `e2e/README.md`) with `NEXT_PUBLIC_THEME_ASSET_BASE=/themes` for the main pass; a second run with it unset for the fallback shot. Report the absolute `screenshots/wp28h/` path + that they're real-app screenshots (not AI-generated). Pause for owner review.
- [ ] **Step 3: Commit** the spec only — `git add e2e/theme-scenes-screens.spec.ts && git commit -m "WP-28h: owner-review screenshot spec (scenes + fallback)"`

---

### Task 8: E2E coverage + checklist

**Files:** Create `e2e/theme-scenes.spec.ts`; Modify `e2e/README.md`.

- [ ] **Step 1: Spec** — (a) night: no `.themeScene__petal`/`__bit` render; (b) scroll: `.themeScene__petal` present on hero, card badge is `.card__unread--seal` (base set) or `.card__unread--noseal` (base unset run); (c) sci-fi: `.themeScene__bit` present, `.themeScene__glitch` present; (d) hydration: no console message matching `/hydrat/i` on `/settings` load under a non-night saved theme. Class/role assertions, no sleeps.
- [ ] **Step 2: Run** (e2e DB + `NEXT_PUBLIC_THEME_ASSET_BASE=/themes`) — pass.
- [ ] **Step 3: Append to `e2e/README.md`** "What's covered": `theme-scenes.spec.ts — WP-28h: per-theme scene layers (petals / binary+glitch) + wax badge + hydration-clean.`
- [ ] **Step 4: Commit** — `git add e2e/theme-scenes.spec.ts e2e/README.md && git commit -m "WP-28h: e2e scene + hydration coverage"`

---

### Task 9: Vercel Blob provisioning (owner-run) + env wiring + docs

**Files:** Create `scripts/upload-theme-assets.mjs`; add env docs (`.env.example` if present, else a `docs/` note + README pointer).

**Non-blocking** (app works via fallbacks + local `/themes` in dev). Vercel CLI isn't installed here + Blob needs the owner's account → upload is **owner-run**. When implementing, load `vercel:vercel-storage` (or `marketplace`) for the current Blob API.

- [ ] **Step 1: Upload script** (`@vercel/blob`, dev dep):

```js
// scripts/upload-theme-assets.mjs
import { put } from '@vercel/blob';
import { readFileSync } from 'node:fs';
for (const name of ['wax-seal.png', 'scroll-tree.png']) {
  const { url } = await put(`themes/${name}`, readFileSync(`public/themes/${name}`), {
    access: 'public', addRandomSuffix: false, contentType: 'image/png',
  });
  console.log(name, '→', url);
}
console.log('\nSet NEXT_PUBLIC_THEME_ASSET_BASE to the common base (…/themes) in Vercel + .env');
```

- [ ] **Step 2: Env docs** — document `NEXT_PUBLIC_THEME_ASSET_BASE`: dev `/themes`; prod = Blob base; **unset or unreachable → no tree + red-circle wax** (graceful). Add to `.env.example` if present; else a `docs/` note.
- [ ] **Step 3: Owner steps (documented, not run here)** — create a Blob store on the Vercel project; `BLOB_READ_WRITE_TOKEN=… node scripts/upload-theme-assets.mjs`; set `NEXT_PUBLIC_THEME_ASSET_BASE` in Vercel to the printed base; redeploy.
- [ ] **Step 4: Commit** — `git add scripts/upload-theme-assets.mjs docs .env.example && git commit -m "WP-28h: Vercel Blob upload script + asset env docs (owner-run provisioning)"`

---

### Task 10: PLAN/CHANGELOG bookkeeping + close-out

**Files:** `PLAN.md`, `docs/PLAN-archive.md`, `docs/CHANGELOG.md`; remove the spike reference folder.

- [ ] **Step 1: Verify** — `npm test` + `npm run typecheck` pass (capture output).
- [ ] **Step 2: PLAN.md** — add `WP-28h` to ✅ Completed (theme scenes/cards/detail + Blob assets); flip its active-queue row if present; update the WP-28 umbrella note. Note the asset/license handling (Blob + onError fallback) and the hero "here" de-emphasis (the one night-visible change).
- [ ] **Step 3: CHANGELOG.md** — dated 2026-08-28 entry: scroll mauve + tree/petals/rolled-scroll/wax-seal/opened-scroll; sci-fi full holo env (glassy chrome + grid/binary-flicker/glitch/shimmer + HUD glass cards/detail); hydration-safe scatter; reduced-motion; licensed assets via Vercel Blob with tree-hidden / red-circle fallback (incl. set-but-unreachable); hero "here" de-emphasized.
- [ ] **Step 4: Remove spike folder** — `git rm -r docs/superpowers/plans/wp28h-spikes`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "docs: WP-28h done — theme scenes/cards/detail + Blob assets"`
- [ ] **Step 6: Stop at the WP boundary** — report with fresh `npm test` + `npm run typecheck` output + `screenshots/wp28h/` paths; leave the branch, present push/PR as the owner's call.

---

## Notes for the executor

- **Read the modified-Next docs** before editing `layout.tsx`/pages.
- **Hydration is the top risk.** `ThemeScene`/`WaxBadge` render an SSR-safe baseline and fill/adjust post-mount; card markup (rolls, `.hud`, badge) is identical SSR↔client and only *styled* per theme via CSS. Never branch card markup on the theme at render time. Task 8 asserts no "hydrat…" warnings.
- **Fallback is `onError`-driven** — works for a set-but-dead/404 base, not just an unset one. Verify by pointing the env at a bad base (Task 6 Step 6 / Task 7 fallback shot).
- **Motion:** sci-fi keeps binary flicker + the glitch bar; scroll keeps petal fall — all gated by `prefers-reduced-motion`.
- **Night isolation.** Every scroll/sci-fi rule is scoped `:root[data-theme="…"]`; the only intentional night-visible change is the hero `em` de-emphasis (Task 3 Step 1) — flag it in the report.
- **Port, don't reinvent.** The spike files carry exact CSS values; port them, prefixing selectors with the theme attribute. Screenshot the real app (Task 7) and compare to the spikes.
