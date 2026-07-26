/* Minimal service worker: enables PWA install (needed for iOS Web Push in WP-09).
 *
 * It intentionally does NOT cache app assets. A stale HTML shell served without its
 * hashed CSS/JS renders unstyled, and offline caching isn't an MVP concern (it's
 * Tier 4 in the README). The fetch listener exists only so browsers treat the app
 * as installable; it lets every request fall through to the network. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Drop any caches left by earlier SW versions, then take control.
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', () => {
  // No-op: let the browser handle the request normally.
});

// Web Push (WP-09). The server sends a JSON PushMessage: { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  const title = data.title || 'Webnovel Companion';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag, // collapses repeat alerts for the same series
      data: { url: data.url || '/' },
      icon: '/icon.svg',
      badge: '/icon.svg',
    }),
  );
});

// Focus an open tab on the target URL (or open one) when a notification is tapped.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      if (clients.length > 0 && 'navigate' in clients[0]) {
        return clients[0].focus().then((c) => (c && c.navigate ? c.navigate(target) : c));
      }
      return self.clients.openWindow(target);
    }),
  );
});
