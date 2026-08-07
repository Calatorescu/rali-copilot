// RALI 2 — CÂT DE DES SE VORBEȘTE DESPRE RITM, ÎN PROBĂ (v43).
//
// Cererea lui Andreas, 07.08.2026: „mă bombardează cu cifre". Măsurat în jurnalul City
// Demo Sibiu (06.08.2026), la 11:21:03 → 11:21:21:
//     „4 în avans, ține 45"          (11:21:03,095)
//     „6 virgulă 1 în urmă, ține 49" (11:21:12,854)
//     „7 virgulă 6 în urmă, ține 49" (11:21:16,932)
//     „8 virgulă 2 în urmă, ține 50" (11:21:21,073)
// Patru rostiri în 18 secunde, la un pilot care conduce singur, într-o secvență în care
// între timp au mai plecat și „500 de metri — giratoriu, ieșirea 1" și „300 de metri —
// giratoriu, ieșirea 1". Cifra se schimba cu 1,5-2 secunde de fiecare dată — adică
// spunea, în fond, același lucru.
//
// Ce se verifică aici:
//  1. poarta pură (`ritmPoateVorbi`) rulată pe MOMENTELE REALE din jurnal;
//  2. intervalul minim dublat (4 → 8 s) și tăcerea pe stagnare (sub 1,5 s diferență);
//  3. ce NU se atinge: „Start. Ține X", schimbarea de medie (v38), tonurile, banca.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine, ritmPoateVorbi } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// ── SECVENȚA REALĂ ─────────────────────────────────────────────────────────
// Momentele sunt cele ale DECIZIEI (evenimentele `ritm_vorba` din jurnal), nu ale
// rostirii: între decizie și difuzor mai stă coada de voce, cu până la 3 secunde. Poarta
// se aplică la decizie, deci pe astea se rulează. `ms` = milisecunde de la 11:20:00,
// `a` = |devierea| rostită în fraza respectivă.
// Sursa: C:\Users\CLTCLD\rali-jurnale\jurnale\2026-08-06.json, evenimentele dintre
// 11:20:55 și 11:21:21 (jurnalul zilei City Demo Sibiu).
const REAL = [
  { ms: 55854, a: 3.4, txt: '3 virgulă 4 în avans, ține 45' },   // aruncată ca „expirat"
  { ms: 59936, a: 4.0, txt: '4 în avans, ține 45' },
  { ms: 72854, a: 6.1, txt: '6 virgulă 1 în urmă, ține 49' },
  { ms: 76933, a: 7.6, txt: '7 virgulă 6 în urmă, ține 49' },
  { ms: 80935, a: 8.2, txt: '8 virgulă 2 în urmă, ține 50' }
];

// rulează poarta peste o listă de decizii și întoarce cele care AR FI fost rostite
function reia(decizii) {
  let ultimaMs = null, ultimaA = null;
  const spuse = [];
  for (const d of decizii) {
    if (!ritmPoateVorbi(d.ms, d.a, ultimaMs, ultimaA)) continue;
    ultimaMs = d.ms; ultimaA = d.a;
    spuse.push(d);
  }
  return spuse;
}

console.log('\n═══ Secvența reală din 06.08: patru cifre în 18 secunde ═══');
{
  // fereastra pe care s-a plâns Andreas: cele PATRU rostiri auzite, 11:21:03 → 11:21:21.
  // Ultima cifră auzită înaintea lor a fost la 11:21:03 (decizia de la 59936 ms); decizia
  // de la 55854 a fost aruncată din coadă ca „expirat", deci n-a ajuns la ureche — dar
  // poarta lucrează pe decizii, deci intră și ea în reluare.
  const spuse = reia(REAL);
  ok('înainte: 5 decizii de ritm în 25 de secunde, toate lăsate să vorbească',
     REAL.length === 5, `${REAL.length}`);
  ok('după: rămân 3 din 5 pe toată secvența',
     spuse.length === 3, JSON.stringify(spuse.map(s => s.txt)));
  // cifra cerută în raport: cele 4 rostiri din cele 18 secunde ale reclamației
  const inFereastra = spuse.filter(s => s.ms >= 59936 && s.ms <= 80935);
  ok('iar în fereastra de 18 secunde reclamată, cele 4 rostiri devin 2',
     inFereastra.length === 2, JSON.stringify(inFereastra.map(s => s.txt)));
  ok('și rămân exact cele care aduc informație nouă („6,1 în urmă" și „8,2 în urmă")',
     inFereastra[0].a === 6.1 && inFereastra[1].a === 8.2,
     JSON.stringify(inFereastra.map(s => s.a)));
  const pauze = spuse.slice(1).map((s, i) => s.ms - spuse[i].ms);
  ok('nicio pereche rămasă nu e mai apropiată de 8 secunde',
     pauze.every(p => p >= 8000), JSON.stringify(pauze));
}

console.log('\n═══ Intervalul minim: 4 → 8 secunde ═══');
{
  ok('prima cifră a probei se rostește imediat (n-are după ce să aștepte)',
     ritmPoateVorbi(1000, 5, null, null) === true);
  ok('la 4 secunde după ea NU se mai vorbește, oricât s-ar fi schimbat cifra',
     ritmPoateVorbi(5000, 12, 1000, 5) === false);
  ok('la 7,9 secunde, tot nu', ritmPoateVorbi(8900, 12, 1000, 5) === false);
  ok('la 8 secunde fix, da', ritmPoateVorbi(9000, 12, 1000, 5) === true);
}

console.log('\n═══ Tăcerea pe stagnare: sub 1,5 secunde diferență, nimic ═══');
{
  ok('trecerea de la 4,0 la 5,0 nu merită o frază, nici după 20 de secunde',
     ritmPoateVorbi(21000, 5.0, 1000, 4.0) === false);
  ok('nici 1,4 secunde diferență', ritmPoateVorbi(21000, 5.4, 1000, 4.0) === false);
  ok('1,5 secunde da', ritmPoateVorbi(21000, 5.5, 1000, 4.0) === true);
  ok('și în sens invers — recuperarea se aude la fel de bine',
     ritmPoateVorbi(21000, 2.5, 1000, 4.0) === true);
  ok('un salt mare trece imediat ce a expirat intervalul (nu se ascunde nimic)',
     ritmPoateVorbi(9000, 30, 1000, 4.0) === true);
  ok('dar nici saltul mare nu are voie să vorbească înainte de 8 secunde',
     ritmPoateVorbi(5000, 30, 1000, 4.0) === false);
}

// ── PROBA CONDUSĂ PRIN MAȘINA REALĂ ────────────────────────────────────────
// Roadbook minimal: TC, start de probă, finish. Mașina merge mai încet decât media
// impusă, deci devierea crește constant — exact cazul în care versiunea veche vorbea
// la fiecare patru secunde.
const PROBA = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START' },
  { num: 2, sumKm: 0.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT · 40 km/h' },
  { num: 3, sumKm: 4.20, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH' }
]);

function lume(boxes = PROBA, { segmente = null } = {}) {
  let wall = 0, lat = 45.7823, lng = 14.1461;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [], tonuri = [];
  const plan = buildPlan(boxes, { '2_200': 40 }, null, null);
  if (segmente && plan.rts[0]) plan.rts[0].segments = segmente;
  const m = makeMachine({ plan, clock, store,
    driver: makeDriverModel(), opts: { offRoute: false },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls, la: wall }),
             tone: k => tonuri.push({ k, la: wall }), flush() {},
             durataMs: t => 350 + String(t).length * 90 },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 90, accM: 6 });
  const pas = metri => {
    lng += metri / (111320 * Math.cos(45.7823 * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: 90, accM: 6 });
  };
  return { m, said, store, tonuri, pas,
    condu(km, kmh) { const v = kmh / 3.6, n = Math.round(km * 1000 / v); for (let i = 0; i < n; i++) pas(v); },
    ritm() { return said.filter(s => /în urmă|în avans/.test(s.t) && s.cat === 'pace'); },
    vorbit(re) { return said.filter(s => re.test(s.t)); } };
}

console.log('\n═══ Proba condusă lent: cifrele se răresc, dar nu dispar ═══');
{
  const w = lume();
  w.condu(0.25, 40);
  ok('proba a pornit', w.m.M.state === 'RT_RUN', w.m.M.state);
  w.condu(2.2, 22);                     // mult sub media impusă → devierea crește constant
  const r = w.ritm();
  ok('se vorbește despre ritm (altfel testul n-ar demonstra nimic)', r.length >= 2, `${r.length}`);
  const pauze = r.slice(1).map((s, i) => s.la - r[i].la);
  ok('nicio pereche de cifre la mai puțin de 8 secunde',
     pauze.every(p => p >= 8000), JSON.stringify(pauze));
  const cifre = r.map(s => parseFloat(s.t.replace(' virgulă ', '.')));
  const salturi = cifre.slice(1).map((v, i) => Math.abs(v - cifre[i]));
  ok('și fiecare cifră nouă e cu cel puțin 1,5 s diferită de cea dinainte',
     salturi.every(s => s >= 1.5 - 1e-9), JSON.stringify(salturi));
  // CÂT S-A RĂRIT, măsurat în aceeași rulare: fiecare cifră înghițită de poartă e numărată
  // în `tacute`, iar rostite + înghițite = exact câte ar fi rostit v42 pe același drum.
  const vorbe = w.store.journal.filter(e => e.type === 'ritm_vorba');
  const inghitite = w.m.M.rt._ritmTacuteTotal || 0;
  ok('jurnalul spune câte au fost înghițite între două rostiri',
     vorbe.some(e => e.tacute > 0), JSON.stringify(vorbe.map(e => e.tacute)));
  ok('pe același drum, v42 ar fi rostit cel puțin dublu — asta e „înjumătățirea" cerută',
     vorbe.length * 2 <= vorbe.length + inghitite,
     `${vorbe.length} acum vs ${vorbe.length + inghitite} înainte`);
  // TONURILE rămân la 4 secunde: ele sunt canalul continuu, și nu ocupă difuzorul
  const t = w.tonuri;
  const pauzeT = t.slice(1).map((x, i) => x.la - t[i].la);
  ok('tonurile de stare NU s-au rărit — rămân la ~4 secunde',
     pauzeT.length > 20 && pauzeT.every(p => p <= 5000),
     `${t.length} tonuri, pauze ${JSON.stringify(pauzeT.slice(0, 6))}`);
}

console.log('\n═══ Ce rămâne neatins: startul, media, finishul ═══');
{
  const w = lume(PROBA, { segmente: [{ fromKm: 0, kmh: 40 }, { fromKm: 1.0, kmh: 20 }] });
  w.condu(0.25, 40);
  ok('„Start. Ține 40." se rostește întreg, o singură dată',
     w.vorbit(/^Start\. Ține 40\.$/).length === 1,
     JSON.stringify(w.said.map(s => s.t)));
  w.condu(0.9, 22);                     // devierea crește → se vorbește despre ritm
  const inainte = w.ritm().length;
  ok('s-a vorbit despre ritm înainte de schimbarea de medie', inainte >= 1, `${inainte}`);
  w.condu(0.4, 22);                     // trecerea peste kilometrul 1,0
  const schimb = w.vorbit(/^Acum 20\.$/);
  ok('schimbarea de medie (v38) se rostește oricum — nu trece prin poarta de ritm',
     schimb.length === 1, JSON.stringify(w.said.slice(-6).map(s => s.t)));
  const ultimaCifra = w.ritm()[w.ritm().length - 1];
  ok('…chiar dacă o cifră de ritm a plecat cu mai puțin de 8 secunde înainte',
     !!ultimaCifra && schimb[0].la - ultimaCifra.la < 8000,
     `${schimb[0].la - (ultimaCifra || {}).la} ms după ultima cifră`);
  ok('și rămâne prioritate 4, clasă neutră — nu e „ritm"',
     schimb[0].p === 4 && schimb[0].cls == null, JSON.stringify(schimb[0]));
  w.condu(2.8, 22);
  ok('„Finish. …" se rostește întreg, cu cifra înghețată',
     w.vorbit(/^Finish\. .* Nu opri lângă tabelă\.$/).length === 1,
     JSON.stringify(w.said.slice(-5).map(s => s.t)));
  ok('și „Gata. …" la închiderea probei',
     w.vorbit(/^Gata\. /).length === 1, JSON.stringify(w.said.slice(-3).map(s => s.t)));
}

console.log('\n═══ Fiecare probă pornește cu poarta curată ═══');
{
  // Starea porții stă pe PROBĂ (obiectul `rt`), nu pe zi: altfel a doua probă ar tăcea
  // fiindcă „devierea de acum seamănă cu ultima cifră rostită în proba dinainte".
  const DOUA = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START' },
    { num: 2, sumKm: 0.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'RT 1 · 40 km/h' },
    { num: 3, sumKm: 1.60, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH 1' },
    { num: 4, sumKm: 2.00, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'RT 2 · 40 km/h' },
    { num: 5, sumKm: 3.40, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH 2' }
  ]);
  let wall = 0, lat = 45.7823, lng = 14.1461;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(DOUA, { '2_200': 40, '4_2000': 40 }, null, null),
    clock, store, driver: makeDriverModel(), opts: { offRoute: false },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls, la: wall }), tone() {}, flush() {},
             durataMs: t => 350 + String(t).length * 90 },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 90, accM: 6 });
  const condu = (km, kmh) => {
    const v = kmh / 3.6, n = Math.round(km * 1000 / v);
    for (let i = 0; i < n; i++) {
      lng += v / (111320 * Math.cos(45.7823 * Math.PI / 180));
      wall += 1000;
      m.onFix({ lat, lng, tMs: wall, speedMs: v, headingDeg: 90, accM: 6 });
    }
  };
  condu(2.0, 22);                       // prima probă, condusă lent
  const dupa1 = said.filter(s => s.cat === 'pace').length;
  condu(1.6, 22);                       // a doua probă, la fel
  const dupa2 = said.filter(s => s.cat === 'pace').length - dupa1;
  ok('prima probă vorbește despre ritm', dupa1 >= 1, `${dupa1}`);
  ok('și a doua la fel — poarta nu a rămas încuiată de la prima', dupa2 >= 1, `${dupa2}`);
  ok('amândouă probele au pornit cu „Start. Ține 40."',
     said.filter(s => /^Start\. Ține 40\.$/.test(s.t)).length === 2,
     JSON.stringify(said.filter(s => /Start/.test(s.t)).map(s => s.t)));
}

// ── PLAFONUL DE TĂCERE SE STRÂNGE SPRE FINISH (07.08, dimineața cursei) ──────
// Cerința lui Andreas, textual: plasa de 45 s e ok, „dar când este mai puțin de
// 3 minute până la finish, redu la 30 de secunde; mai puțin de 1 minut → 15".
// Măsurăm intervalul dintre două rostiri cu devierea COMPLET înghețată — adică
// exact cazul în care vorbește doar plasa de siguranță.
{
  const intervalS = (ramasS) => {
    let u = null, ua = null, rostiri = [];
    for (let t = 0; t <= 300000; t += 4000)
      if (ritmPoateVorbi(t, 3.0, u, ua, ramasS)) { rostiri.push(t); u = t; ua = 3.0; }
    return rostiri.length > 1 ? (rostiri[1] - rostiri[0]) / 1000 : null;
  };
  const c = intervalS(600), m3 = intervalS(150), m1 = intervalS(45);
  ok('croazieră: plasa vorbește la ~45-48 s', c >= 45 && c <= 48, `${c}`);
  ok('sub 3 min de finish: la ~30-32 s', m3 >= 30 && m3 <= 32, `${m3}`);
  ok('sub 1 min de finish: la ~15-16 s', m1 >= 15 && m1 <= 16, `${m1}`);
  ok('fără ramasS (apel vechi), plafonul rămâne cel de croazieră',
     intervalS(undefined) >= 45, `${intervalS(undefined)}`);
  ok('noutatea trece imediat după intervalul minim, oriunde în probă',
     ritmPoateVorbi(8000, 5.0, 0, 3.0, 600) === true, 'salt 2 s la 8 s');
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
