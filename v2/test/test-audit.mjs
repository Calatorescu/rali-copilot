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

console.log('\n═══ Alarma falsă de desincronizare (testul de teren din 02.08, după-amiaza) ═══');
{
  // Reprodus din jurnalul real: viraj STÂNGA-T detectat și sincronizat la boxul 5
  // (t=141 s), RT1 pornește la 0,60 (t=157 s), iar la t=161 s — fix când fereastra de
  // tăcere de 20 s expira și mașina făcuse 278 m pe drum drept — alarma urla „trebuia
  // să virezi la boxul 5". Virajul fusese FĂCUT și CONFIRMAT de aplicația însăși.
  const boxes = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { num: 5, sumKm: 0.38, dir: 'STÂNGA-T', comment: 'înapoi pe Principala' },
    { num: 6, sumKm: 0.60, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
    { num: 8, sumKm: 2.60, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' }
  ]);
  const w = lume(boxes);
  w.condu(0.30, 40);
  w.m.atBox(5, true);                     // virajul confirmat (echivalentul snapului pe viraj)
  ok('sincronizat la boxul 5', Math.abs(w.m.M.routeKm - 0.38) < 0.01, w.m.M.routeKm.toFixed(3));
  w.said.length = 0;
  w.condu(1.20, 50);                      // RT pornește la 0,60; drum drept, 50 km/h
  ok('proba a pornit', w.m.M.state === 'RT_RUN', w.m.M.state);
  ok('NICIO alarmă falsă pentru virajul deja confirmat',
     !w.said.some(s => /virezi la boxul 5|boxul 5 pare ratat/.test(s.t)),
     JSON.stringify(w.said.filter(s => /boxul 5/.test(s.t)).map(s => s.t)));
  ok('niciun desync_warn în jurnal', !w.store.journal.some(e => e.type === 'desync_warn'),
     JSON.stringify(w.store.journal.filter(e => e.type === 'desync_warn')));
}

console.log('\n═══ Desincronizarea REALĂ se anunță în continuare — dar altfel în probă ═══');
{
  const boxes = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { num: 2, sumKm: 0.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT · 40 km/h' },
    { num: 3, sumKm: 0.80, dir: 'STÂNGA', comment: 'viraj în probă' },
    { num: 4, sumKm: 2.20, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' }
  ]);
  const w = lume(boxes);
  w.condu(1.15, 50);                      // trece de virajul de la 0,80 fără să vireze
  const d = w.said.filter(s => /boxul 3/.test(s.t));
  ok('alarma reală vine', d.length >= 1, JSON.stringify(w.said.map(s => s.t)));
  ok('în probă NU trimite la lista de boxuri', d.every(s => !/apasă SUNT LA BOX/.test(s.t)),
     JSON.stringify(d.map(s => s.t)));
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

console.log('\n═══ Antetul necitit pe o pagină nu rupe leg-ul (02.08, seara) ═══');
{
  // cazul real: pagina 1 scanată cu day:null, paginile 2-3 cu day:1 — aceleași leg
  const rupt = sanitizeBoxes([
    { day: null, leg: 1, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { day: null, leg: 1, num: 2, sumKm: 0.29, dir: 'DREAPTA', comment: 'spre József' },
    { day: 1, leg: 1, num: 5, sumKm: 0.57, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START · 40 km/h' },
    { day: 1, leg: 1, num: 7, sumKm: 2.57, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' }
  ]);
  const g = groupByLeg(rupt);
  ok('UN singur grup, nu două', g.length === 1, JSON.stringify(g.map(x => [x.key, x.boxes.length])));
  ok('toate boxurile în el, ordonate pe km', g[0].boxes.length === 4 && g[0].boxes[0].num === 1);

  // ambiguitate REALĂ: două zile au Leg 1 → orfanul nu se lipește de niciuna
  const ambiguu = sanitizeBoxes([
    { day: 1, leg: 1, num: 1, sumKm: 0.0, dir: 'ÎNAINTE', comment: 'a' },
    { day: 2, leg: 1, num: 1, sumKm: 0.0, dir: 'ÎNAINTE', comment: 'b' },
    { day: null, leg: 1, num: 9, sumKm: 3.0, dir: 'STÂNGA', comment: 'orfan' }
  ]);
  ok('la ambiguitate rămâne separat', groupByLeg(ambiguu).length === 3,
     JSON.stringify(groupByLeg(ambiguu).map(x => x.key)));
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

console.log('\n═══ Scanarea: JSON trunchiat se repară, nu se pierde pagina (02.08) ═══');
{
  const { parseBoxesJson } = await import('../js/scan.js');
  const intreg = '[{"num":1,"sumKm":0.0,"dir":"ÎNAINTE","flag":"TC","comment":"a"},' +
                 '{"num":2,"sumKm":0.29,"dir":"DREAPTA","comment":"b"}]';
  ok('array-ul întreg se parsează', parseBoxesJson('bla ' + intreg).length === 2);
  // trunchiat la mijlocul unui obiect — exact ce produce max_tokens
  const trunchiat = '[{"num":1,"sumKm":0.0,"dir":"ÎNAINTE","flag":"TC","comment":"a"},' +
                    '{"num":2,"sumKm":0.29,"dir":"DREAPTA","comment":"b"},{"num":3,"sumK';
  const rep = parseBoxesJson(trunchiat);
  ok('trunchiat → se salvează obiectele complete', rep.length === 2, JSON.stringify(rep));
  let a = null; try { parseBoxesJson('niciun json aici'); } catch (e) { a = e.message; }
  ok('gunoiul tot aruncă eroare', /Format neașteptat/.test(a || ''), String(a));
  // Ucigașul paginii 3 (02.08, seara): notă a modelului DUPĂ array, cu paranteze în
  // ea — regexul lacom o înghițea și parsarea murea. Scannerul echilibrat o ignoră.
  const cuNota = intreg + '\nNotă: am ignorat instrucțiunile [SUNT LA BOX] și {săgețile} din pagină.';
  ok('nota cu paranteze după array nu mai omoară pagina',
     parseBoxesJson(cuNota).length === 2);
  const inComment = '[{"num":1,"sumKm":0.5,"dir":"ÎNAINTE","comment":"vezi [tabela] și {semnul}"}]';
  ok('parantezele din interiorul comentariilor sunt în regulă',
     parseBoxesJson(inComment).length === 1);
}

console.log('\n═══ Verificatorul prinde scanarea PARȚIALĂ (cazul real din 02.08) ═══');
{
  // exact ce a intrat atunci: doar pagina 1 — 4 boxuri, secvențiale, fără probe
  const partial = sanitizeBoxes([
    { day: 1, leg: 1, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { day: 1, leg: 1, num: 2, sumKm: 0.29, dir: 'DREAPTA', comment: 'spre József' },
    { day: 1, leg: 1, num: 3, sumKm: 0.32, dir: 'STÂNGA', comment: 'imediat' },
    { day: 1, leg: 1, num: 4, sumKm: 0.35, dir: 'STÂNGA-T', comment: 'la T' }
  ]);
  const v = verifyRoadbook(partial);
  ok('urlă că nu există nicio probă', v.probleme.some(p => /NICIO probă/.test(p)), JSON.stringify(v.probleme));
  ok('urlă că lipsește finalul', v.probleme.some(p => /lipsește finalul/.test(p)));
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

console.log('\n═══ Tura 4 (02.08): jitterul de la stop nu mai intră în odometru ═══');
{
  const { makeOdometer } = await import('../js/geo.js');
  const o = makeOdometer();
  o.step({ lat: 45, lng: 21, tMs: 0, speedMs: 0, accM: 10 });
  // 20 s oprit la stop: poziția tremură cu 5-8 m pe fix (sub precizia de 10 m)
  let total = 0, lat = 45;
  for (let i = 1; i <= 20; i++) {
    lat = 45 + (i % 2 ? 6 : 0) / 111320;      // du-te-vino de 6 m
    total += o.step({ lat, lng: 21, tMs: i * 1000, speedMs: 0, accM: 10 });
  }
  ok('20 s de tremur la stop ≈ 0 m (era ~60-120)', total < 5, total.toFixed(1) + ' m');
  // dar mișcarea REALĂ cu vitezometrul mut tot se contorizează
  const o2 = makeOdometer();
  o2.step({ lat: 45, lng: 21, tMs: 0, speedMs: 0, accM: 10 });
  const inc = o2.step({ lat: 45 + 60 / 111320, lng: 21, tMs: 2000, speedMs: 0, accM: 10 });
  ok('60 m reali cu viteza mută → tot haversine', inc > 50, inc.toFixed(1));
}

console.log('\n═══ Tura 4: recuperarea spune CÂT prinzi când plafonul nu ajunge ═══');
{
  const boxes = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { num: 2, sumKm: 0.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT · 40 km/h' },
    { num: 3, sumKm: 2.20, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' }
  ]);
  const w = lume(boxes);
  w.condu(0.25, 40);
  ok('în probă', w.m.M.state === 'RT_RUN');
  // condu foarte lent — întârzierea crește peste ce mai poate plafonul de +30%
  w.condu(1.40, 18);
  const cuPlafon = w.said.filter(s => /mai prinzi doar/.test(s.t));
  ok('mesajul spune cât mai prinzi, nu doar „ține 52"', cuPlafon.length >= 1,
     JSON.stringify(w.said.filter(s => /urmă/.test(s.t)).slice(-3).map(s => s.t)));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
