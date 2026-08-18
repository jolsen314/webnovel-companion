import type { PoliteResult } from './fetch';

/**
 * Adapter to the headless renderer service (WP-17b). It POSTs a URL to the render
 * endpoint and maps the reply onto the same `PoliteResult` the poll pipeline consumes,
 * so a RENDER source flows through `parseToc`/diff exactly like a plain fetch. The HTTP
 * call is injected (`RenderHttp`) so this unit-tests without a socket; the renderer does
 * no conditional GET, so validators are always null.
 *
 * Contract: `POST <endpoint> { url }` → 200 `{ status, finalUrl, html }`, where `status`
 * is the *target page's* HTTP status. A non-2xx from the service itself is the renderer
 * failing (auth/misconfig/crash) and maps to an HTTP failure.
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
): (url: string) => Promise<PoliteResult> {
  return async (url) => {
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
        body: JSON.stringify({ url }),
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
