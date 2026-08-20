/**
 * WP-45b: pure helpers for paginated API sources — build each page's URL, locate the item
 * array, and decide the last page. Shared by the PLAIN Node-side loop (fetchApiPages) and, via
 * `server/render/renderJson.ts`'s `collectJsonResult`, the RENDER path too: only the single
 * per-page `fetch` runs in-browser (`page.evaluate`'d), the loop/union/stop logic here runs in
 * Node either way. Pure — no I/O.
 */
export function pageUrl(baseUrl: string, pageParam: string, n: number): string {
  const u = new URL(baseUrl);
  u.searchParams.set(pageParam, String(n));
  return u.toString();
}

export function itemsAt(parsed: unknown, listPath?: string): unknown[] {
  let node: unknown = parsed;
  if (listPath) {
    for (const key of listPath.split('.')) {
      node =
        node != null && typeof node === 'object' && Object.hasOwn(node as object, key)
          ? (node as Record<string, unknown>)[key]
          : undefined;
    }
  }
  return Array.isArray(node) ? node : [];
}

export function isLastPage(pageItemCount: number, perPage: number): boolean {
  return pageItemCount < perPage;
}
