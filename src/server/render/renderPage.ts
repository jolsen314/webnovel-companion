import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { assertPublicUrl } from './ssrfGuard';
import { collectJsonResult } from './renderJson';
import { shouldCaptureResponse, type ApiCapture } from '../../lib/feeds/apiInfer';
import type { PaginationSpec } from '../../lib/feeds/apiAdapter';

/**
 * Headless render of a page (WP-17b) — the Vercel `@sparticuz/chromium` path. Launches
 * serverless Chromium, loads the URL, and either (a) detects a JSON resource and returns its
 * raw body — looping every page of a paginated JSON API in-page when `opts.pagination` (WP-45b)
 * is given, all inside this one browser session — or (b) falls back to loop-clicking any
 * generic "load more" control (paginated TOCs) and returns the DOM as `{ status, finalUrl,
 * html }` for `parseToc`. Node-only (Puppeteer), so it lives under `server/render/`, not `lib/`.
 * Interaction selectors are generic (by visible text) — no per-site names in the repo;
 * site-specific overrides belong in data.
 *
 * The JSON page loop itself (union/stop condition) is `collectJsonResult` in `renderJson.ts` —
 * pulled out and unit-tested there without Puppeteer; the only browser-dependent piece is
 * `jsonPageFetch` below, one raw same-origin fetch per page.
 *
 * SSRF: every request (navigation + subresource, including the in-page JSON fetch(es)) is
 * re-validated with the DNS-resolving guard, so redirects/subresources can't reach an internal
 * address. The caller is expected to have already validated `url` itself before calling.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const LOAD_MORE = 'load more|show more|more chapters';

/**
 * Runs INSIDE the browser via `page.evaluate` (Puppeteer serializes this via `toString()`), so
 * it must stay self-contained — only its own parameter + browser globals (`fetch`), no closures
 * over anything else in this module. `credentials: 'include'` carries the page's cf_clearance
 * cookie (set by `goto` solving a CF challenge, if any) into the same-origin fetch.
 */
async function jsonPageFetch(u: string): Promise<{ status: number; body: string } | null> {
  try {
    const r = await fetch(u, { credentials: 'include' });
    if (!/\bjson\b/i.test(r.headers.get('content-type') ?? '')) return null;
    return { status: r.status, body: await r.text() };
  } catch {
    return null;
  }
}

/** Politeness/safety bounds on what a WP-54 capture run collects. */
const MAX_CAPTURES = 25;
const MAX_CAPTURE_BYTES = 3_000_000;
/** Visible-text of controls that lazily trigger a chapter-list XHR on hover/focus (no site names). */
const CHAPTER_LIST_HINT = 'chapter list|full chapter|table of contents|all chapters|chapters|view chapters|read chapters';

export async function renderPage(
  url: string,
  opts: { pagination?: PaginationSpec; capture?: boolean } = {},
): Promise<{ status: number; finalUrl: string; html: string; captures?: ApiCapture[] }> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    // Re-validate EVERY request (navigation + subresource) with the DNS-resolving guard so
    // redirects/subresources can't reach an internal address. Cached per host to stay cheap.
    await page.setRequestInterception(true);
    const hostChecks = new Map<string, Promise<unknown>>();
    page.on('request', async (req) => {
      try {
        const target = new URL(req.url());
        if (target.protocol !== 'http:' && target.protocol !== 'https:') return void (await req.abort());
        let check = hostChecks.get(target.hostname);
        if (!check) {
          check = assertPublicUrl(req.url());
          hostChecks.set(target.hostname, check);
        }
        await check;
        await req.continue();
      } catch {
        await req.abort().catch(() => {});
      }
    });

    // WP-54 capture mode: collect the JSON XHR/fetch responses the page fires at runtime, so the
    // `apiInfer` detector can find a chapters API the static-HTML `probeForApi` can't see. Each
    // body is read via an async task tracked in `pending` (response events fire concurrently);
    // we await them after the page settles. Bounded in count + per-body size.
    const captures: ApiCapture[] = [];
    const pending: Promise<void>[] = [];
    if (opts.capture) {
      page.on('response', (resp) => {
        if (captures.length + pending.length >= MAX_CAPTURES) return;
        const headers = resp.headers();
        if (!shouldCaptureResponse({ resourceType: resp.request().resourceType(), contentType: headers['content-type'] })) {
          return;
        }
        pending.push(
          (async () => {
            try {
              const body = await resp.text();
              if (body.length <= MAX_CAPTURE_BYTES && captures.length < MAX_CAPTURES) {
                captures.push({ url: resp.url(), body, headers });
              }
            } catch {
              // a body we can't read (redirect/streamed/aborted) — skip it
            }
          })(),
        );
      });
    }

    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 2_000)); // let client-rendered lists settle

    if (opts.capture) {
      // Some sites fire the chapter-list XHR only on interaction (e.g. a "chapter list" control:
      // a Next.js <Link> that prefetches on hover, or a button that opens an in-page panel on
      // click), so goto+settle alone misses it. Tag the matching controls, then drive REAL
      // (trusted) Puppeteer hover + click — synthetic dispatched events aren't trusted and many
      // frameworks ignore them. Only non-anchor controls are clicked, so we can't navigate away
      // and lose the captures; anchors are hovered only (enough for a <Link> prefetch).
      await page.evaluate((pattern) => {
        const re = new RegExp(pattern, 'i');
        // Match compact controls only — a "Chapter List" toggle is often a bare <span>/<div>, not
        // an <a>/<button>, so include those but cap the text length to avoid tagging a whole
        // container that merely contains the phrase.
        const hits = [...document.querySelectorAll('a, button, [role="tab"], [role="button"], [role="link"], summary, span, li, div')]
          .filter((e) => {
            const t = (e.textContent || '').trim();
            return t.length > 0 && t.length <= 40 && re.test(t) && (e as HTMLElement).offsetParent !== null;
          })
          .slice(0, 8);
        hits.forEach((el, i) => el.setAttribute('data-probe-nudge', el.tagName === 'A' ? `hover-${i}` : `click-${i}`));
      }, CHAPTER_LIST_HINT);
      for (const handle of await page.$$('[data-probe-nudge]')) {
        try {
          await handle.hover();
          const mode = await handle.evaluate((el) => el.getAttribute('data-probe-nudge') ?? '');
          if (mode.startsWith('click')) await handle.click({ delay: 20 });
          await new Promise((r) => setTimeout(r, 700));
        } catch {
          // control detached / not clickable — skip it
        }
      }
      await new Promise((r) => setTimeout(r, 2_000));
      await Promise.allSettled(pending);
      const html = await page.content();
      return { status: resp?.status() ?? 200, finalUrl: page.url(), html, captures };
    }

    // WP-45b: JSON resource. `page.content()` on a JSON navigation is the browser's JSON-VIEWER
    // HTML, not the raw body. Once `goto` has (for a CF-gated endpoint) triggered + solved the
    // challenge and left us on the domain with the cf_clearance cookie, in-page same-origin
    // fetch(es) (via `jsonPageFetch`) reuse that cookie and return raw JSON. When `pagination`
    // is set, `collectJsonResult` drives N in-page fetches — still ONE browser session, never
    // one render per page — and returns the unioned root array. Still SSRF-guarded via the
    // request interception above.
    const jsonResult = await collectJsonResult(url, opts.pagination, (u) => page.evaluate(jsonPageFetch, u));
    if (jsonResult) {
      // one browser, N in-page pages — the budget signal; flag cap-hit so a truncated list isn't
      // mistaken for a series that naturally ended after N pages.
      console.log(`[render] json pages=${jsonResult.pages}${jsonResult.capped ? ' (capped, may be truncated)' : ''}`);
      return { status: jsonResult.status, finalUrl: page.url(), html: jsonResult.body };
    }

    // Loop-click a "load more" control until it's gone (paginated TOCs).
    for (let i = 0; i < 60; i++) {
      const clicked = await page.evaluate((pattern) => {
        const re = new RegExp(pattern, 'i');
        const el = [...document.querySelectorAll('button, a')].find(
          (e) => re.test((e.textContent || '').trim()) && (e as HTMLElement).offsetParent !== null,
        );
        if (el) {
          (el as HTMLElement).click();
          return true;
        }
        return false;
      }, LOAD_MORE);
      if (!clicked) break;
      await new Promise((r) => setTimeout(r, 1_200));
    }

    const html = await page.content();
    return { status: resp?.status() ?? 200, finalUrl: page.url(), html };
  } finally {
    await browser?.close();
  }
}
