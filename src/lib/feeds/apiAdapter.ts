import { parseChapterNumber } from './parse';
import type { TocChapter } from './pageWatch';

/**
 * WP-45b: pagination descriptor — stores the query parameter name and per-page count for
 * paginated JSON API sources.
 */
export interface PaginationSpec {
  /** Query param to increment (e.g. "page"). */
  pageParam: string;
  /** Page size / the site's cap (e.g. 200) — per-descriptor, never hardcoded. */
  perPage: number;
  /** Runaway backstop (default 20). */
  maxPages?: number;
  /** Dot-path to each page's item array; mirrors ApiDescriptor.listPath. */
  listPath?: string;
}

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
  /**
   * Item key/path → chapter url or permalink (resolved absolute against the endpoint origin).
   * Optional when `urlTemplate` is supplied instead. When both are set, `urlTemplate` wins.
   */
  urlField?: string;
  /**
   * WP-54: build the reader URL from a template when the API carries only a bare slug/id and no
   * full permalink field. `{fieldPath}` placeholders resolve per-item via the same dot-path
   * lookup as the other fields (e.g. `/novel/{slug}`); literal segments stay literal, so a
   * series-level constant that lives outside each item (e.g. the series slug carried in the API
   * query) is baked in directly (e.g. `/novel/my-series/{order}`) — the descriptor is per-source.
   * Resolved absolute against the endpoint origin. An item whose placeholder is missing/empty is
   * skipped, exactly like a missing `urlField`.
   */
  urlTemplate?: string;
  /** Item key/path → chapter number. Absent/non-numeric → parsed from the title, then the url. */
  numberField?: string;
  /** Item key/path → chapter title. */
  titleField: string;
  /** Item key/path → free/locked flag. Absent → every chapter is FREE (e.g. a static JSON file). */
  isFreeField?: string;
  /** How to read `isFreeField`: 'truthy' (default) = "is free"; 'falsy' = the field is `locked` (inverse). */
  isFreeWhen?: 'truthy' | 'falsy';
  /** WP-45b: when present, the source is paginated — fetch every page and union (see fetchApiPages). */
  pagination?: PaginationSpec;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === 'object' && Object.hasOwn(acc as object, key)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Resolve a `urlTemplate` against an item: substitute each `{fieldPath}` with the item's value
 * (stringified). Returns null if any placeholder is missing/empty — the caller skips such items,
 * mirroring a missing `urlField`.
 *
 * Forward-compatible extension point: a `{field+N}`/`{field-N}` arithmetic offset (for a site whose
 * reader URL is `ch_{index+1}`) can be added here later by parsing an optional signed-int suffix off
 * the placeholder name — no change to any existing plain `{field}` template.
 */
function resolveTemplate(template: string, item: Record<string, unknown>): string | null {
  let missing = false;
  const out = template.replace(/\{([^}]+)\}/g, (_m, path: string) => {
    const value = getPath(item, path.trim());
    if (value == null || (typeof value !== 'string' && typeof value !== 'number')) {
      missing = true;
      return '';
    }
    const s = String(value).trim();
    if (s === '') missing = true;
    return s;
  });
  return missing ? null : out;
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
    // urlTemplate (bare-slug reader URLs) takes precedence over urlField when present.
    const rawUrl = descriptor.urlTemplate
      ? resolveTemplate(descriptor.urlTemplate, item as Record<string, unknown>)
      : descriptor.urlField
        ? getPath(item, descriptor.urlField)
        : null;
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
