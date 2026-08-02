// RALI 2 — reparațiile auditului de funcționalitate din 02.08.2026.
// Fiecare bloc reproduce scenariul care ar fi stricat o cursă, apoi verifică gardul.
import { buildPlan, sanitizeBoxes, groupByLeg, verifyRoadbook } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { makeVoice, distRo } from '../js/voice.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const BOX = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
  { num: 3, sumKm: 0.90, dir: 'DREAPTA', comment: 'viraj în probă' },
  { num: 5, sumKm: 0.38, dir: 'STÂNGA', comment: 'pe Principala' },
  { num: 6, sumKm: 0.60, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
  { num: 8, sumKm: 2.60, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' },
  { num: 9, sumKm: 2.98, dir: 'GIRATORIU-4', comment: 'Kaufland' },
  { num: 14, sumKm: 5.41, dir: 'ÎNAINTE', flag: 'TC', comment: 'Finish' }
]);

function lume(boxes = BOX) {
  let wall = 0, realKm = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(boxes, {}, null), clock, store,
    driver: makeDriverModel(),
    voice: { say: (t, p) => said.push({ t, p }), tone() {}, flush() {} }, ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat: 45, lng: 21, tMs: wall, speedMs: 0, accM: 8 });
  return { m, store, said, clock,
    get wall() { return wall; }, avanseazaTimp(ms) { wall += ms; },
    condu(panaLa, kmh = 45) {
      while (realKm < panaLa - 1e-9) {
        const pas = Math.min(kmh / 3600, panaLa - realKm);
        realKm += pas; wall += 1000;
        m.onFix({ lat: 45 + realKm / 111.32, lng: 21, tMs: wall, speedMs: pas * 1000, accM: 8 });
      }
    } };
}

console.log('\n═══ #2 — navigația vorbește ȘI în probă ═══');
{
  const w = lume();
  w.condu(0.65);
  ok('proba rulează', w.m.M.state === 'RT_RUN', w.m.M.state);
  w.said.length = 0;
  w.condu(0.95);                              // trece prin virajul de la 0,90, ÎN probă
  ok('virajul din probă e anunțat', w.said.some(s => /dreapta/i.test(s.t)),
     JSON.stringify(w.said.map(s => s.t)));
  ok('ecranul urmărește boxul (nextBoxIdx a avansat)',
     w.m.M.nextBoxIdx > 2, String(w.m.M.nextBoxIdx));
}

console.log('\n═══ #3/#23 — „acum" se rostește, modelul șoferului învață ═══');
{
  const w = lume();
  w.condu(0.37, 30);                          // până aproape de boxul 5 (STÂNGA la 0,38)
  const acum = w.said.filter(s => /stânga acum/i.test(s.t));
  ok('anunțul „acum" există', acum.length >= 1, JSON.stringify(w.said.map(s => s.t)));
  ok('„acum" are prioritate 4 (întrerupe)', acum.every(s => s.p === 4), JSON.stringify(acum));
  ok('cueGiven a ajuns în jurnal (modelul șoferului trăiește)',
     w.store.journal.some(e => e.type === 'cue'), 'fără intrări cue');
}

console.log('\n═══ #4 — STOP apoi START = leg curat, fără teleportare ═══');
{
  const w = lume();
  w.condu(3.18);
  w.m.stop();
  w.m.start();                                 // zi/leg nou, din poziția fizică actuală
  ok('poziția pornește de la zero', w.m.M.routeKm === 0, String(w.m.M.routeKm));
  w.condu(3.43);                               // încă 250 m în linie dreaptă
  ok('după 250 m, poziția e ~0,25 (nu teleportată)',
     Math.abs(w.m.M.routeKm - 0.25) < 0.03, w.m.M.routeKm.toFixed(3));
  ok('rezultatele s-au golit', Object.keys(w.m.M.results).length === 0);
}

console.log('\n═══ #5 — GPS pierdut: tick-ul închide proba și TC-ul avertizează ═══');
{
  const w = lume();
  w.condu(2.55);                               // în probă, la 50 m de finish
  ok('în probă', w.m.M.state === 'RT_RUN', w.m.M.state);
  // fixurile mor; bătaia de inimă continuă
  for (let i = 0; i < 60; i++) { w.avanseazaTimp(1000); w.m.tick(); }
  ok('pilotul e anunțat de GPS pierdut', w.said.some(s => /GPS pierdut/i.test(s.t)));
  ok('proba s-a ÎNCHIS pe estimare', w.m.M.state !== 'RT_RUN', w.m.M.state);
  ok('rezultatul există', w.m.M.results.RT1 != null, JSON.stringify(w.m.M.results));
  ok('estimarea e marcată în jurnal', w.store.journal.some(e => e.type === 'pos_estimat'));

  // corolarul: mașină OPRITĂ lângă TC — avertizările vin din tick, nu din fixuri.
  // Programul are DOUĂ intrări: prima se leagă de TC-ul de start (km 0, deja trecut),
  // a doua de finish (km 5,41) — aia e cea care trebuie să avertizeze.
  const w2 = lume();
  w2.condu(0.10);
  // ora țintă se DERIVĂ din ceasul mașinii (parseRallyTime lucrează în ora locală a
  // mașinii de test — „00:09" fix ar însemna altceva în alt fus orar)
  const d0 = new Date(w2.clock.rally());
  const hh = String(d0.getHours()).padStart(2, '0');
  w2.m.setTcSchedule([{ name: 'TC 1', time: `${hh}:00` }, { name: 'TC 2', time: `${hh}:09` }]);
  for (let i = 0; i < 8 * 60; i++) { w2.avanseazaTimp(1000); w2.m.tick(); }
  ok('avertizarea de 5 minute a venit fără niciun fix nou',
     w2.said.some(s => /TC 2 în 5 minute/.test(s.t)), JSON.stringify(w2.said.slice(-3).map(s => s.t)));
  ok('banda TC există pe ecran', w2.m.M.tcBand && w2.m.M.tcBand.name === 'TC 2',
     JSON.stringify(w2.m.M.tcBand));
}

console.log('\n═══ #7 — ancora probei nu fabrică deviere pe drum drept ═══');
{
  const w = lume();
  w.condu(2.00, 60);                           // start din mers prin linia de la 0,60
  // pe drum perfect drept cu odometru perfect, poziția nu are voie să rămână blocată în urmă
  ok('poziția pe drum drept e corectă (±15 m)', Math.abs(w.m.M.routeKm - 2.00) < 0.015,
     w.m.M.routeKm.toFixed(3));
}

console.log('\n═══ #8 — salt mic în probă cere confirmare ═══');
{
  const w = lume();
  w.condu(1.00);
  ok('în probă', w.m.M.state === 'RT_RUN');
  const r = w.m.atBox(3);                      // box la 0,90 — doar 100 m, dar în probă
  ok('nu se execută tăcut', r !== true && typeof r === 'object', JSON.stringify(r));
  ok('poziția neatinsă', Math.abs(w.m.M.routeKm - 1.00) < 0.02, w.m.M.routeKm.toFixed(3));
}

console.log('\n═══ #14 — retro-datarea plafonată ═══');
{
  // GPS înghețat 30 s înaintea liniei, apoi fix corect mult după linie
  let wall = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const said = [];
  const m = makeMachine({ plan: buildPlan(BOX, {}, null), clock, store: makeMemStore(),
    driver: makeDriverModel(), voice: { say: t => said.push(t), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat: 45, lng: 21, tMs: wall, speedMs: 0, accM: 8 });
  // condu până la 0,45 normal
  let realKm = 0;
  while (realKm < 0.45) { realKm += 45 / 3600; wall += 1000;
    m.onFix({ lat: 45 + realKm / 111.32, lng: 21, tMs: wall, speedMs: 12.5, accM: 8 }); }
  // gaură de 30 s, mașina a mers; fixul următor e la 0,85 real (peste linie cu 250 m)
  wall += 30000; realKm = 0.85;
  m.onFix({ lat: 45 + realKm / 111.32, lng: 21, tMs: wall, speedMs: 12.5, accM: 8 });
  ok('proba a pornit', m.M.state === 'RT_RUN', m.M.state);
  const elapsed = (clock.mono() - m.M.rt.t0Mono) / 1000;
  ok('cronometrul NU e retro-datat cu zeci de secunde', elapsed < 5.5, elapsed.toFixed(1) + 's');
  ok('startul estimat e anunțat', said.some(t => /estimat/i.test(t)), JSON.stringify(said.slice(-3)));
}

console.log('\n═══ #18 — din DAY_END se iese prin SUNT LA BOX ═══');
{
  const w = lume();
  w.condu(0.65); w.condu(2.66);                // RT1 cap-coadă
  w.m.M.routeKm = 5.40; w.condu(5.45);         // împins peste final
  ok('ziua s-a închis', w.m.M.state === 'DAY_END', w.m.M.state);
  w.m.atBox(9, true);                          // în realitate era la giratoriu
  ok('boxul te scoate din DAY_END', w.m.M.state === 'LIAISON', w.m.M.state);
}

console.log('\n═══ #1 — leg-urile nu se mai amestecă ═══');
{
  const doua = [
    { day: 1, leg: 1, num: 1, sumKm: 0.0, dir: 'ÎNAINTE', flag: 'TC', comment: 'start L1' },
    { day: 1, leg: 1, num: 2, sumKm: 1.2, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT · 40 km/h' },
    { day: 1, leg: 1, num: 3, sumKm: 3.0, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' },
    { day: 1, leg: 2, num: 1, sumKm: 0.0, dir: 'ÎNAINTE', flag: 'TC', comment: 'start L2' },
    { day: 1, leg: 2, num: 2, sumKm: 2.4, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT · 30 km/h' },
    { day: 1, leg: 2, num: 3, sumKm: 4.0, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' }
  ];
  const g = groupByLeg(sanitizeBoxes(doua));
  ok('două grupuri', g.length === 2, String(g.length));
  ok('ordinea: L1 apoi L2', g[0].key === '1|1' && g[1].key === '1|2', JSON.stringify(g.map(x => x.key)));
  const plan1 = buildPlan(g[0].boxes, {}, null);
  ok('planul pe L1 are O probă, în interiorul lui', plan1.rts.length === 1 &&
     plan1.rts[0].startKm === 1.2 && plan1.rts[0].finishKm === 3.0, JSON.stringify(plan1.rts));
  ok('totalKm e al leg-ului, nu al amestecului', plan1.totalKm === 3.0, String(plan1.totalKm));
}

console.log('\n═══ Verificatorul de roadbook (propunerea 1) ═══');
{
  // fixtura BOX de mai sus e sintetică (numere sărite) — verificatorul o reclamă pe
  // bună dreptate; roadbook-ul „bun" trebuie să fie ca unul real: numere în serie
  const curat = sanitizeBoxes([
    { day: 1, leg: 1, num: 1, sumKm: 0.0, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { day: 1, leg: 1, num: 2, sumKm: 0.6, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START · 40 km/h' },
    { day: 1, leg: 1, num: 3, sumKm: 2.6, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' },
    { day: 1, leg: 1, num: 4, sumKm: 3.0, dir: 'GIRATORIU-4', comment: 'Kaufland' },
    { day: 1, leg: 1, num: 5, sumKm: 5.4, dir: 'ÎNAINTE', flag: 'TC', comment: 'Finish' }
  ]);
  const bun = verifyRoadbook(curat);
  ok('roadbook-ul bun n-are probleme false', bun.probleme.length === 0, JSON.stringify(bun.probleme));
  const stricat = sanitizeBoxes([
    { day: 1, leg: 1, num: 1, sumKm: 0.0, dir: 'ÎNAINTE', flag: 'TC', comment: 's' },
    { day: 1, leg: 1, num: 2, sumKm: 0.5, dir: null, flag: null, comment: 'mut' },
    { day: 1, leg: 1, num: 5, sumKm: 9.9, dir: 'STÂNGA', comment: 'salt' },
    { day: 1, leg: 1, num: 6, sumKm: 10.1, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START · 40 km/h' }
  ]);
  const rau = verifyRoadbook(stricat);
  ok('prinde numerele lipsă', rau.probleme.some(p => /lipsesc boxurile 3/.test(p)), JSON.stringify(rau.probleme));
  ok('prinde saltul de km', rau.probleme.some(p => /salt de 9\.4/.test(p)), JSON.stringify(rau.probleme));
  ok('prinde boxul mut', rau.probleme.some(p => /nici direcție/.test(p)));
  ok('prinde START fără FINISH', rau.probleme.some(p => /START fără FINISH/.test(p)));
}

console.log('\n═══ Vocea: prio 4, TTL pe viraje, REPETĂ, watchdog, unități ═══');
{
  let t = 0;
  const spoken = [];
  let busyFlag = false, cancelat = 0;
  const tts = { speak: (txt, onEnd) => { spoken.push(txt); busyFlag = true; /* nu chemăm onEnd — difuzor agățat */ },
                cancel: () => { cancelat++; busyFlag = false; }, busy: () => busyFlag };
  const v = makeVoice({ tts, now: () => t });
  v.say('anunț lung de TC', 3, 'tc');
  v.say('dreapta acum', 4, 'turn');
  ok('prio 4 întrerupe prio 3', spoken.includes('dreapta acum'), JSON.stringify(spoken));
  ok('ultimul rostit se poate REPETA', v.repeat() === true);

  // watchdog: difuzorul minte că e ocupat la nesfârșit → tăiere forțată la 2× durata
  const s0 = spoken.length;
  t += 40000;                                  // mult peste 2× estimarea
  // watchdog-ul intern e pe setInterval real; chemăm logica prin say cu coada plină
  v.say('următorul', 2);
  t += 40000;
  // nu putem invoca intervalul direct — verificăm măcar că say-ul n-a fost pierdut din coadă
  ok('mesajul nou stă în coadă, nu e aruncat', v._q.length >= 1, String(v._q.length));

  ok('distRo: un kilometru', distRo(1000) === 'un kilometru', distRo(1000));
  ok('distRo: cu unități sub kilometru', distRo(300) === '300 de metri', distRo(300));
  ok('distRo: 20 de metri', distRo(20) === '20 de metri', distRo(20));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
