'use client';
import { useState } from 'react';
import { resolveAssetUrl } from '../../lib/themeAssets';
const ASSET_BASE = process.env.NEXT_PUBLIC_THEME_ASSET_BASE;

export function WaxBadge({ count }: { count: number }) {
  const url = resolveAssetUrl('wax-seal.png', ASSET_BASE);
  const [broken, setBroken] = useState(false);
  const hasSeal = Boolean(url) && !broken; // false when base unset OR the image failed to load
  return (
    <span className={`card__unread${hasSeal ? ' card__unread--seal' : ' card__unread--noseal'}`}>
      {hasSeal && <img className="card__unread-img" src={url as string} alt="" onError={() => setBroken(true)} />}
      <span className="card__unread-num">{count}</span>
    </span>
  );
}
