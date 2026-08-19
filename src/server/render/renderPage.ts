import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { assertPublicUrl } from './ssrfGuard';

/**
 * Headless render of a page (WP-17b) — the Vercel `@sparticuz/chromium` path. Launches
 * serverless Chromium, loads the URL, loop-clicks any generic "load more" control
 * (paginated TOCs), and returns the DOM as `{ status, finalUrl, html }` for `parseToc`.
 * Node-only (Puppeteer), so it lives under `server/render/`, not `lib/`. Interaction
 * selectors are generic (by visible text) — no per-site names in the repo; site-specific
 * overrides belong in data.
 *
 * SSRF: every request (navigation + subresource) is re-validated with the DNS-resolving
 * guard, so redirects/subresources can't reach an internal address. The caller is expected
 * to have already validated `url` itself before calling.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const LOAD_MORE = 'load more|show more|more chapters';

export async function renderPage(url: string): Promise<{ status: number; finalUrl: string; html: string }> {
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

    // WP-45b SPIKE (throwaway probe — keep only if the CF-gated JSON read validates):
    // auto-detect a JSON resource. On a JSON navigation `page.content()` returns the browser's
    // JSON-*viewer* HTML, not the raw body. But once `goto` has (for a CF-gated endpoint)
    // triggered + solved the challenge and left us on the domain holding the `cf_clearance`
    // cookie, an in-page same-origin fetch reuses that cookie and returns the RAW JSON. The
    // fetch still flows through the request interception above, so it stays SSRF-guarded. If
    // the response isn't JSON, fall through to the existing DOM/load-more behavior unchanged.
    const jsonProbe = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { credentials: 'include' });
        const ct = r.headers.get('content-type') ?? '';
        if (!/\bjson\b/i.test(ct)) return null;
        return { status: r.status, body: await r.text() };
      } catch {
        return null;
      }
    }, url);
    if (jsonProbe) {
      return { status: jsonProbe.status, finalUrl: page.url(), html: jsonProbe.body };
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
