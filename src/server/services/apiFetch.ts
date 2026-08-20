import type { FetchImpl } from './index';
import type { ApiDescriptor } from '../../lib/feeds/apiAdapter';
import type { PoliteResult } from '../../lib/feeds/fetch';
import { pageUrl, itemsAt, isLastPage } from '../../lib/feeds/apiPaginate';

/**
 * WP-45b: fetch every page of a paginated API source and return ONE combined PoliteResult whose
 * body is the flattened root JSON array of all pages' items. Branches by transport:
 *  - PLAIN  → loop ports.fetch page 1..N Node-side (cheap HTTP).
 *  - RENDER → ONE ports.renderFetch call carrying `pagination`; the render service does the
 *             in-page page loop inside a single browser session (clears CF once). We do NOT loop
 *             renderFetch — that would be one browser launch per page and blow the poll budget.
 */
export async function fetchApiPages(
  baseUrl: string,
  descriptor: ApiDescriptor,
  fetchMode: 'PLAIN' | 'RENDER',
  ports: { fetch: FetchImpl; renderFetch?: FetchImpl },
  log: (msg: string) => void = (m) => console.warn(m),
): Promise<PoliteResult> {
  const pg = descriptor.pagination!;
  const maxPages = pg.maxPages ?? 20;
  // The nested item-array path may be set at the top level (ApiDescriptor.listPath, shared with
  // the non-paginated parse path) instead of on pagination itself — fall back to it so a
  // paginated descriptor that only sets the top-level path doesn't silently extract [] per page
  // (itemsAt() finds nothing at the root → isLastPage(0, perPage) is true → union stops after
  // page 1 with ZERO chapters).
  const listPath = pg.listPath ?? descriptor.listPath;

  if (fetchMode === 'RENDER' && ports.renderFetch) {
    // One call — the render service returns the already-unioned root array. Pass the resolved
    // listPath through so collectJsonResult (which reads pagination.listPath) sees it too.
    return ports.renderFetch(baseUrl, { pagination: { ...pg, listPath } });
  }

  const all: unknown[] = [];
  for (let n = 1; n <= maxPages; n++) {
    const res = await ports.fetch(pageUrl(baseUrl, pg.pageParam, n));
    if (res.outcome !== 'SUCCESS' || res.notModified) return res; // health scores the failure; retry next poll
    let items: unknown[];
    try {
      items = itemsAt(JSON.parse(res.body ?? ''), listPath);
    } catch {
      items = [];
    }
    all.push(...items);
    if (isLastPage(items.length, pg.perPage)) break;
    if (n === maxPages) log(`fetchApiPages: hit page cap ${maxPages} for ${baseUrl}; list may be truncated`);
  }
  return { outcome: 'SUCCESS', status: 200, notModified: false, body: JSON.stringify(all), etag: null, lastModified: null, finalUrl: baseUrl };
}
