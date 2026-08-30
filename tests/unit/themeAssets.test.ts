import { describe, expect, test } from 'vitest';
import { resolveAssetUrl, themeAssetBlobPath, themeAssetBlobToken } from '../../src/lib/themeAssets';

describe('resolveAssetUrl', () => {
  test('joins base + name, normalizing a trailing slash', () => {
    expect(resolveAssetUrl('wax-seal.png', 'https://blob.example.com/themes')).toBe('https://blob.example.com/themes/wax-seal.png');
    expect(resolveAssetUrl('wax-seal.png', 'https://blob.example.com/themes/')).toBe('https://blob.example.com/themes/wax-seal.png');
  });
  test('local base works', () => {
    expect(resolveAssetUrl('scroll-tree.png', '/themes')).toBe('/themes/scroll-tree.png');
  });
  test('missing/empty base → null (caller falls back)', () => {
    expect(resolveAssetUrl('scroll-tree.png', undefined)).toBeNull();
    expect(resolveAssetUrl('scroll-tree.png', '')).toBeNull();
  });
});

describe('themeAssetBlobPath', () => {
  test('maps each allowlisted asset to its themes/<name> blob path', () => {
    expect(themeAssetBlobPath('wax-seal.png')).toBe('themes/wax-seal.png');
    expect(themeAssetBlobPath('scroll-tree.png')).toBe('themes/scroll-tree.png');
  });
  test('rejects any non-allowlisted name → null (proxy must not read arbitrary blobs)', () => {
    expect(themeAssetBlobPath('secret.png')).toBeNull();
    expect(themeAssetBlobPath('../wax-seal.png')).toBeNull();
    expect(themeAssetBlobPath('themes/wax-seal.png')).toBeNull();
    expect(themeAssetBlobPath('')).toBeNull();
    expect(themeAssetBlobPath('WAX-SEAL.PNG')).toBeNull();
  });
});

describe('themeAssetBlobToken', () => {
  test('prefers the store-derived THEME_ASSETS_READ_WRITE_TOKEN', () => {
    // Vercel injects the token under a name derived from the store name ("theme-assets"),
    // NOT the SDK-default BLOB_READ_WRITE_TOKEN — so the route must read it explicitly.
    expect(themeAssetBlobToken({ THEME_ASSETS_READ_WRITE_TOKEN: 'store-tok' })).toBe('store-tok');
  });
  test('falls back to the conventional BLOB_READ_WRITE_TOKEN', () => {
    expect(themeAssetBlobToken({ BLOB_READ_WRITE_TOKEN: 'conventional-tok' })).toBe('conventional-tok');
  });
  test('store-derived wins when both are set', () => {
    expect(
      themeAssetBlobToken({ THEME_ASSETS_READ_WRITE_TOKEN: 'store-tok', BLOB_READ_WRITE_TOKEN: 'conventional-tok' }),
    ).toBe('store-tok');
  });
  test('undefined when neither is set (get() then falls back to its own default lookup)', () => {
    expect(themeAssetBlobToken({})).toBeUndefined();
  });
});
