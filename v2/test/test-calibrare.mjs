// RALI 2 — auto-calibrarea odometrului.
// Contextul real (aflat de la Andreas, 2026-08-01): la Sibiu roadbook-ul vine cu o oră
// înainte de start, deci recunoaștere NU se poate face. Poziția vine din odometru, iar
// singura apărare împotriva erorii sistematice de GPS e rigla din roadbook: între două
// boxuri confirmate fizic, distanța oficială e adevărul.
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
  { num: 5, sumKm: 0.38, dir: 'STÂNGA', comment: 'inapoi pe Principala' },
  { num: 6, sumKm: 0.60, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
  { num: 8, sumKm: 2.60, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' },
  { num: 9, sumKm: 2.98, dir: 'GIRATORIU-4', comment: 'Kaufland' },
  { num: 14, sumKm: 5.41, dir: 'ÎNAINTE', flag: 'TC', comment: 'Finish' }
]);

// lume cu un GPS care raportează sistematic `eroare`× din distanța reală
function lume(eroare) {
  let wall = 0, realKm = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const said = [];
  const store = makeMemStore();
  const plan = buildPlan(BOX, {}, null);
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

console.log('\n═══ Odometru care măsoară cu 4% MAI PUȚIN ═══');
{
  const w = lume(0.96);
  ok('pornește necalibrat', w.m.M.calFactor === 1);
  w.condu(0.40); w.m.atBox(5);
  ok('segment scurt (0,4 km) NU calibrează', w.m.M.calFactor === 1, String(w.m.M.calFactor));
  w.condu(3.00); w.m.atBox(9);
  const f = w.m.M.calFactor;
  ok('după un segment de 2,6 km, factorul ≈ 1/0,96', Math.abs(f - 1 / 0.96) < 0.004, f.toFixed(4));
  ok('calibrarea e anunțată vocal', w.said.some(s => /calibrat/i.test(s)),
     JSON.stringify(w.said.slice(-2)));
  // precizia după calibrare, pe kilometrul următor
  const inainte = w.m.M.routeKm;
  w.condu(4.00);
  const eroareProc = Math.abs((w.m.M.routeKm - inainte) - 1.00) * 100;
  ok('eroarea pe 1 km scade sub 0,5% (era 4%)', eroareProc < 0.5, eroareProc.toFixed(2) + '%');
}

console.log('\n═══ Odometru care măsoară cu 3% MAI MULT ═══');
{
  const w = lume(1.03);
  w.condu(3.00); w.m.atBox(9);
  ok('factorul scade sub 1', w.m.M.calFactor < 1 && Math.abs(w.m.M.calFactor - 1 / 1.03) < 0.004,
     w.m.M.calFactor.toFixed(4));
}

console.log('\n═══ Odometru corect: nu strica nimic ═══');
{
  const w = lume(1.0);
  w.condu(3.00); w.m.atBox(9);
  ok('factorul rămâne ≈ 1', Math.abs(w.m.M.calFactor - 1) < 0.003, w.m.M.calFactor.toFixed(4));
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
