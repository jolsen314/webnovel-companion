import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { assertPublicUrl } from './ssrfGuard';
import { collectJsonResult } from './renderJson';
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

export async function renderPage(
  url: string,
  opts: { pagination?: PaginationSpec } = {},
): Promise<{ status: number; finalUrl: string; html: string }> {
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

    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 2_000)); // let client-rendered lists settle

    // WP-45b: JSON resource. `page.content()` on a JSON navigation is the browser's JSON-VIEWER
    // HTML, not the raw body. Once `goto` has (for a CF-gated endpoint) triggered + solved the
    // challenge and left us on the domain with the cf_clearance cookie, in-page same-origin
    // fetch(es) (via `jsonPageFetch`) reuse that cookie and return raw JSON. When `pagination`
    // is set, `collectJsonResult` drives N in-page fetches — still ONE browser session, never
    // one render per page — and returns the unioned root array. Still SSRF-guarded via the
    // request interception above.
    const jsonResult = await collectJsonResult(url, opts.pagination, (u) => page.evaluate(jsonPageFetch, u));
    if (jsonResult) {
      console.log(`[render] json pages=${jsonResult.pages}`); // one browser, N in-page pages — the budget signal
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
