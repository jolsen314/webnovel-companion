'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPushState, enablePush, disablePush, type PushState } from '../../pushClient';

interface Prefs {
  pushNewChapter: boolean;
  pushScheduled: boolean;
  pushSourceDown: boolean;
}

const TYPES: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'pushNewChapter', label: 'New chapters', hint: 'When a tracked series posts a new chapter.' },
  { key: 'pushScheduled', label: 'Predicted releases', hint: 'When a chapter is likely up, from a schedule you set.' },
  {
    key: 'pushSourceDown',
    label: 'Site problems',
    hint: 'When the translation website of a tracked novel stops responding.',
  },
];

export default function SettingsPage() {
  const [push, setPush] = useState<PushState | 'loading'>('loading');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void getPushState().then(setPush);
    void fetch('/api/notification-prefs')
      .then((r) => r.json())
      .then(setPrefs)
      .catch(() => {});
  }, []);

  async function toggleEnable() {
    setBusy(true);
    setPush(push === 'subscribed' ? await disablePush() : await enablePush());
    setBusy(false);
  }

  async function sendTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const s = (await res.json()) as { sent: number; expired: number; failed: number };
      setTestMsg(
        s.sent > 0
          ? `Sent to ${s.sent} device${s.sent === 1 ? '' : 's'}. Check your notifications.`
          : 'No device received it — make sure notifications are enabled above and in your OS settings.',
      );
    } catch {
      setTestMsg('Couldn’t reach the server. Try again.');
    }
    setTesting(false);
  }

  async function setType(key: keyof Prefs, value: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value }); // optimistic
    try {
      const res = await fetch('/api/notification-prefs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      setPrefs(await res.json());
    } catch {
      setPrefs(previous); // roll back on failure
    }
  }

  return (
    <section className="settings">
      <Link href="/" className="detail__back">
        ← Library
      </Link>
      <p className="settings__eyebrow">Settings</p>
      <h1 className="settings__title">Notifications</h1>

      <div className="settings__panel">
        <div className="settings__row">
          <div className="settings__rowText">
            <p className="settings__rowLabel">Push notifications</p>
            <p className="settings__rowHint">{pushStatusHint(push)}</p>
          </div>
          {(push === 'default' || push === 'subscribed') && (
            <button
              className={`btn ${push === 'subscribed' ? '' : 'btn--primary'}`}
              onClick={toggleEnable}
              disabled={busy}
            >
              {busy ? 'Working…' : push === 'subscribed' ? 'Turn off' : 'Enable notifications'}
            </button>
          )}
        </div>
        {push === 'subscribed' && (
          <div className="settings__test">
            <button className="btn" onClick={sendTest} disabled={testing}>
              {testing ? 'Sending…' : 'Send a test'}
            </button>
            {testMsg && (
              <p className="settings__rowHint" role="status">
                {testMsg}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="settings__panel" aria-disabled={push !== 'subscribed'}>
        <p className="settings__panelLabel">What to send</p>
        {prefs === null ? (
          <p className="settings__rowHint">Loading…</p>
        ) : (
          TYPES.map(({ key, label, hint }) => (
            <label className="switchRow" key={key}>
              <span className="settings__rowText">
                <span className="settings__rowLabel">{label}</span>
                <span className="settings__rowHint">{hint}</span>
              </span>
              <span className="switch">
                <input
                  className="switch__input"
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={(e) => void setType(key, e.target.checked)}
                />
                <span className="switch__track" aria-hidden="true" />
              </span>
            </label>
          ))
        )}
        {push !== 'subscribed' && push !== 'loading' && (
          <p className="settings__foot">These take effect once push notifications are on.</p>
        )}
      </div>
    </section>
  );
}

function pushStatusHint(push: PushState | 'loading'): string {
  switch (push) {
    case 'loading':
      return 'Checking…';
    case 'subscribed':
      return 'On for this device.';
    case 'default':
      return 'Off. Turn on to get a push when a chapter drops.';
    case 'denied':
      return 'Blocked. Allow notifications for this site in your browser settings, then reload.';
    case 'unsupported':
      return 'This browser can’t push. On iPhone, add the app to your Home Screen first, then return here.';
  }
}
