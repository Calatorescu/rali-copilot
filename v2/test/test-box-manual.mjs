// RALI 2 — butonul „SUNT LA BOX" nu mai are voie să strice tăcut.
//
// Cazul real (02.08.2026, bucla de 5,41 km de la birou): odometrul era corect sub 1%,
// dar o apăsare pe boxul 4, făcută la 1,69 km, a mutat poziția ÎNAPOI cu 1330 m în
// plină probă. RT1 s-a închis retroactiv cu un rezultat fără nicio legătură cu cursa,
// iar restul turei a fost două încercări de a repara din mers. Interfața era un
// prompt() gol care nu spunea nici unde crede aplicația că ești, nici ce urma să strice.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// roadbook-ul real de la birou
const BOX = sanitizeBoxes([
  { num: 1,  sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'Start' },
  { num: 3,  sumKm: 0.32, dir: 'DREAPTA', comment: 'spre József Attila' },
  { num: 4,  sumKm: 0.35, dir: 'STÂNGA',  comment: 'IMEDIAT 34 m' },
  { num: 5,  sumKm: 0.38, dir: 'STÂNGA-T', comment: 'înapoi pe Petőfi Sándor' },
  { num: 6,  sumKm: 0.60, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
  { num: 8,  sumKm: 2.60, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' },
  { num: 9,  sumKm: 2.98, dir: 'GIRATORIU-4', comment: 'Kaufland' },
  { num: 14, sumKm: 5.41, dir: 'ÎNAINTE', flag: 'TC', comment: 'Finish' }
]);

function lume() {
  let wall = 0, realKm = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ opts: { offRoute: false }, plan: buildPlan(BOX, {}, null), clock, store,
    driver: makeDriverModel(), voice: { say: t => said.push(t), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat: 45, lng: 21, tMs: wall, speedMs: 0, accM: 8 });
  return { m, store, said,
    condu(panaLa, kmh = 45) {
      while (realKm < panaLa - 1e-9) {
        const pas = Math.min(kmh / 3600, panaLa - realKm);
        realKm += pas; wall += 1000;
        m.onFix({ lat: 45 + realKm / 111.32, lng: 21, tMs: wall, speedMs: pas * 1000, accM: 8 });
      }
    } };
}

console.log('\n═══ Apăsarea care a distrus tura de pe 02.08 ═══');
{
  const w = lume();
  w.condu(1.69);                       // în probă, exact ca atunci
  ok('proba rulează', w.m.M.state === 'RT_RUN', w.m.M.state);
  const r = w.m.atBox(4);              // apăsarea greșită
  ok('NU s-a executat', r !== true && typeof r === 'object', JSON.stringify(r));
  ok('poziția a rămas neatinsă', Math.abs(w.m.M.routeKm - 1.69) < 0.03, w.m.M.routeKm.toFixed(3));
  ok('spune cât te-ar muta, cu semn', r.deltaM < -1300 && r.deltaM > -1360, String(r.deltaM));
  ok('și că te-ar scoate din probă', /RT ?1/.test(r.rupeRt || ''), String(r.rupeRt));
  ok('refuzul e în jurnal', w.store.journal.some(e => e.type === 'sync_refuzat'));
  ok('proba e tot în desfășurare', w.m.M.state === 'RT_RUN', w.m.M.state);
}

console.log('\n═══ Confirmat explicit: se execută ═══');
{
  const w = lume();
  w.condu(1.69);
  ok('cu confirmare, se face', w.m.atBox(4, true) === true);
  // snap la kilometrul EXACT al boxului (0,35), fără vechiul +20 m (audit #13)
  ok('poziția a sărit înapoi', Math.abs(w.m.M.routeKm - 0.35) < 0.01, w.m.M.routeKm.toFixed(3));
}

console.log('\n═══ Corecția mică rămâne instantanee (fără confirmări inutile) ═══');
{
  const w = lume();
  w.condu(0.30);
  ok('boxul 3, la 20 m: se execută direct', w.m.atBox(3) === true);
  ok('poziția e la box 3', Math.abs(w.m.M.routeKm - 0.32) < 0.01, w.m.M.routeKm.toFixed(3));
}

console.log('\n═══ Saltul peste linia de finiș e semnalat ca atare ═══');
{
  const w = lume();
  w.condu(1.98);                       // în RT1, înainte de finișul de la 2,60
  const r = w.m.atBox(9);              // exact apăsarea de +1016 m din tura reală
  ok('nu se execută fără confirmare', r !== true, JSON.stringify(r));
  ok('spune că ÎNCHIDE proba', /ÎNCHIDE/.test(r.rupeRt || ''), String(r.rupeRt));
  // în tura reală au fost +1016 m; aici poziția simulată cade cu câțiva metri diferit
  ok('și cu cât te mută înainte', r.deltaM > 1000 && r.deltaM < 1060, String(r.deltaM));
}

console.log('\n═══ Lista de boxuri propuse ═══');
{
  const w = lume();
  w.condu(1.69);
  const l = w.m.boxuriApropiate(5);
  ok('întoarce 5 boxuri', l.length === 5, String(l.length));
  ok('sunt în ordinea din roadbook', l.every((c, i) => i === 0 || l[i - 1].idx < c.idx),
     JSON.stringify(l.map(c => c.box.num)));
  ok('conține boxul următor așteptat',
     l.some(c => c.idx === w.m.M.nextBoxIdx), JSON.stringify(l.map(c => c.box.num)));
  const b8 = l.find(c => c.box.num === 8);
  ok('distanțele sunt cu semn, față de poziția curentă',
     b8 && b8.deltaM > 880 && b8.deltaM < 930, JSON.stringify(b8));
}

console.log('\n═══ Jurnalul reține unde era mașina, nu doar cât a mers ═══');
{
  const w = lume();
  w.condu(1.00);
  const poz = w.store.journal.filter(e => e.type === 'pos');
  ok('există intrări de poziție', poz.length > 3, String(poz.length));
  ok('toate au coordonate', poz.every(e => typeof e.lat === 'number' && typeof e.lng === 'number'),
     JSON.stringify(poz[0]));
  ok('coordonatele chiar se schimbă pe parcurs',
     Math.abs(poz[poz.length - 1].lat - poz[0].lat) > 0.001,
     `${poz[0].lat} → ${poz[poz.length - 1].lat}`);
  ok('și precizia fixului', poz.every(e => e.accM === 8), JSON.stringify(poz[0]));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
