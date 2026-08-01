// RALI 2 — simularea unei ZILE COMPLETE prin mașina de stări reală.
// Traseul de test = legul Dumbrăvița–Iulius (cel condus efectiv de Andreas azi),
// cu recunoaștere sintetică (urmă + zone lente) ca să se exercite și banca de timp.
// Rulează: node v2/test/test-day.mjs

import { makeClock } from '../js/time.js';
import { buildTrace } from '../js/geo.js';
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore, exportDay, importDay, resumeStateFromJournal } from '../js/store.js';
import { makeDriverModel } from '../js/learn.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// ── lumea sintetică ──────────────────────────────────────────────────────────
function makeWorld() {
  let wallMs = new Date('2026-08-07T12:00:00').getTime();
  const clock = makeClock({ now: () => wallMs, mono: () => wallMs });
  const said = [];
  const voice = { say: (t, p, c) => said.push({ t, p, c }), tone: k => said.push({ tone: k }), flush() {} };
  const store = makeMemStore();
  const ui = { render() {} };
  const driver = makeDriverModel();
  return { clock, voice, store, ui, driver, said,
           tick: ms => { wallMs += ms; }, wall: () => wallMs };
}

// roadbook-ul Iulius v2 (kilometrii reali din test)
const BOXES = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start / TC 1' },
  { num: 2, sumKm: 0.15, dir: 'STÂNGA-T', comment: 'Bălcescu' },
  { num: 3, sumKm: 0.70, dir: 'GIRATORIU-3', comment: 'Petőfi / DJ691' },
  { num: 4, sumKm: 2.30, dir: 'GIRATORIU-1', comment: 'Kaufland' },
  { num: 5, sumKm: 2.65, dir: 'GIRATORIU-2', comment: 'DJ691' },
  { num: 6, sumKm: 3.10, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 46.8 km/h' },
  { num: 7, sumKm: 3.70, dir: 'ÎNAINTE', comment: 'DJ691' },
  { num: 8, sumKm: 4.20, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' },
  { num: 9, sumKm: 4.30, dir: 'GIRATORIU-1', comment: 'Sever Bocu' },
  { num: 10, sumKm: 4.35, dir: 'ÎNAINTE', flag: 'RT_START_STANDING', comment: 'START RT 2 · 24.3 km/h' },
  { num: 11, sumKm: 4.65, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 2' },
  { num: 12, sumKm: 4.70, dir: 'STÂNGA', comment: 'Aradului' },
  { num: 13, sumKm: 5.19, dir: 'DREAPTA', comment: 'Consiliul Europei' },
  { num: 14, sumKm: 5.40, dir: 'ÎNAINTE', flag: 'TC', comment: 'Finish / TC 2' }
]);

// urmă sintetică 1:1 cu kilometrajul (5.4 km spre nord) + mostre cu o zonă lentă
// în interiorul lui RT1 (giratoriul „virtual" de la km 3.6 → 300 m încetiniți)
function makeRecon() {
  const pts = [];
  for (let m = 0; m <= 5400; m += 15) pts.push({ lat: 45 + m / 111320, lng: 21 });
  const trace = buildTrace(pts);
  const samples = [];
  for (let m = 0; m <= 5400; m += 20)
    samples.push({ cumM: m, kmh: (m >= 3500 && m <= 3800) ? 20 : 50 });
  const anchors = [{ officialKm: 0, traceM: 0 }, { officialKm: 5.4, traceM: trace.totalM }];
  return { trace, samples, anchors };
}

// „conduce" mașina: fixuri sintetice de-a lungul urmei la viteze date
function drive(world, mach, recon, fromM, toM, kmh, stepMs = 1000) {
  let m = fromM;
  while (m < toM) {
    const ms = kmh / 3.6;
    m = Math.min(toM, m + ms * (stepMs / 1000));   // fără depășirea țintei — șoferul
    world.tick(stepMs);                            // sintetic oprește UNDE i se spune
    const f = posAt(recon.trace, m);
    mach.onFix({ lat: f.lat, lng: f.lng, tMs: world.wall(), speedMs: ms, headingDeg: null, accM: 8 });
  }
  return m;
}
function idle(world, mach, recon, atM, seconds) {
  for (let i = 0; i < seconds; i++) {
    world.tick(1000);
    const f = posAt(recon.trace, atM);
    mach.onFix({ lat: f.lat, lng: f.lng, tMs: world.wall(), speedMs: 0, headingDeg: null, accM: 8 });
  }
}
function posAt(trace, m) {
  const pts = trace.pts;
  if (m >= pts[pts.length - 1].cum) return pts[pts.length - 1];
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1].cum < m) i++;
  const a = pts[i], b = pts[i + 1];
  const f = (m - a.cum) / Math.max(1e-6, b.cum - a.cum);
  return { lat: a.lat + f * (b.lat - a.lat), lng: a.lng + f * (b.lng - a.lng) };
}

console.log('═══ ZIUA COMPLETĂ, fără nicio apăsare ═══');
const world = makeWorld();
const recon = makeRecon();
const plan = buildPlan(BOXES, {}, recon);
ok('planul: 2 probe, viteze din roadbook', plan.rts.length === 2 &&
   plan.rts[0].kmh === 46.8 && plan.rts[1].kmh === 24.3);
ok('RT1 are zona lentă din recunoaștere', plan.rts[0].zones.length === 1 &&
   plan.rts[0].zones[0].fromM > 350 && plan.rts[0].zones[0].fromM < 500,
   JSON.stringify(plan.rts[0].zones));

const mach = makeMachine({ ...world, plan });
mach.start();
mach.setTcSchedule([{ name: 'TC 1', time: '12:00' }, { name: 'TC 2', time: '12:25' }]);

// legătura până înainte de RT1, la 40 km/h
let m = drive(world, mach, recon, 0, 3050, 40);
ok('poziția pe traseu din proiecție (~3.05 km)', Math.abs(mach.M.routeKm - 3.05) < 0.06,
   String(mach.M.routeKm));
ok('avertizat „proba în 500"', world.said.some(s => s.t && /Proba în 500/.test(s.t)));
ok('planul de bancă anunțat ÎNAINTE de start (zona lentă din față)',
   world.said.some(s => s.t && /^Plan: ia /.test(s.t)),
   JSON.stringify(world.said.filter(s => s.t && /Plan/.test(s.t))));

// RT1 auto-start: trece de linie în mers; conduce ținta, cu zona lentă la 20 km/h
m = drive(world, mach, recon, m, 3120, 46.8);
ok('RT1 pornit automat', mach.M.state === 'RT_RUN' && mach.M.rt.def.name === 'RT1');
m = drive(world, mach, recon, m, 3500, 46.8);
ok('banca de timp cerută în timpul probei', world.said.some(s => s.t && /^Bancă: ia/.test(s.t)));
m = drive(world, mach, recon, m, 3800, 20);      // zona lentă — pierde timp
m = drive(world, mach, recon, m, 4200, 55);      // recuperează
m = drive(world, mach, recon, m, 4280, 50);
ok('RT1 închis automat după finish', mach.M.state === 'LIAISON' && mach.M.results.RT1 != null,
   JSON.stringify(mach.M.results));
ok('rezultatul RT1 plauzibil (zona lentă a costat)', mach.M.results.RT1 > 5,
   String(mach.M.results.RT1));

// RT2 standing: oprit la linie, pleacă — proba pornește la plecare.
// Ținta de oprire se ia prin harta de ancore (linia e în km OFICIALI, șoferul
// sintetic conduce în metri de urmă — scara diferă cu ~0,1%).
const lineM = plan.anchorMap.traceM(4.348);
m = drive(world, mach, recon, m, lineM, 30);
idle(world, mach, recon, lineM, 8);
ok('STAGED la linie', mach.M.state === 'STAGED');
ok('„pornesc când pleci" spus', world.said.some(s => s.t && /Pornesc când pleci/.test(s.t)));
m = drive(world, mach, recon, m, 4650, 24.3);
ok('RT2 pornit la plecare și rulează exact pe medie', mach.M.state === 'RT_RUN' || mach.M.results.RT2 != null);
m = drive(world, mach, recon, m, 4720, 24.3);
ok('RT2 închis, rezultat mic (condus perfect)', mach.M.results.RT2 != null && mach.M.results.RT2 < 3,
   String(mach.M.results.RT2));
ok('virajul de la 50 m după finish, anunțat imediat', world.said.some(s =>
   s.t && (/Urmează: .*stânga/.test(s.t) || /stânga acum/.test(s.t))));

// restul legului + finalul
m = drive(world, mach, recon, m, 5420, 40);
ok('ziua închisă singură la ultimul box', mach.M.state === 'DAY_END');
ok('totalul spus la final', world.said.some(s => s.t && /Final de zi/.test(s.t)));

console.log('═══ Debrief ═══');
{
  const deb = mach.M.lastDebrief;
  ok('debrief pentru RT2', deb && deb.name === 'RT2');
  const jr = world.store.journal.filter(e => e.type === 'rt_result');
  ok('ambele rezultate în jurnal, cu felii vinovate', jr.length === 2 && jr[0].worst.length >= 0);
}

console.log('═══ Preluarea pe al doilea telefon (failover) ═══');
{
  // exportăm ziua primului telefon la un moment din mijlocul ei — simulăm re-rulând
  // până în mijlocul lui RT2, apoi exportăm și preluăm pe o lume nouă
  const w2 = makeWorld();
  const p2 = buildPlan(BOXES, {}, recon);
  const m2 = makeMachine({ ...w2, plan: p2 });
  m2.start();
  const lm = p2.anchorMap.traceM(4.348);
  let mm = drive(w2, m2, recon, 0, lm, 40);
  idle(w2, m2, recon, lm, 6);
  mm = drive(w2, m2, recon, mm, 4500, 24.3);   // în plin RT2
  ok('telefonul 1 e în probă', m2.M.state === 'RT_RUN');
  const dump = await exportDay(w2.store);
  dump.plan_raw = BOXES;

  // telefonul 2: import + resume; ceasul raliului e comun → cronometrul continuă corect
  const w3 = makeWorld();
  w3.tick(w2.wall() - w3.wall());              // ceasul de perete al lumii 2
  const s3 = makeMemStore();
  await importDay(s3, dump);
  const st = resumeStateFromJournal(await s3.journalAll());
  ok('starea reconstruită: RT_RUN, poziție, index probă', st.state === 'RT_RUN' && st.routeKm > 4.3,
     JSON.stringify(st));
  const m3 = makeMachine({ clock: w3.clock, voice: w3.voice, store: s3, ui: w3.ui, driver: w3.driver, plan: p2 });
  m3.resume(st);
  ok('telefonul 2 e în probă, cu distanța corectă', m3.M.state === 'RT_RUN' &&
     Math.abs(m3.M.rt.distKm - (st.routeKm - 4.35)) < 0.05, JSON.stringify({ d: m3.M.rt.distKm }));
  let mmm = st.routeKm * 1000;
  mmm = drive(w3, m3, recon, mmm, 4720, 24.3);
  ok('telefonul 2 închide proba cu rezultat mic (cronometrul a supraviețuit preluării)',
     m3.M.results.RT2 != null && m3.M.results.RT2 < 4, String(m3.M.results.RT2));
}

console.log('═══ Modul umbră (recunoaștere fără voce) ═══');
{
  const w = makeWorld();
  const p = buildPlan(BOXES, {}, recon);
  const ms = makeMachine({ ...w, plan: p, opts: { shadow: true } });
  ms.start();
  drive(w, ms, recon, 0, 800, 40);
  ok('umbra tace', w.said.filter(s => s.t).length === 0, JSON.stringify(w.said.slice(0, 3)));
  ok('…dar ține minte ce-ar fi spus', w.store.journal.some(e => e.type === 'would_say'));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
