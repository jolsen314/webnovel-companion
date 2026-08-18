'use client';

import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { useDeleteSeries } from './useDeleteSeries';

export function DeleteSeriesButton(props: { id: string; title: string; chapterCount: number }) {
  const router = useRouter();
  const { confirming, busy, error, open, cancel, confirm } = useDeleteSeries({
    id: props.id,
    onDeleted: () => router.refresh(), // card drops out of the re-fetched list
    failMessage: 'Delete failed.',
  });

  return (
    <>
      <button
        type="button"
        className="card__delete"
        aria-label={`Delete ${props.title}`}
        onClick={open}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
      {confirming && (
        <div className="card__confirm" role="dialog" aria-label={`Delete ${props.title}`}>
          <p className="card__confirm-text">
            Delete “{props.title}”? {props.chapterCount} chapters + progress. Can’t be undone.
          </p>
          <div className="card__confirm-actions">
            <button
              type="button"
              className="danger-button danger-button--solid"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              className="control__action"
              disabled={busy}
              autoFocus
              onClick={cancel}
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
