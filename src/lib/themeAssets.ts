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

/** URL from a configured base (Vercel Blob in prod, /themes in dev), or null when unset so callers
 *  render their fallback. A base that IS set but 404s/unreachable is handled by the <img> onError,
 *  not here. */
export function resolveAssetUrl(name: ThemeAssetName, base: string | undefined): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${name}`;
}
