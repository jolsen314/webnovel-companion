import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { assertPublicUrl } from './ssrfGuard';
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
 * SSRF: every request (navigation + subresource, including the in-page JSON fetch(es)) is
 * re-validated with the DNS-resolving guard, so redirects/subresources can't reach an internal
 * address. The caller is expected to have already validated `url` itself before calling.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const LOAD_MORE = 'load more|show more|more chapters';

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
    // fetch(es) reuse that cookie and return raw JSON. When `pagination` is set we loop pages
    // INSIDE this one browser session (clear CF once) and return the unioned root array — never
    // one render per page. Still SSRF-guarded via the request interception above.
    const jsonResult = await page.evaluate(
      async (u, pg) => {
        const isJson = (r: Response) => /\bjson\b/i.test(r.headers.get('content-type') ?? '');
        const itemsAt = (parsed: unknown, listPath?: string): unknown[] => {
          let node: unknown = parsed;
          if (listPath)
            for (const k of listPath.split('.'))
              node = node && typeof node === 'object' ? (node as Record<string, unknown>)[k] : undefined;
          return Array.isArray(node) ? node : [];
        };
        try {
          if (!pg) {
            const r = await fetch(u, { credentials: 'include' });
            if (!isJson(r)) return null;
            return { status: r.status, body: await r.text(), pages: 1 };
          }
          const all: unknown[] = [];
          let status = 200;
          const max = pg.maxPages ?? 20;
          let n = 1;
          for (; n <= max; n++) {
            const pu = new URL(u);
            pu.searchParams.set(pg.pageParam, String(n));
            const r = await fetch(pu.toString(), { credentials: 'include' });
            status = r.status;
            if (!isJson(r)) return null;
            const items = itemsAt(JSON.parse(await r.text()), pg.listPath);
            all.push(...items);
            if (items.length < pg.perPage) break;
          }
          return { status, body: JSON.stringify(all), pages: Math.min(n, max) };
        } catch {
          return null;
        }
      },
      url,
      opts.pagination ?? null,
    );
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
