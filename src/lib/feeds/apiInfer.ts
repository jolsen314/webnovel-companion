import type { ApiDescriptor, PaginationSpec } from './apiAdapter';

/**
 * WP-54: infer an {@link ApiDescriptor} from JSON responses captured while rendering a page (the
 * XHR-fetched chapters API a page loads at runtime, which {@link probeForApi}'s static-HTML scan
 * can't see). Pure — the browser capture lives in `server/render/`; this takes the captured
 * `{ url, body, headers }` and produces ranked candidate descriptors, host-agnostic (generic token
 * lists, no site names). A human reviews the candidates (esp. the reader-URL path prefix, which the
 * API response alone can't reveal) before wiring — this never auto-commits.
 */
export interface ApiCapture {
  /** The XHR request URL (query params included — that's where a per-series id/slug lives). */
  url: string;
  /** The raw JSON response body. */
  body: string;
  /** Response headers, lowercased keys (Puppeteer's `response.headers()` already lowercases). */
  headers?: Record<string, string>;
}

export interface InferredApi {
  apiUrl: string;
  descriptor: ApiDescriptor;
  /** How many items the captured list held — the confidence/ranking signal. */
  sampleCount: number;
  /** Human-facing caveats to resolve before/at wiring (e.g. confirm the reader-URL prefix). */
  notes: string[];
}

/**
 * Sentinel path segment for a `urlTemplate` whose reader-path prefix the API can't reveal (the item
 * carries only a bare slug/id). A human replaces it after opening one real chapter; the `probe-api`
 * CLI refuses `--apply` while it's still present.
 */
export const UNCONFIRMED_PREFIX = 'CONFIRM-READER-PATH';

/** Politeness/clarity bound on how many candidates a single probe surfaces. */
const MAX_CANDIDATES = 5;

/** Shallow paths to search for the chapter array when the JSON root isn't itself the array. */
const LIST_PATHS = ['data.chapters', 'data.list', 'data.items', 'data.results', 'chapters', 'list', 'items', 'results', 'data'];

/** Title-ish key names, in preference order. Value must be a non-numeric, non-URL string. */
const TITLE_KEYS = ['title', 'name', 'chapter_title', 'chaptername', 'label', 'heading', 'subject', 'chapter'];
/** Chapter-number-ish keys, in preference order. Deliberately excludes bare `id`. */
const NUMBER_KEYS = ['order', 'number', 'num', 'chapter_no', 'chapterno', 'index', 'seq', 'sort', 'position', 'chapter'];
/**
 * Keys whose value builds the reader URL when there's no full-URL field, best-guess first: a real
 * slug/path, then a human-readable sequential number, then an opaque id as a last resort (reader
 * URLs rarely key off a raw db id).
 */
const SLUG_KEYS = ['slug', 'permalink', 'path', 'chapter_slug', 'uri', 'href', 'order', 'number', 'index', 'seq', 'id', 'chapter_id', 'cid'];
/** Lock/free flag keys → the polarity the adapter should read them with. */
const LOCK_KEYS_FALSY = ['locked', 'is_locked', 'premium', 'is_premium', 'vip', 'is_vip', 'paid', 'is_paid'];
const LOCK_KEYS_TRUTHY = ['free', 'is_free', 'unlocked', 'is_unlocked', 'available'];
/** Response headers that advertise a total page count (>1 ⇒ paginated). */
const TOTAL_PAGES_HEADERS = ['x-wp-totalpages', 'x-total-pages', 'x-totalpages', 'x-pagination-page-count'];
/** Query-param names that carry the page number. */
const PAGE_PARAMS = ['page', 'paged', 'p', 'pg'];

function firstKey(item: Record<string, unknown>, candidates: string[], accept: (v: unknown) => boolean): string | undefined {
  const lower = new Map(Object.keys(item).map((k) => [k.toLowerCase(), k]));
  for (const c of candidates) {
    const actual = lower.get(c);
    if (actual != null && accept(item[actual])) return actual;
  }
  return undefined;
}

function isNumeric(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.trim() !== '' && Number.isFinite(Number(v));
  return false;
}

function isUrlish(v: unknown): boolean {
  return typeof v === 'string' && (/^https?:\/\//i.test(v.trim()) || v.trim().startsWith('/'));
}

function isTitleish(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '' && !isNumeric(v) && !/^https?:\/\//i.test(v.trim());
}

function isSlugish(v: unknown): boolean {
  return (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));
}

/** Locate the chapter array + its dot-path; returns null when no array-of-objects is found. */
function findList(parsed: unknown): { list: Record<string, unknown>[]; listPath?: string } | null {
  const asObjectArray = (v: unknown): Record<string, unknown>[] | null => {
    if (!Array.isArray(v)) return null;
    const objs = v.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x));
    return objs.length > 0 ? objs : null;
  };
  const root = asObjectArray(parsed);
  if (root) return { list: root };
  if (parsed == null || typeof parsed !== 'object') return null;
  for (const path of LIST_PATHS) {
    const at = path.split('.').reduce<unknown>((acc, k) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), parsed);
    const objs = asObjectArray(at);
    if (objs) return { list: objs, listPath: path };
  }
  return null;
}

/** Merge keys seen across the first few items so a field absent on item 0 is still detected. */
function representative(list: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const item of list.slice(0, 5)) {
    for (const [k, v] of Object.entries(item)) {
      if (!(k in merged) || merged[k] == null) merged[k] = v;
    }
  }
  return merged;
}

function stripParam(url: string, param: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete(param);
    return u.toString();
  } catch {
    return url;
  }
}

function inferPagination(url: string, headers: Record<string, string> | undefined, sampleCount: number): { pagination?: PaginationSpec; pageParam?: string; note?: string } {
  const h = headers ?? {};
  const totalPages = TOTAL_PAGES_HEADERS.map((k) => Number(h[k])).find((n) => Number.isFinite(n) && n > 1);
  let query: URLSearchParams | undefined;
  try {
    query = new URL(url).searchParams;
  } catch {
    query = undefined;
  }
  const pageParam = query ? PAGE_PARAMS.find((p) => query!.has(p)) : undefined;
  if (totalPages == null || !pageParam) return {};
  return {
    pagination: { pageParam, perPage: sampleCount },
    pageParam,
    note: `pagination: ${totalPages} pages advertised; confirm perPage matches the API's page size (set per_page=${sampleCount} in the endpoint too).`,
  };
}

function inferOne(cap: ApiCapture): InferredApi | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cap.body);
  } catch {
    return null;
  }
  const found = findList(parsed);
  if (!found) return null;
  const sample = representative(found.list);
  const notes: string[] = [];

  const titleField = firstKey(sample, TITLE_KEYS, isTitleish);
  if (!titleField) return null; // no title ⇒ not a chapter list

  const descriptor: ApiDescriptor = { titleField };
  if (found.listPath) descriptor.listPath = found.listPath;

  // Reader URL: a full-URL field wins; else a bare slug/id via a template the human finishes.
  const urlField = firstKey(sample, ['url', 'link', 'permalink', 'href', 'uri', 'source_url'], isUrlish);
  if (urlField) {
    descriptor.urlField = urlField;
  } else {
    const slugField = firstKey(sample, SLUG_KEYS, isSlugish);
    if (!slugField) return null; // no URL and no slug ⇒ can't reach a chapter ⇒ not usable
    descriptor.urlTemplate = `/${UNCONFIRMED_PREFIX}/{${slugField}}`;
    notes.push(
      `reader URL: items carry only \`${slugField}\`, not a full URL — open one real chapter and replace ` +
        `\`/${UNCONFIRMED_PREFIX}/\` with the actual path prefix (a series-level slug is baked in as a literal segment).`,
    );
  }

  const numberField = firstKey(sample, NUMBER_KEYS, isNumeric);
  if (numberField && numberField !== titleField) descriptor.numberField = numberField;

  const lockFalsy = firstKey(sample, LOCK_KEYS_FALSY, () => true);
  const lockTruthy = firstKey(sample, LOCK_KEYS_TRUTHY, () => true);
  if (lockFalsy) {
    descriptor.isFreeField = lockFalsy;
    descriptor.isFreeWhen = 'falsy';
  } else if (lockTruthy) {
    descriptor.isFreeField = lockTruthy;
    descriptor.isFreeWhen = 'truthy';
  } else {
    notes.push('no lock/free field detected — every chapter will be treated FREE (fine for a free-only source).');
  }

  const pag = inferPagination(cap.url, cap.headers, found.list.length);
  let apiUrl = cap.url;
  if (pag.pagination) {
    descriptor.pagination = pag.pagination;
    if (pag.pageParam) apiUrl = stripParam(apiUrl, pag.pageParam);
    if (pag.note) notes.push(pag.note);
  }

  return { apiUrl, descriptor, sampleCount: found.list.length, notes };
}

/**
 * Which network responses the render capture should read: only `xhr`/`fetch` resources whose
 * content-type is JSON (a document/script/image is never a data-API response, and a non-JSON body
 * can't be a chapter list). Pure so the renderer's collection rule is unit-testable.
 */
export function shouldCaptureResponse(meta: { resourceType?: string; contentType?: string }): boolean {
  const rt = (meta.resourceType ?? '').toLowerCase();
  if (rt && rt !== 'xhr' && rt !== 'fetch') return false;
  return /json/i.test(meta.contentType ?? '');
}

/** Infer ranked candidate descriptors from captured XHR responses (longest list first). */
export function inferApiDescriptors(captures: ApiCapture[]): InferredApi[] {
  const hits: InferredApi[] = [];
  const seen = new Set<string>();
  for (const cap of captures) {
    const hit = inferOne(cap);
    if (!hit || seen.has(hit.apiUrl)) continue;
    seen.add(hit.apiUrl);
    hits.push(hit);
  }
  hits.sort((a, b) => b.sampleCount - a.sampleCount);
  return hits.slice(0, MAX_CANDIDATES);
}
