export type ThemeAssetName = 'scroll-tree.png' | 'wax-seal.png';

/** URL from a configured base (Vercel Blob in prod, /themes in dev), or null when unset so callers
 *  render their fallback. A base that IS set but 404s/unreachable is handled by the <img> onError,
 *  not here. */
export function resolveAssetUrl(name: ThemeAssetName, base: string | undefined): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${name}`;
}
