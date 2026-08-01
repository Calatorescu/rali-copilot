// RALI 2 — teste pe nucleul pur (rulează cu: node v2/test/test-core.mjs)
import { makeClock, parseRallyTime } from '../js/time.js';
import { haversineM, buildTrace, projectOnTrace, makeOdometer, angDiff } from '../js/geo.js';
import { idealTimeS, deviationS, recoverySpeed, slowZones, zoneLossS, bankingAdvice,
         devProfile, worstSlices, efficiencyPoints } from '../js/pace.js';
import { sanitizeBoxes, detectRts, makeAnchorMap, buildPlan } from '../js/route.js';
import { parseCommand, secRo } from '../js/voice.js';
import { makeDriverModel } from '../js/learn.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

console.log('═══ time ═══');
{
  let wall = 1000000;
  const c = makeClock({ now: () => wall, mono: () => wall });
  c.setOffsetMs(5000);
  ok('rally = wall + offset', c.rally() === 1005000);
  wall += 250;
  ok('mono curge', c.mono() === 1000250);
  const c2 = makeClock({ now: () => new Date('2026-08-07T10:00:00').getTime(), mono: () => 0 });
  const t = parseRallyTime('12:01', c2);
  ok('parseRallyTime azi', new Date(t).getHours() === 12 && new Date(t).getMinutes() === 1);
}

console.log('═══ geo: urmă + proiecție monotonă ═══');
{
  // urmă în L: 1 km nord, apoi 1 km est
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push({ lat: 45 + i * 0.00009, lng: 21 });
  for (let i = 1; i <= 100; i++) pts.push({ lat: 45.009, lng: 21 + i * 0.000128 });
  const tr = buildTrace(pts);
  ok('urma are ~2 km', near(tr.totalM, 2000, 60), String(tr.totalM));
  const p1 = projectOnTrace(tr, 45.0045, 21.0001, 400);
  ok('proiecție la jumătatea primului braț', p1 && near(p1.cumM, 500, 25), p1 && String(p1.cumM));
  // dus-întors: punct identic geografic, dar fereastra decide cotul corect
  const back = [...pts, ...[...pts].reverse().slice(1)];
  const tr2 = buildTrace(back);
  const pOut = projectOnTrace(tr2, 45.0045, 21.0001, 400);
  const pRet = projectOnTrace(tr2, 45.0045, 21.0001, tr2.totalM - 400);
  ok('dus: se proiectează pe prima trecere', pOut && pOut.cumM < 1000, pOut && String(pOut.cumM));
  ok('întors: pe a doua trecere (fereastra monotonă)', pRet && pRet.cumM > tr2.totalM - 1000,
     pRet && String(pRet.cumM));
  const far = projectOnTrace(tr, 45.02, 21.01, 500);
  ok('în afara coridorului → null', far === null);
}

console.log('═══ geo: odometrul fuzionat ═══');
{
  const o = makeOdometer();
  o.step({ lat: 45, lng: 21, tMs: 0, speedMs: 12, accM: 10 });
  const inc = o.step({ lat: 45.0001, lng: 21, tMs: 1000, speedMs: 12, accM: 10 });
  ok('integrarea vitezei', near(inc, 12, 0.01), String(inc));
  const o2 = makeOdometer();
  o2.step({ lat: 45, lng: 21, tMs: 0, speedMs: 12, accM: 10 });
  const inc2 = o2.step({ lat: 45.002, lng: 21, tMs: 20000, speedMs: null, accM: 90 });
  ok('gaură 20 s + acc slabă → ultima viteză', near(inc2, 240, 0.01), String(inc2));
  const o3 = makeOdometer();
  o3.step({ lat: 45, lng: 21, tMs: 0, speedMs: 0, accM: 10 });
  const inc3 = o3.step({ lat: 45.00054, lng: 21, tMs: 2000, speedMs: 0, accM: 10 });
  ok('viteza minte, poziția nu → haversine', inc3 > 50, String(inc3));
}

console.log('═══ pace: ideal, bancă, profil ═══');
{
  const segs = [{ fromKm: 0, kmh: 30 }, { fromKm: 3.06, kmh: 45 }];
  ok('ideal compus (RT6 Reșița: 13 km)', near(idealTimeS(13, segs), 3.06 / 30 * 3600 + 9.94 / 45 * 3600, 0.01));
  ok('deviere', near(deviationS(100, 0.5, [{ fromKm: 0, kmh: 30 }]), 100 - 60, 1e-6));
  const rec = recoverySpeed(6, 1, 3, [{ fromKm: 0, kmh: 30 }]);
  ok('recuperare plafonată ≤ +30%', rec.kmh <= 39 + 1e-9, String(rec.kmh));
  const samples = [];
  for (let m = 0; m <= 2000; m += 20) samples.push({ cumM: m, kmh: m >= 800 && m <= 1000 ? 15 : 40 });
  const z = slowZones(samples, 40);
  ok('zona lentă găsită la 800-1000', z.length === 1 && z[0].fromM === 800 && z[0].toM === 1000,
     JSON.stringify(z));
  ok('pierderea în zonă ~30 s', near(zoneLossS(z[0], 40), (0.2 / 15 - 0.2 / 40) * 3600, 0.5),
     String(zoneLossS(z[0], 40)));
  const adv = bankingAdvice(300, 40, z);
  ok('sfatul de bancă vine la 500 m înainte', adv && adv.inM === 500 && adv.bankS > 25,
     JSON.stringify(adv));
  ok('fără zonă în lookahead → null', bankingAdvice(0, 40, z, { lookaheadM: 400 }) === null);
  const log = [];
  for (let d = 0; d <= 1000; d += 50) log.push({ distKm: d / 1000, devS: d < 300 ? d / 100 : 3 });
  const prof = devProfile(log, 1.0, 250);
  ok('profilul pune pierderea în prima felie', prof[0].deltaS >= 2 && Math.abs(prof[3].deltaS) < 0.2,
     JSON.stringify(prof));
  ok('worstSlices o alege pe prima', worstSlices(prof, 1)[0] === prof[0]);
  ok('eficiență Sibiu ziua 2', near(efficiencyPoints(264.79, 200, 82, 2), -53.21, 0.01));
}

console.log('═══ route: sanitizare, probe, ancore ═══');
{
  const boxes = sanitizeBoxes([
    { num: 1, sumKm: '1,50', dir: 'VIREAZĂ!', flag: 'X', comment: 7 },
    { num: 2, sumKm: 2.2, dir: 'ÎNAINTE', flag: 'RT_START_STANDING', comment: 'START 24.3 km/h' },
    { num: 3, dir: 'STÂNGA', comment: 'fără km' },
    { num: 4, sumKm: 4.3, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' }
  ]);
  ok('sanitizare: km-șir convertit, dir ostil → null, box fără km eliminat',
     boxes.length === 3 && boxes[0].sumKm === 1.5 && boxes[0].dir === null && boxes[0].comment === '');
  const rts = detectRts(boxes);
  ok('proba detectată cu viteza din comentariu', rts.length === 1 && rts[0].kmh === 24.3 &&
     rts[0].type === 'standing' && near(rts[0].distKm, 2.1), JSON.stringify(rts));
  const am = makeAnchorMap([{ officialKm: 1, traceM: 900 }, { officialKm: 3, traceM: 3100 }]);
  ok('ancore: interpolare', near(am.officialKm(2000), 2, 1e-9), String(am.officialKm(2000)));
  ok('ancore: invers', near(am.traceM(2), 2000, 1e-9));
  ok('extrapolare cu panta segmentului sub prima ancoră',
     near(am.officialKm(400), 1 + (400 - 900) / 2200 * 2, 1e-9), String(am.officialKm(400)));
}

console.log('═══ voice: comenzi + rostire ═══');
{
  ok('„sunt la box 12"', JSON.stringify(parseCommand('sunt la box 12')) === '{"cmd":"at_box","num":12}');
  ok('„cât am"', parseCommand('cât am').cmd === 'status');
  ok('„viteza"', parseCommand('ce viteză am').cmd === 'speed');
  ok('secRo', secRo(3.44) === '3 virgulă 4' && secRo(3.96) === '4');
}

console.log('═══ learn: modelul șoferului ═══');
{
  const d = makeDriverModel();
  d.cueGiven(5, 0); d.turnDone(5, 2000);
  d.cueGiven(6, 10000); d.turnDone(6, 12000);
  d.cueGiven(7, 20000); d.turnDone(7, 22000);
  ok('latența converge spre ~2 s', Math.abs(d.latencyS() - 2) < 0.6, String(d.latencyS()));
  ok('leadM crește cu viteza', d.leadM(60) > d.leadM(30));
  d.cueGiven(8, 0); ok('gunoiul (25 s) nu intră', d.turnDone(8, 25000) === null);
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
