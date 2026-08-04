// RALI 2 · route.js — modelul traseului: boxuri + geometrie + planul probelor.
//
// Un traseu are două straturi care se leagă între ele:
//  • BOXURILE din roadbook (km oficial, direcție, flag) — autoritatea de conținut;
//  • URMA din recunoaștere (geometrie GPS + mostre de viteză) — autoritatea de poziție.
// Legarea: la recunoaștere, șoferul marchează boxuri din mers („sunt la box 12") —
// fiecare marcaj devine o ancoră (kmOficial ↔ metriPeUrmă). Între ancore, maparea e
// liniară. Cu 3-4 ancore pe leg, kilometrul oficial se citește direct din poziție.

import { slowZones } from './pace.js';
import { buildTrace, haversineM } from './geo.js';

export const TURN_DIRS = new Set(['STÂNGA', 'DREAPTA', 'STÂNGA-T', 'DREAPTA-T',
  'GIRATORIU-1', 'GIRATORIU-2', 'GIRATORIU-3', 'GIRATORIU-4']);

export function legKey(b) {
  const d = typeof b.day === 'number' ? b.day : '?';
  const l = typeof b.leg === 'number' ? b.leg : '?';
  return `${d}|${l}`;
}

export function legLabel(key) {
  const [d, l] = String(key).split('|');
  if (d === '?' && l === '?') return 'fără antet';
  return (d !== '?' ? `Ziua ${d} · ` : '') + (l !== '?' ? `Leg ${l}` : 'leg necunoscut');
}

// Gruparea pe leg-uri — lecția plătită de v1 și pierdută la rescrierea v2 (audit, #1):
// numerotarea boxurilor ȘI kilometrajul REPORNESC la fiecare leg (măsurat pe Reșița:
// Leg 2 are boxurile 28-36 la 7-8 km, Leg 3 are 28-30 la 35-36 km). Sortate global pe
// sumKm, două leg-uri ies împletite: probele se împerechează între leg-uri, totalKm e
// al altui leg, iar aplicația conduce pe un traseu care nu există. Planul se face pe
// UN SINGUR leg; grupurile de aici alimentează selectorul și trecerea la leg-ul următor.
export function groupByLeg(boxes) {
  const map = new Map();
  for (const b of (Array.isArray(boxes) ? boxes : [])) {
    const k = legKey(b);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(b);
  }
  // „?" înseamnă ANTET NECITIT pe pagina aia, nu alt leg (02.08, seara: o pagină
  // scanată fără „Day 1" a rupt leg-ul în două — planul activ a rămas fără primele
  // 4 boxuri, deși toate 12 fuseseră citite corect). Un grup cu componente „?" se
  // lipește de grupul complet care se potrivește pe ce SE cunoaște — dar NUMAI dacă
  // potrivirea e unică; la ambiguitate (două zile cu același leg), rămâne separat.
  const complete = [...map.keys()].filter(k => !k.includes('?'));
  for (const k of [...map.keys()]) {
    if (!k.includes('?') || !map.has(k)) continue;
    const [d, l] = k.split('|');
    const candidati = complete.filter(c => {
      const [cd, cl] = c.split('|');
      return (d === '?' || cd === d) && (l === '?' || cl === l);
    });
    if (candidati.length === 1) {
      map.get(candidati[0]).push(...map.get(k));
      map.delete(k);
    }
  }
  const rank = k => { const [d, l] = String(k).split('|');
    return [d === '?' ? 1e6 : +d, l === '?' ? 1e6 : +l]; };
  return [...map.entries()]
    .sort((a, z) => { const ra = rank(a[0]), rz = rank(z[0]); return ra[0] - rz[0] || ra[1] - rz[1]; })
    .map(([key, list]) => ({
      key, label: legLabel(key),
      boxes: [...list].sort((a, b) => a.sumKm - b.sumKm)
    }));
}

// Sanitizarea ieșirii din scanare — granița de încredere (răspunsul AI = conținut
// extern derivat dintr-o poză a unui document tipărit de altcineva).
const DIR_OK = new Set([...TURN_DIRS, 'ÎNAINTE', 'STOP-CFR']);
const FLAG_OK = new Set(['TC', 'RT_START_AUTO', 'RT_START_STANDING', 'RT_FINISH', 'PARKING', 'EV']);

export function sanitizeBoxes(raw) {
  const num = v => {
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
    return typeof n === 'number' && isFinite(n) ? n : null;
  };
  const out = (Array.isArray(raw) ? raw : []).map(b => ({
    day: num(b.day), leg: num(b.leg), page: num(b.page), num: num(b.num),
    sumKm: num(b.sumKm), sectionKm: num(b.sectionKm),
    dir: DIR_OK.has(b.dir) ? b.dir : null,
    flag: FLAG_OK.has(b.flag) ? b.flag : null,
    comment: typeof b.comment === 'string' ? b.comment.slice(0, 120) : '',
    // Reperul geocodabil, cerut explicit la scanare (vezi ROADBOOK_PROMPT). E tot text
    // din același răspuns extern, deci trece prin aceeași sită: șir scurt, fără
    // caractere de control. Când lipsește, se deduce din comentariu (repere.js).
    reper: typeof b.reper === 'string' && b.reper.trim()
      ? b.reper.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : null
  })).filter(b => b.sumKm !== null);
  out.sort((a, b) => a.sumKm - b.sumKm);
  return out;
}

// ── Verificatorul de roadbook (propunerea 1 din audit, 02.08.2026) ──────────
// Erorile scanării se prind PARCAT, nu la 40 km/h: primul test de teren a eșuat
// din distanțe greșite pe care nimeni nu le-a verificat înainte de plecare.
// Primește TOATE boxurile scanate; verifică fiecare leg separat.
export function verifyRoadbook(allBoxes) {
  const probleme = [];
  const grupuri = groupByLeg(allBoxes);
  for (const g of grupuri) {
    const b = g.boxes, unde = g.label;
    // km-ul trebuie să crească strict — dubluri sau regresii = boxuri citite greșit
    for (let i = 1; i < b.length; i++) {
      const sec = b[i].sumKm - b[i - 1].sumKm;
      if (sec <= 0)
        probleme.push(`${unde}: boxurile ${b[i - 1].num} și ${b[i].num} au același km (${b[i].sumKm}) sau merg înapoi`);
      else if (sec > 8)
        probleme.push(`${unde}: salt de ${sec.toFixed(1)} km între boxurile ${b[i - 1].num} și ${b[i].num} — pagină lipsă?`);
    }
    // numerele de box: o gaură în serie = o pagină sau un rând nescanat
    const nums = b.map(x => x.num).filter(n => n != null);
    for (let i = 1; i < nums.length; i++) {
      const gol = nums[i] - nums[i - 1];
      if (gol > 1) probleme.push(`${unde}: lipsesc boxurile ${nums[i - 1] + 1}–${nums[i] - 1} (între ${nums[i - 1]} și ${nums[i]})`);
      else if (gol < 0) probleme.push(`${unde}: boxul ${nums[i]} vine după ${nums[i - 1]} — numerotare încurcată`);
    }
    // box mut: fără direcție și fără flag — scanarea n-a înțeles căsuța
    for (const x of b) {
      if (!x.dir && !x.flag) probleme.push(`${unde}: boxul ${x.num} n-are nici direcție, nici semn — verifică pagina`);
    }
    // probele: fiecare START își are FINISH-ul?
    let deschise = 0;
    for (const x of b) {
      if (x.flag === 'RT_START_AUTO' || x.flag === 'RT_START_STANDING') deschise++;
      else if (x.flag === 'RT_FINISH') {
        if (deschise === 0) probleme.push(`${unde}: FINISH de probă (box ${x.num}) fără START înaintea lui`);
        else deschise--;
      }
    }
    if (deschise > 0) probleme.push(`${unde}: ${deschise} probă/e cu START fără FINISH`);
    // Un leg fără nicio probă sau fără TC de final e aproape sigur o scanare parțială —
    // exact cazul din 02.08: doar pagina 1 intrase (4 boxuri, 0 probe, 0,35 km) și
    // seria de numere 1-4 era „corectă", deci nimic nu urla. De-acum urlă asta.
    if (b.length >= 2) {
      if (!b.some(x => x.flag === 'RT_START_AUTO' || x.flag === 'RT_START_STANDING'))
        probleme.push(`${unde}: NICIO probă în ${b.length} boxuri — sigur au intrat toate paginile?`);
      if (b[b.length - 1].flag !== 'TC' && b[b.length - 1].flag !== 'PARKING')
        probleme.push(`${unde}: ultimul box (${b[b.length - 1].num}) nu e TC/parcare — lipsește finalul?`);
    }
  }
  return { probleme, legs: grupuri.map(g => ({ key: g.key, label: g.label, boxuri: g.boxes.length })) };
}

// ── HARTA TRASEULUI: coordonatele boxurilor ─────────────────────────────────
// De ce există. Roadbook-ul spune „la 0,41 km, dreapta pe Str. Pluto" — o instrucțiune
// relativă, care nu poate răspunde la întrebarea „unde e boxul 4?". Fără răspunsul ăla,
// aplicația nu poate ști nici dacă ai plecat în direcția bună, nici încotro s-o iei
// înapoi când ai greșit. Roadbook-urile de test sunt generate dintr-o rutare, deci
// coordonatele EXISTĂ la generare — doar că nu ajungeau niciodată în telefon.
//
// Formatul (îl produce generatorul de roadbook, îl citește file picker-ul din panou):
//   {
//     "_app": "RALI2_HARTA",
//     "day": 1,
//     "legs": {
//       "D1L1": { "boxes": [ { "num": 1, "lat": 45.782532, "lng": 11.246190 }, … ] }
//     }
//   }
// Cheia de leg se scrie „D1L1" (sau „1|1" — se acceptă ambele) și trebuie să corespundă
// leg-ului din roadbook-ul scanat. Boxurile lipsă sunt permise: harta e opțională și
// parțială; ce lipsește cade pe sursele mai slabe (recunoaștere, firimituri).
//
// Harta e CONȚINUT EXTERN (fișier de pe telefon, generat de altcineva), deci trece prin
// aceeași graniță de încredere ca scanarea: se validează totul, se refuză cu motiv.
export const HARTA_APP = 'RALI2_HARTA';
const HARTA_MAX_BOXURI = 400;

function cheieLeg(k) {
  const s = String(k).trim().toUpperCase();
  let m = s.match(/^D(\d+)L(\d+)$/);
  if (m) return `${+m[1]}|${+m[2]}`;
  m = s.match(/^(\d+)\|(\d+)$/);
  if (m) return `${+m[1]}|${+m[2]}`;
  return null;
}

// `grupuri` = ieșirea lui groupByLeg pe roadbook-ul scanat; harta se verifică FAȚĂ DE EL.
export function verificaHarta(raw, grupuri = []) {
  const probleme = [];
  const harta = {};
  let nBoxuri = 0;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, harta: null, probleme: ['Fișierul nu conține un obiect JSON.'] };
  if (raw._app !== HARTA_APP)
    return { ok: false, harta: null,
             probleme: [`Nu e o hartă RALI 2 (aștept _app: "${HARTA_APP}", am găsit "${raw._app}").`] };
  const legs = raw.legs;
  if (!legs || typeof legs !== 'object' || Array.isArray(legs) || !Object.keys(legs).length)
    return { ok: false, harta: null, probleme: ['Harta n-are nicio secțiune `legs`.'] };

  for (const [k, val] of Object.entries(legs)) {
    const cheie = cheieLeg(k);
    if (!cheie) { probleme.push(`Cheie de leg necitibilă: „${String(k).slice(0, 20)}" (aștept „D1L1").`); continue; }
    const g = grupuri.find(x => x.key === cheie);
    if (!g) {
      probleme.push(`Harta are leg-ul ${cheie.replace('|', ' · leg ')}, dar roadbook-ul scanat nu.`);
      continue;
    }
    const lista = val && Array.isArray(val.boxes) ? val.boxes : null;
    if (!lista) { probleme.push(`Leg-ul ${cheie}: lipsește lista de boxuri.`); continue; }
    if (lista.length > HARTA_MAX_BOXURI) { probleme.push(`Leg-ul ${cheie}: ${lista.length} boxuri, peste limita de ${HARTA_MAX_BOXURI}.`); continue; }
    const numeriPlan = new Set(g.boxes.map(b => b.num));
    const pts = {};
    const necunoscute = [];
    for (const b of lista) {
      const num = typeof b?.num === 'number' ? b.num : parseInt(b?.num, 10);
      const lat = typeof b?.lat === 'number' ? b.lat : parseFloat(b?.lat);
      const lng = typeof b?.lng === 'number' ? b.lng : parseFloat(b?.lng);
      if (!Number.isFinite(num) || num < 1 || num > 999) { probleme.push(`Leg-ul ${cheie}: box cu număr invalid (${JSON.stringify(b?.num)}).`); continue; }
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
          Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        probleme.push(`Leg-ul ${cheie}, boxul ${num}: coordonate invalide (${JSON.stringify(b?.lat)}, ${JSON.stringify(b?.lng)}).`);
        continue;
      }
      if (!numeriPlan.has(num)) { necunoscute.push(num); continue; }
      pts[num] = { lat, lng };
    }
    if (necunoscute.length)
      probleme.push(`Leg-ul ${cheie}: boxurile ${necunoscute.slice(0, 8).join(', ')}${necunoscute.length > 8 ? '…' : ''} nu există în roadbook-ul scanat.`);
    for (const p of coerentaHarta(pts, g.boxes).probleme) probleme.push(`Leg-ul ${cheie}: ${p}`);
    const n = Object.keys(pts).length;
    if (n < 2) { probleme.push(`Leg-ul ${cheie}: doar ${n} box cu coordonate — prea puțin ca să însemne ceva.`); continue; }
    harta[cheie] = pts;
    nBoxuri += n;
  }
  const ok = probleme.length === 0 && Object.keys(harta).length > 0;
  return { ok, harta: ok ? harta : null, probleme,
           rezumat: { legs: Object.keys(harta).length, boxuri: nBoxuri } };
}

// COERENȚA cu kilometrajul: linia dreaptă dintre două boxuri nu poate fi mai lungă decât
// drumul dintre ele. Dacă e, coordonatele sunt de pe alt traseu — iar o hartă greșită e
// mai rea decât niciuna: trimite pilotul cu încredere în direcția greșită.
//
// Se cheamă în DOUĂ locuri: la încărcarea unui fișier de hartă (acolo refuză fișierul) și
// la fiecare construire de plan, ca plasă de siguranță peste harta deja stocată. A doua
// oară e cea care contează: coordonatele stau în IndexedDB legate de cheia de leg, iar
// cheia e aproape mereu „1|1" — o hartă rămasă de la alt eveniment se potrivește perfect
// ca formă și e complet greșită ca fond.
export function coerentaHarta(pts, boxes) {
  const probleme = [];
  const nums = (boxes || []).filter(b => pts && pts[b.num]).sort((a, b) => a.sumKm - b.sumKm);
  for (let i = 1; i < nums.length; i++) {
    const a = nums[i - 1], b = nums[i];
    const drumM = Math.abs(b.sumKm - a.sumKm) * 1000;
    const dreaptaM = haversineM(pts[a.num].lat, pts[a.num].lng, pts[b.num].lat, pts[b.num].lng);
    if (dreaptaM > drumM * 1.5 + 200) {
      probleme.push(`între boxurile ${a.num} și ${b.num} roadbook-ul are ${Math.round(drumM)} m, ` +
                    `dar coordonatele sunt la ${Math.round(dreaptaM)} m în linie dreaptă — harta nu e a acestui traseu.`);
      break;
    }
  }
  return { ok: probleme.length === 0, probleme, boxuri: nums.length };
}

// coordonatele boxurilor pentru un singur leg: { num → {lat,lng} }
export function hartaPentruLeg(harta, legKey) {
  return harta && legKey && harta[legKey] ? harta[legKey] : null;
}

// Probele, detectate din flag-uri; viteza din comentariu dacă organizatorul a scris-o.
//
// O LINIE DE FINISH ÎNCHIDE O SINGURĂ PROBĂ. Regula veche căuta, pentru fiecare start,
// primul FINISH de după el — fără să țină minte că acel finish fusese deja folosit. Așa
// s-a născut proba-fantomă din tura de la 21:48 (04.08.2026): scanarea a pus din greșeală
// flag de start de probă pe boxul 1, care e de fapt Time Control-ul de plecare, iar
// aplicația a raportat DOUĂ probe — RT1 (0 → 0,71 km, fără viteză) și RT2 (0,40 → 0,71,
// 30 km/h) — care se terminau amândouă la aceeași tabelă. Pilotul a auzit „Pornit. 2
// probe, 1 fără viteză." și „START probă" în loc de „Time Control — ștampila", chiar la
// primul box al zilei.
//
// Împerecherea se face acum ca la paranteze: fiecare FINISH închide startul DESCHIS cel
// mai apropiat dinaintea lui. Un start rămas nepereche nu devine probă — și e exact ce
// raportează verificatorul de roadbook („probă cu START fără FINISH"), adică semnul că
// scanarea a citit greșit o icoană.
export function detectRts(boxes, savedSpeeds = {}) {
  const rts = [];
  const deschise = [];
  for (let i = 0; i < boxes.length; i++) {
    const f = boxes[i].flag;
    if (f === 'RT_START_AUTO' || f === 'RT_START_STANDING') { deschise.push(i); continue; }
    if (f !== 'RT_FINISH' || !deschise.length) continue;
    const s = deschise.pop();                       // startul cel mai apropiat, încă deschis
    const dist = boxes[i].sumKm - boxes[s].sumKm;
    if (!(dist > 0.05 && dist < 60)) continue;
    const key = `${boxes[s].num}_${Math.round(boxes[s].sumKm * 100)}`;
    const m = String(boxes[s].comment || '').match(/(\d+(?:[.,]\d+)?)\s*km\s*\/?\s*h/i);
    rts.push({
      key, startIdx: s, finishIdx: i,
      startKm: boxes[s].sumKm, finishKm: boxes[i].sumKm,
      distKm: Math.round(dist * 100) / 100,
      type: boxes[s].flag === 'RT_START_STANDING' ? 'standing' : 'auto',
      kmh: savedSpeeds[key] != null ? savedSpeeds[key]
         : (m ? parseFloat(m[1].replace(',', '.')) : null)
    });
  }
  // numerotarea rămâne în ordinea de pe traseu, nu în ordinea în care s-au închis
  rts.sort((a, b) => a.startKm - b.startKm);
  rts.forEach((r, i) => { r.name = 'RT' + (i + 1); });
  return rts;
}

// ── Ancorele recunoaștere ↔ roadbook ────────────────────────────────────────
// anchors: [{ officialKm, traceM }] sortate după traceM, strict crescătoare pe ambele axe.
export function makeAnchorMap(anchors) {
  const A = [...anchors].sort((a, b) => a.traceM - b.traceM)
    .filter((a, i, arr) => i === 0 || (a.traceM > arr[i - 1].traceM && a.officialKm > arr[i - 1].officialKm));
  return {
    anchors: A,
    // metri pe urmă → km oficial (liniar între ancore; în afara lor, extrapolat cu
    // panta segmentului vecin — scara locală reală, nu presupunerea 1:1)
    officialKm(traceM) {
      if (!A.length) return traceM / 1000;
      if (A.length === 1) return A[0].officialKm + (traceM - A[0].traceM) / 1000;
      let i = 0;
      while (i < A.length - 2 && traceM > A[i + 1].traceM) i++;
      const a = A[i], b = A[i + 1];
      const f = (traceM - a.traceM) / (b.traceM - a.traceM);
      return a.officialKm + f * (b.officialKm - a.officialKm);
    },
    traceM(officialKm) {
      if (!A.length) return officialKm * 1000;
      if (A.length === 1) return A[0].traceM + (officialKm - A[0].officialKm) * 1000;
      let i = 0;
      while (i < A.length - 2 && officialKm > A[i + 1].officialKm) i++;
      const a = A[i], b = A[i + 1];
      const f = (officialKm - a.officialKm) / (b.officialKm - a.officialKm);
      return a.traceM + f * (b.traceM - a.traceM);
    }
  };
}

// ── Recunoașterea, legată de LEG ────────────────────────────────────────────
// Găsit 04.08.2026, căutând de ce `recon` e null în exporturile din ambele zile:
// geometria se ținea sub O SINGURĂ cheie globală ('recon'), deși numerele boxurilor ȘI
// kilometrajul repornesc la fiecare leg (lecția #1 a auditului, plătită deja o dată).
// Cu două leg-uri scanate, urma leg-ului 1 se aplica peste planul leg-ului 2: proiecție
// pe o geometrie care nu e a drumului pe care mergi, ancore care traduc kilometri ai
// altui traseu. Și invers: o recunoaștere nouă ștergea tăcut recunoașterea celuilalt leg.
// De-acum forma stocată e { _v: 2, legs: { "1|1": {trace, samples, anchors, at} } }.
export function reconNormalize(brut, legActiv) {
  if (!brut || typeof brut !== 'object') return { _v: 2, legs: {} };
  if (brut._v === 2 && brut.legs && typeof brut.legs === 'object')
    return { _v: 2, legs: { ...brut.legs } };
  // Forma VECHE (un singur obiect cu trace/anchors) se atribuie leg-ului activ — singura
  // presupunere posibilă, fiindcă vechea cheie nu ținea minte pentru CE leg s-a înregistrat.
  // Presupunerea poate fi greșită (leg-ul activ acum ≠ leg-ul înregistrat atunci), deci
  // intrarea rămâne MARCATĂ și panoul cere confirmarea omului. Condiția e pe forma reală
  // a urmei, nu pe „trace e adevărat": altfel orice obiect străin ajunge în legs.
  if (brut.trace && Array.isArray(brut.trace.pts) && legActiv)
    return { _v: 2, legs: { [legActiv]: { ...brut, legKey: legActiv, _dinFormaVeche: true } },
             _migrat: true };
  return { _v: 2, legs: {} };
}

export function reconPentruLeg(harta, legKey) {
  if (!harta || !harta.legs || !legKey) return null;
  return harta.legs[legKey] || null;
}

export function reconPune(harta, legKey, rec) {
  const h = reconNormalize(harta, legKey);
  h.legs[legKey] = rec;
  delete h._migrat;
  return h;
}

// Verdictul citit ÎNAINTE de START. „Există un obiect recon" nu înseamnă „merge":
// fără ancore, buildPlan nu poate face anchorMap, iar mașina ignoră complet urma —
// tăcut, exact ca și cum n-ar exista (așa a stat aplicația două zile de teste).
export function reconStatus(rec) {
  const puncte = rec && rec.trace && Array.isArray(rec.trace.pts) ? rec.trace.pts.length : 0;
  const ancore = rec && Array.isArray(rec.anchors) ? rec.anchors.length : 0;
  const km = rec && rec.trace && isFinite(rec.trace.totalM) ? rec.trace.totalM / 1000 : 0;
  const at = rec && rec.at ? rec.at : null;
  const baza = { puncte, ancore, km, at, recuperat: !!(rec && rec.recuperat),
                 dinFormaVeche: !!(rec && rec._dinFormaVeche) };
  if (!rec) return { ok: false, ...baza, motiv: 'nu s-a înregistrat niciodată' };
  if (puncte < 2) return { ok: false, ...baza, motiv: 'urma e goală — înregistrarea n-a prins puncte GPS' };
  if (ancore < 1) return { ok: false, ...baza, motiv: 'fără ancore — urma nu se poate lega de kilometrajul din roadbook' };
  return { ok: true, ...baza, motiv: null };
}

// Ciorna unei înregistrări întrerupte (aplicația moare des pe telefon în plin drum).
// Decizia, ca funcție pură ca s-o poată verifica testele: se promovează la geometria
// leg-ului DOAR dacă leg-ul n-are deja una — altfel se păstrează și se raportează.
export function reconRecupereaza(ciorna, harta) {
  if (!ciorna || !Array.isArray(ciorna.raw) || ciorna.raw.length < 2 || !ciorna.legKey)
    return { stare: 'gol' };
  const trace = buildTrace(ciorna.raw);
  const km = Math.round(trace.totalM) / 1000;
  if (reconPentruLeg(reconNormalize(harta, ciorna.legKey), ciorna.legKey))
    return { stare: 'exista_deja', legKey: ciorna.legKey, km };
  return { stare: 'recuperat', legKey: ciorna.legKey, km,
           rec: { trace, samples: ciorna.samples || [], anchors: ciorna.anchors || [],
                  at: ciorna.at || Date.now(), legKey: ciorna.legKey, recuperat: true } };
}

// Zonele lente ale unei probe, în metri DE PROBĂ, din mostrele de recunoaștere.
// samples: [{ cumM, kmh }] pe TOATĂ urma; rt are startKm/finishKm oficiali.
export function rtSlowZones(rt, samples, anchorMap, targetKmh) {
  if (!samples || !samples.length || !anchorMap || targetKmh == null) return [];
  const fromM = anchorMap.traceM(rt.startKm);
  const toM = anchorMap.traceM(rt.finishKm);
  const inRt = samples.filter(s => s.cumM >= fromM && s.cumM <= toM)
    .map(s => ({ cumM: s.cumM - fromM, kmh: s.kmh }));
  return slowZones(inRt, targetKmh);
}

// Planul zilei: totul, gata de dat mașinii de stări.
export function buildPlan(boxes, savedSpeeds, recon /* {trace, samples, anchors} | null */,
                          harta /* { num → {lat,lng} } | null */) {
  const rts = detectRts(boxes, savedSpeeds);
  const anchorMap = recon && recon.anchors && recon.anchors.length
    ? makeAnchorMap(recon.anchors) : null;
  for (const rt of rts) {
    rt.zones = (recon && anchorMap && rt.kmh != null)
      ? rtSlowZones(rt, recon.samples, anchorMap, rt.kmh) : [];
  }
  return {
    boxes, rts,
    trace: recon ? recon.trace : null,
    samples: recon ? recon.samples : null,
    anchorMap,
    harta: harta || null,
    totalKm: boxes.length ? boxes[boxes.length - 1].sumKm : 0
  };
}
