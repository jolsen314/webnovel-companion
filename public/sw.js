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
