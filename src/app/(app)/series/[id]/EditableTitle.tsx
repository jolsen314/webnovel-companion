'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function EditableTitle(props: { id: string; initialTitle: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== props.initialTitle && !busy;

  function startEdit() {
    setValue(props.initialTitle);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/series/${props.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditing(false);
      router.refresh();
    } catch {
      setError('Could not save the title.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <h1 className="detail__title">
        {props.initialTitle}
        <button type="button" className="detail__title-edit" aria-label="Edit title" onClick={startEdit}>
          ✎
        </button>
      </h1>
    );
  }

  return (
    <div className="detail__title-edit-row">
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input
        className="detail__title-input"
        aria-label="Series title"
        value={value}
        autoFocus
        disabled={busy}
        maxLength={500}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') cancel();
        }}
      />
      <button type="button" className="control__action" disabled={!canSave} onClick={() => void save()}>
        Save
      </button>
      <button type="button" className="control__action" disabled={busy} onClick={cancel}>
        Cancel
      </button>
      {error && <span className="control__hint" role="status">{error}</span>}
    </div>
  );
}
