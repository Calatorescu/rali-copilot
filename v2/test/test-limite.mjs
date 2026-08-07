// RALI 2 — ZONELE DE LIMITĂ LEGALĂ ÎN INTERIORUL PROBEI (v44).
//
// REGULA DE CONCURS, spusă de Andreas în dimineața cursei (07.08.2026): în probă,
// limitele legale de pe plăcuțe (30 km/h prin sate) TREBUIE respectate. Organizatorul
// NU calculează porțiunea aia la media probei — o SCADE — și NU ai voie să recuperezi
// timpul după ea.
//
// CUM SE MODELEAZĂ CORECT cu ce exista deja (segmentele din v38): o zonă de limită e
// exact O PERECHE DE SCHIMBĂRI DE SEGMENT. La kilometrul de intrare viteza devine
// limita; la cel de ieșire revine la viteza care AR FI FOST activă acolo — media de
// bază SAU media de după o schimbare oficială, dacă zona cade după ea. Consecințele
// sunt fix regula de concurs:
//   • timpul ideal include zona la viteza limită → devierea NU crește cât ții limita;
//   • după zonă ținta redevine media probei → nu se recuperează nimic.
//
// DATELE SUNT CELE REALE DE AZI, de pe buletinul scanat: TR 3 de la boxul 97 (77,01 km)
// la boxul 107 (86,71 km), medie 43,5 km/h, cu schimbare oficială la boxul 106 (79,54)
// spre 48,5. Zona de limită: 30 km/h de la boxul 99 (77,86) la boxul 105 (79,43).
import { sanitizeBoxes, aplicaLimite, normVitezaSalvata, detectRts,
         probeDinBuletin, buildPlan, faSegmente } from '../js/route.js';
import { idealTimeS, speedAt } from '../js/pace.js';
import { makeMemStore, exportDay, importDay } from '../js/store.js';
import { makeMachine } from '../js/machine.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const aici = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const sg = s => s.map(x => `${x.fromKm}@${x.kmh}`).join(' ');

// ── Boxurile reale ale lui TR 3, azi ───────────────────────────────────────
const TR3 = sanitizeBoxes([
  { day: 1, leg: 1, page: 9, num: 90, sumKm: 74.10, dir: 'ÎNAINTE', comment: 'DN 7' },
  { day: 1, leg: 1, page: 9, num: 97, sumKm: 77.01, dir: 'ÎNAINTE', flags: ['RT_START_STANDING'], comment: 'Start TR 3' },
  { day: 1, leg: 1, page: 9, num: 99, sumKm: 77.86, dir: 'ÎNAINTE', comment: 'Enter sat · 30' },
  { day: 1, leg: 1, page: 9, num: 105, sumKm: 79.43, dir: 'ÎNAINTE', comment: 'Exit sat' },
  { day: 1, leg: 1, page: 9, num: 106, sumKm: 79.54, dir: 'ÎNAINTE', comment: 'schimbare de medie' },
  { day: 1, leg: 1, page: 9, num: 107, sumKm: 86.71, dir: 'ÎNAINTE', flags: ['RT_FINISH'], comment: 'Finish TR 3' },
  { day: 1, leg: 1, page: 9, num: 112, sumKm: 90.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'TC 2' }
]);
const START_KM = 77.01, FINISH_KM = 86.71, DIST_KM = 9.70;
// segmentele DE BAZĂ: media probei + schimbarea oficială de la boxul 106
const BAZA = [{ fromKm: 0, kmh: 43.5 }, { fromKm: 2.53, kmh: 48.5 }];
const ZONA = [{ deLaKm: 77.86, panaLaKm: 79.43, kmh: 30 }];

console.log('\n═══ TR 3 de azi: segmentele, verificate la virgulă ═══');
{
  const s = aplicaLimite(BAZA, ZONA, START_KM, DIST_KM);
  ok('ies exact patru segmente', s.length === 4, sg(s));
  ok('[0 → 0,85] la 43,5 — media probei până la intrarea în sat',
     s[0].fromKm === 0 && s[0].kmh === 43.5, sg(s));
  ok('[0,85 → 2,42] la 30 — zona de limită, marcată ca limită',
     s[1].fromKm === 0.85 && s[1].kmh === 30 && s[1].limita === true, sg(s));
  ok('[2,42 → 2,53] la 43,5 — se revine la media de DINAINTE, nu la cea de după',
     s[2].fromKm === 2.42 && s[2].kmh === 43.5 && s[2].iesireLimita === true, sg(s));
  ok('[2,53 → 9,70] la 48,5 — schimbarea oficială rămâne unde era',
     s[3].fromKm === 2.53 && s[3].kmh === 48.5, sg(s));
  ok('segmentele ies sortate după kilometru',
     s.every((x, i) => i === 0 || x.fromKm > s[i - 1].fromKm), sg(s));
}

console.log('\n═══ Timpul ideal, calculat de mână și comparat cu idealTimeS ═══');
{
  const s = aplicaLimite(BAZA, ZONA, START_KM, DIST_KM);
  // de mână, bucată cu bucată — asta e cifra pe care se dau punctele
  const deMana = (0.85 / 43.5) * 3600     // până la sat, la media probei
               + (1.57 / 30.0) * 3600     // prin sat, la limita legală
               + (0.11 / 43.5) * 3600     // de la ieșirea din sat la schimbarea oficială
               + (7.17 / 48.5) * 3600;    // restul probei, la media schimbată
  const calculat = idealTimeS(DIST_KM, s);
  ok('timpul ideal al probei e cel calculat de mână, la virgulă',
     near(calculat, deMana, 1e-9), `${calculat} vs ${deMana}`);
  ok('și e ~800,05 secunde (13 minute și 20)', near(calculat, 800.0544614290793, 1e-9), `${calculat}`);

  // FĂRĂ zonă, aceeași probă ar avea un timp ideal MAI MIC — diferența e exact
  // ce SCADE organizatorul, adică ce n-ai voie să recuperezi.
  const faraZona = idealTimeS(DIST_KM, BAZA);
  ok('cu zona, timpul ideal e mai MARE decât fără ea (asta e „se scade porțiunea")',
     calculat > faraZona, `${calculat} vs ${faraZona}`);
  const pierdutInSat = (1.57 / 30) * 3600 - (1.57 / 43.5) * 3600;
  ok('iar diferența e fix timpul pierdut în sat față de media probei',
     near(calculat - faraZona, pierdutInSat, 1e-9), `${calculat - faraZona} vs ${pierdutInSat}`);
}

console.log('\n═══ Devierea nu crește cât ții limita, iar după zonă nu se recuperează ═══');
{
  const s = aplicaLimite(BAZA, ZONA, START_KM, DIST_KM);
  // condus PERFECT: 43,5 până la sat, 30 prin sat, 43,5 până la schimbare, 48,5 după
  const t = km => idealTimeS(km, s);
  ok('la intrarea în sat, devierea e zero dacă ai ținut media',
     near(t(0.85) - (0.85 / 43.5) * 3600, 0, 1e-9));
  ok('la ieșirea din sat, devierea e tot zero dacă ai ținut 30 — nu ai pierdut nimic',
     near(t(2.42) - ((0.85 / 43.5) + (1.57 / 30)) * 3600, 0, 1e-9));
  ok('ținta imediat DUPĂ zonă e media probei, nu una de recuperare',
     speedAt(2.45, s) === 43.5, `${speedAt(2.45, s)}`);
  ok('și ținta în zonă e chiar limita legală', speedAt(1.5, s) === 30, `${speedAt(1.5, s)}`);
  ok('iar după schimbarea oficială e media nouă', speedAt(5, s) === 48.5, `${speedAt(5, s)}`);
}

console.log('\n═══ Cazuri de margine ═══');
{
  // 1. ZONĂ CARE SE TERMINĂ EXACT LA O SCHIMBARE OFICIALĂ (boxul 105 mutat pe 79,54)
  const s1 = aplicaLimite(BAZA, [{ deLaKm: 77.86, panaLaKm: 79.54, kmh: 30 }], START_KM, DIST_KM);
  ok('zona care se termină exact la schimbarea oficială nu produce un segment de zero km',
     s1.length === 3, sg(s1));
  ok('…iar viteza de după e cea OFICIALĂ (48,5), nu media de bază',
     s1[2].fromKm === 2.53 && s1[2].kmh === 48.5, sg(s1));
  ok('…și acolo se pierde marcajul de „ieșire din limită": punctul e o schimbare oficială',
     s1[1].kmh === 30 && s1[1].limita === true, sg(s1));

  // 2. ZONĂ CARE TRECE PESTE FINIȘ — se taie, limita ține până la linie
  const s2 = aplicaLimite(BAZA, [{ deLaKm: 85.00, panaLaKm: 90.00, kmh: 30 }], START_KM, DIST_KM);
  ok('zona care depășește finișul nu inserează nicio ieșire după linie',
     s2.length === 3 && s2[2].fromKm === 7.99 && s2[2].kmh === 30, sg(s2));
  ok('…și nu apare niciun segment dincolo de lungimea probei',
     s2.every(x => x.fromKm < DIST_KM), sg(s2));

  // 3. ZONĂ CARE ÎNCEPE ÎNAINTE DE START — se taie la linia de start
  const s3 = aplicaLimite(BAZA, [{ deLaKm: 76.00, panaLaKm: 77.50, kmh: 30 }], START_KM, DIST_KM);
  ok('zona care începe înaintea startului pornește de la kilometrul 0 al probei',
     s3[0].fromKm === 0 && s3[0].kmh === 30 && s3[0].limita === true, sg(s3));
  ok('…iar la ieșire se revine la media probei', s3[1].fromKm === 0.49 && s3[1].kmh === 43.5, sg(s3));

  // 4. ZONĂ INTEGRAL ÎN AFARA PROBEI — nu atinge nimic
  const s4 = aplicaLimite(BAZA, [{ deLaKm: 90.0, panaLaKm: 92.0, kmh: 30 }], START_KM, DIST_KM);
  ok('o zonă de după finiș nu schimbă niciun segment', sg(s4) === sg(BAZA), sg(s4));
  const s5 = aplicaLimite(BAZA, [{ deLaKm: 70.0, panaLaKm: 76.0, kmh: 30 }], START_KM, DIST_KM);
  ok('nici una de dinaintea startului', sg(s5) === sg(BAZA), sg(s5));

  // 5. DOUĂ ZONE pe aceeași probă
  const s6 = aplicaLimite(BAZA, [{ deLaKm: 77.86, panaLaKm: 79.43, kmh: 30 },
                                 { deLaKm: 82.01, panaLaKm: 83.01, kmh: 50 }], START_KM, DIST_KM);
  ok('două zone dau șase segmente', s6.length === 6, sg(s6));
  ok('…a doua zonă intră după schimbarea oficială',
     s6[4].fromKm === 5.00 && s6[4].kmh === 50 && s6[4].limita === true, sg(s6));
  ok('…iar la ieșirea din ea se revine la 48,5, viteza oficială de acolo — NU la 43,5',
     s6[5].fromKm === 6.00 && s6[5].kmh === 48.5 && s6[5].iesireLimita === true, sg(s6));

  // 6. ZONĂ CU CAPETELE INVERSATE sau de lungime zero
  ok('o zonă cu capetele inversate se ignoră',
     sg(aplicaLimite(BAZA, [{ deLaKm: 79.43, panaLaKm: 77.86, kmh: 30 }], START_KM, DIST_KM)) === sg(BAZA));
  ok('o zonă de lungime zero se ignoră',
     sg(aplicaLimite(BAZA, [{ deLaKm: 78.00, panaLaKm: 78.00, kmh: 30 }], START_KM, DIST_KM)) === sg(BAZA));
  ok('o zonă fără viteză se ignoră',
     sg(aplicaLimite(BAZA, [{ deLaKm: 77.86, panaLaKm: 79.43, kmh: null }], START_KM, DIST_KM)) === sg(BAZA));
}

console.log('\n═══ NE-REGRESIE: zero zone = segmentele de azi, bit cu bit ═══');
{
  // Cea mai importantă verificare din fișier: fără nicio zonă pusă, funcția nu are voie
  // să schimbe NIMIC în ce se cronometrează azi. O aplicație publicată în dimineața
  // cursei nu are voie să miște virgula unei probe pe care nimeni n-a cerut-o.
  for (const limite of [[], null, undefined]) {
    const s = aplicaLimite(BAZA, limite, START_KM, DIST_KM);
    ok(`fără zone (${JSON.stringify(limite)}) segmentele sunt identice`,
       JSON.stringify(s) === JSON.stringify(BAZA), sg(s));
  }
  ok('și timpul ideal e neschimbat, la bit',
     idealTimeS(DIST_KM, aplicaLimite(BAZA, [], START_KM, DIST_KM)) === idealTimeS(DIST_KM, BAZA));
  // și pe o probă cu UN SINGUR segment (cazul obișnuit)
  const unul = [{ fromKm: 0, kmh: 40 }];
  ok('o probă cu medie constantă rămâne cu un singur segment',
     JSON.stringify(aplicaLimite(unul, [], 0, 5)) === JSON.stringify(unul));
  ok('o probă fără segmente rămâne fără segmente (fără viteză setată)',
     JSON.stringify(aplicaLimite([], ZONA, START_KM, DIST_KM)) === '[]');
  // sursa nu se mută sub apelant
  const copie = JSON.parse(JSON.stringify(BAZA));
  aplicaLimite(BAZA, ZONA, START_KM, DIST_KM);
  ok('funcția nu modifică segmentele primite', JSON.stringify(BAZA) === JSON.stringify(copie));
}

console.log('\n═══ Zonele salvate pe BOXURI, prin planul real ═══');
{
  // așa ajunge zona în aplicație: omul scrie boxurile, nu kilometrii
  const salvat = { '97_7701': { kmh: 43.5, schimbari: [{ box: 106, kmh: 48.5 }],
                                limite: [{ deLaBox: 99, panaLaBox: 105, kmh: 30 }] } };
  const rts = detectRts(TR3, salvat);
  ok('proba s-a detectat', rts.length === 1 && rts[0].distKm === 9.70,
     JSON.stringify(rts.map(r => r.distKm)));
  ok('segmentele venite prin boxuri sunt EXACT cele de mai sus',
     sg(rts[0].segments) === '0@43.5 0.85@30 2.42@43.5 2.53@48.5', sg(rts[0].segments));
  ok('zona se vede și pe ecran, cu boxurile și kilometrii ei',
     rts[0].limite.length === 1 && rts[0].limite[0].deLaBox === 99 &&
     rts[0].limite[0].deLaKmProba === 0.85 && rts[0].limite[0].panaLaKmProba === 2.42,
     JSON.stringify(rts[0].limite));
  ok('`kmh` al probei rămâne viteza primului segment (media probei)', rts[0].kmh === 43.5);

  // BOX INEXISTENT: nu se aplică și NU se pierde tăcut
  const rele = detectRts(TR3, { '97_7701': { kmh: 43.5, limite: [{ deLaBox: 99, panaLaBox: 300, kmh: 30 }] } });
  ok('o zonă pe un box inexistent nu se aplică', rele[0].segments.length === 1, sg(rele[0].segments));
  ok('…și e raportată, nu înghițită',
     rele[0].limiteNepuse.length === 1 && /nu există/.test(rele[0].limiteNepuse[0].motiv),
     JSON.stringify(rele[0].limiteNepuse));
  // …iar o zonă cu boxurile în ordine inversă cade și mai devreme, la graniță
  ok('o zonă cu boxurile în ordine inversă nici nu ajunge la plan',
     detectRts(TR3, { '97_7701': { kmh: 43.5, limite: [{ deLaBox: 105, panaLaBox: 99, kmh: 30 }] } })[0]
       .segments.length === 1);

  // aceeași cale, dar prin BULETIN (calea folosită azi)
  const buletin = [{ name: 'TR 3', startBox: 97, finishBox: 107, startPage: 9, finishPage: 9,
                     startType: 'standing', kmh: 43.5, finishRel: 'at',
                     speedChanges: [{ kmh: 48.5, box: 106, page: 9 }],
                     startAfterTc: { tc: 'TC 1', minutes: 131 } }];
  const b = probeDinBuletin(TR3, buletin, null, salvat);
  ok('pe calea buletinului ies aceleași segmente',
     b.rts.length === 1 && sg(b.rts[0].segments) === '0@43.5 0.85@30 2.42@43.5 2.53@48.5',
     sg((b.rts[0] || {}).segments || []));
  ok('și decalajul de start rămâne neatins', b.rts[0].startDupaTc.minutes === 131);
  const bRau = probeDinBuletin(TR3, buletin,
    null, { '97_7701': { kmh: 43.5, limite: [{ deLaBox: 90, panaLaBox: 97, kmh: 30 }] } });
  ok('o zonă din afara probei produce o notă „pune-o de mână", în română',
     bRau.note.some(n => n.tip === 'de_mana' && /limita de 30 km\/h/.test(n.text) &&
                         /nu e între startul și finișul probei/.test(n.text)),
     JSON.stringify(bRau.note.map(n => n.text)));

  // planul complet, așa cum îl vede mașina de stări
  const plan = buildPlan(TR3, salvat, null, null, buletin);
  ok('planul construit poartă zona până la mașina de stări',
     plan.rts[0].segments.length === 4 && plan.rts[0].segments[1].limita === true,
     sg(plan.rts[0].segments));
}

console.log('\n═══ Proba condusă prin zonă: ce aude pilotul ═══');
{
  // Aceeași geometrie ca TR 3 de azi, mutată la kilometrul 0 ca testul să nu conducă
  // 77 de kilometri de legătură degeaba: probă de 9,70 km, sat între 0,85 și 2,42,
  // schimbare oficială la 2,53.
  const B = sanitizeBoxes([
    { day: 1, leg: 1, page: 1, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'TC 1' },
    { day: 1, leg: 1, page: 1, num: 97, sumKm: 0.20, dir: 'ÎNAINTE', comment: 'Start' },
    { day: 1, leg: 1, page: 1, num: 99, sumKm: 1.05, dir: 'ÎNAINTE', comment: 'Enter sat' },
    { day: 1, leg: 1, page: 1, num: 105, sumKm: 2.62, dir: 'ÎNAINTE', comment: 'Exit sat' },
    { day: 1, leg: 1, page: 1, num: 106, sumKm: 2.73, dir: 'ÎNAINTE', comment: 'schimbare' },
    { day: 1, leg: 1, page: 1, num: 107, sumKm: 9.90, dir: 'ÎNAINTE', comment: 'Finish' }
  ]);
  const buletin = [{ name: 'TR 3', startBox: 97, finishBox: 107, startPage: 1, finishPage: 1,
                     startType: 'auto', kmh: 43.5, finishRel: 'at',
                     speedChanges: [{ kmh: 48.5, box: 106, page: 1 }], startAfterTc: null }];
  const salvat = { '97_20': { kmh: 43.5, schimbari: [{ box: 106, kmh: 48.5 }],
                              limite: [{ deLaBox: 99, panaLaBox: 105, kmh: 30 }] } };
  let wall = 0, lat = 45.7823, lng = 24.1461;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const plan = buildPlan(B, salvat, null, null, buletin);
  const m = makeMachine({ plan, clock, store, driver: makeDriverModel(),
    opts: { offRoute: false },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {},
             durataMs: t => 350 + String(t).length * 90 },
    ui: { render() {} } });
  const condu = (km, kmh) => {
    const v = kmh / 3.6, n = Math.round(km * 1000 / v);
    for (let i = 0; i < n; i++) {
      lng += v / (111320 * Math.cos(45.7823 * Math.PI / 180));
      wall += 1000;
      m.onFix({ lat, lng, tMs: wall, speedMs: v, headingDeg: 90, accM: 6 });
    }
  };
  const vorbit = re => said.filter(s => re.test(s.t));

  ok('planul are cele patru segmente ale lui TR 3',
     sg(plan.rts[0].segments) === '0@43.5 0.85@30 2.42@43.5 2.53@48.5', sg(plan.rts[0].segments));
  m.start();
  condu(0.15, 43.5);
  ok('avertizarea de dinaintea probei spune media, startul din mers ȘI zona de limită',
     vorbit(/^Proba în 500\./).length === 1 &&
     vorbit(/^Proba în 500\./)[0].t ===
       'Proba în 500. Viteza 43 și 5. Din mers — nu opri! Apoi schimbare la 48 și 5. Cu o zonă de limită.',
     JSON.stringify(vorbit(/Proba în 500/).map(s => s.t)));
  condu(0.15, 43.5);
  ok('proba a pornit', m.M.state === 'RT_RUN', m.M.state);
  condu(0.80, 43.5);                     // → km 1,10, adică 0,90 de probă: în sat
  ok('la intrarea în sat se aude „Limită 30." — nu „Acum 30."',
     vorbit(/^Limită 30\.$/).length === 1, JSON.stringify(said.slice(-5).map(s => s.t)));
  ok('și devierea e ~zero, fiindcă timpul ideal include zona la 30',
     Math.abs(m.M.rt.lastDev) < 2, `${m.M.rt.lastDev}`);
  condu(1.52, 30);                       // prin sat, la limita legală → km 2,62
  ok('cât ții limita, devierea NU crește — asta e regula, în cifre',
     Math.abs(m.M.rt.lastDev) < 2, `${m.M.rt.lastDev}`);
  condu(0.06, 43.5);                     // → km 2,68: ieșit din sat
  ok('la ieșire: „Limita gata. Ține 43 și 5."',
     vorbit(/^Limita gata\. Ține 43 și 5\.$/).length === 1,
     JSON.stringify(said.slice(-5).map(s => s.t)));
  condu(0.10, 43.5);                     // → km 2,78: peste schimbarea oficială
  ok('iar schimbarea oficială rămâne „Acum 48 și 5." — mecanismul din v38, neatins',
     vorbit(/^Acum 48 și 5\.$/).length === 1, JSON.stringify(said.slice(-5).map(s => s.t)));
  ok('jurnalul deosebește zona de schimbarea de medie',
     JSON.stringify(store.journal.filter(e => e.type === 'rt_segment')
       .map(e => [e.kmh, !!e.limita, !!e.iesireLimita])) ===
     JSON.stringify([[30, true, false], [43.5, false, true], [48.5, false, false]]),
     JSON.stringify(store.journal.filter(e => e.type === 'rt_segment')));
  ok('și nicio zonă nu s-a rostit ca „Acum 30."', vorbit(/^Acum 30\.$/).length === 0);
}

console.log('\n═══ Formatul salvat: compatibil înapoi, și pleacă întreg la al doilea telefon ═══');
{
  ok('forma veche (număr) se citește cu listă goală de limite',
     JSON.stringify(normVitezaSalvata(43.5)) ===
     JSON.stringify({ kmh: 43.5, schimbari: [], limite: [] }));
  ok('forma cu schimbări, fără limite, se citește ca înainte',
     normVitezaSalvata({ kmh: 43.5, schimbari: [{ box: 106, kmh: 48.5 }] }).limite.length === 0);
  const n = normVitezaSalvata({ kmh: 43.5, schimbari: [{ box: 106, kmh: 48.5 }],
                                limite: [{ deLaBox: 99, panaLaBox: 105, kmh: 30 }] });
  ok('forma nouă poartă și zonele', n.limite.length === 1 && n.limite[0].kmh === 30, JSON.stringify(n));
  ok('o zonă cu boxurile inversate se aruncă la graniță',
     normVitezaSalvata({ kmh: 43.5, limite: [{ deLaBox: 105, panaLaBox: 99, kmh: 30 }] }).limite.length === 0);
  ok('o zonă fără viteză se aruncă la graniță',
     normVitezaSalvata({ kmh: 43.5, limite: [{ deLaBox: 99, panaLaBox: 105 }] }).limite.length === 0);
  ok('o viteză absurdă se aruncă la graniță',
     normVitezaSalvata({ kmh: 43.5, limite: [{ deLaBox: 99, panaLaBox: 105, kmh: 900 }] }).limite.length === 0);
  ok('`limite` care nu e listă nu rupe nimic',
     normVitezaSalvata({ kmh: 43.5, limite: 'aiurea' }).limite.length === 0);

  // EXPORT/IMPORT — al doilea telefon trebuie să preia cursa cu aceleași zone
  (async () => {
    const a = makeMemStore(), b2 = makeMemStore();
    const salvat = { '97_7701': { kmh: 43.5, schimbari: [{ box: 106, kmh: 48.5 }],
                                  limite: [{ deLaBox: 99, panaLaBox: 105, kmh: 30 }] } };
    await a.put('rt_speeds', salvat);
    await a.log('day_start', {}, 1);
    const dump = await exportDay(a);
    ok('exportul cară zonele de limită',
       JSON.stringify(dump.rt_speeds) === JSON.stringify(salvat), JSON.stringify(dump.rt_speeds));
    await importDay(b2, dump);
    const dupa = await b2.get('rt_speeds');
    ok('iar al doilea telefon le are întregi după preluare',
       JSON.stringify(dupa) === JSON.stringify(salvat), JSON.stringify(dupa));
    ok('și produc aceleași segmente pe telefonul al doilea',
       sg(detectRts(TR3, dupa)[0].segments) === '0@43.5 0.85@30 2.42@43.5 2.53@48.5');
    gata();
  })();
}

// export/import sunt asincrone: raportul se scrie după ele
function gata() {
  console.log('\n═══ Editorul din cardul PROBELE ═══');
  {
    const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
    ok('câmpurile cerute: limita în km/h, boxul de intrare, boxul de ieșire, butonul PUNE',
       /limită legală:/.test(main) && /de la boxul/.test(main) &&
       /până la boxul/.test(main) && /puneL\.textContent = 'PUNE'/.test(main));
    ok('zonele puse se listează, fiecare cu butonul ei de ștergere',
       /scoateLimita\(cheie, z\.deLaBox, z\.panaLaBox\)/.test(main));
    ok('BOX INEXISTENT: mesaj clar și NU se salvează nimic',
       /nu există în roadbook-ul scanat\. N-am salvat nimic\./.test(main));
    ok('box de ieșire înaintea celui de intrare: la fel',
       /nu e DUPĂ boxul[\s\S]{0,80}?N-am salvat nimic/.test(main));
    ok('zonă care nu atinge proba: la fel',
       /nu se suprapune deloc cu proba[\s\S]{0,80}?N-am salvat nimic/.test(main));
    ok('se scrie sub aceeași cheie de probă, prin singurul loc care salvează viteze',
       /async function salveazaViteza\(key, kmh, schimbari, limite\)/.test(main));
    ok('FORMA VECHE se păstrează cât timp nu e nimic în plus de scris — un număr simplu',
       /else if \(!s\.length && !z\.length\) speeds\[key\] = k;/.test(main));
    ok('fiecare zonă pusă sau ștearsă lasă urmă în jurnal',
       /ce: 'limita_legala'/.test(main) && /ce: 'limita_stearsa'/.test(main));
    ok('și zonele se văd lângă probă, în rezumatul de dinainte de START',
       /limite legale: /.test(main));
  }
  console.log('\n═══ Vocea, la trecerea prin zonă ═══');
  {
    const mach = readFileSync(join(aici, '..', 'js', 'machine.js'), 'utf8');
    ok('la intrare se rostește „Limită 30." — nu „Acum 30."',
       /s\.limita \? `Limită \$\{vitezaRo\(s\.kmh\)\}\.`/.test(mach));
    ok('la ieșire „Limita gata. Ține 43 și 5."',
       /s\.iesireLimita \? `Limita gata\. Ține \$\{vitezaRo\(s\.kmh\)\}\.`/.test(mach));
    ok('schimbările oficiale rămân „Acum X." — mecanismul din v38, neatins',
       /: `Acum \$\{vitezaRo\(s\.kmh\)\}\.`/.test(mach));
    ok('jurnalul deosebește o zonă de limită de o schimbare de medie',
       /limita: !!s\.limita, iesireLimita: !!s\.iesireLimita/.test(mach));
    ok('avertizarea de dinaintea probei numără zonele separat de schimbări',
       /const alta = urm\.find\(s => !s\.limita && !s\.iesireLimita\)/.test(mach) &&
       /Cu o zonă de limită\./.test(mach));
  }
  console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
  process.exit(fail ? 1 : 0);
}
