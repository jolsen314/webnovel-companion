import { NextResponse } from 'next/server';
import { assertPublicUrl } from '../../../server/render/ssrfGuard';
import { renderPage } from '../../../server/render/renderPage';
import { jsonError, readJson } from '../../../server/api/http';
import type { PaginationSpec } from '../../../lib/feeds/apiAdapter';

/**
 * Headless render endpoint (WP-17b). The poll's `renderFetch` POSTs `{ url, pagination? }`;
 * this thin handler authenticates, validates the URL (SSRF), shallow-validates an optional
 * `pagination` (WP-45b), and delegates the browser work to `renderPage`, returning
 * `{ status, finalUrl, html }` for `parseToc` — `html` is the unioned root JSON array when
 * pagination was honored.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  // Fail closed: with no secret configured the endpoint is disabled (never an open
  // SSRF surface). It's a public path, so RENDER_SECRET is its only gate.
  const secret = process.env.RENDER_SECRET;
  if (!secret) return NextResponse.json({ error: 'Renderer not configured.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJson(request);
  if (!body.ok) return jsonError(body.error);
  const value = body.value as { url?: unknown; pagination?: unknown };
  const url = value?.url;
  if (typeof url !== 'string') {
    return jsonError('A "url" string is required.');
  }
  // Shallow-validate: a well-formed PaginationSpec needs a string pageParam (the query-param
  // NAME to increment) + numeric perPage. Anything else (missing, malformed) is treated as
  // "no pagination" — the single-page JSON detect.
  const pagination =
    value.pagination &&
    typeof value.pagination === 'object' &&
    typeof (value.pagination as { pageParam?: unknown }).pageParam === 'string' &&
    typeof (value.pagination as { perPage?: unknown }).perPage === 'number'
      ? (value.pagination as PaginationSpec)
      : undefined;
  // SSRF guard: only public http(s) targets (no metadata/loopback/RFC1918).
  try {
    await assertPublicUrl(url);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'URL not allowed.');
  }

  try {
    return NextResponse.json(await renderPage(url, { pagination }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'render failed' }, { status: 500 });
  }
}
