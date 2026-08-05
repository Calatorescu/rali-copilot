// RALI 2 — GHIDAREA CONTINUĂ: ce se aude între manevre.
//
// Andreas, 05.08.2026: se orientează greu în spațiu. Pentru el, tăcerea aplicației pe
// un tronson de 3 km nu se citește ca „merge bine", ci ca „am ratat ceva și nu știu ce".
// Până la v34 aplicația spunea, pe un tronson lung, exact două lucruri: „300 de metri —
// dreapta" și „dreapta acum". Restul drumului — nimic.
//
// Aici se verifică ce s-a adăugat (treapta de 500 m, confirmarea periodică) ȘI, mai
// important, ce NU are voie să facă: să vorbească peste o manevră, în probă, sau pe
// dinafară. Un ghidaj care liniștește costă un viraj dacă e prost pus.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { makeVoice } from '../js/voice.js';
import { buildTrace } from '../js/geo.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// TRONSON LUNG: 3 km între boxul de start și prima manevră. Exact cazul de la Sibiu —
// etapa 1 are 173 km cu manevre rare între localități.
const LUNG = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START · TC' },
  { num: 2, sumKm: 3.00, dir: 'DREAPTA', comment: 'dreapta după localitate' },
  { num: 3, sumKm: 6.00, dir: 'STÂNGA', comment: 'stânga' },
  { num: 4, sumKm: 9.00, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'start probă · 40 km/h' },
  { num: 5, sumKm: 11.00, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'finish' }
]);

// Lume cu busolă, ca în restul suitei: fiecare pas mută mașina cu `metri` pe capul dat.
// Longitudine deplasată cu −10, latitudine plauzibilă, zero adrese reale.
function lume(boxes = LUNG, { recon = null, viteze = { '4_900': 40 } } = {}) {
  let wall = 0, lat = 45.7823, lng = 14.1461;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(boxes, viteze, recon, null), clock, store,
    driver: makeDriverModel(), opts: { offRoute: false },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
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
    // condus la ~54 km/h (15 m/s), un fix pe secundă — ritmul real al telefonului
    drum(km, viteza = 15) { const n = Math.round(km * 1000 / viteza); for (let i = 0; i < n; i++) pas(viteza); },
    vorbit(re) { return said.filter(s => re.test(s.t)); },
    ghidaje() { return said.filter(s => s.cat === 'ghidaj'); } };
}

console.log('\n═══ Treptele: 500 / 300 / 150 / acum, pe un tronson lung ═══');
{
  const w = lume();
  w.drum(2.90);
  while (w.m.M.routeKm < 2.99) w.pas(8);        // ultimii metri, ca să intre și „acum"
  const cifre = w.vorbit(/de metri — dreapta/).map(s => s.t);
  ok('boxul 2 primește TREI anunțuri cu cifră, nu unul',
     cifre.length === 3, JSON.stringify(cifre));
  ok('și pornesc de la ~500 m — prima veste vine cu 30 de secunde înainte, la 60 km/h',
     /^(4[5-9]\d|500) de metri/.test(cifre[0] || ''), JSON.stringify(cifre));
  ok('apoi ~300 m', /^(2[5-9]\d|3[0-4]\d) de metri/.test(cifre[1] || ''), JSON.stringify(cifre));
  ok('apoi ~150 m', /^(1[0-9]\d|1[0-4]\d) de metri/.test(cifre[2] || ''), JSON.stringify(cifre));
  ok('și distanțele scad, nu sar aiurea',
     cifre.map(t => parseInt(t, 10)).every((v, i, a) => i === 0 || v < a[i - 1]), JSON.stringify(cifre));
  ok('„dreapta acum" vine la final', w.vorbit(/^dreapta acum/).length === 1,
     JSON.stringify(w.vorbit(/dreapta/).map(s => s.t)));
  ok('toate anunțurile de manevră au clasa „manevra" — ele bat ritmul în difuzor',
     w.said.filter(s => s.cat === 'turn').every(s => s.cls === 'manevra'),
     JSON.stringify(w.said.filter(s => s.cat === 'turn' && s.cls !== 'manevra').map(s => s.t)));
}

console.log('\n═══ Boxuri apropiate: treptele care nu încap se sar singure ═══');
{
  // 290 m între boxuri (cazul real 15→16 din tura Tresor): treapta de 500 ar fi plecat
  // în aceeași secundă cu „acum"-ul boxului dinainte — două fraze una peste alta, în viraj
  const APROAPE = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START' },
    { num: 2, sumKm: 1.50, dir: 'DREAPTA', comment: 'dreapta' },
    { num: 3, sumKm: 1.79, dir: 'STÂNGA', comment: 'stânga la 290 m' },
    { num: 4, sumKm: 1.88, dir: 'DREAPTA', comment: 'dreapta la 90 m' },
    { num: 5, sumKm: 5.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'TC final' }
  ]);
  const w = lume(APROAPE, { viteze: {} });
  w.drum(1.95);
  // Boxurile 2-3-4 sunt trei manevre în 380 m, deci de la v37 intră pe drumul LANȚULUI:
  // un preambul înaintea primei, apoi câte un ecou de un cuvânt la fiecare. Ce se
  // verifică aici rămâne același lucru — nicio treaptă cu cifră nu pleacă acolo unde
  // n-are unde încăpea — doar că acum e servit prin lanț.
  const cuCifra = w.said.filter(s => s.cls === 'manevra' && /^\d+ de metri/.test(s.t));
  ok('boxul 2 (cu 1,5 km de drum liber înainte) primește trepte cu cifră',
     cuCifra.length >= 1 && cuCifra.every(s => /dreapta$/.test(s.t)), JSON.stringify(cuCifra.map(s => s.t)));
  ok('dar boxurile 3 și 4, la 290 și 90 m, NU primesc nicio treaptă cu cifră',
     !cuCifra.some(s => /stânga/.test(s.t)), JSON.stringify(cuCifra.map(s => s.t)));
  const preambul = w.said.filter(s => /^Trei la rând/.test(s.t));
  ok('în schimb, pilotul le află pe toate trei dintr-o singură frază, dinainte',
     preambul.length === 1, JSON.stringify(w.said.map(s => s.t)));
  const ecouri = w.said.filter(s => /^(dreapta|stânga)$/.test(s.t));
  ok('și fiecare își primește ecoul scurt la momentul ei',
     ecouri.length === 3 && ecouri.map(s => s.t).join(' ') === 'dreapta stânga dreapta',
     JSON.stringify(ecouri.map(s => s.t)));
  // „dreapta" apare de două ori — dar sunt DOUĂ boxuri diferite, nu o repetare
  const perBox = w.store.journal.filter(e => e.type === 'cue')
    .reduce((h, e) => { h[e.boxNum] = (h[e.boxNum] || 0) + 1; return h; }, {});
  ok('niciun box nu e anunțat de două ori',
     Object.values(perBox).every(n => n === 1), JSON.stringify(perBox));
}

console.log('\n═══ Confirmarea periodică: „ești pe traseu", pe tronsonul lung ═══');
{
  const w = lume();
  w.drum(2.4);                                  // 2,4 km la 54 km/h ≈ 160 s
  const g = w.ghidaje();
  ok('pe 2,4 km se aud confirmări, nu tăcere', g.length >= 2, JSON.stringify(g.map(s => s.t)));
  ok('și nu mai des de ~45 s / 1 km — nu devine ea însăși zgomot',
     g.length <= 4, `${g.length} confirmări pe 2,4 km`);
  ok('spun cât mai e și până la ce box',
     g.every(s => /Drept încă .* până la boxul 2\./.test(s.t)), JSON.stringify(g.map(s => s.t)));
  ok('au clasa „ritm" — prin regulile de coadă, ritmul nu poate tăia o manevră',
     g.every(s => s.cls === 'ritm'), JSON.stringify(g.map(s => s.cls)));
  ok('și prioritate mică: sunt o liniștire, nu o instrucțiune',
     g.every(s => s.p <= 2), JSON.stringify(g.map(s => s.p)));
  // ONESTITATEA CIFREI: fără geometrie de recunoaștere, aplicația știe doar cât a rulat
  // odometrul. „Ești pe traseu" ar fi o afirmație pe care nu o poate susține.
  ok('fără recunoaștere NU se spune „ești pe traseu" — nu se poate măsura',
     g.every(s => !/Ești pe traseu/.test(s.t)), JSON.stringify(g.map(s => s.t)));
}

console.log('\n═══ Cu recunoaștere, „ești pe traseu" e o măsurătoare, deci se spune ═══');
{
  // Aceeași frază, cu o afirmație în plus — dar numai fiindcă acum EXISTĂ cu ce fi
  // verificată: proiecția pe urma condusă spune direct dacă mașina e pe drumul ăla.
  const brut = [];
  let p = { lat: 45.7823, lng: 14.1461 };
  for (let i = 0; i < 600; i++) {
    brut.push({ ...p });
    p = { lat: p.lat, lng: p.lng + 20 / (111320 * Math.cos(45.7823 * Math.PI / 180)) };
  }
  const trace = buildTrace(brut);
  const recon = { trace, samples: [],
                  anchors: [{ officialKm: 0, traceM: 0 },
                            { officialKm: 11.0, traceM: trace.totalM }] };
  const w = lume(LUNG, { recon });
  w.drum(2.0);
  const g = w.ghidaje();
  ok('confirmările există și aici', g.length >= 1, JSON.stringify(g.map(s => s.t)));
  ok('și de data asta chiar spun „Ești pe traseu"',
     g.every(s => /^Ești pe traseu\. Drept încă/.test(s.t)), JSON.stringify(g.map(s => s.t)));
  ok('jurnalul reține că afirmația a fost măsurată, nu presupusă',
     w.store.journal.filter(e => e.type === 'ghidaj').every(e => e.masurat === true),
     JSON.stringify(w.store.journal.filter(e => e.type === 'ghidaj').map(e => e.masurat)));
}

console.log('\n═══ Aproape de manevră, confirmarea tace ═══');
{
  const w = lume();
  w.drum(2.4);
  const inainte = w.ghidaje().length;
  w.drum(0.55);                                 // intră în ultimii 550 m dinaintea boxului 2
  const dupa = w.ghidaje();
  ok('sub 550 m de box nu mai vine nicio confirmare — de acolo vorbesc treptele',
     dupa.length === inainte,
     JSON.stringify(dupa.slice(inainte).map(s => s.t)));
  ok('iar toate confirmările au fost date de la peste 550 m de box (măsurat în jurnal)',
     w.store.journal.filter(e => e.type === 'ghidaj').every(e => e.dM >= 550),
     JSON.stringify(w.store.journal.filter(e => e.type === 'ghidaj').map(e => e.dM)));
}

console.log('\n═══ În probă, ghidajul tace: vocea e a probei ═══');
{
  const w = lume();
  w.drum(9.2);                                  // trece de startul probei (9,00 km)
  ok('proba a pornit', w.m.M.state === 'RT_RUN', w.m.M.state);
  const inainte = w.ghidaje().length;
  w.drum(1.0);
  ok('nicio confirmare cât ține proba', w.ghidaje().length === inainte,
     JSON.stringify(w.ghidaje().slice(inainte).map(s => s.t)));
}

console.log('\n═══ Pe dinafară, „ești pe traseu" ar fi o minciună — deci tace ═══');
{
  const w = lume();
  w.drum(1.2);
  w.m.offRouteManual();
  const inainte = w.ghidaje().length;
  w.drum(1.5);
  ok('nicio confirmare cât ești pe dinafară', w.ghidaje().length === inainte,
     JSON.stringify(w.ghidaje().slice(inainte).map(s => s.t)));
}

console.log('\n═══ Oprit la TC, confirmarea nu se aude ═══');
{
  const w = lume();
  w.drum(1.2);
  const inainte = w.ghidaje().length;
  for (let i = 0; i < 120; i++) w.pas(0);       // două minute pe loc
  ok('cu mașina oprită nu se anunță nimic — nu ai unde să greșești stând',
     w.ghidaje().length === inainte, JSON.stringify(w.ghidaje().slice(inainte).map(s => s.t)));
}

console.log('\n═══ Coada de voce (v31/v32): ritmul NU taie manevra ═══');
{
  // Cazul măsurat în tura Tresor: 5 fraze de manevră aruncate cu motivul „intrerupt".
  // Ghidajul continuu e vorbă în plus pe difuzor — deci trebuie dovedit că nu poate
  // deveni încă o cauză de manevră tăiată la mijloc de cuvânt.
  let t = 0;
  const rostite = [], aruncate = [];
  const tts = { speak(txt) { rostite.push(txt); }, cancel() {}, busy() { return true; },
                keepAlive() {} };
  const v = makeVoice({ tts, now: () => t, onDrop: (txt, de) => aruncate.push({ txt, de }) });
  v.say('150 de metri — dreapta', 2, 'turn', 'manevra');
  t += 300;
  v.say('Ești pe traseu. Drept încă un kilometru până la boxul 5.', 2, 'ghidaj', 'ritm');
  ok('manevra e cea care vorbește', rostite[0] === '150 de metri — dreapta', JSON.stringify(rostite));
  ok('și confirmarea NU o întrerupe',
     !aruncate.some(a => a.de === 'intrerupt'), JSON.stringify(aruncate));
  // …dar invers, manevra are voie să taie o confirmare: la volan, virajul bate liniștirea
  let t2 = 0;
  const rostite2 = [], aruncate2 = [];
  const v2 = makeVoice({ tts: { speak(txt) { rostite2.push(txt); }, cancel() {},
                               busy() { return true; }, keepAlive() {} },
                         now: () => t2, onDrop: (txt, de) => aruncate2.push({ txt, de }) });
  v2.say('Ești pe traseu. Drept încă un kilometru până la boxul 5.', 2, 'ghidaj', 'ritm');
  t2 += 300;
  v2.say('dreapta acum', 4, 'turn', 'manevra');
  ok('manevra taie confirmarea, nu invers',
     aruncate2.some(a => a.de === 'intrerupt' && /Ești pe traseu/.test(a.txt)) &&
     rostite2[rostite2.length - 1] === 'dreapta acum',
     JSON.stringify({ rostite2, aruncate2 }));
  v.dispose(); v2.dispose();
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
