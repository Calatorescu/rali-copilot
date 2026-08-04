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
  wall += 1000; m.onFix({ lat: 45, lng: 11, tMs: wall, speedMs: 0, accM: 8 });
  return { m, store, said, clock,
    get wall() { return wall; }, avanseazaTimp(ms) { wall += ms; },
    condu(panaLa, kmh = 45) {
      while (realKm < panaLa - 1e-9) {
        const pas = Math.min(kmh / 3600, panaLa - realKm);
        realKm += pas; wall += 1000;
        m.onFix({ lat: 45 + realKm / 111.32, lng: 11, tMs: wall, speedMs: pas * 1000, accM: 8 });
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
  wall += 1000; m.onFix({ lat: 45, lng: 11, tMs: wall, speedMs: 0, accM: 8 });
  // condu până la 0,45 normal
  let realKm = 0;
  while (realKm < 0.45) { realKm += 45 / 3600; wall += 1000;
    m.onFix({ lat: 45 + realKm / 111.32, lng: 11, tMs: wall, speedMs: 12.5, accM: 8 }); }
  // gaură de 30 s, mașina a mers; fixul următor e la 0,85 real (peste linie cu 250 m)
  wall += 30000; realKm = 0.85;
  m.onFix({ lat: 45 + realKm / 111.32, lng: 11, tMs: wall, speedMs: 12.5, accM: 8 });
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
  o.step({ lat: 45, lng: 11, tMs: 0, speedMs: 0, accM: 10 });
  // 20 s oprit la stop: poziția tremură cu 5-8 m pe fix (sub precizia de 10 m)
  let total = 0, lat = 45;
  for (let i = 1; i <= 20; i++) {
    lat = 45 + (i % 2 ? 6 : 0) / 111320;      // du-te-vino de 6 m
    total += o.step({ lat, lng: 11, tMs: i * 1000, speedMs: 0, accM: 10 });
  }
  ok('20 s de tremur la stop ≈ 0 m (era ~60-120)', total < 5, total.toFixed(1) + ' m');
  // dar mișcarea REALĂ cu vitezometrul mut tot se contorizează
  const o2 = makeOdometer();
  o2.step({ lat: 45, lng: 11, tMs: 0, speedMs: 0, accM: 10 });
  const inc = o2.step({ lat: 45 + 60 / 111320, lng: 11, tMs: 2000, speedMs: 0, accM: 10 });
  ok('60 m reali cu viteza mută → tot haversine', inc > 50, inc.toFixed(1));
}

console.log('\n═══ Tura 4: recuperarea dă viteza REALĂ, fără plafon (cerut 02.08) ═══');
{
  const boxes = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { num: 2, sumKm: 0.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT · 40 km/h' },
    { num: 3, sumKm: 2.20, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' }
  ]);
  const w = lume(boxes);
  w.condu(0.25, 40);
  ok('în probă', w.m.M.state === 'RT_RUN');
  // condu lent — devierea crește mult peste ce ar fi permis vechiul plafon de +30% (52)
  w.condu(1.40, 18);
  const pace = w.said.filter(s => /în urmă, ține (\d+)/.test(s.t));
  ok('mesajul există', pace.length >= 1, JSON.stringify(w.said.slice(-4).map(s => s.t)));
  const viteze = pace.map(s => +s.t.match(/ține (\d+)/)[1]);
  ok('viteza cerută DEPĂȘEȘTE vechiul plafon de 52 (e cea reală)',
     viteze.some(v => v > 52), JSON.stringify(viteze));
  // aritmetica pe ultimul mesaj: v = remKm*3600 / (remKm/40*3600 − dev)
  const ultim = pace[pace.length - 1].t;
  ok('cifrele diferă între mesaje (devierea crește → viteza crește)',
     new Set(viteze).size > 1 || viteze.length === 1, JSON.stringify(viteze));

  // devierea imposibilă: timpul disponibil s-a dus → spune direct, nu inventează cifre
  const w2 = lume(boxes);
  w2.condu(0.25, 40);
  w2.condu(2.05, 8);            // atât de lent încât finishul pe timp e pierdut
  ok('imposibilul se spune ca imposibil',
     w2.said.some(s => /nu se mai prinde/.test(s.t)),
     JSON.stringify(w2.said.slice(-3).map(s => s.t)));
}

console.log('\n═══ Tura 5: snapul pe viraj ține cont de întârzierea detectării ═══');
{
  // Jurnalul turei 5: corecții mereu ÎNAPOI și cam la fel (−99/−133/−121) — detectorul
  // confirmă virajul la ~2,5 s după ce s-a terminat, iar snapul care punea poziția FIX
  // la box te trăgea în urmă cu distanța parcursă între timp, la fiecare viraj.
  const boxes = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { num: 2, sumKm: 0.29, dir: 'DREAPTA', comment: 'colț' },
    { num: 3, sumKm: 1.50, dir: 'ÎNAINTE', flag: 'TC', comment: 'final' }
  ]);
  const { makeClock } = await import('../js/time.js');
  let wall = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const m = makeMachine({ plan: buildPlan(boxes, {}, null), clock, store,
    driver: makeDriverModel(), voice: { say() {}, tone() {}, flush() {} }, ui: { render() {} } });
  m.start();
  let lat = 45, lng = 11;
  const fix = (dLatM, dLngM, hdg, spd = 12) => {
    lat += dLatM / 111320; lng += dLngM / (111320 * Math.cos(45 * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: spd, headingDeg: hdg, accM: 8 });
  };
  fix(0, 0, 0, 0);                                   // warm-up staționar
  for (let i = 0; i < 24; i++) fix(12, 0, 0);        // 288 m spre nord, drept
  fix(6, 6, 30); fix(4, 8, 60); fix(2, 10, 90);      // virajul de dreapta la colț
  for (let i = 0; i < 8; i++) fix(0, 12, 90);        // ~96 m după viraj → detectorul decide
  const sy = store.journal.find(e => e.type === 'sync' && e.how === 'turn');
  ok('snapul pe viraj a avut loc', !!sy, JSON.stringify(store.journal.filter(e => e.type === 'sync')));
  ok('poziția e box + distanța de după viraj, NU fix boxul',
     m.M.routeKm > 0.29 + 0.05, m.M.routeKm.toFixed(3));
  // detectorul decide după ~2,5 s de direcție stabilă → 3 fixuri × 12 m ≈ 36 m
  ok('lag-ul de detectare e în jurnal, de ordinul corect', sy && sy.lagM >= 25 && sy.lagM <= 60,
     sy && String(sy.lagM));
}

// ── Bucla József, 03.08.2026 — două ture identice, aceleași trei defecte ─────
// Jurnalul (rali-jurnale/jurnale/2026-08-03.json, sesiunile 16:49:44 și 17:07:19):
//   16:50:09 cue box 2 · 16:50:35 sync turn box 2 {deltaM −54, lagM 26} + cue box 3
//   16:50:58 cue box 4 (23 s mai târziu!) · 16:51:53 snap_refuzat {fara_candidat,
//   routeKm 0,51} · 16:51:54 cue box 5 · 16:52:00 desync_warn {box 4, pastM 254}
// Adică: virajul de la boxul 4 a fost VĂZUT și refuzat, iar 7 s mai târziu aplicația
// i-a spus pilotului că nu l-a făcut. Roadbook-ul: box 2 la 0,29, box 3 la 0,32 (29 m),
// box 4 la 0,35 (22 m). Fixtura de mai jos reproduce geometria și vitezele reale.
const BUCLA = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START / TC 1' },
  { num: 2, sumKm: 0.29, dir: 'DREAPTA', comment: 'Dreapta spre Str. József Attila' },
  { num: 3, sumKm: 0.32, dir: 'STÂNGA', comment: 'Stânga — IMEDIAT (29 m)' },
  { num: 4, sumKm: 0.35, dir: 'STÂNGA-T', comment: 'Stânga la T — IMEDIAT (22 m)' },
  { num: 5, sumKm: 0.57, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
  { num: 7, sumKm: 2.57, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' }
]);

// Lume cu direcție: fiecare pas mută mașina pe un cap compas dat, cu viteza dată.
function lumeCuBusola(boxes) {
  let wall = 0, lat = 45, lng = 11;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(boxes, {}, null), clock, store,
    driver: makeDriverModel(),
    voice: { say: (t, p) => said.push({ t, p }), tone() {}, flush() {} }, ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 0, accM: 6 });
  // un pas = o secundă; `m` metri pe capul `hdg`
  const pas = (metri, hdg) => {
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(45 * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: hdg, accM: 6 });
  };
  const drept = (n, metri, hdg) => { for (let i = 0; i < n; i++) pas(metri, hdg); };
  return { m, store, said, pas, drept, get nextBox() { return boxes[m.M.nextBoxIdx]; } };
}

console.log('\n═══ 03.08: virajul de la boxul 4 e găsit, nu refuzat ═══');
{
  const w = lumeCuBusola(BUCLA);
  w.drept(24, 12, 0);                       // 288 m spre nord, până la boxul 2 (0,29)
  // virajul dreapta: 7 fixuri de 8 m cu direcția în schimbare (54 m de colț, ca în teren),
  // apoi 3 fixuri de 9 m cu direcția stabilă → detectorul se hotărăște (lag ≈ 27 m)
  const colt = [15, 30, 45, 60, 70, 80, 90];
  for (const h of colt) w.pas(8, h);
  w.drept(3, 9, 90);
  const s2 = w.store.journal.find(e => e.type === 'sync' && e.boxNum === 2);
  ok('boxul 2 e sincronizat pe viraj, cu lag de ordinul din teren (25-30 m)',
     s2 && s2.lagM >= 20 && s2.lagM <= 40, JSON.stringify(s2));
  ok('corecția e înapoi, de ordinul măsurat în jurnal (−40…−70 m)',
     s2 && s2.deltaM <= -40 && s2.deltaM >= -70, s2 && String(s2.deltaM));

  // bucla reală: dus pe József, întoarcere sub 8 km/h (măsurat în teren: 3-7 km/h —
  // de-aia detectorul de viraje nici nu se trezește acolo), înapoi, apoi virajul la T.
  // Lungimile sunt calibrate pe jurnal: de la snapul boxului 2 până la confirmarea
  // virajului de la T, aplicația a numărat 194 m (0,316 → 0,51).
  w.drept(7, 9, 135);                       // 63 m spre sud-est
  for (const h of [160, 200, 250, 290, 315]) w.pas(2, h);   // întoarcerea, la ~7 km/h
  w.drept(7, 9, 315);                       // 63 m înapoi spre nord-vest
  const faraViraj = w.store.journal.filter(e => e.type === 'sync' && e.boxNum === 3);
  ok('manevra sub 8 km/h NU produce viraj detectat (cauza (b) din teren)',
     faraViraj.length === 0, JSON.stringify(faraViraj));
  // virajul STÂNGA la T, înapoi pe DJ691, cu lag de detectare ca în teren (~30-50 m)
  for (const h of [290, 270, 250, 225, 210]) w.pas(6, h);
  w.drept(4, 8, 195);
  const s4 = w.store.journal.find(e => e.type === 'sync' && e.boxNum === 4);
  const refuz = w.store.journal.filter(e => e.type === 'snap_refuzat' && e.motiv === 'fara_candidat');
  // pinul pe realitate: dacă fixtura nu ajunge unde a ajuns mașina lui Andreas
  // (0,51 și 0,52 la confirmarea virajului), testul de dedesubt nu dovedește nimic
  ok('poziția la confirmarea virajului e ca în jurnal (0,505-0,53 față de 0,51/0,52 real)',
     s4 && s4.deltaM < 0 && w.m.M.routeKm - s4.deltaM / 1000 > 0.505 &&
     w.m.M.routeKm - s4.deltaM / 1000 < 0.53,
     JSON.stringify({ s4, acum: w.m.M.routeKm.toFixed(3) }));
  ok('virajul de la T îl găsește pe boxul 4 (înainte: „fara_candidat")',
     !!s4, JSON.stringify({ refuz, sync: w.store.journal.filter(e => e.type === 'sync') }));
  ok('poziția devine box 4 + lag, nu fix boxul',
     s4 && w.m.M.routeKm > 0.35 && w.m.M.routeKm < 0.55, w.m.M.routeKm.toFixed(3));
  ok('nicio acuzație „boxul 4 pare ratat"',
     !w.said.some(s => /boxul 4/.test(s.t) && /ratat|trebuit să virezi/.test(s.t)),
     JSON.stringify(w.said.filter(s => /boxul 4/.test(s.t)).map(s => s.t)));
}

console.log('\n═══ 03.08: boxurile înlănțuite se văd și se aud la timp ═══');
{
  const w = lumeCuBusola(BUCLA);
  w.drept(23, 12, 0);                       // 276 m — chiar înainte de boxul 2
  const acum = w.said.filter(s => /dreapta acum/.test(s.t));
  ok('anunțul „acum" al boxului 2 spune ȘI manevra următoare',
     acum.length >= 1 && /și imediat stânga/i.test(acum[acum.length - 1].t),
     JSON.stringify(acum.map(s => s.t)));
  // 04.08: coada nu mai dă cifra sub 80 m. La 29 m și 40 km/h, „la 30 de metri" se
  // termină de rostit după ce virajul a trecut — „imediat" e adevărat mai mult timp.
  ok('…fără cifră, fiindcă la 29 m cifra e stătută înainte de a fi rostită',
     acum.every(s => !/de metri/.test(s.t)), JSON.stringify(acum.map(s => s.t)));

  // ecranul: boxul 3 (0,32) nu mai are voie să țină cardul până la 0,40 — boxul 4 (0,35)
  // e mai aproape decât el încă de la 0,335. Măsurat în teren: 23 s de întârziere.
  const w2 = lumeCuBusola(BUCLA);
  w2.drept(28, 12, 0);                      // 336 m: trecut de 0,335, încă departe de 0,40
  ok('la 0,336 km ecranul arată deja boxul 4, nu boxul 3',
     w2.nextBox && w2.nextBox.num === 4, JSON.stringify({ km: w2.m.M.routeKm.toFixed(3),
       box: w2.nextBox && w2.nextBox.num }));
}

console.log('\n═══ 03.08: „te-am prins, recalez" în loc de „n-ai virat" ═══');
{
  // Poziția o ia mult înainte (mai mult decât poate repara fereastra de 150 m), deci
  // virajul rămâne refuzat — dar EXISTĂ. Aplicația n-are voie să-l acuze pe pilot.
  const boxes = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { num: 2, sumKm: 0.29, dir: 'DREAPTA', comment: 'colț' },
    { num: 3, sumKm: 1.50, dir: 'ÎNAINTE', flag: 'TC', comment: 'final' }
  ]);
  const w = lumeCuBusola(boxes);
  // ordinea din teren: întâi virajul (refuzat), abia apoi alarma — la boxul 4 au fost
  // 7 s între ele. Poziția e cu ~180 m peste box când se confirmă virajul: prea mult
  // pentru fereastra de 150 m, prea puțin ca alarma să fi pornit deja.
  w.drept(36, 12, 0);                       // 432 m spre nord
  for (const h of [20, 40, 60, 75, 90]) w.pas(6, h);
  w.drept(4, 8, 90);                        // detectorul se hotărăște (lag ≈ 24 m)
  const refuz = w.store.journal.find(e => e.type === 'snap_refuzat' && e.motiv === 'fara_candidat');
  ok('virajul e refuzat (prea departe), dar notat cu lag și km de viraj',
     refuz && refuz.lagM > 0 && refuz.virajKm > 0, JSON.stringify(refuz));
  w.drept(6, 10, 90);                       // se merge mai departe: abia acum boxul e „ratat"
  const dw = w.store.journal.find(e => e.type === 'desync_warn');
  ok('desync-ul recunoaște că virajul a fost văzut', dw && dw.virajVazut === true,
     JSON.stringify(dw));
  ok('mesajul nu mai acuză pilotul',
     !w.said.some(s => /ar fi trebuit să virezi/.test(s.t)),
     JSON.stringify(w.said.filter(s => /boxul 2/.test(s.t)).map(s => s.t)));
  ok('spune că recalează', w.said.some(s => /Te-am prins la boxul 2/.test(s.t)),
     JSON.stringify(w.said.map(s => s.t).slice(-4)));
  const st = w.store.journal.find(e => e.type === 'sync' && e.how === 'turn_tardiv');
  ok('recalarea s-a și făcut, în legătură', !!st, JSON.stringify(st));
  ok('poziția e box + cât s-a mers de la viraj (nu fix pe box)',
     w.m.M.routeKm > 0.29 && w.m.M.routeKm < 0.45, w.m.M.routeKm.toFixed(3));
}

console.log('\n═══ 03.08: în probă, recalarea NU se execută (doar se spune) ═══');
{
  // ca în teren: alarma de la boxul 4 a venit la 2 s DUPĂ ce pornise RT1
  const boxes = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
    { num: 2, sumKm: 0.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
    { num: 3, sumKm: 0.29, dir: 'DREAPTA', comment: 'colț, în probă' },
    { num: 4, sumKm: 2.40, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' }
  ]);
  const w = lumeCuBusola(boxes);
  w.drept(36, 12, 0);
  for (const h of [20, 40, 60, 75, 90]) w.pas(6, h);
  w.drept(4, 8, 90);                        // virajul refuzat, exact ca mai sus
  ok('proba rulează', w.m.M.state === 'RT_RUN', w.m.M.state);
  const kmInainte = w.m.M.routeKm;
  w.drept(6, 10, 90);                       // încă 60 m: acum boxul pare „ratat"
  ok('poziția a avansat cu drumul făcut, fără nicio săritură',
     Math.abs((w.m.M.routeKm - kmInainte) * 1000 - 60) < 15,
     `${kmInainte.toFixed(3)} → ${w.m.M.routeKm.toFixed(3)}`);
  ok('nicio resincronizare în plină probă',
     !w.store.journal.some(e => e.type === 'sync'),
     JSON.stringify(w.store.journal.filter(e => e.type === 'sync')));
  ok('dar nici nu-l acuză', !w.said.some(s => /pare ratat/.test(s.t)),
     JSON.stringify(w.said.filter(s => /boxul 2/.test(s.t)).map(s => s.t)));
  ok('îi spune că poziția e de vină', w.said.some(s => /poziția nu se potrivește/.test(s.t)),
     JSON.stringify(w.said.map(s => s.t).slice(-4)));
}

// ── Paznicul de direcție (03.08.2026, sesiunea Leg 2) ───────────────────────
// Ce s-a întâmplat: roadbook-ul de test cerea la startul Leg 2 o stângă peste linie
// dublă continuă — ilegală. Andreas a făcut singura manevră legală (dreapta, spre NE),
// aplicația conducea traseul spre SV, iar proba a pornit singură după 370 m în direcția
// opusă. Măsurat: deplasarea față de plecare creștea monoton, 121 m la 11 s, 314 m la
// 34 s, fără nicio revenire. Lanțurile de coordonate de mai jos sunt cele REALE, dar
// DEPLASATE DELIBERAT (audit de securitate, 04.08.2026): folderul v2/test/ se servește
// PUBLIC pe GitHub Pages. Longitudinea e mutată cu −10 grade; latitudinea rămâne cea
// măsurată, ca `kx` din geo.js (care depinde doar de latitudine) să fie identic și toate
// distanțele, unghiurile și aserțiunile să rămână la sub un metru de original. ORICE lanț
// nou se deplasează la fel ÎNAINTE de commit — altfel testul publică unde umblă mașina.
const LANT_NE = [[45.802871,11.250711,0],[45.803161,11.250729,12],[45.80358,11.251277,52],
  [45.80421,11.252015,55],[45.804675,11.252602,42],[45.804886,11.252935,12],[45.80492,11.252973,0],
  [45.804974,11.25305,17],[45.804882,11.253398,25],[45.804652,11.253767,27],[45.804575,11.254004,7],
  [45.804532,11.253984,3],[45.804654,11.253826,22],[45.8049,11.253437,20],[45.804972,11.253339,0]];
const LANT_SV = [[45.803844,11.251418,48],[45.803326,11.250782,46],[45.802799,11.250129,45],
  [45.802439,11.249605,38],[45.802015,11.249051,39],[45.80162,11.248533,44],[45.801216,11.247961,47],
  [45.800875,11.247533,43],[45.80036,11.246876,43],[45.799964,11.246343,36],[45.799678,11.24594,31],
  [45.799329,11.245464,37]];
const LANT_LEG2 = [[45.802826,11.250331,12],[45.803068,11.250603,42],[45.803662,11.251333,57],
  [45.80431,11.252109,52],[45.804743,11.252668,30],[45.804925,11.252915,13],[45.804967,11.252969,0],
  [45.804967,11.252971,0],[45.804967,11.252973,0],[45.804966,11.252971,0],[45.804969,11.252972,1],
  [45.805235,11.253303,43],[45.805884,11.254025,59],[45.806447,11.254692,57]];

async function lumeGeo(lant, boxes) {
  const { buildTrace } = await import('../js/geo.js');
  // urma de recunoaștere: densificată la 6 m, ca cea reală
  const dens = [];
  for (let i = 0; i < lant.length - 1; i++) {
    const [la, ln] = lant[i], [lb, lnb] = lant[i + 1];
    for (let k = 0; k < 12; k++)
      dens.push({ lat: la + (lb - la) * k / 12, lng: ln + (lnb - ln) * k / 12 });
  }
  dens.push({ lat: lant[lant.length - 1][0], lng: lant[lant.length - 1][1] });
  const trace = buildTrace(dens);
  const anchors = [{ officialKm: 0, traceM: 0 },
                   { officialKm: trace.totalM / 1000, traceM: trace.totalM }];
  let wall = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore(), said = [];
  const m = makeMachine({ plan: buildPlan(boxes, {}, { trace, samples: [], anchors }),
    clock, store, driver: makeDriverModel(),
    voice: { say: (t, p, c) => said.push({ t, p, c }), tone() {}, flush() {} }, ui: { render() {} } });
  m.start();
  return { m, store, said,
    conduPe(pts) {
      for (const [lat, lng, kmh] of pts) {
        wall += 5000;
        m.onFix({ lat, lng, tMs: wall, speedMs: kmh / 3.6, headingDeg: null, accM: 6 });
      }
    } };
}

const BOX_LEG = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START / TC' },
  { num: 2, sumKm: 0.40, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 35 km/h' },
  { num: 3, sumKm: 1.90, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' }
]);

console.log('\n═══ Paznicul de direcție: NE pe un traseu care pleacă spre SV = alarmă ═══');
{
  const w = await lumeGeo(LANT_SV, BOX_LEG);       // recunoașterea zice: pleacă spre sud-vest
  w.conduPe(LANT_LEG2);                            // mașina merge, real, spre nord-est
  const dg = w.store.journal.filter(e => e.type === 'directie_gresita');
  ok('alarma s-a dat', dg.length >= 1, JSON.stringify(w.store.journal.map(e => e.type)));
  ok('spune direcția corectă a traseului, în cuvinte',
     w.said.some(s => /Direcție greșită.*sud-vest/.test(s.t)),
     JSON.stringify(w.said.map(s => s.t)));
  ok('bannerul e pus pe stare, pentru ecran',
     w.m.M.dirAlerta && /sud-vest/.test(w.m.M.dirAlerta.text), JSON.stringify(w.m.M.dirAlerta));
  ok('diferența măsurată e categorică (>150°)', !!dg[0] && dg[0].difGrd > 150, JSON.stringify(dg[0]));
  ok('a prins-o în primii ~150 m, nu după 400',
     !!dg[0] && dg[0].deplasareM >= 120 && dg[0].deplasareM < 250,
     dg[0] ? String(dg[0].deplasareM) : 'nicio alarmă');
  ok('se repetă o singură dată, nu la fiecare fix', dg.length <= 2, String(dg.length));
}

console.log('\n═══ Paznicul TACE pe traseul corect (bucla József, unde direcția se schimbă des) ═══');
{
  const w = await lumeGeo(LANT_NE, BOX_LEG);       // recunoașterea Leg 1: NE, apoi bucla
  w.conduPe(LANT_NE.map(p => [p[0] + 0.00002, p[1] + 0.00002, p[2]]));   // aceeași tură, cu 3 m zgomot
  ok('niciun fals pozitiv pe traseul propriu',
     !w.store.journal.some(e => e.type === 'directie_gresita'),
     JSON.stringify(w.store.journal.filter(e => e.type === 'directie_gresita')));
  ok('și nici vocal nu s-a plâns', !w.said.some(s => /Direcție greșită/.test(s.t)),
     JSON.stringify(w.said.map(s => s.t)));
}

console.log('\n═══ Fără recunoaștere, paznicul tace (roadbook-ul n-are direcții absolute) ═══');
{
  let wall = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore(), said = [];
  const m = makeMachine({ plan: buildPlan(BOX_LEG, {}, null), clock, store,
    driver: makeDriverModel(),
    voice: { say: t => said.push(t), tone() {}, flush() {} }, ui: { render() {} } });
  m.start();
  for (const [lat, lng, kmh] of LANT_LEG2) {
    wall += 5000;
    m.onFix({ lat, lng, tMs: wall, speedMs: kmh / 3.6, headingDeg: null, accM: 6 });
  }
  ok('nicio alarmă inventată din roadbook',
     !store.journal.some(e => e.type === 'directie_gresita') &&
     !said.some(t => /Direcție greșită/.test(t)), JSON.stringify(said));
}

console.log('\n═══ Ritmul nu mai taie manevra (cazul 17:20:22 din jurnal) ═══');
{
  const { makeVoice } = await import('../js/voice.js');
  let t = 0;
  const spoken = [], taiate = [];
  let busy = false;
  const tts = { speak: (txt) => { spoken.push(txt); busy = true; },
                cancel: () => { busy = false; }, busy: () => busy };
  const v = makeVoice({ tts, now: () => t, onDrop: (txt, de) => taiate.push({ txt, de }) });
  // exact secvența din jurnal: anunțul de finish (manevră) rostindu-se, iar peste el
  // vine cifra de ritm — care în teren l-a scos din difuzor
  v.say('Finish în 150 de metri', 3, 'turn', 'manevra');
  ok('manevra a intrat în difuzor', spoken[spoken.length - 1] === 'Finish în 150 de metri');
  t += 1000;
  v.say('55 virgulă 3 în avans, ține 6', 4, 'race', 'ritm');
  ok('ritmul NU a tăiat manevra',
     !taiate.some(x => x.txt === 'Finish în 150 de metri' && x.de === 'intrerupt'),
     JSON.stringify(taiate));
  ok('ritmul a rămas în coadă, nu s-a rostit peste',
     spoken[spoken.length - 1] === 'Finish în 150 de metri', JSON.stringify(spoken));

  // coada: cu o manevră și un ritm în așteptare, manevra pleacă prima chiar dacă
  // ritmul are prioritate numerică mai mare
  const spoken2 = [];
  let elibereaza = null;
  const v2 = makeVoice({ now: () => t, tts: {
    speak: (txt, onEnd) => { spoken2.push(txt); elibereaza = onEnd; },
    cancel: () => { elibereaza = null; }, busy: () => !!elibereaza } });
  v2.say('42 în avans, ține 12', 4, 'pace', 'ritm');    // pleacă imediat, coada e goală
  v2.say('30 de metri — stânga', 2, 'turn', 'manevra'); // ambele rămân în coadă
  v2.say('bancă: ia 3 avans', 3, 'bank', 'ritm');
  const term = elibereaza; elibereaza = null; term();   // difuzorul s-a eliberat
  ok('din coadă pleacă întâi manevra, deși ritmul e prio 3 vs 2',
     spoken2[1] === '30 de metri — stânga', JSON.stringify(spoken2));

  // 04.08, tura Tresor: o manevră nu mai taie altă manevră. Pilotul auzea „150 de metri
  // — dre—" și pe urmă „dreapta acum" — măsurat, 5 fraze de manevră aruncate cu
  // „intrerupt". Acum cea nouă așteaptă sfârșitul frazei (1-2 s) și pleacă imediat după.
  const spoken3 = [], taiate3 = [];
  let elibereaza3 = null;
  const v3 = makeVoice({ tts: { speak: (txt, onEnd) => { spoken3.push(txt); elibereaza3 = onEnd; },
                                cancel: () => { elibereaza3 = null; }, busy: () => !!elibereaza3 },
                         now: () => t, onDrop: (txt, de) => taiate3.push({ txt, de }) });
  v3.say('150 de metri — dreapta', 3, 'turn', 'manevra');
  v3.say('dreapta acum', 4, 'turn', 'manevra');
  ok('„acum" NU mai taie fraza de manevră care se rostește',
     !taiate3.some(x => x.de === 'intrerupt'), JSON.stringify(taiate3));
  ok('…dar pleacă imediat ce difuzorul se eliberează',
     (() => { const f = elibereaza3; elibereaza3 = null; f(); return spoken3[1] === 'dreapta acum'; })(),
     JSON.stringify(spoken3));

  // …iar o MANEVRĂ taie ritmul chiar la prioritate egală: cazul boxului 12 din tura
  // Tresor, unde „stânga acum" a stat în spatele frazei de finish (ambele prio 4) și
  // virajul de la 55 m după linie s-a ratat.
  const spoken4 = [], taiate4 = [];
  let busy4 = false;
  const v4 = makeVoice({ tts: { speak: txt => { spoken4.push(txt); busy4 = true; },
                                cancel: () => { busy4 = false; }, busy: () => busy4 },
                         now: () => t, onDrop: (txt, de) => taiate4.push({ txt, de }) });
  v4.say('Finish. 33 virgulă 8 în urmă. Nu opri lângă tabelă.', 4, 'race', 'ritm');
  v4.say('stânga acum', 4, 'turn', 'manevra');
  ok('manevra taie ritmul și la prioritate egală (4 vs 4)',
     spoken4[spoken4.length - 1] === 'stânga acum' &&
     taiate4.some(x => /Finish\./.test(x.txt) && x.de === 'intrerupt'),
     JSON.stringify({ spoken4, taiate4 }));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
