'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestDeleteSeries } from '../../requestDeleteSeries';

export function DeleteSeries(props: { id: string; title: string; chapterCount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setConfirming(false);
    setError(null);
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    const ok = await requestDeleteSeries(props.id);
    if (ok) {
      router.push('/'); // series page is gone → back to the shelf; keep busy so buttons stay disabled
      return;
    }
    setError('Could not delete the series.');
    setBusy(false);
  }

  if (!confirming) {
    return (
      <div className="detail__danger">
        <button type="button" className="danger-button" onClick={() => setConfirming(true)}>
          Delete series
        </button>
      </div>
    );
  }

  return (
    <div
      className="detail__danger detail__danger--open"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) cancel();
      }}
    >
      <p className="detail__danger-warning">
        Delete “{props.title}”? This removes {props.chapterCount} chapters, its source, and your reading
        progress. This can’t be undone.
      </p>
      <div className="detail__danger-actions">
        <button
          type="button"
          className="danger-button danger-button--solid"
          disabled={busy}
          onClick={() => void doDelete()}
        >
          {busy ? 'Deleting…' : 'Delete forever'}
        </button>
        <button type="button" className="control__action" disabled={busy} autoFocus onClick={cancel}>
          Cancel
        </button>
      </div>
      {error && (
        <span className="control__hint" role="status">
          {error}
        </span>
      )}
    </div>
  );
}
