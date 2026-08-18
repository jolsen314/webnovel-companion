import * as cheerio from 'cheerio';
import type { ApiDescriptor } from './apiAdapter';

/**
 * WP-45: generic, host-agnostic detection of a chapter data API advertised by the page.
 * No site names — an ordered list of signal detectors; each returns an endpoint + descriptor,
 * or the probe returns null and the normal add-time ladder runs. Pure (HTML → descriptor?).
 *
 * Detector 1 (static-JSON SPA): a shell element points at a `.json` data file via a `data-*`
 * attribute (the 2026-07-30 Cloudflare-Pages case). Conservative: only fires on a clear
 * `.json` pointer.
 */
export interface ApiProbeHit {
  apiUrl: string;
  descriptor: ApiDescriptor;
}

/** The descriptor for the static-JSON SPA shape: a flat array of {title, url}, no lock state. */
const STATIC_JSON_DESCRIPTOR: ApiDescriptor = {
  urlField: 'url',
  titleField: 'title',
};

function detectStaticJson(html: string, baseUrl: string): ApiProbeHit | null {
  const $ = cheerio.load(html);
  let hit: ApiProbeHit | null = null;
  $('*').each((_, el) => {
    if (hit) return;
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
    for (const [name, value] of Object.entries(attribs)) {
      if (!name.startsWith('data-')) continue;
      if (typeof value !== 'string' || !/\.json(\?|$)/i.test(value.trim())) continue;
      try {
        hit = { apiUrl: new URL(value.trim(), baseUrl).toString(), descriptor: STATIC_JSON_DESCRIPTOR };
      } catch {
        // ignore an unparseable pointer and keep scanning
      }
      if (hit) return;
    }
  });
  return hit;
}

const DETECTORS: Array<(html: string, baseUrl: string) => ApiProbeHit | null> = [detectStaticJson];

export function probeForApi(html: string, baseUrl: string): ApiProbeHit | null {
  for (const detect of DETECTORS) {
    const hit = detect(html, baseUrl);
    if (hit) return hit;
  }
  return null;
}
