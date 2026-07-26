/**
 * Browser-side Web Push helpers (WP-09). Called from client components. The service
 * worker is registered in production only (see ServiceWorkerRegister), so push is a
 * production/installed-PWA feature — in dev these no-op gracefully.
 */

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export type PushState = 'unsupported' | 'denied' | 'default' | 'subscribed';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub),
  });
}

/** Current subscription state, for rendering the toggle. */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'subscribed' : 'default';
}

/** Request permission, subscribe, and register with the server. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!VAPID_PUBLIC) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
  });
  await postSubscription(sub);
  return 'subscribed';
}

/** Unsubscribe this device. The server prunes its row lazily on the next failed send. */
export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  return 'default';
}

/**
 * Re-register an existing subscription on app load — self-heals a server-side prune
 * (an EXPIRED channel we deleted) whenever the browser still holds a valid subscription.
 */
export async function resyncSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await postSubscription(sub);
}
