// RALI 2 · service worker — offline-first, scope /v2/.
// ATENȚIE la deploy: CACHE se urcă MANUAL aici (scriptul deploy-pwa urcă doar sw-ul
// din rădăcină). Fără bump, telefonul servește versiunea veche.
const CACHE = 'rali2-v34';
const ASSETS = ['./', './index.html', './app.css', './manifest.json', './icon.svg',
  './js/main.js', './js/machine.js', './js/ui.js', './js/voice.js', './js/gps.js',
  './js/geo.js', './js/pace.js', './js/route.js', './js/store.js', './js/scan.js',
  './js/time.js', './js/learn.js', './js/debrief.js', './js/ble.js', './js/sync.js',
  './js/repere.js', './js/maps.js', './js/harta-vie.js', './js/harta-ecran.js'];

// ── CACHE-UL DE DALE (v35) ──────────────────────────────────────────────────
// Separat de cache-ul aplicației, din două motive:
//  • are altă politică (cache-first, cu plafon și evacuare), pe când codul aplicației
//    se înlocuiește în bloc la fiecare versiune;
//  • NU are voie să fie șters la actualizarea aplicației. Dalele descărcate pentru
//    Transfăgărășan sunt zeci de minute de descărcat pe un server public; un bump de
//    versiune care le arunca ar fi lăsat pilotul fără hartă exact acolo unde n-are semnal.
const DALE = 'rali2-dale';
const DALE_MAX = 2000;                    // ține ambele etape (măsurat: 610 + 934 dale)
const GAZDA_DALE = 'tile.openstreetmap.org';
let deLaTaiere = 0;
const atinse = new Set();                 // dale reînscrise o dată pe sesiune (vezi mai jos)

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
    Promise.all(keys.filter(k => k.startsWith('rali2-') && k !== CACHE && k !== DALE)
                    .map(k => caches.delete(k)))));
  self.clients.claim();
});

// LRU aproximativ. Cache API nu ține metadate, dar păstrează ordinea de inserare, iar
// `put` peste o intrare existentă o mută la coadă. Reînscriem o dală la PRIMA folosire
// din sesiunea asta (de-aia `atinse`): costă o scriere per dală văzută — câteva zeci pe
// tură — și face ca cele mai vechi NEATINSE să iasă primele când se umple. Dacă un
// browser n-ar respecta ordinea, comportamentul degradează în FIFO: tot corect.
async function raspundeDala(req) {
  const c = await caches.open(DALE);
  const url = req.url;
  const hit = await c.match(url);
  if (hit) {
    if (!atinse.has(url)) { atinse.add(url); c.put(url, hit.clone()).catch(() => {}); }
    return hit;
  }
  let res = null;
  // CORS întâi: un răspuns opac se stochează cu „umplutură" de câțiva MB în Chrome, deci
  // 2000 de dale opace ar mânca tot spațiul aplicației. Dacă serverul nu dă CORS, cădem
  // pe cererea originală (opacă) — harta merge, doar ocupă mai mult.
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'origin' });
  } catch (e) { res = null; }
  if (!res || !res.ok) {
    try { res = await fetch(req); } catch (e) { return res || Response.error(); }
  }
  if (res && (res.ok || res.type === 'opaque')) {
    c.put(url, res.clone()).catch(() => {});
    if (++deLaTaiere >= 25) { deLaTaiere = 0; taie(c); }
  }
  return res;
}

async function taie(c) {
  try {
    const chei = await c.keys();
    const n = chei.length - DALE_MAX;
    for (let i = 0; i < n; i++) await c.delete(chei[i]);
  } catch (e) {}
}

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.hostname === 'api.anthropic.com' || e.request.method !== 'GET') return;
  if (u.hostname === GAZDA_DALE) { e.respondWith(raspundeDala(e.request)); return; }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).catch(() => {
      if (e.request.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    }))
  );
});
