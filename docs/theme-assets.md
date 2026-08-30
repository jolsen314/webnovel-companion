# Theme scene assets (WP-28h)

The `scroll` theme uses two licensed raster images — `public/themes/wax-seal.png` (unread-count
badge) and `public/themes/scroll-tree.png` (hero/add/login scene). Both are **gitignored**
(`/public/themes/*.png` in `.gitignore`) because their licenses don't clearly permit
redistribution from a public repo; see `public/themes/CREDITS.md` for the source, license, and
caveats of each.

- **Local dev:** if you have the licensed source files, drop them in `public/themes/` and set
  `NEXT_PUBLIC_THEME_ASSET_BASE=/themes` in `.env` — Next.js serves `public/` at the site root.
- **Prod:** the files live in a **private** Vercel Blob store instead of the repo, and
  `NEXT_PUBLIC_THEME_ASSET_BASE=/api/theme-asset` points at the **auth-gated proxy route**
  (`src/app/api/theme-asset/[name]/route.ts`, WP-28i) that streams them. The blobs are **private**
  (their licenses don't permit public redistribution), so they're never exposed at a public Blob
  URL — the proxy reads them server-side with `BLOB_READ_WRITE_TOKEN` and serves them only to
  authenticated callers (the middleware gate covers `/api/*`). An exact-match allowlist
  (`themeAssetBlobPath` in `src/lib/themeAssets.ts`) means the route only ever serves the two known
  assets, never an arbitrary object from the store.
- **Fallback:** `NEXT_PUBLIC_THEME_ASSET_BASE` unset, or set but the image 404s/fails to load
  (including any proxy failure — missing token, store gone — which returns 404 by design), is
  handled gracefully everywhere it's used (`src/lib/themeAssets.ts` + the `onError` handlers in
  `ThemeScene.tsx` / `WaxBadge.tsx`): no tree scene renders, and the unread badge falls back to a
  plain red circle instead of the wax seal. This is non-blocking — the app works fine without Blob
  ever being provisioned.

## Owner provisioning steps (not run by the agent — needs your Vercel account)

1. **Create a private Blob store** on the Vercel project: Vercel dashboard → project → **Storage** → **Create Database** → **Blob**. This injects a read-write token env var whose **prefix you choose** when connecting the store. This project uses the `THEME_ASSETS_` prefix (namespaced so additional Blob stores can each carry their own prefix later), so the token is **`THEME_ASSETS_READ_WRITE_TOKEN`**, *not* the SDK-default `BLOB_READ_WRITE_TOKEN` that `@vercel/blob`'s `get()` looks up implicitly. The proxy reads it explicitly via `themeAssetBlobToken` (`src/lib/themeAssets.ts`): `THEME_ASSETS_READ_WRITE_TOKEN` first, then a `BLOB_READ_WRITE_TOKEN` fallback. If you use a different prefix, either match `THEME_ASSETS_READ_WRITE_TOKEN` or add a `BLOB_READ_WRITE_TOKEN` alias. (Note: token env-var changes only reach **new** deployments — redeploy the preview/prod after setting it.)
2. **Upload the assets:**
   ```bash
   BLOB_READ_WRITE_TOKEN=<store's token> node scripts/upload-theme-assets.mjs
   ```
   This uploads `public/themes/wax-seal.png` and `public/themes/scroll-tree.png` to
   `themes/wax-seal.png` and `themes/scroll-tree.png` on the store (`access: 'private'`, no random
   suffix — stable paths the proxy resolves by name). Private blobs have no public URL; they're
   reachable only through the auth-gated proxy.
3. **Set `NEXT_PUBLIC_THEME_ASSET_BASE=/api/theme-asset`** in the Vercel project's environment
   variables (the app builds `/api/theme-asset/wax-seal.png` etc. and streams the private blob
   through the gate).
4. **Redeploy** so the new env var takes effect (Vercel env var changes require a redeploy to
   reach already-built deployments).

Re-running the upload script is safe — `addRandomSuffix: false` means uploads land at the same
path each time (last write wins), so you can re-run it if you ever swap the source images.
