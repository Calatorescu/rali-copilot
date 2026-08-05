// RALI 2 — „UNDE SUNT?": întrebarea pe care aplicația o lăsa fără răspuns.
//
// Andreas se orientează greu în spațiu. Aplicația știa să spună ce URMEAZĂ („300 de
// metri — dreapta"), dar nimic despre UNDE EȘTI: între ce boxuri, pe ce stradă, cât
// mai e. Diferența nu e cosmetică — a doua întrebare e cea care apare când te simți
// pierdut, adică exact atunci când prima nu-ți mai folosește la nimic.
//
// Ce se verifică aici, în ordinea importanței:
//  1. răspunsul e CORECT (boxurile potrivite, distanța potrivită, strada potrivită);
//  2. răspunsul spune cât de bună e cifra — „poziție aproximativă" când chiar e;
//  3. răspunsul NU strică nimic: nu atinge cronometrul, merge în probă, nu taie manevre.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { buildTrace } from '../js/geo.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// Roadbook cu comentarii în forma reală (organizatorul scrie „Dreapta pe Str. X"),
// dar cu nume de străzi INVENTATE: fixturile nu conțin adrese reale.
const RB = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START · TC 1' },
  { num: 2, sumKm: 0.60, dir: 'DREAPTA', comment: 'Dreapta pe Str. Cvasar' },
  { num: 3, sumKm: 1.90, dir: 'STÂNGA-T', comment: 'Stânga la T pe Str. Fervența' },
  { num: 4, sumKm: 3.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
  { num: 5, sumKm: 5.20, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1 · tabela roșie' },
  { num: 6, sumKm: 6.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'TC 2 — final de leg' }
]);

function lume({ recon = null } = {}) {
  let wall = 0, lat = 45.7823, lng = 14.1461;      // longitudine deplasată cu −10
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(RB, { '4_320': 40 }, recon, null), clock, store,
    driver: makeDriverModel(), opts: { offRoute: false },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 90, accM: 6 });
  const pas = (metri, hdg = 90) => {
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(45.7823 * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: hdg, accM: 6 });
  };
  return { m, said, store, pas, ceas: () => wall,
    drum(km, viteza = 15) { const n = Math.round(km * 1000 / viteza); for (let i = 0; i < n; i++) pas(viteza); } };
}

console.log('\n═══ Răspunsul de bază: între ce boxuri, pe ce stradă, cât mai e ═══');
{
  const w = lume();
  w.drum(1.2);                                    // între boxul 2 (0,60) și boxul 3 (1,90)
  const r = w.m.undeSunt();
  ok('spune între ce boxuri ești',
     /Ești între boxul 2 și boxul 3/.test(r.text), r.text);
  ok('și pe ce stradă — scoasă din comentariul boxului pe care l-ai trecut ultimul',
     /pe Str\. Cvasar/.test(r.text), r.text);
  ok('și cât mai ai până la manevra următoare',
     /Mai ai \d+ de metri până la stânga la T de la boxul 3\./.test(r.text), r.text);
  ok('distanța e cea reală (700 m ±60), nu una inventată',
     (() => { const m = r.text.match(/Mai ai (\d+) de metri/); return m && Math.abs(+m[1] - 700) <= 60; })(),
     r.text);
  ok('răspunsul rămâne și pe ecran, nu doar în difuzor',
     !!w.m.M.unde && w.m.M.unde.text === r.text, JSON.stringify(w.m.M.unde));
  ok('are clasa „ritm" — oricât ar fi de cerut, nu taie un viraj',
     w.said[w.said.length - 1].cls === 'ritm', JSON.stringify(w.said[w.said.length - 1]));
  ok('și intră în jurnal, ca orice altceva rostit',
     w.store.journal.some(e => e.type === 'unde_sunt'), 'nu s-a scris în jurnal');
}

console.log('\n═══ Cât de bună e cifra: se spune, nu se ascunde ═══');
{
  const w = lume();
  w.drum(1.2);
  const r = w.m.undeSunt();
  ok('fără recunoaștere, răspunsul spune „poziție aproximativă"',
     /Poziție aproximativă\.$/.test(r.text) && r.masurat === false, r.text);

  // …iar cu geometria drumului condus, aceeași frază nu mai are coada aia
  const brut = [];
  let p = { lat: 45.7823, lng: 14.1461 };
  for (let i = 0; i < 400; i++) {
    brut.push({ ...p });
    p = { lat: p.lat, lng: p.lng + 20 / (111320 * Math.cos(45.7823 * Math.PI / 180)) };
  }
  const trace = buildTrace(brut);
  const w2 = lume({ recon: { trace, samples: [],
    anchors: [{ officialKm: 0, traceM: 0 }, { officialKm: 6.0, traceM: trace.totalM }] } });
  w2.drum(1.2);
  const r2 = w2.m.undeSunt();
  ok('cu recunoaștere, poziția e măsurată — și fraza nu mai avertizează degeaba',
     r2.masurat === true && !/aproximativă/.test(r2.text), r2.text);
}

console.log('\n═══ La începutul și la sfârșitul leg-ului ═══');
{
  const w = lume();
  const r = w.m.undeSunt();
  ok('la start nu inventează un box dinainte',
     /Ești la începutul leg-ului, înainte de boxul 1\./.test(r.text), r.text);
  const w2 = lume();
  w2.drum(6.3);
  const r2 = w2.m.undeSunt();
  ok('la finalul leg-ului spune exact asta, cu kilometrul — nu „mai ai 0 metri"',
     /(Leg-ul s-a terminat|Ai trecut de ultimul box), la kilometrul/.test(r2.text), r2.text);
}

console.log('\n═══ În probă: răspunde, dar nu atinge cronometrul ═══');
{
  const w = lume();
  w.drum(4.0);                                    // în RT 1 (3,20 → 5,20)
  ok('chiar suntem în probă', w.m.M.state === 'RT_RUN', w.m.M.state);
  const t0 = w.m.M.rt.t0Mono, km0 = w.m.M.rt.distKm, ruta0 = w.m.M.routeKm;
  const r = w.m.undeSunt();
  ok('spune în ce probă ești și cât mai ai din ea',
     /^În RT1, mai ai .* din probă\./.test(r.text), r.text);
  ok('CRONOMETRUL nu s-a mișcat: nici ora de start, nici distanța, nici poziția',
     w.m.M.rt.t0Mono === t0 && w.m.M.rt.distKm === km0 && w.m.M.routeKm === ruta0,
     JSON.stringify({ t0, acum: w.m.M.rt.t0Mono, km0, kmAcum: w.m.M.rt.distKm }));
  ok('și rezultatul probei nu s-a atins', Object.keys(w.m.M.results).length === 0);
}

console.log('\n═══ Pe dinafară, întrebarea are alt răspuns ═══');
{
  const w = lume();
  w.drum(1.2);
  w.m.offRouteManual();
  const r = w.m.undeSunt();
  ok('nu mai spune „ești între boxuri", ci încotro e traseul',
     /^Nu ești pe traseu\./.test(r.text) && !/între boxul/.test(r.text), r.text);
  ok('și dă boxul și distanța, dacă le știe',
     /Boxul \d+ e la /.test(r.text) || /nu știu unde e boxul/.test(r.text), r.text);
}

console.log('\n═══ Răspunsul nu rămâne pe ecran la nesfârșit ═══');
{
  const w = lume();
  w.drum(1.2);
  w.m.undeSunt();
  ok('e pe ecran imediat după apăsare', !!w.m.M.unde);
  w.drum(0.45);                                   // 30 s la 15 m/s
  ok('și dispare singur după 20 de secunde, ca să nu pară informație proaspătă',
     w.m.M.unde === null, JSON.stringify(w.m.M.unde));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
