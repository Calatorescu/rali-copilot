// RALI 2 · repere.js — de la comentariul din roadbook la un punct pe hartă.
//
// DE CE. Harta traseului (coordonatele boxurilor) rezolvă tot ce ține de „unde sunt față
// de traseu", dar la Sibiu roadbook-ul vine gata tipărit de la organizator: nimeni nu ne
// dă un fișier cu coordonate. Singurul lucru pe care îl avem acolo e ce scrie în coloana
// de comentarii — „Dreapta pe Str. Avram Imbroane", „Stânga pe Calea Ghirodei". Adică
// exact adrese, scrise de om pentru om.
//
// Modulul ăsta le scoate din text (fără rețea, pur, testabil pe roadbook-urile reale) și
// le pregătește pentru geocodare. Geocodarea propriu-zisă se face O SINGURĂ DATĂ, acasă
// sau la hotel, la apăsarea unui buton — niciodată în mers.

import { haversineM } from './geo.js';

// Tipurile de arteră care apar în roadbook-urile românești, cu abrevierile lor.
// Ordinea contează: „Calea" înaintea lui „Cal.", „Strada" înaintea lui „Str.".
const ARTERE = [
  'Strada', 'Str\\.', 'Bulevardul', 'Bd\\.', 'B-dul', 'Calea', 'Aleea', 'Splaiul',
  'Șoseaua', 'Soseaua', 'Sos\\.', 'Piața', 'Piata', 'Intrarea', 'Drumul'
];
// Drumurile numerotate: DJ691, DN6, DC145, A1, E70 — se geocodează prost singure, dar
// bine cu localitatea alături, și oricum sunt a doua alegere după numele de stradă.
const DRUMURI = /\b(D[JNC]\s?\d{1,3}[A-Z]?|A\d{1,2}|E\d{2,3})\b/;

// Litere din alfabetul românesc ȘI din cel maghiar — Petőfi Sándor, Franyó Zoltán și
// József Attila sunt nume de străzi reale din roadbook-urile conduse până acum.
const MAJ = 'A-ZĂÂÎȘȚĂÂÎŞŢÁÉÍÓÖŐÚÜŰ';
const MIC = 'a-zăâîșțăâîşţáéíóöőúüű';

// Cuvinte care încep cu majusculă dar NU sunt nume de stradă — apar des în roadbook,
// iar geocodate ar trimite mașina în altă parte a țării.
const NU_E_LOC = new Set(['ATENȚIE', 'ATENTIE', 'IMEDIAT', 'START', 'FINISH', 'STÂNGA',
  'DREAPTA', 'ÎNAINTE', 'INAINTE', 'STOP', 'CFR', 'SUD', 'NORD', 'EST', 'VEST', 'RT',
  'TC', 'CP', 'EXACT', 'DEJA', 'SIMULARE', 'CEDEAZĂ', 'CEDEAZA', 'ACELAȘI', 'ACELASI',
  'PE', 'ÎN', 'IN', 'DIN',
  // cuvinte de roadbook care arată ca nume proprii după „pe/spre/devine", dar nu sunt:
  // „pe proba", „spre tabela", „pe traseul de la venire"
  'PROBA', 'PROBĂ', 'TABELA', 'TABELĂ', 'TRASEUL', 'TRASEU', 'DRUMUL', 'LINIA', 'PARCARE',
  'PARCAREA', 'STRADA', 'STRĂZII', 'STRAZII', 'CAPĂTUL', 'CAPATUL', 'GIRATORIU', 'DREPTUL']);

// „Str. Avram Imbroane", „Calea Ghirodei", „Aleea Pădurea Verde", „Str. Exemplu 7"
const reArtera = new RegExp(
  `(?:${ARTERE.join('|')})\\s+[${MAJ}][${MIC}${MAJ}'’\\-]*(?:\\s+[${MAJ}][${MIC}${MAJ}'’\\-]*){0,3}(?:\\s+\\d{1,4})?`,
  'u');

// Ce urmează după „pe" / „spre" / „devine" e strada pe care INTRI — cea mai bună
// referință pentru box. „Dreapta pe Str. Turda · retur pe traseul de la venire" → Turda.
const reDupaPrepozitie = new RegExp(
  `(?:\\bpe\\b|\\bspre\\b|\\bdevine\\b)\\s+((?:${ARTERE.join('|')})\\s+[${MAJ}][${MIC}${MAJ}'’\\-]*(?:\\s+[${MAJ}][${MIC}${MAJ}'’\\-]*){0,3}(?:\\s+\\d{1,4})?)`,
  'u');

// Nume proprii fără cuvânt de arteră: „Inelul IV", „Kaufland", „Principala".
const rePOI = new RegExp(`\\b(?:giratoriu|sens giratoriu|parcarea|hotel|hotelul)\\s+([${MAJ}][${MIC}${MAJ}\\-]{2,})`, 'iu');
const reInel = /\bInelul\s+[IVX]+\b/u;
// genitivul: „capătul străzii Exemplu" → strada Exemplu
const reGenitiv = new RegExp(`\\bstr[ăa]zii\\s+([${MAJ}][${MIC}${MAJ}'’\\-]{3,})`, 'u');
// numele gol de după prepoziție: „pe Principala", „pe Bălcescu", „devine Averescu" —
// roadbook-ul scrie strada fără cuvântul „Str." de destule ori ca să conteze
const reNumeGol = new RegExp(`(?:\\bpe\\b|\\bspre\\b|\\bdevine\\b)\\s+([${MAJ}][${MIC}${MAJ}'’\\-]{3,}(?:\\s+[${MAJ}][${MIC}${MAJ}'’\\-]{2,}){0,2})`, 'u');

function curata(s) {
  return String(s || '')
    .replace(/[·•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // coada de propoziție lipită de nume: „Ghirodei," / „Imbroane." / „Turda;"
    .replace(/[,.;:!]+$/, '')
    .trim();
}

// LOCALITATEA leg-ului. Roadbook-ul o scrie o dată, de obicei în boxul de start
// („Str. Exemplu 7, Dumbrăvița"), iar restul boxurilor o subînțeleg. Fără ea,
// „Str. Turda" există în zeci de orașe și geocodarea nimerește altundeva.
// Localitatea se ia DOAR din forma de adresă („Str. Exemplu 7, Dumbrăvița"), nu din
// orice pomenire a unui oraș. Prima versiune căuta orice nume cunoscut oriunde în text și
// a pus „Sibiu" pe tot roadbook-ul de Timișoara, dintr-o singură notă de regulament:
// „SIMULARE — trecere CFR cu STOP … La Sibiu: STOP obligatoriu la tabelă". Toate cele 19
// repere ar fi plecat la geocodare cu orașul greșit — și geocodarea ar fi răspuns ceva,
// fiindcă „Str. Turda" există și acolo. Când roadbook-ul n-o spune în forma asta,
// localitatea se cere OMULUI, în panoul de pregătire.
const reAdresaLocalitate = new RegExp(
  `(?:${ARTERE.join('|')}|Inelul)\\s+[${MAJ}][^,;·|]{1,40},\\s*([${MAJ}][${MIC}]{3,}(?:[ \\-][${MAJ}][${MIC}]{2,})?)`, 'u');

export function localitateBoxuri(boxes = []) {
  const nr = new Map();
  for (const b of boxes) {
    const m = reAdresaLocalitate.exec(curata(b && b.comment));
    if (m) { const k = curata(m[1]); nr.set(k, (nr.get(k) || 0) + 1); }
  }
  let best = null;
  for (const [k, v] of nr) if (!best || v > best.n) best = { nume: k, n: v };
  return best ? best.nume : null;
}

// REPERUL unui box: șirul care se trimite la geocodare, sau null dacă boxul n-are nimic
// geocodabil („FINISH RT 2 · tabela roșie · nu opri între tabele" — nicio adresă acolo).
export function extrageReper(comment, { localitate = null } = {}) {
  const c = curata(comment);
  if (!c) return null;
  let nume = null;

  const dp = reDupaPrepozitie.exec(c);
  if (dp) nume = curata(dp[1]);
  if (!nume) { const a = reArtera.exec(c); if (a) nume = curata(a[0]); }
  if (!nume) { const i = reInel.exec(c); if (i) nume = curata(i[0]); }
  if (!nume) { const g = reGenitiv.exec(c); if (g) nume = 'Strada ' + curata(g[1]); }
  if (!nume) { const p = rePOI.exec(c); if (p) nume = curata(p[1]); }
  if (!nume) {
    const ng = reNumeGol.exec(c);
    // numele gol e ultima încercare, deci și cea mai expusă: se cere să nu fie niciunul
    // dintre cuvintele-capcană, nici primul, nici ultimul („pe DREAPTA", „spre SUD")
    if (ng) {
      const cuv = curata(ng[1]).split(' ');
      if (!cuv.some(x => NU_E_LOC.has(x.toUpperCase()))) nume = cuv.join(' ');
    }
  }
  if (!nume) { const d = DRUMURI.exec(c); if (d) nume = curata(d[1]).replace(/\s+/, ''); }

  if (!nume) return null;
  // ultimul cuvânt din nume nu are voie să fie unul din cuvintele-capcană
  const ultim = nume.split(' ').pop().toUpperCase();
  if (NU_E_LOC.has(ultim)) return null;
  if (nume.length < 4) return null;

  return localitate ? `${nume}, ${localitate}` : nume;
}

// Reperele întregului leg, cu localitatea dedusă o dată pentru tot roadbook-ul.
export function repereBoxuri(boxes = []) {
  const localitate = localitateBoxuri(boxes);
  return {
    localitate,
    repere: boxes.map(b => ({
      num: b.num,
      sumKm: b.sumKm,
      // Scanarea poate da reperul direct (vezi promptul din scan.js); dacă nu l-a dat,
      // se scoate din comentariu. Roadbook-urile deja scanate merg pe a doua cale.
      reper: (typeof b.reper === 'string' && b.reper.trim())
        ? (!localitate || b.reper.includes(localitate)
            ? curata(b.reper) : `${curata(b.reper)}, ${localitate}`)
        : extrageReper(b.comment, { localitate })
    }))
  };
}

// ── ANCORELE: reper geocodat + kilometrul lui de roadbook ───────────────────
// O geocodare greșită e mai periculoasă decât una lipsă: „Str. Turda" există și în
// Cluj, iar o ancoră căzută acolo strică toată harta. Verificarea e cea din roadbook:
// distanța în linie dreaptă dintre două ancore nu poate fi mult mai mare decât drumul
// dintre boxurile lor. Peste 2× drumul (+300 m pentru drumuri scurte și zgomot),
// ancora e de pe alt traseu și se aruncă.
export function verificaAncore(ancore = []) {
  const lista = [...ancore].filter(a => a && Number.isFinite(a.lat) && Number.isFinite(a.lng))
                           .sort((a, b) => a.sumKm - b.sumKm);
  if (lista.length < 2) return { bune: lista, aruncate: [] };

  // Se merge din ambele capete și se păstrează lanțul mai lung: dacă tocmai PRIMA
  // ancoră e cea greșită, un singur drum ar arunca tot restul.
  const lant = (dinDreapta) => {
    const ord = dinDreapta ? [...lista].reverse() : lista;
    const pastrate = [ord[0]], scoase = [];
    for (let i = 1; i < ord.length; i++) {
      const a = pastrate[pastrate.length - 1], b = ord[i];
      const drumM = Math.abs(b.sumKm - a.sumKm) * 1000;
      const dreaptaM = haversineM(a.lat, a.lng, b.lat, b.lng);
      if (dreaptaM > drumM * 2 + 300) scoase.push({ ...b, motiv: `la ${Math.round(dreaptaM)} m de boxul ${a.num}, dar roadbook-ul are ${Math.round(drumM)} m` });
      else pastrate.push(b);
    }
    return { pastrate, scoase };
  };
  const a = lant(false), b = lant(true);
  const c = a.pastrate.length >= b.pastrate.length ? a : b;
  return { bune: [...c.pastrate].sort((x, y) => x.sumKm - y.sumKm), aruncate: c.scoase };
}

// ── GEOCODAREA (Nominatim / OpenStreetMap) ──────────────────────────────────
// FLUX DE DATE NOU, de citit la audit: la apăsarea butonului „Găsește traseul pe hartă"
// pleacă spre nominatim.openstreetmap.org DOAR șirurile de reper („Str. Turda,
// Timișoara"), unul câte unul. Nu pleacă poziția mașinii, nici jurnalul, nici
// kilometrajul. Se apasă acasă/la hotel, nu în cursă.
//
// POLITICA NOMINATIM: maximum o cerere pe secundă și un client identificabil. Ce putem
// și ce NU putem face, exact:
//  • pauza de o secundă o respectăm noi, serializând cererile — asta ține de noi;
//  • User-Agent nu se poate seta dintr-un browser (e antet interzis de fetch);
//  • Referer NU pleacă nici el: pagina are `<meta name="referrer" content="no-referrer">`,
//    pus dinadins ca aplicația să nu-și spună originea nimănui. Deci, cinstit: cererile
//    noastre ajung la ei ANONIME, iar politica lor cere un client identificabil.
//    Consecința e că ne pot limita oricând, fără preaviz, și trebuie s-o suportăm frumos
//    — de-aia există plafonul de mai jos și cache-ul, iar butonul se apasă o dată,
//    acasă. Dacă ajungem să depindem de geocodare, soluția corectă e o instanță proprie
//    (sau un serviciu cu cheie), nu abuzul de serviciul public al altcuiva.
export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Plafon per rulare a butonului: un roadbook mare n-are voie să se transforme într-o
// rafală de sute de cereri către un serviciu gratuit.
export const MAX_CERERI = 60;

export function faGeocoder({ fetchFn, pauzaMs = 1100, timeoutMs = 8000, baza = NOMINATIM,
                             maxCereri = MAX_CERERI } = {}) {
  const f = fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  let ultimaCerere = 0, nCereri = 0;
  // Același reper apare des de două-trei ori într-un roadbook (dus-întors pe aceeași
  // stradă, giratoriul luat de două ori). Se întreabă o singură dată.
  const cache = new Map();
  const asteapta = ms => new Promise(r => setTimeout(r, ms));
  return {
    cereriFacute: () => nCereri,
    async cauta(text) {
      if (!f) throw new Error('fără rețea');
      const q = String(text || '').trim().slice(0, 120);
      if (!q) return null;
      if (cache.has(q)) return cache.get(q);
      if (nCereri >= maxCereri) throw new Error(`plafon atins (${maxCereri} căutări)`);
      const de = Date.now() - ultimaCerere;
      if (de < pauzaMs) await asteapta(pauzaMs - de);
      ultimaCerere = Date.now();
      nCereri++;
      const url = `${baza}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=0`;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      try {
        const r = await f(url, ctrl ? { signal: ctrl.signal } : undefined);
        if (!r || !r.ok) throw new Error(`serverul a răspuns ${r ? r.status : '—'}`);
        const j = await r.json();
        if (!Array.isArray(j) || !j.length) { cache.set(q, null); return null; }
        // Răspunsul e conținut extern: se ia doar ce e număr și în plaja Pământului.
        const lat = parseFloat(j[0] && j[0].lat), lng = parseFloat(j[0] && j[0].lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) { cache.set(q, null); return null; }
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { cache.set(q, null); return null; }
        const p = { lat, lng };
        cache.set(q, p);
        return p;
      } finally { if (t) clearTimeout(t); }
    }
  };
}

// Geocodează reperele unui leg, în ordine, cu pauza cerută de serviciu. `onPas` e
// chemat după fiecare reper ca panoul să arate progresul — la 20 de boxuri durează
// ~20 de secunde și pilotul trebuie să vadă că se mișcă.
export async function geocodeazaRepere(repere, geocoder, { onPas = null } = {}) {
  const ancore = [], ratate = [];
  let i = 0;
  for (const r of repere) {
    i++;
    if (!r.reper) { ratate.push({ num: r.num, motiv: 'fără reper geocodabil' }); if (onPas) onPas(i, repere.length, r); continue; }
    try {
      const p = await geocoder.cauta(r.reper);
      if (p) ancore.push({ num: r.num, sumKm: r.sumKm, reper: r.reper, lat: p.lat, lng: p.lng });
      else ratate.push({ num: r.num, motiv: 'negăsit pe hartă', reper: r.reper });
    } catch (e) {
      ratate.push({ num: r.num, motiv: String(e && e.message || e).slice(0, 60), reper: r.reper });
    }
    if (onPas) onPas(i, repere.length, r);
  }
  return { ancore, ratate };
}
