'use client';

import { useEffect } from 'react';
import { resyncSubscription } from './pushClient';

/**
 * Registers the service worker in production only. In development a SW's caching
 * fights the dev server and HMR (and a cached HTML shell without its hashed CSS/JS
 * renders unstyled), so here we actively unregister any stale one instead.
 *
 * On each production load it also re-syncs the push subscription (WP-09): if the
 * browser still holds a valid subscription, we re-POST it — self-healing a server-side
 * prune of an EXPIRED channel with no manual "reinstate" step.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const r of regs) void r.unregister();
      });
      return;
    }

    const register = async () => {
      await navigator.serviceWorker.register('/sw.js').catch(() => {});
      await resyncSubscription().catch(() => {});
    };
    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', () => void register(), { once: true });
  }, []);

  return null;
}
