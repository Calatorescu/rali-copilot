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

// ── UN BOX POATE PURTA MAI MULTE SEMNE ──────────────────────────────────────
// Roadbook-ul REAL de la Reșița (Leg 2, scanat 05.08.2026, 14 pagini, 120 de boxuri):
// boxul 64, la km 47,69, e SIMULTAN finish-ul probei 2 și startul probei 3. În roadbook
// are ambele icoane, una lângă alta. Modelul de date de până acum avea `flag` — UN
// SINGUR șir — deci una dintre ele se pierdea OBLIGATORIU, oricât de bun ar fi promptul.
// Nu era o problemă de citire, era o problemă de model.
//
// Ce a costat, măsurat pe datele reale: din trei probe, scanarea a produs una singură,
// de la 62,12 la 71,51 km — adică TR2 și TR3 dispăreau cu totul, iar TR4 se cronometra
// pe 9,39 km în loc de 8,87. Cronometrarea e chiar partea pe care se dau punctele.
// (CORECTAT 05.08, seara: prima versiune a comentariului scria „9,39 în loc de 5,74,
// cu 63% mai mult". 5,74 km e doar primul segment al lui TR4, până la schimbarea de
// medie de la boxul 97; buletinul spune că TR4 se termină după boxul 104, la 8,87 km.)
// La Sibiu tiparul „finish-ul unei probe = startul următoarei" apare la fel.
//
// De-aici încolo adevărul e `flags`, o LISTĂ. `flag` rămâne pe box ca teren DERIVAT
// (primul semn, în ordinea importanței de mai jos), doar pentru afișare — nicio decizie
// de cursă nu se mai ia din el. Vezi flagPrincipal.
export const START_FLAGS = ['RT_START_AUTO', 'RT_START_STANDING'];
// ordinea în care un box cu mai multe semne se prezintă pe ecran: finish-ul închide o
// probă cronometrată, deci se vede primul; TC-ul e o ștampilă, deci bate parcarea
const ORDINE_FLAG = ['RT_FINISH', 'RT_START_STANDING', 'RT_START_AUTO', 'TC', 'PARKING', 'EV'];

export function normFlags(b) {
  const brut = Array.isArray(b && b.flags) ? b.flags
             : (b && b.flag != null ? [b.flag] : []);
  const bune = [];
  for (const f of brut) if (FLAG_OK.has(f) && !bune.includes(f)) bune.push(f);
  // START AUTO și START STANDING se exclud reciproc: aceeași linie nu poate fi și cu
  // oprire, și din mers. Dacă scanarea le dă pe amândouă, „standing" e cel restrictiv,
  // deci cel care se păstrează (o probă pornită din greșeală din mers pierde secunde).
  if (bune.includes('RT_START_STANDING')) {
    const i = bune.indexOf('RT_START_AUTO');
    if (i >= 0) bune.splice(i, 1);
  }
  return bune.sort((x, y) => ORDINE_FLAG.indexOf(x) - ORDINE_FLAG.indexOf(y));
}

export function areFlag(b, f) { return normFlags(b).includes(f); }
export function esteStart(b) { return normFlags(b).some(f => START_FLAGS.includes(f)); }
export function esteFinish(b) { return areFlag(b, 'RT_FINISH'); }
export function flagPrincipal(b) { const f = normFlags(b); return f.length ? f[0] : null; }

export function sanitizeBoxes(raw) {
  const num = v => {
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
    return typeof n === 'number' && isFinite(n) ? n : null;
  };
  const out = (Array.isArray(raw) ? raw : []).map(b => {
    // AICI se face migrarea: orice roadbook stocat de o versiune veche (cu `flag` singur)
    // intră pe același drum ca unul scanat azi. sanitizeBoxes e chemată la fiecare
    // pornire și la fiecare import, deci e singurul punct prin care trec toate căile.
    const flags = normFlags(b);
    return {
    day: num(b.day), leg: num(b.leg), page: num(b.page), num: num(b.num),
    sumKm: num(b.sumKm), sectionKm: num(b.sectionKm),
    dir: DIR_OK.has(b.dir) ? b.dir : null,
    flags,
    flag: flags.length ? flags[0] : null,       // DERIVAT, doar pentru afișare
    comment: typeof b.comment === 'string' ? b.comment.slice(0, 120) : '',
    // Reperul geocodabil, cerut explicit la scanare (vezi ROADBOOK_PROMPT). E tot text
    // din același răspuns extern, deci trece prin aceeași sită: șir scurt, fără
    // caractere de control. Când lipsește, se deduce din comentariu (repere.js).
    reper: typeof b.reper === 'string' && b.reper.trim()
      ? b.reper.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : null
    };
  }).filter(b => b.sumKm !== null);
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
    //
    // SALTUL DE KILOMETRAJ NU ÎNSEAMNĂ PAGINĂ LIPSĂ dacă numerele de box sunt
    // CONSECUTIVE. Măsurat pe roadbook-ul real de la Reșița (Leg 2, 05.08.2026): între
    // boxurile 50 și 51 sunt 9,73 km, iar comentariile spun de ce — „Exit Municipiul
    // Reșița" apoi „Văliug 5 km": drum de munte pe DJ 582, fără nicio manevră pe care
    // roadbook-ul s-o descrie. Mai sunt două salturi, de 5,96 și 7,69 km, în același leg.
    // Numărul total de boxuri (120) se potrivea exact cu referința, deci nu lipsea nimic.
    // Trei alarme false pe ecran, cu o zi înainte de cursă, costă încrederea în toate
    // celelalte avertismente — care sunt reale.
    for (let i = 1; i < b.length; i++) {
      const sec = b[i].sumKm - b[i - 1].sumKm;
      if (sec <= 0) {
        probleme.push(`${unde}: boxurile ${b[i - 1].num} și ${b[i].num} au același km (${b[i].sumKm}) sau merg înapoi`);
        continue;
      }
      if (sec <= 8) continue;
      const consecutive = b[i].num != null && b[i - 1].num != null && b[i].num - b[i - 1].num === 1;
      if (consecutive) {
        // numerotarea e neîntreruptă: nu s-a pierdut niciun rând. Rămâne o notă, fiindcă
        // un tronson lung E o informație pentru pilot — dar nu o acuzație de scanare.
        if (sec > 15)
          probleme.push(`${unde}: tronson lung de ${sec.toFixed(1)} km între boxurile ${b[i - 1].num} și ${b[i].num} — fără manevre, verifică pe hartă`);
      } else {
        probleme.push(`${unde}: salt de ${sec.toFixed(1)} km între boxurile ${b[i - 1].num} și ${b[i].num} — pagină lipsă?`);
      }
    }
    // numerele de box: o gaură în serie = o pagină sau un rând nescanat
    const nums = b.map(x => x.num).filter(n => n != null);
    for (let i = 1; i < nums.length; i++) {
      const gol = nums[i] - nums[i - 1];
      if (gol > 1) probleme.push(`${unde}: lipsesc boxurile ${nums[i - 1] + 1}–${nums[i] - 1} (între ${nums[i - 1]} și ${nums[i]})`);
      else if (gol < 0) probleme.push(`${unde}: boxul ${nums[i]} vine după ${nums[i - 1]} — numerotare încurcată`);
    }
    // box mut: fără direcție și fără niciun semn — scanarea n-a înțeles căsuța
    for (const x of b) {
      if (!x.dir && !normFlags(x).length) probleme.push(`${unde}: boxul ${x.num} n-are nici direcție, nici semn — verifică pagina`);
    }
    // Probele: fiecare START își are FINISH-ul? Ordinea în interiorul unui box e aceeași
    // ca la detectRts — întâi se închide, apoi se deschide — fiindcă boxul care e și
    // finish, și start (Reșița, boxul 64) e cazul normal, nu excepția.
    let deschise = 0;
    for (const x of b) {
      const f = normFlags(x);
      if (f.includes('RT_FINISH')) {
        if (deschise === 0) probleme.push(`${unde}: FINISH de probă (box ${x.num}) fără START înaintea lui`);
        else deschise--;
      }
      if (f.some(y => START_FLAGS.includes(y))) deschise++;
    }
    if (deschise > 0) probleme.push(`${unde}: ${deschise} probă/e cu START fără FINISH`);
    // Un leg fără nicio probă sau fără TC de final e aproape sigur o scanare parțială —
    // exact cazul din 02.08: doar pagina 1 intrase (4 boxuri, 0 probe, 0,35 km) și
    // seria de numere 1-4 era „corectă", deci nimic nu urla. De-acum urlă asta.
    if (b.length >= 2) {
      if (!b.some(x => esteStart(x)))
        probleme.push(`${unde}: NICIO probă în ${b.length} boxuri — sigur au intrat toate paginile?`);
      if (!areFlag(b[b.length - 1], 'TC') && !areFlag(b[b.length - 1], 'PARKING'))
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
// ORDINEA ÎN INTERIORUL ACELUIAȘI BOX (de la v36): boxul care poartă și FINISH, și START
// se procesează întâi ca finish, apoi ca start. Altfel startul probei următoare ar fi
// împerecheat cu propriul lui finish și ar ieși o probă de zero kilometri, iar proba
// dinainte ar rămâne deschisă până la următoarea tabelă — exact ce s-a măsurat pe
// roadbook-ul de la Reșița: o singură probă de 9,39 km în loc de trei probe corecte.

// ── O PROBĂ POATE AVEA MAI MULTE MEDII ──────────────────────────────────────
// Buletinul Directorului de cursă de la Reșița (26.06.2026, Document 3.1) definește TR4
// așa: start la boxul 79, medie 24,3 km/h, „Schimbare de viteza 20,5 km/h la Box 97",
// finiș după boxul 104. Adică: 5,74 km la 24,3, apoi 3,13 km la 20,5. Modelul de până
// acum ținea `kmh` ca UN SINGUR număr, deci a doua medie nu avea unde să încapă — proba
// s-ar fi cronometrat integral la 24,3 și devierea ar fi crescut liniar și fals de la
// boxul 97 încolo, chiar pe proba cea mai grea a cursei.
//
// Matematica pe segmente exista deja și e testată (pace.js: idealTimeS, speedAt,
// recoverySpeed acceptă `[{fromKm, kmh}]`). Ruptă era doar conducta către ea. De-aici
// încolo proba poartă `segments`, cu `fromKm` măsurat de la STARTUL PROBEI (0 = linia de
// start). O probă cu medie constantă are UN segment — exact comportamentul de până acum.
// `kmh` rămâne pe obiect, egal cu viteza primului segment, fiindcă mai multe locuri din
// mașina de stări îl citesc (avertizarea de la 500 m, estimarea poziției fără GPS,
// zonele lente).
export const VITEZA_MIN = 5, VITEZA_MAX = 200;

function numarIntre(v, min, max) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  return typeof n === 'number' && isFinite(n) && n >= min && n <= max ? n : null;
}
function intregIntre(v, min, max) {
  const n = numarIntre(v, min, max);
  return n == null ? null : Math.round(n);
}

// Viteza salvată de om în `rt_speeds`, sub cheia probei. Forma VECHE e un număr simplu
// (și rămâne valabilă, e ce scriu telefoanele de până azi); forma nouă e
// { kmh, schimbari: [{ box, kmh }] } — schimbarea se scrie pe BOX, nu pe kilometru,
// fiindcă boxul e ce citește omul din buletin și de pe roadbook.
export function normVitezaSalvata(v) {
  if (v == null) return { kmh: null, schimbari: [] };
  if (typeof v === 'number' || typeof v === 'string')
    return { kmh: numarIntre(v, VITEZA_MIN, VITEZA_MAX), schimbari: [] };
  if (typeof v !== 'object' || Array.isArray(v)) return { kmh: null, schimbari: [] };
  const schimbari = (Array.isArray(v.schimbari) ? v.schimbari : [])
    .map(s => ({ box: intregIntre(s && s.box, 1, 999),
                 kmh: numarIntre(s && s.kmh, VITEZA_MIN, VITEZA_MAX) }))
    .filter(s => s.box != null && s.kmh != null)
    .slice(0, 6);
  return { kmh: numarIntre(v.kmh, VITEZA_MIN, VITEZA_MAX), schimbari };
}

// Segmentele, din viteza de bază + punctele de schimbare (în km DE PROBĂ).
// Fără viteză de bază nu există niciun segment: proba e „fără viteză setată" și mașina
// o sare, exact ca înainte.
export function faSegmente(kmh, extra = []) {
  if (kmh == null) return [];
  const segs = [{ fromKm: 0, kmh }];
  for (const e of (Array.isArray(extra) ? extra : [])) {
    if (!e || e.kmh == null || !(e.fromKm > 0)) continue;
    segs.push({ fromKm: Math.round(e.fromKm * 100) / 100, kmh: e.kmh });
  }
  segs.sort((a, b) => a.fromKm - b.fromKm);
  const out = [];
  for (const s of segs) {
    // două schimbări în același punct: rămâne ultima (omul a corectat, nu a adăugat)
    if (out.length && Math.abs(out[out.length - 1].fromKm - s.fromKm) < 0.005) out[out.length - 1] = s;
    else out.push(s);
  }
  return out;
}

// Schimbările salvate pe boxuri → puncte în km de probă, verificate față de proba reală.
// Ce cade în afara probei NU se aplică (și nu se pierde tăcut: apelantul primește lista).
function schimbariPeBox(boxes, schimbari, startKm, distKm) {
  const bune = [], afara = [];
  for (const sc of (schimbari || [])) {
    const b = boxes.find(x => x && x.num === sc.box);
    const f = b ? Math.round((b.sumKm - startKm) * 100) / 100 : null;
    if (b && f > 0 && f < distKm) bune.push({ fromKm: f, kmh: sc.kmh, box: sc.box });
    else afara.push({ box: sc.box, kmh: sc.kmh, exista: !!b });
  }
  return { bune, afara };
}

export function detectRts(boxes, savedSpeeds = {}) {
  const rts = [];
  const deschise = [];
  for (let i = 0; i < boxes.length; i++) {
    const f = normFlags(boxes[i]);
    // 1. ÎNCHIDEREA
    if (f.includes('RT_FINISH') && deschise.length) {
      const s = deschise.pop();                     // startul cel mai apropiat, încă deschis
      const dist = boxes[i].sumKm - boxes[s].sumKm;
      if (dist > 0.05 && dist < 60) {
        const key = `${boxes[s].num}_${Math.round(boxes[s].sumKm * 100)}`;
        const m = String(boxes[s].comment || '').match(/(\d+(?:[.,]\d+)?)\s*km\s*\/?\s*h/i);
        const sv = normVitezaSalvata(savedSpeeds[key]);
        const kmh = sv.kmh != null ? sv.kmh
                  : (m ? parseFloat(m[1].replace(',', '.')) : null);
        const distKm = Math.round(dist * 100) / 100;
        const sch = schimbariPeBox(boxes, sv.schimbari, boxes[s].sumKm, distKm);
        const segments = faSegmente(kmh, sch.bune);
        rts.push({
          key, startIdx: s, finishIdx: i,
          startKm: boxes[s].sumKm, finishKm: boxes[i].sumKm,
          distKm,
          type: areFlag(boxes[s], 'RT_START_STANDING') ? 'standing' : 'auto',
          kmh: segments.length ? segments[0].kmh : kmh,
          segments,
          schimbari: sch.bune,          // pentru ecran: „de la boxul 97, 20,5"
          schimbariNepuse: sch.afara,   // ce a scris omul și nu se leagă de probă
          sursa: 'roadbook'
        });
      }
    }
    // 2. DESCHIDEREA — același box poate face și asta, imediat după
    if (f.some(x => START_FLAGS.includes(x))) deschise.push(i);
  }
  // numerotarea rămâne în ordinea de pe traseu, nu în ordinea în care s-au închis
  rts.sort((a, b) => a.startKm - b.startKm);
  rts.forEach((r, i) => { r.name = 'RT' + (i + 1); });
  return rts;
}

// ══ BULETINUL DIRECTORULUI DE CURSĂ ═════════════════════════════════════════
// FAPTUL care a născut tot codul de mai jos, verificat pe paginile fotografiate ale
// roadbook-ului de la Reșița (05.08.2026): boxurile 66, 97 și 104 — finișul lui TR3,
// schimbarea de viteză din TR4 și finișul lui TR4 — n-au NICIO icoană și NICIUN
// comentariu în roadbook. Nicio scanare de roadbook, oricât de bună, nu le poate găsi
// vreodată. Probele de regularitate nu sunt definite în roadbook; sunt definite într-un
// document separat, „Buletinul Directorului de cursă" (Reșița: Bulletin No. 2,
// Document 3.1), care le scrie în text: start, medie, schimbări de medie, finiș.
//
// Deci: cale NOUĂ, paralelă cu detectarea din icoane. Când există buletin pentru legul
// curent, EL bate semnele scanate — fiindcă el e documentul care le definește.
//
// TREI LUCRURI PE CARE BULETINUL LE SPUNE ȘI ROADBOOK-UL NU:
//  1. FINIȘUL ARE UN CALIFICATIV: „La box N" / „Înainte de box N" / „După box N".
//     „Înainte de boxul 66" NU e „la boxul 66" — linia e undeva între 65 și 66, adică
//     pe 5,97 km de incertitudine. Aplicația cronometrează la kilometrajul boxului,
//     fiindcă alta n-are, dar O SPUNE pe ecran. Altfel Andreas ar crede că are o
//     precizie pe care n-o are.
//  2. SCHIMBAREA DE MEDIE poate fi legată de un BOX (TR4: la boxul 97) sau de un LOC
//     (TR6: „la ieșirea din localitatea Văliug"). A doua nu se poate transforma singură
//     în kilometraj — deci NU se aplică, se cere omului.
//  3. STARTUL e definit ca decalaj față de un TC („la 77 de minute după începerea TC 3")
//     sau ca start lansat la panou. Informația se afișează; ceasul rămâne al pilotului.
//
// GRANIȚA DE ÎNCREDERE (legea 1): buletinul intră în aplicație printr-o poză citită de
// un model — adică e conținut extern derivat dintr-un document tipărit de altcineva.
// NICIO valoare din el nu ajunge în plan fără să treacă prin `sanitizeBuletin`.
export const BULETIN_MAX_PROBE = 20;
const START_TYPE_OK = new Set(['standing', 'auto']);
const FINISH_REL_OK = new Set(['at', 'before', 'after']);

// Text venit din răspunsul unui model: se scot caracterele de control, se strâng
// spațiile, se taie la o lungime fixă. Restul se păstrează întreg — „la ieșirea din
// localitatea Văliug" trebuie să ajungă pe ecran exact cum scrie în buletin.
function textScurt(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

export function sanitizeBuletin(raw) {
  const lista = Array.isArray(raw) ? raw
              : (raw && Array.isArray(raw.probe) ? raw.probe : []);
  const out = [];
  for (const p of lista) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const name = textScurt(p.name, 16);
    const startBox = intregIntre(p.startBox, 1, 999);
    const finishBox = intregIntre(p.finishBox, 1, 999);
    // un rând fără nume ȘI fără niciun box nu e o probă, e zgomot
    if (name == null && startBox == null && finishBox == null) continue;
    const tc = p.startAfterTc;
    const tcNume = tc && typeof tc === 'object' && !Array.isArray(tc) ? textScurt(tc.tc, 12) : null;
    const tcMin = tc && typeof tc === 'object' && !Array.isArray(tc) ? intregIntre(tc.minutes, 0, 1440) : null;
    out.push({
      name, startBox, finishBox,
      startPage: intregIntre(p.startPage, 1, 999),
      startType: START_TYPE_OK.has(p.startType) ? p.startType : null,
      startAfterTc: tcNume && tcMin != null ? { tc: tcNume, minutes: tcMin } : null,
      kmh: numarIntre(p.kmh, VITEZA_MIN, VITEZA_MAX),
      speedChanges: (Array.isArray(p.speedChanges) ? p.speedChanges : [])
        .map(s => (s && typeof s === 'object' && !Array.isArray(s)) ? {
          kmh: numarIntre(s.kmh, VITEZA_MIN, VITEZA_MAX),
          box: intregIntre(s.box, 1, 999),
          page: intregIntre(s.page, 1, 999),
          place: textScurt(s.place, 60)
        } : null)
        // o schimbare fără viteză nu spune nimic; una fără box ȘI fără loc n-are unde
        // să se întâmple — amândouă se aruncă la graniță
        .filter(s => s && s.kmh != null && (s.box != null || s.place != null))
        .slice(0, 6),
      finishPage: intregIntre(p.finishPage, 1, 999),
      finishRel: FINISH_REL_OK.has(p.finishRel) ? p.finishRel : null
    });
    if (out.length >= BULETIN_MAX_PROBE) break;
  }
  return out;
}

// Buletinul e BILINGV și are mai multe pagini. Promptul îi cere modelului să scoată
// fiecare probă o singură dată DE PE O PAGINĂ — dar româna poate sta pe pagina 1 și
// engleza pe pagina 2, iar atunci dubla apare abia la îmbinare. Regula e aceeași ca în
// prompt: unde cele două se contrazic pe o cifră, cifra devine `null` și se cere omului.
// A alege una dintre ele ar însemna să ghicim exact acolo unde documentul e ambiguu.
const CAMPURI_IMBINATE = ['startBox', 'startPage', 'startType', 'kmh',
                          'finishBox', 'finishPage', 'finishRel'];

function cheieProba(p) {
  const n = p.name ? p.name.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return n || (p.startBox != null ? `s${p.startBox}` : null);
}

export function imbinaBuletin(a, b) {
  const out = sanitizeBuletin(a).map(p => ({ ...p }));
  const conflicte = [];
  for (const nou of sanitizeBuletin(b)) {
    const k = cheieProba(nou);
    const vechi = k ? out.find(p => cheieProba(p) === k) : null;
    if (!vechi) { if (out.length < BULETIN_MAX_PROBE) out.push({ ...nou }); continue; }
    for (const c of CAMPURI_IMBINATE) {
      if (nou[c] == null) continue;
      if (vechi[c] == null) { vechi[c] = nou[c]; continue; }
      if (vechi[c] === nou[c]) continue;
      conflicte.push(`${vechi.name || 'probă'}: „${c}" diferă între pagini (${vechi[c]} / ${nou[c]}) — l-am șters, pune-l de mână.`);
      vechi[c] = null;
    }
    if (!vechi.startAfterTc) vechi.startAfterTc = nou.startAfterTc;
    if (!vechi.speedChanges.length) vechi.speedChanges = nou.speedChanges;
  }
  return { probe: out, conflicte };
}

// Paginile legului curent. Potrivirea probă↔leg se face după numărul PAGINII, fiindcă
// numerele de box repornesc la fiecare leg: „boxul 57" există și în legul 2, și în 3.
// O pagină nescanată din mijlocul legului nu mută proba pe alt leg, deci intervalul se
// umple. Când roadbook-ul n-are deloc numere de pagină (antet necitit), se cade pe
// `legPage`; iar dacă nici acela nu există, filtrul de pagini se stinge complet și
// potrivirea rămâne doar pe numărul boxului — spus pe față în nota de mai jos.
function paginiLeg(boxes, legPage) {
  const s = new Set();
  for (const b of boxes) {
    const p = intregIntre(b && b.page, 1, 999);
    if (p != null) s.add(p);
  }
  if (s.size) {
    const min = Math.min(...s), max = Math.max(...s);
    for (let p = min; p <= max; p++) s.add(p);
    return s;
  }
  for (const p of (Array.isArray(legPage) ? legPage : [legPage])) {
    const n = intregIntre(p, 1, 999);
    if (n != null) s.add(n);
  }
  return s;
}

// Probele legului curent, construite DIN BULETIN. Funcție pură: primește boxurile
// scanate ale legului, buletinul citit și (opțional) vitezele puse de om; întoarce
// aceleași obiecte de probă ca `detectRts`, plus cifrele și avertismentele pentru ecran.
// NIMIC nu se ghicește: ce nu se poate lega se listează.
export function probeDinBuletin(boxes, buletin, legPage, savedSpeeds = {}) {
  const probe = sanitizeBuletin(buletin);
  const bx = Array.isArray(boxes) ? boxes : [];
  const pagini = paginiLeg(bx, legPage);
  const gasesteBox = n => bx.findIndex(b => b && b.num === n && typeof b.sumKm === 'number');
  const note = [], rts = [];
  const nota = (tip, text) => note.push({ tip, text });
  let inLeg = 0, boxuriCerute = 0, boxuriPotrivite = 0;
  const km = v => v.toFixed(2).replace('.', ',');

  if (probe.length && !pagini.size)
    nota('de_mana', 'Roadbook-ul scanat n-are numere de pagină, deci probele din buletin ' +
                    's-au potrivit DOAR după numărul boxului. Verifică pe hârtie că sunt ale acestui leg.');

  for (const p of probe) {
    const nume = p.name || (p.startBox != null ? `Proba de la boxul ${p.startBox}` : 'Probă fără nume');
    // ── 1. e a legului ăstuia? ──────────────────────────────────────────────
    if (pagini.size) {
      const pag = [p.startPage, p.finishPage].filter(x => x != null);
      if (!pag.length) {
        nota('nelegat', `${nume}: buletinul nu i-a dat numărul de pagină — nu pot ști de care leg ține, deci n-o pun în plan.`);
        continue;
      }
      if (!pag.some(x => pagini.has(x))) continue;   // e a altui leg: normal, se tace
    }
    inLeg++;

    // ── 2. boxurile reale ───────────────────────────────────────────────────
    boxuriCerute += 2;
    const si = p.startBox != null ? gasesteBox(p.startBox) : -1;
    const fi = p.finishBox != null ? gasesteBox(p.finishBox) : -1;
    if (si >= 0) boxuriPotrivite++;
    if (fi >= 0) boxuriPotrivite++;
    if (si < 0 || fi < 0) {
      const lipsa = [];
      if (p.startBox == null) lipsa.push('boxul de start nu s-a putut citi din buletin');
      else if (si < 0) lipsa.push(`boxul de start ${p.startBox} nu există în roadbook-ul scanat`);
      if (p.finishBox == null) lipsa.push('boxul de finiș nu s-a putut citi din buletin');
      else if (fi < 0) lipsa.push(`boxul de finiș ${p.finishBox} nu există în roadbook-ul scanat`);
      nota('nelegat', `${nume}: ${lipsa.join('; ')} — proba NU intră în plan.`);
      continue;
    }
    const startKm = bx[si].sumKm, finishKm = bx[fi].sumKm;
    const distKm = Math.round((finishKm - startKm) * 100) / 100;
    if (!(distKm > 0.05 && distKm < 60)) {
      nota('nelegat', `${nume}: de la boxul ${p.startBox} (${km(startKm)} km) la boxul ${p.finishBox} ` +
        `(${km(finishKm)} km) ies ${km(distKm)} km — nu e o probă plauzibilă, n-o pun în plan.`);
      continue;
    }

    // ── 3. calificativul finișului: se spune, nu se colapsează în tăcere ────
    const rel = p.finishRel || 'at';
    if (rel !== 'at') {
      const vecin = rel === 'before' ? bx[fi - 1] : bx[fi + 1];
      // boxurile se citesc în ordinea drumului, nu în ordinea în care le-am găsit
      const a = rel === 'before' ? vecin : bx[fi], z = rel === 'before' ? bx[fi] : vecin;
      const intre = vecin && typeof vecin.sumKm === 'number'
        ? `linia e undeva între boxul ${a.num} (${km(a.sumKm)} km) și boxul ${z.num} ` +
          `(${km(z.sumKm)} km), adică pe ${Math.round(Math.abs(z.sumKm - a.sumKm) * 1000)} m`
        : `linia nu e chiar la boxul ${p.finishBox}`;
      nota('aproximare', `${nume}: finiș ${rel === 'before' ? 'ÎNAINTE de' : 'DUPĂ'} boxul ${p.finishBox} — ` +
        `${intre}. Aplicația cronometrează la kilometrajul boxului ${p.finishBox} (${km(finishKm)} km).`);
    }

    // ── 4. schimbările de medie ─────────────────────────────────────────────
    const puncte = [];
    for (const sc of p.speedChanges) {
      if (sc.box == null) {
        // legată de un LOC: nu se poate transforma singură în kilometraj
        nota('de_mana', `${nume}: schimbare la ${sc.kmh} km/h „${sc.place}" — e legată de un LOC, ` +
          `nu de un box, deci NU s-a aplicat. Pune boxul de mână.`);
        continue;
      }
      boxuriCerute++;
      const bi = gasesteBox(sc.box);
      if (bi < 0) {
        nota('de_mana', `${nume}: schimbarea la ${sc.kmh} km/h e legată de boxul ${sc.box}, ` +
          `care nu există în roadbook-ul scanat — pune-o de mână.`);
        continue;
      }
      boxuriPotrivite++;
      const f = Math.round((bx[bi].sumKm - startKm) * 100) / 100;
      if (!(f > 0 && f < distKm)) {
        nota('de_mana', `${nume}: boxul ${sc.box} (${km(bx[bi].sumKm)} km) nu e între startul și finișul probei — ` +
          `schimbarea la ${sc.kmh} km/h NU s-a aplicat.`);
        continue;
      }
      puncte.push({ fromKm: f, kmh: sc.kmh, box: sc.box });
    }

    // ── 5. viteza: ce a pus OMUL bate ce s-a citit din buletin ──────────────
    const key = `${bx[si].num}_${Math.round(startKm * 100)}`;
    const sv = normVitezaSalvata(savedSpeeds[key]);
    const kmh = sv.kmh != null ? sv.kmh : p.kmh;
    if (kmh == null)
      nota('de_mana', `${nume}: buletinul n-a dat media — pune-o de mână, altfel proba se sare.`);
    let folosite = puncte;
    if (sv.schimbari.length) {
      const s2 = schimbariPeBox(bx, sv.schimbari, startKm, distKm);
      folosite = s2.bune;
      for (const a of s2.afara)
        nota('de_mana', `${nume}: schimbarea pusă de tine pe boxul ${a.box} ` +
          `${a.exista ? 'nu e între startul și finișul probei' : 'nu există în roadbook'} — n-am aplicat-o.`);
    }
    const segments = faSegmente(kmh, folosite);

    // ── 6. condițiile de start: informație pentru pilot, nu decizie de cod ──
    if (p.startAfterTc)
      nota('info', `${nume}: start la ${p.startAfterTc.minutes} minute după începerea ${p.startAfterTc.tc} ` +
        `(auto-start, fără arbitru) — ceasul rămâne al tău, aplicația nu-l pornește singură.`);

    rts.push({
      key, startIdx: si, finishIdx: fi,
      startKm, finishKm, distKm,
      type: p.startType === 'standing' ? 'standing' : 'auto',
      kmh: segments.length ? segments[0].kmh : kmh,
      segments,
      schimbari: folosite,
      schimbariNepuse: [],
      sursa: 'buletin',
      name: p.name || null,
      finishRel: rel,
      finishAprox: rel !== 'at',
      startDupaTc: p.startAfterTc
    });
  }

  rts.sort((a, b) => a.startKm - b.startKm);
  rts.forEach((r, i) => { if (!r.name) r.name = 'RT' + (i + 1); });
  return { rts, total: probe.length, inLeg, legate: rts.length,
           boxuriCerute, boxuriPotrivite, note };
}

// ── PROPUNERI DE CORECTURĂ PENTRU PROBE (05.08.2026) ────────────────────────
// De ce există. Roadbook-ul de antrenament de la Reșița (Leg 2, 14 pagini, 120 de boxuri,
// 0 pagini căzute) s-a scanat perfect pe partea de conținut: numere, kilometri, direcții,
// comentarii. Semnele de probă însă au ieșit aiurea — START pe două boxuri de drum
// obișnuit („DJ 582", „Biroul Vamal Reșița") și FINISH pe treisprezece, dintre care
// unsprezece sunt plăcuțe de localitate („Exit Văliug", „Welcome Gărâna", „Enter Brebu
// Nou"…) și unul e Time Control-ul de final al leg-ului. Aplicația a dedus cinci probe
// în loc de trei și a afișat opt avertismente „FINISH fără START înaintea lui".
//
// Opt avertismente nu se repară în parcare, box cu box, cu roadbook-ul pe genunchi și
// cursa în cinci minute. Ce se repară în parcare e o listă de propuneri cu un buton pe
// fiecare rând.
//
// CE POATE ȘI CE NU POATE DEDUCE CODUL DE AICI (măsurat pe pagini, 05.08.2026):
// Buletinul nr. 2 al Directorului de cursă definește probele ÎN TEXT, separat de
// roadbook — TR2 pornește la boxul 57 și se termină la boxul 64, TR3 pornește la 64 și
// se termină înainte de boxul 66, TR4 pornește la 79 și se termină după boxul 104.
// Boxurile 66, 97 și 104 — adică finișul lui TR3, schimbarea de viteză și finișul lui
// TR4 — n-au NICIO icoană și NICIUN comentariu în roadbook. Nu există niciun semn în
// pagină din care să se poată ghici. Prin urmare codul de aici NU inventă finișuri
// nicăieri: propune doar SCOATEREA a ce e vizibil greșit și ADĂUGAREA startului acolo
// unde roadbook-ul îl scrie el însuși cu litere („Start RT 3").
//
// GRANIȚA: funcțiile de aici PROPUN. Nu aplică nimic, nu ating nimic. Deducția se face
// din textul scanat — el însuși conținut extern, derivat din poza unui document tipărit
// de altcineva. Buletinul de pe hârtie rămâne singura autoritate. Fiecare propunere își
// cară motivul în română, cu comentariul boxului citat, ca omul să vadă pe ce s-a bazat
// și să poată spune „nu".

// Roadbook-ul își scrie starturile de probă în comentariu: „Start RT 2", „Start RT 3".
// Tolerant la spații, punctuație, majuscule și diacritice (textul trece prin faraDiacritice).
// `\bstart\b` ține „restart" afară; „TR" e acceptat fiindcă aceleași probe se scriu în
// documente și așa (TR2/TR3/TR4 în buletinul de cursă, RT în roadbook).
const RE_START_DECLARAT = /\bstart\b[^a-z0-9]{0,4}(?:rt|tr)[^a-z0-9]{0,4}(\d{1,2})\b/;
// Time Control = ștampilă de oră, nu linie cronometrată. Boxul 111 de la Reșița —
// „Finish Leg 2 Time Control - TC 4" — a fost citit de scanare ca finiș de probă.
const RE_TIME_CONTROL = /\btime control\b|\btc\s*[-–—.:#]?\s*\d+\b/;
// singurele cuvinte pe care roadbook-ul le folosește pentru plecarea de pe loc
const RE_STANDING = /\bstanding\b|\boprit[aă]?\b|\bde pe loc\b/;

function faraDiacritice(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Câte FINISH-uri n-au nicio probă deschisă înaintea lor. Aceeași logică de paranteze
// ca detectRts și verifyRoadbook — un box care e ȘI finish, ȘI start se procesează
// întâi ca finish (v36: boxul 64 de la Reșița).
export function numaraOrfane(boxes) {
  const ord = (Array.isArray(boxes) ? boxes : []).slice().sort((a, b) => a.sumKm - b.sumKm);
  let deschise = 0, orfane = 0;
  for (const b of ord) {
    const f = normFlags(b);
    if (f.includes('RT_FINISH')) { if (deschise === 0) orfane++; else deschise--; }
    if (f.some(x => START_FLAGS.includes(x))) deschise++;
  }
  return orfane;
}

// Propunerile, în ordinea kilometrajului. Fiecare: { box, actiune, flag, motiv }.
// `box` e CHIAR obiectul primit, nu o copie — ecranul îl dă mai departe lui comutaFlag.
export function propuneCorecturiProbe(boxes) {
  const ord = (Array.isArray(boxes) ? boxes : [])
    .filter(b => b && typeof b.sumKm === 'number')
    .slice().sort((a, b) => a.sumKm - b.sumKm);
  const propuneri = [];
  const vazut = new Set();
  // starea VIRTUALĂ a semnelor: pornește de la ce e acum și încorporează fiecare
  // propunere, ca regulile de mai jos să judece pe rezultatul celor dinaintea lor
  const virt = ord.map(b => new Set(normFlags(b)));
  const areS = i => [...virt[i]].some(f => START_FLAGS.includes(f));
  const areF = i => virt[i].has('RT_FINISH');
  const cit = i => ord[i].comment ? `„${String(ord[i].comment).trim().slice(0, 44)}"`
                                  : 'fără comentariu';
  const pune = (i, actiune, flag, motiv) => {
    const k = `${i}|${flag}`;
    if (vazut.has(k)) return false;         // un semn se propune o singură dată pe box
    vazut.add(k);
    if (actiune === 'adauga') virt[i].add(flag); else virt[i].delete(flag);
    propuneri.push({ box: ord[i], actiune, flag, motiv });
    return true;
  };

  // ── 1. STARTURILE PE CARE ROADBOOK-UL LE NUMEȘTE ─────────────────────────
  // Singurul lucru pe care pagina chiar îl scrie cu litere, deci singurul care se poate
  // verifica. Dacă leg-ul nu conține niciun „Start RT n", regula tace complet — nu toate
  // roadbook-urile își numesc probele, iar tăcerea e mai bună decât o presupunere.
  const declarate = [];
  ord.forEach((b, i) => {
    const t = faraDiacritice(b.comment);
    const m = t.match(RE_START_DECLARAT);
    if (m) declarate.push({ i, n: parseInt(m[1], 10), standing: RE_STANDING.test(t) });
  });
  const eDeclarat = new Set(declarate.map(d => d.i));
  if (declarate.length) {
    const lista = declarate.map(d => ord[d.i].num).join(', ');
    // a) declarat în text, dar fără semn pe box → se adaugă
    for (const d of declarate) {
      if (areS(d.i)) continue;              // are deja un start: felul lui nu se atinge
      pune(d.i, 'adauga', d.standing ? 'RT_START_STANDING' : 'RT_START_AUTO',
        `Roadbook-ul scrie aici „Start RT ${d.n}", dar boxul n-are semn de start.` +
        (d.standing ? ' Textul zice „standing", deci plecare de pe loc.' : ''));
    }
    // b) are semn de start, dar nicăieri în leg nu scrie că aici începe o probă
    for (let i = 0; i < ord.length; i++) {
      if (!areS(i) || eDeclarat.has(i)) continue;
      const flag = [...virt[i]].find(f => START_FLAGS.includes(f));
      pune(i, 'scoate', flag,
        `Are semn de START, dar textul nu declară nicio probă aici (${cit(i)}). ` +
        `Roadbook-ul își numește starturile la boxurile ${lista}.`);
    }
  }

  // ── 2. TIME CONTROL CITIT CA FINIȘ DE PROBĂ ──────────────────────────────
  for (let i = 0; i < ord.length; i++) {
    if (!areF(i) || !RE_TIME_CONTROL.test(faraDiacritice(ord[i].comment))) continue;
    pune(i, 'scoate', 'RT_FINISH',
      `${cit(i)} — e un Time Control (ștampilă de oră), nu finișul unei probe.`);
  }

  // ── 3. FINIȘURI ORFANE ───────────────────────────────────────────────────
  // Se parcurge cu propunerile de la 1 și 2 deja încorporate. Un FINISH fără nicio probă
  // deschisă înaintea lui nu poate fi decât o citire greșită — nu închide nimic.
  //
  // AICI SE OPREȘTE CODUL. Prima versiune a acestei reguli propunea și un FINISH nou pe
  // boxul startului următor, „fiindcă proba a rămas deschisă". E greșit și s-a scos:
  // buletinul de cursă arată că TR3 se termină înainte de boxul 66, iar TR4 începe abia
  // la 79 — între ele nu e nicio probă, deci un finiș pus pe boxul 79 ar fi fost inventat
  // de aplicație și ar fi cronometrat 14,43 km în loc de 6,26. Unde se termină o probă
  // scrie în buletin, nu în roadbook; aplicația nu are de unde ști, deci nu ghicește.
  let deschise = 0;
  for (let i = 0; i < ord.length; i++) {
    if (areF(i)) {
      if (deschise === 0)
        pune(i, 'scoate', 'RT_FINISH', `FINISH fără nicio probă deschisă înaintea lui (${cit(i)}).`);
      else deschise--;
    }
    if (areS(i)) deschise++;
  }

  propuneri.sort((a, b) => a.box.sumKm - b.box.sumKm);
  return propuneri;
}

// Aplicarea propunerilor pe o COPIE — folosită de rezumat și de teste ca să spună „câte
// probe ar ieși după". Ecranul NU trece pe-aici: acolo fiecare apăsare merge prin
// comutaFlag, care scrie în plan_raw și lasă urmă în jurnal.
export function aplicaPropuneri(boxes, propuneri) {
  const peBox = new Map();
  for (const p of (Array.isArray(propuneri) ? propuneri : [])) {
    if (!peBox.has(p.box)) peBox.set(p.box, []);
    peBox.get(p.box).push(p);
  }
  return (Array.isArray(boxes) ? boxes : []).map(b => {
    const lista = peBox.get(b);
    if (!lista) return b;
    let f = normFlags(b);
    for (const p of lista)
      f = p.actiune === 'adauga' ? (f.includes(p.flag) ? f : [...f, p.flag])
                                 : f.filter(x => x !== p.flag);
    const noi = normFlags({ flags: f });
    return { ...b, flags: noi, flag: noi.length ? noi[0] : null };
  }).sort((a, b) => a.sumKm - b.sumKm);
}

// Cifrele pentru ecran: ce scrie textul, ce e marcat, ce nu se leagă, și ce s-ar schimba.
export function rezumatVerificare(boxes) {
  const ord = (Array.isArray(boxes) ? boxes : []).slice().sort((a, b) => a.sumKm - b.sumKm);
  const propuneri = propuneCorecturiProbe(ord);
  const dupa = aplicaPropuneri(ord, propuneri);
  return {
    declarate: ord.filter(b => RE_START_DECLARAT.test(faraDiacritice(b.comment))).length,
    marcate: ord.filter(b => esteStart(b)).length,
    marcateDupa: dupa.filter(b => esteStart(b)).length,
    orfane: numaraOrfane(ord),
    orfaneDupa: numaraOrfane(dupa),
    probeAcum: detectRts(ord).length,
    probeDupa: detectRts(dupa).length,
    propuneri
  };
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
//
// CINE DECIDE PROBELE. Când există buletin ȘI el produce cel puțin o probă pe legul
// curent, probele vin DIN BULETIN — el e documentul care le definește, semnele din
// roadbook sunt doar icoane citite dintr-o poză. Dacă buletinul nu produce nimic pe
// legul ăsta (e al altui leg, sau boxurile lui nu se leagă), se cade înapoi pe semne,
// iar `plan.buletin` cară cifrele ca ecranul să spună DE CE.
export function buildPlan(boxes, savedSpeeds, recon /* {trace, samples, anchors} | null */,
                          harta /* { num → {lat,lng} } | null */,
                          buletin /* probele din Buletinul Directorului de cursă | null */) {
  const dinBuletin = buletin ? probeDinBuletin(boxes, buletin, null, savedSpeeds) : null;
  const rts = dinBuletin && dinBuletin.rts.length ? dinBuletin.rts
                                                  : detectRts(boxes, savedSpeeds);
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
    buletin: dinBuletin,
    sursaProbe: dinBuletin && dinBuletin.rts.length ? 'buletin' : 'roadbook',
    totalKm: boxes.length ? boxes[boxes.length - 1].sumKm : 0
  };
}
