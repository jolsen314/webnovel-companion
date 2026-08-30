# Theme scene assets (WP-28h)

The `scroll` theme uses two licensed raster images — `public/themes/wax-seal.png` (unread-count
badge) and `public/themes/scroll-tree.png` (hero/add/login scene). Both are **gitignored**
(`/public/themes/*.png` in `.gitignore`) because their licenses don't clearly permit
redistribution from a public repo; see `public/themes/CREDITS.md` for the source, license, and
caveats of each.

- **Local dev:** if you have the licensed source files, drop them in `public/themes/` and set
  `NEXT_PUBLIC_THEME_ASSET_BASE=/themes` in `.env` — Next.js serves `public/` at the site root.
- **Prod:** the files live in **Vercel Blob** instead of the repo, and
  `NEXT_PUBLIC_THEME_ASSET_BASE` points at the Blob base URL.
- **Fallback:** `NEXT_PUBLIC_THEME_ASSET_BASE` unset, or set but the image 404s/fails to load, is
  handled gracefully everywhere it's used (`src/lib/themeAssets.ts` + the `onError` handlers in
  `ThemeScene.tsx` / `WaxBadge.tsx`): no tree scene renders, and the unread badge falls back to a
  plain red circle instead of the wax seal. This is non-blocking — the app works fine without Blob
  ever being provisioned.

## Owner provisioning steps (not run by the agent — needs your Vercel account)

1. **Create a Blob store** on the Vercel project: Vercel dashboard → project → **Storage** → **Create Database** → **Blob**. This mints a `BLOB_READ_WRITE_TOKEN` for the project (also settable locally for the one-off upload below).
2. **Upload the assets:**
   ```bash
   BLOB_READ_WRITE_TOKEN=<store's token> node scripts/upload-theme-assets.mjs
   ```
   This uploads `public/themes/wax-seal.png` and `public/themes/scroll-tree.png` to
   `themes/wax-seal.png` and `themes/scroll-tree.png` on the store (`access: 'public'`, no random
   suffix — stable, predictable URLs) and prints each blob URL plus the common base to use next.
3. **Set `NEXT_PUBLIC_THEME_ASSET_BASE`** in the Vercel project's environment variables to the
   printed base (the common `…/themes` prefix of both URLs).
4. **Redeploy** so the new env var takes effect (Vercel env var changes require a redeploy to
   reach already-built deployments).

Re-running the upload script is safe — `addRandomSuffix: false` means uploads land at the same
path each time (last write wins), so you can re-run it if you ever swap the source images.
