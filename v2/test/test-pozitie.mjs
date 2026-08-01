// RALI 2 — poziția absolută din GPS, nu doar odometrie.
// Întrebarea lui Andreas: „dacă știi distanțele exacte între boxuri și ai GPS, de ce
// n-ai ști exact unde sunt?" Are dreptate: odometrul ADUNĂ erorile, poziția absolută
// de la ultima ancoră NU. Testele de mai jos măsoară exact cât ajută.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const BOX = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
  { num: 5, sumKm: 0.38, dir: 'STÂNGA', comment: 'pe Principala' },
  { num: 6, sumKm: 0.60, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
  { num: 8, sumKm: 2.60, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' },
  { num: 9, sumKm: 2.98, dir: 'GIRATORIU-4', comment: 'Kaufland' }
]);

// Drum DREPT spre nord. `eroareOdo` = cât de prost măsoară odometrul (0.85 = cu 15% mai puțin).
// Poziția GPS rămâne corectă — exact ca în realitate: coordonatele nu driftează, integrarea da.
function lumeDreapta(eroareOdo, headingConst = 0) {
  let wall = 0, realKm = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const plan = buildPlan(BOX, {}, null);
  const said = [];
  const m = makeMachine({ plan, clock, store, driver: makeDriverModel(),
    voice: { say: t => said.push(t), tone() {}, flush() {} }, ui: { render() {} } });
  const fix = () => {
    wall += 1000;
    m.onFix({ lat: 45 + realKm / 111.32, lng: 21, tMs: wall,
              speedMs: 0, headingDeg: headingConst, accM: 8 });
  };
  m.start(); fix();                    // fix de încălzire la linia de start
  return {
    m, store, said,
    condu(panaLa, kmh = 45) {
      while (realKm < panaLa - 1e-9) {
        const pas = Math.min(kmh / 3600, panaLa - realKm);
        realKm += pas; wall += 1000;
        m.onFix({ lat: 45 + realKm / 111.32, lng: 21, tMs: wall,
                  speedMs: pas * eroareOdo * 1000, headingDeg: headingConst, accM: 8 });
      }
    },
    get realKm() { return realKm; }
  };
}

console.log('\n═══ Odometru catastrofal (−15%), drum drept ═══');
{
  const w = lumeDreapta(0.85);
  w.condu(2.00);
  const err = Math.abs(w.m.M.routeKm - 2.00) * 1000;
  ok('poziția rămâne corectă în ciuda odometrului', err < 30,
     `routeKm=${w.m.M.routeKm.toFixed(3)} (eroare ${Math.round(err)} m; fără corecție ar fi fost 300 m)`);
  ok('podeaua a intervenit și e în jurnal',
     w.store.journal.some(e => e.type === 'pozitie_podea'));
}

console.log('\n═══ Odometru care exagerează (+15%), drum drept ═══');
{
  const w = lumeDreapta(1.15);
  w.condu(2.00);
  const err = Math.abs(w.m.M.routeKm - 2.00) * 1000;
  ok('poziția e trasă înapoi la adevăr', err < 30,
     `routeKm=${w.m.M.routeKm.toFixed(3)} (eroare ${Math.round(err)} m; fără corecție ar fi fost 300 m)`);
}

console.log('\n═══ Proba pornește la locul potrivit, cu odometru prost ═══');
{
  const w = lumeDreapta(0.85);
  w.condu(0.55);
  ok('înainte de linie: proba NU a pornit', w.m.M.state !== 'RT_RUN', w.m.M.state);
  w.condu(0.63);
  ok('imediat după linia de la 0,60: proba a pornit', w.m.M.state === 'RT_RUN', w.m.M.state);
  // și distanța din probă rămâne ancorată de linia de start
  w.condu(1.60);
  const d = w.m.M.rt.distKm;
  ok('distanța probei ≈ 1,00 km real', Math.abs(d - 1.00) * 1000 < 35,
     `${d.toFixed(3)} km (eroare ${Math.round(Math.abs(d - 1.00) * 1000)} m)`);
}

console.log('\n═══ Drum cu viraje: linia dreaptă rămâne doar PODEA, nu adevăr ═══');
{
  // mașina merge pe un „L": 1 km nord, apoi 1 km est. Linia dreaptă între capete e
  // 1,41 km, dar drumul e 2 km. Podeaua nu are voie să strice măsurătoarea corectă.
  let wall = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const plan = buildPlan(BOX, {}, null);
  const m = makeMachine({ plan, clock, store: makeMemStore(), driver: makeDriverModel(),
    voice: { say() {}, tone() {}, flush() {} }, ui: { render() {} } });
  m.start();
  let lat = 45, lng = 21;
  const pas = 0.0125;                        // 12,5 m per secundă = 45 km/h
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 0, accM: 8 });
  for (let i = 0; i < 80; i++) {             // 1 km spre nord
    lat += pas / 111.32; wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: 12.5, headingDeg: 0, accM: 8 });
  }
  for (let i = 0; i < 80; i++) {             // 1 km spre est
    lng += pas / (111.32 * Math.cos(45 * Math.PI / 180)); wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: 12.5, headingDeg: 90, accM: 8 });
  }
  const err = Math.abs(m.M.routeKm - 2.00) * 1000;
  ok('pe traseu în „L", poziția rămâne 2,00 km (nu 1,41)', err < 40,
     `routeKm=${m.M.routeKm.toFixed(3)} (eroare ${Math.round(err)} m)`);
  ok('curbura acumulată a fost observată (≈90°)', m.M._curveDeg > 60,
     `${Math.round(m.M._curveDeg)}°`);
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
