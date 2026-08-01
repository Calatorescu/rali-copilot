const CACHE = 'rali-v18';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Verificare pe HOST, nu pe substring — „anthropic.com" oriunde în URL trecea de filtru.
  // Non-GET nu poate veni oricum din cache, deci trece direct la rețea.
  const u = new URL(e.request.url);
  if (u.hostname === 'api.anthropic.com' || e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).catch(() => {
        // Offline + cache miss: pentru o navigare (ex. URL-ul root „gol"),
        // servește index.html ca să nu apară ecran alb pe munte fără semnal.
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
