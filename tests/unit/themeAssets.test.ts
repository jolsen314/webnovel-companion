import { describe, expect, test } from 'vitest';
import { resolveAssetUrl, themeAssetBlobPath } from '../../src/lib/themeAssets';

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
