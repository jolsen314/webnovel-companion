import type { PoliteResult } from './fetch';
import type { PaginationSpec } from './apiAdapter';
import type { ApiCapture } from './apiInfer';

/**
 * Adapter to the headless renderer service (WP-17b). It POSTs a URL to the render
 * endpoint and maps the reply onto the same `PoliteResult` the poll pipeline consumes,
 * so a RENDER source flows through `parseToc`/diff exactly like a plain fetch. The HTTP
 * call is injected (`RenderHttp`) so this unit-tests without a socket; the renderer does
 * no conditional GET, so validators are always null.
 *
 * Contract: `POST <endpoint> { url, pagination? }` → 200 `{ status, finalUrl, html }`, where
 * `status` is the *target page's* HTTP status. A non-2xx from the service itself is the
 * renderer failing (auth/misconfig/crash) and maps to an HTTP failure. When `opts.pagination`
 * (WP-45b) is passed, it rides along in the POST body so the render service can loop pages
 * in-page within its single browser session; `html` is then the unioned root JSON array.
 */

export interface RenderResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

export type RenderHttp = (
  endpoint: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<RenderResponse>;

export interface RenderFetchConfig {
  endpoint: string;
  secret?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Map an HTTP status onto a `PoliteResult` failure, or null when it isn't a failure (<400). */
function httpFailureOutcome(status: number): PoliteResult | null {
  if (status >= 500) return { outcome: 'HTTP_5XX', status };
  if (status >= 400) return { outcome: 'HTTP_4XX', status };
  return null;
}

export function makeRenderFetch(
  config: RenderFetchConfig,
  httpImpl: RenderHttp = globalThis.fetch as unknown as RenderHttp,
): (url: string, opts?: { pagination?: PaginationSpec }) => Promise<PoliteResult> {
  return async (url, opts) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let res: RenderResponse;
    try {
      res = await httpImpl(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.secret ? { authorization: `Bearer ${config.secret}` } : {}),
        },
        body: JSON.stringify({ url, ...(opts?.pagination ? { pagination: opts.pagination } : {}) }),
        signal: controller.signal,
      });
    } catch {
      return { outcome: 'TIMEOUT' }; // network/abort — soft, retryable
    } finally {
      clearTimeout(timer);
    }

    // The renderer service itself failing (auth, crash, unreachable route).
    const serviceFailure = httpFailureOutcome(res.status);
    if (serviceFailure) return serviceFailure;

    let payload: { status?: number; finalUrl?: string; html?: string };
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      return { outcome: 'HTTP_5XX' };
    }

    // The target page's own status, as observed by the renderer.
    const pageStatus = payload.status ?? 200;
    const pageFailure = httpFailureOutcome(pageStatus);
    if (pageFailure) return pageFailure;

    return {
      outcome: 'SUCCESS',
      status: pageStatus,
      notModified: false,
      body: payload.html ?? '',
      etag: null,
      lastModified: null,
      finalUrl: payload.finalUrl ?? url,
    };
  };
}

export interface RenderCaptureResult {
  ok: boolean;
  finalUrl?: string;
  /** The JSON XHR/fetch responses the page fired while rendering. */
  captures: ApiCapture[];
  error?: string;
}

/**
 * WP-54: ask the render service to load a page and hand back the JSON XHR/fetch responses it fired
 * (`POST <endpoint> { url, capture: true }` → `{ finalUrl, captures }`), so the `apiInfer` detector
 * can find the runtime chapters API that the static-HTML `probeForApi` can't see. Never throws — a
 * service/network failure surfaces as `{ ok: false, captures: [] }`. HTTP injected for testability.
 */
export function makeRenderCapture(
  config: RenderFetchConfig,
  httpImpl: RenderHttp = globalThis.fetch as unknown as RenderHttp,
): (url: string) => Promise<RenderCaptureResult> {
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await httpImpl(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.secret ? { authorization: `Bearer ${config.secret}` } : {}),
        },
        body: JSON.stringify({ url, capture: true }),
        signal: controller.signal,
      });
      if (!res.ok || res.status >= 400) {
        return { ok: false, captures: [], error: `renderer returned ${res.status}` };
      }
      const payload = (await res.json()) as { finalUrl?: string; captures?: ApiCapture[] };
      return { ok: true, finalUrl: payload.finalUrl, captures: payload.captures ?? [] };
    } catch (e) {
      return { ok: false, captures: [], error: e instanceof Error ? e.message : 'render capture failed' };
    } finally {
      clearTimeout(timer);
    }
  };
}
