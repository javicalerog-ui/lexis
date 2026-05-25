'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker.
 * Solo en producción y solo en navegadores que lo soporten.
 * En dev no lo registra para evitar caches que confundan el HMR.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          console.warn('SW: registro falló', err);
        });
    };

    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad);
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  return null;
}
