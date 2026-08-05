// RALI 2 · harta-vie.js — geometria hărții: proiecție, alegerea dalelor, zoom, linia
// traseului. LOGICĂ PURĂ: fără DOM, fără rețea, fără stare globală — tot ce se poate
// greși aici se vede într-un test, nu pe telefon, pe Transfăgărășan.
//
// DE CE EXISTĂ ECRANUL ĂSTA. Andreas, 05.08.2026: „am o problemă destul de mare de
// orientare în spațiu, așa că am nevoie de ghidare prin navigație și să fie cel puțin la
// nivel de Google Maps". Până acum aplicația avea săgeată relativă, distanțe și voce —
// adică descria spațiul în cuvinte. Pentru cineva care se orientează greu, o săgeată
// fără hartă nu răspunde la întrebarea „unde sunt EU față de traseu". Harta răspunde.
//
// Ce NU face modulul ăsta: nu rutează, nu caută adrese, nu vorbește. Desenează unde
// ești, pe ce drum ești și unde sunt boxurile.

import { TURN_DIRS } from './route.js';

export const DALA_PX = 256;

// Sursa de dale. OpenStreetMap, fără cheie și fără cont — singurul furnizor care poate
// intra într-o aplicație care NU are voie să ceară credențiale (vezi CSP din index.html).
// Se cer NUMAI dalele de sub ochi, în mers, una câte una; descărcarea în masă e interzisă
// de politica lor și a fost scoasă din aplicație (vezi comentariul lung de mai jos).
export const OSM_SABLON = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ORIGINE = 'https://tile.openstreetmap.org';

export function urlDala(x, y, z, sablon = OSM_SABLON) {
  return sablon.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// ── Proiecția Web Mercator, în „pixeli de lume" ─────────────────────────────
// La zoom z lumea are 256·2^z pixeli pe fiecare latură. Toată desenarea lucrează în
// coordonatele astea: dalele cad pe multipli de 256, iar linia traseului și markerele
// se pun în același sistem, deci nu există două geometrii care să se bată cap în cap.
export function lumePx(lat, lng, z) {
  const n = DALA_PX * Math.pow(2, z);
  const la = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin(la * Math.PI / 180);
  return {
    x: n * (lng + 180) / 360,
    y: n * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI))
  };
}

export function lumeLatLng(x, y, z) {
  const n = DALA_PX * Math.pow(2, z);
  const lng = x / n * 360 - 180;
  const k = Math.PI - 2 * Math.PI * y / n;
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k)));
  return { lat, lng };
}

// Câți metri „acoperă" un pixel la latitudinea și zoom-ul date. Cu ea se traduc razele
// și distanțele reale (400 m de coridor) în pixeli de lume, fără aproximări la ochi.
export function metriPePixel(lat, z) {
  return 156543.03392804097 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
}

// ── Dalele vizibile pe ecran ────────────────────────────────────────────────
// Cu harta ROTITĂ după direcția de mers, dreptunghiul ecranului acoperă în lume un
// dreptunghi întors — cel mai simplu mod corect de a nu rămâne cu colțuri goale e să
// ceri dalele din cercul circumscris (diagonala). Costă câteva dale în plus și scutește
// o clasă întreagă de erori de trigonometrie.
//
// Dalele se întorc SORTATE de la centru spre margini: ce e sub mașină se încarcă primul.
export function daleVizibile({ lat, lng, z, latimePx, inaltimePx,
                               rotit = false, marjaPx = 0 } = {}) {
  const centru = lumePx(lat, lng, z);
  const raza = rotit ? Math.hypot(latimePx, inaltimePx) / 2 : null;
  const dx = (raza != null ? raza : latimePx / 2) + marjaPx;
  const dy = (raza != null ? raza : inaltimePx / 2) + marjaPx;
  const n = Math.pow(2, z);
  const x0 = Math.floor((centru.x - dx) / DALA_PX), x1 = Math.floor((centru.x + dx) / DALA_PX);
  const y0 = Math.floor((centru.y - dy) / DALA_PX), y1 = Math.floor((centru.y + dy) / DALA_PX);
  const dale = [];
  for (let y = y0; y <= y1; y++) {
    if (y < 0 || y >= n) continue;                 // deasupra polului nu există dale
    for (let x = x0; x <= x1; x++) {
      const xw = ((x % n) + n) % n;                // lumea se închide pe longitudine
      dale.push({ x: xw, y, z,
        _d: Math.hypot((x + 0.5) * DALA_PX - centru.x, (y + 0.5) * DALA_PX - centru.y) });
    }
  }
  dale.sort((a, b) => a._d - b._d);
  return { centru, dale: dale.map(d => ({ x: d.x, y: d.y, z: d.z })) };
}

// DALA-PĂRINTE, pentru când cea cerută lipsește din cache (offline la munte, sau un
// zoom pe care nu l-am descărcat). Un sfert din dala de la z−1, întins la loc, arată
// neclar dar CORECT — mult mai bine decât un pătrat negru. Descărcarea aduce z14-15,
// deci z16 și z17 se pot desena din ele fără nicio cerere de rețea.
export function parinteDala(x, y, z, niveluri = 1) {
  if (niveluri < 1 || z - niveluri < 0) return null;
  const f = Math.pow(2, niveluri);
  const px = Math.floor(x / f), py = Math.floor(y / f);
  const marime = DALA_PX / f;
  return { x: px, y: py, z: z - niveluri,
           sx: (x - px * f) * marime, sy: (y - py * f) * marime, marime };
}

// ── ZOOM-UL AUTOMAT ─────────────────────────────────────────────────────────
// Cerința: „mai depărtat la 80 km/h, mai apropiat la manevre". Benzile sunt alese pe
// cât drum trebuie să vezi ÎN FAȚĂ ca să ai timp de reacție — la 85 km/h faci 24 m pe
// secundă, deci un ecran care arată 700 m e o jumătate de minut de drum.
//   z17 ≈ 0,8 m/px · z16 ≈ 1,7 · z15 ≈ 3,3 · z14 ≈ 6,7 · z13 ≈ 13,4  (la latitudinea 45°)
// HISTEREZIS de 6 km/h: fără el, la 29-31 km/h harta ar sări între două zoom-uri de
// câteva ori pe minut — exact genul de mișcare care strică orientarea, adică fix ce
// trebuie să repare ecranul ăsta.
const BENZI = [
  { z: 17, panaLa: 10 }, { z: 16, panaLa: 30 }, { z: 15, panaLa: 55 },
  { z: 14, panaLa: 85 }, { z: 13, panaLa: Infinity }
];
const MARJA_KMH = 6;

export function zoomAuto({ kmh = 0, distManevraM = null, zAnterior = null,
                           min = 13, max = 17 } = {}) {
  const v = Math.max(0, kmh || 0);
  let z = BENZI.find(b => v < b.panaLa).z;
  if (zAnterior != null) {
    const i = BENZI.findIndex(b => b.z === zAnterior);
    if (i >= 0) {
      const jos = (i === 0 ? 0 : BENZI[i - 1].panaLa) - MARJA_KMH;
      const sus = BENZI[i].panaLa + MARJA_KMH;
      if (v >= jos && v < sus) z = zAnterior;
    }
  }
  // manevra bate viteza: când virajul e la sub 200 m, vrei să vezi intersecția, nu județul
  if (distManevraM != null && distManevraM >= 0 && distManevraM < 200) z = Math.max(z, 16);
  return Math.max(min, Math.min(max, z));
}

// ── Din lume pe ecran ───────────────────────────────────────────────────────
// Mașina stă într-un punct fix al ecranului (implicit la 62% din înălțime, ca să se vadă
// mai mult drum în față decât în spate). Cu harta rotită, lumea se învârte în jurul ei.
// Funcția e pură ca să poată fi verificată: eticheta unui box pusă cu 30 de pixeli greșit
// arată exact ca o coordonată greșită, dar se repară cu totul altceva.
export function ecranDinLume(wx, wy, { cx, cy, latimePx, inaltimePx,
                                       ancoraY = null, rotRad = 0 } = {}) {
  let dx = wx - cx, dy = wy - cy;
  if (rotRad) {
    const c = Math.cos(rotRad), s = Math.sin(rotRad);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
  }
  return { x: latimePx / 2 + dx,
           y: (ancoraY != null ? ancoraY : inaltimePx / 2) + dy };
}

// ── LINIA TRASEULUI ─────────────────────────────────────────────────────────
// Două surse, cu precizii complet diferite — iar diferența se SPUNE pe ecran, nu se
// ascunde sub aceeași linie:
//  • RECUNOAȘTEREA — drumul condus efectiv, punct la 6 m. Precis. Linie plină.
//  • ANCORELE GEOCODATE — centrele de stradă găsite după comentariile din roadbook.
//    Între două ancore nu știm drumul: linia dreaptă dintre ele NU e traseul, e doar
//    ordinea boxurilor. De-aia se desenează PUNCTAT și scrie pe ecran de unde vine.
// ── MEMOIZAREA, pe identitatea planului ─────────────────────────────────────
// Amândouă funcțiile de mai jos (linia traseului și pozițiile boxurilor) sunt PURE și
// depind numai de `plan`. Harta le chema la fiecare cadru — de cinci ori pe secundă,
// cu O(boxuri × puncte de urmă) de fiecare dată, plus un vector nou de zeci de mii de
// obiecte aruncat imediat. Pe o zi de 265 km asta e presiune de colectare a gunoiului
// pe FIRUL PE CARE RULEAZĂ ȘI CRONOMETRUL, plus baterie arsă degeaba. (Audit, punctul 6a.)
//
// Cheia e obiectul `plan` însuși: `rebuildPlan` construiește unul NOU ori de câte ori se
// schimbă ceva (roadbook, leg, recunoaștere, hartă), deci identitatea lui e exact
// semnalul de „recalculează". WeakMap, ca planurile vechi să nu fie ținute în viață.
const memoTraseu = new WeakMap(), memoPozitii = new WeakMap();

export function traseuDinPlan(plan) {
  if (plan && memoTraseu.has(plan)) return memoTraseu.get(plan);
  const r = calcTraseu(plan);
  if (plan) memoTraseu.set(plan, r);
  return r;
}

function calcTraseu(plan) {
  const t = plan && plan.trace;
  if (t && Array.isArray(t.pts) && t.pts.length >= 2)
    return { pts: t.pts.map(p => ({ lat: p.lat, lng: p.lng })),
             sursa: 'recon', aproximativ: false };
  const h = plan && plan.harta;
  if (h) {
    const pts = (plan.boxes || [])
      .filter(b => b.num != null && h[b.num])
      .sort((a, b) => a.sumKm - b.sumKm)
      .map(b => ({ lat: h[b.num].lat, lng: h[b.num].lng, num: b.num }));
    if (pts.length >= 2) return { pts, sursa: 'ancore', aproximativ: true };
  }
  return { pts: [], sursa: null, aproximativ: false };
}

// Ce fel de box e — pentru simbolul de pe hartă. TC-urile și liniile de probă au simbol
// distinct fiindcă sunt singurele puncte unde se OPREȘTE sau se schimbă regimul cursei.
export function tipBox(b) {
  if (!b) return 'reper';
  switch (b.flag) {
    case 'TC': return 'tc';
    case 'RT_START_AUTO': case 'RT_START_STANDING': return 'start';
    case 'RT_FINISH': return 'finish';
    case 'PARKING': return 'parcare';
    case 'EV': return 'incarcare';
  }
  return TURN_DIRS.has(b.dir || '') ? 'viraj' : 'reper';
}

// punctul de pe urma de recunoaștere aflat la `cumM` metri de la începutul ei
function pePunctulUrmei(trace, cumM) {
  const pts = trace && trace.pts;
  if (!pts || !pts.length || cumM == null || !isFinite(cumM)) return null;
  // în afara urmei nu se extrapolează: altfel toate boxurile de după capătul urmei
  // s-ar îngrămădi pe ultimul punct, arătând ca niște coordonate reale
  if (cumM < pts[0].cum - 50 || cumM > pts[pts.length - 1].cum + 50) return null;
  if (cumM <= pts[0].cum) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].cum >= cumM) {
      const a = pts[i - 1], b = pts[i];
      const f = b.cum > a.cum ? (cumM - a.cum) / (b.cum - a.cum) : 0;
      return { lat: a.lat + f * (b.lat - a.lat), lng: a.lng + f * (b.lng - a.lng) };
    }
  }
  return pts[pts.length - 1];
}

// UNDE E FIECARE BOX, pentru markere. Aceeași ordine de încredere ca în mașina de stări
// (recon > hartă), fără firimituri: firimiturile spun unde am fost NOI, nu unde e boxul,
// iar pe hartă un punct greșit e mai rău decât un punct lipsă.
export function pozitiiBoxuri(plan) {
  if (plan && memoPozitii.has(plan)) return memoPozitii.get(plan);
  const r = calcPozitiiBoxuri(plan);
  if (plan) memoPozitii.set(plan, r);
  return r;
}

function calcPozitiiBoxuri(plan) {
  const out = [];
  for (const b of (plan && plan.boxes) || []) {
    let p = null, sursa = null;
    if (plan.trace && plan.anchorMap) {
      const q = pePunctulUrmei(plan.trace, plan.anchorMap.traceM(b.sumKm));
      if (q) { p = q; sursa = 'recon'; }
    }
    if (!p && plan.harta && b.num != null && plan.harta[b.num]) {
      p = plan.harta[b.num]; sursa = 'harta';
    }
    if (!p) continue;
    out.push({ num: b.num, lat: p.lat, lng: p.lng, sumKm: b.sumKm,
               tip: tipBox(b), dir: b.dir || null, sursa });
  }
  return out;
}

// ── DESCĂRCAREA ÎN MASĂ: NU EXISTĂ, ȘI NU E O SCĂPARE ──────────────────────
// Aici a existat, până la auditul de dinaintea publicării, un „descarcă harta traseului"
// care aducea coridorul rutei pentru offline. A fost SCOS, nu limitat, fiindcă politica
// de folosire a dalelor OSM (operations.osmfoundation.org/policies/tiles/) o interzice
// pe nume: „Bulk downloading ('scraping') … is prohibited", „Offline use is not permitted
// on tile.openstreetmap.org", iar funcțiile de tip „download area for offline use" sunt
// date direct ca exemplu de folosire interzisă. Sancțiunea e blocare pe IP, fără
// avertisment — adică exact să rămânem fără hartă ÎN cursă, ziua în care contează.
// Nicio limită (rază, plafon, ritm) nu transformă o descărcare de coridor în altceva
// decât ce spune politica că e.
//
// CE E PERMIS și rămâne: dalele se cer în mers, una câte una, ca orice hartă din browser,
// iar cele deja văzute se păstrează în cache și se refolosesc (politica cere minim 7 zile
// de reutilizare, deci asta e chiar comportamentul dorit). Pe drum fără semnal, harta
// trece singură pe varianta schematică: traseul, boxurile și poziția, pe fundal gol.
// Nu se pune alt furnizor de dale în loc — decizia lui Andreas, 05.08.2026: ghidajul pe
// străzi rămâne la Google Maps.

// ── CACHE-UL DE DALE: cine iese când se umple ───────────────────────────────
// Cache API nu ține metadate, dar păstrează ORDINEA de inserare. Service worker-ul
// reînscrie o dală la prima folosire dintr-o sesiune (o mută la coadă), deci cea mai
// veche NEATINSĂ iese prima — LRU aproximativ. Dacă un browser n-ar respecta ordinea,
// degradează în FIFO: tot corect, doar mai puțin eficient. Funcția e aici ca să existe
// UN singur loc care decide câte ies, verificabil de test.
export const DALE_LIMITA = 2000;

export function deEvacuat(nrIntrari, limita = DALE_LIMITA) {
  return Math.max(0, (nrIntrari | 0) - limita);
}
