// RALI 2 — anunțul de corecție nu are voie să calce peste manevra următoare.
//
// 04.08.2026, bucla József, Leg 2: snapul pe boxul 4 a mutat poziția cu −116 m și a
// rostit „Corectat înapoi 116 metri, box 4" — vreo 3 secunde de vorbă într-o buclă în
// care boxurile 2-3-4 sunt la 70-91 m unul de altul (6-8 secunde de mers). Corecția e o
// EXPLICAȚIE pentru ce s-a văzut deja pe ecran; manevra e o decizie de peste câteva
// secunde. Roadbook-ul și vitezele de mai jos sunt cele reale, din jurnalul zilei.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { makeVoice } from '../js/voice.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// roadbook-ul REAL al turei din 04.08 (Leg 1 = Leg 2, identice)
const BUCLA = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START / TC' },
  { num: 2, sumKm: 0.32, dir: 'DREAPTA', comment: 'Dreapta spre Str. József Attila' },
  { num: 3, sumKm: 0.41, dir: 'STÂNGA', comment: 'capătul buclei (91 m)' },
  { num: 4, sumKm: 0.48, dir: 'STÂNGA-T', comment: 'Stânga la T (70 m)' },
  { num: 5, sumKm: 0.84, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 35 km/h' },
  { num: 7, sumKm: 2.74, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' }
]);

// Lume cu busolă: fiecare pas mută mașina cu `metri` pe capul compas dat. Decalajul față
// de roadbook se face conducând mai mult decât scrie oficial — exact zgomotul măsurat azi
// (±40-70 m pe segment), fiindcă km-ii „oficiali" ai roadbook-ului de test vin din GPS.
function lume() {
  let wall = 0, lat = 45, lng = 11;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(BUCLA, {}, null), clock, store,
    driver: makeDriverModel(),
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 0, accM: 6 });
  const pas = (metri, hdg) => {
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(45 * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: hdg, accM: 6 });
  };
  const drept = (n, metri, hdg) => { for (let i = 0; i < n; i++) pas(metri, hdg); };
  return { m, store, said, pas, drept,
    corectii() { return store.journal.filter(e => e.type === 'corectie_anunt'); },
    vorbit(re) { return said.filter(s => re.test(s.t)); } };
}

// virajul, ca în teren: colț de ~55 m cu direcția în schimbare, apoi drum stabil până
// se hotărăște detectorul (lag măsurat în jurnal: 21-45 m)
function viraj(w, dela, spre, metriColt = 8) {
  const pasi = 7, d = ((spre - dela + 540) % 360 - 180) / pasi;
  for (let i = 1; i <= pasi; i++) w.pas(metriColt, dela + d * i);
  w.drept(3, 9, spre);
}

console.log('\n═══ Buclă strânsă: boxul următor la 63 m — corecția nu mai vorbește lung ═══');
{
  const w = lume();
  w.drept(38, 10, 0);                         // 380 m reali, roadbook-ul zice 320
  viraj(w, 0, 90);                            // dreapta, la boxul 2 (0,32)
  const sync = w.store.journal.find(e => e.type === 'sync' && e.boxNum === 2);
  ok('virajul de la boxul 2 a fost prins', !!sync, JSON.stringify(w.store.journal.map(e => e.type)));
  const c = w.corectii()[0];
  ok('corecția e de −116 m, exact ca la boxul 4 în teren (11:28:44)',
     !!c && c.deltaM === -116, JSON.stringify(c));
  ok('boxul următor (3) e sub 150 m — în roadbook secțiunea are 90 m',
     !!c && c.panaLaUrmatorulM < 150, c && `${c.panaLaUrmatorulM} m`);
  ok('deci NU se rostește fraza lungă cu cifra',
     w.vorbit(/Corectat (înainte|înapoi) \d+ metri/).length === 0,
     JSON.stringify(w.said.map(s => s.t)));
  ok('cel mult „Corectat.", ca informația să nu ocupe urechea',
     w.vorbit(/^Corectat\.$/).length <= 1 && c.rostit === 'scurt', JSON.stringify(c));
  ok('dar ecranul o ține, cu cifră cu tot',
     !!w.m.M.corectie && /corectat înapoi \d+ m · box 2/.test(w.m.M.corectie.text),
     JSON.stringify(w.m.M.corectie));
}

console.log('\n═══ Spațiu de 333 m până la probă: fraza întreagă se rostește ═══');
{
  // cazul din jurnal, 11:28:44: snap pe boxul 4 (0,48), startul probei abia la 0,84 —
  // acolo fraza lungă are unde încăpea, deci se spune cu cifră cu tot
  const w = lume();
  w.drept(38, 10, 0);
  viraj(w, 0, 90);                            // boxul 2 — dreapta, intrarea în buclă
  w.drept(14, 11, 135);                       // bucla József, dus
  viraj(w, 135, 315);                         // întoarcerea la capătul buclei
  const c = w.corectii().find(e => e.boxNum === 4);
  ok('s-a sincronizat pe boxul 4 (stânga la T)', !!c,
     JSON.stringify(w.store.journal.filter(e => e.type === 'sync')));
  ok('până la boxul 5 sunt 333 m, deci e loc de vorbit',
     !!c && c.panaLaUrmatorulM > 150, c && `${c.panaLaUrmatorulM} m`);
  ok('corecția depășește 60 m, deci merită cuvinte', !!c && Math.abs(c.deltaM) > 60, JSON.stringify(c));
  ok('fraza întreagă, cu cifra și boxul',
     w.vorbit(/Corectat (înainte|înapoi) \d+ metri, box 4\./).length === 1,
     JSON.stringify(w.said.map(s => s.t)));
  ok('și e marcată în jurnal ca rostită întreg', !!c && c.rostit === 'intreg', JSON.stringify(c));
}

console.log('\n═══ Clasele: corecția e ritm, virajele sunt manevră ═══');
{
  const w = lume();
  w.drept(38, 10, 0);
  viraj(w, 0, 90);
  const cor = w.said.filter(s => /Corectat/.test(s.t));
  ok('anunțul de corecție e clasa „ritm", nu „manevra"',
     cor.every(s => s.cls === 'ritm'), JSON.stringify(cor));
  ok('și rămâne la prioritate mică (≤2)', cor.every(s => s.p <= 2), JSON.stringify(cor));
  const manevre = w.said.filter(s => s.cat === 'turn');
  ok('anunțurile de viraj sunt clasa „manevra" — asta lipsea de la 03.08',
     manevre.length > 0 && manevre.every(s => s.cls === 'manevra'),
     JSON.stringify(manevre.map(s => ({ t: s.t, cls: s.cls }))));
}

console.log('\n═══ În difuzor: corecția nu taie și nu i-o ia înainte manevrei ═══');
{
  let t = 0;
  const spoken = [], taiate = [];
  let busy = false;
  const tts = { speak: txt => { spoken.push(txt); busy = true; },
                cancel: () => { busy = false; }, busy: () => busy };
  const v = makeVoice({ tts, now: () => t, onDrop: (txt, de) => taiate.push({ txt, de }) });
  v.say('30 de metri — stânga la T', 3, 'turn', 'manevra');
  t += 500;
  v.say('Corectat înapoi 116 metri, box 4.', 2, 'sync', 'ritm');
  ok('manevra rămâne în difuzor', spoken[spoken.length - 1] === '30 de metri — stânga la T',
     JSON.stringify(spoken));
  ok('corecția n-a întrerupt nimic', !taiate.some(x => x.de === 'intrerupt'), JSON.stringify(taiate));

  // și în coadă: manevra pleacă prima, oricât de interesantă ar fi corecția
  const spoken2 = [];
  let elibereaza = null;
  const v2 = makeVoice({ now: () => t, tts: {
    speak: (txt, onEnd) => { spoken2.push(txt); elibereaza = onEnd; },
    cancel: () => { elibereaza = null; }, busy: () => !!elibereaza } });
  v2.say('Pornit.', 2, null, 'ritm');                     // ocupă difuzorul
  v2.say('Corectat înapoi 116 metri, box 4.', 2, 'sync', 'ritm');
  v2.say('stânga acum, la T', 4, 'turn', 'manevra');
  const term = elibereaza; elibereaza = null; term();
  ok('din coadă pleacă manevra, nu corecția', spoken2[1] === 'stânga acum, la T',
     JSON.stringify(spoken2));
}

console.log('\n═══ Corecțiile mici rămân tăcute, dar vizibile ═══');
{
  const w = lume();
  w.drept(32, 10, 0);                          // fix cât zice roadbook-ul: corecția rămâne mică
  viraj(w, 0, 90);
  const c = w.corectii()[0];
  ok('sub 60 m nu se rostește nimic', w.vorbit(/Corectat/).length === 0,
     JSON.stringify(w.said.map(s => s.t)));
  ok('nici nu se mai scrie „corectie_anunt" cu rostire', !c || c.rostit !== 'intreg', JSON.stringify(c));
  ok('dar corecția e pe ecran', !!w.m.M.corectie, JSON.stringify(w.m.M.corectie));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
