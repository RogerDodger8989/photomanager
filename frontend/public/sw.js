const CACHE_NAME = 'photomanager-v2';
const STATIC_ASSETS = [
  '/',
  '/app.js',
  '/manifest.json',
];

// Thumbnails cachas separat med LRU (max 500 bilder)
const THUMB_CACHE = 'pm-thumbs-v1';
const THUMB_MAX   = 500;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== THUMB_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API-anrop och JS-moduler — alltid nätverket, aldrig cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/share/') || url.pathname.startsWith('/src/')) {
    return;
  }

  // Thumbnails — cache-first med nätverks-fallback
  if (url.pathname.startsWith('/thumbs/')) {
    e.respondWith(cacheFirstThumb(e.request));
    return;
  }

  // Statiska filer — cache-first med quota-skydd
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ?? fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone).catch(() => {}));
        }
        return res;
      })
    )
  );
});

async function cacheFirstThumb(request) {
  const cache = await caches.open(THUMB_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    // Enkel LRU: ta bort äldsta om vi når max
    const keys = await cache.keys();
    if (keys.length >= THUMB_MAX) await cache.delete(keys[0]);
    await cache.put(request, response.clone());
  }
  return response;
}

// Web Push-notiser
self.addEventListener('push', (e) => {
  const data = e.data?.json() ?? {};
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'PhotoManager', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: data.url ?? '/',
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data ?? '/'));
});
