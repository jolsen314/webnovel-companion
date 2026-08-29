# WP-28h spike reference (FINAL — porting source)

Both files below are the **final, approved** design spikes for WP-28h and are consistent with each
other (same card material language). Port the exact CSS/markup into `globals.css` + components,
prefixing selectors with the theme attribute. Assets (`scroll-tree.png`, `wax-seal.png`) live in
`public/themes/` (gitignored; Vercel Blob in prod — see the plan).

- **scenes-and-cards.html** — hero scenes + cards. Mauve scroll (PNG tree + drifting petals +
  rolled-scroll cards + **Adobe wax-seal image** badge) and full-env sci-fi (glassy chrome, grid +
  shimmer-binary + flicker + glitch backdrop, **translucent cyan-glass HUD cards** with masked
  gradient rim + chamfer + `.hud` decorations, **no indicator squares**). "here" is NOT emphasized.
- **detail-treatments.html** — **detail** treatments only, rebuilt on the **final** card material:
  scroll = opened-scroll (parchment sheet + rods + deckle) on the mauve page; sci-fi = **translucent
  cyan-glass HUD panel** (chamfer + iridescent rim + HUD brackets + scanlines + gradient title),
  matching the final cards. (Its card blocks are shown for context and also match the final.)

Port **cards + scenes** from `scenes-and-cards.html`; port **detail** from `detail-treatments.html`.
Delete this folder when WP-28h lands (git history preserves it).
