import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { themeAssetBlobPath, themeAssetBlobToken } from '../../../../lib/themeAssets';

/**
 * Auth-gated proxy for WP-28h's licensed `scroll` theme images (WP-28i).
 *
 * The images can't be hosted publicly (license), so they live in a **private** Vercel Blob
 * store and are streamed here only to callers past the session gate — `src/proxy.ts`
 * runs on `/api/*` and this path is NOT in the public allowlist, so an unauthenticated
 * request is denied (401) before it reaches this handler.
 *
 * The `[name]` segment is mapped through `themeAssetBlobPath`, an exact-match allowlist: only
 * the two known assets resolve to a `themes/<name>` blob path, so the route can never be
 * coerced into reading an arbitrary object out of the private store.
 *
 * Any failure (missing token, store gone, network) degrades to 404 — never a 500 — so the
 * client `<img onError>` in `WaxBadge.tsx` / `ThemeScene.tsx` falls back to the WP-28h no-asset
 * state (no tree, plain red-circle badge). Prod points `NEXT_PUBLIC_THEME_ASSET_BASE` at
 * `/api/theme-asset`; local dev stays on `/themes` and never hits this route.
 */

export const dynamic = 'force-dynamic';

// Static, licensed images: cache in the browser but `private` so shared/CDN caches never hold
// them (that would let a cached copy bypass the auth gate). ETag enables cheap revalidation.
const CACHE_CONTROL = 'private, max-age=86400';

type NameParams = { params: Promise<{ name: string }> };

export async function GET(request: Request, { params }: NameParams) {
  const { name } = await params;
  const blobPath = themeAssetBlobPath(name);
  if (!blobPath) return new NextResponse(null, { status: 404 });

  try {
    const ifNoneMatch = request.headers.get('if-none-match') ?? undefined;
    // Pass the token explicitly: Vercel names a store's token after the store
    // (THEME_ASSETS_READ_WRITE_TOKEN), so get()'s implicit BLOB_READ_WRITE_TOKEN lookup would miss it.
    const token = themeAssetBlobToken(process.env);
    const result = await get(blobPath, { access: 'private', ifNoneMatch, token });
    if (!result) return new NextResponse(null, { status: 404 });

    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: { 'Cache-Control': CACHE_CONTROL, ETag: result.blob.etag },
      });
    }

    return new NextResponse(result.stream, {
      status: 200,
      headers: {
        'Content-Type': result.blob.contentType || 'image/png',
        'Cache-Control': CACHE_CONTROL,
        ETag: result.blob.etag,
      },
    });
  } catch (err) {
    // Graceful for the client (the <img onError> fallback holds), but log so a real misconfig
    // (missing/renamed token, store gone) is visible in function logs instead of a silent 404.
    console.error(`theme-asset proxy failed for ${blobPath}:`, err);
    return new NextResponse(null, { status: 404 });
  }
}
