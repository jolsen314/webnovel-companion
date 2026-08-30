'use client';
import { useEffect, useState } from 'react';
import { scatter } from '../../lib/scatter';
import { resolveAssetUrl } from '../../lib/themeAssets';
import { isThemeId, type ThemeId } from '../../lib/theme';

const ASSET_BASE = process.env.NEXT_PUBLIC_THEME_ASSET_BASE;

/** Deterministic short binary string per index (no RNG at render → hydration-safe). */
function binaryString(i: number): string {
  const len = (i % 6) + 1; let s = ''; let n = (i * 2654435761) >>> 0;
  for (let k = 0; k < len; k++) { s += (n & 1).toString(); n = n >>> 1; }
  return s;
}

export function ThemeScene({ variant }: { variant: 'hero' | 'appwide' }) {
  const [theme, setTheme] = useState<ThemeId | null>(null);
  const [treeBroken, setTreeBroken] = useState(false);
  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    setTheme(isThemeId(attr) ? attr : 'night');
  }, []);
  if (!theme || theme === 'night') return null;

  const cls = `themeScene${variant === 'appwide' ? ' themeScene--appwide' : ''}`;
  const hero = variant === 'hero';

  if (theme === 'scroll') {
    const treeUrl = resolveAssetUrl('scroll-tree.png', ASSET_BASE);
    const petals = scatter(hero ? 44 : 18, 42);
    return (
      <div className={cls} aria-hidden="true">
        {hero && treeUrl && !treeBroken && (
          <img className="themeScene__tree" src={treeUrl} alt="" onError={() => setTreeBroken(true)} />
        )}
        {petals.map((p, i) => (
          <span key={i} className="themeScene__petal" style={{
            left: `${p.leftPct}%`, top: hero ? undefined : `${p.topPct}%`,
            transform: `scale(${p.scale})`, animationDuration: `${p.durSec}s`, animationDelay: `${p.delaySec}s`,
          }} />
        ))}
      </div>
    );
  }
  // sci-fi
  const bits = scatter(hero ? 70 : 34, 91);
  return (
    <div className={cls} aria-hidden="true">
      {hero && <><span className="themeScene__grid" /><span className="themeScene__glitch" /></>}
      {bits.map((b, i) => (
        <span
          key={i}
          className="themeScene__bit"
          // Per-bit delay + split durations (from the deterministic scatter) desync the field
          // so it breathes/wanders organically. Two values map to [flick, drift]: a quicker
          // opacity pulse and a slower, wider wander.
          style={{
            left: `${b.leftPct}%`,
            top: `${b.topPct}%`,
            animationDelay: `${b.delaySec}s`,
            animationDuration: `${(b.durSec * 0.5).toFixed(1)}s, ${(b.durSec * 2).toFixed(1)}s`,
          }}
        >
          {binaryString(i)}
        </span>
      ))}
    </div>
  );
}
