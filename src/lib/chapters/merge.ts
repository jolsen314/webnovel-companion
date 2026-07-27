import { canonicalUrl } from '../feeds/diff';

/** The `from` chapters not already present in `into` (matched by canonical URL). Pure. */
export function chaptersToMove<T extends { url: string }>(from: T[], intoUrls: string[]): T[] {
  const have = new Set(intoUrls.map(canonicalUrl));
  return from.filter((c) => !have.has(canonicalUrl(c.url)));
}
