/*
 * Service worker de SERENA Companion: guarda el "cascarón" de la app para que
 * abra sin conexión. Nunca guarda respuestas de /api (datos personales): esos
 * viven cifrados en IndexedDB y se sincronizan con la cola de la app.
 */
const CACHE = 'serena-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/assets/serena-logo-white.png', '/assets/serena-mark.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    // Navegación: red primero, cascarón si no hay conexión.
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Recursos estáticos con hash: caché primero.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/'))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }),
    ),
  );
});
