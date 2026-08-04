// RALI 2 — IEȘIREA DE PE TRASEU, pe cazul-etalon din tura Tresor (04.08.2026).
//
// Ce s-a întâmplat în teren, din jurnal (16:34:28-16:39:14): virajul de la boxul 12
// (stânga, la 55 m după finish-ul probei 2) a fost ratat. Aplicația a continuat ca și
// cum nimic: a potrivit două viraje de pe drumul greșit cu boxurile 13 și 17 (−92 și
// −133 m), a dat cue-uri pentru boxurile 15, 16, 17 și 18, iar primele avertizări de
// desincronizare au venit la 259 și 261 m după boxuri. Pilotul a condus patru minute
// pe alte străzi, cu o aplicație care îi spunea unde să vireze.
//
// Roadbook-ul de mai jos e Leg 1 din tura aia, cu kilometrajul real. Lumea de test are
// busolă: fiecare pas mută mașina pe un cap compas, deci virajele sunt viraje adevărate,
// văzute de același detector ca în mașină.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const TRESOR = sanitizeBoxes([
  { num: 1,  sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START Leg 1 · TC 1' },
  { num: 2,  sumKm: 0.19, dir: 'STÂNGA', comment: 'Stânga pe Str. Constructorilor' },
  { num: 3,  sumKm: 0.24, dir: 'ÎNAINTE', comment: 'Înainte — devine Inelul IV' },
  { num: 7,  sumKm: 2.28, dir: 'DREAPTA', comment: 'Dreapta pe Str. Avram Imbroane' },
  { num: 9,  sumKm: 2.83, dir: 'STÂNGA', comment: 'Stânga pe Str. Gheorghe Adam' },
  { num: 12, sumKm: 3.55, dir: 'STÂNGA', comment: 'Stânga pe Str. Lorena' },
  { num: 13, sumKm: 3.75, dir: 'DREAPTA', comment: 'Dreapta pe Aleea Pădurea Verde' },
  { num: 15, sumKm: 4.14, dir: 'DREAPTA', comment: 'Dreapta pe Str. Turda' },
  { num: 16, sumKm: 4.43, dir: 'STÂNGA', comment: 'Stânga pe Calea Ghirodei' },
  { num: 17, sumKm: 4.73, dir: 'DREAPTA', comment: 'Dreapta pe strada fără nume' },
  { num: 18, sumKm: 4.90, dir: 'STÂNGA', comment: 'Stânga pe Str. Ionel Teodoreanu' }
]);

// probele scoase din fixtură (start/finish nu schimbă nimic în logica de traseu, dar ar
// umple difuzorul cu cifre de ritm); restul kilometrajului e cel din roadbook.

function lume(boxes = TRESOR, opts = {}) {
  // lng deplasat cu -10 fata de zona reala, ca in toate fixturile (vezi test-audit.mjs)
  let wall = 0, lat = 45.78, lng = 11.24;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(boxes, {}, null), clock, store,
    driver: makeDriverModel(),
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} }, opts });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 0, accM: 6 });
  // un pas = un fix. În teren fixurile au venit la ~6 s; aici la 1 s, ca virajele să
  // aibă destule mostre pentru detector (el cere 2,5 s de direcție stabilă).
  const pas = (metri, hdg) => {
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(45.78 * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: hdg, accM: 6 });
  };
  const drept = (metri, hdg, pasM = 12) => {
    for (let d = 0; d < metri; d += pasM) pas(Math.min(pasM, metri - d), hdg);
  };
  // viraj ca în teren: colț de ~50 m cu direcția în schimbare, apoi drum stabil
  const viraj = (dela, spre) => {
    const n = 7, d = ((spre - dela + 540) % 360 - 180) / n;
    for (let i = 1; i <= n; i++) pas(7, dela + d * i);
    drept(40, spre, 10);
  };
  const salt = ms => { wall += ms; };
  // condu spre un punct geografic (folosit ca să te întorci la punctul de reintrare)
  const spre = (pct, metri, pasM = 12) => {
    for (let d = 0; d < metri; d += pasM) {
      const y = Math.sin((pct.lng - lng) * Math.PI / 180) * Math.cos(pct.lat * Math.PI / 180);
      const x = Math.cos(lat * Math.PI / 180) * Math.sin(pct.lat * Math.PI / 180) -
                Math.sin(lat * Math.PI / 180) * Math.cos(pct.lat * Math.PI / 180) *
                Math.cos((pct.lng - lng) * Math.PI / 180);
      const brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      pas(Math.min(pasM, metri - d), brg);
    }
  };
  return { m, store, said, pas, drept, viraj, salt, spre,
           jurnal: t => store.journal.filter(e => e.type === t) };
}

// Drumul CORECT până imediat după boxul 12 (55 m după finish-ul probei 2), pe capetele
// compas care fac ca distanțele conduse să se potrivească cu kilometrajul roadbook-ului.
function panaLaBoxul12(w, { rateaza = true, dupaM = 180 } = {}) {
  w.drept(190, 0);                 // box 1 → 2
  w.viraj(0, 270);                 // boxul 2: STÂNGA
  w.drept(2000, 270);              // box 3 → 7 (Inelul IV, probă, drum lung)
  w.viraj(270, 0);                 // boxul 7: DREAPTA
  w.drept(500, 0);                 // box 7 → 9
  w.viraj(0, 270);                 // boxul 9: STÂNGA
  w.drept(650, 270);               // box 9 → 12 (prin proba 2)
  if (rateaza) w.drept(dupaM, 270);  // AICI se rata: drept înainte, în loc de stânga
  else { w.viraj(270, 180); w.drept(160, 180); }
}

console.log('\n═══ Cazul-etalon: virajul de la boxul 12, ratat ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  const semne = w.jurnal('offroute_semn');
  ok('semnul „am trecut drept peste un box de manevră" apare',
     semne.some(s => s.tip === 'manevra_neconfirmata'), JSON.stringify(semne));
  const boxRatat = semne.find(s => s.tip === 'manevra_neconfirmata');
  ok('și e chiar boxul 12', boxRatat && boxRatat.boxNum === 12, JSON.stringify(boxRatat));

  // în teren, aici a urmat un viraj rătăcit pe care aplicația l-a lipit de boxul 13
  w.viraj(270, 0);
  ok('virajul de pe drumul greșit NU se mai potrivește cu boxul 13',
     !w.jurnal('sync').some(e => e.boxNum === 13),
     JSON.stringify(w.jurnal('sync')));
  ok('refuzul e motivat în jurnal',
     w.jurnal('snap_refuzat').some(e => e.motiv === 'dupa_manevra_ratata'),
     JSON.stringify(w.jurnal('snap_refuzat')));
  ok('și declară ieșirea de pe traseu',
     !!w.m.M.offRoute, JSON.stringify(w.jurnal('offroute_semn')));
  ok('punctul de reintrare e boxul 12',
     w.m.M.offRoute && w.m.M.offRoute.boxNum === 12, JSON.stringify(w.m.M.offRoute));
  ok('pilotul e anunțat, o singură dată, ca manevră',
     w.said.filter(s => /Ai ieșit de pe traseu/.test(s.t)).length === 1 &&
     w.said.find(s => /Ai ieșit de pe traseu/.test(s.t)).cls === 'manevra',
     JSON.stringify(w.said.filter(s => /traseu/.test(s.t))));
}

console.log('\n═══ Pe dinafară, planul îngheață ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  w.viraj(270, 0);
  const idx = w.m.M.nextBoxIdx, cueInainte = w.jurnal('cue').length;
  w.drept(600, 0);                 // rătăcire mai departe, peste kilometrajul boxurilor 15-16
  w.viraj(0, 90); w.drept(400, 90);
  ok('indexul boxurilor nu mai avansează', w.m.M.nextBoxIdx === idx,
     `${idx} → ${w.m.M.nextBoxIdx}`);
  ok('nu se mai dau cue-uri de manevră (în teren: boxurile 15, 16, 17, 18)',
     w.jurnal('cue').length === cueInainte, JSON.stringify(w.jurnal('cue').map(c => c.boxNum)));
  ok('virajele rătăcite nu mai sincronizează nimic (în teren: boxul 17, −133 m)',
     w.jurnal('snap_ignorat_offroute').length >= 1 &&
     !w.jurnal('sync').some(e => e.boxNum === 17), JSON.stringify(w.jurnal('sync')));
  const tIntrare = w.jurnal('offroute_intrare')[0].t;
  ok('după declarare nu se mai plânge de desincronizare — se știe deja',
     !w.jurnal('desync_warn').some(e => e.t > tIntrare), JSON.stringify(w.jurnal('desync_warn')));
}

console.log('\n═══ Ghidajul înapoi: distanță + direcție față de botul mașinii ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  w.viraj(270, 0);
  const o = w.m.M.offRoute;
  ok('ecranul are distanța în linie dreaptă', o && o.distM > 100 && o.distM < 1200, JSON.stringify(o));
  ok('și unghiul față de direcția de mers', o && typeof o.relDeg === 'number', JSON.stringify(o));
  const ghid = w.said.filter(s => /^Boxul 12 la /.test(s.t));
  ok('vocea spune unde e punctul, în cuvinte de pilot',
     ghid.length >= 1 && /(în față|la dreapta|la stânga|în spate)/.test(ghid[0].t),
     JSON.stringify(ghid.map(s => s.t)));
  ok('și nu turuie: cel mult un anunț la 12 s',
     ghid.length <= 3, JSON.stringify(ghid.map(s => s.t)));
}

console.log('\n═══ Prinderea: te întorci la punct și cursa continuă ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  w.viraj(270, 0);
  ok('suntem pe dinafară', !!w.m.M.offRoute);
  const kmRatacit = w.m.M.routeKm;
  // întoarcere spre punctul de reintrare, ghidat de ce arată aplicația pe ecran
  w.spre(w.m.M.offRoute.pct, w.m.M.offRoute.distM - 25);   // până în raza de prindere
  ok('te-a prins la punctul de reintrare', !w.m.M.offRoute, JSON.stringify(w.m.M.offRoute));
  ok('și o spune cu boxul cu tot',
     w.said.some(s => /Te-am prins, continuăm de la boxul 12\./.test(s.t)),
     JSON.stringify(w.said.slice(-4).map(s => s.t)));
  ok('poziția revine la boxul 12, nu rămâne rătăcită',
     Math.abs(w.m.M.routeKm - 3.55) < 0.05, `${kmRatacit.toFixed(2)} → ${w.m.M.routeKm.toFixed(2)}`);
  ok('ieșirea din stare e în jurnal, cu cât s-a rătăcit',
     w.jurnal('offroute_iesire').length === 1 && w.jurnal('offroute_iesire')[0].ratacitM > 0,
     JSON.stringify(w.jurnal('offroute_iesire')));
}

console.log('\n═══ Alarme false: ce NU trebuie să declare ieșirea de pe traseu ═══');
{
  // 1. traseul condus CORECT — inclusiv un viraj pe care detectorul nu-l vede
  const w = lume();
  panaLaBoxul12(w, { rateaza: false });
  ok('drumul corect nu declară niciodată ieșire', !w.m.M.offRoute,
     JSON.stringify({ semne: w.jurnal('offroute_semn'), off: w.m.M.offRoute }));

  // 2. virajul făcut prea încet ca să fie detectat (măsurat 03.08: sub 8 km/h,
  //    detectorul nu se trezește) — mașina a virat, deci NU e semn
  const w2 = lume();
  w2.drept(190, 0);
  for (const h of [20, 45, 70, 90, 110, 140, 170, 200, 230, 260, 270]) w2.pas(2, h);
  w2.drept(300, 270);
  ok('un viraj real, dar nedetectat, nu produce semn de ratare',
     !w2.jurnal('offroute_semn').some(s => s.tip === 'manevra_neconfirmata'),
     JSON.stringify(w2.jurnal('offroute_semn')));

  // 3. GPS mort: în teren au fost două găuri de 16 s exact în secvența asta
  const w3 = lume();
  panaLaBoxul12(w3);
  w3.salt(16000);                  // fixurile se opresc 16 s
  w3.viraj(270, 0);                // primul fix de după gaură aduce și virajul
  ok('nu se declară pe primul fix după o gaură de GPS',
     !w3.m.M.offRoute, JSON.stringify(w3.jurnal('offroute_semn')));
  w3.drept(500, 0);                // …dar după ce semnalul se așază, da
  ok('…dar se declară după ce semnalul s-a așezat', !!w3.m.M.offRoute);

  // 4. setarea oprită din panoul de pregătire
  const w4 = lume(TRESOR, { offRoute: false });
  panaLaBoxul12(w4);
  w4.viraj(270, 0);
  w4.drept(600, 0);
  ok('cu detectarea oprită, nimic nu se schimbă', !w4.m.M.offRoute &&
     w4.jurnal('offroute_semn').length === 0, JSON.stringify(w4.jurnal('offroute_semn')));
}

console.log('\n═══ Butonul: pilotul știe primul ═══');
{
  const w = lume();
  w.drept(190, 0);
  w.viraj(0, 270);
  w.drept(400, 270);
  ok('„am greșit drumul" declară pe loc, fără să aștepte două semne',
     w.m.offRouteManual() === true && !!w.m.M.offRoute, JSON.stringify(w.m.M.offRoute));
  ok('intrarea e marcată ca manuală în jurnal',
     w.jurnal('offroute_intrare').some(e => e.cum === 'manual'),
     JSON.stringify(w.jurnal('offroute_intrare')));
  w.m.offRouteRevenit();
  ok('și „am revenit" repune cursa pe traseu', !w.m.M.offRoute &&
     w.said.some(s => /Te-am prins/.test(s.t)), JSON.stringify(w.said.slice(-2).map(s => s.t)));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
