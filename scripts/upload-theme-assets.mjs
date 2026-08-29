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
const urls = [];

for (const name of assets) {
  const { url } = await put(`themes/${name}`, readFileSync(`public/themes/${name}`), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'image/png',
  });
  urls.push(url);
  console.log(name, '→', url);
}

const base = urls[0].slice(0, urls[0].lastIndexOf('/'));
console.log(`\nSet NEXT_PUBLIC_THEME_ASSET_BASE to the common base in Vercel + .env: ${base}`);
