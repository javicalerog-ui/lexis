/**
 * Lexis service worker
 *
 * Estrategias:
 *   - Navegación HTML  → network-first con fallback a cache (rápido cuando hay red,
 *                        funcional cuando no la hay).
 *   - Assets estáticos → cache-first con revalidación en segundo plano.
 *   - API calls        → siempre network. No cacheamos endpoints autenticados.
 *
 * El cache se versiona; cambia CACHE_VERSION para invalidar tras un deploy.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `lexis-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `lexis-static-${CACHE_VERSION}`;

const SHELL_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// =====================================================
// Install: precachea la shell para arranque offline rápido
// =====================================================

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(SHELL_URLS).catch((err) => {
        // No fallar el install si algún recurso no responde (típico en dev)
        console.warn('SW: precache parcial', err);
      })
    )
  );
  self.skipWaiting();
});

// =====================================================
// Activate: borra caches viejos de versiones anteriores
// =====================================================

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (k) => !k.endsWith(`-${CACHE_VERSION}`) && k.startsWith('lexis-')
          )
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// =====================================================
// Fetch: enrutado por tipo
// =====================================================

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // No interferir con métodos no-GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Ignorar otros orígenes (Voyage, OpenRouter, Google, etc.)
  if (url.origin !== self.location.origin) return;

  // Ignorar endpoints API: siempre network (auth-dependent, dinámico)
  if (url.pathname.startsWith('/api/')) return;

  // Estrategia para navegación HTML: network-first con fallback
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Estrategia para assets estáticos (iconos, _next/static): cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Default: network normal
});

// =====================================================
// Estrategias
// =====================================================

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    // Cachear la respuesta para próximo offline
    if (res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Último recurso: la shell raíz
    const root = await caches.match('/');
    if (root) return root;
    return new Response(
      '<html><body style="font-family:sans-serif;padding:40px;background:#060812;color:#e7eaf3"><h1>Sin conexión</h1><p>Vuelve a intentarlo cuando tengas red.</p></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Revalidación en background, devolvemos cache de inmediato
    fetch(request)
      .then((res) => {
        if (res.ok) {
          caches.open(STATIC_CACHE).then((c) => c.put(request, res));
        }
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    return new Response('Asset offline', { status: 504 });
  }
}

// =====================================================
// Push notifications (Sprint 16)
// =====================================================

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'Lexis',
      body: event.data.text(),
    };
  }

  const title = payload.title || 'Lexis';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url || '/', ...(payload.data || {}) },
    actions: payload.actions || [],
    silent: !!payload.silent,
    requireInteraction: !!payload.require_interaction,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Si la notificación traía action específica, prepónlo a la URL
  const baseUrl = (event.notification.data && event.notification.data.url) || '/';
  const action = event.action;
  const targetUrl = action
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}action=${encodeURIComponent(action)}`
    : baseUrl;

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Si ya hay una ventana abierta de la PWA, navegar ahí
      for (const client of allClients) {
        try {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(targetUrl);
            return;
          }
        } catch {}
      }
      // Si no, abrir nueva
      await self.clients.openWindow(targetUrl);
    })()
  );
});
