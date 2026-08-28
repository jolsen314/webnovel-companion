# WP-28b — Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single baked-in "night reading" identity into a pluggable theme system with a settings picker — night (default, unchanged), cultivation "ancient scroll", and sci-fi "holographic panel" — applied before first paint with no flash and persisted across restarts.

**Architecture:** Every component already styles through `var(--color-*)`/`var(--font-*)` in hand-written CSS (no Tailwind color utilities in JSX), so a theme is just a per-theme redefinition of those custom properties under a `:root[data-theme="…"]` block. A pure `lib/theme.ts` holds the registry and builds a tiny pre-paint inline script (read localStorage → set `data-theme` on `<html>` before paint); a settings-only client picker flips the attribute + localStorage + `<meta name=theme-color>` live. No React context — CSS does the theming and only the picker reads the value.

**Tech Stack:** Next.js App Router (this is a modified Next — consult `node_modules/next/dist/docs/` before writing app code), TypeScript strict, Tailwind v4 `@theme` tokens, `next/font/google`, Vitest (unit project), Playwright (e2e).

**Spec:** [docs/superpowers/specs/2026-08-28-wp28b-theme-system-design.md](../specs/2026-08-28-wp28b-theme-system-design.md)

## Global Constraints

- **`src/lib/**` stays pure & Next-free** — no `next`/`prisma`/`fs`/network imports; `lib/theme.ts` only builds strings/values.
- **TDD for `lib/` logic** — red → green → refactor; watch each test fail for the right reason before implementing.
- **Verify before "done"** — run `npm test` **and** `npm run typecheck`, read exit codes, and include fresh output in the same message as any completion claim.
- **night default must stay visually unchanged** — night is the `@theme` default; do not alter its values.
- **No generated image assets** — motifs are pure CSS / hand-authored. The only images produced are **Playwright screenshots of the real app** (Task 6); surface their file paths + confirm they are app renders (not AI-generated) to the owner.
- **Themes are night, scroll, sci-fi only** — the bookshelf theme is out of scope (→ WP-28f).
- **Picker lives on the settings page only**, attribute-only (no `ThemeProvider`/context).
- **Persistence = `localStorage["theme"]`** — no OS `prefers-color-scheme` auto-follow, no cross-device sync (those are separate low-pri WPs filed in Task 8).
- **Anonymity** — no real site/series names in committed code or tests (use generic titles).
- Commit per task; the whole WP lands on a feature branch (Task 0). PLAN/CHANGELOG bookkeeping happens on completion (Task 8).

---

### Task 0: Feature branch

**Files:** none.

- [ ] **Step 1: Branch off main**

```bash
git checkout -b wp-28b-theme-system
```

---

### Task 1: `lib/theme.ts` — registry + validators (pure, TDD)

**Files:**
- Create: `src/lib/theme.ts`
- Test: `tests/unit/theme.test.ts`

**Interfaces:**
- Produces: `type ThemeId = 'night' | 'scroll' | 'sci-fi'`; `DEFAULT_THEME: ThemeId`; `THEME_STORAGE_KEY: string`;
  `interface ThemeMeta { id: ThemeId; label: string; blurb: string; themeColor: string; swatch: string[] }`;
  `THEMES: readonly ThemeMeta[]`; `isThemeId(v: unknown): v is ThemeId`; `resolveTheme(v: string | null | undefined): ThemeId`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/theme.test.ts
import { describe, expect, test } from 'vitest';
import { THEMES, DEFAULT_THEME, isThemeId, resolveTheme } from '../../src/lib/theme';

describe('theme registry', () => {
  test('ships exactly the three themes, night first', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['night', 'scroll', 'sci-fi']);
    expect(DEFAULT_THEME).toBe('night');
  });

  test('every theme has a label, a themeColor hex, and swatch chips', () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.themeColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(t.swatch.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('isThemeId', () => {
  test.each(['night', 'scroll', 'sci-fi'])('accepts %s', (v) => expect(isThemeId(v)).toBe(true));
  test.each(['', 'dark', 'NIGHT', null, undefined, 42])('rejects %s', (v) => expect(isThemeId(v)).toBe(false));
});

describe('resolveTheme', () => {
  test('valid id passes through', () => expect(resolveTheme('scroll')).toBe('scroll'));
  test('missing / unknown falls back to default', () => {
    expect(resolveTheme(null)).toBe('night');
    expect(resolveTheme(undefined)).toBe('night');
    expect(resolveTheme('bogus')).toBe('night');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- theme`
Expected: FAIL — cannot resolve `../../src/lib/theme`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/theme.ts
export type ThemeId = 'night' | 'scroll' | 'sci-fi';

export const DEFAULT_THEME: ThemeId = 'night';
export const THEME_STORAGE_KEY = 'theme';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  blurb: string;
  themeColor: string; // drives <meta name="theme-color">
  swatch: string[]; // palette chips for the picker
}

export const THEMES: readonly ThemeMeta[] = [
  { id: 'night', label: 'Night reading', blurb: 'Warm ink, a single amber lamp.', themeColor: '#15131a', swatch: ['#15131a', '#ece4d6', '#e7b15c'] },
  { id: 'scroll', label: 'Ancient scroll', blurb: 'Aged parchment and a cinnabar seal.', themeColor: '#ded2b4', swatch: ['#e4d8bc', '#372a18', '#9e2b25'] },
  { id: 'sci-fi', label: 'Holo panel', blurb: 'Deep slate and a cyan glow.', themeColor: '#070b12', swatch: ['#070b12', '#d6e8f2', '#37e0d8'] },
];

const THEME_IDS: readonly ThemeId[] = THEMES.map((t) => t.id);

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

export function resolveTheme(v: string | null | undefined): ThemeId {
  return isThemeId(v) ? v : DEFAULT_THEME;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- theme`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.ts tests/unit/theme.test.ts
git commit -m "WP-28b: theme registry + validators (lib/theme.ts)"
```

---

### Task 2: `buildThemeScript()` — the pre-paint inline script (pure, TDD)

**Files:**
- Modify: `src/lib/theme.ts` (append `buildThemeScript`)
- Test: `tests/unit/theme.test.ts` (append)

**Interfaces:**
- Consumes: `THEMES`, `THEME_STORAGE_KEY`, `DEFAULT_THEME` (Task 1).
- Produces: `buildThemeScript(): string` — a self-contained IIFE that reads `localStorage["theme"]`, validates it against the known ids, sets `document.documentElement`'s `data-theme` (default on miss/garbage), and updates the `theme-color` meta.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/theme.test.ts
import { buildThemeScript } from '../../src/lib/theme';

// Run the produced IIFE against minimal document/localStorage stubs. The script references
// `localStorage` and `document` as free identifiers, so a Function with those params shadows globals.
function runScript(stored: string | null) {
  const attrs: Record<string, string> = {};
  let metaColor = '';
  const document = {
    documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } },
    querySelector: (sel: string) =>
      sel.includes('theme-color') ? { setAttribute: (_k: string, v: string) => { metaColor = v; } } : null,
  };
  const localStorage = { getItem: (_k: string) => stored };
  // eslint-disable-next-line no-new-func
  new Function('localStorage', 'document', buildThemeScript())(localStorage, document);
  return { theme: attrs['data-theme'], metaColor };
}

describe('buildThemeScript', () => {
  test('applies a stored valid theme + its themeColor', () => {
    expect(runScript('scroll')).toEqual({ theme: 'scroll', metaColor: '#ded2b4' });
    expect(runScript('sci-fi')).toEqual({ theme: 'sci-fi', metaColor: '#070b12' });
  });
  test('falls back to night for missing or garbage', () => {
    expect(runScript(null).theme).toBe('night');
    expect(runScript('bogus').theme).toBe('night');
    expect(runScript(null).metaColor).toBe('#15131a');
  });
  test('never throws even with no meta tag present', () => {
    // querySelector returns null for a non-theme-color selector; script guards `if(m)`.
    expect(() => runScript('night')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- theme`
Expected: FAIL — `buildThemeScript` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/lib/theme.ts
export function buildThemeScript(): string {
  const ids = JSON.stringify(THEME_IDS);
  const colors = JSON.stringify(Object.fromEntries(THEMES.map((t) => [t.id, t.themeColor])));
  const key = JSON.stringify(THEME_STORAGE_KEY);
  const def = JSON.stringify(DEFAULT_THEME);
  return (
    `(function(){try{` +
    `var v=${ids},c=${colors},t=localStorage.getItem(${key});` +
    `if(v.indexOf(t)===-1)t=${def};` +
    `document.documentElement.setAttribute("data-theme",t);` +
    `var m=document.querySelector('meta[name="theme-color"]');` +
    `if(m)m.setAttribute("content",c[t]);` +
    `}catch(e){}})();`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- theme`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.ts tests/unit/theme.test.ts
git commit -m "WP-28b: pre-paint inline theme script builder"
```

---

### Task 3: Root layout — load theme fonts + inject the pre-paint script

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `buildThemeScript` (Task 2).
- Produces: `<html suppressHydrationWarning>` carrying all theme font `--font-*` variables; the inline script as the first child of `<body>`.

- [ ] **Step 1: Add the new font families + variables**

Add to the imports and font declarations in `src/app/layout.tsx` (alongside the existing Fraunces/Plex):

```ts
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono, Cinzel, EB_Garamond, Chakra_Petch, Space_Grotesk } from 'next/font/google';
import { buildThemeScript } from '../lib/theme';

// … existing fraunces / plexSans / plexMono declarations stay unchanged …

const cinzel = Cinzel({ subsets: ['latin'], variable: '--font-cinzel', display: 'swap', weight: ['400', '600', '700'] });
const ebGaramond = EB_Garamond({ subsets: ['latin'], variable: '--font-eb-garamond', display: 'swap', weight: ['400', '500'], style: ['normal', 'italic'] });
const chakra = Chakra_Petch({ subsets: ['latin'], variable: '--font-chakra', display: 'swap', weight: ['400', '600', '700'] });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk', display: 'swap', weight: ['400', '500', '600'] });
```

- [ ] **Step 2: Thread the variables onto `<html>`, add `suppressHydrationWarning`, and inject the script**

Replace the `RootLayout` return with:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} ${cinzel.variable} ${ebGaramond.variable} ${chakra.variable} ${spaceGrotesk.variable}`}
    >
      <body>
        {/* Applies the saved theme before first paint (no FOUC). suppressHydrationWarning on <html>
            because this script sets data-theme, which the server does not render. */}
        <script dangerouslySetInnerHTML={{ __html: buildThemeScript() }} />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
```

Leave the `metadata`/`viewport` exports as-is — `viewport.themeColor` seeds the `<meta name="theme-color">` that the script then updates.

- [ ] **Step 3: Verify typecheck + the app boots on night unchanged**

Run: `npm run typecheck`
Expected: PASS (exit 0).

Then drive the app (`npm run dev`) and confirm the shelf/login still render identically to before (night default; the script sets `data-theme="night"` which matches the `@theme` defaults). No visual change expected. (Scroll/sci-fi have no CSS yet — Task 4.)

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "WP-28b: load theme fonts + inject pre-paint theme script in root layout"
```

---

### Task 4: `globals.css` — tokenize `on-glow`, add theme blocks + motifs

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `--color-on-glow` token; `:root[data-theme="scroll"]` and `:root[data-theme="sci-fi"]` override blocks; scoped motif rules. Consumed implicitly by every component via existing `var(--color-*)`/`var(--font-*)` references.

- [ ] **Step 1: Add the `--color-on-glow` token and use it where night hardcodes `#241a09`**

In the `@theme` block (after `--color-down`), add:

```css
  --color-on-glow: #241a09; /* foreground for text sitting on the --color-glow accent */
```

Then replace the two baked constants:
- `.btn--primary { --btn-fg: #241a09; }` → `--btn-fg: var(--color-on-glow);`
- `.card__unread { … color: #241a09; … }` → `color: var(--color-on-glow);`

(Leave `.card__unread`'s `background: var(--color-glow)` and all `#241a09`-free rules unchanged. The `.segmented__option[aria-pressed='true']` on-accent color already uses `var(--color-ink)` — leave it.)

- [ ] **Step 2: Add the two theme override blocks** (after the `:root { color-scheme: dark }` rule)

```css
/* ── Theme: cultivation ancient-scroll (light parchment) ─────────────────── */
:root[data-theme="scroll"] {
  --color-ink: #e4d8bc;
  --color-ink-2: #dccfae;
  --color-surface: #efe4c9;
  --color-surface-2: #f5ecd6;
  --color-line: #cbb98f;
  --color-paper: #372a18;      /* primary text = sepia ink */
  --color-muted: #8a765a;
  --color-glow: #9e2b25;       /* cinnabar wax-seal */
  --color-glow-dim: #9e2b2500;
  --color-down: #b23b2f;
  --color-on-glow: #f5ecd6;    /* light text on the seal red */
  --font-display: var(--font-cinzel), Georgia, "Times New Roman", serif;
  --font-sans: var(--font-eb-garamond), Georgia, serif;
  color-scheme: light;
}

/* ── Theme: sci-fi holographic-panel (dark slate + cyan) ─────────────────── */
:root[data-theme="sci-fi"] {
  --color-ink: #070b12;
  --color-ink-2: #05080e;
  --color-surface: #0e1826;
  --color-surface-2: #152234;
  --color-line: #21354f;
  --color-paper: #d6e8f2;
  --color-muted: #7189a4;
  --color-glow: #37e0d8;       /* cyan panel-glow */
  --color-glow-dim: #37e0d800;
  --color-down: #ff6b8a;
  --color-on-glow: #06141a;    /* dark text on cyan */
  --font-display: var(--font-chakra), system-ui, sans-serif;
  --font-sans: var(--font-space-grotesk), system-ui, sans-serif;
  color-scheme: dark;
}
```

(Mono is intentionally not overridden — Plex Mono stays shared across themes, per the spec.)

- [ ] **Step 3: Add the scoped motifs** (after the theme blocks)

```css
/* scroll: a faint parchment grain + a soft seal bloom, pure CSS (no bitmap) */
:root[data-theme="scroll"] body {
  background-image:
    radial-gradient(60% 40% at 15% 0%, color-mix(in oklab, var(--color-glow) 6%, transparent), transparent 60%),
    repeating-linear-gradient(0deg, rgba(120, 90, 50, 0.035) 0 2px, transparent 2px 4px);
}
/* sci-fi: the amber lamp radial becomes a cyan panel-glow (follows --color-glow automatically);
   add a faint scanline within the isolated hero/login decorative layer (z-index -1, non-interactive) */
:root[data-theme="sci-fi"] .hero::after,
:root[data-theme="sci-fi"] .login::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: repeating-linear-gradient(0deg, color-mix(in oklab, var(--color-glow) 5%, transparent) 0 1px, transparent 1px 3px);
}
```

- [ ] **Step 4: Verify each theme end-to-end in the running app**

Run: `npm run dev`, then in DevTools set `document.documentElement.dataset.theme = 'scroll'` and `'sci-fi'` on the shelf, detail, add, settings, and login screens.
Expected: night unchanged; scroll = light parchment with sepia text + red accents + Cinzel/EB Garamond; sci-fi = dark slate with cyan accents + Chakra/Space Grotesk; native selects/scrollbars flip light on scroll. No unreadable text (check `.btn--primary`, `.card__unread`, status chips).

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "WP-28b: token on-glow + scroll & sci-fi theme blocks and motifs"
```

---

### Task 5: Settings theme picker

**Files:**
- Create: `src/app/(app)/settings/ThemePicker.tsx`
- Modify: `src/app/(app)/settings/page.tsx` (render the picker)
- Modify: `src/app/globals.css` (picker styles)

**Interfaces:**
- Consumes: `THEMES`, `DEFAULT_THEME`, `THEME_STORAGE_KEY`, `isThemeId`, `type ThemeId` (Task 1).
- Produces: `ThemePicker` React component (named export).

- [ ] **Step 1: Create the picker component**

```tsx
// src/app/(app)/settings/ThemePicker.tsx
'use client';

import { useState } from 'react';
import { THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, isThemeId, type ThemeId } from '../../../lib/theme';

function currentTheme(): ThemeId {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const attr = document.documentElement.getAttribute('data-theme');
  return isThemeId(attr) ? attr : DEFAULT_THEME;
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);

  function choose(id: ThemeId) {
    setTheme(id);
    document.documentElement.setAttribute('data-theme', id);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      // ignore storage failures (private mode, etc.) — the live switch still applies
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    const color = THEMES.find((t) => t.id === id)?.themeColor;
    if (meta && color) meta.setAttribute('content', color);
  }

  return (
    <div className="settings__panel">
      <p className="settings__panelLabel">Theme</p>
      <div className="themeGrid" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme === t.id}
            className={`themeCard${theme === t.id ? ' themeCard--on' : ''}`}
            onClick={() => choose(t.id)}
          >
            <span className="themeCard__swatch" aria-hidden="true">
              {t.swatch.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            <span className="themeCard__text">
              <span className="themeCard__label">{t.label}</span>
              <span className="themeCard__blurb">{t.blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it on the settings page**

In `src/app/(app)/settings/page.tsx`, add the import and render `<ThemePicker />` as a new panel after the "What to send" panel (inside the `<section className="settings">`, before it closes):

```tsx
import { ThemePicker } from './ThemePicker';
// … inside the returned <section className="settings"> …, after the "What to send" panel:
      <ThemePicker />
```

- [ ] **Step 3: Add picker styles to `globals.css`** (in the Settings section)

```css
.themeGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.6rem;
}
.themeCard {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  text-align: left;
  padding: 0.6rem 0.7rem;
  background: var(--color-ink);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  cursor: pointer;
  color: var(--color-paper);
  transition: border-color 0.18s ease, transform 0.12s ease;
}
.themeCard:hover {
  transform: translateY(-1px);
  border-color: color-mix(in oklab, var(--color-glow) 45%, var(--color-line));
}
.themeCard--on {
  border-color: var(--color-glow);
}
.themeCard__swatch {
  display: inline-flex;
  flex: none;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid var(--color-line);
}
.themeCard__swatch span {
  width: 14px;
  height: 26px;
}
.themeCard__text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.themeCard__label {
  font-size: 0.92rem;
}
.themeCard__blurb {
  font-size: 0.74rem;
  color: var(--color-muted);
}
```

- [ ] **Step 4: Verify typecheck + drive the picker**

Run: `npm run typecheck`
Expected: PASS.

Drive the app: open `/settings`, click each theme → the whole app recolors instantly; reload → the choice sticks with no flash; the selected card shows the `--on` outline and `aria-checked`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/settings/ThemePicker.tsx" "src/app/(app)/settings/page.tsx" src/app/globals.css
git commit -m "WP-28b: settings theme picker"
```

---

### Task 6: Owner-review screenshots of the empty-state screens (scroll + sci-fi)

**Why:** prod always has data, so the owner can't see the empty-shelf/settings states there. This captures them under each theme for visual review before merge. The images are **Playwright screenshots of the real running app** (not generated art), written to a **gitignored** dir so they persist for review and are never committed.

**Files:**
- Modify: `.gitignore` (ignore `screenshots/`)
- Create: `e2e/theme-screens.spec.ts`

- [ ] **Step 1: Gitignore the output dir**

Append to `.gitignore`:

```
# Local WP-28b theme review screenshots (not committed)
screenshots/
```

- [ ] **Step 2: Create the screenshot spec**

```ts
// e2e/theme-screens.spec.ts
import { test } from './support/fixtures';
import { mkdirSync } from 'node:fs';

// Captures the empty-state screens under each theme for owner review. Not an assertion test —
// it writes PNGs to a gitignored dir. The DB is reset empty by the fixture, so `/` shows the
// empty-shelf hero (the state that never appears in prod).
const OUT = 'screenshots/wp28b';
const THEMES = ['night', 'scroll', 'sci-fi'] as const;

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

for (const theme of THEMES) {
  test(`capture empty-state screens — ${theme}`, async ({ page }) => {
    // Set the theme before first paint via the same localStorage key the pre-paint script reads.
    await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);

    await page.goto('/');
    await page.screenshot({ path: `${OUT}/${theme}-shelf-empty.png`, fullPage: true });

    await page.goto('/settings');
    await page.screenshot({ path: `${OUT}/${theme}-settings.png`, fullPage: true });
  });
}
```

- [ ] **Step 3: Run it and confirm the PNGs land**

Run: `DATABASE_URL="postgresql://…/webnovel_e2e" npm run test:e2e -- theme-screens`
Expected: PASS (3 tests); `screenshots/wp28b/` contains `night|scroll|sci-fi × shelf-empty|settings` = 6 PNGs.

- [ ] **Step 4: Report the screenshots to the owner**

Print the absolute path of `screenshots/wp28b/` and list the 6 files, stating they are **Playwright screenshots of the real app (not AI-generated)**. Pause for the owner to eyeball scroll + sci-fi before proceeding (per the standing image-provenance rule).

- [ ] **Step 5: Commit** (the spec + gitignore only — not the PNGs)

```bash
git add .gitignore e2e/theme-screens.spec.ts
git commit -m "WP-28b: empty-state theme review screenshots (gitignored output)"
```

---

### Task 7: E2E coverage + checklist append

**Files:**
- Create: `e2e/theme.spec.ts`
- Modify: `e2e/README.md` ("What's covered" list)

**Interfaces:**
- Consumes: the running app + the `./support/fixtures` harness (gate-open dev; `/settings` reachable without seeding).

- [ ] **Step 1: Write the E2E spec**

```ts
// e2e/theme.spec.ts
import { test, expect } from './support/fixtures';

// WP-28b — theme system. The registry/validation/script are unit-tested in tests/unit/theme.test.ts;
// here we prove the picker drives <html data-theme>, and that the choice is applied at first paint on reload.
test('WP-28b: default theme is night when nothing is stored', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
});

test('WP-28b: picking a theme applies live and persists (no flash) across reload', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: /Holo panel/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sci-fi');

  await page.reload();
  // Applied by the pre-paint inline script → attribute is present immediately, not after hydration.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sci-fi');
  await expect(page.getByRole('radio', { name: /Holo panel/ })).toHaveAttribute('aria-checked', 'true');
});
```

- [ ] **Step 2: Run the E2E spec** (requires the local `webnovel_e2e` DB per `e2e/README.md`)

Run: `DATABASE_URL="postgresql://…/webnovel_e2e" npm run test:e2e -- theme.spec`
Expected: PASS (2 tests).

- [ ] **Step 3: Append to the e2e coverage list**

In `e2e/README.md` under "## What's covered", add:

```
- `theme.spec.ts` — WP-28b: default is night; picking a theme applies live and persists (pre-paint, no flash) on reload.
```

- [ ] **Step 4: Commit**

```bash
git add e2e/theme.spec.ts e2e/README.md
git commit -m "WP-28b: e2e theme persistence coverage"
```

---

### Task 8: Plan/docs bookkeeping + close-out

**Files:**
- Modify: `PLAN.md`, `docs/PLAN-archive.md`, `docs/CHANGELOG.md`

- [ ] **Step 1: Full-suite verification before flipping status**

Run: `npm test` then `npm run typecheck`
Expected: both PASS (exit 0). Capture the output for the completion message.

- [ ] **Step 2: PLAN.md — flip WP-28b, add the new WPs, reset NEXT**

- Move **WP-28b** out of the ▶ Active queue table into the **✅ Completed** list as a one-liner (e.g. *"WP-28b (theme system — `[data-theme]` token architecture + pre-paint inline-script/localStorage no-flash + settings picker; night/scroll/sci-fi)"*), and move its `### WP-28b — Theme system` detail section from PLAN.md into `docs/PLAN-archive.md`.
- Add **WP-28f — Bookshelf theme** as a new active-queue row: *gothic/Victorian palette + book-stack shelf layout*, `TODO`, **Depends on WP-28b, WP-28a, WP-28e**. Add a `### WP-28f` detail section capturing the spike result verbatim from the spec's Plan-bookkeeping note (both a horizontal "pile" and vertical "spines" treatment are feasible as pure scoped CSS on the existing card markup, zero markup changes; vertical is denser + stronger "real bookshelf" but truncates long titles → hover-reveal mitigation; both hide `.card__latest`/`.card__meta`; pile-vs-spine + info-density decided in its own brainstorm; spike files were throwaway/ephemeral).
- Add **WP-28g — Theme header quick-switch** *(low)*: a header control to cycle/menu themes from anywhere; `TODO`, depends WP-28b. (Owner-requested low-pri extension.)
- Add **WP-THEMESYNC — Cross-device theme persistence** *(low)*: persist the theme choice server-side (e.g. alongside notification prefs) so it follows the user across devices instead of per-origin localStorage; `TODO`, depends WP-28b, WP-AUTH. (Owner-requested low-pri extension.)
- Update the **Current focus** note: WP-28b done; set the next `NEXT` to **WP-28c** (feed vs library split) per the existing active-queue order; mention 28f/28g/THEMESYNC filed.
- Update the **WP-28 umbrella** note (§ "WP-28 — Frontend styling & theming"): mark 28b shipped, list remaining children (28c, 28e, 28f + low-pri 28g/THEMESYNC).

- [ ] **Step 3: CHANGELOG.md — add the landing line** (newest first)

Add a dated line summarizing WP-28b (token `[data-theme]` architecture, pre-paint inline-script/localStorage no-flash, settings picker, night/scroll/sci-fi; on-glow tokenized; WP-28f/28g/THEMESYNC filed).

- [ ] **Step 4: Commit**

```bash
git add PLAN.md docs/PLAN-archive.md docs/CHANGELOG.md
git commit -m "docs: WP-28b done — theme system; file WP-28f/28g/THEMESYNC"
```

- [ ] **Step 5: Stop at the WP boundary**

Per the working agreements, do **not** start the next WP. Report completion with the fresh `npm test` + `npm run typecheck` output and the `screenshots/wp28b/` paths, summarize what shipped, and leave the branch for the owner to review/merge.

---

## Notes for the executor

- **Read the modified-Next docs** (`node_modules/next/dist/docs/`) before editing `layout.tsx` — App Router head/script conventions may differ from training data.
- **Font fetch:** `next/font/google` downloads + self-hosts at build/dev-compile; the existing Fraunces/Plex setup already relies on network at build, so this adds four families the same way. If a fully-offline build is required, that's a pre-existing constraint, not new here.
- **Manual visual QA is a real gate** (Tasks 4 & 5): there's no React unit-test harness, so the themes are verified by driving the app + the E2E attribute checks + the Task 6 screenshots. Watch specifically for on-accent legibility (`.btn--primary`, `.card__unread`) and the scroll light `color-scheme` flipping native controls.
- **Image provenance:** the only images produced (Task 6) are real-app Playwright screenshots in gitignored `screenshots/wp28b/`; report their paths and confirm they aren't AI-generated (standing owner rule).
```

