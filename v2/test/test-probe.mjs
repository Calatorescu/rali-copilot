// RALI 2 — PROBELE: boxul care închide una și o deschide pe următoarea.
//
// 05.08.2026, roadbook-ul REAL de la Reșița (Leg 2, cel de sâmbătă la Sibiu ca tipar),
// 14 pagini, 120 de boxuri. Scanarea a citit corect TOT: numerele, kilometrii, direcțiile,
// comentariile. Din semnele de probă a citit patru — și trei erau greșite.
//
// Ce a citit:      box 57 START · box 64 START · box 79 START · box 108 FINISH
// Ce spune BULETINUL Directorului de cursă (singura autoritate pe probe):
//                  TR2 57→64 · TR3 64→(înainte de) 66 · TR4 79→(după) 104
//                  (boxul 64 e SIMULTAN finishul lui TR2 și startul lui TR3)
//
// CORECTAT 05.08.2026, seara: până acum fișierul ăsta scria „TR4 79→97 = 5,74 km".
// E greșit — 5,74 km e doar PRIMUL SEGMENT al lui TR4, până la schimbarea de medie de
// la boxul 97 (24,3 → 20,5 km/h). Buletinul spune că TR4 se termină DUPĂ boxul 104,
// adică la 8,87 km. Referința falsă a stat aici o zi și făcea toate cifrele de mai jos
// să pară verificate.
//
// Rezultatul în aplicație, cu semnele citite greșit: o SINGURĂ probă în loc de trei —
// 62,12 → 71,51 = 9,39 km. TR2 și TR3 dispăreau cu totul, iar TR4 s-ar fi cronometrat
// pe 9,39 km în loc de 8,87. Cronometrarea e chiar partea pe care se dau punctele.
//
// CAUZA nu era promptul, era MODELUL: `flag` era un singur șir, iar boxul 64 are două
// icoane. Una dintre ele se pierdea obligatoriu, oricât de bine ar fi citit modelul.
//
// Fixturile de mai jos sunt boxurile reale (numere, kilometri, comentarii din roadbook —
// nume de străzi și de localități, fără nicio coordonată).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sanitizeBoxes, detectRts, verifyRoadbook, normFlags, areFlag,
         esteStart, esteFinish, flagPrincipal, START_FLAGS } from '../js/route.js';

const aici = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// ── Roadbook-ul de la Reșița, bucata care contează (boxurile reale) ─────────
const RESITA = sanitizeBoxes([
  { day: 2, leg: 2, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Start Leg 2 Time Control - TC 3' },
  { day: 2, leg: 2, num: 50, sumKm: 21.16, dir: 'ÎNAINTE', comment: 'Exit Municipiul Reșița, To Brebu' },
  { day: 2, leg: 2, num: 51, sumKm: 30.89, dir: 'ÎNAINTE', comment: 'Văliug 5 km, DJ 582' },
  { day: 2, leg: 2, num: 56, sumKm: 38.58, dir: 'DREAPTA-T', comment: 'To Semenic, DJ 582E' },
  { day: 2, leg: 2, num: 57, sumKm: 38.80, dir: 'ÎNAINTE', flags: ['RT_START_AUTO'], comment: 'Start RT 2, DJ 582E · 50 km/h' },
  { day: 2, leg: 2, num: 63, sumKm: 46.95, dir: 'ÎNAINTE', comment: 'DJ 582E' },
  // BOXUL 64: finishul probei 2 ȘI startul probei 3, în același punct
  { day: 2, leg: 2, num: 64, sumKm: 47.69, dir: 'ÎNAINTE', flags: ['RT_FINISH', 'RT_START_AUTO'], comment: 'Start RT 3, DJ 582E · 45 km/h' },
  { day: 2, leg: 2, num: 65, sumKm: 47.98, dir: 'ÎNAINTE', comment: 'DJ 582E' },
  { day: 2, leg: 2, num: 66, sumKm: 53.95, dir: 'DREAPTA-T', flags: ['RT_FINISH'], comment: 'To Brebu Nou, DJ 582' },
  { day: 2, leg: 2, num: 78, sumKm: 61.96, dir: 'STÂNGA', comment: '' },
  { day: 2, leg: 2, num: 79, sumKm: 62.12, dir: 'ÎNAINTE', flags: ['RT_START_STANDING'], comment: 'Start RT 4, Brown Gate with bell · 40 km/h' },
  { day: 2, leg: 2, num: 96, sumKm: 67.44, dir: 'ÎNAINTE', comment: '' },
  // boxul 97 e SCHIMBAREA DE MEDIE din TR4 (24,3 → 20,5), nu finișul lui
  { day: 2, leg: 2, num: 97, sumKm: 67.86, dir: 'DREAPTA-T', comment: '' },
  // …iar TR4 se termină DUPĂ boxul 104. Semnul de aici e cel pus de om din buletin:
  // în roadbook, boxul 104 n-are nici icoană, nici comentariu.
  { day: 2, leg: 2, num: 104, sumKm: 70.99, dir: 'ÎNAINTE', flags: ['RT_FINISH'], comment: '' },
  { day: 2, leg: 2, num: 108, sumKm: 71.51, dir: 'ÎNAINTE', comment: 'Exit Brebu Nou' },
  { day: 2, leg: 2, num: 111, sumKm: 76.59, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Finish Leg 2 Time Control - TC 4' }
]);

// …și ACELEAȘI boxuri, cu semnele exact cum le-a citit scanarea pe 05.08
const CUM_A_CITIT = sanitizeBoxes(RESITA.map(b => {
  const f = { 64: ['RT_START_AUTO'], 66: [], 104: [], 108: ['RT_FINISH'] };
  return { ...b, flags: f[b.num] !== undefined ? f[b.num] : b.flags };
}));

console.log('\n═══ Modelul: un box poate purta mai multe semne ═══');
{
  const b64 = RESITA.find(b => b.num === 64);
  ok('boxul 64 păstrează AMÂNDOUĂ semnele',
     b64.flags.length === 2 && b64.flags.includes('RT_FINISH') && b64.flags.includes('RT_START_AUTO'),
     JSON.stringify(b64.flags));
  ok('finishul e primul — el închide o probă cronometrată, deci el se vede',
     flagPrincipal(b64) === 'RT_FINISH', flagPrincipal(b64));
  ok('și e recunoscut și ca start, și ca finish',
     esteStart(b64) && esteFinish(b64));
  // migrarea din forma veche: un roadbook stocat de v35 are `flag`, un șir
  const vechi = sanitizeBoxes([{ num: 5, sumKm: 1.0, dir: 'ÎNAINTE', flag: 'RT_FINISH' }]);
  ok('un roadbook salvat de versiunea veche se migrează singur la listă',
     vechi[0].flags.length === 1 && vechi[0].flags[0] === 'RT_FINISH', JSON.stringify(vechi[0]));
  ok('iar terenul vechi rămâne sincron, pentru afișare',
     vechi[0].flag === 'RT_FINISH');
  // start din mers și start cu oprire nu pot coexista pe aceeași linie
  const amb = sanitizeBoxes([{ num: 6, sumKm: 2.0, flags: ['RT_START_AUTO', 'RT_START_STANDING'] }]);
  ok('cele două feluri de start se exclud; rămâne cel cu oprire, care e restrictiv',
     amb[0].flags.length === 1 && amb[0].flags[0] === 'RT_START_STANDING', JSON.stringify(amb[0].flags));
  ok('semnele inventate se aruncă la graniță',
     sanitizeBoxes([{ num: 7, sumKm: 3, flags: ['RT_START_AUTO', 'PLECARE_LA_MARE'] }])[0].flags.length === 1);
}

console.log('\n═══ Cele trei probe de la Reșița, împerecheate corect ═══');
{
  const rts = detectRts(RESITA);
  ok('ies exact TREI probe', rts.length === 3, JSON.stringify(rts.map(r => r.name)));
  const d = rts.map(r => `${r.startKm}→${r.finishKm}`);
  ok('TR2: 38,80 → 47,69', d[0] === '38.8→47.69', d[0]);
  ok('TR3: 47,69 → 53,95 (pornește de unde s-a terminat TR2)', d[1] === '47.69→53.95', d[1]);
  // TR4 se termină DUPĂ boxul 104, nu la 97: 97 e doar schimbarea de medie
  ok('TR4: 62,12 → 70,99', d[2] === '62.12→70.99', d[2]);
  ok('distanțele din buletin: 8,89 · 6,26 · 8,87',
     rts.map(r => r.distKm).join(' ') === '8.89 6.26 8.87', rts.map(r => r.distKm).join(' '));
  ok('proba a treia e cu plecare de pe loc, cum scrie în roadbook',
     rts[2].type === 'standing', rts[2].type);
  ok('vitezele se citesc din comentarii: 50, 45, 40',
     rts.map(r => r.kmh).join(' ') === '50 45 40', rts.map(r => r.kmh).join(' '));
  ok('boxul 64 e ȘI finishul primei probe, ȘI startul celei de-a doua',
     RESITA[rts[0].finishIdx].num === 64 && RESITA[rts[1].startIdx].num === 64,
     JSON.stringify({ f: RESITA[rts[0].finishIdx].num, s: RESITA[rts[1].startIdx].num }));
  ok('și NU se produce o probă de zero kilometri din el',
     rts.every(r => r.distKm > 0.05), JSON.stringify(rts.map(r => r.distKm)));
  const v = verifyRoadbook(RESITA);
  ok('verificatorul nu se mai plânge de probe neîmperecheate',
     !v.probleme.some(p => /START fără FINISH|FINISH de probă/.test(p)), JSON.stringify(v.probleme));
}

console.log('\n═══ Ce s-ar fi întâmplat cu semnele așa cum le-a citit scanarea ═══');
{
  // Verificarea asta descrie DEFECTUL, ca să se vadă cât de tăcut era: aplicația nu se
  // bloca, nu se plângea — pornea și cronometra o probă greșită.
  const rts = detectRts(CUM_A_CITIT);
  ok('din trei probe reale ar fi ieșit una singură — TR2 și TR3 dispăreau cu totul',
     rts.length === 1, JSON.stringify(rts.length));
  ok('iar aia se întindea de la boxul 79 la boxul 108: 9,39 km în loc de 8,87',
     rts[0].distKm === 9.39, `${rts[0].distKm} km`);
  // …dar verificatorul, care se citește ÎNAINTE de start, o spune acum pe față
  const v = verifyRoadbook(CUM_A_CITIT);
  ok('verificatorul semnalează cele două probe rămase deschise',
     v.probleme.some(p => /2 probă\/e cu START fără FINISH/.test(p)), JSON.stringify(v.probleme));
}

console.log('\n═══ Corectura manuală: aceleași date, reparate din trei apăsări ═══');
{
  // exact ce face butonul din panoul de pregătire (vezi comutaFlag din main.js)
  const comuta = (boxes, num, flag) => sanitizeBoxes(boxes.map(b => {
    if (b.num !== num) return b;
    const f = normFlags(b);
    return { ...b, flags: f.includes(flag) ? f.filter(x => x !== flag) : [...f, flag] };
  }));
  let b = CUM_A_CITIT;
  b = comuta(b, 64, 'RT_FINISH');     // finish ratat
  b = comuta(b, 66, 'RT_FINISH');     // finish ratat
  b = comuta(b, 104, 'RT_FINISH');    // finishul lui TR4, pus din buletin
  b = comuta(b, 108, 'RT_FINISH');    // finish inventat — se scoate
  const rts = detectRts(b);
  ok('după corectură ies exact cele trei probe reale',
     rts.length === 3 && rts.map(r => r.distKm).join(' ') === '8.89 6.26 8.87',
     JSON.stringify(rts.map(r => r.name + ' ' + r.distKm)));
  ok('boxul 108 nu mai are niciun semn', normFlags(b.find(x => x.num === 108)).length === 0);
  ok('iar boxul 64 le are pe amândouă', normFlags(b.find(x => x.num === 64)).length === 2);
  ok('și verificatorul e curat pe capitolul probe',
     !verifyRoadbook(b).probleme.some(p => /START fără FINISH/.test(p)));
}

console.log('\n═══ Saltul de kilometraj nu mai strigă „pagină lipsă" degeaba ═══');
{
  // Măsurat pe roadbook-ul real: între boxurile 50 și 51 sunt 9,73 km, fiindcă e drum de
  // munte pe DJ 582 spre Văliug, fără nicio manevră de descris. Numerele de box sunt
  // consecutive, iar totalul (120) se potrivea exact cu referința — deci nu lipsea nimic.
  // Fixtura de mai sus e o FELIE din roadbook (doar boxurile care contează pentru probe),
  // deci numerele ei sar peste tot și verificatorul are dreptate să se plângă. Perechea
  // 50→51 e însă consecutivă, exact ca în roadbook-ul întreg — și doar ea se verifică.
  const v = verifyRoadbook(RESITA);
  ok('salt de 9,73 km între boxurile CONSECUTIVE 50 și 51: nicio alarmă de pagină lipsă',
     !v.probleme.some(p => /pagină lipsă/.test(p) && /boxurile 50 și 51/.test(p)),
     JSON.stringify(v.probleme.filter(p => /50 și 51/.test(p))));
  ok('și nici măcar nota de tronson lung, fiindcă 9,73 km e sub 15',
     !v.probleme.some(p => /tronson lung/.test(p)), JSON.stringify(v.probleme));
  // aceeași pereche, izolată, ca dovada să nu depindă de restul feliei
  const pereche = sanitizeBoxes([
    { day: 2, leg: 2, num: 50, sumKm: 21.16, dir: 'ÎNAINTE', comment: 'Exit Municipiul Reșița' },
    { day: 2, leg: 2, num: 51, sumKm: 30.89, dir: 'ÎNAINTE', comment: 'Văliug 5 km, DJ 582' }
  ]);
  ok('luată singură, perechea reală nu produce nicio problemă de kilometraj',
     !verifyRoadbook(pereche).probleme.some(p => /pagină lipsă|tronson lung/.test(p)),
     JSON.stringify(verifyRoadbook(pereche).probleme));
  // …dar dacă numerele SAR, atunci chiar lipsește ceva și se spune
  const gaura = sanitizeBoxes([
    { day: 1, leg: 1, num: 10, sumKm: 1.0, dir: 'DREAPTA' },
    { day: 1, leg: 1, num: 14, sumKm: 12.0, dir: 'STÂNGA' }
  ]);
  const vg = verifyRoadbook(gaura);
  ok('salt de km + gaură în numerotare = pagină lipsă, spus pe față',
     vg.probleme.some(p => /pagină lipsă/.test(p)), JSON.stringify(vg.probleme));
  // un tronson foarte lung rămâne o notă, fiindcă e o informație utilă pentru pilot
  const lung = sanitizeBoxes([
    { day: 1, leg: 1, num: 10, sumKm: 1.0, dir: 'DREAPTA' },
    { day: 1, leg: 1, num: 11, sumKm: 30.0, dir: 'STÂNGA' }
  ]);
  const vl = verifyRoadbook(lung);
  ok('peste 15 km, boxuri consecutive: „tronson lung, verifică", nu „pagină lipsă"',
     vl.probleme.some(p => /tronson lung de 29\.0 km/.test(p)) &&
     !vl.probleme.some(p => /pagină lipsă/.test(p)), JSON.stringify(vl.probleme));
}

console.log('\n═══ Editorul manual: contractul lui cu pagina și cu jurnalul ═══');
{
  // Partea care contează cel mai mult mâine. Nu se testează apăsarea butonului (aia se
  // vede), ci că uneltele EXISTĂ și că fiecare corectură lasă urmă: fără jurnal, o
  // corecție greșită la 6 dimineața nu s-ar mai putea reconstitui seara.
  const html = readFileSync(join(aici, '..', 'index.html'), 'utf8');
  const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
  const scan = readFileSync(join(aici, '..', 'js', 'scan.js'), 'utf8');
  ok('cardul de probe din panoul de pregătire', /id="prep-probe"/.test(html));
  ok('și rezumatul probelor deasupra lui', /id="probe-rezumat"/.test(html));
  ok('căutare după număr — finish-urile ratate n-au niciun semn, deci nu apar singure în listă',
     /id="probe-cauta"/.test(html) && /id="btn-probe-cauta"/.test(html));
  ok('trei semne comutabile pe orice box: două feluri de start și finish',
     /START din mers/.test(main) && /START oprit/.test(main) && /FINISH'/.test(main));
  ok('viteza se setează pe boxul de start, cu aceeași cheie pe care o folosește detectRts',
     /function cheieViteza/.test(main) && /rt_speeds/.test(main));
  ok('fiecare schimbare intră în jurnal, cu starea de dinainte și de după',
     /flag_manual/.test(main) && /inainte, dupa/.test(main));
  ok('se salvează în depozit, nu doar pe ecran',
     /store\.put\('plan_raw', boxesRaw\)/.test(main));
  ok('și planul se reconstruiește, deci verificatorul se rerulează singur',
     /await rebuildPlan\(\);\n\}/.test(main) || /_probeExtra\.add[\s\S]{0,400}rebuildPlan/.test(main));
  ok('comentariul boxului se pune cu textContent — vine dintr-un document extern',
     /com\.textContent = b\.comment/.test(main), 'comentariul ar putea fi randat ca HTML');
  ok('promptul de scanare cere acum o LISTĂ de semne', /"flags" \(LISTĂ\)/.test(scan));
  ok('și insistă pe liniile de finish, cele ratate la Reșița',
     /CAUTĂ EXPLICIT LINIILE DE FINISH/.test(scan));
  ok('cu exemplul boxului care are două icoane, chiar în formatul cerut',
     /"flags":\["RT_FINISH","RT_START_AUTO"\]/.test(scan));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
