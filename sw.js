const CACHE = 'rali-v34';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      // DOAR cache-urile v1 („rali-…"). Originea e partajată cu v2 („rali2-…"), iar
      // filtrul vechi `k !== CACHE` ștergea și cache-ul lui v2 la fiecare deploy v1:
      // deschideai REZERVA și aplicația PRIMARĂ rămânea fără offline, pe munte.
      // 'rali2-v13'.startsWith('rali-') e false — exact distincția de care e nevoie.
      // (Găsit la auditul de securitate din 02.08.2026, P1.)
      Promise.all(keys.filter(k => k.startsWith('rali-') && k !== CACHE).map(k => caches.delete(k)))
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
        // DAR nu pentru /v2/ — acolo fallback-ul corect e index-ul lui v2 (din
        // cache-ul lui v2; caches.match caută în toate), altfel v1 ar servi
        // propriul HTML la adresa v2, cu toate scripturile lipsă.
        if (e.request.mode === 'navigate') {
          const cale = new URL(e.request.url).pathname;
          return cale.includes('/v2/')
            ? caches.match(new URL('./v2/index.html', self.registration.scope).href)
                .then(r => r || Response.error())
            : caches.match('./index.html');
        }
        return Response.error();
      });
    })
  );
});
