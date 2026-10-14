// Cache only a generic, non-sensitive offline screen and the public app icon.
// Never intercept or cache /api/, credentials, private notes, or session data.
const CACHE = 'byte-back-public-offline-v1';
const PUBLIC_FILES = ['/offline.html', '/app-icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_FILES))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('byte-back-public-offline-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') ||
      event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match('/offline.html');
    return cached || Response.error();
  }));
});
