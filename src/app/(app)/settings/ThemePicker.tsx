'use client';

import { useEffect, useRef, useState } from 'react';
import { THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, isThemeId, type ThemeId } from '../../../lib/theme';

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (isThemeId(attr)) setTheme(attr);
  }, []);

  // Arrow-key roving within the radiogroup: move selection + focus, wrapping at the ends.
  function onKey(e: React.KeyboardEvent, index: number) {
    const last = THEMES.length - 1;
    let next = index;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else return;
    e.preventDefault();
    const target = THEMES[next];
    if (!target) return;
    choose(target.id);
    btnRefs.current[next]?.focus();
  }

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
        {THEMES.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme === t.id}
            tabIndex={theme === t.id ? 0 : -1}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            className={`themeCard${theme === t.id ? ' themeCard--on' : ''}`}
            onClick={() => choose(t.id)}
            onKeyDown={(e) => onKey(e, i)}
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
