// RALI 2 · service worker — offline-first, scope /v2/.
// ATENȚIE la deploy: CACHE se urcă MANUAL aici (scriptul deploy-pwa urcă doar sw-ul
// din rădăcină). Fără bump, telefonul servește versiunea veche.
const CACHE = 'rali2-v33';
const ASSETS = ['./', './index.html', './app.css', './manifest.json', './icon.svg',
  './js/main.js', './js/machine.js', './js/ui.js', './js/voice.js', './js/gps.js',
  './js/geo.js', './js/pace.js', './js/route.js', './js/store.js', './js/scan.js',
  './js/time.js', './js/learn.js', './js/debrief.js', './js/ble.js', './js/sync.js',
  './js/repere.js', './js/maps.js'];

// `cache: 'reload'` ocolește cache-ul HTTP al browserului la instalare. Fără el, două
// deploy-uri în aceeași fereastră de max-age pot îngheța în CACHE un amestec de versiuni
// (main.js v30 lângă route.js v29) — iar amestecul rămâne acolo permanent, fiindcă
// service worker-ul nu mai cere niciodată fișierele alea. Un import care nu se potrivește
// oprește init() cu totul: aplicația pornește și nu face NIMIC. (Audit, 04.08.2026.)
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('rali2-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.hostname === 'api.anthropic.com' || e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).catch(() => {
      if (e.request.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    }))
  );
});
