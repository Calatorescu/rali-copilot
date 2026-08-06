// RALI 2 — SĂGEATA SPRE WISCONSIN. Testul de acceptare al zilei de 06.08.2026, scris ca
// INVERSUL a ce s-a întâmplat în mașină.
//
// CE S-A ÎNTÂMPLAT, măsurat din `rali-jurnale/jurnale/2026-08-06.json`:
//  1. roadbook-ul (18 boxuri) avea reperul „DJ 691" pe 11 boxuri (5, 6, 8, 9, 10, 11,
//     12, 13, 14, 15, 16);
//  2. geocodarea a rulat cu `localitate: null` — evenimentul spune
//     {cerute:18, gasite:16, pastrate:11, aruncate:[7,4,3,2,1]};
//  3. serviciul a răspuns pentru „DJ 691" cu 43.4038088 / −88.6937664 — Juneau,
//     Wisconsin, SUA — și acel UNIC punct a ajuns pe toate cele 11 boxuri;
//  4. filtrul de kilometraj a păstrat cele 11 puncte GREȘITE și a aruncat cele 5
//     CORECTE, fiindcă cele 11 sunt identice între ele, se potrivesc perfect unele cu
//     altele și formează majoritatea. ĂSTA E DEFECTUL DE FOND: filtrul confunda
//     ACORDUL cu ADEVĂRUL;
//  5. în mașină, la 40 de secunde de la start: „Nu ești pe traseu. Boxul 5 e la 7933
//     virgulă 1 kilometri, la stânga." Apoi, la 08:23:23: „103 virgulă 3 în urmă, ține 4557."
//
// ── DE UNDE VIN CIFRELE DIN FIXTURĂ (citește înainte de a le schimba) ───────────────
// Reale, copiate din jurnal: `num`, `sumKm`, `reper` (toate cele 18 boxuri), coordonata
// din Wisconsin, și distanțele măsurate ale celor 5 ancore aruncate față de ea:
//     box 1 → 7 933 727 m   box 2 → 7 933 375 m   box 3 → 8 308 148 m
//     box 4 → 7 987 397 m   box 7 → 7 984 984 m
// Jurnalul NU păstrează coordonatele ancorelor aruncate (harta salvează doar ce trece),
// deci ele se RECONSTRUIESC aici din singurul lucru măsurat: distanța de mai sus. Fiecare
// e așezată pe linia dintre Wisconsin și zona de start, adică EXACT la distanța din
// jurnal și cât mai aproape cu putință de traseu — reconstrucția cea mai favorabilă
// păstrării ei. Dacă poarta o aruncă și așa, o aruncă sigur și în realitate.
//
// CE SPUN CIFRELE ASTEA, și e diferit de ce credeam la început: mașina era, în același
// moment, la 7 933 171 m de punctul din Wisconsin (`offroute_intrare`, distM). Deci
// boxurile 1 și 2 erau la 556 m și 204 m de mașină — ancore CORECTE, în zona de start.
// Dar boxurile 3, 4 și 7 erau la cel puțin 374 977 m, 54 226 m și 51 813 m de ea — adică
// 375 km, 54 km și 52 km. NU erau ancore corecte: fără localitate, „Str. Mihai Eminescu"
// și „Str. József Attila" au nimerit în alte localități. Testul cere deci ce e adevărat:
// se păstrează boxurile 1 și 2, se aruncă 3, 4, 7 — dar din motivul CORECT (sunt departe
// de traseu), nu fiindcă le-a votat afară o majoritate de copii ale aceleiași greșeli.
//
// NICIO POZIȚIE REALĂ A LUI ANDREAS nu intră aici. Ca în toate fixturile proiectului,
// longitudinile sunt deplasate cu −10 grade. Deplasarea e aplicată la TOATE punctele,
// deci fiecare distanță dintre ele rămâne identică la metru (haversine depinde doar de
// diferența de longitudine și de latitudini, iar acelea nu se schimbă).
import { poartaPlauzibilitate, verificaAncore, grupeazaIdentice, nrPuncteDistincte,
         reperEDoarDrum, repereBoxuri, GRUP_IDENTIC_M, PLAUZ_GPS_KM,
         PLAUZ_MARJA_LEG_KM } from '../js/repere.js';
import { coerentaHarta, buildPlan, sanitizeBoxes, reperCurat } from '../js/route.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { haversineM } from '../js/geo.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));
const aici = dirname(fileURLToPath(import.meta.url));

// ── FIXTURA REALĂ: plan_raw din 2026-08-06, leg 1|1 ─────────────────────────
// num, sumKm, reper — exact din jurnal. Comentariile sunt scurtate la ce contează.
const RB_0608 = [
  { num: 1,  sumKm: 0.00, reper: 'Str. Gramma' },
  { num: 2,  sumKm: 0.27, reper: 'Str. Gramma II' },
  { num: 3,  sumKm: 0.46, reper: 'Str. Mihai Eminescu' },
  { num: 4,  sumKm: 1.51, reper: 'Str. József Attila' },
  { num: 5,  sumKm: 1.70, reper: 'DJ 691' },
  { num: 6,  sumKm: 2.05, reper: 'DJ 691' },
  { num: 7,  sumKm: 2.12, reper: 'Str. Bartók Béla' },
  { num: 8,  sumKm: 2.93, reper: 'DJ 691' },
  { num: 9,  sumKm: 4.28, reper: 'DJ 691' },
  { num: 10, sumKm: 5.13, reper: 'DJ 691' },
  { num: 11, sumKm: 5.99, reper: 'DJ 691' },
  { num: 12, sumKm: 6.57, reper: 'DJ 691' },
  { num: 13, sumKm: 7.30, reper: 'DJ 691' },
  { num: 14, sumKm: 8.08, reper: 'DJ 691' },
  { num: 15, sumKm: 8.86, reper: 'DJ 691' },
  { num: 16, sumKm: 9.30, reper: 'DJ 691' },
  { num: 17, sumKm: 9.40, reper: 'A1 Lugoj - Deva' },
  { num: 18, sumKm: 10.06, reper: 'A1 Lugoj - Deva' }
];
const LEG_KM_0608 = 10.06;

// Punctul întors de serviciu pentru „DJ 691" — Juneau, Wisconsin. Longitudinea deplasată
// cu −10 ca peste tot în fixturi; distanțele rămân cele reale.
const WI = { lat: 43.4038088, lng: -98.6937664 };
// Zona de start. Latitudinea e cea a comunei, longitudinea deplasată cu −10. Verificarea
// că reperul e bun: distanța până la WI iese 7 933 255 m, la 84 m de cei 7 933 171 m
// măsurați în jurnal între mașină și ancora din Wisconsin.
const START = { lat: 45.7947, lng: 11.2408 };

// distanțele MĂSURATE (jurnal) ale celor 5 ancore aruncate, față de punctul din Wisconsin
const DIST_LA_WI = { 1: 7933727, 2: 7933375, 3: 8308148, 4: 7987397, 7: 7984984 };

// punctul aflat la `dM` metri de A, pe cercul mare care duce spre B
const R_E = 6371000, RAD = Math.PI / 180, DEG = 180 / Math.PI;
function peLinie(A, B, dM) {
  const y = Math.sin((B.lng - A.lng) * RAD) * Math.cos(B.lat * RAD);
  const x = Math.cos(A.lat * RAD) * Math.sin(B.lat * RAD) -
            Math.sin(A.lat * RAD) * Math.cos(B.lat * RAD) * Math.cos((B.lng - A.lng) * RAD);
  const brg = Math.atan2(y, x), d = dM / R_E, la1 = A.lat * RAD, lo1 = A.lng * RAD;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg));
  const lo2 = lo1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la1),
                               Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: la2 * DEG, lng: lo2 * DEG };
}

// Cele 16 ancore care au ieșit REAL din geocodare pe 06.08 (11 identice + 5 reconstruite).
function ancore0608() {
  const a = [];
  for (const [num, d] of Object.entries(DIST_LA_WI)) {
    const b = RB_0608.find(x => x.num === +num);
    a.push({ num: +num, sumKm: b.sumKm, reper: b.reper, incM: 300, ...peLinie(WI, START, d) });
  }
  for (const b of RB_0608.filter(x => x.reper === 'DJ 691'))
    a.push({ num: b.num, sumKm: b.sumKm, reper: b.reper, incM: 40, lat: WI.lat, lng: WI.lng });
  return a.sort((x, y) => x.sumKm - y.sumKm);
}

console.log('\n═══ Fixtura reproduce cifrele din jurnal ═══');
{
  const a = ancore0608();
  ok('cele 16 ancore geocodate sunt toate acolo (jurnal: gasite 16)', a.length === 16, String(a.length));
  ok('11 dintre ele au exact același punct (jurnal: pastrate 11)',
     a.filter(x => x.lat === WI.lat && x.lng === WI.lng).length === 11);
  const d = Math.round(haversineM(START.lat, START.lng, WI.lat, WI.lng));
  ok('zona de start e la 7 933 km de punctul din Wisconsin, ca în jurnal (±1 km)',
     Math.abs(d - 7933171) < 1000, `${d} m, jurnalul are 7933171 m`);
  for (const [num, dist] of Object.entries(DIST_LA_WI)) {
    const x = a.find(y => y.num === +num);
    ok(`ancora boxului ${num} e reconstruită exact la distanța din jurnal (${dist} m)`,
       Math.abs(haversineM(x.lat, x.lng, WI.lat, WI.lng) - dist) < 5);
  }
  // și consecința care schimbă interpretarea zilei
  const dep = n => Math.round(haversineM(a.find(y => y.num === n).lat,
                                         a.find(y => y.num === n).lng, START.lat, START.lng));
  ok('boxurile 1 și 2 sunt ancore CORECTE — sub 1 km de zona de start',
     dep(1) < 1000 && dep(2) < 1000, `box1 ${dep(1)} m, box2 ${dep(2)} m`);
  ok('boxurile 3, 4 și 7 NU erau corecte: 375 km, 54 km și 52 km de start',
     dep(3) > 300000 && dep(4) > 50000 && dep(7) > 50000,
     `box3 ${dep(3)} m, box4 ${dep(4)} m, box7 ${dep(7)} m`);
}

console.log('\n═══ 0. CAUZA DIN AMONTE: promptul cerea chiar reperul otrăvitor ═══');
{
  // `ROADBOOK_PROMPT` dădea „DJ691" ca EXEMPLU BUN de reper. De-acolo au venit cele 11
  // boxuri cu „DJ 691" (06.08) și cele 45 cu „DJ 582"/„DN 58" (05.08, Reșița).
  const scan = readFileSync(join(aici, '..', 'js', 'scan.js'), 'utf8');
  const p = (scan.match(/REPER \(câmpul "reper"\)[\s\S]*?\nDOAR JSON/) || [''])[0];
  ok('★ „DJ691" nu mai e dat ca exemplu de reper BUN',
     !/(nume de stradă|obiectiv)[^\n]*„DJ ?691"/.test(p), p.slice(0, 200));
  ok('★ promptul spune explicit că un număr de drum singur NU e reper',
     /NUMĂR DE DRUM SINGUR NU E REPER/.test(p));
  ok('și dă motivul: e o linie, nu un punct, și poate nimeri pe alt continent',
     /linie de zeci de kilometri, nu un punct/.test(p) && /alt continent/.test(p));
  ok('și arată forma acceptabilă — numărul lipit de un nume de loc',
     /DJ 691 la Bartók Béla/.test(p) && /DN 68A la Făget/.test(p));
  ok('și cere null când boxul n-are un loc distinctiv, nu o umplutură',
     /nu o umplutură/.test(p) && /DISTINCTIV/.test(p));
  ok('„drum numerotat" nu mai e listat printre lucrurile de scris ca reper',
     !/nume de stradă, drum numerotat/.test(p), p.slice(0, 160));
}

console.log('\n═══ 0b. Sita: promptul cere, codul garantează ═══');
{
  ok('„DJ 691" se golește la sanitizare', reperCurat('DJ 691') === null);
  ok('„DN 58B" la fel', reperCurat('DN 58B') === null);
  ok('„DJ 582E" la fel', reperCurat('DJ 582E') === null);
  ok('„A1" și „E70" la fel', reperCurat('A1') === null && reperCurat('E70') === null);
  ok('„DC 145" la fel', reperCurat('DC 145') === null);
  ok('și combinația de două drumuri, „DJ582/DN6"', reperCurat('DJ582/DN6') === null);
  // ce NU are voie să se piardă
  ok('„DJ 691 la Bartók Béla" rămâne întreg — numele arată punctul',
     reperCurat('DJ 691 la Bartók Béla') === 'DJ 691 la Bartók Béla');
  ok('„Str. Petőfi Sándor / DJ 691" rămâne întreg',
     reperCurat('Str. Petőfi Sándor / DJ 691') === 'Str. Petőfi Sándor / DJ 691');
  ok('„Casa Gotschna" rămâne', reperCurat('Casa Gotschna') === 'Casa Gotschna');
  ok('„Piața 1 Decembrie 1918" rămâne',
     reperCurat('Piața 1 Decembrie 1918') === 'Piața 1 Decembrie 1918');
  ok('un cod care NU e de drum („B12") nu e atins — sita nu inventează reguli',
     reperCurat('B12') === 'B12');
  ok('gol / lipsă rămâne null', reperCurat('') === null && reperCurat(null) === null);

  // pe datele REALE de la Reșița (2026-08-05, plan_raw, 120 de boxuri)
  const cale = 'C:/Users/CLTCLD/rali-jurnale/jurnale/2026-08-05.json';
  let plan = null;
  try { plan = JSON.parse(readFileSync(cale, 'utf8')).plan_raw; } catch (e) {}
  if (!plan) {
    console.log('  … jurnalul de la Reșița nu e la îndemână, secțiunea se sare');
  } else {
    const boxes = sanitizeBoxes(plan);
    const inainte = plan.filter(b => b.reper).length;
    const dupa = boxes.filter(b => b.reper).length;
    ok('★ Reșița: 69 de repere înainte de sită', inainte === 69, String(inainte));
    ok('★ după sită rămân 24 — cele 45 de numere de drum sunt golite',
       dupa === 24 && inainte - dupa === 45, `${dupa} rămase, ${inainte - dupa} golite`);
    const golite = new Set();
    for (const b of plan) {
      const s = boxes.find(x => x.num === b.num);
      if (b.reper && s && !s.reper) golite.add(b.reper);
    }
    ok('★ și golite sunt EXACT cele patru numere de drum, nimic altceva',
       [...golite].sort().join('|') === 'DJ 582|DJ 582E|DN 58|DN 58B',
       [...golite].sort().join('|'));
    const ramase = boxes.filter(b => b.reper).map(b => b.reper);
    ok('★ reperele cu nume de loc trec neatinse',
       ramase.includes('Piața 1 Decembrie 1918') && ramase.includes('Casa Gotschna') &&
       ramase.includes('Biroul Vamal Reșița'), JSON.stringify([...new Set(ramase)].slice(0, 5)));
    ok('și niciun reper rămas nu mai e un simplu număr de drum',
       ramase.every(r => reperCurat(r) === r));
  }

  // și pe roadbook-ul de la Dumbrăvița (06.08): cele 11 „DJ 691" dispar din sursă
  const b0608 = sanitizeBoxes(RB_0608.map(b => ({ ...b, dir: 'ÎNAINTE', comment: '' })));
  const cuReper = b0608.filter(b => b.reper).map(b => b.num);
  ok('★ Dumbrăvița: niciunul dintre cele 11 „DJ 691" nu mai ajunge în plan',
     ![5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16].some(n => cuReper.includes(n)),
     JSON.stringify(cuReper));
  ok('★ din 18 repere rămân 7 după sită', cuReper.length === 7, JSON.stringify(cuReper));
  ok('cele cu nume de stradă rămân toate (1, 2, 3, 4, 7)',
     [1, 2, 3, 4, 7].every(n => cuReper.includes(n)), JSON.stringify(cuReper));
  // Boxurile 17 și 18 („A1 Lugoj - Deva") trec de sită — pe bună dreptate, au nume de
  // loc în ele. Sunt oprite abia la geocodare, de regula mai strictă de acolo: o
  // autostradă rămâne o linie, oricâte orașe i-ar fi scrise în coadă. Două plase, nu una.
  ok('„A1 Lugoj - Deva" trece de sită (are nume de loc)…',
     reperCurat('A1 Lugoj - Deva') === 'A1 Lugoj - Deva' && cuReper.includes(17));
  ok('…dar e oprit la geocodare, unde regula e mai strictă',
     reperEDoarDrum('A1 Lugoj - Deva'));
}

console.log('\n═══ 1. Reperul care e doar un număr de drum nu se mai întreabă ═══');
{
  ok('„DJ 691" e refuzat — e o linie de zeci de km, nu un punct', reperEDoarDrum('DJ 691'));
  ok('și cu localitatea lipită tot refuzat', reperEDoarDrum('DJ 691, Dumbrăvița', 'Dumbrăvița'));
  ok('„A1 Lugoj - Deva" la fel — o autostradă nu are UN punct', reperEDoarDrum('A1 Lugoj - Deva'));
  ok('„DN 68A" la fel', reperEDoarDrum('DN 68A'));
  // ce NU are voie să cadă în plasă
  ok('„Str. Petőfi Sándor / DJ691" rămâne — strada e cea care dă punctul',
     !reperEDoarDrum('Str. Petőfi Sándor / DJ691'));
  ok('„Calea Dorobanților (DN6)" rămâne', !reperEDoarDrum('Calea Dorobanților (DN6)'));
  ok('„Str. Gramma" rămâne', !reperEDoarDrum('Str. Gramma'));
  ok('„Piața 1 Decembrie 1918" rămâne', !reperEDoarDrum('Piața 1 Decembrie 1918'));
  ok('„Casa Gotschna" rămâne', !reperEDoarDrum('Casa Gotschna'));
  ok('„Bălcescu" (stradă scrisă fără „Str.") rămâne', !reperEDoarDrum('Bălcescu'));

  const sarite = RB_0608.filter(b => reperEDoarDrum(b.reper));
  const cautate = RB_0608.filter(b => !reperEDoarDrum(b.reper));
  ok('pe roadbook-ul zilei: 13 repere din 18 nu mai pleacă deloc spre serviciu',
     sarite.length === 13, String(sarite.length));
  ok('și rămân exact boxurile care aveau nume de stradă: 1, 2, 3, 4, 7',
     cautate.map(b => b.num).join(',') === '1,2,3,4,7', cautate.map(b => b.num).join(','));
  ok('toate cele 11 boxuri cu „DJ 691" sunt printre cele sărite',
     [5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16].every(n => sarite.some(b => b.num === n)));
}

console.log('\n═══ 2. Coordonatele identice nu mai votează ═══');
{
  const a = ancore0608();
  ok('cele 16 ancore înseamnă doar 6 puncte distincte', nrPuncteDistincte(a) === 6,
     String(nrPuncteDistincte(a)));
  const g = grupeazaIdentice(a).find(x => x.length > 1);
  ok('grupul identic are 11 membri', g.length === 11, String(g.length));
  ok('pragul de „același punct" e 50 m', GRUP_IDENTIC_M === 50);

  // regula, izolată: filtrul de kilometraj SINGUR inversează deja rezultatul zilei
  const v = verificaAncore(a);
  ok('filtrul de kilometraj nu mai alege lanțul de 11 copii ale aceleiași greșeli',
     !v.bune.some(x => x.lat === WI.lat), JSON.stringify(v.bune.map(x => x.num)));
  ok('ci lanțul cu mai multe PUNCTE distincte — boxurile 1 și 2',
     v.bune.map(x => x.num).join(',') === '1,2', v.bune.map(x => x.num).join(','));

  // două boxuri în același punct rămân normale (giratoriu luat de două ori)
  const dus = [
    { num: 1, sumKm: 0.0, lat: 45.7900, lng: 11.2400 },
    { num: 2, sumKm: 0.4, lat: 45.7930, lng: 11.2440 },
    { num: 3, sumKm: 0.8, lat: 45.7900, lng: 11.2400 }   // înapoi în același giratoriu
  ];
  const p = poartaPlauzibilitate(dus, { legKm: 0.8 });
  ok('două boxuri în același punct NU sunt suspecte — dus-întorsul e normal',
     p.bune.length === 3 && p.aruncate.length === 0,
     JSON.stringify({ bune: p.bune.map(x => x.num), aruncate: p.aruncate.length }));
}

console.log('\n═══ 3. TESTUL DE ACCEPTARE: inversul zilei de 06.08 ═══');
{
  const a = ancore0608();
  const p = poartaPlauzibilitate(a, { fix: START, legKm: LEG_KM_0608 });
  const bune = p.bune.map(x => x.num);
  const rele = p.aruncate.map(x => x.num).sort((x, y) => x - y);

  ok('★ toate cele 11 ancore din Wisconsin se aruncă',
     [5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16].every(n => rele.includes(n)) &&
     !bune.some(n => [5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(n)),
     JSON.stringify({ bune, rele }));
  ok('★ ancorele corecte (boxurile 1 și 2) se PĂSTREAZĂ — exact inversul zilei',
     bune.includes(1) && bune.includes(2), JSON.stringify(bune));
  ok('★ pe 06.08 se păstrau cele 11 greșite și se aruncau boxurile 1 și 2',
     bune.length === 2 && bune.join(',') === '1,2', JSON.stringify(bune));

  const motiv = n => (p.aruncate.find(x => x.num === n) || {}).motiv || '';
  ok('grupul din Wisconsin cade ca GRUP, cu motivul scris în cifre',
     /11 boxuri .* au primit exact același punct.*7\.6 km/.test(motiv(5)), motiv(5));
  ok('motivul spune pe șleau că e un răspuns copiat, nu 11 confirmări',
     /un singur răspuns copiat, nu 11 confirmări/.test(motiv(5)), motiv(5));
  ok('boxul 3 cade pe poziția GPS — la 375 km de unde ești',
     /375 km de unde ești acum/.test(motiv(3)), motiv(3));
  ok('boxurile 4 și 7 cad pe lungimea legului, nu pe vreo majoritate',
     /de restul traseului, dar tot legul are/.test(motiv(4)) &&
     /de restul traseului, dar tot legul are/.test(motiv(7)), motiv(4) + ' | ' + motiv(7));
  ok('niciun motiv nu mai e „nu se potrivea cu boxul 5" — boxul 5 nu mai judecă pe nimeni',
     !p.aruncate.some(x => /de boxul 5/.test(x.motiv)));

  // și lanțul de kilometraj, care rulează DUPĂ poartă, nu mai are ce strica
  const v = verificaAncore(p.bune);
  ok('filtrul de kilometraj păstrează apoi ambele ancore bune',
     v.bune.map(x => x.num).join(',') === '1,2', JSON.stringify(v.bune.map(x => x.num)));
  ok('și nu mai aruncă nimic', v.aruncate.length === 0, JSON.stringify(v.aruncate));
}

console.log('\n═══ 4. Pragurile sunt scrise dinainte, nu potrivite pe caz ═══');
{
  ok('300 km față de poziția GPS', PLAUZ_GPS_KM === 300);
  ok('marja peste lungimea legului: 5 km', PLAUZ_MARJA_LEG_KM === 5);
  // pragul GPS se aplică DOAR dacă mașina e la raliul ăsta: geocodarea se face acasă, cu
  // o zi înainte, iar pentru un raliu la 450 km de casă toate ancorele bune ar fi peste prag
  const departe = [
    { num: 1, sumKm: 0.0, lat: 44.4300, lng: 16.1000 },
    { num: 2, sumKm: 0.5, lat: 44.4340, lng: 16.1050 },
    { num: 3, sumKm: 1.0, lat: 44.4380, lng: 16.1100 }
  ];
  const p = poartaPlauzibilitate(departe, { fix: START, legKm: 1.0 });
  ok('un raliu la 500 km de casă NU e șters de poarta GPS — altfel harta bună ar dispărea',
     p.bune.length === 3 && p.aruncate.length === 0,
     JSON.stringify({ bune: p.bune.length, aruncate: p.aruncate.map(x => x.motiv) }));
}

console.log('\n═══ 5. O hartă corectă trece neatinsă ═══');
{
  // 6 boxuri pe un traseu real de 6 km, fiecare cu punctul lui — cazul bun de azi
  const bune = [];
  let lat = 45.7900, lng = 11.2400;
  for (let i = 0; i < 6; i++) {
    bune.push({ num: i + 1, sumKm: i * 1.0, lat, lng, incM: 120 });
    lat += 0.0090;                                   // ~1 km spre nord
  }
  const p = poartaPlauzibilitate(bune, { fix: START, legKm: 5.0 });
  ok('nicio ancoră bună nu e aruncată de poartă',
     p.bune.length === 6 && p.aruncate.length === 0,
     JSON.stringify(p.aruncate.map(x => `${x.num}: ${x.motiv}`)));
  const v = verificaAncore(p.bune);
  ok('și filtrul de kilometraj le păstrează pe toate, ca înainte',
     v.bune.length === 6 && v.aruncate.length === 0);
  const pts = {};
  for (const a of p.bune) pts[a.num] = { lat: a.lat, lng: a.lng };
  const c = coerentaHarta(pts, bune.map(b => ({ num: b.num, sumKm: b.sumKm })));
  ok('și verificarea de la încărcare o acceptă', c.ok, JSON.stringify(c.probleme));
  // fără fix GPS trebuie să meargă la fel
  const p2 = poartaPlauzibilitate(bune, { legKm: 5.0 });
  ok('la fel și fără poziție GPS (geocodare fără semnal de GPS)',
     p2.bune.length === 6 && p2.aruncate.length === 0);
}

console.log('\n═══ 6. Harta otrăvită deja salvată în telefon e respinsă la pornire ═══');
{
  // exact conținutul cheii `harta` din jurnalul zilei: 11 boxuri, un singur punct
  const pts = {};
  for (const b of RB_0608.filter(x => x.reper === 'DJ 691'))
    pts[b.num] = { lat: WI.lat, lng: WI.lng, incM: 40 };
  const c = coerentaHarta(pts, RB_0608.map(b => ({ num: b.num, sumKm: b.sumKm })));
  ok('★ harta cu 11 boxuri în același punct e RESPINSĂ la construirea planului',
     !c.ok, JSON.stringify(c.probleme));
  ok('și motivul e citibil de om, cu cifre',
     /au toate exact aceeași coordonată.*7\.6 km/.test(c.probleme[0]), c.probleme[0]);
  ok('spune și că e un răspuns de căutare copiat, nu harta traseului',
     /un singur răspuns de căutare copiat/.test(c.probleme[0]), c.probleme[0]);
  // asta e important: pe 06.08 verificarea asta a trecut harta ca fiind bună
  const vechea = [];
  const nums = Object.keys(pts).map(Number).sort((x, y) => x - y);
  for (let i = 1; i < nums.length; i++) {
    const a = RB_0608.find(b => b.num === nums[i - 1]), b = RB_0608.find(x => x.num === nums[i]);
    vechea.push(haversineM(pts[a.num].lat, pts[a.num].lng, pts[b.num].lat, pts[b.num].lng)
                > Math.abs(b.sumKm - a.sumKm) * 1000 * 1.5 + 200);
  }
  ok('vechea verificare (doar între boxuri vecine) o trecea perfect — de-aia n-a prins-o',
     vechea.every(x => x === false));
}

console.log('\n═══ 7. Reșița (05.08) — ne-regresie pe al doilea caz ═══');
{
  // Din 2026-08-05.json, evenimentul de geocodare al legului 2|2: localitate null,
  // cerute 69, gasite 66, PASTRATE 2. Motivele arată grupuri de coordonate identice:
  // „la 8146369 m de boxul 91" apare pe 30 de boxuri, „la 4087069 m" pe 9, „la 241181 m"
  // pe 6, „la 170896 m" pe 5. Reconstruim grupurile din distanțele alea.
  const GRUPURI = [
    { d: 8146369, boxuri: [107, 75, 74, 73, 72, 71, 70, 69, 68, 66, 55, 54, 53, 52, 51, 50,
                           49, 48, 47, 46, 43, 42, 38, 37, 36, 35, 34, 33, 32, 31, 30] },
    { d: 4087069, boxuri: [65, 64, 63, 62, 60, 59, 58, 57, 56] },
    { d: 241181,  boxuri: [19, 18, 17, 16, 15, 8] },
    { d: 170896,  boxuri: [7, 6, 5, 4, 3] },
    { d: 261801,  boxuri: [27, 26, 25] },
    { d: 259734,  boxuri: [22, 21, 20] },
    { d: 1903051, boxuri: [29, 28] },
    { d: 8421429, boxuri: [13, 12] }
  ];
  // kilometrajul real al boxurilor (din plan_raw, leg 2|2)
  const KM = { 1: 65.95, 3: 65.82, 4: 65.55, 5: 65.43, 6: 65.02, 7: 64.39, 8: 63.75,
               12: 63.01, 13: 62.75, 15: 62.61, 16: 62.56, 17: 62.44, 18: 62.01, 19: 61.41,
               20: 60.91, 21: 60.73, 22: 59.96, 25: 59.24, 26: 59.19, 27: 59.12,
               28: 58.93, 29: 58.81, 30: 58.75, 31: 58.34, 32: 58.03, 33: 57.91, 34: 57.85,
               35: 57.72, 36: 57.66, 37: 57.41, 38: 56.84, 42: 56.00, 43: 55.68, 46: 54.30,
               47: 53.20, 48: 53.00, 49: 52.65, 50: 52.28, 51: 42.55, 52: 36.59, 53: 35.33,
               54: 35.20, 55: 35.06, 56: 27.37, 57: 27.15, 58: 21.18, 59: 20.39, 60: 19.94,
               62: 19.39, 63: 19.00, 64: 18.26, 65: 17.97, 66: 12.00, 68: 9.71, 69: 9.40,
               70: 9.09, 71: 8.89, 72: 8.82, 73: 8.34, 74: 5.41, 75: 4.35, 91: 0, 107: 5.96 };
  const REF = { lat: 45.3000, lng: 11.8900 };        // ancora boxului 91, reper de măsură
  const anc = [{ num: 91, sumKm: KM[91], lat: REF.lat, lng: REF.lng, incM: 300 }];
  for (const g of GRUPURI) {
    const p = peLinie(REF, START, g.d);
    for (const n of g.boxuri)
      if (KM[n] != null) anc.push({ num: n, sumKm: KM[n], lat: p.lat, lng: p.lng, incM: 300 });
  }
  const p = poartaPlauzibilitate(anc, { legKm: 79.72 });
  const ram = p.bune.map(x => x.num);
  ok('grupul mare (31 de boxuri într-un punct, la 8146 km) cade tot',
     !GRUPURI[0].boxuri.some(n => ram.includes(n)),
     JSON.stringify(ram.filter(n => GRUPURI[0].boxuri.includes(n))));
  ok('și grupul de 9 boxuri de la 4087 km cade tot',
     !GRUPURI[1].boxuri.some(n => ram.includes(n)));
  ok('și grupurile de la 1903 km și 8421 km cad și ele',
     !GRUPURI[6].boxuri.some(n => ram.includes(n)) &&
     !GRUPURI[7].boxuri.some(n => ram.includes(n)));
  // Grupurile de 6 și 5 boxuri sunt întinse pe doar 2,34 și 1,43 km de roadbook, deci NU
  // sunt suspecte prin construcție (o stradă poate purta 5 boxuri într-un oraș des). Ele
  // trebuie să cadă — sau nu — pe geometrie, nu pe regula de grup. Ce se cere aici e doar
  // ca rezultatul final să fie coerent, verificat mai jos.
  // ce rămâne trebuie să fie COERENT: nicio pereche la o distanță imposibilă
  let maxM = 0;
  for (const a of p.bune) for (const b of p.bune)
    maxM = Math.max(maxM, haversineM(a.lat, a.lng, b.lat, b.lng));
  ok('ce rămâne e coerent: nicio pereche mai depărtată decât legul + marja',
     maxM <= (79.72 + PLAUZ_MARJA_LEG_KM) * 1000, `${Math.round(maxM)} m`);
  ok('și nu mai rămâne nimic la mii de kilometri', maxM < 300000, `${Math.round(maxM)} m`);
  // ne-regresia care contează cel mai mult: fără localitate nu se mai caută nimic
  const r = repereBoxuri([{ num: 1, sumKm: 0, comment: 'Stânga pe Bd. Revoluția din Decembrie' }]);
  ok('roadbook-ul de la Reșița n-are localitate în text — deci nu se mai caută deloc',
     r.localitate === null, String(r.localitate));
}

console.log('\n═══ 7b. Butonul „Găsește traseul pe hartă", pe roadbook-ul de 06.08 ═══');
{
  // Comentariile REALE ale celor 5 boxuri cu nume de stradă, ca să treacă prin exact
  // același drum de cod ca în telefon: localitate → repere → filtru → geocodare → porți.
  const COM = {
    1: 'Start Leg 1 / Time Control - TC 1 / Str. Gramma',
    2: 'Str. Gramma II',
    3: 'Str. Mihai Eminescu',
    4: 'Str. József Attila',
    5: 'Giarmata / Str. Petőfi Sándor / DJ 691',
    7: 'Start TR 1 / Str. Bartók Béla / DJ 691'
  };
  const boxes = RB_0608.map(b => ({ num: b.num, sumKm: b.sumKm, reper: b.reper,
                                    comment: COM[b.num] || `Reper ${b.reper}` }));
  const r = repereBoxuri(boxes);
  ok('★ roadbook-ul zilei NU conține localitatea în formă de adresă — de-aia a ieșit null',
     r.localitate === null, String(r.localitate));

  // Cu localitatea scrisă de om în câmpul din panou (asta cere acum aplicația):
  const loc = 'Dumbrăvița';
  const repere = r.repere.map(x => ({
    ...x, reper: x.reper && !x.reper.includes(loc) ? `${x.reper}, ${loc}` : x.reper }));
  const deCautat = repere.filter(x => x.reper && !reperEDoarDrum(x.reper, loc));
  ok('★ pleacă spre serviciu 5 cereri, nu 18', deCautat.length === 5, String(deCautat.length));

  // Geocoder mock: răspunde EXACT ce a răspuns serviciul în ziua aia.
  const intrebat = [];
  const geo = { async cauta(q) {
    intrebat.push(q);
    if (/DJ ?691|A1/.test(q)) return { lat: WI.lat, lng: WI.lng, incM: 40 };
    const n = /Gramma II/.test(q) ? 2 : /Gramma/.test(q) ? 1
            : /Eminescu/.test(q) ? 3 : /József/.test(q) ? 4 : /Bartók/.test(q) ? 7 : null;
    return n ? { ...peLinie(WI, START, DIST_LA_WI[n]), incM: 300 } : null;
  } };
  // (geocodeazaRepere e importat indirect prin fluxul de mai jos; aici îl imităm scurt)
  const ancore = [];
  for (const x of deCautat) {
    const p = await geo.cauta(x.reper);
    if (p) ancore.push({ num: x.num, sumKm: x.sumKm, reper: x.reper, ...p });
  }
  ok('★ serviciul nu e întrebat NICIODATĂ despre „DJ 691"',
     !intrebat.some(q => /DJ ?691/.test(q)), JSON.stringify(intrebat));
  ok('★ nici despre autostradă', !intrebat.some(q => /A1/.test(q)), JSON.stringify(intrebat));
  ok('toate cererile poartă localitatea', intrebat.every(q => q.includes(loc)),
     JSON.stringify(intrebat));
  ok('★ niciun punct din Wisconsin nu mai intră în ancore',
     !ancore.some(a => a.lat === WI.lat), String(ancore.length));

  const p = poartaPlauzibilitate(ancore, { fix: START, legKm: LEG_KM_0608 });
  const v = verificaAncore(p.bune);
  ok('★ harta finală are exact boxurile 1 și 2 — cele două ancore adevărate',
     v.bune.map(x => x.num).join(',') === '1,2', v.bune.map(x => x.num).join(','));
  ok('și boxurile 3, 4, 7 sunt aruncate cu motiv scris, nu tăcut',
     [3, 4, 7].every(n => p.aruncate.some(x => x.num === n && x.motiv)),
     JSON.stringify(p.aruncate.map(x => `${x.num}: ${x.motiv}`)));
}

console.log('\n═══ 8. În mașină: nicio cifră imposibilă, nici rostită, nici pe ecran ═══');
{
  // Roadbook-ul zilei, cu harta OTRĂVITĂ deja salvată — adică exact starea telefonului
  // lui Andreas în dimineața de 06.08, înainte de START.
  const boxes = sanitizeBoxes(RB_0608.map(b => ({
    num: b.num, sumKm: b.sumKm, dir: b.num === 5 ? 'DREAPTA' : 'ÎNAINTE',
    comment: `Reper ${b.reper}`, reper: b.reper
  })));
  const harta = {};
  for (const b of RB_0608.filter(x => x.reper === 'DJ 691'))
    harta[b.num] = { lat: WI.lat, lng: WI.lng, incM: 40 };

  let wall = 0, lat = START.lat, lng = START.lng;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(boxes, {}, null, harta), clock, store,
    driver: makeDriverModel(), opts: { offRoute: true },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 45, accM: 6 });
  // 2 km de mers înainte, ca în dimineața aia
  for (let i = 0; i < 160; i++) {
    lat += (12 * Math.cos(45 * RAD)) / 111320;
    lng += (12 * Math.sin(45 * RAD)) / (111320 * Math.cos(START.lat * RAD));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: 12, headingDeg: 45, accM: 6 });
  }

  const texte = said.map(s => s.t);
  const cuKm = texte.filter(t => /kilometri/.test(t));
  // orice cifră de kilometri rostită trebuie să fie sub pragul de imposibil (500 km)
  const cifre = [];
  for (const t of texte) {
    const mm = t.match(/([\d]+)(?: virgulă \d)? kilometri/g) || [];
    for (const x of mm) cifre.push(parseInt(x, 10));
  }
  ok('★ nicio distanță rostită nu trece de 500 km',
     cifre.every(x => x < 500), JSON.stringify({ cifre, cuKm }));
  ok('★ nu se mai rostește „7933" în nicio frază',
     !texte.some(t => /7933|7932/.test(t)), JSON.stringify(texte.filter(t => /79\d\d/.test(t))));
  ok('★ aplicația spune că harta e greșită și trimite la roadbook',
     texte.some(t => /[Hh]arta traseului e greșită.*roadbook/.test(t)),
     JSON.stringify(texte));

  const ev = store.journal;
  ok('★ harta e închisă în jurnal, ca să se știe de ce a tăcut',
     ev.some(e => e && e.type === 'harta_imposibila'),
     JSON.stringify(ev.filter(e => e && /harta/.test(e.type || '')).map(e => e.type)));
  ok('★ și nu mai e folosită ca sursă de poziție pentru boxuri', m.M._hartaStricata === true);

  // „unde sunt?" nu are voie să rostească o cifră imposibilă
  const r = m.undeSunt();
  ok('★ „unde sunt?" nu spune o distanță imposibilă',
     !/79\d\d/.test(r.text) && !/\d{3,} kilometri/.test(r.text), r.text);
}

console.log('\n═══ 9. Ritmul: „ține 4557" nu se mai rostește ═══');
{
  // Probă de 2 km la 40 km/h, condusă foarte încet: timpul disponibil rămas se apropie de
  // zero, iar viteza-țintă calculată explodează. Pe 06.08 s-a auzit „ține 4557".
  const boxes = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START · TC 1' },
    { num: 2, sumKm: 0.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
    { num: 3, sumKm: 2.20, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' }
  ]);
  let wall = 0, lat = START.lat, lng = START.lng;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const said = [];
  const m = makeMachine({ plan: buildPlan(boxes, { '2_200': 40 }, null, null), clock,
    store: makeMemStore(), driver: makeDriverModel(), opts: { offRoute: false },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 0, accM: 6 });
  // 200 m până la start de probă, apoi 400 m foarte încet (rămân 1,6 km și aproape zero timp)
  const pas = (metri, dt = 1000) => {
    lat += metri / 111320; wall += dt;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri / (dt / 1000), headingDeg: 0, accM: 6 });
  };
  for (let i = 0; i < 20; i++) pas(10);
  for (let i = 0; i < 80; i++) pas(5, 4000);          // 400 m în 320 s

  const texte = said.map(s => s.t);
  const tine = [];
  for (const t of texte) { const x = t.match(/ține (\d+)/); if (x) tine.push(+x[1]); }
  ok('s-au rostit fraze de ritm (altfel testul nu demonstrează nimic)',
     texte.some(t => /în urmă|în avans/.test(t)), JSON.stringify(texte.slice(-6)));
  ok('★ nicio viteză-țintă rostită peste 200 km/h', tine.every(x => x <= 200),
     JSON.stringify(tine));
  ok('★ când cifra ar fi absurdă, se spune că ritmul nu se mai poate calcula',
     !tine.some(x => x > 200), JSON.stringify(tine));
  const absurd = texte.filter(t => /ține \d{4,}/.test(t));
  ok('★ „ține 4557" (cifra reală din 06.08) nu mai poate apărea', absurd.length === 0,
     JSON.stringify(absurd));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
