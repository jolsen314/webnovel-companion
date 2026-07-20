'use client';

import { useEffect } from 'react';

/**
 * Registers the offline-shell service worker. Push handling arrives in WP-09;
 * for now this just makes the app installable and shell-cacheable.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
