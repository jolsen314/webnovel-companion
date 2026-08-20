import { pageUrl, itemsAt, isLastPage } from '../../lib/feeds/apiPaginate';
import type { PaginationSpec } from '../../lib/feeds/apiAdapter';

/**
 * WP-45b: JSON auto-detect + pagination orchestration for the headless render path, pulled out
 * of `renderPage.ts` so it's unit-testable without Puppeteer. `fetchPage` is the one seam that
 * truly needs a browser (production wires `(u) => page.evaluate(jsonPageFetch, u)`, reusing the
 * page's cf_clearance cookie); the page loop, union, and stop condition here are pure Node code
 * that reuse the same `pageUrl`/`itemsAt`/`isLastPage` helpers the PLAIN transport's
 * `fetchApiPages` uses, so there's exactly one tested implementation of "how pages union."
 */
export type JsonPageFetch = (url: string) => Promise<{ status: number; body: string } | null>;

export async function collectJsonResult(
  url: string,
  pagination: PaginationSpec | undefined,
  fetchPage: JsonPageFetch,
): Promise<{ status: number; body: string; pages: number; capped: boolean } | null> {
  if (!pagination) {
    const res = await fetchPage(url);
    return res ? { status: res.status, body: res.body, pages: 1, capped: false } : null;
  }

  const max = pagination.maxPages ?? 20;
  const all: unknown[] = [];
  let status = 200;
  let n = 1;
  let cappedOut = false;
  for (; n <= max; n++) {
    const res = await fetchPage(pageUrl(url, pagination.pageParam, n));
    if (!res) return null; // non-JSON / failed page — discard the whole result, caller falls back to DOM
    status = res.status;
    let items: unknown[];
    try {
      items = itemsAt(JSON.parse(res.body), pagination.listPath);
    } catch {
      return null;
    }
    all.push(...items);
    if (isLastPage(items.length, pagination.perPage)) break;
    if (n === max) cappedOut = true; // loop stopped because it hit maxPages, not a short page
  }
  return { status, body: JSON.stringify(all), pages: Math.min(n, max), capped: cappedOut };
}
