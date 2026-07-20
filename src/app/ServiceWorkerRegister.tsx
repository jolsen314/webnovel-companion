'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker in production only. In development a SW's caching
 * fights the dev server and HMR (and a cached HTML shell without its hashed CSS/JS
 * renders unstyled), so here we actively unregister any stale one instead.
 * Push handling arrives in WP-09.
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

    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
