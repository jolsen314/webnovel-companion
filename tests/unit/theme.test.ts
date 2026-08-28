import { describe, expect, test } from 'vitest';
import { THEMES, DEFAULT_THEME, isThemeId, resolveTheme } from '../../src/lib/theme';

describe('theme registry', () => {
  test('ships exactly the three themes, night first', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['night', 'scroll', 'sci-fi']);
    expect(DEFAULT_THEME).toBe('night');
  });

  test('every theme has a label, a themeColor hex, and swatch chips', () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.themeColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(t.swatch.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('isThemeId', () => {
  test.each(['night', 'scroll', 'sci-fi'])('accepts %s', (v) => expect(isThemeId(v)).toBe(true));
  test.each(['', 'dark', 'NIGHT', null, undefined, 42])('rejects %s', (v) => expect(isThemeId(v)).toBe(false));
});

describe('resolveTheme', () => {
  test('valid id passes through', () => expect(resolveTheme('scroll')).toBe('scroll'));
  test('missing / unknown falls back to default', () => {
    expect(resolveTheme(null)).toBe('night');
    expect(resolveTheme(undefined)).toBe('night');
    expect(resolveTheme('bogus')).toBe('night');
  });
});
