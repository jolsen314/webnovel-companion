'use client';

import { useState } from 'react';

/** Only follow same-origin, non-protocol-relative redirect targets (no open redirect). */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get('next') ?? '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export default function LoginPage() {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (res.ok) {
        window.location.assign(safeNext());
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Something went wrong. Try again.');
    } catch {
      setError('Couldn’t reach the server. Try again.');
    }
    setBusy(false);
  }

  return (
    <section className="login">
      <p className="login__eyebrow">Locked</p>
      <h1 className="login__title">Enter your passphrase</h1>
      <form className="login__form" onSubmit={onSubmit}>
        <input
          className="login__input"
          type="password"
          name="passphrase"
          autoComplete="current-password"
          placeholder="Passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoFocus
          required
        />
        <p className="login__error" role="alert">
          {error}
        </p>
        <button className="btn btn--primary" type="submit" disabled={busy || passphrase.length === 0}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </section>
  );
}
