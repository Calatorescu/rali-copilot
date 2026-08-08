// RALI 2 — CITIREA SEMNELOR DIN ROADBOOK (v39, 06.08.2026).
//
// Ce s-a stricat și de ce s-a putut repara abia acum. Până azi promptul de scanare era
// „intangibil": nu exista niciun document cu adevăr cunoscut pe care să se măsoare o
// schimbare, deci orice atingere era un pariu. Acum există două:
//
//  1. paginile generate de `scripts/ruta-in-roadbook.py` (Gramma → intrare A1, 18 boxuri,
//     2 pagini) — icoanele sunt DESENATE de noi, deci se știe la virgulă ce e pe hârtie:
//     UN SINGUR finiș adevărat (boxul 9), plus PATRU dreptunghiuri care NU sunt finiș
//     (5 și 17 panouri de direcție, 6 ieșire din localitate, 16 intrare în localitate);
//  2. roadbook-ul OFICIAL de la Reșița, 120 de boxuri, scanat pe 05.08 — starturi la 57,
//     64, 79; TC la 1 și 111; NICIUN finiș de probă marcat în roadbook.
//
// CE ERA GREȘIT ÎN PROMPT, verificat pe pagini:
//  · spunea `dreptunghi/tabelă="RT_FINISH"`. Fals. Dreptunghiurile sunt semne de DRUM
//    (intrare/ieșire din localitate, panou de direcție). La Reșița stăteau pe boxurile
//    44, 45, 49, 51, 53, 55, 68, 70, 73, 75 și 108 — toate declarate finișuri.
//  · dădea drept exemple de comentarii „ratabile" chiar „To Brebu Nou" și „Exit Văliug",
//    adică EXACT textul de pe plăcuțele de localitate: promptul amorsa greșeala.
//  · icoana adevărată de cronometrare e o pereche de două cercuri (steguleț + ceas).
//
// TENSIUNEA, rezolvată în cod: la Reșița boxul 1 („Start Leg 2 / Time Control - TC 3")
// și boxul 57 („Start RT 2") au ACEEAȘI pereche de cercuri. Icoana singură nu le
// deosebește, iar promptul interzice — pe bună dreptate — citirea semnului din cuvinte.
// Deci modelul raportează percepția curată („TIMING"), iar judecata TC-vs-start stă în
// `rezolvaTiming`, cod determinist, testat mai jos fără nicio cheie de API.
//
// CE MĂSOARĂ FIȘIERUL ĂSTA: partea deterministă — traducerea percepției în semne,
// nerergresia pe roadbook-ul real deja salvat pe telefon, curățenia automată când
// probele vin din buletin, textele noi.
// CE NU POATE MĂSURA: dacă modelul de Vision chiar VEDE perechea de cercuri și chiar
// lasă dreptunghiurile în pace. Aia se vede doar rescanând paginile de mai sus.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sanitizeBoxes, sanitizeBuletin, buildPlan, normFlags, rezolvaTiming,
         esteStart, esteFinish, areFlag, detectRts, verifyRoadbook,
         propuneCorecturiProbe, aplicaPropuneri,
         frazaSemneCuratate } from '../js/route.js';

const aici = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const nums = list => list.map(b => b.num).join(',');
const semne = b => normFlags(b).join('+');

console.log('\n═══ rezolvaTiming: judecata mutată din poză în cod ═══');
{
  ok('„Start Leg 2 / Time Control - TC 3" → Time Control, nu start de probă',
     rezolvaTiming('TIMING', 'Start Leg 2 / Time Control - TC 3 / Piața 1 Decembrie 1918') === 'TC',
     rezolvaTiming('TIMING', 'Start Leg 2 / Time Control - TC 3'));
  ok('„Finish Leg 2 Time Control - TC 4" → tot Time Control',
     rezolvaTiming('TIMING', 'Finish Leg 2 Time Control - TC 4') === 'TC');
  ok('„TC 4, Gărâna" — fără cuvintele „time control" — tot Time Control',
     rezolvaTiming('TIMING', 'TC 4, Gărâna') === 'TC');
  ok('„Start RT 2, DJ 582E" → start de probă din mers',
     rezolvaTiming('TIMING', 'Start RT 2, DJ 582E') === 'RT_START_AUTO');
  ok('„Start TR 1 Str. Bartók Béla" → tot start de probă (TR și RT sunt același lucru)',
     rezolvaTiming('TIMING', 'Start TR 1 Str. Bartók Béla DJ 691') === 'RT_START_AUTO');
  ok('aceeași frază, dar cu fulg lângă cercuri → start DE PE LOC',
     rezolvaTiming('TIMING_STANDING', 'Start TR 1 Str. Bartók Béla DJ 691') === 'RT_START_STANDING');
  // PRUDENȚA, scrisă pe față: un TC luat drept probă pornește o cronometrare care nu
  // există și strică tot legul. O probă luată drept TC se repară dintr-o apăsare.
  ok('cercuri fără niciun cuvânt lămuritor → TC, varianta prudentă',
     rezolvaTiming('TIMING', 'DJ 582') === 'TC');
  ok('și pe comentariu gol, la fel', rezolvaTiming('TIMING', '') === 'TC' &&
     rezolvaTiming('TIMING', null) === 'TC');
  // fulgul E o informație măsurată: pe paginile de la Reșița a apărut doar pe startul
  // lui TR4 (boxul 79), niciodată pe un Time Control
  ok('fulgul fără cuvinte rămâne start de pe loc — el nu apare niciodată pe un TC',
     rezolvaTiming('TIMING_STANDING', '') === 'RT_START_STANDING');
  ok('dar dacă textul zice „Time Control", TC bate fulgul',
     rezolvaTiming('TIMING_STANDING', 'Time Control - TC 5') === 'TC');
  ok('„restart rt 9" nu e un start de probă → rămâne TC',
     rezolvaTiming('TIMING', 'restart rt 9') === 'TC');
  ok('tolerant la diacritice, majuscule și punctuație',
     rezolvaTiming('TIMING', 'START  rt.7 — Gărâna') === 'RT_START_AUTO');
}

console.log('\n═══ Traducerea se face O SINGURĂ DATĂ, la intrarea în aplicație ═══');
{
  const b = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TIMING'], comment: 'Start Leg 1 Time Control - TC 1' },
    { num: 7, sumKm: 2.12, dir: 'ÎNAINTE', flags: ['TIMING_STANDING'], comment: 'Start TR 1' },
    { num: 9, sumKm: 4.28, dir: 'ÎNAINTE', flags: ['RT_FINISH', 'TIMING'], comment: 'Start TR 2' }
  ]);
  ok('„TIMING" pe un Time Control devine TC', semne(b[0]) === 'TC', semne(b[0]));
  ok('„TIMING_STANDING" pe un start devine START oprit',
     semne(b[1]) === 'RT_START_STANDING', semne(b[1]));
  ok('boxul cu două icoane păstrează amândouă semnele, în ordinea de afișare',
     semne(b[2]) === 'RT_FINISH+RT_START_AUTO', semne(b[2]));
  ok('nimic intermediar nu ajunge să fie stocat: „TIMING" nu supraviețuiește sitei',
     !JSON.stringify(b).includes('TIMING'), JSON.stringify(b.map(x => x.flags)));
  ok('terenul derivat `flag` rămâne sincron cu lista',
     b.every(x => x.flag === (x.flags.length ? x.flags[0] : null)));
  ok('a doua trecere prin sită nu mai schimbă nimic — traducerea e stabilă',
     JSON.stringify(sanitizeBoxes(b).map(x => x.flags)) === JSON.stringify(b.map(x => x.flags)));
  // un flag inventat de model nu trece granița de încredere
  const gunoi = sanitizeBoxes([{ num: 1, sumKm: 0, flags: ['TIMING_X', 'ȘTERGE_TOT'], comment: 'Start RT 1' }]);
  ok('un semn necunoscut se aruncă, nu se ghicește', semne(gunoi[0]) === '', semne(gunoi[0]));
}

// ── ROADBOOK-UL OFICIAL DE LA REȘIȚA, EXACT CUM E SALVAT PE TELEFON ─────────
// `plan_raw` din jurnalul zilei de 05.08.2026 (boxurile cu semne + cele pe care le cere
// buletinul). Forma e cea produsă de v38 — semne deja traduse, fără „TIMING". Testul de
// mai jos e cel care contează pentru mâine: un roadbook scanat ieri trebuie să se
// citească AZI la fel, altfel Andreas rescanează 14 pagini în parcare.
const RESITA_V38 = [
  { num: 1, sumKm: 0.00, dir: "ÎNAINTE", flags: ["RT_FINISH","TC"], comment: "Start Leg 2 / Time Control - TC 3 / Piața 1 Decembrie 1918" },
  { num: 10, sumKm: 2.71, dir: "DREAPTA", flags: ["EV"], comment: "" },
  { num: 11, sumKm: 2.84, dir: "ÎNAINTE", flags: ["PARKING"], comment: "Muzeu CFR" },
  { num: 12, sumKm: 2.94, dir: "ÎNAINTE", flags: ["PARKING"], comment: "DN 58B" },
  { num: 27, sumKm: 6.83, dir: "GIRATORIU-1", flags: ["PARKING"], comment: "Hotel Rogge - Str. Ion Luca Caragiale" },
  { num: 28, sumKm: 7.02, dir: "ÎNAINTE", flags: ["TC"], comment: "Str. Ion Luca Caragiale / DN 58" },
  { num: 29, sumKm: 7.14, dir: "ÎNAINTE", flags: ["TC"], comment: "Str. Ion Luca Caragiale / DN 58" },
  { num: 33, sumKm: 8.04, dir: "ÎNAINTE", flags: ["TC"], comment: "Str. Libertății / DJ 582" },
  { num: 35, sumKm: 8.23, dir: "ÎNAINTE", flags: ["TC"], comment: "DJ 582" },
  { num: 44, sumKm: 11.27, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "To Semenic, Trei Ape, Văliug" },
  { num: 45, sumKm: 11.38, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "To Văliug" },
  { num: 49, sumKm: 13.30, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "To Semenic, Trei Ape, Văliug, DJ 582" },
  { num: 51, sumKm: 23.40, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Văliug 5 km, DJ 582" },
  { num: 53, sumKm: 30.62, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "To Slatina-Timiș, DJ 582" },
  { num: 55, sumKm: 30.89, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Exit Văliug, DJ 582" },
  { num: 57, sumKm: 38.80, dir: "ÎNAINTE", flags: ["RT_START_AUTO"], comment: "Start RT 2, DJ 582E" },
  { num: 64, sumKm: 47.69, dir: "ÎNAINTE", flags: ["RT_START_AUTO"], comment: "Start RT 3 / DJ 582E" },
  { num: 66, sumKm: 53.95, dir: "DREAPTA-T", flags: [], comment: "To Brebu Nou / DJ 582" },
  { num: 68, sumKm: 56.24, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Welcome Gărâna / DJ 582" },
  { num: 70, sumKm: 56.86, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Enter Gărâna / DJ 582" },
  { num: 73, sumKm: 57.61, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Exit Gârana, DJ 582" },
  { num: 75, sumKm: 61.60, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Enter Brebu Nou, DJ 582" },
  { num: 79, sumKm: 62.12, dir: "ÎNAINTE", flags: ["RT_START_STANDING"], comment: "Start RT 4, Brown Gate with bell" },
  { num: 82, sumKm: 63.46, dir: "DREAPTA", flags: ["EV"], comment: "EV Charging Station" },
  { num: 88, sumKm: 65.12, dir: "STÂNGA", flags: ["EV"], comment: "EV Charging Station" },
  { num: 91, sumKm: 65.95, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Căminul Cultural" },
  { num: 93, sumKm: 66.49, dir: "ÎNAINTE", flags: ["EV"], comment: "EV Charging Station" },
  { num: 97, sumKm: 67.86, dir: "DREAPTA-T", flags: [], comment: "" },
  { num: 99, sumKm: 68.53, dir: "ÎNAINTE", flags: ["EV"], comment: "EV Charging Station" },
  { num: 104, sumKm: 70.99, dir: "ÎNAINTE", flags: [], comment: "" },
  { num: 105, sumKm: 71.15, dir: "ÎNAINTE", flags: [], comment: "" },
  { num: 108, sumKm: 71.51, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Exit Brebu Nou" },
  { num: 111, sumKm: 76.59, dir: "ÎNAINTE", flags: ["RT_FINISH","TC"], comment: "Finish Leg 2 Time Control - TC 4" },
  { num: 113, sumKm: 77.28, dir: "ÎNAINTE", flags: ["EV"], comment: "Căminul Cultural EV Charging Station" },
  { num: 118, sumKm: 79.61, dir: "ÎNAINTE", flags: ["PARKING"], comment: "Park on the right side" },
  { num: 119, sumKm: 79.66, dir: "ÎNAINTE", flags: ["PARKING"], comment: "Park on the right side" },
  { num: 120, sumKm: 79.72, dir: "ÎNAINTE", flags: ["PARKING"], comment: "Casa Gotschna - Use Voucher" }
];

console.log('\n═══ Ne-regresie: roadbook-ul de ieri se citește azi la fel ═══');
{
  const dupa = sanitizeBoxes(RESITA_V38);
  const inainte = RESITA_V38.map(b => b.flags.join('+')).join(' | ');
  const acum = dupa.map(b => normFlags(b).join('+')).join(' | ');
  ok('toate cele 37 de boxuri salvate de v38 ies cu EXACT aceleași semne',
     acum === inainte, `\n      v38: ${inainte}\n      v39: ${acum}`);
  ok('inclusiv boxurile 1 și 111, care poartă și TC, și un finiș citit greșit',
     semne(dupa.find(b => b.num === 1)) === 'RT_FINISH+TC' &&
     semne(dupa.find(b => b.num === 111)) === 'RT_FINISH+TC');
  ok('startul de pe loc de la boxul 79 rămâne de pe loc',
     semne(dupa.find(b => b.num === 79)) === 'RT_START_STANDING');
  ok('parcările și stațiile de încărcare rămân neatinse',
     nums(dupa.filter(b => areFlag(b, 'PARKING'))) === '11,12,27,118,119,120' &&
     dupa.filter(b => areFlag(b, 'EV')).length === 6);
  ok('și forma VECHE, cu `flag` un singur șir, se citește tot la fel',
     semne(sanitizeBoxes([{ num: 57, sumKm: 38.8, flag: 'RT_START_AUTO',
                            comment: 'Start RT 2' }])[0]) === 'RT_START_AUTO');
}

console.log('\n═══ Reșița, dacă s-ar rescana cu promptul v39 ═══');
{
  // Ce ar trebui să vadă modelul pe paginile OFICIALE, dacă descrierea nouă a icoanelor
  // e corectă: perechea de cercuri exact la 1, 57, 64, 79 și 111; dreptunghiurile de
  // localitate — 44, 45, 49, 51, 53, 55, 68, 70, 73, 75, 108 — fără niciun semn.
  const V39 = sanitizeBoxes(RESITA_V38.map(b => {
    const cerc = { 1: ['TIMING'], 57: ['TIMING'], 64: ['TIMING'],
                   79: ['TIMING_STANDING'], 111: ['TIMING'] };
    const dreptunghi = new Set([44, 45, 49, 51, 53, 55, 68, 70, 73, 75, 108]);
    const alte = b.flags.filter(f => f === 'PARKING' || f === 'EV');
    return { ...b, flags: cerc[b.num] ? cerc[b.num].concat(alte)
                       : dreptunghi.has(b.num) ? alte : alte };
  }));
  ok('boxurile 1 și 111 ies Time Control, nu starturi de probă',
     semne(V39.find(b => b.num === 1)) === 'TC' &&
     semne(V39.find(b => b.num === 111)) === 'TC',
     semne(V39.find(b => b.num === 1)) + ' / ' + semne(V39.find(b => b.num === 111)));
  ok('boxurile 57, 64 și 79 ies starturi de probă',
     nums(V39.filter(b => esteStart(b))) === '57,64,79',
     nums(V39.filter(b => esteStart(b))));
  ok('boxul 79 e „de pe loc", cum îl dă și buletinul (TR 4, standing)',
     semne(V39.find(b => b.num === 79)) === 'RT_START_STANDING');
  ok('ZERO finișuri false: cele 11 plăcuțe de localitate nu mai produc niciun semn',
     nums(V39.filter(b => esteFinish(b))) === '', nums(V39.filter(b => esteFinish(b))));
  ok('și deci ZERO propuneri de corectat în parcare, față de 12 la scanarea din 05.08',
     propuneCorecturiProbe(V39).length === 0,
     JSON.stringify(propuneCorecturiProbe(V39).map(x => x.box.num + ':' + x.flag)));
  // roadbook-ul oficial nu marchează niciun finiș — probele vin din buletin
  ok('nicio probă nu iese din semnele roadbook-ului, fiindcă niciun finiș nu le închide',
     detectRts(V39).length === 0, `${detectRts(V39).length}`);
}

console.log('\n═══ Paginile generate azi (Gramma → A1): adevăr cunoscut la virgulă ═══');
{
  // Ce a desenat generatorul, box cu box. Icoanele sunt în `scripts/ruta-in-roadbook.py`:
  //   box 1  — pereche de cercuri + P + fulger, text „Time Control - TC 1"
  //   box 5  — dreptunghi PLIN, în picioare = panou de direcție („Giarmata")
  //   box 6  — dreptunghi cu bară oblică = ieșire din localitate („Exit Dumbrăvița")
  //   box 7  — pereche de cercuri + fulg, text „Start TR 1"
  //   box 9  — TABELĂ CULCATĂ cu bară groasă (singurul finiș adevărat) + pereche cercuri
  //   box 16 — dreptunghi GOL = intrare în localitate („Enter Giarmata")
  //   box 17 — dreptunghi PLIN = panou de direcție („A1 Lugoj - Deva")
  const VAZUT_CORECT = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TIMING', 'PARKING', 'EV'], comment: 'Start Leg 1 Time Control - TC 1 Str. Gramma' },
    { num: 4, sumKm: 1.51, dir: 'STÂNGA', flags: [], comment: 'Str. József Attila' },
    { num: 5, sumKm: 1.70, dir: 'DREAPTA', flags: [], comment: 'Giarmata Str. Petőfi Sándor DJ 691' },
    { num: 6, sumKm: 2.05, dir: 'ÎNAINTE', flags: [], comment: 'Exit Dumbrăvița DJ 691' },
    { num: 7, sumKm: 2.12, dir: 'ÎNAINTE', flags: ['TIMING_STANDING'], comment: 'Start TR 1 Str. Bartók Béla DJ 691' },
    { num: 9, sumKm: 4.28, dir: 'ÎNAINTE', flags: ['RT_FINISH', 'TIMING'], comment: 'Start TR 2 DJ 691' },
    { num: 16, sumKm: 9.30, dir: 'ÎNAINTE', flags: [], comment: 'Enter Giarmata DJ 691' },
    { num: 17, sumKm: 9.40, dir: 'DREAPTA', flags: [], comment: 'A1 Lugoj - Deva' },
    { num: 18, sumKm: 10.06, dir: 'ÎNAINTE', flags: [], comment: 'Intrare A1 - spre Lugoj, Deva' }
  ]);
  // GREȘEALA 1 din 05.08: boxul 1 a fost citit ca start de probă.
  ok('boxul 1 iese Time Control — greșeala „Time Control citit ca start" nu mai e posibilă',
     semne(VAZUT_CORECT[0]).startsWith('TC'), semne(VAZUT_CORECT[0]));
  ok('și își păstrează parcarea și încărcarea de pe același box',
     semne(VAZUT_CORECT[0]) === 'TC+PARKING+EV', semne(VAZUT_CORECT[0]));
  // GREȘEALA 2 din 05.08: boxul 5 („Giarmata", panou de direcție) citit ca finiș.
  ok('boxul 5 („Giarmata") nu mai e finiș — e un panou de direcție',
     !esteFinish(VAZUT_CORECT.find(b => b.num === 5)));
  ok('nici boxurile 6, 16, 17 — cele patru dreptunghiuri rămân dreptunghiuri',
     [5, 6, 16, 17].every(n => normFlags(VAZUT_CORECT.find(b => b.num === n)).length === 0));
  ok('SINGURUL finiș rămâne boxul 9, cel cu tabela culcată',
     nums(VAZUT_CORECT.filter(b => esteFinish(b))) === '9',
     nums(VAZUT_CORECT.filter(b => esteFinish(b))));
  ok('starturile declarate în text, 7 și 9, ies amândouă starturi de probă',
     nums(VAZUT_CORECT.filter(b => esteStart(b))) === '7,9',
     nums(VAZUT_CORECT.filter(b => esteStart(b))));
  ok('boxul 7 e start de pe loc (fulgul de lângă cercuri)',
     semne(VAZUT_CORECT.find(b => b.num === 7)) === 'RT_START_STANDING');
  ok('boxul 9 închide proba 1 și o pornește pe a doua, din același box',
     semne(VAZUT_CORECT.find(b => b.num === 9)) === 'RT_FINISH+RT_START_AUTO');
  ok('iese exact O probă completă: 7 → 9, 2,16 km',
     detectRts(VAZUT_CORECT).length === 1 &&
     Math.abs(detectRts(VAZUT_CORECT)[0].distKm - 2.16) < 0.005,
     JSON.stringify(detectRts(VAZUT_CORECT).map(r => r.distKm)));
  ok('ZERO corecturi de făcut în parcare — ținta cerută pentru documentul ăsta',
     propuneCorecturiProbe(VAZUT_CORECT).length === 0,
     JSON.stringify(propuneCorecturiProbe(VAZUT_CORECT).map(x => x.box.num + ':' + x.flag)));

  // Aceleași pagini, citite cum le-a citit v38 (măsurat 06.08): boxul 1 luat ca start,
  // boxul 5 luat ca finiș. Se păstrează ca martor — dacă cifrele de aici se schimbă,
  // înseamnă că testul de mai sus a devenit tautologic.
  const VAZUT_V38 = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['RT_START_AUTO', 'PARKING', 'EV'], comment: 'Start Leg 1 Time Control - TC 1 Str. Gramma' },
    { num: 5, sumKm: 1.70, dir: 'DREAPTA', flags: ['RT_FINISH'], comment: 'Giarmata Str. Petőfi Sándor DJ 691' },
    { num: 7, sumKm: 2.12, dir: 'ÎNAINTE', flags: ['RT_START_STANDING'], comment: 'Start TR 1 Str. Bartók Béla DJ 691' },
    { num: 9, sumKm: 4.28, dir: 'ÎNAINTE', flags: ['RT_FINISH', 'RT_START_AUTO'], comment: 'Start TR 2 DJ 691' }
  ]);
  ok('martorul: citirea v38 producea DOUĂ greșeli, la boxurile 1 și 5',
     esteStart(VAZUT_V38.find(b => b.num === 1)) &&
     esteFinish(VAZUT_V38.find(b => b.num === 5)));
  ok('și o probă falsă de 1,70 km, de la boxul 1 la boxul 5',
     detectRts(VAZUT_V38).length === 2 && detectRts(VAZUT_V38)[0].distKm === 1.70,
     JSON.stringify(detectRts(VAZUT_V38).map(r => r.distKm)));
}

console.log('\n═══ Promptul: ce spune acum și ce a încetat să spună ═══');
{
  const scan = readFileSync(join(aici, '..', 'js', 'scan.js'), 'utf8');
  const prompt = /const ROADBOOK_PROMPT = `[\s\S]*?`;/.exec(scan)[0];
  ok('NU mai spune că un dreptunghi e finiș — afirmația falsă care a produs 11 finișuri',
     !/dreptunghi\/tabelă="RT_FINISH"/.test(prompt));
  ok('descrie perechea de două cercuri, cu steguleț și ceas',
     /DOUĂ CERCURI ALĂTURATE/.test(prompt) && /CEAS/.test(prompt) && /"TIMING"/.test(prompt));
  ok('și fulgul, ca al doilea semn de cronometrare',
     /FULG DE NEA/.test(prompt) && /"TIMING_STANDING"/.test(prompt));
  ok('descrie finișul prin formă: tabelă CULCATĂ, cu bară groasă, pe stâlp',
     /TABELĂ CULCATĂ/.test(prompt) && /mai LAT decât înalt/.test(prompt) &&
     /bară groasă/.test(prompt));
  ok('spune pe față că dreptunghiurile în picioare sunt semne de DRUM',
     /DREPTUNGHIURILE ÎN PICIOARE/.test(prompt) && /NU produc niciun flag/.test(prompt) &&
     /BARĂ OBLICĂ/.test(prompt) && /panou de direcție/.test(prompt));
  ok('NU mai dă „To Brebu Nou" / „Exit Văliug" ca exemple de comentarii de finiș — ' +
     'exemplul care amorsa greșeala',
     !/To Brebu Nou/.test(prompt) && !/Exit Văliug/.test(prompt));
  ok('preferă un finiș lipsă unuia inventat, și spune de ce',
     /Mai bine un finish lipsă decât unul inventat/.test(prompt));
  ok('enumeră icoanele neutre, ca să nu fie confundate cu semne de cursă',
     /NEUTRE, fără flag/.test(prompt) && /cedează trecerea/.test(prompt) &&
     /giratoriu semnalizat/.test(prompt) && /conifere/.test(prompt));
  ok('nu mai cere modelului să deosebească TC de start — perechea e „TIMING" în ambele cazuri',
     /aplicația hotărăște singură, din text, care e care/.test(prompt) &&
     !/semnul e "TC" chiar dacă textul/.test(prompt));
  ok('și păstrează regula veche: semnul se citește din icoană, nu din cuvinte',
     /FLAG-UL SE CITEȘTE DOAR DIN ICOANĂ/.test(prompt));
  ok('P și fulgerul rămân semne (parcare și încărcare) — nu cronometrează nimic, ' +
     'dar aplicația le folosește',
     /"PARKING"/.test(prompt) && /"EV"/.test(prompt));
  ok('exemplul de JSON e în formatul nou, cu TIMING',
     /"flags":\["TIMING"\]/.test(prompt) && /"flags":\["RT_FINISH","TIMING"\]/.test(prompt));
  ok('judecata TC-vs-start e trimisă explicit în cod, unde se poate testa',
     /rezolvaTiming/.test(scan));
}

console.log('\n═══ Când probele vin din buletin: nimic de decis, deci nimic de întrebat ═══');
{
  const murdar = sanitizeBoxes(RESITA_V38);
  const cuBuletin = verifyRoadbook(murdar, { probeleVinDinBuletin: true });
  const fara = verifyRoadbook(murdar);
  ok('fără buletin, verificatorul urlă despre semnele de probă',
     fara.probleme.some(p => /FINISH de probă/.test(p)),
     JSON.stringify(fara.probleme.slice(0, 3)));
  ok('cu probele din buletin, avertismentele despre semne tac',
     !cuBuletin.probleme.some(p => /FINISH de probă|START fără FINISH|NICIO probă|nu e TC\/parcare/.test(p)),
     JSON.stringify(cuBuletin.probleme));
  ok('și tac MAI MULTE decât înainte: lista scade, nu crește',
     cuBuletin.probleme.length < fara.probleme.length,
     `${cuBuletin.probleme.length} vs ${fara.probleme.length}`);
  // ce NU se stinge: verificările care chiar cer o faptă
  const rupt = sanitizeBoxes([
    { num: 1, sumKm: 0.0, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Time Control - TC 1' },
    { num: 2, sumKm: 0.5, dir: 'DREAPTA', flags: [], comment: 'Str. Turda' },
    { num: 9, sumKm: 40.0, dir: 'ÎNAINTE', flags: [], comment: 'DJ 582' }
  ]);
  const v = verifyRoadbook(rupt, { probeleVinDinBuletin: true });
  ok('gaura din numerotare rămâne aprinsă — aia chiar înseamnă pagini lipsă',
     v.probleme.some(p => /lipsesc boxurile 3–8/.test(p)), JSON.stringify(v.probleme));
  ok('și saltul de kilometraj, la fel',
     v.probleme.some(p => /salt de 39,5|salt de 39\.5/.test(p.replace(',', '.'))),
     JSON.stringify(v.probleme));
  ok('implicit, fără opțiune, verificatorul se poartă exact ca în v38',
     JSON.stringify(verifyRoadbook(murdar).probleme) ===
     JSON.stringify(verifyRoadbook(murdar, {}).probleme));
}

console.log('\n═══ DOVADA: curățenia nu atinge nimic din ce cronometrează ═══');
{
  // Cel mai important test din fișier. Curățenia automată e singurul loc din aplicație
  // unde ceva se aplică FĂRĂ ca omul să apese, iar justificarea e una singură: nu se
  // atinge nimic din ce decide rezultatul cursei. Aici se măsoară exact asta — probele
  // (start, finiș, distanță, medie, schimbări de medie) înainte și după curățenie.
  //
  // Probele din Buletinul nr. 2 al Directorului de cursă, Reșița, leg 2.
  const BULETIN = sanitizeBuletin([
    { name: 'TR 2', startBox: 57, finishBox: 64, startType: 'standing', kmh: 44.8, speedChanges: [], finishRel: 'at' },
    { name: 'TR 3', startBox: 64, finishBox: 66, startType: 'auto', kmh: 34.6, speedChanges: [], finishRel: 'before' },
    { name: 'TR 4', startBox: 79, finishBox: 104, startType: 'standing', kmh: 24.3,
      speedChanges: [{ kmh: 20.5, box: 97, place: null }], finishRel: 'after' }
  ]);
  const murdar = sanitizeBoxes(RESITA_V38);
  const inainte = buildPlan(murdar, {}, null, null, BULETIN);
  ok('pornim din starea reală: probele vin din BULETIN, nu din semnele roadbook-ului',
     inainte.sursaProbe === 'buletin' && inainte.rts.length === 3,
     `${inainte.sursaProbe} / ${inainte.rts.length}`);

  // Bucla exact ca în main.js → curataSemneleCareNuDecid + rebuildPlan: se propun
  // corecturi, se aplică toate, se reface planul, se reia.
  let curat = murdar, runde = 0, scoase = 0, adaugate = 0;
  while (runde < 10) {
    const props = propuneCorecturiProbe(curat);
    if (!props.length) break;
    runde++;
    scoase += props.filter(x => x.actiune === 'scoate').length;
    adaugate += props.filter(x => x.actiune === 'adauga').length;
    curat = aplicaPropuneri(curat, props);
  }
  ok('curățenia se termină din PRIMA rundă — nu oscilează, deci nu poate îngheța ecranul',
     runde === 1, `${runde} runde`);
  ok('11 semne scoase, 0 puse — exact plăcuțele de localitate și TC-urile citite ca finiș',
     scoase === 11 && adaugate === 0, `${scoase} scoase / ${adaugate} puse`);
  ok('și rămâne sub plafonul de 3 runde scris în main.js',
     runde < 3 && /const MAX_RUNDE_CURATENIE = 3/.test(
       readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8')));

  const dupa = buildPlan(curat, {}, null, null, BULETIN);
  const amprenta = pl => JSON.stringify(pl.rts.map(r =>
    [r.name, r.startKm, r.finishKm, r.distKm, r.kmh, r.type,
     (r.segments || []).map(s => [s.kmh, s.fromKm])]));
  ok('PROBELE SUNT IDENTICE, la virgulă: start, finiș, distanță, medie, schimbări de medie',
     amprenta(inainte) === amprenta(dupa),
     `\n      înainte: ${amprenta(inainte)}\n      după:    ${amprenta(dupa)}`);
  ok('cele trei probe din buletin, neatinse: TR2 8,89 · TR3 6,26 · TR4 8,87 km',
     dupa.rts.map(r => r.distKm).join(' ') === '8.89 6.26 8.87',
     dupa.rts.map(r => r.distKm).join(' '));
  ok('schimbarea de medie a lui TR4 rămâne la 5,74 km de la start, 20,5 km/h',
     JSON.stringify(dupa.rts[2].segments.map(s => [s.kmh, s.fromKm])) === '[[24.3,0],[20.5,5.74]]',
     JSON.stringify(dupa.rts[2].segments.map(s => [s.kmh, s.fromKm])));
  ok('și notele buletinului nu se schimbă — aceleași aproximări spuse, nici una în plus',
     JSON.stringify(inainte.buletin.note) === JSON.stringify(dupa.buletin.note));
  ok('kilometrajul, direcțiile și comentariile rămân neatinse: se șterg DOAR semne',
     JSON.stringify(curat.map(b => [b.num, b.sumKm, b.dir, b.comment])) ===
     JSON.stringify(murdar.map(b => [b.num, b.sumKm, b.dir, b.comment])));
  ok('parcările, TC-urile curate și stațiile de încărcare supraviețuiesc curățeniei',
     nums(curat.filter(b => areFlag(b, 'PARKING'))) === '11,12,27,118,119,120' &&
     nums(curat.filter(b => areFlag(b, 'TC'))) === '1,28,29,33,35,111' &&
     curat.filter(b => areFlag(b, 'EV')).length === 6,
     nums(curat.filter(b => areFlag(b, 'TC'))));
  ok('după curățenie nu mai rămâne niciun avertisment despre semne de probă',
     verifyRoadbook(curat).probleme.filter(p => /FINISH de probă|START fără FINISH/.test(p)).length === 0,
     JSON.stringify(verifyRoadbook(curat).probleme.slice(0, 4)));
  // Testul de mai sus dovedește pe DATELE ASTEA. Ăsta de aici dovedește STRUCTURAL, ca
  // să nu depindă de o fixtură norocoasă: funcția care leagă probele din buletin de
  // boxuri nu se uită NICIODATĂ la semne — lucrează pe numere de box și kilometri. Câtă
  // vreme rămâne așa, curățarea semnelor nu POATE schimba o probă venită din buletin.
  {
    const route = readFileSync(join(aici, '..', 'js', 'route.js'), 'utf8');
    const fn = /\nexport function probeDinBuletin\([\s\S]*?\n\}\n/.exec(route);
    ok('legarea probelor din buletin nu citește niciun semn din roadbook',
       !!fn && !/normFlags|esteStart|esteFinish|areFlag|\.flags/.test(fn[0]),
       fn ? 'apar semne în probeDinBuletin' : 'n-am găsit funcția probeDinBuletin');
  }
  ok('propoziția pe care o citește Andreas pentru cazul ăsta',
     frazaSemneCuratate({ scoase, adaugate }) ===
     'Am scos 11 semne din roadbook care nu se potriveau cu buletinul. ' +
     'Probele vin din buletin, deci nu era nimic de decis.',
     frazaSemneCuratate({ scoase, adaugate }));
}

console.log('\n═══ Propoziția din locul butoanelor roșii ═══');
{
  // Cazul MĂSURAT pe telefonul lui Andreas, 06.08: două semne scoase, niciunul pus.
  ok('două semne scoase → exact propoziția cerută',
     frazaSemneCuratate({ scoase: 2, adaugate: 0 }) ===
     'Am scos 2 semne din roadbook care nu se potriveau cu buletinul. ' +
     'Probele vin din buletin, deci nu era nimic de decis.',
     frazaSemneCuratate({ scoase: 2, adaugate: 0 }));
  ok('un singur semn → acordul e la singular, nu „1 semne"',
     frazaSemneCuratate({ scoase: 1, adaugate: 0 }) ===
     'Am scos un semn din roadbook care nu se potrivea cu buletinul. ' +
     'Probele vin din buletin, deci nu era nimic de decis.',
     frazaSemneCuratate({ scoase: 1, adaugate: 0 }));
  ok('și semnele PUSE se spun separat, nu se amestecă în aceeași cifră',
     frazaSemneCuratate({ scoase: 12, adaugate: 1 }) ===
     'Am scos 12 semne din roadbook care nu se potriveau cu buletinul. ' +
     'Am pus un semn de start acolo unde roadbook-ul îl scrie cu litere. ' +
     'Probele vin din buletin, deci nu era nimic de decis.',
     frazaSemneCuratate({ scoase: 12, adaugate: 1 }));
  ok('doar adăugări → nu se pomenește nimic scos',
     frazaSemneCuratate({ scoase: 0, adaugate: 2 }) ===
     'Am pus 2 semne de start acolo unde roadbook-ul le scrie cu litere. ' +
     'Probele vin din buletin, deci nu era nimic de decis.');
  ok('fără jargon: niciun „flag", „orfan", „probă deschisă" sau nume de cod',
     !/flag|orfan|probă deschisă|RT_|TIMING/i.test(frazaSemneCuratate({ scoase: 3, adaugate: 1 })));
  ok('date lipsă → propoziția nu inventează nicio cifră',
     frazaSemneCuratate({}) === 'Probele vin din buletin, deci nu era nimic de decis.' &&
     frazaSemneCuratate(null) === 'Probele vin din buletin, deci nu era nimic de decis.');
}

console.log('\n═══ Motivele de pe rânduri, când semnele CHIAR decid ═══');
{
  const b = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['RT_START_AUTO'], comment: 'Start Leg 1 Time Control - TC 1 Str. Gramma' },
    { num: 5, sumKm: 1.70, dir: 'DREAPTA', flags: ['RT_FINISH'], comment: 'Giarmata Str. Petőfi Sándor DJ 691' },
    { num: 7, sumKm: 2.12, dir: 'ÎNAINTE', flags: [], comment: 'Start TR 1 Str. Bartók Béla DJ 691' },
    { num: 9, sumKm: 4.28, dir: 'ÎNAINTE', flags: ['RT_FINISH'], comment: 'Start TR 2 DJ 691' }
  ]);
  const p = propuneCorecturiProbe(b);
  const motiv = n => (p.find(x => x.box.num === n) || {}).motiv || '';
  ok('fiecare motiv începe cu numărul boxului — omul se uită pe roadbook, nu în cod',
     p.every(x => x.motiv.startsWith(`Boxul ${x.box.num}`)),
     JSON.stringify(p.map(x => x.motiv.slice(0, 30))));
  ok('boxul 5: se spune ce scrie în roadbook acolo, cu ghilimele',
     /Boxul 5 a fost citit ca finiș de probă/.test(motiv(5)) &&
     /„Giarmata Str\. Petőfi Sándor DJ 691"/.test(motiv(5)), motiv(5));
  ok('boxul 1: se spune că nicio probă nu începe acolo, și unde chiar încep',
     /Boxul 1 a fost citit ca start de probă/.test(motiv(1)) &&
     /nicio probă nu începe aici/.test(motiv(1)) &&
     /starturile la boxurile 7, 9/.test(motiv(1)), motiv(1));
  // și cazul celălalt: un Time Control citit ca finiș — motivul explică ce e un TC,
  // nu-l numește doar (boxul 111 de la Reșița, „Finish Leg 2 Time Control - TC 4")
  const tc = propuneCorecturiProbe(sanitizeBoxes([
    { num: 5, sumKm: 1.0, dir: 'ÎNAINTE', flags: ['RT_START_AUTO'], comment: 'Start RT 1' },
    { num: 9, sumKm: 4.0, dir: 'ÎNAINTE', flags: ['RT_FINISH', 'TC'], comment: 'Finish Leg 2 Time Control - TC 4' }
  ]));
  ok('Time Control citit ca finiș: motivul îl EXPLICĂ, nu-l numește doar',
     tc.length === 1 && /Boxul 9 a fost citit ca finiș de probă/.test(tc[0].motiv) &&
     /se ștampilează ora/.test(tc[0].motiv) && /nu o linie de finiș/.test(tc[0].motiv),
     tc.length ? tc[0].motiv : 'nicio propunere');
  ok('boxul 7: startul scris cu litere se propune, cu motivul citat din pagină',
     /Boxul 7/.test(motiv(7)) && /„Start RT 1"/.test(motiv(7)), motiv(7));
  ok('niciun motiv nu conține jargon: „flag", „orfan", „RT_START_AUTO"',
     p.every(x => !/\bflag\b|orfan|RT_START|RT_FINISH|TIMING/i.test(x.motiv)),
     JSON.stringify(p.map(x => x.motiv)));
  ok('și niciunul nu e mai lung decât o citire de zece secunde (sub 220 de semne)',
     p.every(x => x.motiv.length < 220),
     JSON.stringify(p.map(x => x.motiv.length)));
}

console.log('\n═══ Cablajul din ecran: cine curăță, cine întreabă ═══');
{
  const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
  ok('curățenia automată trece prin comutaFlag, nu pe lângă el',
     /async function curataSemneleCareNuDecid/.test(main) &&
     /await comutaFlag\(p\.box, p\.flag, \{ motiv, faraRebuild: true \}\)/.test(main));
  ok('și se face DOAR când probele vin din buletin',
     /if \(!plan \|\| plan\.sursaProbe !== 'buletin'/.test(main));
  ok('fiecare semn curățat rămâne în jurnal, marcat ca automat, cu motivul lui',
     /auto: !!opt\.motiv, motiv: opt\.motiv \|\| null/.test(main) &&
     /store\.log\('semne_curatate_automat'/.test(main));
  ok('motivul scris în jurnal spune de ce a fost voie',
     /probele vin din buletin — semnul din roadbook nu cronometrează nimic/.test(main));
  ok('comentariul din cod spune limpede ce NU se atinge niciodată singur',
     /NU SCHIMB SINGUR CE CRONOMETREAZĂ; CURĂȚ LIBER CE NU CRONOMETREAZĂ/.test(main));
  ok('recursia se oprește: după curățenie planul se reconstruiește o singură dată',
     /if \(await curataSemneleCareNuDecid\(\)\) return rebuildPlan\(fortat\)/.test(main) &&
     /_curatenieInCurs/.test(main));
  ok('pe ecran, când probele vin din buletin, se iese ÎNAINTE de orice buton',
     /if \(plan\.sursaProbe === 'buletin'\)[\s\S]{0,700}?wrap\.appendChild\(p\);\n    return;/.test(main));
  ok('propoziția e verde, nu galbenă — nu e un avertisment, e o informare',
     /if \(plan\.sursaProbe === 'buletin'\)[\s\S]{0,400}?p\.style\.color = 'var\(--ok\)'/.test(main));
  ok('avertismentele verificatorului se sting pe aceeași condiție',
     /verifyRoadbook\(boxesRaw, \{ probeleVinDinBuletin: plan.sursaProbe === 'buletin' \}\)/.test(main));
  ok('semnele curățate automat NU lasă rânduri de editat în urmă',
     /if \(b\.num != null && !opt\.motiv\) _probeExtra\.add\(b\.num\)/.test(main));
  ok('BUILD-ul e v48', /const BUILD = 'v48'/.test(main));
  // CACHE din sw.js trebuie să urce ODATĂ cu BUILD, altfel telefonul servește versiunea
  // veche din cache și „am pus v42" e o afirmație nemăsurată. Verificarea se face pe
  // fișier, nu pe memorie: se citește versiunea din main.js și se cere aceeași în sw.js.
  {
    const swTxt = readFileSync(join(aici, '..', 'sw.js'), 'utf8');
    const b = (main.match(/const BUILD = '(v\d+)'/) || [])[1];
    const c = (swTxt.match(/const CACHE = 'rali2-(v\d+)'/) || [])[1];
    ok('CACHE din sw.js e sincron cu BUILD', !!b && b === c, `BUILD ${b}, CACHE ${c}`);
  }
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
