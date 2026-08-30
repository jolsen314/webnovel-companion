import { describe, expect, test } from 'vitest';
import { resolveAssetUrl } from '../../src/lib/themeAssets';

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
