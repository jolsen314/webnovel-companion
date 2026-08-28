import { describe, expect, test } from 'vitest';
import { THEMES, DEFAULT_THEME, isThemeId, resolveTheme, buildThemeScript } from '../../src/lib/theme';

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

// Run the produced IIFE against minimal document/localStorage stubs. The script references
// `localStorage` and `document` as free identifiers, so a Function with those params shadows globals.
function runScript(stored: string | null) {
  const attrs: Record<string, string> = {};
  let metaColor = '';
  const document = {
    documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } },
    querySelector: (sel: string) =>
      sel.includes('theme-color') ? { setAttribute: (_k: string, v: string) => { metaColor = v; } } : null,
  };
  const localStorage = { getItem: (_k: string) => stored };
  // eslint-disable-next-line no-new-func
  new Function('localStorage', 'document', buildThemeScript())(localStorage, document);
  return { theme: attrs['data-theme'], metaColor };
}

describe('buildThemeScript', () => {
  test('applies a stored valid theme + its themeColor', () => {
    expect(runScript('scroll')).toEqual({ theme: 'scroll', metaColor: '#ded2b4' });
    expect(runScript('sci-fi')).toEqual({ theme: 'sci-fi', metaColor: '#070b12' });
  });
  test('falls back to night for missing or garbage', () => {
    expect(runScript(null).theme).toBe('night');
    expect(runScript('bogus').theme).toBe('night');
    expect(runScript(null).metaColor).toBe('#15131a');
  });
  test('never throws even with no meta tag present', () => {
    // querySelector returns null for a non-theme-color selector; script guards `if(m)`.
    expect(() => runScript('night')).not.toThrow();
  });
});
