// RALI 2 — BULETINUL DIRECTORULUI DE CURSĂ și probele cu mai multe medii.
// Rulează: node v2/test/test-buletin.mjs
//
// FAPTUL care a cerut tot codul ăsta, verificat pe paginile fotografiate ale
// roadbook-ului de la Reșița (05.08.2026): boxurile 66, 97 și 104 — finișul lui TR3,
// schimbarea de medie din TR4 și finișul lui TR4 — n-au NICIO icoană și NICIUN
// comentariu. Nicio scanare de roadbook nu le poate găsi vreodată, oricât de bun ar fi
// promptul. Probele de regularitate nu se află în roadbook: se află într-un document
// separat, scrise în text — Buletinul Directorului de cursă.
//
// FIXTURA de mai jos e transcrierea buletinului real (Reșița, 26.06.2026, Document 3.1,
// „BULLETIN No. 2", semnat de Clerk of the Course), cinci probe, TR2…TR6. Boxurile sunt
// cele reale din roadbook-ul scanat (num, sumKm, dir, comment, page) — fără coordonate.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sanitizeBoxes, detectRts, buildPlan, sanitizeBuletin, imbinaBuletin,
         probeDinBuletin, normVitezaSalvata, faSegmente } from '../js/route.js';
import { idealTimeS, speedAt } from '../js/pace.js';
import { vitezaRo } from '../js/voice.js';
import { makeClock } from '../js/time.js';
import { buildTrace } from '../js/geo.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeDriverModel } from '../js/learn.js';

const aici = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── LEG 2 de la Reșița: boxurile reale (paginile 18-30) ─────────────────────
// Semnele de probă NU sunt puse deloc: exact cum arată roadbook-ul pe hârtie la boxurile
// 66, 97 și 104. Buletinul e singurul care știe unde încep și unde se termină probele.
const LEG2 = sanitizeBoxes([
  { day: 2, leg: 2, page: 18, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Start Leg 2 Time Control - TC 3' },
  { day: 2, leg: 2, page: 23, num: 50, sumKm: 13.67, dir: 'DREAPTA-T', comment: 'Exit Municipiul Reșița, To Brebu Nou, Semenic, DJ 582' },
  { day: 2, leg: 2, page: 23, num: 51, sumKm: 23.40, dir: 'ÎNAINTE', comment: 'Văliug 5 km, DJ 582' },
  { day: 2, leg: 2, page: 24, num: 56, sumKm: 38.58, dir: 'DREAPTA-T', comment: 'To Semenic, DJ 582E' },
  { day: 2, leg: 2, page: 24, num: 57, sumKm: 38.80, dir: 'ÎNAINTE', comment: 'Start RT 2, DJ 582E' },
  { day: 2, leg: 2, page: 24, num: 63, sumKm: 46.95, dir: 'ÎNAINTE', comment: 'DJ 582E' },
  { day: 2, leg: 2, page: 25, num: 64, sumKm: 47.69, dir: 'ÎNAINTE', comment: 'Start RT 3, DJ 582E' },
  { day: 2, leg: 2, page: 25, num: 65, sumKm: 47.98, dir: 'ÎNAINTE', comment: 'DJ 582E' },
  { day: 2, leg: 2, page: 25, num: 66, sumKm: 53.95, dir: 'DREAPTA-T', comment: 'To Brebu Nou, DJ 582' },
  { day: 2, leg: 2, page: 26, num: 78, sumKm: 61.96, dir: 'STÂNGA', comment: '' },
  { day: 2, leg: 2, page: 26, num: 79, sumKm: 62.12, dir: 'ÎNAINTE', comment: 'Start RT 4, Brown Gate with bell' },
  { day: 2, leg: 2, page: 28, num: 96, sumKm: 67.44, dir: 'ÎNAINTE', comment: '' },
  { day: 2, leg: 2, page: 28, num: 97, sumKm: 67.86, dir: 'DREAPTA-T', comment: '' },
  { day: 2, leg: 2, page: 29, num: 103, sumKm: 70.36, dir: 'STÂNGA', comment: '' },
  { day: 2, leg: 2, page: 29, num: 104, sumKm: 70.99, dir: 'ÎNAINTE', comment: '' },
  { day: 2, leg: 2, page: 29, num: 105, sumKm: 71.15, dir: 'DREAPTA-T', comment: '' },
  { day: 2, leg: 2, page: 29, num: 108, sumKm: 71.51, dir: 'ÎNAINTE', comment: 'Exit Brebu Nou' },
  { day: 2, leg: 2, page: 30, num: 111, sumKm: 76.59, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Finish Leg 2 Time Control - TC 4' }
]);

// ── Buletinul, transcris (cele cinci probe, exact cum scrie pe hârtie) ──────
const BULETIN = [
  { name: 'TR 2', startBox: 57, startPage: 24, startType: 'standing',
    startAfterTc: { tc: 'TC 3', minutes: 77 }, kmh: 44.8,
    speedChanges: [], finishBox: 64, finishPage: 25, finishRel: 'at' },
  { name: 'TR 3', startBox: 64, startPage: 25, startType: 'auto',
    startAfterTc: null, kmh: 34.6, speedChanges: [],
    finishBox: 66, finishPage: 25, finishRel: 'before' },
  { name: 'TR 4', startBox: 79, startPage: 26, startType: 'standing',
    startAfterTc: { tc: 'TC 3', minutes: 149 }, kmh: 24.3,
    speedChanges: [{ kmh: 20.5, box: 97, page: 28, place: null }],
    finishBox: 104, finishPage: 29, finishRel: 'after' },
  { name: 'TR 5', startBox: 4, startPage: 36, startType: 'standing',
    startAfterTc: { tc: 'TC 5', minutes: 7 }, kmh: 40,
    speedChanges: [], finishBox: 7, finishPage: 36, finishRel: 'at' },
  { name: 'TR 6', startBox: 7, startPage: 36, startType: 'auto',
    startAfterTc: null, kmh: 30,
    speedChanges: [{ kmh: 45, box: null, page: null, place: 'la ieșirea din localitatea Văliug' }],
    finishBox: 17, finishPage: 37, finishRel: 'before' }
];

console.log('\n═══ Buletinul, citit și trecut prin sită ═══');
{
  const b = sanitizeBuletin(BULETIN);
  ok('cele cinci probe trec întregi', b.length === 5, String(b.length));
  ok('numele, exact cum scrie pe hârtie',
     b.map(p => p.name).join('|') === 'TR 2|TR 3|TR 4|TR 5|TR 6', b.map(p => p.name).join('|'));
  ok('mediile: 44,8 · 34,6 · 24,3 · 40 · 30',
     b.map(p => p.kmh).join(' ') === '44.8 34.6 24.3 40 30', b.map(p => p.kmh).join(' '));
  ok('TR 2 pornește de pe loc, la 77 de minute după TC 3',
     b[0].startType === 'standing' && b[0].startAfterTc.tc === 'TC 3' && b[0].startAfterTc.minutes === 77,
     JSON.stringify(b[0].startAfterTc));
  ok('TR 3 e start lansat, fără decalaj față de vreun TC',
     b[1].startType === 'auto' && b[1].startAfterTc === null);
  ok('paginile se păstrează — ele leagă proba de leg',
     b[2].startPage === 26 && b[2].finishPage === 29);
}

console.log('\n═══ Calificativul finișului: „la" / „înainte de" / „după" ═══');
{
  // Cele trei nu înseamnă același lucru și nu se pot colapsa la „boxul N" în tăcere.
  const b = sanitizeBuletin(BULETIN);
  ok('TR 2 se termină LA boxul 64', b[0].finishRel === 'at' && b[0].finishBox === 64);
  ok('TR 3 se termină ÎNAINTE de boxul 66', b[1].finishRel === 'before' && b[1].finishBox === 66);
  ok('TR 4 se termină DUPĂ boxul 104', b[2].finishRel === 'after' && b[2].finishBox === 104);
  ok('un calificativ inventat de model se aruncă',
     sanitizeBuletin([{ name: 'TR 9', startBox: 1, finishBox: 2, finishRel: 'undeva pe-acolo' }])[0].finishRel === null);
}

console.log('\n═══ Schimbarea de medie: pe BOX (TR4) sau pe LOC (TR6) ═══');
{
  const b = sanitizeBuletin(BULETIN);
  const tr4 = b[2].speedChanges[0], tr6 = b[4].speedChanges[0];
  ok('TR 4: 20,5 km/h legat de boxul 97, pagina 28',
     tr4.kmh === 20.5 && tr4.box === 97 && tr4.page === 28 && tr4.place === null, JSON.stringify(tr4));
  ok('TR 6: 45 km/h legat de un LOC, fără box',
     tr6.kmh === 45 && tr6.box === null && tr6.place === 'la ieșirea din localitatea Văliug',
     JSON.stringify(tr6));
  ok('o schimbare fără nici box, nici loc, se aruncă la graniță',
     sanitizeBuletin([{ name: 'TR 9', startBox: 1, finishBox: 2,
       speedChanges: [{ kmh: 30, box: null, place: null }] }])[0].speedChanges.length === 0);
  ok('și una fără viteză, la fel',
     sanitizeBuletin([{ name: 'TR 9', startBox: 1, finishBox: 2,
       speedChanges: [{ box: 5 }] }])[0].speedChanges.length === 0);
}

console.log('\n═══ Potrivirea probă ↔ leg se face după PAGINĂ ═══');
{
  // Numerele de box repornesc la fiecare leg: „boxul 57" există în leg 2 ȘI în leg 3.
  // Paginile nu repornesc — deci ele sunt singurul lucru pe care se poate potrivi.
  const r = probeDinBuletin(LEG2, BULETIN, null);
  ok('buletinul are cinci probe în total', r.total === 5, String(r.total));
  ok('pe Leg 2 (paginile 18-30) cad exact trei', r.inLeg === 3, String(r.inLeg));
  ok('și anume TR 2, TR 3, TR 4 — nu TR 5, nu TR 6',
     r.rts.map(x => x.name).join('|') === 'TR 2|TR 3|TR 4', r.rts.map(x => x.name).join('|'));
  ok('toate trei se leagă de boxuri reale', r.legate === 3, String(r.legate));
  ok('și se numără câte boxuri cerute de buletin s-au găsit (7 din 7)',
     r.boxuriPotrivite === 7 && r.boxuriCerute === 7,
     `${r.boxuriPotrivite}/${r.boxuriCerute}`);
  ok('TR 5 și TR 6 nu produc zgomot pe ecran — sunt ale altui leg, se tace',
     !r.note.some(n => /TR 5|TR 6/.test(n.text)), JSON.stringify(r.note.map(n => n.text)));
  ok('funcția e pură: boxurile primite nu se ating',
     LEG2.every(b => b.flags.length === (b.num === 1 || b.num === 111 ? 1 : 0)));
}

console.log('\n═══ Cele trei probe de pe Leg 2, cu cifrele lor ═══');
{
  const r = probeDinBuletin(LEG2, BULETIN, null);
  const [tr2, tr3, tr4] = r.rts;
  ok('TR 2: boxul 57 (38,80) → boxul 64 (47,69) = 8,89 km, de pe loc',
     tr2.startKm === 38.8 && tr2.finishKm === 47.69 && tr2.distKm === 8.89 && tr2.type === 'standing',
     JSON.stringify([tr2.startKm, tr2.finishKm, tr2.distKm, tr2.type]));
  ok('TR 3: boxul 64 (47,69) → boxul 66 (53,95) = 6,26 km, din mers',
     tr3.startKm === 47.69 && tr3.finishKm === 53.95 && tr3.distKm === 6.26 && tr3.type === 'auto',
     JSON.stringify([tr3.startKm, tr3.finishKm, tr3.distKm, tr3.type]));
  ok('TR 4: boxul 79 (62,12) → boxul 104 (70,99) = 8,87 km',
     tr4.startKm === 62.12 && tr4.finishKm === 70.99 && tr4.distKm === 8.87,
     JSON.stringify([tr4.startKm, tr4.finishKm, tr4.distKm]));
  ok('indicii arată spre boxurile reale din listă',
     LEG2[tr4.startIdx].num === 79 && LEG2[tr4.finishIdx].num === 104,
     JSON.stringify([LEG2[tr4.startIdx].num, LEG2[tr4.finishIdx].num]));
  ok('cheia probei e aceeași ca la detectRts, deci vitezele puse de mână se regăsesc',
     tr4.key === '79_6212', tr4.key);
  ok('probele știu că vin din buletin', r.rts.every(x => x.sursa === 'buletin'));
}

console.log('\n═══ SEGMENTELE lui TR4: 24,3 până la boxul 97, apoi 20,5 ═══');
{
  const r = probeDinBuletin(LEG2, BULETIN, null);
  const tr4 = r.rts[2];
  // boxul 79 = 62,12 km · boxul 97 = 67,86 km → schimbarea la 5,74 km DE PROBĂ
  ok('două segmente, cu punctul de schimbare la 5,74 km de la start',
     JSON.stringify(tr4.segments) === JSON.stringify([{ fromKm: 0, kmh: 24.3 }, { fromKm: 5.74, kmh: 20.5 }]),
     JSON.stringify(tr4.segments));
  ok('`kmh` rămâne pe probă, egal cu viteza primului segment', tr4.kmh === 24.3, String(tr4.kmh));
  ok('schimbarea își ține minte boxul, pentru ecran',
     tr4.schimbari.length === 1 && tr4.schimbari[0].box === 97 && tr4.schimbari[0].kmh === 20.5,
     JSON.stringify(tr4.schimbari));
  ok('viteza la 3 km e încă 24,3', speedAt(3, tr4.segments) === 24.3);
  ok('la 6 km e deja 20,5', speedAt(6, tr4.segments) === 20.5);

  // TIMPUL IDEAL, comparat cu calculul de mână pe două segmente
  const mana = (5.74 / 24.3) * 3600 + (8.87 - 5.74) / 20.5 * 3600;
  ok('timpul ideal pe TR4 = 850,4 s + 549,7 s = 1400,0 s',
     near(idealTimeS(tr4.distKm, tr4.segments), mana, 1e-9),
     `${idealTimeS(tr4.distKm, tr4.segments).toFixed(3)} vs ${mana.toFixed(3)}`);
  ok('adică 23 de minute și 20 de secunde',
     Math.round(idealTimeS(tr4.distKm, tr4.segments)) === 1400,
     String(Math.round(idealTimeS(tr4.distKm, tr4.segments))));
  // …și cât ar fi ieșit dacă a doua medie s-ar fi pierdut: proba întreagă la 24,3
  // înseamnă 1313,8 s, adică 86 de secunde de deviere care se adună singure
  const doarPrima = (8.87 / 24.3) * 3600;
  ok('fără segmentul al doilea s-ar fi cronometrat cu 86 de secunde mai puțin',
     Math.round(mana - doarPrima) === 86, String(Math.round(mana - doarPrima)));
}

console.log('\n═══ Ce NU se poate rezolva se SPUNE, nu se ghicește ═══');
{
  const r = probeDinBuletin(LEG2, BULETIN, null);
  const txt = r.note.map(n => `${n.tip}: ${n.text}`);
  const are = (tip, rx) => r.note.some(n => n.tip === tip && rx.test(n.text));
  ok('TR 3: finiș ÎNAINTE de boxul 66 — se spune că linia e între 65 și 66',
     are('aproximare', /TR 3.*ÎNAINTE de boxul 66.*între boxul 65.*47,98.*și boxul 66.*53,95/),
     JSON.stringify(txt));
  ok('…și se spune ce kilometraj folosește totuși aplicația',
     are('aproximare', /TR 3[\s\S]*cronometrează la kilometrajul boxului 66 \(53,95 km\)/), JSON.stringify(txt));
  ok('TR 4: finiș DUPĂ boxul 104 — linia e între 104 (70,99) și 105 (71,15), pe 160 m',
     are('aproximare', /TR 4.*DUPĂ boxul 104.*între boxul 104 \(70,99 km\) și boxul 105 \(71,15 km\), adică pe 160 m/),
     JSON.stringify(txt));
  ok('TR 2 nu produce nicio aproximare — finișul lui e LA boxul 64',
     !r.note.some(n => n.tip === 'aproximare' && /TR 2/.test(n.text)));
  ok('condiția de start se afișează ca informație, nu ca problemă',
     are('info', /TR 2.*77 minute după începerea TC 3/), JSON.stringify(txt));
}

console.log('\n═══ Schimbarea legată de un LOC (TR6) nu se aplică singură ═══');
{
  // Legul care conține TR5 și TR6 (paginile 36-37). Boxurile lui nu există în jurnalul
  // de la Reșița — sunt construite aici, cu kilometraj plauzibil, ca să se poată verifica
  // exact comportamentul cerut: schimbarea pe LOC nu devine kilometraj de la sine.
  const LEG3 = sanitizeBoxes([
    { day: 2, leg: 3, page: 36, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Start Leg 3 - TC 5' },
    { day: 2, leg: 3, page: 36, num: 4, sumKm: 1.20, dir: 'ÎNAINTE', comment: 'Start RT 5' },
    { day: 2, leg: 3, page: 36, num: 7, sumKm: 4.60, dir: 'ÎNAINTE', comment: 'Start RT 6' },
    { day: 2, leg: 3, page: 37, num: 12, sumKm: 7.66, dir: 'ÎNAINTE', comment: 'Exit Văliug' },
    { day: 2, leg: 3, page: 37, num: 17, sumKm: 17.60, dir: 'DREAPTA-T', comment: '' },
    { day: 2, leg: 3, page: 37, num: 20, sumKm: 19.10, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Finish Leg 3 - TC 6' }
  ]);
  const r = probeDinBuletin(LEG3, BULETIN, null);
  ok('pe Leg 3 cad TR 5 și TR 6, nu TR 2-TR 4',
     r.rts.map(x => x.name).join('|') === 'TR 5|TR 6', r.rts.map(x => x.name).join('|'));
  const tr6 = r.rts[1];
  ok('TR 6 intră în plan cu media de bază, 30 km/h', tr6.kmh === 30 && tr6.segments.length === 1,
     JSON.stringify(tr6.segments));
  ok('schimbarea la 45 km/h NU s-a aplicat singură', tr6.schimbari.length === 0);
  ok('…și e cerută explicit, cu textul din buletin',
     r.note.some(n => n.tip === 'de_mana' &&
       /TR 6.*45 km\/h.*la ieșirea din localitatea Văliug.*Pune boxul de mână/.test(n.text)),
     JSON.stringify(r.note.map(n => n.text)));
  // …iar omul o pune de mână, pe boxul 12 („Exit Văliug"), și atunci se aplică
  const cuMana = probeDinBuletin(LEG3, BULETIN, null,
    { [tr6.key]: { kmh: 30, schimbari: [{ box: 12, kmh: 45 }] } });
  const tr6b = cuMana.rts[1];
  ok('pusă de mână pe boxul 12, schimbarea produce al doilea segment',
     JSON.stringify(tr6b.segments) === JSON.stringify([{ fromKm: 0, kmh: 30 }, { fromKm: 3.06, kmh: 45 }]),
     JSON.stringify(tr6b.segments));
}

console.log('\n═══ Probă din buletin care nu se leagă de roadbook: se listează ═══');
{
  const inventat = [{ name: 'TR 7', startBox: 900, startPage: 24, kmh: 50,
                      speedChanges: [], finishBox: 901, finishPage: 25, finishRel: 'at' }];
  const r = probeDinBuletin(LEG2, inventat, null);
  ok('nu intră în plan', r.rts.length === 0 && r.legate === 0);
  ok('dar e numărată ca fiind a legului', r.inLeg === 1, String(r.inLeg));
  ok('și se spune exact ce lipsește',
     r.note.some(n => n.tip === 'nelegat' && /boxul de start 900 nu există/.test(n.text)) &&
     r.note.some(n => n.tip === 'nelegat' && /boxul de finiș 901 nu există/.test(n.text)),
     JSON.stringify(r.note.map(n => n.text)));
  // schimbare pe un box care nu există
  const r2 = probeDinBuletin(LEG2, [{ ...BULETIN[2],
    speedChanges: [{ kmh: 20.5, box: 777, page: 28, place: null }] }], null);
  ok('o schimbare pe un box inexistent nu se aplică și se cere de mână',
     r2.rts[0].segments.length === 1 &&
     r2.note.some(n => n.tip === 'de_mana' && /boxul 777, care nu există/.test(n.text)),
     JSON.stringify(r2.note.map(n => n.text)));
  // schimbare pe un box din afara probei
  const r3 = probeDinBuletin(LEG2, [{ ...BULETIN[2],
    speedChanges: [{ kmh: 20.5, box: 57, page: 24, place: null }] }], null);
  ok('o schimbare pe un box din afara probei nu se aplică și se spune',
     r3.rts[0].segments.length === 1 &&
     r3.note.some(n => n.tip === 'de_mana' && /boxul 57.*nu e între startul și finișul probei/.test(n.text)),
     JSON.stringify(r3.note.map(n => n.text)));
}

console.log('\n═══ GRANIȚA DE ÎNCREDERE: buletinul e conținut extern ═══');
{
  const otravit = [
    { name: 'TR 1', startBox: 57, startPage: 24, kmh: 900, speedChanges: [],
      finishBox: 64, finishPage: 25, finishRel: 'at' },                     // viteză absurdă
    { name: 'TR 2', startBox: -5, startPage: 24, kmh: 40, speedChanges: [],
      finishBox: 64, finishPage: 25, finishRel: 'at' },                     // box negativ
    { name: 'TR 3', startBox: 57, startPage: 24, startType: 'zbor', kmh: 40,
      speedChanges: [], finishBox: 64, finishPage: 25, finishRel: 'at' },   // start inventat
    { name: 'TR 4', startBox: 57, kmh: 40, speedChanges: [] },              // câmpuri lipsă
    { name: 'TR 5', startBox: 57, startPage: 9999, kmh: 40, speedChanges: [],
      finishBox: 64, finishPage: 25, finishRel: 'at' },                     // pagină absurdă
    'nu sunt un obiect', null, 42,                                          // gunoi curat
    { nimic: 'aici' }                                                       // rând gol
  ];
  const b = sanitizeBuletin(otravit);
  ok('rândurile care nu sunt obiecte se aruncă', b.length === 5, String(b.length));
  ok('viteza de 900 km/h devine null, nu ajunge în plan', b[0].kmh === null, String(b[0].kmh));
  ok('boxul negativ devine null', b[1].startBox === null, String(b[1].startBox));
  ok('felul de start inventat devine null', b[2].startType === null, String(b[2].startType));
  ok('câmpurile lipsă rămân null, nu se inventează',
     b[3].finishBox === null && b[3].finishRel === null && b[3].startPage === null);
  ok('pagina de 9999 devine null', b[4].startPage === null, String(b[4].startPage));
  ok('textele se taie la lungime fixă',
     sanitizeBuletin([{ name: 'X'.repeat(200), startBox: 1, finishBox: 2 }])[0].name.length === 16);
  ok('caracterele de control se scot din text',
     sanitizeBuletin([{ name: 'TR 2', startBox: 1, finishBox: 2,
       speedChanges: [{ kmh: 30, box: null, place: 'laieșire ' }] }])[0]
       .speedChanges[0].place === 'la ieșire');
  // …și niciuna din valorile otrăvite nu produce o probă în plan
  const r = probeDinBuletin(LEG2, otravit, null);
  ok('proba fără viteză intră totuși în plan, dar CU avertisment (n-o cronometrează nimeni tăcut)',
     r.rts[0].kmh === null &&
     r.note.some(n => n.tip === 'de_mana' && /n-a dat media/.test(n.text)),
     JSON.stringify(r.note.map(n => n.text)));
  ok('proba cu box de start null nu intră în plan',
     !r.rts.some(x => x.name === 'TR 2'), JSON.stringify(r.rts.map(x => x.name)));
  ok('și niciun segment din plan n-are viteză în afara intervalului 5-200',
     r.rts.every(x => x.segments.every(s => s.kmh >= 5 && s.kmh <= 200)));
}

console.log('\n═══ Buletinul BILINGV: fiecare probă o dată, nu de două ori ═══');
{
  // Promptul îi cere modelului să nu dubleze — dar româna poate fi pe o pagină și engleza
  // pe alta, iar atunci dubla apare abia la îmbinarea paginilor. Asta o prinde codul.
  const engleza = BULETIN.map(p => ({ ...p }));           // aceleași cifre, altă limbă
  const im = imbinaBuletin(BULETIN, engleza);
  ok('două pagini identice → tot cinci probe, nu zece', im.probe.length === 5, String(im.probe.length));
  ok('și niciun conflict, fiindcă cifrele coincid', im.conflicte.length === 0,
     JSON.stringify(im.conflicte));
  // …iar când cele două limbi SE CONTRAZIC, cifra devine null și se cere omului
  const gresita = BULETIN.map(p => p.name === 'TR 4' ? { ...p, kmh: 42.3 } : { ...p });
  const im2 = imbinaBuletin(BULETIN, gresita);
  const tr4 = im2.probe.find(p => p.name === 'TR 4');
  ok('româna zice 24,3 și engleza 42,3 → media devine null, nu se alege una',
     tr4.kmh === null, String(tr4.kmh));
  ok('și contradicția se raportează, nu se înghite',
     im2.conflicte.some(c => /TR 4.*kmh.*24\.3 \/ 42\.3/.test(c)), JSON.stringify(im2.conflicte));
  ok('restul câmpurilor probei rămân întregi',
     tr4.startBox === 79 && tr4.finishBox === 104 && tr4.finishRel === 'after');
  // o pagină cu o probă NOUĂ se adaugă, nu înlocuiește
  const im3 = imbinaBuletin(BULETIN.slice(0, 2), BULETIN.slice(2));
  ok('paginile diferite se adună: 2 + 3 = 5 probe', im3.probe.length === 5, String(im3.probe.length));
  // o pagină pe care modelul a citit doar jumătate din câmpuri completează golurile
  const partiala = [{ name: 'TR 2', startBox: null, startPage: null, kmh: 44.8,
                      speedChanges: [], finishBox: 64, finishPage: 25, finishRel: 'at' }];
  const im4 = imbinaBuletin(partiala, [BULETIN[0]]);
  ok('golurile dintr-o citire se completează din cealaltă',
     im4.probe[0].startBox === 57 && im4.probe[0].startPage === 24, JSON.stringify(im4.probe[0]));
}

console.log('\n═══ NE-REGRESIE: proba cu medie constantă e neschimbată ═══');
{
  // Aceleași boxuri, cu semnele puse de om (cum arată azi aplicația fără buletin).
  const cuSemne = sanitizeBoxes(LEG2.map(b => {
    const f = { 57: ['RT_START_AUTO'], 64: ['RT_FINISH', 'RT_START_AUTO'],
                66: ['RT_FINISH'], 79: ['RT_START_STANDING'], 104: ['RT_FINISH'] };
    return { ...b, flags: f[b.num] || b.flags };
  }));
  const rts = detectRts(cuSemne, { '57_3880': 44.8, '64_4769': 34.6, '79_6212': 24.3 });
  ok('trei probe, ca înainte', rts.length === 3, String(rts.length));
  ok('fiecare are EXACT un segment', rts.every(r => r.segments.length === 1),
     JSON.stringify(rts.map(r => r.segments.length)));
  ok('iar segmentul pornește de la 0 cu viteza probei',
     rts.every(r => r.segments[0].fromKm === 0 && r.segments[0].kmh === r.kmh),
     JSON.stringify(rts.map(r => r.segments)));
  // rezultatul e identic cu formula de dinainte de segmente: distanță / viteză
  for (const r of rts)
    ok(`${r.name}: timpul ideal e identic cu (km / viteză) × 3600`,
       near(idealTimeS(r.distKm, r.segments), (r.distKm / r.kmh) * 3600, 1e-9),
       `${idealTimeS(r.distKm, r.segments)} vs ${(r.distKm / r.kmh) * 3600}`);
  ok('vitezele salvate ca NUMĂR simplu merg mai departe (forma veche din depozit)',
     rts.map(r => r.kmh).join(' ') === '44.8 34.6 24.3', rts.map(r => r.kmh).join(' '));
}

console.log('\n═══ Vitezele puse de mână: număr simplu SAU cu schimbări ═══');
{
  ok('forma veche — un număr — se citește la fel',
     JSON.stringify(normVitezaSalvata(40)) === JSON.stringify({ kmh: 40, schimbari: [] }));
  ok('un șir cu virgulă tot număr e', normVitezaSalvata('24,3').kmh === 24.3);
  ok('forma nouă poartă și schimbările',
     JSON.stringify(normVitezaSalvata({ kmh: 24.3, schimbari: [{ box: 97, kmh: 20.5 }] })) ===
     JSON.stringify({ kmh: 24.3, schimbari: [{ box: 97, kmh: 20.5 }] }));
  ok('valorile absurde se aruncă și de-aici',
     normVitezaSalvata({ kmh: 900, schimbari: [{ box: -1, kmh: 20 }, { box: 5, kmh: 900 }] }).kmh === null &&
     normVitezaSalvata({ kmh: 900, schimbari: [{ box: -1, kmh: 20 }, { box: 5, kmh: 900 }] }).schimbari.length === 0);
  ok('nimic salvat → nimic',
     normVitezaSalvata(undefined).kmh === null && normVitezaSalvata('aiurea').kmh === null);

  // schimbarea pusă de mână pe o probă detectată din SEMNE (fără buletin)
  const cuSemne = sanitizeBoxes(LEG2.map(b => {
    const f = { 79: ['RT_START_STANDING'], 104: ['RT_FINISH'] };
    return { ...b, flags: f[b.num] || b.flags };
  }));
  const rts = detectRts(cuSemne, { '79_6212': { kmh: 24.3, schimbari: [{ box: 97, kmh: 20.5 }] } });
  ok('o schimbare pusă de mână produce al doilea segment și fără buletin',
     JSON.stringify(rts[0].segments) === JSON.stringify([{ fromKm: 0, kmh: 24.3 }, { fromKm: 5.74, kmh: 20.5 }]),
     JSON.stringify(rts[0].segments));
  const afara = detectRts(cuSemne, { '79_6212': { kmh: 24.3, schimbari: [{ box: 1, kmh: 20.5 }] } });
  ok('o schimbare pe un box din afara probei nu se aplică și rămâne raportată',
     afara[0].segments.length === 1 && afara[0].schimbariNepuse.length === 1,
     JSON.stringify(afara[0].schimbariNepuse));

  // faSegmente, direct
  ok('fără viteză de bază nu există niciun segment', faSegmente(null, [{ fromKm: 2, kmh: 30 }]).length === 0);
  ok('segmentele ies sortate după kilometru',
     JSON.stringify(faSegmente(30, [{ fromKm: 5, kmh: 20 }, { fromKm: 2, kmh: 25 }])) ===
     JSON.stringify([{ fromKm: 0, kmh: 30 }, { fromKm: 2, kmh: 25 }, { fromKm: 5, kmh: 20 }]));
  ok('două schimbări în același punct: rămâne ultima',
     faSegmente(30, [{ fromKm: 2, kmh: 25 }, { fromKm: 2, kmh: 22 }]).length === 2 &&
     faSegmente(30, [{ fromKm: 2, kmh: 25 }, { fromKm: 2, kmh: 22 }])[1].kmh === 22);
}

console.log('\n═══ buildPlan: cine decide probele ═══');
{
  const cuSemne = sanitizeBoxes(LEG2.map(b => {
    // exact ce a citit scanarea pe 05.08: trei starturi și un finiș, toate pe alte boxuri
    const f = { 57: ['RT_START_AUTO'], 64: ['RT_START_AUTO'],
                79: ['RT_START_STANDING'], 108: ['RT_FINISH'] };
    return { ...b, flags: f[b.num] || b.flags };
  }));
  const faraBuletin = buildPlan(cuSemne, {}, null, null, null);
  ok('fără buletin: probele vin din semne — una singură, greșită',
     faraBuletin.sursaProbe === 'roadbook' && faraBuletin.rts.length === 1 &&
     faraBuletin.rts[0].distKm === 9.39, JSON.stringify(faraBuletin.rts.map(r => r.distKm)));
  const cuBuletin = buildPlan(cuSemne, {}, null, null, BULETIN);
  ok('cu buletin: BULETINUL bate semnele — trei probe, cele din document',
     cuBuletin.sursaProbe === 'buletin' && cuBuletin.rts.length === 3 &&
     cuBuletin.rts.map(r => r.distKm).join(' ') === '8.89 6.26 8.87',
     JSON.stringify(cuBuletin.rts.map(r => r.distKm)));
  ok('cifrele buletinului ajung în plan, pentru ecran',
     cuBuletin.buletin.total === 5 && cuBuletin.buletin.inLeg === 3 && cuBuletin.buletin.legate === 3);
  // un buletin care nu e al legului ăstuia nu are voie să lase ziua fără probe
  const altLeg = buildPlan(cuSemne, {}, null, null, [BULETIN[3], BULETIN[4]]);
  ok('buletin de alt leg → se cade înapoi pe semne, și se spune de ce',
     altLeg.sursaProbe === 'roadbook' && altLeg.rts.length === 1 &&
     altLeg.buletin.total === 2 && altLeg.buletin.inLeg === 0,
     JSON.stringify({ sursa: altLeg.sursaProbe, inLeg: altLeg.buletin.inLeg }));
  // vitezele puse de mână bat buletinul: omul are hârtia în față
  const cuMana = buildPlan(cuSemne, { '79_6212': 22 }, null, null, BULETIN);
  ok('viteza pusă de mână bate media din buletin',
     cuMana.rts[2].kmh === 22 && cuMana.rts[2].segments[0].kmh === 22,
     JSON.stringify(cuMana.rts[2].segments));
}

console.log('\n═══ Rostirea vitezei: „20 și 5", nu „20.5" ═══');
{
  ok('20,5 → „20 și 5"', vitezaRo(20.5) === '20 și 5', vitezaRo(20.5));
  ok('24,3 → „24 și 3"', vitezaRo(24.3) === '24 și 3', vitezaRo(24.3));
  ok('44,8 → „44 și 8"', vitezaRo(44.8) === '44 și 8', vitezaRo(44.8));
  ok('40 → „40" (întregul rămâne întreg)', vitezaRo(40) === '40', vitezaRo(40));
  ok('34,6 → „34 și 6"', vitezaRo(34.6) === '34 și 6', vitezaRo(34.6));
}

// ── LUMEA SINTETICĂ pentru proba condusă prin mașina reală ──────────────────
function makeWorld() {
  let wallMs = new Date('2026-08-07T12:00:00').getTime();
  const clock = makeClock({ now: () => wallMs, mono: () => wallMs });
  const said = [];
  const voice = { say: (t, p, c) => said.push({ t, p, c }), tone: k => said.push({ tone: k }), flush() {} };
  return { clock, voice, store: makeMemStore(), ui: { render() {} },
           driver: makeDriverModel(), said,
           tick: ms => { wallMs += ms; }, wall: () => wallMs };
}
// urmă dreaptă peste kilometrajul oficial (1:1), ca poziția să vină din proiecție
function makeRecon(kmDeLa, kmPanaLa) {
  const pts = [];
  for (let m = 0; m <= (kmPanaLa - kmDeLa) * 1000; m += 15) pts.push({ lat: 45 + m / 111320, lng: 21 });
  const trace = buildTrace(pts);
  return { trace, samples: [],
           anchors: [{ officialKm: kmDeLa, traceM: 0 }, { officialKm: kmPanaLa, traceM: trace.totalM }] };
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
function drive(world, mach, recon, fromM, toM, kmh, stepMs = 1000) {
  let m = fromM;
  while (m < toM) {
    const ms = kmh / 3.6;
    m = Math.min(toM, m + ms * (stepMs / 1000));
    world.tick(stepMs);
    const f = posAt(recon.trace, m);
    mach.onFix({ lat: f.lat, lng: f.lng, tMs: world.wall(), speedMs: ms, headingDeg: null, accM: 8 });
  }
  return m;
}
function idle(world, mach, recon, atM, secunde) {
  for (let i = 0; i < secunde; i++) {
    world.tick(1000);
    const f = posAt(recon.trace, atM);
    mach.onFix({ lat: f.lat, lng: f.lng, tMs: world.wall(), speedMs: 0, headingDeg: null, accM: 8 });
  }
}

console.log('\n═══ TR4 condusă prin mașina reală, cu schimbarea de medie ═══');
{
  const world = makeWorld();
  const recon = makeRecon(60, 74);                 // urma acoperă doar zona lui TR4
  const plan = buildPlan(LEG2, {}, recon, null, BULETIN);
  ok('planul are cele trei probe din buletin', plan.rts.length === 3);
  const mach = makeMachine({ ...world, plan, opts: { offRoute: false } });
  mach.start();
  // preluare la kilometrul 61,5, cu TR2 și TR3 deja în urmă
  mach.resume({ routeKm: 61.5, rtIdx: 2, state: 'LIAISON', done: {} });

  const M = mach.M;
  const tM = km => (km - 60) * 1000;               // kilometru oficial → metri pe urmă
  let m = drive(world, mach, recon, tM(61.5), tM(61.8), 30);
  ok('avertizarea de la 500 m spune media ȘI schimbarea care urmează',
     world.said.some(s => s.t && /Proba în 500\. Viteza 24 și 3\. Apoi schimbare la 20 și 5\./.test(s.t)),
     JSON.stringify(world.said.filter(s => s.t).map(s => s.t).slice(-4)));

  // TR4 e „standing": se oprește la linie, se armează, apoi pleacă
  m = drive(world, mach, recon, m, tM(62.10), 20);
  idle(world, mach, recon, m, 4);
  ok('la linie, cronometrul așteaptă plecarea', M.state === 'STAGED', M.state);
  m = drive(world, mach, recon, m, tM(62.30), 24.3);
  ok('proba a pornit', M.state === 'RT_RUN' && M.rt.def.name === 'TR 4',
     `${M.state} ${M.rt && M.rt.def.name}`);
  ok('și startul se rostește cu media în registrul copilotului',
     world.said.some(s => s.t === 'Start. Ține 24 și 3.'),
     JSON.stringify(world.said.filter(s => s.t && /Start/.test(s.t)).map(s => s.t)));

  // primul segment: 24,3 km/h până la boxul 97 (67,86 km)
  m = drive(world, mach, recon, m, tM(67.50), 24.3);
  ok('înainte de boxul 97 nu s-a rostit nicio schimbare',
     !world.said.some(s => s.t && /^Acum /.test(s.t)));
  ok('devierea e ~0 pe primul segment, condus la media impusă',
     Math.abs(M.rt.lastDev) < 3, String(M.rt.lastDev));

  // trecerea peste punctul de schimbare
  m = drive(world, mach, recon, m, tM(68.10), 22);
  ok('la trecerea peste boxul 97 se rostește „Acum 20 și 5."',
     world.said.some(s => s.t === 'Acum 20 și 5.'),
     JSON.stringify(world.said.filter(s => s.t).map(s => s.t).slice(-6)));
  ok('și se rostește O SINGURĂ DATĂ',
     world.said.filter(s => s.t === 'Acum 20 și 5.').length === 1,
     String(world.said.filter(s => s.t === 'Acum 20 și 5.').length));
  ok('jurnalul ține minte unde s-a schimbat media',
     world.store.journal.some(e => e.type === 'rt_segment' && e.kmh === 20.5 && e.laKm > 5.7),
     JSON.stringify(world.store.journal.filter(e => e.type === 'rt_segment')));

  // al doilea segment, condus corect la 20,5 → devierea rămâne mică
  const devLaSchimbare = M.rt.lastDev;
  m = drive(world, mach, recon, m, tM(70.99), 20.5);
  ok('condus la noua medie, devierea NU crește',
     Math.abs(M.rt.lastDev - devLaSchimbare) < 4,
     `${devLaSchimbare.toFixed(1)} → ${M.rt.lastDev.toFixed(1)}`);
  ok('linia de finish e la boxul 104 (8,87 km de probă), nu la 97',
     M.rt.def.distKm === 8.87 && M.rt.distKm > 8.8, `${M.rt.def.distKm} / ${M.rt.distKm}`);
  m = drive(world, mach, recon, m, tM(71.10), 20.5);
  ok('proba s-a închis', M.state === 'LIAISON' && M.results['TR 4'] != null,
     `${M.state} ${JSON.stringify(M.results)}`);
  ok('punctele sunt mici — proba a fost condusă corect pe ambele segmente',
     M.results['TR 4'] <= 40, String(M.results['TR 4']));
}

console.log('\n═══ Aceeași probă condusă la media VECHE după schimbare ═══');
{
  // Contra-proba: dacă pilotul ține 24,3 și pe al doilea segment, devierea trebuie să
  // crească vizibil — asta e chiar penalizarea pe care o previne anunțul.
  const world = makeWorld();
  const recon = makeRecon(60, 74);
  const plan = buildPlan(LEG2, {}, recon, null, BULETIN);
  const mach = makeMachine({ ...world, plan, opts: { offRoute: false } });
  mach.start();
  mach.resume({ routeKm: 61.5, rtIdx: 2, state: 'LIAISON', done: {} });
  const M = mach.M, tM = km => (km - 60) * 1000;
  let m = drive(world, mach, recon, tM(61.5), tM(62.10), 24.3);
  idle(world, mach, recon, m, 4);
  m = drive(world, mach, recon, m, tM(67.86), 24.3);
  const devLaSchimbare = M.rt.lastDev;
  m = drive(world, mach, recon, m, tM(70.99), 24.3);     // prea repede pe segmentul 2
  ok('ținând media veche, pilotul ajunge în AVANS (deviere negativă)',
     M.rt.lastDev < devLaSchimbare - 60,
     `${devLaSchimbare.toFixed(1)} → ${M.rt.lastDev.toFixed(1)}`);
  ok('adică aproape cele 86 de secunde pe care le costă segmentul ignorat',
     Math.abs(M.rt.lastDev) > 80, String(M.rt.lastDev.toFixed(1)));
}

console.log('\n═══ Promptul buletinului și cablajul din ecran ═══');
{
  const scan = readFileSync(join(aici, '..', 'js', 'scan.js'), 'utf8');
  const html = readFileSync(join(aici, '..', 'index.html'), 'utf8');
  const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
  ok('promptul roadbook-ului NU s-a atins', /const ROADBOOK_PROMPT = /.test(scan) &&
     /CAUTĂ EXPLICIT LINIILE DE FINISH/.test(scan));
  ok('există un prompt separat pentru buletin', /const BULLETIN_PROMPT = /.test(scan));
  ok('care spune că documentul e bilingv și cere fiecare probă o singură dată',
     /BILINGV/.test(scan) && /O SINGURĂ DATĂ/.test(scan));
  ok('și cere „null" acolo unde româna și engleza se contrazic',
     /SE CONTRAZIC LA O CIFRĂ, pune "null"/.test(scan));
  ok('cere calificativul finișului, cu toate trei variantele',
     /"at"[\s\S]{0,200}"before"[\s\S]{0,200}"after"/.test(scan) &&
     /Calificativul CONTEAZĂ/.test(scan));
  ok('și schimbarea legată de un LOC, cu box null',
     /"box":null[\s\S]{0,80}"place"/.test(scan));
  ok('scanarea buletinului trece prin aceeași reparare de JSON trunchiat',
     /export async function scanBulletin/.test(scan) &&
     /parseBoxesJson\(r\.text\)/.test(scan.split('scanBulletin')[1]));
  ok('și prin sită, înainte de orice altceva',
     /const probe = sanitizeBuletin\(parsed\)/.test(scan));
  ok('butonul „Buletinul probelor" e pe ecran', /📋 Buletinul probelor/.test(html));
  ok('cu colectorul de poze refolosit', /faColectorPoze\(\{ max: 8 \}\)/.test(main));
  ok('cifrele buletinului se afișează, nu se deduc',
     /id="prep-buletin-cifre"/.test(html) && /boxuri găsite în roadbook/.test(main));
  ok('ecranul spune pe față cine decide probele',
     /bate semnele de start\/finiș citite în roadbook/.test(main));
  ok('notele se randează cu textContent — citează un document extern',
     /p\.textContent = \(n\.tip === 'info'/.test(main));
  ok('editorul manual poate adăuga o schimbare de medie, pe box',
     /schimbare de medie: de la boxul/.test(main) && /function puneSchimbare/.test(main));
  ok('iar salvarea vitezei nu mai șterge schimbările deja puse',
     /async function salveazaViteza/.test(main) &&
     !/speeds\[rt\.key\] = v/.test(main) && !/speeds\[cheieViteza\(b\)\] = v/.test(main));
  ok('ștergerea roadbook-ului ia și buletinul (definit pe boxurile LUI)',
     /store\.del\('buletin'\)/.test(main));
  // cockpitul: ținta afișată trebuie să fie a segmentului curent, nu media de bază
  const ui = readFileSync(join(aici, '..', 'js', 'ui.js'), 'utf8');
  ok('cockpitul arată viteza SEGMENTULUI curent, nu media de bază',
     /speedAt\(Math\.min\(M\.rt\.distKm, M\.rt\.def\.distKm\), segsUi\)/.test(ui) &&
     !/\$\('cp-target'\)\.textContent = `\$\{Math\.round\(M\.speedKmh\)\} \/ \$\{M\.rt\.def\.kmh\}`/.test(ui));
  // exportul zilei: al doilea telefon trebuie să preia ACELEAȘI probe
  const store = readFileSync(join(aici, '..', 'js', 'store.js'), 'utf8');
  ok('buletinul intră în exportul zilei', /store\.get\('buletin'\)/.test(store) &&
     /buletin: buletin \|\| null/.test(store));
  ok('și la import trece prin sită, ca orice fișier străin',
     /const b = sanitizeBuletin\(dump\.buletin\)/.test(store));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
