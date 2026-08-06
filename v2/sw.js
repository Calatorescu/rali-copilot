// RALI 2 · service worker — offline-first, scope /v2/.
// ATENȚIE la deploy: CACHE se urcă MANUAL aici (scriptul deploy-pwa urcă doar sw-ul
// din rădăcină). Fără bump, telefonul servește versiunea veche.
const CACHE = 'rali2-v40';
const ASSETS = ['./', './index.html', './app.css', './manifest.json', './icon.svg',
  './js/main.js', './js/machine.js', './js/ui.js', './js/voice.js', './js/gps.js',
  './js/geo.js', './js/pace.js', './js/route.js', './js/store.js', './js/scan.js',
  './js/time.js', './js/learn.js', './js/debrief.js', './js/ble.js', './js/sync.js',
  './js/repere.js', './js/maps.js', './js/harta-vie.js', './js/harta-ecran.js'];

// ── CACHE-UL DE DALE (v35) ──────────────────────────────────────────────────
// Separat de cache-ul aplicației, din două motive:
//  • are altă politică (cache-first, cu plafon și evacuare), pe când codul aplicației
//    se înlocuiește în bloc la fiecare versiune;
//  • NU are voie să fie șters la actualizarea aplicației. Dalele se strâng ÎN MERS, una
//    câte una, pe măsură ce drumul trece pe sub ele — nu se descarcă în masă (interzis
//    de politica OSM, vezi harta-vie.js). Sunt deci greu de refăcut: un bump de versiune
//    care le arunca ar fi lăsat pilotul cu hartă goală fix pe unde a mai trecut o dată.
// Reutilizarea e chiar ce cere politica lor (minim 7 zile de cache).
const DALE = 'rali2-dale';
const DALE_MAX = 2000;                    // ~2000 de dale văzute în mers, apoi cea mai veche iese
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
  // dale opace ar mânca tot spațiul aplicației.
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'origin' });
  } catch (e) { res = null; }
  // Un răspuns cu status ne-ok (429 „prea multe cereri", 403, 404) se ÎNTOARCE, dar nu se
  // stochează niciodată: altfel un refuz de o secundă s-ar lipi de dala aia pentru
  // totdeauna, fiindcă politica de aici e cache-first.
  if (res && !res.ok) return res;
  if (!res) {
    try { res = await fetch(req); } catch (e) { return Response.error(); }
  }
  // CE INTRĂ ÎN CACHE, și de ce atât de strict (audit, 05.08.2026, punctul 4a — singurul
  // care putea strica harta PERMANENT): pe o rețea cu portal captiv (hotel, benzinărie),
  // cererea de dală e interceptată și primești pagina de login. Ca răspuns no-cors ea e
  // opacă, deci arată exact ca o dală bună — iar cache-first ar servi-o apoi la infinit,
  // inclusiv pe munte, unde n-ai cum s-o mai înlocuiești. Trei condiții, toate obligatorii:
  // răspuns bun, venit prin CORS (deci chiar de la serverul de dale, nu de la un
  // interceptor), și cu tip de conținut de imagine.
  const tip = res.headers ? (res.headers.get('content-type') || '') : '';
  if (res.ok && res.type === 'cors' && /^image\//i.test(tip)) {
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
