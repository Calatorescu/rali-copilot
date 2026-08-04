// RALI 2 — auto-calibrarea odometrului.
// Contextul real (aflat de la Andreas, 2026-08-01): la Sibiu roadbook-ul vine cu o oră
// înainte de start, deci recunoaștere NU se poate face. Poziția vine din odometru, iar
// singura apărare împotriva erorii sistematice de GPS e rigla din roadbook: între două
// boxuri confirmate fizic, distanța oficială e adevărul.
//
// REGULA S-A SCHIMBAT după tura din 04.08.2026 (vezi makeCalibrator, geo.js): rigla are
// și ea zgomot, iar versiunea veche învăța din PRIMUL segment. Testele de mai jos apără
// noul contract — o măsurătoare nu e o dovadă — și folosesc cifrele REALE din jurnal.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeCalibrator } from '../js/geo.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const BOX = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
  { num: 5, sumKm: 0.38, dir: 'STÂNGA', comment: 'inapoi pe Principala' },
  { num: 6, sumKm: 0.60, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
  { num: 8, sumKm: 2.60, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' },
  { num: 9, sumKm: 2.98, dir: 'GIRATORIU-4', comment: 'Kaufland' },
  { num: 14, sumKm: 5.41, dir: 'ÎNAINTE', flag: 'TC', comment: 'Finish' }
]);

// roadbook lung, cu boxuri la fiecare 2,5 km — patru segmente de calibrare pe leg
const BOX_LUNG = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
  { num: 2, sumKm: 2.50, dir: 'DREAPTA', comment: 'reper' },
  { num: 3, sumKm: 5.00, dir: 'STÂNGA', comment: 'reper' },
  { num: 4, sumKm: 7.50, dir: 'DREAPTA', comment: 'reper' },
  { num: 5, sumKm: 10.00, dir: 'STÂNGA', comment: 'reper' },
  { num: 6, sumKm: 12.50, dir: 'ÎNAINTE', flag: 'TC', comment: 'Finish' }
]);

// lume cu un GPS care raportează sistematic `eroare`× din distanța reală
function lume(eroare, boxes = BOX) {
  let wall = 0, realKm = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const said = [];
  const store = makeMemStore();
  const plan = buildPlan(boxes, {}, null);
  const m = makeMachine({ plan, clock, store, driver: makeDriverModel(),
    voice: { say: t => said.push(t), tone() {}, flush() {} }, ui: { render() {} } });
  m.start();
  // fix de „încălzire" la linia de start: în realitate mașina stă pe loc și primește
  // fixuri înainte de a pleca. Fără el, primul fix (care n-are cu ce se compara) pierde
  // ~12 m și falsifică raportul de calibrare cu ~0,4%.
  wall += 1000;
  m.onFix({ lat: 45, lng: 21, tMs: wall, speedMs: 0, accM: 8 });
  return {
    m, store, said, plan,
    condu(panaLa, kmh = 45) {
      while (realKm < panaLa - 1e-9) {
        const pas = Math.min(kmh / 3600, panaLa - realKm);
        realKm += pas; wall += 1000;
        m.onFix({ lat: 45 + realKm / 111.32, lng: 21, tMs: wall, speedMs: pas * eroare * 1000, accM: 8 });
      }
    },
    get realKm() { return realKm; }
  };
}

// ── Cifrele REALE din jurnalul 04.08.2026 ───────────────────────────────────
// perechile (oficial, măsurat) ale fiecărei ture din zi, în ordinea în care au apărut
const ZIUA_04_08 = [
  [[2.634, 2.678], [2.282, 2.211]],   // 11:23 și 11:27 — tura cu +92 m corecție la final
  [[2.600, 2.561], [2.120, 2.190]],
  [[2.600, 2.584], [2.400, 2.166]],   // aici factorul sărise la 1,052 (+5,2%)
  [[2.634, 2.724], [2.371, 2.197]],
  [[2.835, 2.914], [2.200, 2.165]]
];

console.log('\n═══ Cifrele zilei de 04.08: segmentele se contrazic, deci nu se învață ═══');
{
  const c = makeCalibrator();
  const r1 = c.adauga(2.634, 2.678);          // box 4 → 8: −1,6%
  ok('un SINGUR segment nu mai calibrează nimic',
     r1.stare === 'asteapta' && c.factor === 1, JSON.stringify({ stare: r1.stare, factor: c.factor }));
  ok('și spune de ce, în cuvinte', /un singur segment/.test(r1.motiv || ''), r1.motiv);
  const r2 = c.adauga(2.282, 2.211);          // box 8 → 12: +3,2%, semn opus
  ok('nici a doua măsurătoare, când bate cap în cap cu prima',
     r2.stare === 'asteapta' && c.factor === 1,
     JSON.stringify({ stare: r2.stare, motiv: r2.motiv, factor: c.factor }));
  ok('motivul e chiar ăsta: e zgomot, nu eroare', /contrazic/.test(r2.motiv || ''), r2.motiv);
  ok('împrăștierea măsurată e mai mare decât abaterea mediei',
     r2.marja > Math.abs(r2.medie - 1),
     `medie ${r2.medie.toFixed(4)} · marjă ±${r2.marja.toFixed(4)}`);
  // toată ziua, toate cele cinci ture: niciun factor aplicat
  const factori = ZIUA_04_08.map(tura => {
    const cc = makeCalibrator();
    for (const [of_, mas] of tura) cc.adauga(of_, mas);
    return cc.factor;
  });
  ok('toate cele 5 ture din zi rămân la factor 1 (nu se învață zgomotul roadbook-ului)',
     factori.every(f => f === 1), JSON.stringify(factori));
  // versiunea veche, pentru contrast: raport acumulat, aplicat din prima
  const vechi = ZIUA_04_08.map(t => (t[0][0] / t[0][1]).toFixed(3));
  ok('(pentru contrast: versiunea veche aplica din prima 0,984 / 1,015 / 1,006 / 0,967 / 0,973)',
     vechi.join(' ') === '0.984 1.015 1.006 0.967 0.973', vechi.join(' '));
}

console.log('\n═══ Eroare REALĂ, consecventă: se învață, dar în pași plafonați ═══');
{
  const c = makeCalibrator();
  // patru segmente care spun același lucru: odometrul măsoară cu 4% mai puțin
  const pasi = [c.adauga(2.50, 2.404), c.adauga(2.50, 2.400), c.adauga(2.50, 2.402), c.adauga(2.50, 2.398)];
  ok('prima măsurătoare tot nu face nimic', pasi[0].stare === 'asteapta');
  ok('a doua aplică, dar plafonat la 0,5%',
     pasi[1].stare === 'aplicat' && Math.abs(pasi[1].factor - 1.005) < 1e-9,
     JSON.stringify({ stare: pasi[1].stare, factor: pasi[1].factor, tinta: pasi[1].tinta.toFixed(4) }));
  ok('ținta văzută e cea adevărată (≈1,0417), doar drumul spre ea e lent',
     Math.abs(pasi[1].tinta - 1 / 0.96) < 0.004, pasi[1].tinta.toFixed(4));
  ok('a treia are voie cu 1%, a patra cu 1,5% (plafonul crește cu dovada)',
     Math.abs(pasi[2].factor - 1.015) < 1e-9 && Math.abs(pasi[3].factor - 1.030) < 1e-9,
     JSON.stringify(pasi.slice(2).map(p => p.factor)));
  for (let i = 0; i < 4; i++) c.adauga(2.50, 2.401);
  ok('după încă patru segmente la fel, ajunge la valoarea adevărată',
     Math.abs(c.factor - 1 / 0.96) < 0.004, c.factor.toFixed(4));
}

console.log('\n═══ Media e ponderată cu lungimea segmentelor ═══');
{
  const c = makeCalibrator({ pragMinim: 0, k: 0 });   // fără gardul de semnificație
  c.adauga(4.00, 4.00);          // segment lung, perfect
  const r = c.adauga(0.60, 0.55); // segment scurt, +9% — nu are voie să dicteze
  ok('segmentul scurt trage media doar cât cântărește',
     r.medie > 1.005 && r.medie < 1.015, `medie ${r.medie.toFixed(4)} (nepondera: 1,045)`);
  ok('și oricum pasul e plafonat', Math.abs(c.factor - 1.005) < 1e-9, c.factor.toFixed(4));
}

console.log('\n═══ Gardurile vechi rămân în picioare ═══');
{
  const c = makeCalibrator();
  ok('segmentul sub 0,5 km nu intră deloc în calcul',
     c.adauga(0.40, 0.38).stare === 'scurt');
  ok('raportul aberant (snap greșit) e refuzat, nu mediat',
     c.adauga(5.41, 3.00).stare === 'refuzat', JSON.stringify(c.stare()));
  ok('și niciunul dintre ele nu s-a numărat ca segment', c.stare().n === 0);
  const c2 = makeCalibrator();
  c2.adauga(2.50, 2.50); c2.adauga(2.50, 2.50);
  ok('un odometru corect nu se „calibrează" degeaba', c2.factor === 1, c2.factor.toFixed(4));
}

console.log('\n═══ Pe mașina de stări: un segment de 2,6 km nu mai mișcă nimic ═══');
{
  const w = lume(0.96);
  ok('pornește necalibrat', w.m.M.calFactor === 1);
  w.condu(0.40); w.m.atBox(5);
  ok('segment scurt (0,4 km) NU calibrează', w.m.M.calFactor === 1, String(w.m.M.calFactor));
  w.condu(3.00); w.m.atBox(9);
  ok('nici segmentul de 2,6 km, singur, nu calibrează (defectul din 04.08)',
     w.m.M.calFactor === 1, w.m.M.calFactor.toFixed(4));
  ok('dar măsurătoarea intră în jurnal, cu tot cu motiv',
     w.store.journal.some(e => e.type === 'cal_asteapta' && /un singur segment/.test(e.motiv)),
     JSON.stringify(w.store.journal.filter(e => /^cal/.test(e.type))));
  ok('și nu se anunță nimic la volan',
     !w.said.some(s => /calibrat|Calibrare/i.test(s)), JSON.stringify(w.said.slice(-3)));
}

console.log('\n═══ Pe mașina de stări: patru segmente consecvente ═══');
{
  const w = lume(0.96, BOX_LUNG);
  w.condu(2.50); w.m.atBox(2);
  w.condu(5.00); w.m.atBox(3);
  ok('la a doua confirmare factorul se mișcă, controlat',
     Math.abs(w.m.M.calFactor - 1.005) < 1e-9, w.m.M.calFactor.toFixed(4));
  ok('jurnalul are cifrele pe care se sprijină decizia',
     w.store.journal.some(e => e.type === 'calibrare' && e.imprastiere != null && e.marja != null),
     JSON.stringify(w.store.journal.filter(e => e.type === 'calibrare')));
  w.condu(7.50); w.m.atBox(4);
  w.condu(10.00); w.m.atBox(5);
  ok('după patru segmente, ≈3% recuperați din 4%',
     w.m.M.calFactor > 1.028 && w.m.M.calFactor < 1.032, w.m.M.calFactor.toFixed(4));
  const inainte = w.m.M.routeKm;
  w.condu(11.00);
  const eroareProc = Math.abs((w.m.M.routeKm - inainte) - 1.00) * 100;
  ok('eroarea pe 1 km a scăzut sub 1,2% (era 4%)', eroareProc < 1.2, eroareProc.toFixed(2) + '%');
}

console.log('\n═══ Snap greșit: nu se învață o prostie ═══');
{
  const w = lume(1.0);
  w.condu(3.00);
  // Sărim la boxul de final: raport 5,43/3,00 = absurd. Saltul e mare, deci de la
  // 02.08.2026 cere confirmare — o dăm explicit, ca să testăm ce ne interesează aici:
  // chiar și când omul confirmă o prostie, calibrarea nu are voie s-o învețe.
  ok('un salt de 2,4 km nu se face fără confirmare', w.m.atBox(14) !== true);
  w.m.atBox(14, true);
  ok('raportul aberant e refuzat', w.m.M.calFactor === 1, w.m.M.calFactor.toFixed(4));
  ok('refuzul e scris în jurnal, cu cifre',
     w.store.journal.some(e => e.type === 'cal_refuzat'),
     JSON.stringify(w.store.journal.filter(e => e.type === 'cal_refuzat')));
}

console.log('\n═══ Proba nu-și ține propriul odometru ═══');
{
  // Înainte, distanța din probă se aduna separat — deci avea propriile erori exact
  // acolo unde precizia decide puncte, iar corecțiile de poziție n-o atingeau.
  // Acum se DERIVĂ din poziția pe traseu: o singură sursă de adevăr.
  const w = lume(0.96);
  w.condu(0.70);                    // RT1 (auto, la 0,60) pornește singură
  ok('proba a pornit la trecerea liniei', w.m.M.state === 'RT_RUN', w.m.M.state);
  const inv = () => Math.abs(w.m.M.rt.distKm - (w.m.M.routeKm - w.m.M.rt.def.startKm));
  ok('distanța probei = poziția − linia de start', inv() < 1e-9, inv().toExponential(2));
  w.condu(1.60);
  ok('invariantul ține și după 0,9 km', inv() < 1e-9, inv().toExponential(2));
  const eroareM = Math.abs(w.m.M.rt.distKm - (1.60 - 0.60)) * 1000;
  ok('și distanța e aproape de realitate, cu odometru de −4%', eroareM < 40,
     `${w.m.M.rt.distKm.toFixed(3)} km (eroare ${Math.round(eroareM)} m)`);
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
