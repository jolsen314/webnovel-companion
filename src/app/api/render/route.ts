import { NextResponse } from 'next/server';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { assertPublicUrl } from '../../../server/render/ssrfGuard';

/**
 * Headless render endpoint (WP-17b) — the Vercel `@sparticuz/chromium` prototype. The
 * poll's `renderFetch` POSTs `{ url }`; we launch serverless Chromium, render the page,
 * loop-click any generic "load more" control (paginated TOCs), and return the DOM as
 * `{ status, finalUrl, html }` for `parseToc`. Interaction selectors are generic (by
 * visible text) — no per-site names in the repo; site-specific overrides belong in data.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const LOAD_MORE = 'load more|show more|more chapters';

export async function POST(request: Request) {
  // Fail closed: with no secret configured the endpoint is disabled (never an open
  // SSRF surface). It's a public path, so RENDER_SECRET is its only gate.
  const secret = process.env.RENDER_SECRET;
  if (!secret) return NextResponse.json({ error: 'Renderer not configured.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const url = (body as { url?: unknown })?.url;
  if (typeof url !== 'string') {
    return NextResponse.json({ error: 'A "url" string is required.' }, { status: 400 });
  }
  // SSRF guard: only public http(s) targets (no metadata/loopback/RFC1918).
  try {
    await assertPublicUrl(url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'URL not allowed.' }, { status: 400 });
  }

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
    return NextResponse.json({ status: resp?.status() ?? 200, finalUrl: page.url(), html });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'render failed' }, { status: 500 });
  } finally {
    await browser?.close();
  }
}
