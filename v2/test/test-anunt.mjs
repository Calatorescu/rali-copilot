// RALI 2 — anunțul de corecție nu are voie să calce peste manevra următoare.
//
// 04.08.2026, bucla József, Leg 2: snapul pe boxul 4 a mutat poziția cu −116 m și a
// rostit „Corectat înapoi 116 metri, box 4" — vreo 3 secunde de vorbă într-o buclă în
// care boxurile 2-3-4 sunt la 70-91 m unul de altul (6-8 secunde de mers). Corecția e o
// EXPLICAȚIE pentru ce s-a văzut deja pe ecran; manevra e o decizie de peste câteva
// secunde. Roadbook-ul și vitezele de mai jos sunt cele reale, din jurnalul zilei.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { makeVoice } from '../js/voice.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// roadbook-ul REAL al turei din 04.08 (Leg 1 = Leg 2, identice)
const BUCLA = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START / TC' },
  { num: 2, sumKm: 0.32, dir: 'DREAPTA', comment: 'Dreapta spre Str. József Attila' },
  { num: 3, sumKm: 0.41, dir: 'STÂNGA', comment: 'capătul buclei (91 m)' },
  { num: 4, sumKm: 0.48, dir: 'STÂNGA-T', comment: 'Stânga la T (70 m)' },
  { num: 5, sumKm: 0.84, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 35 km/h' },
  { num: 7, sumKm: 2.74, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' }
]);

// Lume cu busolă: fiecare pas mută mașina cu `metri` pe capul compas dat. Decalajul față
// de roadbook se face conducând mai mult decât scrie oficial — exact zgomotul măsurat azi
// (±40-70 m pe segment), fiindcă km-ii „oficiali" ai roadbook-ului de test vin din GPS.
function lume(boxes = BUCLA, driver = makeDriverModel()) {
  let wall = 0, lat = 45, lng = 11;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(boxes, {}, null), clock, store,
    driver,
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 0, accM: 6 });
  const pas = (metri, hdg) => {
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(45 * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: hdg, accM: 6 });
  };
  const drept = (n, metri, hdg) => { for (let i = 0; i < n; i++) pas(metri, hdg); };
  return { m, store, said, pas, drept,
    corectii() { return store.journal.filter(e => e.type === 'corectie_anunt'); },
    vorbit(re) { return said.filter(s => re.test(s.t)); } };
}

// virajul, ca în teren: colț de ~55 m cu direcția în schimbare, apoi drum stabil până
// se hotărăște detectorul (lag măsurat în jurnal: 21-45 m)
function viraj(w, dela, spre, metriColt = 8) {
  const pasi = 7, d = ((spre - dela + 540) % 360 - 180) / pasi;
  for (let i = 1; i <= pasi; i++) w.pas(metriColt, dela + d * i);
  w.drept(3, 9, spre);
}

console.log('\n═══ Buclă strânsă: boxul următor la 63 m — corecția nu mai vorbește lung ═══');
{
  const w = lume();
  w.drept(38, 10, 0);                         // 380 m reali, roadbook-ul zice 320
  viraj(w, 0, 90);                            // dreapta, la boxul 2 (0,32)
  const sync = w.store.journal.find(e => e.type === 'sync' && e.boxNum === 2);
  ok('virajul de la boxul 2 a fost prins', !!sync, JSON.stringify(w.store.journal.map(e => e.type)));
  const c = w.corectii()[0];
  ok('corecția e de −116 m, exact ca la boxul 4 în teren (11:28:44)',
     !!c && c.deltaM === -116, JSON.stringify(c));
  ok('boxul următor (3) e sub 150 m — în roadbook secțiunea are 90 m',
     !!c && c.panaLaUrmatorulM < 150, c && `${c.panaLaUrmatorulM} m`);
  ok('deci NU se rostește fraza lungă cu cifra',
     w.vorbit(/Corectat (înainte|înapoi) \d+ metri/).length === 0,
     JSON.stringify(w.said.map(s => s.t)));
  ok('cel mult „Corectat.", ca informația să nu ocupe urechea',
     w.vorbit(/^Corectat\.$/).length <= 1 && c.rostit === 'scurt', JSON.stringify(c));
  ok('dar ecranul o ține, cu cifră cu tot',
     !!w.m.M.corectie && /corectat înapoi \d+ m · box 2/.test(w.m.M.corectie.text),
     JSON.stringify(w.m.M.corectie));
}

console.log('\n═══ Spațiu de 333 m până la probă: fraza întreagă se rostește ═══');
{
  // cazul din jurnal, 11:28:44: snap pe boxul 4 (0,48), startul probei abia la 0,84 —
  // acolo fraza lungă are unde încăpea, deci se spune cu cifră cu tot
  const w = lume();
  w.drept(38, 10, 0);
  viraj(w, 0, 90);                            // boxul 2 — dreapta, intrarea în buclă
  w.drept(14, 11, 135);                       // bucla József, dus
  viraj(w, 135, 315);                         // întoarcerea la capătul buclei
  const c = w.corectii().find(e => e.boxNum === 4);
  ok('s-a sincronizat pe boxul 4 (stânga la T)', !!c,
     JSON.stringify(w.store.journal.filter(e => e.type === 'sync')));
  ok('până la boxul 5 sunt 333 m, deci e loc de vorbit',
     !!c && c.panaLaUrmatorulM > 150, c && `${c.panaLaUrmatorulM} m`);
  ok('corecția depășește 60 m, deci merită cuvinte', !!c && Math.abs(c.deltaM) > 60, JSON.stringify(c));
  ok('fraza întreagă, cu cifra și boxul',
     w.vorbit(/Corectat (înainte|înapoi) \d+ metri, box 4\./).length === 1,
     JSON.stringify(w.said.map(s => s.t)));
  ok('și e marcată în jurnal ca rostită întreg', !!c && c.rostit === 'intreg', JSON.stringify(c));
}

console.log('\n═══ Clasele: corecția e ritm, virajele sunt manevră ═══');
{
  const w = lume();
  w.drept(38, 10, 0);
  viraj(w, 0, 90);
  const cor = w.said.filter(s => /Corectat/.test(s.t));
  ok('anunțul de corecție e clasa „ritm", nu „manevra"',
     cor.every(s => s.cls === 'ritm'), JSON.stringify(cor));
  ok('și rămâne la prioritate mică (≤2)', cor.every(s => s.p <= 2), JSON.stringify(cor));
  const manevre = w.said.filter(s => s.cat === 'turn');
  ok('anunțurile de viraj sunt clasa „manevra" — asta lipsea de la 03.08',
     manevre.length > 0 && manevre.every(s => s.cls === 'manevra'),
     JSON.stringify(manevre.map(s => ({ t: s.t, cls: s.cls }))));
}

console.log('\n═══ În difuzor: corecția nu taie și nu i-o ia înainte manevrei ═══');
{
  let t = 0;
  const spoken = [], taiate = [];
  let busy = false;
  const tts = { speak: txt => { spoken.push(txt); busy = true; },
                cancel: () => { busy = false; }, busy: () => busy };
  const v = makeVoice({ tts, now: () => t, onDrop: (txt, de) => taiate.push({ txt, de }) });
  v.say('30 de metri — stânga la T', 3, 'turn', 'manevra');
  t += 500;
  v.say('Corectat înapoi 116 metri, box 4.', 2, 'sync', 'ritm');
  ok('manevra rămâne în difuzor', spoken[spoken.length - 1] === '30 de metri — stânga la T',
     JSON.stringify(spoken));
  ok('corecția n-a întrerupt nimic', !taiate.some(x => x.de === 'intrerupt'), JSON.stringify(taiate));

  // și în coadă: manevra pleacă prima, oricât de interesantă ar fi corecția
  const spoken2 = [];
  let elibereaza = null;
  const v2 = makeVoice({ now: () => t, tts: {
    speak: (txt, onEnd) => { spoken2.push(txt); elibereaza = onEnd; },
    cancel: () => { elibereaza = null; }, busy: () => !!elibereaza } });
  v2.say('Pornit.', 2, null, 'ritm');                     // ocupă difuzorul
  v2.say('Corectat înapoi 116 metri, box 4.', 2, 'sync', 'ritm');
  v2.say('stânga acum, la T', 4, 'turn', 'manevra');
  const term = elibereaza; elibereaza = null; term();
  ok('din coadă pleacă manevra, nu corecția', spoken2[1] === 'stânga acum, la T',
     JSON.stringify(spoken2));
}

console.log('\n═══ Corecțiile mici rămân tăcute, dar vizibile ═══');
{
  const w = lume();
  w.drept(32, 10, 0);                          // fix cât zice roadbook-ul: corecția rămâne mică
  viraj(w, 0, 90);
  const c = w.corectii()[0];
  ok('sub 60 m nu se rostește nimic', w.vorbit(/Corectat/).length === 0,
     JSON.stringify(w.said.map(s => s.t)));
  ok('nici nu se mai scrie „corectie_anunt" cu rostire', !c || c.rostit !== 'intreg', JSON.stringify(c));
  ok('dar corecția e pe ecran', !!w.m.M.corectie, JSON.stringify(w.m.M.corectie));
}

// ════════════════════════════════════════════════════════════════════════════
// COADA anunțului „acum": ce urmează DUPĂ manevra tocmai anunțată.
// Cererea lui Andreas, 04.08.2026: „fă acum la dreapta și următoarea la stânga" /
// „fă acum stânga și în 300 de metri la dreapta". Momentul „acum" e ultima ocazie în
// care pilotul mai poate alege banda și viteza pentru manevra de după.
//
// Roadbook-ul de mai sus (BUCLA) e cel real al zilei și acoperă singur trei din patru
// cazuri: 90 m între boxurile 2 și 3 (coadă cu cifră), 70 m între 3 și 4 (coadă
// „imediat"), iar după boxul 4 următoarea manevră e la 2,6 km (fără coadă).
// ════════════════════════════════════════════════════════════════════════════

// Merge drept, fără să vireze: pozițiile boxurilor se ating pe odometru, iar ce ne
// interesează aici sunt CUVINTELE, nu detectorul de viraje.
const drumDrept = (w, n = 90) => w.drept(n, 10, 0);      // n × 10 m la 36 km/h
const acumuri = w => w.said.filter(s => s.cls === 'manevra' && /acum|giratoriu/.test(s.t));

console.log('\n═══ Coada „acum": manevra următoare la 90 m — se spune cu cifră ═══');
{
  const w = lume();
  drumDrept(w, 33);                            // 330 m: boxul 2 (0,32) tocmai a fost anunțat
  const a = w.said.filter(s => /dreapta acum/.test(s.t));
  ok('anunțul „acum" al boxului 2 spune și manevra de după',
     a.length === 1 && a[0].t === 'dreapta acum, și în 100 de metri stânga',
     JSON.stringify(w.said.map(s => s.t)));
  ok('cifra e rotunjită la 50 m (90 m reali → „100 de metri")',
     a.length === 1 && /în 100 de metri/.test(a[0].t), a[0] && a[0].t);
  ok('rămâne clasa „manevra" și prioritatea 4, ca orice „acum"',
     a.length === 1 && a[0].cls === 'manevra' && a[0].p === 4 && a[0].cat === 'turn',
     JSON.stringify(a));
}

console.log('\n═══ Coada „acum": manevra următoare la 70 m — „imediat", fără cifră ═══');
{
  const w = lume();
  drumDrept(w, 42);                            // 420 m: și boxul 3 (0,41) a fost anunțat
  const a = w.said.filter(s => /^stânga acum, și/.test(s.t));
  ok('boxul 3 anunță și stânga de la T, care vine la 70 m',
     a.length === 1 && a[0].t === 'stânga acum, și imediat stânga la T',
     JSON.stringify(w.said.map(s => s.t)));
  ok('sub 80 m nu se rostește nicio cifră — s-ar învechi în timpul frazei',
     a.length === 1 && !/de metri/.test(a[0].t), a[0] && a[0].t);
}

console.log('\n═══ Coada „acum": manevra următoare la 2,6 km — tăcere ═══');
{
  const w = lume();
  drumDrept(w, 52);                            // 520 m: boxul 4 (0,48) anunțat
  const a = w.said.filter(s => /^stânga acum, la T/.test(s.t));
  ok('boxul 4 se anunță singur, fără coadă', a.length === 1 && a[0].t === 'stânga acum, la T',
     JSON.stringify(w.said.map(s => s.t)));
  ok('startul de probă de la 360 m NU intră în coadă (nu e manevră)',
     acumuri(w).every(s => !/probă|Start/.test(s.t.split(', și ')[1] || '')),
     JSON.stringify(acumuri(w).map(s => s.t)));
}

console.log('\n═══ Coada „acum": giratoriul se spune cu ieșirea ═══');
{
  // Giratoriul e cel real din roadbook-ul zilei (boxul 8, ieșirea 4); aici e pus la
  // 200 m după virajul dreapta, ca să existe în teren cazul cerut de Andreas.
  const GIRATORIU = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START / TC' },
    { num: 2, sumKm: 0.32, dir: 'DREAPTA', comment: 'Dreapta spre Str. József Attila' },
    { num: 3, sumKm: 0.52, dir: 'GIRATORIU-4', comment: 'Giratoriu — ieșirea 4' },
    { num: 5, sumKm: 1.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 35 km/h' },
    { num: 7, sumKm: 3.10, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' }
  ]);
  const w = lume(GIRATORIU);
  drumDrept(w, 33);
  const a = w.said.filter(s => /dreapta acum/.test(s.t));
  ok('coada dă și numărul ieșirii, nu doar „giratoriu"',
     a.length === 1 && a[0].t === 'dreapta acum, și în 200 de metri giratoriu, ieșirea 4',
     JSON.stringify(w.said.map(s => s.t)));
}

console.log('\n═══ Coada sare peste ce nu e manevră și dă distanța până la MANEVRĂ ═══');
{
  // reper „ÎNAINTE" la 120 m după viraj, manevra adevărată abia la 300 m
  const REPER = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START / TC' },
    { num: 2, sumKm: 0.32, dir: 'DREAPTA', comment: 'Dreapta spre Str. József Attila' },
    { num: 3, sumKm: 0.44, dir: 'ÎNAINTE', comment: 'reper: biserica, drept înainte' },
    { num: 4, sumKm: 0.62, dir: 'STÂNGA', comment: 'Stânga după biserică' },
    { num: 5, sumKm: 1.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 35 km/h' },
    { num: 7, sumKm: 3.10, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' }
  ]);
  const w = lume(REPER);
  drumDrept(w, 33);
  const a = w.said.filter(s => /dreapta acum/.test(s.t));
  ok('reperul de la 120 m nu apare în coadă',
     a.length === 1 && !/biseric|înainte/i.test(a[0].t), JSON.stringify(a.map(s => s.t)));
  ok('și distanța e până la stânga de la 300 m, nu până la reper',
     a.length === 1 && a[0].t === 'dreapta acum, și în 300 de metri stânga',
     JSON.stringify(w.said.map(s => s.t)));
}

console.log('\n═══ În probă nu se schimbă nimic: doar cazul „imediat" ═══');
{
  // Aceleași reguli ar da „și în 300 de metri stânga" pe legătură. În probă, urechea e
  // pe cifrele de ritm — rămâne doar coada care ține loc de anunț ratat (sub 80 m).
  const PROBA = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START / TC' },
    { num: 2, sumKm: 0.32, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 35 km/h' },
    { num: 3, sumKm: 0.90, dir: 'DREAPTA', comment: 'dreapta în probă' },
    { num: 4, sumKm: 1.20, dir: 'STÂNGA', comment: 'stânga, la 300 m' },
    { num: 5, sumKm: 1.26, dir: 'DREAPTA-T', comment: 'dreapta la T, la 60 m' },
    { num: 7, sumKm: 2.50, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' }
  ]);
  const w = lume(PROBA);
  drumDrept(w, 130);
  ok('proba chiar rulează', w.m.M.state === 'RT_RUN', w.m.M.state);
  ok('la 300 m de manevra următoare, în probă coada tace',
     w.said.some(s => s.t === 'dreapta acum') &&
     !w.said.some(s => /, și în \d+/.test(s.t)), JSON.stringify(w.said.map(s => s.t)));
  const st = w.said.filter(s => /^stânga acum/.test(s.t));
  ok('dar la 60 m coada rămâne — altfel anunțul ar veni după viraj',
     st.length === 1 && st[0].t === 'stânga acum, și imediat dreapta la T',
     JSON.stringify(w.said.map(s => s.t)));
}

// ════════════════════════════════════════════════════════════════════════════
// TURA TRESOR, 04.08.2026, 16:26-16:39 — prima tură cu v31. Roadbook-ul de mai jos e
// Leg 1 în întregime, exact cum l-a condus Andreas (19 boxuri).
// ════════════════════════════════════════════════════════════════════════════
const TRESOR = sanitizeBoxes([
  { num: 1,  sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START Leg 1 · TC 1' },
  { num: 2,  sumKm: 0.19, dir: 'STÂNGA', comment: 'Stânga pe Str. Constructorilor' },
  { num: 3,  sumKm: 0.24, dir: 'ÎNAINTE', comment: 'Înainte — devine Inelul IV' },
  { num: 4,  sumKm: 0.50, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
  { num: 5,  sumKm: 1.40, dir: 'ÎNAINTE', comment: 'reper la mijlocul probei' },
  { num: 6,  sumKm: 2.14, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1 · tabela roșie' },
  { num: 7,  sumKm: 2.28, dir: 'DREAPTA', comment: 'Dreapta pe Str. Avram Imbroane' },
  { num: 8,  sumKm: 2.60, dir: 'ÎNAINTE', flag: 'TC', comment: 'CP 1 — Control de Trecere' },
  { num: 9,  sumKm: 2.83, dir: 'STÂNGA', comment: 'Stânga pe Str. Gheorghe Adam' },
  { num: 10, sumKm: 2.90, dir: 'ÎNAINTE', flag: 'RT_START_STANDING', comment: 'START RT 2 · 26 km/h' },
  { num: 11, sumKm: 3.50, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 2 · stânga în 55 m' },
  { num: 12, sumKm: 3.55, dir: 'STÂNGA', comment: 'Stânga pe Str. Lorena' },
  { num: 13, sumKm: 3.75, dir: 'DREAPTA', comment: 'Dreapta pe Aleea Pădurea Verde' },
  { num: 14, sumKm: 3.81, dir: 'ÎNAINTE', comment: 'Înainte — devine Str. Orăștie' },
  { num: 15, sumKm: 4.14, dir: 'DREAPTA', comment: 'Dreapta pe Str. Turda' },
  { num: 16, sumKm: 4.43, dir: 'STÂNGA', comment: 'Stânga pe Calea Ghirodei' },
  { num: 17, sumKm: 4.73, dir: 'DREAPTA', comment: 'Dreapta pe strada fără nume' },
  { num: 18, sumKm: 4.90, dir: 'STÂNGA', comment: 'Stânga pe Str. Ionel Teodoreanu' },
  { num: 19, sumKm: 5.13, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH Leg 1 · TC 2' }
]);

console.log('\n═══ „acum" nu mai pleacă de la 120 de metri (tura Tresor) ═══');
{
  // Modelul șoferului de pe telefon învățase o latență de 7-9 s: nu reacția lui Andreas,
  // ci timpul în care detectorul de viraje se hotăra (GPS la 6 s + 2,5 s de direcție
  // stabilă). Măsurat în tură: „acum" a plecat cu 32-124 m înainte de box.
  const rau = makeDriverModel({ latencyS: 8.7, n: 12 });
  ok('modelul salvat stricat se aduce în plajă la încărcare (max 4 s)',
     rau.latencyS() <= 4, String(rau.latencyS()));
  const d = makeDriverModel();
  d.cueGiven(1, 0);
  ok('o „reacție" de 8,7 s nu mai intră în model — aia e detectorul, nu pilotul',
     d.turnDone(1, 8700) === null, String(d.latencyS()));
  d.cueGiven(2, 0); d.turnDone(2, 2000);
  ok('o reacție adevărată de 2 s intră', Math.abs(d.latencyS() - 2) < 0.6, String(d.latencyS()));

  // și, la consumator, plafonul: chiar cu un model umflat ca cel de pe telefon, „acum"
  // rămâne sub 60 m. Vitezele sunt cele din tură (49-59 km/h pe legătură).
  const w = lume(TRESOR, makeDriverModel({ latencyS: 8.7, n: 12 }));
  for (let i = 0; i < 100; i++) w.pas(15, 0);   // 1,5 km la 54 km/h
  const cue = w.store.journal.filter(e => e.type === 'cue');
  ok('niciun „acum" mai devreme de 60 m față de box (în tură: până la 124 m)',
     cue.every(c => c.dM <= 60), JSON.stringify(cue.map(c => ({ b: c.boxNum, dM: c.dM, kmh: c.kmh }))));
  ok('și totuși „acum" se rostește pentru boxurile de manevră',
     cue.some(c => c.boxNum === 2), JSON.stringify(cue.map(c => c.boxNum)));
  ok('distanța la care s-a vorbit intră în jurnal — ca să se măsoare, nu să se deducă',
     cue.every(c => typeof c.dM === 'number' && typeof c.kmh === 'number'), JSON.stringify(cue[0]));
}

console.log('\n═══ Coada stă și pe ultima treaptă cu cifră, nu doar pe „acum" ═══');
{
  // boxurile 15 → 16 din tura Tresor: 290 m între ele. Anunțul de la 150 m e cel pe
  // care pilotul îl aude sigur; „acum" poate ajunge târziu (la boxul 12 a plecat cu
  // 13 m înainte de viraj, în spatele frazei de finish).
  const w = lume(TRESOR);
  drumDrept(w, 450);                          // 4,5 km: trecut de boxul 15
  const treapta = w.said.filter(s => /de metri — dreapta, apoi/.test(s.t));
  ok('treapta cu cifră a boxului 15 spune și stânga de la 290 m',
     treapta.some(s => /^1\d0 de metri — dreapta, apoi în 300 de metri stânga$/.test(s.t)),
     JSON.stringify(w.said.map(s => s.t).slice(-12)));
  const acum = w.said.filter(s => /^dreapta acum, și/.test(s.t));
  ok('și „acum"-ul aceluiași box o repetă, cu altă legătură',
     acum.some(s => s.t === 'dreapta acum, și în 300 de metri stânga'),
     JSON.stringify(acum.map(s => s.t)));
  ok('legăturile sunt distincte: „apoi" pe treaptă, „și" pe acum',
     treapta.every(s => !/, și /.test(s.t)) && acum.every(s => !/, apoi /.test(s.t)),
     JSON.stringify({ treapta: treapta.map(s => s.t), acum: acum.map(s => s.t) }));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
