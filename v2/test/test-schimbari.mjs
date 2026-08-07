// RALI 2 — SCHIMBĂRILE DE MEDIE: buletinul + mâna omului SE ADUNĂ (v46).
//
// PROBA CARE A PLĂTIT GREȘEALA, măsurată pe teren la Sibiu, 07.08.2026, TR 5.
// Buletinul directorului de cursă: start boxul 131 (104,51 km), finiș înainte de boxul
// 149 (113,42), medie 15 km/h, cu O SCHIMBARE OFICIALĂ la boxul 136 (105,66 km, adică
// 1,15 km de probă) spre 48,5 km/h. Pilotul a mai pus, de mână, patru schimbări proprii
// (boxurile 142 → 30, 143 → 48,5, 146 → 30, 147 → 48,5), salvate în `rt_speeds` sub
// cheia probei ca `schimbari: [...]`.
//
// CE S-A ÎNTÂMPLAT, dovedit în jurnalul zilei (rali-jurnale/jurnale/2026-08-07.json):
// primul `rt_segment` al lui TR 5 a venit abia la km 5,01 — boxul 142, adică prima
// schimbare a omului. Schimbarea oficială de la boxul 136 NU EXISTA în plan: lista de
// mână o înlocuise. Aplicația a cerut 15 km/h pe primii 5 km dintr-o probă care trebuia
// condusă cu 48,5 după kilometrul 1,15. Proba s-a penalizat cu 150 de puncte.
//
// Linia vinovată era în `probeDinBuletin`: `folosite = s2.bune` — atribuire, nu îmbinare.
//
// DOVADA CONTRARIE, din aceeași zi: la TR 6 pilotul rescrisese DE MÂNĂ și schimbarea
// oficială (boxul 17 → 39,5) pe lângă ale lui, și acolo totul a mers. Deci mecanismul
// era exact ăsta, iar reparația nu are voie să producă dubluri pe cazul ăla.
import { sanitizeBoxes, probeDinBuletin, detectRts, buildPlan,
         normVitezaSalvata } from '../js/route.js';
import { idealTimeS, speedAt } from '../js/pace.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));
const sg = s => s.map(x => `${x.fromKm}@${x.kmh}`).join(' ');

// ── ROADBOOK-UL REAL AL LUI TR 5 ────────────────────────────────────────────
// Kilometrajele boxurilor 131, 136, 142, 143 și 149 sunt cele de pe teren (buletin +
// jurnal: crossing-ul de la 5,01 km confirmă boxul 142 la 109,52). Pentru 146 și 147
// dump-ul zilei nu mai păstrează decât ultimul leg, deci kilometrii lor NU se cunosc —
// aici sunt aleși ca să cadă între 143 și finiș, fiindcă testul de acceptare se joacă
// pe primele trei segmente, singurele despre care avem cifre măsurate.
const TR5_BOX = sanitizeBoxes([
  { day: 2, leg: 1, page: 33, num: 130, sumKm: 104.10, dir: 'ÎNAINTE', comment: '' },
  { day: 2, leg: 1, page: 33, num: 131, sumKm: 104.51, dir: 'ÎNAINTE', comment: 'START TR 5' },
  { day: 2, leg: 1, page: 34, num: 136, sumKm: 105.66, dir: 'ÎNAINTE', comment: 'schimbare oficială' },
  { day: 2, leg: 1, page: 34, num: 142, sumKm: 109.52, dir: 'ÎNAINTE', comment: 'intrare sat' },
  { day: 2, leg: 1, page: 34, num: 143, sumKm: 109.59, dir: 'ÎNAINTE', comment: 'ieșire sat' },
  { day: 2, leg: 1, page: 35, num: 146, sumKm: 111.05, dir: 'ÎNAINTE', comment: 'intrare sat' },
  { day: 2, leg: 1, page: 35, num: 147, sumKm: 112.30, dir: 'ÎNAINTE', comment: 'ieșire sat' },
  { day: 2, leg: 1, page: 35, num: 149, sumKm: 113.42, dir: 'ÎNAINTE', comment: 'FINISH TR 5' },
  { day: 2, leg: 1, page: 35, num: 150, sumKm: 114.00, dir: 'ÎNAINTE', comment: '' }
]);

// buletinul, exact cum l-a citit aplicația în ziua cursei
const TR5_BULETIN = [{
  name: 'TR 5', startBox: 131, finishBox: 149, startPage: 33, finishPage: 35,
  startType: 'auto', startAfterTc: null, kmh: 15,
  speedChanges: [{ kmh: 48.5, box: 136, page: 34, place: null }],
  finishRel: 'before'
}];
const CHEIE_TR5 = `131_${Math.round(104.51 * 100)}`;
// cele patru schimbări puse de pilot, în forma în care s-au salvat
const TR5_MANUAL = { [CHEIE_TR5]: { kmh: null, schimbari: [
  { box: 142, kmh: 30 }, { box: 143, kmh: 48.5 },
  { box: 146, kmh: 30 }, { box: 147, kmh: 48.5 } ] } };

const probaTR5 = salvat => {
  const r = probeDinBuletin(TR5_BOX, TR5_BULETIN, null, salvat || {});
  return r.rts[0];
};

console.log('\n═══ TESTUL DE ACCEPTARE: TR 5 Sibiu, cazul real de pe 07.08 ═══');
{
  const rt = probaTR5(TR5_MANUAL);
  ok('proba s-a legat de roadbook (8,91 km, de la 104,51 la 113,42)',
     rt && rt.distKm === 8.91, rt ? String(rt.distKm) : 'lipsește');
  ok('SCHIMBAREA OFICIALĂ DE LA BOXUL 136 EXISTĂ ÎN PLAN — defectul reparat',
     rt.segments.some(s => s.fromKm === 1.15 && s.kmh === 48.5), sg(rt.segments));
  ok('segmentele încep exact cum cere testul: [0→1,15 @15] [1,15→5,01 @48,5] [5,01→5,08 @30]',
     sg(rt.segments).startsWith('0@15 1.15@48.5 5.01@30 5.08@48.5'), sg(rt.segments));
  ok('și continuă cu zonele de la 146 și 147, în ordinea drumului',
     sg(rt.segments) === '0@15 1.15@48.5 5.01@30 5.08@48.5 6.54@30 7.79@48.5', sg(rt.segments));
  ok('`kmh` al probei rămâne media de start din buletin (15), nu prima schimbare',
     rt.kmh === 15, String(rt.kmh));
  ok('toate cele cinci schimbări se văd pe ecran, cu boxurile lor',
     JSON.stringify(rt.schimbari.map(s => s.box)) === JSON.stringify([136, 142, 143, 146, 147]),
     JSON.stringify(rt.schimbari));
  ok('nimic nu s-a pierdut tăcut: nicio schimbare nepusă',
     rt.schimbariNepuse.length === 0);

  // CE COSTA DEFECTUL, în secunde de timp ideal pe bucata dintre start și boxul 142
  const stricat = [{ fromKm: 0, kmh: 15 }, { fromKm: 5.01, kmh: 30 }];  // planul de ieri
  const tStricat = idealTimeS(5.01, stricat), tBun = idealTimeS(5.01, rt.segments);
  ok(`pe primii 5,01 km timpul ideal cade de la ${Math.round(tStricat)} s la ${Math.round(tBun)} s`,
     tStricat > tBun + 400 && Math.abs(tBun - (1.15 / 15 + 3.86 / 48.5) * 3600) < 1,
     `${tStricat} → ${tBun}`);
  ok('iar viteza cerută la km 3 e 48,5, nu 15 — asta auzea pilotul greșit',
     speedAt(3, rt.segments) === 48.5, String(speedAt(3, rt.segments)));
}

console.log('\n═══ Dublura identică: omul rescrie de mână schimbarea oficială ═══');
{
  // TR 6 din aceeași zi, cu cifrele reale din jurnal: buletinul dă boxul 17 → 39,5, iar
  // `rt_speeds` avea salvat exact același lucru, pus de mână.
  const BOX = sanitizeBoxes([
    { day: 2, leg: 2, page: 42, num: 14, sumKm: 6.16, dir: 'ÎNAINTE', comment: 'START TR 6' },
    { day: 2, leg: 2, page: 42, num: 17, sumKm: 8.68, dir: 'ÎNAINTE', comment: 'schimbare' },
    { day: 2, leg: 2, page: 43, num: 23, sumKm: 14.90, dir: 'ÎNAINTE', comment: 'FINISH TR 6' }
  ]);
  const buletin = [{ name: 'TR 6', startBox: 14, finishBox: 23, startPage: 42, finishPage: 43,
                     startType: 'auto', startAfterTc: null, kmh: 43.5, finishRel: 'at',
                     speedChanges: [{ kmh: 39.5, box: 17, page: 42, place: null }] }];
  const salvat = { '14_616': { kmh: null, schimbari: [{ box: 17, kmh: 39.5 }] } };
  const rt = probeDinBuletin(BOX, buletin, null, salvat).rts[0];
  ok('un singur segment la 2,52 — nu doi, nu o dublură',
     sg(rt.segments) === '0@43.5 2.52@39.5', sg(rt.segments));
  ok('și pe ecran boxul 17 apare o singură dată',
     rt.schimbari.length === 1 && rt.schimbari[0].box === 17, JSON.stringify(rt.schimbari));

  // aceeași dublură pe fixtura TR 3 de la Reșița, cea din test-limite
  const TR3 = sanitizeBoxes([
    { day: 1, leg: 1, page: 9, num: 97,  sumKm: 77.01, dir: 'ÎNAINTE', comment: 'Start' },
    { day: 1, leg: 1, page: 9, num: 106, sumKm: 79.54, dir: 'ÎNAINTE', comment: 'schimbare' },
    { day: 1, leg: 1, page: 9, num: 107, sumKm: 86.71, dir: 'ÎNAINTE', comment: 'Finish' }
  ]);
  const b3 = [{ name: 'TR 3', startBox: 97, finishBox: 107, startPage: 9, finishPage: 9,
                startType: 'standing', startAfterTc: null, kmh: 43.5, finishRel: 'at',
                speedChanges: [{ kmh: 48.5, box: 106, page: 9, place: null }] }];
  const r3 = probeDinBuletin(TR3, b3, null,
    { '97_7701': { kmh: 43.5, schimbari: [{ box: 106, kmh: 48.5 }] } }).rts[0];
  ok('TR 3: dublura pe boxul 106 dă un singur segment la 2,53',
     sg(r3.segments) === '0@43.5 2.53@48.5', sg(r3.segments));
}

console.log('\n═══ Conflict pe același box: OMUL bate buletinul ═══');
{
  // pilotul a văzut pe teren că schimbarea de la boxul 136 e 40, nu 48,5
  const rt = probaTR5({ [CHEIE_TR5]: { kmh: null, schimbari: [{ box: 136, kmh: 40 }] } });
  ok('la boxul 136 rămâne cifra omului (40), nu cea din buletin (48,5)',
     sg(rt.segments) === '0@15 1.15@40', sg(rt.segments));
  ok('și e un singur punct, nu două suprapuse',
     rt.schimbari.length === 1 && rt.schimbari[0].kmh === 40, JSON.stringify(rt.schimbari));

  // conflict pe un box DIFERIT, dar la același kilometru de probă: tot omul câștigă
  const BOX = sanitizeBoxes([
    { day: 2, leg: 1, page: 33, num: 131, sumKm: 104.51, dir: 'ÎNAINTE', comment: 'START' },
    { day: 2, leg: 1, page: 34, num: 136, sumKm: 105.66, dir: 'ÎNAINTE', comment: 'oficial' },
    { day: 2, leg: 1, page: 34, num: 137, sumKm: 105.66, dir: 'ÎNAINTE', comment: 'același km' },
    { day: 2, leg: 1, page: 35, num: 149, sumKm: 113.42, dir: 'ÎNAINTE', comment: 'FINISH' }
  ]);
  const r2 = probeDinBuletin(BOX, TR5_BULETIN, null,
    { [CHEIE_TR5]: { kmh: null, schimbari: [{ box: 137, kmh: 33 }] } }).rts[0];
  ok('două schimbări la același kilometru: rămâne a omului',
     sg(r2.segments) === '0@15 1.15@33', sg(r2.segments));
}

console.log('\n═══ Viteza de bază: manualul bate media buletinului, `null` n-o atinge ═══');
{
  const fara = probaTR5({ [CHEIE_TR5]: { kmh: null, schimbari: [{ box: 142, kmh: 30 }] } });
  ok('`kmh: null` lasă media buletinului (15)', fara.segments[0].kmh === 15, sg(fara.segments));
  const cu = probaTR5({ [CHEIE_TR5]: { kmh: 22, schimbari: [{ box: 142, kmh: 30 }] } });
  ok('`kmh: 22` pus de om bate media buletinului', cu.segments[0].kmh === 22, sg(cu.segments));
  ok('…iar schimbarea oficială rămâne pe loc și în cazul ăsta',
     sg(cu.segments) === '0@22 1.15@48.5 5.01@30', sg(cu.segments));
  ok('forma VECHE (număr simplu) merge la fel: viteza omului, schimbarea buletinului',
     sg(probaTR5({ [CHEIE_TR5]: 22 }).segments) === '0@22 1.15@48.5',
     sg(probaTR5({ [CHEIE_TR5]: 22 }).segments));
  ok('normalizarea nu s-a atins: forma veche dă listele goale',
     JSON.stringify(normVitezaSalvata(22)) ===
     JSON.stringify({ kmh: 22, schimbari: [], limite: [] }));
}

console.log('\n═══ NE-REGRESIE: fără schimbări manuale, planul de azi, bit cu bit ═══');
{
  // Cea mai importantă verificare din fișier: o probă la care nimeni n-a pus nimic de
  // mână nu are voie să se miște cu o virgulă față de ce se cronometra ieri.
  const gol = probaTR5({});
  ok('doar buletinul: [0@15] [1,15@48,5]', sg(gol.segments) === '0@15 1.15@48.5', sg(gol.segments));
  for (const salvat of [{}, { [CHEIE_TR5]: { kmh: null, schimbari: [] } },
                        { [CHEIE_TR5]: { kmh: null } }, { alta_cheie: { kmh: 30 } }]) {
    ok(`fără schimbări manuale (${JSON.stringify(salvat).slice(0, 42)}) segmentele sunt identice`,
       JSON.stringify(probaTR5(salvat).segments) === JSON.stringify(gol.segments),
       sg(probaTR5(salvat).segments));
  }
  ok('și timpul ideal al probei e neschimbat, la bit',
     idealTimeS(8.91, probaTR5({}).segments) === idealTimeS(8.91, gol.segments));

  // PROBĂ FĂRĂ BULETIN, doar cu schimbări de mână: calea din roadbook, neatinsă
  const RB = sanitizeBoxes([
    { day: 2, leg: 1, page: 33, num: 131, sumKm: 104.51, dir: 'ÎNAINTE',
      flags: ['RT_START_AUTO'], comment: 'START RT · 15 km/h' },
    { day: 2, leg: 1, page: 34, num: 142, sumKm: 109.52, dir: 'ÎNAINTE', comment: '' },
    { day: 2, leg: 1, page: 35, num: 149, sumKm: 113.42, dir: 'ÎNAINTE',
      flags: ['RT_FINISH'], comment: 'FINISH RT' }
  ]);
  const doarManual = detectRts(RB, TR5_MANUAL)[0];
  ok('fără buletin, schimbările omului rămân singurele — ca azi',
     sg(doarManual.segments) === '0@15 5.01@30', sg(doarManual.segments));

  // și buletinul FĂRĂ schimbări oficiale: lista omului intră întreagă, nimic în plus
  const bFara = [{ ...TR5_BULETIN[0], speedChanges: [] }];
  const r = probeDinBuletin(TR5_BOX, bFara, null, TR5_MANUAL).rts[0];
  ok('buletin fără schimbări oficiale: doar cele patru ale omului',
     sg(r.segments) === '0@15 5.01@30 5.08@48.5 6.54@30 7.79@48.5', sg(r.segments));
}

console.log('\n═══ Ce nu se leagă tot se spune, nu se înghite ═══');
{
  const rt = probeDinBuletin(TR5_BOX, TR5_BULETIN, null,
    { [CHEIE_TR5]: { kmh: null, schimbari: [{ box: 142, kmh: 30 }, { box: 300, kmh: 44 }] } });
  ok('schimbarea pe un box inexistent NU se aplică',
     sg(rt.rts[0].segments) === '0@15 1.15@48.5 5.01@30', sg(rt.rts[0].segments));
  ok('…și e raportată omului, în română',
     rt.note.some(n => n.tip === 'de_mana' && /boxul 300/.test(n.text) &&
                       /nu există în roadbook/.test(n.text)),
     JSON.stringify(rt.note.map(n => n.text)));
  ok('iar schimbarea oficială rămâne în plan chiar și când cea manuală cade',
     rt.rts[0].segments.some(s => s.fromKm === 1.15 && s.kmh === 48.5));

  // planul complet, așa cum îl vede mașina de stări
  const plan = buildPlan(TR5_BOX, TR5_MANUAL, null, null, TR5_BULETIN);
  ok('planul construit poartă boxul 136 până la mașina de stări',
     plan.sursaProbe === 'buletin' && plan.rts[0].segments[1].fromKm === 1.15 &&
     plan.rts[0].segments[1].kmh === 48.5, sg(plan.rts[0].segments));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
