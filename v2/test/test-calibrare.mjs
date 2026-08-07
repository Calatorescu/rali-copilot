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
function lume(eroare, boxes = BOX, opts) {
  let wall = 0, realKm = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const said = [];
  const store = makeMemStore();
  const plan = buildPlan(boxes, {}, null);
  const m = makeMachine({ plan, clock, store, driver: makeDriverModel(),
    voice: { say: t => said.push(t), tone() {}, flush() {} }, ui: { render() {} }, opts });
  m.start();
  // fix de „încălzire" la linia de start: în realitate mașina stă pe loc și primește
  // fixuri înainte de a pleca. Fără el, primul fix (care n-are cu ce se compara) pierde
  // ~12 m și falsifică raportul de calibrare cu ~0,4%.
  wall += 1000;
  m.onFix({ lat: 45, lng: 21, tMs: wall, speedMs: 0, accM: 8 });
  const api = {
    m, store, said, plan,
    condu(panaLa, kmh = 45) {
      while (realKm < panaLa - 1e-9) {
        const pas = Math.min(kmh / 3600, panaLa - realKm);
        realKm += pas; wall += 1000;
        m.onFix({ lat: 45 + realKm / 111.32, lng: 21, tMs: wall, speedMs: pas * eroare * 1000, accM: 8 });
      }
    },
    // aceeași conducere, dar cu distanța dată RELATIV la unde ești („mai mergi 1,5 km") —
    // scenariile de rătăcire se citesc altfel decât cu kilometri absoluți
    mai(dKm, kmh = 45) { api.condu(realKm + dKm, kmh); },
    cal() { return store.journal.filter(e => /^cal/.test(e.type)); },
    get realKm() { return realKm; }
  };
  return api;
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

// ═════════════════════════════════════════════════════════════════════════════
// RĂTĂCIREA NU E DISTANȚĂ DE ROADBOOK (Sibiu, 07.08.2026)
//
// Defectul, măsurat în jurnalul zilei: la 13:13:41 a intrat în calibrare segmentul
// boxul 39 → boxul 45, cu 7,47 km oficiali și 8,719 km măsurați (raport 0,857). Cei
// 1,25 km în plus erau rătăcirea din TR 1 — pilotul ieșise de pe traseu la 13:10:44
// (`offroute_intrare`, routeKm 13,47) și n-a revenit decât la 13:18:48. Kilometrii ăia
// au fost conduși pe alte străzi: NU există în roadbook, deci nu spun nimic despre
// odometru. Calibratorul i-a crezut, cu greutatea lor de 8,7 km, și a tras factorul
// 0,985 → 0,965 → 0,940, oprit la 0,957 pentru restul zilei. Media raporturilor pe
// segmentele CURATE ale aceleiași zile e 0,998: odometrul era bun, minusul e inventat.
//
// Statistica din makeCalibrator nu putea salva nimic: ea apără de ZGOMOT în jurul
// adevărului, nu de o măsurătoare care descrie alt drum. Un rând fals se aruncă.
const OFI = { offRoute: false };   // detectorul automat oprit, când testăm un singur declanșator

console.log('\n═══ Rătăcirea: segmentul poluat se ARUNCĂ, nu se mediază ═══');
{
  // cazul real, cifră cu cifră: 7,47 km oficiali între două boxuri, 8,719 km conduși
  const SEG = sanitizeBoxes([
    { num: 39, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { num: 45, sumKm: 7.47, dir: 'DREAPTA', comment: 'reper' }
  ]);
  const w = lume(1.0, SEG);          // odometru PERFECT: tot ce iese din 1,00 e rătăcirea
  w.mai(4.00);
  w.m.offRouteManual();              // 13:10:44 — „am greșit drumul"
  w.mai(4.719);                      // rătăcirea: 8,719 km măsurați pe 7,47 oficiali
  ok('steagul de poluare e sus cât ești în afara traseului',
     w.m.M._calPoluat === 'offroute', String(w.m.M._calPoluat));
  w.m.atBox(45, true);               // 13:13:41 — „SUNT LA BOX 45", salt confirmat
  const r = w.cal().find(e => e.type === 'cal_refuzat');
  ok('segmentul rătăcit e refuzat, nu mediat', !!r, JSON.stringify(w.cal()));
  ok('cu motivul scris pe față în jurnal', r && r.motiv === 'offroute', r && r.motiv);
  ok('și cu cifrele reale din 07.08 (7,47 oficial · 8,719 măsurat · 0,857)',
     r && r.oficial === 7.47 && r.masurat === 8.719 && r.raport === 0.857, JSON.stringify(r));
  ok('calibratorul a primit ZERO măsurători', w.m.M._calN === 0, String(w.m.M._calN));
  ok('deci factorul nu se mișcă', w.m.M.calFactor === 1, w.m.M.calFactor.toFixed(4));

  // Cât a costat exact pasul ăsta, în cifrele zilei: la 13:13:41 calibratorul avea deja
  // trei măsurători (jurnalul scrie `dinMasuratori: 4`). Cu segmentul rătăcit al patrulea,
  // ținta a sărit la 0,906 și factorul la 0,985 — de acolo a pornit alunecarea spre 0,940.
  const inainte = [[1.1, 1.113], [1.97, 1.914], [0.7, 0.657]];
  const fara = makeCalibrator(); for (const p of inainte) fara.adauga(...p);
  const cu = makeCalibrator(); for (const p of inainte) cu.adauga(...p);
  const pas4 = cu.adauga(7.47, 8.719);
  ok('fără el, cele trei măsurători dinainte lăsau factorul la 1',
     fara.factor === 1 && fara.segmente === 3, fara.factor.toFixed(4));
  ok('cu el, exact ce scrie în jurnal: țintă 0,906, factor 0,985, din 4 măsurători',
     Math.abs(pas4.tinta - 0.9062) < 0.0005 && Math.abs(cu.factor - 0.985) < 1e-9 && pas4.n === 4,
     JSON.stringify({ tinta: pas4.tinta, factor: cu.factor, n: pas4.n }));
}

console.log('\n═══ După rătăcire, următorul segment pornește curat ═══');
{
  const w = lume(1.0, BOX_LUNG);
  w.condu(2.50); w.m.atBox(2);
  ok('primul segment, curat, intră normal', w.m.M._calN === 1, String(w.m.M._calN));
  w.mai(1.50);
  w.m.offRouteManual();
  w.mai(1.00);                       // revine pe traseu singură, la punctul boxului 3
  ok('ieșirea de pe traseu s-a închis', !w.m.M.offRoute);
  ok('segmentul care conținea rătăcirea n-a ajuns la calibrator',
     w.m.M._calN === 1 && w.cal().some(e => e.type === 'cal_refuzat' && e.motiv === 'offroute'),
     JSON.stringify(w.cal()));
  ok('steagul s-a coborât odată cu segmentul aruncat',
     w.m.M._calPoluat === null, String(w.m.M._calPoluat));
  w.mai(2.50); w.m.atBox(4);
  ok('iar segmentul URMĂTOR, curat, intră ca oricare altul',
     w.m.M._calN === 2 && w.cal().some(e => e.type === 'cal_asteapta' && e.dinMasuratori === 2),
     JSON.stringify(w.cal()));
}

console.log('\n═══ Ne-regresie: fără rătăcire nu se schimbă nimic ═══');
{
  // exact aceiași kilometri, fără ieșire de pe traseu: toate trei segmentele intră
  const w = lume(1.0, BOX_LUNG);
  w.condu(2.50); w.m.atBox(2);
  w.condu(5.00); w.m.atBox(3);
  w.condu(7.50); w.m.atBox(4);
  ok('trei segmente conduse, trei măsurători în calibrator', w.m.M._calN === 3, String(w.m.M._calN));
  ok('și niciun refuz în jurnal',
     !w.cal().some(e => e.type === 'cal_refuzat'), JSON.stringify(w.cal()));
  // și odometrul greșit se învață mai departe, ca înainte
  const w2 = lume(0.96, BOX_LUNG);
  w2.condu(2.50); w2.m.atBox(2);
  w2.condu(5.00); w2.m.atBox(3);
  ok('un odometru cu eroare reală se calibrează în continuare',
     Math.abs(w2.m.M.calFactor - 1.005) < 1e-9, w2.m.M.calFactor.toFixed(4));
}

console.log('\n═══ Corecția manuală mare: și ea poluează segmentul ═══');
{
  // 5,00 km oficiali, 5,45 conduși → saltul cerut la box e de 424 m, peste pragul „mare"
  // (400 m, același care cere confirmarea în previzualizeazaBox). Raportul 0,917 e ÎN
  // plaja acceptată de calibrator, deci fără steag ar fi intrat și ar fi tras factorul.
  const w = lume(1.0, BOX_LUNG, OFI);
  w.condu(5.45);
  ok('saltul de 424 m cere confirmare (pragul „mare")', w.m.atBox(3) !== true);
  w.m.atBox(3, true);
  const r = w.cal().find(e => e.type === 'cal_refuzat');
  ok('segmentul e aruncat, cu motivul lui', r && r.motiv === 'salt_pozitie', JSON.stringify(w.cal()));
  ok('calibratorul n-a primit nimic', w.m.M._calN === 0, String(w.m.M._calN));

  // sub prag: corecția mică e viața de zi cu zi, nu are voie să blocheze învățarea
  const w2 = lume(1.0, BOX_LUNG, OFI);
  w2.condu(5.30);
  ok('o corecție de 274 m nici măcar nu cere confirmare', w2.m.atBox(3) === true);
  ok('și segmentul intră normal în calibrator', w2.m.M._calN === 1, String(w2.m.M._calN));
  ok('cu raportul lui, nemodificat',
     w2.cal().some(e => e.type === 'cal_asteapta' && e.raportSegment === 0.943),
     JSON.stringify(w2.cal()));
}

// Ziua reală, segment cu segment, extrasă din jurnalul 07.08.2026 (leg-ul pornit la
// 12:47:58, terminat la 16:09:54): [oficial, măsurat, poluat]. „Poluat" = segmentul
// s-a măsurat într-o fereastră în care mașina era, măcar o parte din timp, în afara
// traseului — exact ce marchează acum steagul. 42 de segmente, 24 poluate.
const ZIUA_07_08 = [
  [1.1, 1.113, 1], [1.97, 1.914, 1], [1.56, 1.857, 1], [0.7, 0.657, 1], [7.47, 8.719, 1],
  [1.49, 0.828, 1], [0.63, 0.638, 1], [6.52, 6.817, 1], [0.96, 0.809, 1], [0.54, 0.654, 1],
  [5.61, 5.521, 0], [1.57, 1.568, 0], [2.09, 2.111, 0], [3.467, 3.619, 0], [0.583, 0.976, 1],
  [2.52, 1.93, 1], [3.34, 3.279, 1], [1.51, 1.936, 0], [0.745, 0.834, 0], [1.415, 1.892, 1],
  [6.7, 6.349, 1], [1.47, 1.413, 1], [5.04, 4.997, 0], [0.69, 1.069, 0], [8.61, 7.635, 1],
  [3.28, 3.114, 1], [2.1, 1.854, 1], [0.56, 0.547, 0], [1.32, 1.749, 0], [0.53, 0.985, 0],
  [0.68, 0.627, 0], [8.05, 7.998, 0], [1.67, 1.664, 1], [3.1, 2.941, 1], [1.37, 1.342, 0],
  [5.87, 5.808, 0], [1.86, 1.868, 0], [4.32, 4.31, 1], [0.55, 0.604, 1], [1.52, 1.682, 0],
  [3.39, 1.822, 0], [1.03, 0.928, 1]
];

console.log('\n═══ Ziua de 07.08, rulată din nou: −4,3% devine +0,5% ═══');
{
  const ruleaza = (aruncaPoluate) => {
    const c = makeCalibrator(); const drum = [];
    for (const [of_, mas, poluat] of ZIUA_07_08) {
      if (aruncaPoluate && poluat) continue;
      c.adauga(of_, mas); drum.push(c.factor);
    }
    return { factor: c.factor, min: Math.min(...drum), max: Math.max(...drum),
             n: c.segmente, medie: c.stare().medie };
  };
  const azi = ruleaza(false), reparat = ruleaza(true);
  // întâi verificăm că replay-ul chiar reproduce ziua: jurnalul are exact valorile astea
  ok('replay-ul reproduce factorii din jurnal (0,940 minim, 0,957 la final)',
     Math.abs(azi.min - 0.940) < 0.0005 && Math.abs(azi.factor - 0.957) < 0.0005,
     `min ${azi.min.toFixed(4)} · final ${azi.factor.toFixed(4)}`);
  ok('azi odometrul a numărat toată ziua cu −4,3%, din rătăciri',
     azi.factor < 0.96, azi.factor.toFixed(4));
  ok('cu segmentele poluate aruncate, factorul rămâne ~1,00',
     Math.abs(reparat.factor - 1) <= 0.006, reparat.factor.toFixed(4));
  ok('și nu coboară sub 1 în nicio clipă a zilei',
     reparat.min >= 1 && reparat.max <= 1.006,
     `min ${reparat.min.toFixed(4)} · max ${reparat.max.toFixed(4)}`);
  // Aruncarea nu lasă calibrarea fără hrană: din 42 de segmente, 18 sunt curate, iar
  // 13 dintre ele trec și de gardurile vechi (lungime + plajă). Cu 13 măsurători bune,
  // o eroare REALĂ de odometru s-ar fi văzut oricum.
  ok('rămân 18 segmente curate din 42, dintre care 13 ajung la calibrator',
     ZIUA_07_08.filter(s => !s[2]).length === 18 && reparat.n === 13,
     `curate ${ZIUA_07_08.filter(s => !s[2]).length} · acceptate ${reparat.n}`);
  // dovada că nu odometrul era de vină: pe segmentele curate, media e 0,998
  ok('iar odometrul, măsurat doar pe drum de roadbook, era bun de la început (0,998)',
     Math.abs(reparat.medie - 0.998) < 0.001, reparat.medie.toFixed(4));
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
