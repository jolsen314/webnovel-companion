import type { FailureType } from '../health';

/**
 * Polite HTTP fetcher for feeds and watched pages. The one impure piece of the
 * feed pipeline, but the network call is injected (`FetchLike`) so it unit-tests
 * without a socket.
 *
 * Responsibilities: realistic browser headers (so bare-bot rejections / Cloudflare
 * are less likely), conditional GET (ETag / If-Modified-Since → 304), and mapping
 * every outcome onto a health `PollOutcome` (SUCCESS or a typed FailureType) so the
 * result feeds straight into `health.step`. Deciding *which* URL to fetch, and any
 * Cloudflare fallback (feed endpoint when the page is blocked), is orchestration.
 */

/** Minimal shape we need from a fetch Response — the global `fetch` Response satisfies it. */
export interface HttpResponse {
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  redirect: 'follow';
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<HttpResponse>;

export interface PoliteFetchOptions {
  /** Stored validators for conditional GET. */
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
}

export type PoliteResult =
  | {
      outcome: 'SUCCESS';
      status: number;
      notModified: boolean;
      body: string;
      etag: string | null;
      lastModified: string | null;
      finalUrl: string;
    }
  | { outcome: FailureType; status?: number };

const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  'WebnovelCompanion/0.1 (+https://github.com/jolsen314/webnovel-companion; personal feed reader)';

/** Browser-ish headers so hosts and Cloudflare are less likely to reject a bare bot. */
function baseHeaders(): Record<string, string> {
  return {
    'user-agent': USER_AGENT,
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
    'accept-language': 'en-US,en;q=0.9',
  };
}

/** Domain-parking / "for sale" landing pages return 200 but mean the source is gone. */
function looksParked(body: string): boolean {
  return /\b(this domain (is|may be) for sale|buy this domain|domain parking|parked (free|by)|sedoparking|is for sale)\b/i.test(
    body.slice(0, 4000),
  );
}

/** Classify a thrown fetch/network error into a health FailureType. */
function classifyError(err: unknown): FailureType {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'TIMEOUT';
  const code = e?.cause?.code ?? e?.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS';
  if (/^(CERT_|ERR_TLS|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_VERIFY)/.test(code) || /TLS|CERT/.test(code)) return 'TLS';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return 'TIMEOUT';
  return 'TIMEOUT'; // ECONNREFUSED/RESET and unknown transient network errors — treat as soft
}

export async function politeFetch(
  url: string,
  options: PoliteFetchOptions = {},
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<PoliteResult> {
  const headers = baseHeaders();
  if (options.etag) headers['if-none-match'] = options.etag;
  if (options.lastModified) headers['if-modified-since'] = options.lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: HttpResponse;
  try {
    res = await fetchImpl(url, { method: 'GET', headers, redirect: 'follow', signal: controller.signal });
  } catch (err) {
    return { outcome: classifyError(err) };
  } finally {
    clearTimeout(timer);
  }

  const { status } = res;
  if (status === 304) {
    return {
      outcome: 'SUCCESS',
      status,
      notModified: true,
      body: '',
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      finalUrl: res.url,
    };
  }
  if (status >= 500) return { outcome: 'HTTP_5XX', status };
  if (status >= 400) return { outcome: 'HTTP_4XX', status };

  const body = await res.text();
  if (looksParked(body)) return { outcome: 'PARKED', status };

  return {
    outcome: 'SUCCESS',
    status,
    notModified: false,
    body,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    finalUrl: res.url,
  };
}
