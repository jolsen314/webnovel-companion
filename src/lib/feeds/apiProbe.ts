import * as cheerio from 'cheerio';
import type { ApiDescriptor } from './apiAdapter';

/**
 * WP-45: generic, host-agnostic detection of a chapter data API advertised by the page.
 * No site names — an ordered list of signal detectors; each returns ordered candidate
 * endpoints (+ descriptor), and the probe returns their flattened, deduped, capped union —
 * `[]` when none. Pure (HTML → candidates). The caller (addSeries) tries each candidate in
 * order until one yields chapters; if none do, the normal add-time ladder runs.
 *
 * Detector 1 (static-JSON SPA): a shell element points at a `.json` data file via a `data-*`
 * attribute (the 2026-07-30 Cloudflare-Pages case). Conservative: only fires on a clear
 * `.json` pointer. A page can advertise more than one `.json` pointer (e.g. a decoy config
 * file ahead of the real chapter-data file in document order) — every match is returned so
 * the caller can try each until one parses to actual chapters.
 */
export interface ApiProbeHit {
  apiUrl: string;
  descriptor: ApiDescriptor;
}

/** Politeness/safety bound on how many candidate endpoints a single probe will surface. */
const MAX_API_CANDIDATES = 5;

/** The descriptor for the static-JSON SPA shape: a flat array of {title, url}, no lock state. */
const STATIC_JSON_DESCRIPTOR: ApiDescriptor = {
  urlField: 'url',
  titleField: 'title',
};

function detectStaticJson(html: string, baseUrl: string): ApiProbeHit[] {
  const $ = cheerio.load(html);
  const hits: ApiProbeHit[] = [];
  const seen = new Set<string>();
  $('*').each((_, el) => {
    if (hits.length >= MAX_API_CANDIDATES) return;
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
    for (const [name, value] of Object.entries(attribs)) {
      if (hits.length >= MAX_API_CANDIDATES) break;
      if (!name.startsWith('data-')) continue;
      if (typeof value !== 'string' || !/\.json(\?|$)/i.test(value.trim())) continue;
      let apiUrl: string;
      try {
        apiUrl = new URL(value.trim(), baseUrl).toString();
      } catch {
        // ignore an unparseable pointer and keep scanning
        continue;
      }
      if (seen.has(apiUrl)) continue;
      seen.add(apiUrl);
      hits.push({ apiUrl, descriptor: STATIC_JSON_DESCRIPTOR });
    }
  });
  return hits;
}

const DETECTORS: Array<(html: string, baseUrl: string) => ApiProbeHit[]> = [detectStaticJson];

/** Returns the ordered, deduped, capped union of every detector's candidates (document order
 *  within a detector, detector order across detectors); `[]` when no detector finds a signal. */
export function probeForApi(html: string, baseUrl: string): ApiProbeHit[] {
  const hits: ApiProbeHit[] = [];
  const seen = new Set<string>();
  for (const detect of DETECTORS) {
    for (const hit of detect(html, baseUrl)) {
      if (hits.length >= MAX_API_CANDIDATES) return hits;
      if (seen.has(hit.apiUrl)) continue;
      seen.add(hit.apiUrl);
      hits.push(hit);
    }
  }
  return hits;
}
