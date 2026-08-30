// Upload the licensed theme scene assets (public/themes/*.png, gitignored — see
// public/themes/CREDITS.md) to Vercel Blob so they're servable in prod.
// Owner-run: needs a Blob store's read-write token. See docs/theme-assets.md.
// Usage: BLOB_READ_WRITE_TOKEN=... node scripts/upload-theme-assets.mjs
import { put } from '@vercel/blob';
import { readFileSync } from 'node:fs';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Usage: BLOB_READ_WRITE_TOKEN=... node scripts/upload-theme-assets.mjs');
  console.error('(create a Blob store on the Vercel project first — see docs/theme-assets.md)');
  process.exit(1);
}

const assets = ['wax-seal.png', 'scroll-tree.png'];

for (const name of assets) {
  // access: 'private' — the licenses don't permit public redistribution, so the blobs are
  // served only through the auth-gated /api/theme-asset proxy (WP-28i), never via a public URL.
  const { pathname } = await put(`themes/${name}`, readFileSync(`public/themes/${name}`), {
    access: 'private',
    addRandomSuffix: false,
    contentType: 'image/png',
  });
  console.log(name, '→', pathname, '(private)');
}

console.log(
  '\nSet NEXT_PUBLIC_THEME_ASSET_BASE=/api/theme-asset in Vercel + .env — the app streams these\n' +
    'private blobs through the auth-gated proxy route, not a public Blob URL.',
);
