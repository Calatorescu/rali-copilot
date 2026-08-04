// RALI 2 — HARTA TRASEULUI: coordonatele boxurilor.
//
// De ce a apărut. Tura poligon, 04.08.2026, 18:00-18:09: la bifurcația de după start
// (boxul 2, la 0,22 km) mașina a luat ramura greșită. Aplicația n-avea de unde să știe —
// roadbook-ul spune „stânga la 0,22 km", o instrucțiune relativă, iar odometrul a mers
// înainte fericit. A continuat să dicteze boxurile 4, 5 și 6 („dreapta acum, și în 400 de
// metri stânga la T", 18:01:53) pentru un traseu pe care mașina nu se afla, iar ieșirea
// de pe traseu s-a declarat abia la 18:02:31.
//
// Roadbook-urile de test sunt generate dintr-o rutare, deci coordonatele boxurilor EXISTĂ
// la generare. Fișierul de hartă le aduce în telefon.
import { verificaHarta, hartaPentruLeg, groupByLeg, sanitizeBoxes, buildPlan,
         coerentaHarta } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// roadbook-ul REAL al turei poligon (Leg 1, primele boxuri)
const POLIGON = sanitizeBoxes([
  { day: 1, leg: 1, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START · TC 1 — Str. Exemplu 7' },
  { day: 1, leg: 1, num: 2, sumKm: 0.22, dir: 'STÂNGA', comment: 'Stânga — la bifurcație ține stânga' },
  { day: 1, leg: 1, num: 3, sumKm: 0.27, dir: 'ÎNAINTE', comment: 'Înainte — devine Str. Mareșal Averescu' },
  { day: 1, leg: 1, num: 4, sumKm: 0.41, dir: 'DREAPTA', comment: 'Dreapta pe Str. Pluto' },
  { day: 1, leg: 1, num: 5, sumKm: 0.81, dir: 'STÂNGA-T', comment: 'Stânga la T — Str. Fervența' },
  { day: 1, leg: 1, num: 6, sumKm: 0.91, dir: 'DREAPTA', comment: 'Dreapta pe Str. Quasar' }
]);
const GRUPURI = groupByLeg(POLIGON);

// Punctul de plecare: latitudinea și forma drumului sunt cele din jurnal (tura de la
// 18:00), longitudinea e deplasată cu −10 ca în toate fixturile. Deplasarea constantă
// păstrează geometria intactă — azimuturile și distanțele depind de diferențele de
// longitudine și de cos(latitudine), niciuna schimbată — dar punctul nu mai arată spre
// o adresă reală.
const START = { lat: 45.782532, lng: 11.246190 };
// Coordonatele boxurilor sunt CONSTRUITE pentru test: harta n-a existat în tura aia —
// exact de-aia a eșuat. Geometria e cea din roadbook: boxul 2 la 220 m pe direcția în
// care s-a mers efectiv (măsurat în jurnal: azimut 210-213° pe primii 200 m), iar de
// acolo traseul o ia pe ramura de stânga, spre sud-est.
const m2g = (lat, lng, m, deg) => {
  const r = deg * Math.PI / 180;
  return { lat: lat + (m * Math.cos(r)) / 111320,
           lng: lng + (m * Math.sin(r)) / (111320 * Math.cos(lat * Math.PI / 180)) };
};
const P2 = m2g(START.lat, START.lng, 220, 211);
const P3 = m2g(P2.lat, P2.lng, 50, 140);
const P4 = m2g(P3.lat, P3.lng, 140, 140);
const P5 = m2g(P4.lat, P4.lng, 400, 140);
const P6 = m2g(P5.lat, P5.lng, 100, 230);
const HARTA_BUNA = {
  _app: 'RALI2_HARTA', day: 1,
  legs: { D1L1: { boxes: [
    { num: 1, lat: START.lat, lng: START.lng },
    { num: 2, lat: P2.lat, lng: P2.lng },
    { num: 3, lat: P3.lat, lng: P3.lng },
    { num: 4, lat: P4.lat, lng: P4.lng },
    { num: 5, lat: P5.lat, lng: P5.lng },
    { num: 6, lat: P6.lat, lng: P6.lng }
  ] } }
};

console.log('\n═══ Formatul: ce se acceptă ═══');
{
  const v = verificaHarta(HARTA_BUNA, GRUPURI);
  ok('harta bună trece', v.ok, JSON.stringify(v.probleme));
  ok('și ajunge la 6 boxuri cu coordonate', v.rezumat.boxuri === 6, JSON.stringify(v.rezumat));
  ok('cheia „D1L1" se traduce în cheia internă de leg',
     !!v.harta['1|1'] && !!v.harta['1|1'][2], JSON.stringify(Object.keys(v.harta)));
  const v2 = verificaHarta({ ...HARTA_BUNA, legs: { '1|1': HARTA_BUNA.legs.D1L1 } }, GRUPURI);
  ok('și forma „1|1" e acceptată la fel', v2.ok, JSON.stringify(v2.probleme));
  ok('citirea per leg întoarce doar leg-ul cerut',
     Object.keys(hartaPentruLeg(v.harta, '1|1')).length === 6 &&
     hartaPentruLeg(v.harta, '9|9') === null);
}

console.log('\n═══ Formatul: ce se refuză, și cu ce motiv ═══');
{
  const cazuri = [
    ['fișier care nu e hartă', { _app: 'ALTCEVA', legs: {} }, /Nu e o hartă RALI 2/],
    ['JSON fără legs', { _app: 'RALI2_HARTA' }, /nicio secțiune/],
    ['cheie de leg necitibilă', { _app: 'RALI2_HARTA', legs: { 'traseu': { boxes: [] } } }, /Cheie de leg necitibilă/],
    ['leg care nu există în roadbook', { _app: 'RALI2_HARTA', legs: { D2L7: { boxes: [] } } }, /roadbook-ul scanat nu/],
    ['coordonate care nu sunt numere', { _app: 'RALI2_HARTA', legs: { D1L1: { boxes: [
      { num: 1, lat: 'nord', lng: 11.2 }, { num: 2, lat: 45.7, lng: 11.2 }] } } }, /coordonate invalide/],
    ['latitudine imposibilă', { _app: 'RALI2_HARTA', legs: { D1L1: { boxes: [
      { num: 1, lat: 145.7, lng: 11.2 }, { num: 2, lat: 45.7, lng: 11.2 }] } } }, /coordonate invalide/],
    ['box care nu există în plan', { _app: 'RALI2_HARTA', legs: { D1L1: { boxes: [
      { num: 1, lat: 45.78, lng: 11.24 }, { num: 2, lat: 45.781, lng: 11.245 },
      { num: 77, lat: 45.79, lng: 11.25 }] } } }, /nu există în roadbook/],
    ['un singur box cu coordonate', { _app: 'RALI2_HARTA', legs: { D1L1: { boxes: [
      { num: 1, lat: 45.78, lng: 11.24 }] } } }, /prea puțin/]
  ];
  for (const [nume, raw, re] of cazuri) {
    const v = verificaHarta(raw, GRUPURI);
    ok(`refuzat: ${nume}`, !v.ok && v.probleme.some(p => re.test(p)),
       JSON.stringify(v.probleme));
  }
  ok('și nimic nu se salvează dintr-o hartă refuzată',
     verificaHarta({ _app: 'RALI2_HARTA', legs: {} }, GRUPURI).harta === null);
}

console.log('\n═══ Harta de pe ALT traseu se prinde din kilometraj ═══');
{
  // linia dreaptă dintre două boxuri nu poate fi mai lungă decât drumul dintre ele
  const departe = m2g(START.lat, START.lng, 4000, 90);
  const rea = { _app: 'RALI2_HARTA', day: 1, legs: { D1L1: { boxes: [
    { num: 1, lat: START.lat, lng: START.lng },
    { num: 2, lat: departe.lat, lng: departe.lng },
    { num: 3, lat: departe.lat, lng: departe.lng }
  ] } } };
  const v = verificaHarta(rea, GRUPURI);
  ok('coordonate la 4 km pentru un segment de 220 m = refuz',
     !v.ok && v.probleme.some(p => /nu e a acestui traseu/.test(p)), JSON.stringify(v.probleme));
}

// ── lumea de test, cu pozițiile REALE ale plecării ──────────────────────────
function lume(harta) {
  let wall = 0, lat = START.lat, lng = START.lng;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(POLIGON, {}, null, harta), clock, store,
    driver: makeDriverModel(),
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 0, accM: 6 });
  const laPunct = (p, kmh = 16) => {
    lat = p.lat; lng = p.lng; wall += 5000;
    m.onFix({ lat, lng, tMs: wall, speedMs: kmh / 3.6, headingDeg: null, accM: 4 });
  };
  const pas = (metri, hdg) => {
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(lat * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: hdg, accM: 4 });
  };
  const drept = (metri, hdg, pasM = 12) => { for (let d = 0; d < metri; d += pasM) pas(Math.min(pasM, metri - d), hdg); };
  return { m, store, said, laPunct, pas, drept,
           jurnal: t => store.journal.filter(e => e.type === t) };
}

console.log('\n═══ Paznicul de plecare: pornirea în direcția opusă ═══');
{
  // pornire spre NORD, când boxul 2 e la sud-sud-vest (211°) — cazul de pe 03.08, când
  // mașina a plecat în direcția opusă și nimic n-a spus nimic timp de 370 m
  const v = verificaHarta(HARTA_BUNA, GRUPURI);
  const w = lume(hartaPentruLeg(v.harta, '1|1'));
  w.drept(100, 20);
  ok('se anunță că boxul e în spate',
     w.said.some(s => /Direcție greșită\. Boxul 2 e în spatele tău\./.test(s.t)),
     JSON.stringify(w.said.map(s => s.t)));
  ok('și e alarmă de manevră, cu prioritate maximă',
     w.said.some(s => /Boxul 2 e în spatele tău/.test(s.t) && s.p === 4 && s.cls === 'manevra'));
  ok('cu cifrele în jurnal, nu doar cu vorbe',
     w.jurnal('directie_start_harta').length === 1 &&
     w.jurnal('directie_start_harta')[0].difGrd > 100,
     JSON.stringify(w.jurnal('directie_start_harta')));
  ok('și pe ecran, ca banner', !!w.m.M.dirAlerta, JSON.stringify(w.m.M.dirAlerta));
}

console.log('\n═══ …dar plecarea REALĂ de azi era corectă — și paznicul tace ═══');
{
  // Pozițiile de mai jos păstrează exact traseul din jurnal (18:00:45-18:01:29), cu
  // longitudinea deplasată: primii 205 m s-au condus pe azimut 210-213°, adică fix spre
  // boxul 2. Paznicul de plecare NU avea ce
  // prinde — greșeala a fost ABIA la bifurcație, la 220 m. E important de știut: cererea
  // „verifică direcția de start" n-ar fi salvat tura asta.
  const REALE = [
    { lat: 45.782213, lng: 11.245942 }, { lat: 45.782012, lng: 11.245707 },
    { lat: 45.781821, lng: 11.245541 }, { lat: 45.781647, lng: 11.245407 },
    { lat: 45.781449, lng: 11.245266 }, { lat: 45.781260, lng: 11.245149 },
    { lat: 45.781111, lng: 11.245027 }, { lat: 45.780936, lng: 11.244878 }
  ];
  const v = verificaHarta(HARTA_BUNA, GRUPURI);
  const w = lume(hartaPentruLeg(v.harta, '1|1'));
  for (const p of REALE) w.laPunct(p);
  ok('nicio alarmă de direcție la plecare — drumul era bun',
     !w.said.some(s => /Direcție greșită/.test(s.t)), JSON.stringify(w.said.map(s => s.t)));
  ok('verificarea chiar s-a făcut (nu a tăcut din lipsă de date)',
     w.jurnal('directie_start_harta').length === 1 &&
     w.jurnal('directie_start_harta')[0].difGrd < 20,
     JSON.stringify(w.jurnal('directie_start_harta')));
}

console.log('\n═══ Ce PRINDE greșeala de azi: linia dreaptă vs. drumul rămas ═══');
{
  // După bifurcație, mașina a luat-o spre vest-nord-vest, cu 47-51 km/h (măsurat
  // 18:01:41-18:01:59). Boxurile 3 și 4 sunt la sud-est. Linia dreaptă până la boxul
  // următor nu poate fi mai lungă decât drumul rămas până la el — iar aici devine.
  const v = verificaHarta(HARTA_BUNA, GRUPURI);
  const w = lume(hartaPentruLeg(v.harta, '1|1'));
  w.drept(210, 211);                    // până la bifurcație, ca în teren
  ok('până aici totul e în regulă', !w.m.M.offRoute, JSON.stringify(w.m.M.offRoute));
  w.drept(300, 295);                    // ramura greșită, spre vest-nord-vest
  ok('măsurătoarea se face imediat și intră în jurnal cu cifrele ei',
     w.jurnal('harta_off').length >= 1 && w.jurnal('harta_off')[0].depasireM > 200,
     JSON.stringify(w.jurnal('harta_off')[0]));
  // …dar SINGUR nu declară nimic: ancorele geocodate sunt centre de stradă, iar pe
  // 04.08 la 21:48 un asemenea semn a produs o alarmă falsă pe traseu corect, în 27 de
  // secunde de la start. Trebuie un al doilea semn, ca la orice semn nedecisiv.
  ok('un semn de hartă SINGUR nu mai declară ieșirea de pe traseu',
     !w.m.M.offRoute && w.jurnal('offroute_intrare').length === 0,
     JSON.stringify(w.jurnal('offroute_semn')));
  w.drept(400, 295);                    // mai departe pe drumul greșit: boxurile rămân în urmă
  ok('semnul din hartă apare după ce se adună destule fixuri',
     w.jurnal('offroute_semn').some(s => s.tip === 'mai_departe_decat_drumul'),
     JSON.stringify(w.jurnal('offroute_semn')));
  ok('și, cu al doilea semn (box de manevră depășit fără viraj), se declară',
     !!w.m.M.offRoute && w.jurnal('offroute_semn').length >= 2,
     JSON.stringify(w.jurnal('offroute_semn')));
  ok('și nu se mai dictează niciun viraj de pe traseul părăsit',
     !w.said.some(s => /dreapta acum|stânga acum/.test(s.t) &&
                       w.said.indexOf(s) > w.said.findIndex(x => /Ai ieșit de pe traseu/.test(x.t))),
     JSON.stringify(w.said.map(s => s.t)));
}

console.log('\n═══ Ținta de reintrare vine din hartă, nu din firimituri ═══');
{
  const v = verificaHarta(HARTA_BUNA, GRUPURI);
  const w = lume(hartaPentruLeg(v.harta, '1|1'));
  w.drept(210, 211);
  w.drept(700, 295);
  const o = w.m.M.offRoute;
  ok('punctul de reintrare e o coordonată de pe hartă',
     !!o && o.pct && o.pct.sursa === 'harta', JSON.stringify(o));
  ok('și e boxul următor de pe traseu, nu unul deja depășit',
     !!o && o.boxNum >= 2 && o.boxNum <= 4, JSON.stringify(o));
  ok('distanța până la el e cea reală, în linie dreaptă',
     !!o && o.distM > 200 && o.distM < 900, JSON.stringify(o));
}

console.log('\n═══ Fără hartă, totul se poartă exact ca înainte ═══');
{
  const w = lume(null);
  w.drept(100, 20);            // pornire în direcția opusă, dar fără hartă
  ok('niciun paznic de plecare (n-are cu ce compara)',
     !w.said.some(s => /Direcție greșită/.test(s.t)) &&
     w.jurnal('directie_start_harta').length === 0, JSON.stringify(w.said.map(s => s.t)));
  w.drept(600, 295);
  ok('și nicio declarare din geometrie',
     w.jurnal('harta_off').length === 0, JSON.stringify(w.jurnal('harta_off')));
}

console.log('\n═══ Plasa de siguranță: harta de la ALT eveniment nu intră în plan ═══');
{
  // Cheia de leg e aproape mereu „1|1", deci coordonatele rămase în telefon de la
  // evenimentul trecut se potrivesc perfect ca FORMĂ peste roadbook-ul de azi. Singurul
  // lucru care le desparte e kilometrajul: linia dreaptă dintre două boxuri nu poate fi
  // mai lungă decât drumul dintre ele.
  const v = verificaHarta(HARTA_BUNA, GRUPURI);
  const buna = hartaPentruLeg(v.harta, '1|1');
  ok('harta traseului de azi trece verificarea',
     coerentaHarta(buna, POLIGON).ok, JSON.stringify(coerentaHarta(buna, POLIGON).probleme));

  // O hartă de la alt eveniment are ALTE distanțe între boxuri decât kilometrajul de
  // azi: aici, aceleași numere de box, dar spațiate de patru ori mai larg.
  const alta = {};
  const b0 = buna[1];
  for (const [num, p] of Object.entries(buna))
    alta[num] = { lat: b0.lat + (p.lat - b0.lat) * 4, lng: b0.lng + (p.lng - b0.lng) * 4 };
  ok('harta cu alte distanțe între boxuri NU trece', !coerentaHarta(alta, POLIGON).ok);
  ok('și motivul e în cifre, nu „hartă invalidă"',
     /roadbook-ul are \d+ m/.test(coerentaHarta(alta, POLIGON).probleme[0]),
     coerentaHarta(alta, POLIGON).probleme[0]);

  // CE NU PRINDE VERIFICAREA, spus pe față: o hartă mutată în bloc (aceleași distanțe
  // între boxuri, alt loc pe glob) e coerentă cu kilometrajul și trece. De-aia plasa
  // asta e a doua linie de apărare, nu prima — prima e ștergerea hărții la scanare
  // nouă și la ștergerea roadbook-ului.
  const mutata = {};
  for (const [num, p] of Object.entries(buna)) mutata[num] = { lat: p.lat + 0.36, lng: p.lng + 0.12 };
  ok('o hartă mutată în bloc trece — limita verificării, cunoscută',
     coerentaHarta(mutata, POLIGON).ok);

  // planul construit cu ea nu primește coordonate deloc — asta e ce contează în cursă:
  // fără hartă se cade pe kilometraj, cu hartă greșită s-ar conduce în direcția greșită
  const w = lume(null);
  ok('fără hartă în plan, nu există paznic de plecare pe coordonate',
     w.jurnal('directie_start_harta').length === 0);
}

console.log('\n═══ Un box fără număr nu poate primi coordonate ═══');
{
  // sanitizeBoxes lasă num:null pe rândurile pe care scanarea nu le-a putut numerota;
  // dacă ar intra în hartă, toate ar sta sub aceeași cheie „null"
  const cuNull = sanitizeBoxes([
    { day: 1, leg: 1, num: null, sumKm: 0.10, dir: 'DREAPTA', comment: 'rând fără număr' },
    { day: 1, leg: 1, num: 2, sumKm: 0.22, dir: 'STÂNGA', comment: 'Stânga' }
  ]);
  const g = groupByLeg(cuNull);
  const v = verificaHarta({ _app: 'RALI2_HARTA', legs: { D1L1: { boxes: [
    { num: null, lat: 45.78, lng: 11.24 }, { num: 2, lat: 45.781, lng: 11.241 }
  ] } } }, g);
  ok('boxul fără număr e refuzat cu motiv, nu tăcut',
     !v.ok && v.probleme.some(p => /număr invalid/.test(p)), JSON.stringify(v.probleme));
}

// ── TURA DE LA 21:48, traseu Marte-Gramma: fixtura pentru alarma falsa si pentru
// alegerea punctului de reintrare. Pozitiile sunt cele din jurnal, cu longitudinea
// deplasata cu -10; roadbook-ul e cel scanat, fara flag-ul fantoma de la boxul 1.
const MARTE = sanitizeBoxes([
  { day: 1, leg: 1, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START · TC 1' },
  { day: 1, leg: 1, num: 2, sumKm: 0.20, dir: 'STÂNGA', comment: 'Stânga pe Str. Fervența' },
  { day: 1, leg: 1, num: 3, sumKm: 0.36, dir: 'DREAPTA', comment: 'Dreapta pe Str. Quasar' },
  { day: 1, leg: 1, num: 4, sumKm: 0.40, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 30 km/h' },
  { day: 1, leg: 1, num: 5, sumKm: 0.71, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' }
]);
// Pozițiile sunt cele din jurnal (21:48:18-21:48:58), cu longitudinea deplasată cu −10.
const TRASEU_REAL = [
  { lat: 45.784869, lng: 11.245902 }, { lat: 45.785092, lng: 11.246081 },
  { lat: 45.785427, lng: 11.246331 }, { lat: 45.785700, lng: 11.246519 },
  { lat: 45.785863, lng: 11.246646 }, { lat: 45.786141, lng: 11.246930 },
  { lat: 45.786422, lng: 11.247151 }, { lat: 45.786710, lng: 11.247265 }
];
// Ancora boxului 3, reconstruită din cifrele aplicației: 512 m pe azimut 12° față de
// poziția de la 21:48:32 — adică mijlocul străzii, cu ~245 m dincolo de box.
const ancora3 = m2g(45.78567, 11.246480, 512, 12);

const lumeMarte = (incM) => {
  let wall = 0, lat = TRASEU_REAL[0].lat, lng = TRASEU_REAL[0].lng;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const harta = { 3: { lat: ancora3.lat, lng: ancora3.lng, incM } };
  const m = makeMachine({ plan: buildPlan(MARTE, {}, null, harta), clock, store,
    driver: makeDriverModel(),
    voice: { say: (t, p, c, cl) => said.push({ t, p, c, cl }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 28, accM: 15 });
  // se merge PE traseul real, fix cu fix, cu pași mici între pozițiile logate ca să
  // existe destule fixuri pentru trend (în teren GPS-ul bătea la ~1 s)
  for (let i = 1; i < TRASEU_REAL.length; i++) {
    const a = TRASEU_REAL[i - 1], b = TRASEU_REAL[i];
    for (let k = 1; k <= 5; k++) {
      lat = a.lat + (b.lat - a.lat) * k / 5;
      lng = a.lng + (b.lng - a.lng) * k / 5;
      wall += 1200;
      m.onFix({ lat, lng, tMs: wall, speedMs: 6, headingDeg: 28, accM: 4 });
    }
  }
  // mers mai departe pe aceeasi directie, pentru reevaluarea tintei
  const mergiInainte = (metri, pasM = 12) => {
    for (let d = 0; d < metri; d += pasM) {
      const r = 28 * Math.PI / 180;
      lat += (pasM * Math.cos(r)) / 111320;
      lng += (pasM * Math.sin(r)) / (111320 * Math.cos(lat * Math.PI / 180));
      wall += 2000;
      m.onFix({ lat, lng, tMs: wall, speedMs: 6, headingDeg: 28, accM: 4 });
    }
  };
  return { m, store, said, mergiInainte, jurnal: t => store.journal.filter(e => e.type === t) };
};


console.log('\n═══ ALARMA FALSĂ din 21:48 — pe aceleași date, nu se mai declanșează ═══');
{
  // Tura de la 21:48:17, traseu Marte–Gramma. Andreas conducea CORECT, iar aplicația a
  // declarat ieșirea de pe traseu în 27 de secunde de la start. Din jurnal:
  //   21:48:31  directie_start_harta difGrd 16  (mergea SPRE boxul 3)
  //   21:48:32  harta_off box 3: dreaptaM 512, drumM 268, depasireM 243
  //   …13 fixuri: dreaptaM 512→455, SCADE la fiecare, depasireM rămâne ~245
  //   21:48:44  offroute_intrare cu UN SINGUR semn
  // Cauza: ancora geocodată a Str. Quasar e MIJLOCUL străzii, la ~245 m de colțul unde
  // e boxul. Eroarea ancorei a fost citită ca abatere de traseu.
  const w = lumeMarte(300);        // ancoră geocodată: incertitudine implicită
  ok('niciun semn de ieșire de pe traseu pe secvența reală',
     w.jurnal('offroute_semn').length === 0, JSON.stringify(w.jurnal('offroute_semn')));
  ok('și nicio declarare — Andreas conducea corect',
     !w.m.M.offRoute && w.jurnal('offroute_intrare').length === 0,
     JSON.stringify(w.jurnal('offroute_intrare')));
  ok('incertitudinea ancorei acoperă singură eroarea de 245 m',
     w.jurnal('harta_off').length === 0, JSON.stringify(w.jurnal('harta_off')));
  ok('nici pilotului nu i se spune nimic despre traseu',
     !w.said.some(s => /ieșit de pe traseu/.test(s.t)), JSON.stringify(w.said.map(s => s.t)));

  // …și dacă ancora ar fi fost declarată precisă (hartă din rutare, incertitudine mică),
  // vetourile trebuie să taie singure alarma: mașina SE APROPIE și merge SPRE box.
  const w2 = lumeMarte(40);
  ok('cu ancoră „precisă", măsurătoarea se face și se scrie în jurnal',
     w2.jurnal('harta_off').length >= 1, JSON.stringify(w2.jurnal('harta_off')[0]));
  ok('dar vetoul „mă apropii / merg spre el" oprește semnul',
     w2.jurnal('harta_off').every(e => e.seApropie || e.spreBox || !e.destuleFixuri) &&
     !w2.jurnal('offroute_semn').some(s => s.tip === 'mai_departe_decat_drumul'),
     JSON.stringify({ off: w2.jurnal('harta_off').slice(-1), semne: w2.jurnal('offroute_semn') }));
  ok('deci tot nicio alarmă falsă', !w2.m.M.offRoute);
  // dovada că distanța chiar scădea, ca în teren (512 → 455 m)
  const d = w2.jurnal('harta_off').map(e => e.dreaptaM);
  ok('distanța până la ancoră scade, exact ca în jurnal',
     d.length >= 2 && d[d.length - 1] < d[0], JSON.stringify([d[0], d[d.length - 1]]));
}

console.log('\n═══ Punctul de reintrare: ÎN FAȚĂ, nu în spate ═══');
{
  // 21:48:44, din jurnal: offroute_intrare boxNum 2 — un box pe care mașina tocmai îl
  // trecuse — apoi „Boxul 2 la 80 de metri, în spate", „…190 de metri, în spate",
  // „…310 de metri, în spate", în timp ce Andreas mergea înainte pe traseul corect.
  // Un pilot care a greșit o intersecție vrea să prindă traseul din față.
  const w = lumeMarte(300);
  w.m.offRouteManual();
  const o = w.m.M.offRoute;
  ok('ținta nu mai e boxul din spate', !!o && o.boxNum !== 2, JSON.stringify(o));
  ok('ci un box din fața direcției de mers', !!o && o.inFata === true && o.boxNum >= 3,
     JSON.stringify({ boxNum: o && o.boxNum, inFata: o && o.inFata }));
  ok('și vocea spune „prinde traseul", nu „întoarcere"',
     w.said.some(s => /Prinde traseul la boxul \d+\./.test(s.t)) &&
     !w.said.some(s => /Te întorc/.test(s.t)),
     JSON.stringify(w.said.filter(s => /traseu/.test(s.t)).map(s => s.t)));
  ok('jurnalul ține minte că ținta era în față',
     w.jurnal('offroute_intrare')[0].inFata === true,
     JSON.stringify(w.jurnal('offroute_intrare')));
}

console.log('\n═══ …dar înapoi TE TRIMIT, dacă altfel ratezi proba ═══');
{
  // Aceleași date, dar mașina a trecut deja de linia de start a probei fără ca proba să
  // fi pornit. Aia nu se mai poate recupera mergând înainte.
  const w = lumeMarte(300);
  w.m.M.routeKm = 0.55;                     // dincolo de startul RT 1 (0,40), fără probă pornită
  w.m.offRouteManual();
  const o = w.m.M.offRoute;
  ok('ținta devine linia de start a probei', !!o && o.motivIntoarcere === 'RT1',
     JSON.stringify(o));
  ok('și pilotului i se spune DE CE se întoarce',
     w.said.some(s => /Te întorc la boxul \d+ — altfel ratezi RT1\./.test(s.t)),
     JSON.stringify(w.said.filter(s => /traseu|întorc/.test(s.t)).map(s => s.t)));
}

console.log('\n═══ Ținta alunecă înainte cât timp pilotul merge înainte ═══');
{
  const w = lumeMarte(300);
  w.m.offRouteManual();
  const primul = w.m.M.offRoute.boxNum;
  w.mergiInainte(500);                      // continuă pe traseu, peste 15 s de reevaluare
  const acum = w.m.M.offRoute && w.m.M.offRoute.boxNum;
  ok('punctul de reintrare s-a mutat pe un box de mai încolo',
     acum == null || acum >= primul, JSON.stringify({ primul, acum }));
  ok('reevaluarea e scrisă în jurnal, cu ambele boxuri',
     w.jurnal('offroute_tinta_noua').length === 0 ||
     w.jurnal('offroute_tinta_noua').every(e => e.laBox >= e.deLaBox),
     JSON.stringify(w.jurnal('offroute_tinta_noua')));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
