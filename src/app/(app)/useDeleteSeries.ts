'use client';

import { useEffect, useState } from 'react';
import { requestDeleteSeries } from './requestDeleteSeries';

/**
 * The confirm → busy → error delete state machine shared by the shelf card
 * (`DeleteSeriesButton`) and the detail page (`DeleteSeries`). Only the markup and the
 * post-success action differ, so each component keeps its own JSX and passes `onDeleted`
 * (e.g. `router.refresh()` vs `router.push('/')`) plus its own failure copy.
 *
 * Escape-to-cancel is handled here (a window listener while the confirm is open and not
 * mid-delete), standardizing what the two components did differently before. On success we
 * keep `busy` set and hand off to `onDeleted` — the row is about to unmount (re-fetch) or the
 * page is about to navigate away, so the controls should stay disabled through the handoff.
 */
export function useDeleteSeries(opts: { id: string; onDeleted: () => void; failMessage: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => setConfirming(true);
  const cancel = () => {
    setConfirming(false);
    setError(null);
  };

  useEffect(() => {
    if (!confirming) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) cancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, busy]);

  async function confirm() {
    setBusy(true);
    setError(null);
    if (await requestDeleteSeries(opts.id)) {
      opts.onDeleted(); // keep busy: the card unmounts on refresh / the page navigates away
      return;
    }
    setError(opts.failMessage);
    setBusy(false);
  }

  return { confirming, busy, error, open, cancel, confirm };
}
