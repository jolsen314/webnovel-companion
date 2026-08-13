'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestDeleteSeries } from './requestDeleteSeries';

export function DeleteSeriesButton(props: { id: string; title: string; chapterCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);

  async function doDelete() {
    setBusy(true);
    setError(null);
    const ok = await requestDeleteSeries(props.id);
    if (ok) {
      setOpen(false);
      router.refresh(); // card drops out of the re-fetched list
      return;
    }
    setError('Delete failed.');
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        className="card__delete"
        aria-label={`Delete ${props.title}`}
        onClick={() => setOpen(true)}
      >
        🗑
      </button>
      {open && (
        <div className="card__confirm" role="dialog" aria-label={`Delete ${props.title}`}>
          <p className="card__confirm-text">
            Delete “{props.title}”? {props.chapterCount} chapters + progress. Can’t be undone.
          </p>
          <div className="card__confirm-actions">
            <button
              type="button"
              className="danger-button danger-button--solid"
              disabled={busy}
              onClick={() => void doDelete()}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              className="control__action"
              disabled={busy}
              autoFocus
              onClick={close}
            >
              Cancel
            </button>
          </div>
          {error && (
            <span className="control__hint" role="status">
              {error}
            </span>
          )}
        </div>
      )}
    </>
  );
}
