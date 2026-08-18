import { parseChapterNumber } from './parse';
import type { TocChapter } from './pageWatch';

/**
 * WP-45: read a source's chapter data API (JSON) directly. An API returns the COMPLETE
 * chapter list with lock state — TOC semantics — so this parser emits the same `TocChapter[]`
 * the page-watch path produces, and the diff / "now free" machinery downstream is untouched.
 * Pure (JSON string → chapters); the fetch lives in the injected port. The descriptor is
 * per-source (stored on Source.apiMap), so no site-specific code lives here.
 */
export interface ApiDescriptor {
  /** Dot-path to the chapter array in the JSON (e.g. "data.chapters"). Absent → the root is the array. */
  listPath?: string;
  /** Item key/path → chapter url or permalink (resolved absolute against the endpoint origin). */
  urlField: string;
  /** Item key/path → chapter number. Absent/non-numeric → parsed from the title, then the url. */
  numberField?: string;
  /** Item key/path → chapter title. */
  titleField: string;
  /** Item key/path → free/locked flag. Absent → every chapter is FREE (e.g. a static JSON file). */
  isFreeField?: string;
  /** How to read `isFreeField`: 'truthy' (default) = "is free"; 'falsy' = the field is `locked` (inverse). */
  isFreeWhen?: 'truthy' | 'falsy';
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function toBool(v: unknown): boolean {
  if (typeof v === 'string') return !['', '0', 'false', 'no'].includes(v.trim().toLowerCase());
  return Boolean(v);
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const fromTitle = parseChapterNumber(v);
    if (fromTitle !== null) return fromTitle;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseApiChapters(body: string, descriptor: ApiDescriptor, baseUrl: string): TocChapter[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const list = descriptor.listPath ? getPath(parsed, descriptor.listPath) : parsed;
  if (!Array.isArray(list)) return [];

  const chapters: TocChapter[] = [];
  for (const item of list) {
    if (item == null || typeof item !== 'object') continue;
    const rawUrl = getPath(item, descriptor.urlField);
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') continue;
    let url: string;
    try {
      url = new URL(rawUrl, baseUrl).toString();
    } catch {
      continue;
    }
    const titleVal = getPath(item, descriptor.titleField);
    const title = typeof titleVal === 'string' ? titleVal.replace(/\s+/g, ' ').trim() : '';
    const number =
      (descriptor.numberField ? coerceNumber(getPath(item, descriptor.numberField)) : null) ??
      parseChapterNumber(title) ??
      parseChapterNumber(url);

    let free = true;
    if (descriptor.isFreeField != null) {
      const flag = toBool(getPath(item, descriptor.isFreeField));
      free = descriptor.isFreeWhen === 'falsy' ? !flag : flag;
    }
    chapters.push({ url, title, number, access: free ? 'FREE' : 'LOCKED' });
  }
  return chapters;
}
