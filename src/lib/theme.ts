export type ThemeId = 'night' | 'scroll' | 'sci-fi';

export const DEFAULT_THEME: ThemeId = 'night';
export const THEME_STORAGE_KEY = 'theme';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  blurb: string;
  themeColor: string; // drives <meta name="theme-color">
  swatch: string[]; // palette chips for the picker
}

export const THEMES: readonly ThemeMeta[] = [
  { id: 'night', label: 'Night reading', blurb: 'Warm ink, a single amber lamp.', themeColor: '#15131a', swatch: ['#15131a', '#ece4d6', '#e7b15c'] },
  { id: 'scroll', label: 'Ancient scroll', blurb: 'Aged parchment and a cinnabar seal.', themeColor: '#ded2b4', swatch: ['#e4d8bc', '#372a18', '#9e2b25'] },
  { id: 'sci-fi', label: 'Holo panel', blurb: 'Deep slate and a cyan glow.', themeColor: '#070b12', swatch: ['#070b12', '#d6e8f2', '#37e0d8'] },
];

const THEME_IDS: readonly ThemeId[] = THEMES.map((t) => t.id);

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

export function resolveTheme(v: string | null | undefined): ThemeId {
  return isThemeId(v) ? v : DEFAULT_THEME;
}
