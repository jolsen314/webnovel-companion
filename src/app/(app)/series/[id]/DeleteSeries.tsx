'use client';

import { useRouter } from 'next/navigation';
import { useDeleteSeries } from '../../useDeleteSeries';

export function DeleteSeries(props: { id: string; title: string; chapterCount: number }) {
  const router = useRouter();
  const { confirming, busy, error, open, cancel, confirm } = useDeleteSeries({
    id: props.id,
    onDeleted: () => router.push('/shelf'), // series page is gone → back to the library shelf
    failMessage: 'Could not delete the series.',
  });

  if (!confirming) {
    return (
      <div className="detail__danger">
        <button type="button" className="danger-button" onClick={open}>
          Delete series
        </button>
      </div>
    );
  }

  return (
    <div className="detail__danger detail__danger--open">
      <p className="detail__danger-warning">
        Delete “{props.title}”? This removes {props.chapterCount} chapters, its source, and your reading
        progress. This can’t be undone.
      </p>
      <div className="detail__danger-actions">
        <button
          type="button"
          className="danger-button danger-button--solid"
          disabled={busy}
          onClick={() => void confirm()}
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
