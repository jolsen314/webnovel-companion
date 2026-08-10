'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AddSeriesPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<{ addedTitle: string; existing: { id: string; title: string } } | null>(
    null,
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSimilar(null);
    try {
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          title?: string;
          similarTo?: { id: string; title: string };
        };
        if (data.similarTo) {
          // Non-blocking: the series WAS added; just flag a possible duplicate.
          setSimilar({ addedTitle: data.title ?? 'the series', existing: data.similarTo });
          setBusy(false);
          return;
        }
        router.push('/');
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Could not add that series.');
    } catch {
      setError('Couldn’t reach the server. Try again.');
    }
    setBusy(false);
  }

  return (
    <section className="login">
      <p className="login__eyebrow">Add a series</p>
      <h1 className="login__title">Paste a series URL</h1>
      {similar && (
        <div className="notice" role="status">
          <p>
            Added <strong>{similar.addedTitle}</strong>. This looks similar to{' '}
            <strong>{similar.existing.title}</strong>, which you already track — it may be the same work.
          </p>
          <div className="notice__actions">
            <Link href={`/series/${similar.existing.id}`} className="btn">
              Open “{similar.existing.title}”
            </Link>
            <Link href="/" className="btn btn--primary" onClick={() => router.refresh()}>
              Keep both, go to library
            </Link>
          </div>
          <p className="hero__note">Merging duplicates from the app is coming soon; for now the two are kept separate.</p>
        </div>
      )}
      <form className="login__form" onSubmit={onSubmit}>
        <input
          className="login__input"
          type="url"
          inputMode="url"
          placeholder="https://…/novel/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
          required
        />
        <p className="login__error" role="alert">
          {error}
        </p>
        <button className="btn btn--primary" type="submit" disabled={busy || url.trim().length === 0}>
          {busy ? 'Finding the feed…' : 'Add series'}
        </button>
        <Link href="/" className="btn">
          Cancel
        </Link>
      </form>
      <p className="hero__note">
        Paste the novel&rsquo;s page on a translator site. I&rsquo;ll find its release feed — or fall back to watching
        the page — and start tracking new chapters.
      </p>
    </section>
  );
}
