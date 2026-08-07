// RALI 2 — PRIMA AVERTIZARE SPUNE ȘI CE BOX E (v43).
//
// Cererea lui Andreas, 07.08.2026, dimineața cursei de la Sibiu: „să aud și numărul
// boxului și ce zice roadbook-ul despre el, ca să mă pot lega de caiet și de hartă
// dintr-o ureche." Până acum vocea spunea de trei ori același lucru — „500 de metri —
// giratoriu, ieșirea 2", apoi „300 de metri — …", apoi „150 de metri — …" — fără să
// pomenească vreodată numărul din caietul pe care pilotul îl are deschis pe genunchi.
//
// Ce se verifică aici, în ordinea în care contează:
//  1. PRIMA treaptă a unei manevre spune „boxul N" plus reperul scurtat;
//  2. treptele următoare (300 / 150 / acum) rămân EXACT cum erau — scurte. Motivul e
//     măsurat, nu estetic: pe secțiunile dese frazele lungi la trepte succesive se calcă
//     una pe alta, iar vocea aruncă anunțuri (`voce_aruncata` în jurnalele reale);
//  3. box fără comentariu → doar „boxul N";
//  4. lanțurile v37 („Trei la rând: …") rămân neatinse.
//
// ROADBOOK-UL E CEL REAL: City Demo Sibiu, din jurnalul 06.08.2026 (plan_raw), boxurile
// 6-14, cu numerele, kilometrajul, direcțiile și comentariile exact ca pe hârtie.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// Kilometrajul e REBAZAT cu −0,55 (boxul 8 devine 0,00) și DILATAT: în City Demo boxurile
// sunt la 70-430 m unul de altul, iar aici trebuie loc pentru toate treptele, ca să se
// vadă că doar PRIMA primește descrierea. Comentariile sunt neatinse — ele sunt subiectul.
const SIBIU = sanitizeBoxes([
  { num: 8,  sumKm: 0.00, dir: 'ÎNAINTE',      flag: 'TC', comment: 'Tribunalul și Judecătoria Sibiu' },
  { num: 9,  sumKm: 1.20, dir: 'GIRATORIU-1',  comment: 'Str. Nicolae Teclu' },
  { num: 10, sumKm: 2.60, dir: 'GIRATORIU-2',  comment: 'Str. Constituției' },
  { num: 13, sumKm: 4.00, dir: 'GIRATORIU-2',  comment: 'To Center, Bd. Corneliu Coposu' },
  { num: 14, sumKm: 5.40, dir: 'DREAPTA',      comment: '' },
  { num: 16, sumKm: 6.80, dir: 'DREAPTA',      comment: 'Str. Filarmonicii' },
  { num: 20, sumKm: 8.00, dir: 'ÎNAINTE',      flag: 'RT_START_AUTO', comment: 'start probă · 40 km/h' },
  { num: 21, sumKm: 9.00, dir: 'ÎNAINTE',      flag: 'RT_FINISH', comment: 'finish' }
]);

// lume cu busolă, ca în restul suitei — fără adrese reale, doar geometrie
function lume(boxes = SIBIU, { viteze = { '20_8000': 40 } } = {}) {
  let wall = 0, lat = 45.7823, lng = 14.1461;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(boxes, viteze, null, null), clock, store,
    driver: makeDriverModel(), opts: { offRoute: false },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {},
             durataMs: t => 350 + String(t).length * 90 },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 90, accM: 6 });
  const pas = (metri, hdg = 90) => {
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(45.7823 * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: hdg, accM: 6 });
  };
  return { m, said, store, pas,
    // 15 m/s ≈ 54 km/h, un fix pe secundă — ritmul real al telefonului
    drum(km, viteza = 15) { const n = Math.round(km * 1000 / viteza); for (let i = 0; i < n; i++) pas(viteza); },
    vorbit(re) { return said.filter(s => re.test(s.t)); } };
}

console.log('\n═══ Giratoriul de la boxul 9: prima veste spune boxul și strada ═══');
{
  const w = lume();
  w.drum(1.15);
  const cifre = w.vorbit(/giratoriu, ieșirea 1/).map(s => s.t);
  ok('boxul 9 primește tot trei anunțuri cu cifră plus „acum" — nimic nu s-a pierdut',
     cifre.length === 4, JSON.stringify(cifre));
  ok('PRIMA (~500 m) spune numărul boxului și reperul din roadbook',
     cifre[0] === '500 de metri — giratoriu, ieșirea 1 — boxul 9, Str. Nicolae Teclu',
     JSON.stringify(cifre[0]));
  // treptele se rostesc la distanța REALĂ din fixul care le declanșează (290, 140 m la
  // 54 km/h), ca în restul suitei — ce se verifică aici e că fraza rămâne curată
  ok('a doua (~300 m) rămâne exact cum era — scurtă',
     /^2[5-9]\d de metri — giratoriu, ieșirea 1$/.test(cifre[1] || ''), JSON.stringify(cifre[1]));
  ok('a treia (~150 m) la fel',
     /^1[0-4]\d de metri — giratoriu, ieșirea 1$/.test(cifre[2] || ''), JSON.stringify(cifre[2]));
  ok('iar „acum"-ul nu capătă niciun cuvânt în plus',
     /^giratoriu, ieșirea 1$/.test(cifre[3] || ''), JSON.stringify(cifre[3]));
  ok('deci numărul boxului se aude O SINGURĂ DATĂ pentru boxul 9',
     w.vorbit(/boxul 9\b/).length === 1, JSON.stringify(w.vorbit(/boxul 9\b/).map(s => s.t)));
  const desc = w.store.journal.filter(e => e.type === 'box_descris');
  ok('și se scrie în jurnal, ca la debrief să se poată număra',
     desc.some(e => e.boxNum === 9), JSON.stringify(desc.map(e => e.boxNum)));
}

console.log('\n═══ Reperul trece prin aceeași sită ca ghidajul offroute din v42 ═══');
{
  const w = lume();
  w.drum(3.95);
  ok('„To Center, Bd. Corneliu Coposu" devine „Bd. Corneliu Coposu" (extrageReper)',
     w.vorbit(/boxul 13/).some(s => /— boxul 13, Bd\. Corneliu Coposu$/.test(s.t)),
     JSON.stringify(w.vorbit(/boxul 13/).map(s => s.t)));
  ok('nu se rostește niciodată „To Center"',
     w.vorbit(/To Center/).length === 0, JSON.stringify(w.vorbit(/To Center/).map(s => s.t)));
  ok('boxul 10 își spune strada',
     w.vorbit(/boxul 10/).some(s => /— boxul 10, Str\. Constituției$/.test(s.t)),
     JSON.stringify(w.vorbit(/boxul 10/).map(s => s.t)));
  // reperul lung se taie la ultimul cuvânt întreg, ca la offroute (OFF_REPER_MAX = 40)
  const lung = lume(sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START' },
    { num: 2, sumKm: 1.50, dir: 'STÂNGA',
      comment: 'Tribunalul și Judecătoria Sibiu, secția de contencios administrativ' },
    { num: 3, sumKm: 3.00, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'start · 40 km/h' },
    { num: 4, sumKm: 4.00, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'finish' }
  ]), { viteze: { '3_3000': 40 } });
  lung.drum(1.1);
  const l = lung.vorbit(/— boxul 2,/)[0];
  ok('un reper prea lung se scurtează, nu se aruncă',
     !!l && /— boxul 2, .{3,40}$/.test(l.t) && !/contencios/.test(l.t), JSON.stringify(l && l.t));
}

console.log('\n═══ Box fără comentariu: doar „boxul N", fără virgulă în gol ═══');
{
  const w = lume();
  w.drum(5.35);
  const b14 = w.vorbit(/— boxul 14/);
  ok('boxul 14 n-are comentariu în roadbook, deci se spune doar numărul',
     b14.length === 1 && /^500 de metri — dreapta — boxul 14$/.test(b14[0].t),
     JSON.stringify(b14.map(s => s.t)));
}

console.log('\n═══ Lanțurile v37 rămân neatinse: acolo nu se adaugă nimic ═══');
{
  // boxurile REALE 105-106-107 din Reșița Leg 2: trei viraje în T în 170 m
  const BREBU = sanitizeBoxes([
    { num: 100, sumKm: 0.00, dir: 'ÎNAINTE', comment: '' },
    { num: 103, sumKm: 1.36, dir: 'STÂNGA', comment: 'Str. Gărâna' },
    { num: 104, sumKm: 1.99, dir: 'ÎNAINTE', comment: '' },
    { num: 105, sumKm: 2.15, dir: 'DREAPTA-T', comment: 'spre Brebu Nou' },
    { num: 106, sumKm: 2.27, dir: 'STÂNGA-T', comment: 'centrul satului' },
    { num: 107, sumKm: 2.32, dir: 'DREAPTA-T', comment: 'STOP' },
    { num: 108, sumKm: 2.51, dir: 'ÎNAINTE', comment: 'Exit Brebu Nou' }
  ]);
  // la viteza probei RT4 (24,3 km/h = 6,75 m/s), ca în test-lant.mjs — lanțul are nevoie
  // de timpul lui ca să existe: la 54 km/h cele trei viraje se rezolvă prin coadă
  const w = lume(BREBU, { viteze: {} });
  w.drum(2.45, 6.75);
  const preambul = w.vorbit(/^Trei la rând/);
  ok('preambulul de lanț se rostește (altfel testul n-ar demonstra nimic)',
     preambul.length === 1, JSON.stringify(w.said.map(s => s.t)));
  ok('și NU capătă niciun număr de box',
     !/boxul/.test(preambul[0].t), JSON.stringify(preambul[0].t));
  ok('nici ecourile din lanț („dreapta", „stânga") nu capătă nimic',
     w.said.filter(s => s.cat === 'ecou').every(s => !/boxul/.test(s.t)),
     JSON.stringify(w.said.filter(s => s.cat === 'ecou').map(s => s.t)));
  ok('niciunul dintre boxurile 105-107 nu-și aude numărul',
     w.vorbit(/boxul 10[567]/).length === 0, JSON.stringify(w.vorbit(/boxul/).map(s => s.t)));
  ok('dar boxul 103, izolat, și-l aude',
     w.vorbit(/boxul 103, Str\. Gărâna/).length === 1, JSON.stringify(w.vorbit(/boxul 103/).map(s => s.t)));
}

console.log('\n═══ Ce NU se atinge: semnele, probele, coada de manevră ═══');
{
  const w = lume();
  w.drum(8.05);
  ok('anunțul de Time Control rămâne curat (nu e o manevră)',
     w.vorbit(/Time Control/).every(s => !/boxul/.test(s.t)),
     JSON.stringify(w.vorbit(/Time Control/).map(s => s.t)));
  ok('anunțul de start de probă rămâne curat',
     w.vorbit(/Start probă|START probă/).every(s => !/boxul/.test(s.t)),
     JSON.stringify(w.vorbit(/probă/).map(s => s.t)));
  ok('toate anunțurile de viraj rămân clasa „manevra"',
     w.said.filter(s => s.cat === 'turn').every(s => s.cls === 'manevra'),
     JSON.stringify(w.said.filter(s => s.cat === 'turn' && s.cls !== 'manevra').map(s => s.t)));

  // COADA DE MANEVRĂ („…, apoi în 300 de metri stânga") bate descrierea: ce urmează e o
  // decizie de volan, numărul boxului e orientare. Două boxuri la 300 m unul de altul,
  // deci singura treaptă care încape e cea de 150 m — aceeași care poartă și coada.
  const PERECHE = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START' },
    { num: 2, sumKm: 1.50, dir: 'DREAPTA', comment: 'Str. Ocnei' },
    { num: 3, sumKm: 1.80, dir: 'STÂNGA', comment: 'Str. Filarmonicii' }
  ]);
  const p = lume(PERECHE, { viteze: {} });
  p.drum(1.45);
  const cu = p.vorbit(/apoi în \d+ de metri stânga/);
  ok('perechea strânsă spune ce urmează, ca în v37',
     cu.length >= 1, JSON.stringify(p.said.map(s => s.t)));
  ok('și atunci numărul boxului cedează locul — fraza nu le poartă pe amândouă',
     cu.every(s => !/boxul/.test(s.t)), JSON.stringify(cu.map(s => s.t)));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
