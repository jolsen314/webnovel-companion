export type ThemeAssetName = 'scroll-tree.png' | 'wax-seal.png';

/** The two licensed assets the app serves, in one place. */
export const THEME_ASSET_NAMES: readonly ThemeAssetName[] = ['scroll-tree.png', 'wax-seal.png'];

/** The private Blob-store path for an allowlisted theme asset, or null for anything else.
 *  The proxy route (WP-28i) MUST gate on this: it reads from a private store, so serving an
 *  arbitrary `[name]` would turn it into an open reader over that whole store. Exact-match only —
 *  no path traversal, no case-folding, no prefix. Pure. */
export function themeAssetBlobPath(name: string): string | null {
  return (THEME_ASSET_NAMES as readonly string[]).includes(name) ? `themes/${name}` : null;
}

/** The read-write token the proxy passes to Blob `get()`. This store's token env var uses a
 *  deliberately-chosen `THEME_ASSETS_` prefix (namespaced so additional Blob stores can each carry
 *  their own prefix later), so it's `THEME_ASSETS_READ_WRITE_TOKEN`, not the SDK-default
 *  `BLOB_READ_WRITE_TOKEN` that `get()` looks up implicitly — hence the explicit read here. We
 *  prefer the prefixed name, fall back to the conventional one, and return undefined if neither is
 *  set (letting `get()` fall through to its own default). Pure. */
export function themeAssetBlobToken(env: Record<string, string | undefined>): string | undefined {
  return env.THEME_ASSETS_READ_WRITE_TOKEN ?? env.BLOB_READ_WRITE_TOKEN;
}

/** URL from a configured base (Vercel Blob in prod, /themes in dev), or null when unset so callers
 *  render their fallback. A base that IS set but 404s/unreachable is handled by the <img> onError,
 *  not here. */
export function resolveAssetUrl(name: ThemeAssetName, base: string | undefined): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${name}`;
}
