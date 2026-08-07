// RALI 2 — STARTURILE PROBELOR: ștampila TC, numărătoarea inversă și startul din mers (v44).
//
// REGULA DE CONCURS, buletinul de AZI (07.08.2026, Sibiu): TR 1, TR 2 și TR 3 sunt
// self-start de pe loc, la 24, 80 și 131 de minute după începerea TC 1. Cronometrul
// probei curge de la TC+decalaj INDIFERENT dacă mașina e la linie — întârzierea acolo e
// penalizare directă, nu timp care se recuperează pe probă. TR 4 și TR 5 sunt din mers,
// fără decalaj, dar cu altă regulă: „Start din mers, fără oprire. Atenție, oprirea se va
// penaliza!"
//
// Aplicația NU poate ști singură când a început TC-ul — nu e în telefonul ei, e mâna
// arbitrului pe ștampilă. Deci omul apasă un buton exact atunci, o dată, iar de acolo
// încolo orele de start, numărătoarea de pe ecran și cele patru anunțuri sunt aritmetică.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock, starturiDinStampila, fmtMMSS, textStart, frazaPragStart,
         PRAGURI_START_S } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const aici = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const MIN = 60000;

// ══ 1. ARITMETICA PURĂ ══════════════════════════════════════════════════════
console.log('\n═══ Orele de start, din ștampilă (decalajele reale de azi) ═══');
{
  // exact ce scrie buletinul de azi, plus două probe din mers, fără decalaj
  const RTS = [
    { name: 'TR 1', startDupaTc: { tc: 'TC 1', minutes: 24 } },
    { name: 'TR 2', startDupaTc: { tc: 'TC 1', minutes: 80 } },
    { name: 'TR 3', startDupaTc: { tc: 'TC 1', minutes: 131 } },
    { name: 'TR 4', startDupaTc: null },
    { name: 'TR 5' }
  ];
  const T = 1000000;                       // momentul ștampilei, oricare
  const l = starturiDinStampila(RTS, T, T);
  ok('doar probele CU decalaj intră în numărătoare — TR 4 și TR 5 nu apar',
     l.length === 3 && l.map(x => x.name).join(' ') === 'TR 1 TR 2 TR 3',
     JSON.stringify(l.map(x => x.name)));
  ok('TR 1 pornește la ștampilă + 24 de minute', l[0].oraMs === T + 24 * MIN);
  ok('TR 2 la + 80 de minute', l[1].oraMs === T + 80 * MIN);
  ok('TR 3 la + 131 de minute', l[2].oraMs === T + 131 * MIN);
  ok('rămân în ordinea orei, nu a planului', l[0].oraMs < l[1].oraMs && l[1].oraMs < l[2].oraMs);
  ok('și își cară TC-ul de referință, ca omul să poată verifica pe hârtie',
     l.every(x => x.tc === 'TC 1'));
  ok('fără ștampilă nu există nicio linie', starturiDinStampila(RTS, null, T).length === 0);
  ok('un plan fără probe nu produce nimic', starturiDinStampila([], T, T).length === 0);
  ok('și nici o listă care nu e listă', starturiDinStampila(null, T, T).length === 0);

  // culorile: verde departe, galben sub 5 minute, roșu sub un minut
  const stare = (min, sec) => starturiDinStampila(
    [{ name: 'X', startDupaTc: { tc: 'TC 1', minutes: min } }], 0, sec * 1000)[0].stare;
  ok('verde cât mai e mult (24 de minute, la 1 minut după ștampilă)', stare(24, 60) === 'verde');
  ok('verde până fix la 5 minute și o secundă', stare(24, 24 * 60 - 301) === 'verde');
  ok('galben la 5 minute fix', stare(24, 24 * 60 - 300) === 'galben');
  ok('galben la 61 de secunde', stare(24, 24 * 60 - 61) === 'galben');
  ok('roșu la 60 de secunde', stare(24, 24 * 60 - 60) === 'rosu');
  ok('roșu la o secundă', stare(24, 24 * 60 - 1) === 'rosu');
  ok('trecut la zero', stare(24, 24 * 60) === 'trecut');
  ok('trecut și după', stare(24, 24 * 60 + 30) === 'trecut');
}

console.log('\n═══ Cum arată linia pe ecran ═══');
{
  ok('mm:ss, cu minutele NEplafonate — decalajul lui TR 3 e de 131 de minute',
     fmtMMSS(131 * 60) === '131:00', fmtMMSS(131 * 60));
  ok('12 minute și 34 de secunde', fmtMMSS(754) === '12:34');
  ok('secundele au două cifre', fmtMMSS(65) === '1:05');
  ok('sub un minut', fmtMMSS(9) === '0:09');
  ok('negativ înseamnă zero, nu o cifră ciudată', fmtMMSS(-5) === '0:00');
  ok('se rotunjește ÎN JOS — nu promitem timp care nu există', fmtMMSS(59.9) === '0:59');

  const l = starturiDinStampila([{ name: 'TR 1', startDupaTc: { tc: 'TC 1', minutes: 24 } }],
                                0, 24 * MIN - 754000)[0];
  ok('linia din cockpit e „TR 1 — start în 12:34"',
     textStart(l) === 'TR 1 — start în 12:34', textStart(l));
  ok('în pregătire mai apare și ora de perete a startului',
     /^TR 1 — start în 12:34 · ora \d\d:\d\d:\d\d$/.test(textStart(l, { ora: true })),
     textStart(l, { ora: true }));
  const t = starturiDinStampila([{ name: 'TR 1', startDupaTc: { tc: 'TC 1', minutes: 24 } }],
                                0, 24 * MIN + 200000)[0];
  ok('după start, linia spune de cât a trecut, nu minte cu 0:00',
     textStart(t) === 'TR 1 — start trecut de 3:20', textStart(t));
}

console.log('\n═══ Ce se rostește la fiecare prag ═══');
{
  ok('pragurile sunt 5 minute, 1 minut, 15 secunde și zero',
     JSON.stringify(PRAGURI_START_S) === '[300,60,15,0]');
  ok('la 5 minute: „TR 1 în 5 minute."', frazaPragStart('TR 1', 300) === 'TR 1 în 5 minute.');
  ok('la 1 minut: „TR 1 într-un minut."', frazaPragStart('TR 1', 60) === 'TR 1 într-un minut.');
  ok('la 15 secunde: „TR 1 în 15 secunde."', frazaPragStart('TR 1', 15) === 'TR 1 în 15 secunde.');
  ok('la zero: „TR 1 — pornește!"', frazaPragStart('TR 1', 0) === 'TR 1 — pornește!');
}

// ══ 2. PRIN MAȘINA DE STĂRI ═════════════════════════════════════════════════
// Roadbook + buletin ca azi: trei probe de pe loc cu decalaj (24 / 80 / 131) și una din
// mers, fără decalaj. Kilometrii sunt mici ca testul să nu conducă degeaba — decalajele
// sunt cele adevărate, fiindcă ele sunt subiectul.
const BOXES = sanitizeBoxes([
  { day: 1, leg: 1, page: 1, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'TC 1' },
  { day: 1, leg: 1, page: 1, num: 2, sumKm: 0.20, dir: 'ÎNAINTE', comment: 'Start TR 1' },
  { day: 1, leg: 1, page: 1, num: 3, sumKm: 1.60, dir: 'ÎNAINTE', comment: 'Finish TR 1' },
  { day: 1, leg: 1, page: 1, num: 4, sumKm: 3.00, dir: 'ÎNAINTE', comment: 'Start TR 2' },
  { day: 1, leg: 1, page: 1, num: 5, sumKm: 4.40, dir: 'ÎNAINTE', comment: 'Finish TR 2' },
  { day: 1, leg: 1, page: 1, num: 6, sumKm: 6.00, dir: 'ÎNAINTE', comment: 'Start TR 3' },
  { day: 1, leg: 1, page: 1, num: 7, sumKm: 7.40, dir: 'ÎNAINTE', comment: 'Finish TR 3' },
  { day: 1, leg: 1, page: 1, num: 8, sumKm: 9.00, dir: 'ÎNAINTE', comment: 'Start TR 4' },
  { day: 1, leg: 1, page: 1, num: 9, sumKm: 10.40, dir: 'ÎNAINTE', comment: 'Finish TR 4' }
]);
const proba = (name, s, f, min, tip) => ({
  name, startBox: s, finishBox: f, startPage: 1, finishPage: 1,
  startType: tip, kmh: 40, finishRel: 'at', speedChanges: [],
  startAfterTc: min == null ? null : { tc: 'TC 1', minutes: min }
});
const BULETIN = [proba('TR 1', 2, 3, 24, 'standing'), proba('TR 2', 4, 5, 80, 'standing'),
                 proba('TR 3', 6, 7, 131, 'standing'), proba('TR 4', 8, 9, null, 'auto')];

function lume(boxes = BOXES, buletin = BULETIN) {
  let wall = 0, lat = 45.7823, lng = 24.1461;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [], tonuri = [];
  const plan = buildPlan(boxes, {}, null, null, buletin);
  const m = makeMachine({ plan, clock, store, driver: makeDriverModel(),
    opts: { offRoute: false },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls, la: wall }),
             tone: k => tonuri.push({ k, la: wall }), flush() {},
             durataMs: t => 350 + String(t).length * 90 },
    ui: { render() {} } });
  return {
    m, said, store, plan, tonuri,
    get wall() { return wall; },
    // trecerea timpului, secundă cu secundă, cu bătaia independentă de GPS
    bate(secunde) { for (let i = 0; i < secunde; i++) { wall += 1000; m.tick(); } },
    // …sau până la o secundă ANUME de la pornirea ceasului. Pragurile se verifică pe
    // momente absolute („la 24 de minute minus 60 de secunde"), nu pe sume de pași:
    // o sumă greșită cu o secundă face testul să treacă pe lângă prag fără să-l atingă.
    panaLa(secunda) { const t = secunda * 1000; while (wall < t) { wall += 1000; m.tick(); } },
    stampeaza(la) { return m.stampeazaTc(la); },
    pas(metri) {
      lng += metri / (111320 * Math.cos(45.7823 * Math.PI / 180));
      wall += 1000;
      m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: 90, accM: 6 });
      m.tick();
    },
    condu(km, kmh) { const v = kmh / 3.6, n = Math.round(km * 1000 / v); for (let i = 0; i < n; i++) this.pas(v); },
    vorbit(re) { return said.filter(s => re.test(s.t)); },
    praguri() { return store.journal.filter(e => e.type === 'start_prag'); }
  };
}

console.log('\n═══ Ștampila pusă la TC 1: cele patru anunțuri ale lui TR 1 ═══');
{
  const w = lume();
  w.m.start();
  ok('planul chiar are cele trei decalaje reale',
     w.plan.rts.filter(r => r.startDupaTc).map(r => r.startDupaTc.minutes).join(' ') === '24 80 131',
     JSON.stringify(w.plan.rts.map(r => [r.name, r.startDupaTc && r.startDupaTc.minutes])));
  ok('înainte de ștampilă nu se numără nimic', w.m.M.startLinii.length === 0);
  w.stampeaza();
  ok('după ștampilă apar trei linii pe ecran', w.m.M.startLinii.length === 3);
  ok('și niciuna nu s-a rostit încă (mai e mult)', w.vorbit(/TR 1|TR 2|TR 3/).length === 0,
     JSON.stringify(w.vorbit(/TR/).map(s => s.t)));

  w.panaLa(24 * 60 - 301);                            // 5 minute și o secundă rămase
  ok('la 5 minute și o secundă, tăcere', w.vorbit(/TR 1 în 5 minute/).length === 0);
  w.panaLa(24 * 60 - 300);
  ok('la 5 minute fix: „TR 1 în 5 minute."',
     w.vorbit(/^TR 1 în 5 minute\.$/).length === 1, JSON.stringify(w.vorbit(/TR 1/).map(s => s.t)));
  w.panaLa(24 * 60 - 60);
  ok('la un minut: „TR 1 într-un minut."', w.vorbit(/^TR 1 într-un minut\.$/).length === 1);
  w.panaLa(24 * 60 - 15);
  ok('la 15 secunde: „TR 1 în 15 secunde."', w.vorbit(/^TR 1 în 15 secunde\.$/).length === 1);
  w.panaLa(24 * 60);
  ok('la zero: „TR 1 — pornește!"', w.vorbit(/^TR 1 — pornește!$/).length === 1);
  ok('și tonul de zero e alarma, nu tic-ul obișnuit',
     w.tonuri.filter(t => t.k === 'alarm').length === 1, JSON.stringify(w.tonuri.map(t => t.k)));

  // IDEMPOTENȚA — motivul pentru care pragurile se marchează în stare
  w.panaLa(24 * 60 + 600);
  ok('niciun prag nu se repetă, oricât ar bate ceasul mai departe',
     w.vorbit(/^TR 1 /).length === 4, JSON.stringify(w.vorbit(/^TR 1 /).map(s => s.t)));
  ok('fiecare prag a lăsat urmă în jurnal',
     w.praguri().filter(e => e.name === 'TR 1').map(e => e.pragS).join(' ') === '300 60 15 0',
     JSON.stringify(w.praguri().map(e => [e.name, e.pragS])));
  ok('și jurnalul poartă ora de start calculată, nu doar pragul',
     w.praguri().every(e => e.oraStart === 24 * MIN && e.inProba === false));

  // clasa vocală: mare, dar sub manevrele „acum"
  const a = w.vorbit(/^TR 1 — pornește!$/)[0];
  ok('anunțul e prioritate 4 — nu se aruncă din coadă la primul mesaj nou', a.p === 4);
  ok('…dar clasa e „ritm", deci nu taie niciodată o manevră „acum"', a.cls === 'ritm',
     JSON.stringify(a));
  ok('…iar categoria e pe PROBĂ, ca numărătoarea uneia să n-o arunce pe a alteia',
     a.cat === 'start_TR 1', a.cat);

  // TR 2 și TR 3 au fiecare setul lor complet, la orele lor
  w.panaLa(80 * 60);
  ok('TR 2 și-a rostit toate cele patru praguri, la +80 de minute',
     w.vorbit(/^TR 2 /).length === 4, JSON.stringify(w.vorbit(/^TR 2 /).map(s => s.t)));
  ok('…iar TR 3 încă niciunul', w.vorbit(/^TR 3 /).length === 0);
  w.panaLa(131 * 60);
  ok('TR 3 le rostește la +131 de minute', w.vorbit(/^TR 3 /).length === 4,
     JSON.stringify(w.vorbit(/^TR 3 /).map(s => s.t)));
  ok('TR 4 — din mers, fără decalaj — nu are numărătoare deloc',
     w.vorbit(/^TR 4 în |^TR 4 într|^TR 4 — pornește/).length === 0,
     JSON.stringify(w.vorbit(/TR 4/).map(s => s.t)));
  ok('…și nu apare nici pe ecran, printre liniile de start',
     w.m.M.startLinii.every(l => l.name !== 'TR 4'),
     JSON.stringify(w.m.M.startLinii.map(l => l.name)));
}

console.log('\n═══ Probă fără decalaj: nicio numărătoare ═══');
{
  const w = lume(BOXES, [proba('TR 4', 8, 9, null, 'auto')]);
  w.m.start();
  w.stampeaza();
  ok('ștampila nu produce nicio linie când nicio probă n-are decalaj',
     w.m.M.startLinii.length === 0);
  w.bate(3 * 3600);
  ok('și nu se rostește nimic, oricât ar trece ceasul',
     w.vorbit(/pornește|minute|secunde/).length === 0,
     JSON.stringify(w.vorbit(/./).map(s => s.t)));
}

console.log('\n═══ Ora de start deja trecută: tăcere, nu strigăte retroactive ═══');
{
  // Cazul real: telefonul a repornit la 30 de minute după TC 1. Ștampila se pune cu ora
  // corectă (cea de pe ceas), dar startul lui TR 1 e demult trecut.
  const w = lume();
  w.m.start();
  w.bate(30 * 60);
  w.stampeaza(0);                        // ștampila e la momentul 0, adică acum 30 de minute
  ok('cele trei linii există pe ecran (ele nu mint, doar arată)', w.m.M.startLinii.length === 3);
  ok('TR 1 apare ca „start trecut"', w.m.M.startLinii[0].stare === 'trecut');
  ok('dar NU s-a rostit niciun prag al lui TR 1, retroactiv',
     w.vorbit(/^TR 1 /).length === 0, JSON.stringify(w.vorbit(/TR/).map(s => s.t)));
  ok('și nici nu s-a scris vreunul în jurnal ca rostit acum',
     w.praguri().filter(e => e.name === 'TR 1' && e.pragS === 0).length === 0);
  w.bate(50 * 60 - 1);                   // → TR 2 (la +80) mai are 300 s
  ok('TR 2, care e încă în viitor, își rostește pragurile normal',
     w.vorbit(/^TR 2 în 5 minute\.$/).length === 1, JSON.stringify(w.vorbit(/TR 2/).map(s => s.t)));
}

console.log('\n═══ A doua apăsare mută ștampila (TC 3 de la Orlat) ═══');
{
  const w = lume();
  w.m.start();
  w.stampeaza();
  w.bate(24 * 60 - 300);
  ok('primul „TR 1 în 5 minute." s-a rostit', w.vorbit(/^TR 1 în 5 minute\.$/).length === 1);
  const veche = w.m.M.stampila.rallyMs;
  w.stampeaza();                          // apăsare nouă, la 19 minute după prima
  ok('ștampila s-a mutat în momentul apăsării',
     w.m.M.stampila.rallyMs !== veche && w.m.M.stampila.rallyMs === (24 * 60 - 300) * 1000,
     `${w.m.M.stampila.rallyMs}`);
  ok('ora de start a lui TR 1 s-a recalculat de la ștampila NOUĂ',
     w.m.M.startLinii[0].oraMs === (24 * 60 - 300) * 1000 + 24 * MIN,
     `${w.m.M.startLinii[0].oraMs}`);
  ok('imediat după re-ștampilare nu se strigă nimic', w.vorbit(/^TR 1 /).length === 1);
  w.bate(24 * 60 - 300);
  ok('…iar pragurile se rostesc din nou, la orele noi',
     w.vorbit(/^TR 1 în 5 minute\.$/).length === 2,
     JSON.stringify(w.vorbit(/^TR 1 /).map(s => s.t)));
  ok('și în jurnal sunt DOUĂ ștampile, nu una rescrisă',
     w.store.journal.filter(e => e.type === 'tc_stampila').length === 2);
}

console.log('\n═══ Ștampila supraviețuiește unei reporniri ═══');
{
  const w = lume();
  w.m.start();
  w.stampeaza();
  ok('momentul s-a scris în depozit, sub cheia `tc_stamp`',
     w.store.kv.get('tc_stamp') && w.store.kv.get('tc_stamp').rallyMs === 0,
     JSON.stringify(w.store.kv.get('tc_stamp')));
  // aplicația repornește: mașină nouă, ștampila reluată din depozit
  const w2 = lume();
  w2.m.start();
  w2.bate(24 * 60 - 200);                 // au trecut 20 de minute și ceva
  w2.m.reiaStampila(0);
  ok('numărătoarea se reia cu orele corecte', w2.m.M.startLinii[0].oraMs === 24 * MIN);
  ok('pragurile deja trecute NU se strigă la reluare',
     w2.vorbit(/^TR 1 în 5 minute\.$/).length === 0, JSON.stringify(w2.vorbit(/TR 1/).map(s => s.t)));
  ok('reluarea nu inventează o a doua ștampilă în jurnal',
     w2.store.journal.filter(e => e.type === 'tc_stampila').length === 0);
  w2.bate(185);                           // → 15 secunde rămase
  ok('dar pragurile care mai URMEAZĂ se rostesc normal',
     w2.vorbit(/^TR 1 în 15 secunde\.$/).length === 1,
     JSON.stringify(w2.vorbit(/TR 1/).map(s => s.t)));
}

// ══ 3. ÎN PROBĂ: ECRANUL VORBEȘTE, VOCEA TACE ═══════════════════════════════
// Roadbook mic, croit pe fereastra care contează: o probă DIN MERS care rulează exact
// cât timp o altă probă își consumă pragurile.
const BOXES2 = sanitizeBoxes([
  { day: 1, leg: 1, page: 1, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'TC 1' },
  { day: 1, leg: 1, page: 1, num: 2, sumKm: 0.20, dir: 'ÎNAINTE', comment: 'Start TR A' },
  { day: 1, leg: 1, page: 1, num: 3, sumKm: 1.80, dir: 'ÎNAINTE', comment: 'Finish TR A' },
  { day: 1, leg: 1, page: 1, num: 4, sumKm: 4.00, dir: 'ÎNAINTE', comment: 'Start TR B' },
  { day: 1, leg: 1, page: 1, num: 5, sumKm: 5.40, dir: 'ÎNAINTE', comment: 'Finish TR B' }
]);
const BULETIN2 = [proba('TR A', 2, 3, null, 'auto'), proba('TR B', 4, 5, 2, 'standing')];

console.log('\n═══ În timpul unei probe active, numărătoarea altei probe TACE ═══');
{
  const w = lume(BOXES2, BULETIN2);
  w.m.start();
  w.stampeaza();                          // TR B pornește la +2 minute (120 s)
  w.condu(0.30, 40);                      // ~27 s: TR A a pornit
  ok('TR A rulează', w.m.M.state === 'RT_RUN', w.m.M.state);
  w.condu(1.20, 40);                      // ~108 s cumulat — trec pragurile de 60 și 15
  ok('suntem încă în probă', w.m.M.state === 'RT_RUN', w.m.M.state);
  ok('pragurile lui TR B s-au consumat, dar NU s-au rostit',
     w.vorbit(/^TR B /).length === 0, JSON.stringify(w.vorbit(/TR B/).map(s => s.t)));
  const inProba = w.praguri().filter(e => e.name === 'TR B' && e.inProba);
  ok('…și se vede în jurnal DE CE au tăcut',
     inProba.length >= 2, JSON.stringify(w.praguri().map(e => [e.name, e.pragS, e.inProba])));
  ok('dar linia rămâne pe ecran, cu secundele curente',
     w.m.M.startLinii.length === 1 && w.m.M.startLinii[0].name === 'TR B',
     JSON.stringify(w.m.M.startLinii.map(l => l.name)));
  // …și nici după probă nu izbucnesc, vechi de minute
  w.condu(0.60, 40);
  ok('proba s-a terminat', w.m.M.state !== 'RT_RUN', w.m.M.state);
  ok('și tot nu se rostește un prag consumat în probă',
     w.vorbit(/^TR B /).length === 0, JSON.stringify(w.vorbit(/TR B/).map(s => s.t)));
}

// ══ 4. STARTUL DIN MERS: „nu opri!" ═════════════════════════════════════════
// Buletinul de azi, pentru TR 4, TR 5 și TR 6: „Start din mers, fără oprire. Atenție,
// oprirea se va penaliza!" La probele de pe loc regula e exact inversă — acolo TREBUIE
// să oprești la linie — deci avertismentul n-are voie să apară.
const BOXES3 = sanitizeBoxes([
  { day: 1, leg: 1, page: 1, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'TC 1' },
  { day: 1, leg: 1, page: 1, num: 2, sumKm: 1.00, dir: 'ÎNAINTE', comment: 'Start din mers' },
  { day: 1, leg: 1, page: 1, num: 3, sumKm: 2.40, dir: 'ÎNAINTE', comment: 'Finish' },
  { day: 1, leg: 1, page: 1, num: 4, sumKm: 3.60, dir: 'ÎNAINTE', comment: 'Start de pe loc' },
  { day: 1, leg: 1, page: 1, num: 5, sumKm: 5.00, dir: 'ÎNAINTE', comment: 'Finish' }
]);

console.log('\n═══ Probă din mers: „Din mers — nu opri!", exact o dată ═══');
{
  const w = lume(BOXES3, [{ ...proba('TR 4', 2, 3, null, 'auto'), kmh: 29.5 },
                          proba('TR 5', 4, 5, null, 'standing')]);
  w.m.start();
  ok('prima probă e din mers, a doua de pe loc',
     w.plan.rts.map(r => r.type).join(' ') === 'auto standing',
     JSON.stringify(w.plan.rts.map(r => [r.name, r.type])));
  w.condu(0.70, 40);                      // intră în fereastra de 500 m a lui TR 4
  const av = w.vorbit(/^Proba în 500\./);
  ok('fraza e exact „Proba în 500. Viteza 29 și 5. Din mers — nu opri!"',
     av.length === 1 && av[0].t === 'Proba în 500. Viteza 29 și 5. Din mers — nu opri!',
     JSON.stringify(av.map(s => s.t)));
  w.condu(2.60, 30);                      // trece proba din mers, apoi spre TR 5
  const toate = w.vorbit(/Din mers — nu opri!/);
  ok('avertismentul apare O SINGURĂ DATĂ pe toată proba',
     toate.length === 1, JSON.stringify(toate.map(s => s.t)));
  const av2 = w.vorbit(/^Proba în 500\./);
  ok('a doua avertizare e a probei de pe loc, fără avertisment de oprire',
     av2.length === 2 && av2[1].t === 'Proba în 500. Viteza 40.',
     JSON.stringify(av2.map(s => s.t)));
}

console.log('\n═══ Probă de pe loc: nu se spune niciodată „nu opri" ═══');
{
  const w = lume(BOXES3, [proba('TR 1', 2, 3, null, 'standing')]);
  w.m.start();
  w.condu(1.00, 40);
  ok('la probele de pe loc avertismentul lipsește cu totul',
     w.vorbit(/nu opri!/).length === 0, JSON.stringify(w.vorbit(/Proba în 500/).map(s => s.t)));
  ok('…iar fraza rămâne cea de dinainte, neatinsă',
     w.vorbit(/^Proba în 500\. Viteza 40\.$/).length === 1,
     JSON.stringify(w.vorbit(/Proba în 500/).map(s => s.t)));
}

// ══ 5. CABLAJUL ═════════════════════════════════════════════════════════════
// Ce se verifică aici nu e aspectul, ci că butonul EXISTĂ în amândouă ecranele, că duce
// în aceeași funcție și că numărătoarea ajunge pe ecran. Un buton nelegat arată exact ca
// unul legat — până la 12:01.
console.log('\n═══ Cablajul: un buton, două locuri, aceeași funcție ═══');
{
  const html = readFileSync(join(aici, '..', 'index.html'), 'utf8');
  const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
  const uiTxt = readFileSync(join(aici, '..', 'js', 'ui.js'), 'utf8');
  const css = readFileSync(join(aici, '..', 'app.css'), 'utf8');
  const prep = html.slice(html.indexOf('id="scr-prep"'), html.indexOf('id="scr-run"'));
  const run = html.slice(html.indexOf('id="scr-run"'), html.indexOf('id="scr-map"'));

  ok('butonul „Ștampila TC" e în panoul de pregătire', /id="btn-stampila-prep"/.test(prep));
  ok('…și în cockpit', /id="btn-stampila"/.test(run));
  ok('amândouă duc în ACEEAȘI funcție — un singur loc de cod',
     /\$\('btn-stampila'\)\?\.addEventListener\('click', apasaStampila\)/.test(main) &&
     /\$\('btn-stampila-prep'\)\?\.addEventListener\('click', apasaStampila\)/.test(main));
  ok('a doua apăsare cere confirmare — mutarea recalculează toate orele de start',
     /function apasaStampila[\s\S]{0,600}?if \(veche && !confirm\(/.test(main));
  ok('momentul se scrie în depozit sub `tc_stamp`, ca să treacă peste o repornire',
     /store\.put\('tc_stamp'/.test(readFileSync(join(aici, '..', 'js', 'machine.js'), 'utf8')));
  ok('…și se citește înapoi la construirea planului',
     /store\.get\('tc_stamp'\)/.test(main) && /await reiaStampila\(\)/.test(main));
  ok('o ștampilă mai veche de 12 ore se ignoră — nu e ștampila de azi',
     /STAMPILA_MAX_MS/.test(main));
  ok('numărătoarea bate și în afara cursei (pregătire, repetiție), fără să numere de două ori',
     /if \(tickId == null\) machine\.stampilaTick\(\)/.test(main) &&
     /tickId = setInterval/.test(main));
  ok('banda de numărătoare există în cockpit', /id="cp-startband"/.test(run));
  ok('…și se desenează din `startLinii`', /M\.startLinii/.test(uiTxt));
  ok('…ÎNAINTE de ramurile cu return ale ieșirii de pe traseu (ceasul curge și când te rătăcești)',
     uiTxt.indexOf("$('cp-startband')") < uiTxt.indexOf('if (M.offRoute)'));
  ok('liniile au cele trei culori cerute: verde, galben sub 5 minute, roșu sub un minut',
     /\.startline\b/.test(css) && /\.startline\.galben/.test(css) && /\.startline\.rosu/.test(css));
  ok('și nu dispar pe ecran mic — o oră de start nu se poate deduce din altceva',
     /\.startline \{ padding: 4px; font-size: 13px; \}/.test(css));
  ok('numele probei intră pe ecran cu textContent — vine din poza buletinului',
     /d\.textContent = textStart\(l\)/.test(uiTxt));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
