'use client';

import { useState } from 'react';
import { THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, isThemeId, type ThemeId } from '../../../lib/theme';

function currentTheme(): ThemeId {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const attr = document.documentElement.getAttribute('data-theme');
  return isThemeId(attr) ? attr : DEFAULT_THEME;
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);

  function choose(id: ThemeId) {
    setTheme(id);
    document.documentElement.setAttribute('data-theme', id);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      // ignore storage failures (private mode, etc.) — the live switch still applies
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    const color = THEMES.find((t) => t.id === id)?.themeColor;
    if (meta && color) meta.setAttribute('content', color);
  }

  return (
    <div className="settings__panel">
      <p className="settings__panelLabel">Theme</p>
      <div className="themeGrid" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme === t.id}
            className={`themeCard${theme === t.id ? ' themeCard--on' : ''}`}
            onClick={() => choose(t.id)}
          >
            <span className="themeCard__swatch" aria-hidden="true">
              {t.swatch.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            <span className="themeCard__text">
              <span className="themeCard__label">{t.label}</span>
              <span className="themeCard__blurb">{t.blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
