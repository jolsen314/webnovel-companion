'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AddSeriesPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (res.ok) {
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
