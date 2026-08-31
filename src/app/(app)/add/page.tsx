'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ThemeScene } from '../ThemeScene';

/** The three shapes `POST /api/series` returns on success — needs-confirm (unreadable page),
 *  added-but-similar (possible duplicate), or a plain add. Replaces three progressive `as` casts. */
type AddSeriesResponse =
  | { needsConfirm: true; reason: 'blocked' | 'no-chapters'; suggestedTitle: string; url: string }
  | { needsConfirm?: false; seriesId?: string; title?: string; similarTo?: { id: string; title: string } };

/** POST a body to `/api/series`. `ok` carries the typed success union; a failure distinguishes a
 *  server response (`reached: true`, with any `error` string) from an unreachable server. */
async function postSeries(
  body: Record<string, unknown>,
): Promise<{ ok: true; data: AddSeriesResponse } | { ok: false; reached: boolean; error?: string }> {
  try {
    const res = await fetch('/api/series', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true, data: (await res.json().catch(() => ({}))) as AddSeriesResponse };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reached: true, error: data.error };
  } catch {
    return { ok: false, reached: false };
  }
}

export default function AddSeriesPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<{
    addedId?: string;
    addedTitle: string;
    existing: { id: string; title: string };
  } | null>(null);
  const [confirm, setConfirm] = useState<{ reason: 'blocked' | 'no-chapters'; suggestedTitle: string; url: string } | null>(null);
  const [confirmTitle, setConfirmTitle] = useState('');

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSimilar(null);
    const result = await postSeries({ url: url.trim() });
    if (!result.ok) {
      setError(result.reached ? (result.error ?? 'Could not add that series.') : 'Couldn’t reach the server. Try again.');
      setBusy(false);
      return;
    }
    const data = result.data;
    if (data.needsConfirm) {
      setConfirm({ reason: data.reason, suggestedTitle: data.suggestedTitle, url: data.url });
      setConfirmTitle(data.suggestedTitle);
      setBusy(false);
      return;
    }
    if (data.similarTo) {
      // Non-blocking: the series WAS added; flag a possible duplicate but still let them jump to it.
      setSimilar({ addedId: data.seriesId, addedTitle: data.title ?? 'the series', existing: data.similarTo });
      setBusy(false);
      return;
    }
    router.push(data.seriesId ? `/shelf?added=${data.seriesId}` : '/shelf');
    router.refresh();
  }

  async function addLinkOnly() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    const result = await postSeries({
      url: confirm.url,
      allowLinkOnly: true,
      title: confirmTitle.trim() || confirm.suggestedTitle,
    });
    if (result.ok) {
      const sid = result.data.needsConfirm ? undefined : result.data.seriesId;
      router.push(sid ? `/shelf?added=${sid}` : '/shelf');
      router.refresh();
      return;
    }
    setError('Could not add the link-only entry.');
    setBusy(false);
  }

  return (
    <>
      <ThemeScene variant="hero" />
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
            <Link href={similar.addedId ? `/shelf?added=${similar.addedId}` : '/shelf'} className="btn btn--primary" onClick={() => router.refresh()}>
              Keep both, go to library
            </Link>
          </div>
          <p className="hero__note">Merging duplicates from the app is coming soon; for now the two are kept separate.</p>
        </div>
      )}
      {confirm && (
        <div className="notice" role="status">
          <p>
            {confirm.reason === 'blocked'
              ? `${new URL(confirm.url).host} appears to be blocking automated requests (often Cloudflare), so we can’t read its chapter list. Add it as a link-only entry — a shelf card and a quick link, but no automatic new-chapter tracking.`
              : 'We couldn’t find a chapter list on that page — it may not be the series’ contents/TOC page. Add it as a link-only entry anyway, or cancel and paste the table-of-contents page.'}
          </p>
          <label className="control">
            <span className="control__label">Title</span>
            <input className="login__input" value={confirmTitle} onChange={(e) => setConfirmTitle(e.target.value)} />
          </label>
          <div className="notice__actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void addLinkOnly()}>
              Add anyway
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
          {error && (
            <p className="login__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {!confirm && (
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
      )}
      <p className="hero__note">
        Paste the novel&rsquo;s page on a translator site. I&rsquo;ll find its release feed — or fall back to watching
        the page — and start tracking new chapters.
      </p>
      </section>
    </>
  );
}
