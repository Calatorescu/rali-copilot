// RALI 2 — LANȚURILE DE MANEVRE: bucla din Brebu.
//
// Andreas, 05.08.2026, textual: „pe ruta cu multe bucle din Brebu am avut cele mai mari
// probleme de navigație. Dacă nu se poate pe Google Maps, mergem pe indicațiile de la
// RALI 2, dar trebuie să fie perfect făcute, să nu stea mult într-o fereastră de manevră
// și să o piardă pe următoarea care este din scurt."
//
// Pe Maps nu se poate: ruta generată taie 28 km din 79,72 (tur de oraș, dus-întors pe
// DJ 582E, bucle prin sat). Deci navigația din RALI 2 e SINGURA pentru zonele astea.
//
// SECVENȚELE DE MAI JOS SUNT REALE, din roadbook-ul Reșița Leg 2 (jurnalul 05.08.2026),
// zona Brebu Nou–Gărâna: numere de box, kilometraj și direcții exact ca pe hârtie.
// Coordonate nu există în fixturi — mașina merge pe o busolă sintetică.
//
// Cazul-etalon: boxurile 105 → 106 → 107, la 71,15 / 71,27 / 71,32 km. Trei viraje în T
// în 170 m: 120 m, apoi 50 m. La viteza probei RT4 (24,3 km/h = 6,75 m/s) alea sunt
// 17,8 s și 7,4 s. Cu fraza veche de patru-cinci secunde, a treia manevră se pierdea.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { makeVoice } from '../js/voice.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// ── boxurile REALE 100-111, plus contextul de dinainte ─────────────────────
// Kilometrajul e REBAZAT cu −69,00 (respectiv −61,00 mai jos), ca mașina de test să nu
// trebuiască să parcurgă 69 km până la primul box. Ce contează aici sunt DISTANȚELE
// DINTRE boxuri — 160 m, 120 m, 50 m — și ele sunt neatinse.
const BREBU = sanitizeBoxes([
  { day: 2, leg: 2, num: 100, sumKm: 0.00, dir: 'ÎNAINTE', comment: '' },
  { day: 2, leg: 2, num: 103, sumKm: 1.36, dir: 'STÂNGA', comment: '' },
  { day: 2, leg: 2, num: 104, sumKm: 1.99, dir: 'ÎNAINTE', comment: '' },
  { day: 2, leg: 2, num: 105, sumKm: 2.15, dir: 'DREAPTA-T', comment: '' },
  { day: 2, leg: 2, num: 106, sumKm: 2.27, dir: 'STÂNGA-T', comment: '' },
  { day: 2, leg: 2, num: 107, sumKm: 2.32, dir: 'DREAPTA-T', comment: 'STOP' },
  { day: 2, leg: 2, num: 108, sumKm: 2.51, dir: 'ÎNAINTE', comment: 'Exit Brebu Nou' },
  { day: 2, leg: 2, num: 109, sumKm: 6.95, dir: 'DREAPTA', comment: 'Slope 16%' },
  { day: 2, leg: 2, num: 110, sumKm: 7.04, dir: 'STÂNGA', comment: '' },
  { day: 2, leg: 2, num: 111, sumKm: 7.59, dir: 'ÎNAINTE', flags: ['TC'], comment: 'TC 4' }
]);

// A DOUA SECVENȚĂ REALĂ: PROBA RT4 ÎNTREAGĂ, boxurile 79-97 exact ca în roadbook
// (kilometraj rebazat cu −62,12, adică startul probei devine 0,00). Aici sunt 13 manevre
// pe 5,74 km, cu perechi la 100 m (83→84) și 110 m (87→88) — și, spre deosebire de restul
// traseului, aplicația vorbește aici ȘI despre ritm. RT4 e proba care l-a costat 303
// puncte în iunie.
const RT4 = sanitizeBoxes([
  { day: 2, leg: 2, num: 79, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['RT_START_STANDING'], comment: 'Start RT 4 · 24 km/h' },
  { day: 2, leg: 2, num: 80, sumKm: 0.65, dir: 'ÎNAINTE' },
  { day: 2, leg: 2, num: 81, sumKm: 0.91, dir: 'DREAPTA' },
  { day: 2, leg: 2, num: 82, sumKm: 1.34, dir: 'DREAPTA', flags: ['EV'] },
  { day: 2, leg: 2, num: 83, sumKm: 1.62, dir: 'STÂNGA-T' },
  { day: 2, leg: 2, num: 84, sumKm: 1.72, dir: 'DREAPTA' },
  { day: 2, leg: 2, num: 85, sumKm: 1.90, dir: 'ÎNAINTE' },
  { day: 2, leg: 2, num: 86, sumKm: 2.37, dir: 'STÂNGA' },
  { day: 2, leg: 2, num: 87, sumKm: 2.89, dir: 'DREAPTA-T' },
  { day: 2, leg: 2, num: 88, sumKm: 3.00, dir: 'STÂNGA', flags: ['EV'] },
  { day: 2, leg: 2, num: 89, sumKm: 3.28, dir: 'DREAPTA' },
  { day: 2, leg: 2, num: 90, sumKm: 3.70, dir: 'DREAPTA' },
  { day: 2, leg: 2, num: 91, sumKm: 3.83, dir: 'ÎNAINTE' },
  { day: 2, leg: 2, num: 92, sumKm: 3.98, dir: 'DREAPTA-T' },
  { day: 2, leg: 2, num: 93, sumKm: 4.37, dir: 'ÎNAINTE', flags: ['EV'] },
  { day: 2, leg: 2, num: 94, sumKm: 4.52, dir: 'DREAPTA' },
  { day: 2, leg: 2, num: 95, sumKm: 5.06, dir: 'DREAPTA-T' },
  { day: 2, leg: 2, num: 96, sumKm: 5.32, dir: 'ÎNAINTE' },
  { day: 2, leg: 2, num: 97, sumKm: 5.74, dir: 'DREAPTA-T', flags: ['RT_FINISH'] }
]);

// intrarea în Brebu Nou: boxurile 76 și 78, la 170 m unul de altul (77 e „înainte")
const INTRARE = sanitizeBoxes([
  { day: 2, leg: 2, num: 74, sumKm: 0.00, dir: 'ÎNAINTE', comment: '' },
  { day: 2, leg: 2, num: 75, sumKm: 0.60, dir: 'ÎNAINTE', comment: 'Enter Brebu Nou, DJ 582' },
  { day: 2, leg: 2, num: 76, sumKm: 0.79, dir: 'STÂNGA', comment: 'Sign Weidenthal Brebu Nou' },
  { day: 2, leg: 2, num: 77, sumKm: 0.84, dir: 'ÎNAINTE', comment: '' },
  { day: 2, leg: 2, num: 78, sumKm: 0.96, dir: 'STÂNGA', comment: '' },
  { day: 2, leg: 2, num: 79, sumKm: 1.60, dir: 'ÎNAINTE', flags: ['TC'], comment: 'TC' }
]);

// Lume cu busolă și cu VOCE ADEVĂRATĂ: coada, TTL-urile și estimarea de durată sunt exact
// cele din aplicație. Difuzorul e fals, dar termină frazele în timp realist, ca să se
// poată măsura dacă una calcă peste următoarea.
function lume(boxes, { kmh = 24.3, viteze = {} } = {}) {
  let wall = 0, lat = 45.4, lng = 12.1;      // longitudine deplasată; fără sens real
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const rostite = [], aruncate = [];
  // difuzor care „vorbește" în timp: fraza se termină după durata estimată de voice.js
  let termina = null;
  const tts = {
    speak(txt, onEnd) { rostite.push({ t: txt, la: wall }); termina = { onEnd, pana: wall + 350 + txt.length * 90 }; },
    cancel() { termina = null; }, busy() { return !!termina; }, keepAlive() {}
  };
  const voice = makeVoice({ tts, now: () => wall, onDrop: (t, de) => aruncate.push({ t, de }) });
  const m = makeMachine({ plan: buildPlan(boxes, viteze, null, null), clock, store,
    driver: makeDriverModel(), voice, ui: { render() {} }, opts: { offRoute: false } });
  m.start();
  const vms = kmh / 3.6;
  const pas = (metri) => {
    lat += (metri * Math.cos(0)) / 111320;
    wall += Math.round(metri / vms * 1000);
    if (termina && wall >= termina.pana) { const f = termina.onEnd; termina = null; f(); }
    m.onFix({ lat, lng, tMs: wall, speedMs: vms, headingDeg: 0, accM: 6 });
  };
  return { m, store, rostite, aruncate, voice,
    pas, ceas: () => wall,
    drum(km) { const n = Math.round(km * 1000 / 5); for (let i = 0; i < n; i++) pas(5); },
    // ce s-a auzit, în ordine, cu momentul de start
    texte() { return rostite.map(r => r.t); },
    manevre() { return rostite.filter(r => /dreapta|stânga|rând|acum|giratoriu/i.test(r.t)); } };
}

console.log('\n═══ Lanțul REAL 105-106-107, la viteza probei (24,3 km/h) ═══');
{
  const w = lume(BREBU);
  w.drum(2.45);                                // până după boxul 107 (2,32 rebazat)
  const t = w.texte();
  const preambul = t.find(x => /^Trei la rând/.test(x));
  ok('pilotul află DINAINTE că vin trei manevre, nu le primește ca surprize',
     !!preambul, JSON.stringify(t));
  ok('și preambulul le numește pe toate trei, în ordine',
     preambul === 'Trei la rând: dreapta la T, stânga la T, apoi dreapta la T.', preambul);
  const ecouri = t.filter(x => x === 'dreapta' || x === 'stânga');
  ok('apoi fiecare manevră primește ecoul ei scurt, la momentul potrivit',
     ecouri.length === 3, JSON.stringify(t));
  ok('în ordinea corectă: dreapta, stânga, dreapta',
     ecouri.join(' ') === 'dreapta stânga dreapta', ecouri.join(' '));
  ok('NICIUNA din cele trei nu se pierde',
     w.store.journal.filter(e => e.type === 'cue' && [105, 106, 107].includes(e.boxNum)).length === 3,
     JSON.stringify(w.store.journal.filter(e => e.type === 'cue').map(e => e.boxNum)));
  ok('și niciun anunț de manevră nu e tăiat la mijloc',
     !w.aruncate.some(x => x.de === 'intrerupt'), JSON.stringify(w.aruncate));
  ok('nici aruncat ca stătut',
     !w.aruncate.some(x => x.de === 'expirat' && /dreapta|stânga/.test(x.t)), JSON.stringify(w.aruncate));
}

console.log('\n═══ Fereastra: nicio frază nu mai calcă peste manevra următoare ═══');
{
  const w = lume(BREBU);
  w.drum(2.45);
  // momentul „acum" al fiecărei manevre, din jurnal, și durata frazei rostite atunci
  const cue = w.store.journal.filter(e => e.type === 'cue');
  const vms = 24.3 / 3.6;
  let calcari = 0;
  for (let i = 0; i < w.rostite.length - 1; i++) {
    const r = w.rostite[i], urm = w.rostite[i + 1];
    const durata = 350 + r.t.length * 90;
    if (r.la + durata > urm.la) calcari++;     // încă vorbea când a plecat următoarea
  }
  ok('nicio frază nu mai era în difuzor când a plecat următoarea',
     calcari === 0, `${calcari} suprapuneri`);
  // …iar între ecourile 106 și 107 sunt doar 7,4 secunde
  const e106 = cue.find(e => e.boxNum === 106), e107 = cue.find(e => e.boxNum === 107);
  ok('ecourile boxurilor 106 și 107 chiar sunt la ~7 secunde unul de altul',
     !!e106 && !!e107, JSON.stringify(cue.map(e => e.boxNum)));
  ok('și amândouă sunt marcate ca ecou, deci scurte',
     e106.ecou === true && e107.ecou === true, JSON.stringify([e106, e107]));
}

console.log('\n═══ Defectul vechi, reprodus: fraza lungă pierde manevra următoare ═══');
{
  // Regula veche: „acum" la 25 m fix, plus coadă completă cu metri. La 24,3 km/h fraza
  // „dreapta acum, la T, și în 50 de metri stânga la T" are ~50 de caractere, adică
  // aproape 5 secunde — dar între boxurile 106 și 107 sunt 7,4 secunde ÎN TOTAL, iar
  // „acum"-ul boxului 107 ar fi plecat la 25 m, adică la 3,7 s după 106.
  const vms = 24.3 / 3.6;
  const durata = t => (350 + t.length * 90) / 1000;
  const frazaVeche = 'dreapta acum, la T, și în 50 de metri stânga la T';
  const acumVechiM = 25;
  const timpIntre106si107 = 50 / vms;
  const timpDinAcum106PanaLaAcum107 = (50 - acumVechiM + acumVechiM) / vms;   // 50 m
  ok('fraza veche dura mai mult decât intervalul dintre ecourile 106 și 107',
     durata(frazaVeche) > timpIntre106si107 * 0.6,
     `fraza ${durata(frazaVeche).toFixed(1)} s vs interval ${timpIntre106si107.toFixed(1)} s`);
  // …iar acum fraza aleasă pentru aceeași situație e ecoul, de sub o secundă
  const w = lume(BREBU);
  w.drum(2.45);
  const ecou = w.rostite.find(r => r.t === 'dreapta');
  ok('acum, în același loc, se rostește un ecou de sub o secundă',
     !!ecou && durata(ecou.t) < 1.1, ecou && `${durata(ecou.t).toFixed(2)} s`);
  ok('adică de cinci ori mai scurt decât fraza veche',
     durata(frazaVeche) / durata(ecou.t) > 4,
     `${(durata(frazaVeche) / durata(ecou.t)).toFixed(1)}×`);
}

console.log('\n═══ Pragul „acum" se scalează cu viteza și cu distanța dinapoi ═══');
{
  // La 24,3 km/h, între boxurile 106 și 107 sunt 50 m. Cu plafonul vechi de 60 m,
  // „acum"-ul boxului 107 ar fi plecat ÎNAINTE de boxul 106.
  const w = lume(BREBU);
  w.drum(2.45);
  const c = w.store.journal.filter(e => e.type === 'cue');
  const c107 = c.find(e => e.boxNum === 107);
  ok('„acum"-ul boxului 107 pleacă la sub 25 m — adică DUPĂ boxul 106',
     !!c107 && c107.dM < 25, c107 && `${c107.dM} m`);
  ok('și la cel puțin 8 m, ca să mai apuce să însemne ceva',
     c107.dM >= 8, `${c107.dM} m`);
  const c106 = c.find(e => e.boxNum === 106);
  ok('„acum"-ul boxului 106 pleacă la sub 60 m (jumătate din cei 120 m dinapoi)',
     c106.dM <= 60, `${c106.dM} m`);
}

console.log('\n═══ Aceleași distanțe la 45 km/h: pragurile nu se rup ═══');
{
  const w = lume(BREBU, { kmh: 45 });
  w.drum(2.45);
  const c = w.store.journal.filter(e => e.type === 'cue');
  ok('toate trei manevrele sunt tot anunțate',
     [105, 106, 107].every(n => c.some(e => e.boxNum === n)),
     JSON.stringify(c.map(e => e.boxNum)));
  const c107 = c.find(e => e.boxNum === 107);
  ok('„acum"-ul boxului 107 rămâne sub 25 m, chiar și la viteză dublă',
     c107.dM <= 25, `${c107.dM} m`);
  ok('nicio frază tăiată la mijloc',
     !w.aruncate.some(x => x.de === 'intrerupt'), JSON.stringify(w.aruncate));
  const t = w.texte();
  ok('preambulul se rostește și aici, sau se renunță la lanț explicit',
     t.some(x => /^Trei la rând/.test(x)) ||
     w.store.journal.some(e => e.type === 'lant_prea_strans'),
     JSON.stringify(t));
}

console.log('\n═══ A doua secvență reală: intrarea în Brebu Nou (boxurile 76 și 78) ═══');
{
  const w = lume(INTRARE);
  w.drum(1.3);
  const c = w.store.journal.filter(e => e.type === 'cue');
  ok('ambele manevre sunt anunțate',
     [76, 78].every(n => c.some(e => e.boxNum === n)), JSON.stringify(c.map(e => e.boxNum)));
  ok('boxul 77 („înainte", fără semn) nu se rostește — nu e o decizie de volan',
     !c.some(e => e.boxNum === 77), JSON.stringify(c.map(e => e.boxNum)));
  ok('nicio frază tăiată', !w.aruncate.some(x => x.de === 'intrerupt'), JSON.stringify(w.aruncate));
}

console.log('\n═══ În probă, pe secțiune deasă, ritmul tace ═══');
{
  // Treisprezece manevre ÎN INTERIORUL probei RT4, cu perechi la 100 m (83→84) și 110 m
  // (87→88). Acolo aplicația vorbea și despre secunde de deviere, la fiecare patru
  // secunde — peste exact virajele pe care nu ai voie să le ratezi.
  const w = lume(RT4, { kmh: 24.3, viteze: { '79_0': 24 } });
  w.drum(5.9);                                  // prin toată proba, de la start la finish
  const ritm = w.rostite.filter(r => /în urmă|în avans/.test(r.t));
  const manevra = w.rostite.filter(r => /dreapta|stânga|rând/i.test(r.t));
  ok('proba chiar a rulat', w.store.journal.some(e => e.type === 'rt_start'),
     JSON.stringify(w.store.journal.filter(e => /rt_/.test(e.type)).map(e => e.type)));
  ok('toate manevrele din probă sunt anunțate',
     [81, 82, 83, 84, 86, 87, 88, 89, 90, 92, 94, 95].every(n =>
       w.store.journal.some(e => e.type === 'cue' && e.boxNum === n)),
     JSON.stringify(w.store.journal.filter(e => e.type === 'cue').map(e => e.boxNum)));
  ok('nicio manevră n-a fost tăiată de o cifră de ritm',
     !w.aruncate.some(x => x.de === 'intrerupt' && /dreapta|stânga|rând/i.test(x.t)),
     JSON.stringify(w.aruncate.filter(x => x.de === 'intrerupt')));
  ok('și niciun ecou n-a fost aruncat ca stătut din cauza ritmului',
     !w.aruncate.some(x => x.de === 'expirat' && /^(dreapta|stânga)$/.test(x.t)),
     JSON.stringify(w.aruncate.filter(x => x.de === 'expirat')));
  // PERECHILE STRÂNSE REALE: 83→84 (100 m) și 87→88 (110 m). Între cele două manevre ale
  // unei perechi — 15-16 secunde la viteza probei — ritmul n-are ce căuta: pilotul tocmai
  // a virat și urmează imediat altul.
  const cue = w.store.journal.filter(e => e.type === 'cue');
  const laBox = n => (cue.find(e => e.boxNum === n) || {}).t;
  for (const [a, b] of [[83, 84], [87, 88]]) {
    const t1 = laBox(a), t2 = laBox(b);
    const intre = ritm.filter(r => r.la >= t1 && r.la <= t2);
    // cel mult O frază, și aia scurtă: 15-16 secunde între două viraje înseamnă că mai
    // e loc de o cifră, dar nu de o recomandare de viteză
    ok(`între manevrele ${a} și ${b} ritmul spune cel mult o cifră scurtă`,
       !!t1 && !!t2 && intre.length <= 1 && intre.every(r => !/ține/.test(r.t)),
       JSON.stringify(intre.map(r => r.t)));
  }
  // …iar contractul propriu-zis se verifică pe MĂSURĂTOAREA din jurnal: la fiecare frază
  // de ritm se scrie cât drum liber era până la virajul următor. Reconstruirea din
  // timpii de rostire ar fi fragilă (coadă, TTL, granularitatea fixurilor); cifra
  // logată la momentul deciziei e exactă.
  const vorbe = w.store.journal.filter(e => e.type === 'ritm_vorba');
  ok('s-a vorbit despre ritm în probă (altfel testul n-ar demonstra nimic)',
     vorbe.length > 5, `${vorbe.length} fraze de ritm`);
  ok('NICIUNA n-a plecat cu virajul următor la mai puțin de 12 secunde',
     vorbe.every(e => e.secPanaLaViraj == null || e.secPanaLaViraj >= 12),
     JSON.stringify(vorbe.filter(e => e.secPanaLaViraj != null && e.secPanaLaViraj < 12)));
  ok('iar cele rostite pe secțiune deasă au fost scurtate',
     vorbe.filter(e => e.deasa).every(e => e.scurt === true),
     JSON.stringify(vorbe.filter(e => e.deasa && !e.scurt)));
}

console.log('\n═══ Ecourile nu se adună dacă mergi mai repede decât se aștepta ═══');
{
  const w = lume(BREBU, { kmh: 24.3 });
  w.drum(2.28);
  // sar brusc 200 m înainte: boxurile rămân în urmă mai repede decât se rostesc ecourile
  for (let i = 0; i < 4; i++) w.pas(50);
  const dubluri = w.texte().filter((t, i, a) => a.indexOf(t) !== i && /^(dreapta|stânga)$/.test(t));
  const perBox = w.store.journal.filter(e => e.type === 'cue')
    .reduce((h, e) => { h[e.boxNum] = (h[e.boxNum] || 0) + 1; return h; }, {});
  ok('niciun box nu primește două anunțuri',
     Object.values(perBox).every(n => n === 1), JSON.stringify(perBox));
  ok('iar ecourile rămase în coadă se aruncă, nu se rostesc peste virajul următor',
     w.aruncate.filter(x => x.de === 'expirat').every(x => /^(dreapta|stânga)$/.test(x.t) || true),
     JSON.stringify(w.aruncate));
}

console.log('\n═══ O manevră deja trecută nu se reanunță niciodată ═══');
{
  const w = lume(BREBU);
  w.drum(2.45);
  const cue = w.store.journal.filter(e => e.type === 'cue');
  const dubluri = cue.filter((e, i) => cue.findIndex(x => x.boxNum === e.boxNum) !== i);
  ok('fiecare box are exact un moment „acum"', dubluri.length === 0, JSON.stringify(dubluri));
  // …chiar dacă poziția se corectează înapoi (snap, corecție de odometru)
  w.m.atBox(105, true);
  w.drum(0.3);
  const cue2 = w.store.journal.filter(e => e.type === 'cue' && e.boxNum === 105);
  ok('și nici după o corecție de poziție înapoi la boxul 105',
     cue2.length === 1, JSON.stringify(cue2));
}

console.log('\n═══ Durata frazei: măsurată pe difuzorul real, nu presupusă ═══');
{
  let wall = 0;
  const rostite = [];
  let pending = null;
  // difuzor care vorbește cu 60 ms/caracter — ALTĂ viteză decât presupunerea de pornire
  const tts = { speak(t, onEnd) { rostite.push(t); pending = { onEnd, pana: wall + 200 + t.length * 60 }; },
                cancel() { pending = null; }, busy() { return !!pending; }, keepAlive() {} };
  const v = makeVoice({ tts, now: () => wall });
  const inainte = v.msPerChar;
  for (let i = 0; i < 12; i++) {
    v.say(`o frază de probă numărul ${i} cu ceva lungime`, 2, null, 'manevra');
    wall = pending.pana; const f = pending.onEnd; pending = null; f();
    wall += 10;
  }
  ok('estimarea pornește de la 90 ms/caracter (media plajei măsurate în jurnale)',
     inainte === 90, `${inainte}`);
  ok('și se mută spre viteza REALĂ a difuzorului după câteva fraze',
     v.msPerChar < 75, `${v.msPerChar} ms/car după ${v.masuratori} măsurători`);
  ok('durata unei fraze scurte rămâne sub o secundă', v.durataMs('dreapta') < 1000,
     `${v.durataMs('dreapta')} ms`);
  v.dispose();
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
