// RALI 2 — PROPUNERILE DE CORECTURĂ PENTRU PROBE.
//
// 05.08.2026. Andreas a scanat roadbook-ul de antrenament de la Reșița (Ziua 2 · Leg 2,
// 0–79,72 km): 14 pagini din 14, 120 de boxuri, 0 căzute. Conținutul a ieșit perfect —
// numere, kilometri, direcții, comentarii. Semnele de probă au ieșit greșite:
//
//   START marcat pe:  37 („DJ 582"), 39 („Biroul Vamal Reșița"), 57, 64, 79
//   FINISH marcat pe: 44, 45, 49, 51, 53, 55, 68, 70, 73, 75, 91, 108, 111
//
// Unsprezece dintre finișuri sunt plăcuțe de localitate („Exit Văliug", „Welcome
// Gărâna", „Enter Brebu Nou"…), iar 111 e Time Control-ul de final. Aplicația a dedus
// CINCI probe (2,84 · 2,07 · 18,06 · 8,55 · 3,83 km) și a afișat opt avertismente
// „FINISH fără START înaintea lui".
//
// ADEVĂRUL, din Buletinul nr. 2 al Directorului de cursă (26.06.2026, Document 3.1) —
// documentul care definește probele ÎN TEXT, separat de roadbook:
//   TR 2 · standing · 44,8 km/h · start box 57 → finiș la box 64
//   TR 3 · auto     · 34,6 km/h · start box 64 → finiș înainte de box 66
//   TR 4 · standing · 24,3 km/h · start box 79 → 20,5 km/h de la box 97 → finiș după 104
// Trei probe, nu cinci. Boxul 64 e simultan finișul lui TR2 și startul lui TR3.
//
// DE CE CODUL NU POATE GHICI UNDE SE TERMINĂ O PROBĂ: boxurile 66, 97 și 104 — exact
// finișul lui TR3, schimbarea de viteză și finișul lui TR4 — n-au NICIO icoană și
// NICIUN comentariu în roadbook (se vede în fixtura de mai jos, care e copiată din
// scanarea reală). Niciun prompt mai bun nu le poate găsi vreodată. Deci verificatorul
// propune doar SCOATEREA a ce nu se leagă și ADĂUGAREA startului acolo unde roadbook-ul
// îl scrie el însuși cu litere. Un finiș nou nu-l inventează niciodată.
//
// Fixturile sunt boxurile REALE din jurnalul zilei (num, sumKm, dir, comment) — nume de
// străzi și de localități din roadbook, fără nicio coordonată.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sanitizeBoxes, detectRts, normFlags, esteStart, esteFinish,
         propuneCorecturiProbe, aplicaPropuneri, rezumatVerificare,
         numaraOrfane } from '../js/route.js';

const aici = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// ── Reșița, Leg 2, EXACT cum a ieșit din scanarea de pe 05.08.2026 ──────────
const RESITA_SCANAT = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: "ÎNAINTE", flags: ["TC"], comment: "Start Leg 2 Time Control - TC 3 Piața 1 Decembrie 1918" },
  { num: 37, sumKm: 8.54, dir: "ÎNAINTE", flags: ["RT_START_AUTO"], comment: "DJ 582" },
  { num: 39, sumKm: 9.20, dir: "ÎNAINTE", flags: ["RT_START_AUTO"], comment: "Biroul Vamal Reșița" },
  { num: 44, sumKm: 11.27, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "To Semenic, Trei Ape, Văliug" },
  { num: 45, sumKm: 11.38, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "To Văliug" },
  { num: 49, sumKm: 13.30, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "To Semenic, Trei Ape, Văliug, DJ 582" },
  { num: 51, sumKm: 23.40, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Văliug 5 km, DJ 582" },
  { num: 53, sumKm: 30.62, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "To Slatina-Timiș, DJ 582" },
  { num: 55, sumKm: 30.89, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Exit Văliug, DJ 582" },
  { num: 56, sumKm: 38.58, dir: "DREAPTA-T", flags: [], comment: "To Semenic, DJ 582E" },
  { num: 57, sumKm: 38.80, dir: "ÎNAINTE", flags: ["RT_START_AUTO"], comment: "Start RT 2, DJ 582E" },
  { num: 64, sumKm: 47.69, dir: "ÎNAINTE", flags: ["RT_START_AUTO"], comment: "Start RT 3, DJ 582E" },
  // boxul 66 e finișul lui TR3 după buletin — în roadbook n-are nici icoană, nici text
  { num: 66, sumKm: 53.95, dir: "DREAPTA-T", flags: [], comment: "To Brebu Nou, DJ 582" },
  { num: 68, sumKm: 56.24, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Welcome Gărâna, DJ 582" },
  { num: 70, sumKm: 56.86, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Enter Gărâna, DJ 582" },
  { num: 73, sumKm: 57.61, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Exit Gărâna, DJ 582" },
  { num: 75, sumKm: 61.60, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Enter Brebu Nou, DJ 582" },
  { num: 79, sumKm: 62.12, dir: "ÎNAINTE", flags: ["RT_START_STANDING"], comment: "Start RT 4, Brown Gate with bell" },
  { num: 91, sumKm: 65.95, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Căminul Cultural" },
  // 97 = schimbarea oficială de viteză a lui TR4, 104 = ultimul box dinaintea finișului.
  // Amândouă goale în roadbook — dovada că structura probelor NU e în pagină.
  { num: 97, sumKm: 67.86, dir: "DREAPTA-T", flags: [], comment: "" },
  { num: 104, sumKm: 70.99, dir: "ÎNAINTE", flags: [], comment: "" },
  { num: 105, sumKm: 71.15, dir: "DREAPTA-T", flags: [], comment: "" },
  { num: 108, sumKm: 71.51, dir: "ÎNAINTE", flags: ["RT_FINISH"], comment: "Exit Brebu Nou" },
  { num: 111, sumKm: 76.59, dir: "ÎNAINTE", flags: ["RT_FINISH", "TC"], comment: "Finish Leg 2 Time Control - TC 4" },
  { num: 120, sumKm: 79.72, dir: "ÎNAINTE", flags: ["PARKING"], comment: "Casa Gotschna - Use Voucher" }
]);

const nums = list => list.map(b => b.num).join(',');

console.log('\n═══ Starea de dinainte: ce a produs scanarea reală ═══');
{
  const r = rezumatVerificare(RESITA_SCANAT);
  ok('roadbook-ul își scrie singur TREI starturi de probă („Start RT 2/3/4")',
     r.declarate === 3, `${r.declarate}`);
  ok('dar scanarea a marcat CINCI boxuri ca start', r.marcate === 5, `${r.marcate}`);
  ok('ies cinci probe, deși în buletin sunt trei', r.probeAcum === 5, `${r.probeAcum}`);
  ok('și opt finișuri n-au nicio probă deschisă înaintea lor',
     r.orfane === 8, `${r.orfane}`);
  const d = detectRts(RESITA_SCANAT).map(x => x.distKm);
  ok('distanțele greșite pe care le-a afișat aplicația: 2,84 · 2,07 · 18,06 · 8,55 · 3,83',
     d.join(' ') === '2.84 2.07 18.06 8.55 3.83', d.join(' '));
}

console.log('\n═══ Propunerile pe datele reale, box cu box ═══');
{
  const p = propuneCorecturiProbe(RESITA_SCANAT);
  ok('ies exact 12 propuneri', p.length === 12, `${p.length}: ${nums(p.map(x => x.box))}`);
  ok('toate pe boxurile așteptate, în ordinea kilometrajului',
     nums(p.map(x => x.box)) === '37,39,44,45,49,51,53,55,73,75,108,111',
     nums(p.map(x => x.box)));
  const scoateStart = p.filter(x => x.actiune === 'scoate' && x.flag.startsWith('RT_START'));
  ok('două starturi inventate se scot: 37 („DJ 582") și 39 („Biroul Vamal Reșița")',
     nums(scoateStart.map(x => x.box)) === '37,39', nums(scoateStart.map(x => x.box)));
  ok('motivul citează comentariul boxului și listează starturile scrise în roadbook',
     /„DJ 582"/.test(scoateStart[0].motiv) && /57, 64, 79/.test(scoateStart[0].motiv),
     scoateStart[0].motiv);
  const tc = p.find(x => x.box.num === 111);
  ok('boxul 111 pierde FINISH-ul: e Time Control, nu probă',
     tc && tc.actiune === 'scoate' && tc.flag === 'RT_FINISH' && /Time Control/.test(tc.motiv),
     tc ? tc.motiv : 'lipsește');
  const orfane = p.filter(x => /nu începe nicio probă/.test(x.motiv));
  ok('nouă finișuri orfane se scot: 44, 45, 49, 51, 53, 55, 73, 75, 108',
     nums(orfane.map(x => x.box)) === '44,45,49,51,53,55,73,75,108',
     nums(orfane.map(x => x.box)));
  // PARTEA CARE CONTEAZĂ CEL MAI MULT: aplicația nu inventează finișuri.
  ok('NICIO propunere nu adaugă un FINISH nicăieri — unde se termină o probă scrie în ' +
     'buletin, nu în roadbook',
     !p.some(x => x.actiune === 'adauga' && x.flag === 'RT_FINISH'),
     JSON.stringify(p.filter(x => x.actiune === 'adauga').map(x => x.box.num + ':' + x.flag)));
  ok('în special boxul 79 NU primește finiș: TR3 se termină înainte de box 66, iar TR4 ' +
     'abia începe la 79',
     !p.some(x => x.box.num === 79));
  ok('fiecare propunere are motiv scris pentru om, nu cod',
     p.every(x => typeof x.motiv === 'string' && x.motiv.length > 25 && /[a-zăâîșț]/.test(x.motiv)));
  ok('și cele trei câmpuri de contract: box, acțiune, semn',
     p.every(x => x.box && (x.actiune === 'adauga' || x.actiune === 'scoate') &&
                  ['RT_START_AUTO', 'RT_START_STANDING', 'RT_FINISH'].includes(x.flag)));
  ok('`box` e chiar obiectul primit, nu o copie — ecranul îl dă mai departe lui comutaFlag',
     p.every(x => RESITA_SCANAT.includes(x.box)));
  ok('funcția nu atinge boxurile primite',
     nums(RESITA_SCANAT.filter(b => esteStart(b))) === '37,39,57,64,79',
     nums(RESITA_SCANAT.filter(b => esteStart(b))));
  ok('niciun semn nu se propune de două ori pe același box',
     new Set(p.map(x => x.box.num + '|' + x.flag)).size === p.length);
}

console.log('\n═══ Starea de după: ce rămâne când Andreas apasă „Aplică toate" ═══');
{
  const p = propuneCorecturiProbe(RESITA_SCANAT);
  const dupa = aplicaPropuneri(RESITA_SCANAT, p);
  ok('ZERO finișuri orfane', numaraOrfane(dupa) === 0, `${numaraOrfane(dupa)}`);
  ok('starturile rămase sunt exact cele trei pe care le scrie roadbook-ul: 57, 64, 79',
     nums(dupa.filter(b => esteStart(b))) === '57,64,79',
     nums(dupa.filter(b => esteStart(b))));
  ok('boxul 79 și-a păstrat startul de pe loc, cum îl dă buletinul',
     normFlags(dupa.find(b => b.num === 79)).join() === 'RT_START_STANDING',
     JSON.stringify(normFlags(dupa.find(b => b.num === 79))));
  ok('boxul 111 rămâne Time Control curat, fără semn de probă',
     normFlags(dupa.find(b => b.num === 111)).join() === 'TC',
     JSON.stringify(normFlags(dupa.find(b => b.num === 111))));
  ok('din cinci probe rămân trei', detectRts(dupa).length === 3,
     `${detectRts(dupa).length}`);
  // …dar NU cele trei corecte, și asta trebuie spus pe față: finișurile rămase (68, 70,
  // 91) sunt tot plăcuțe de localitate, doar că se leagă de câte un start. Verificatorul
  // le-a curățat pe cele imposibile; pe astea nu are cum să le judece. Restul se face de
  // mână, cu buletinul în față — de aia butonul nu se apasă singur.
  ok('finișurile rămase sunt cele care se leagă de un start: 68, 70, 91',
     nums(dupa.filter(b => esteFinish(b))) === '68,70,91',
     nums(dupa.filter(b => esteFinish(b))));
  const r = rezumatVerificare(RESITA_SCANAT);
  ok('rezumatul anunță dinainte cifrele: 5 probe → 3, 8 orfani → 0',
     r.probeAcum === 5 && r.probeDupa === 3 && r.orfane === 8 && r.orfaneDupa === 0,
     JSON.stringify(r));
  ok('și câte starturi rămân marcate: 5 → 3', r.marcate === 5 && r.marcateDupa === 3);
  ok('a doua rulare peste rezultat nu mai propune nimic — corectura e stabilă',
     propuneCorecturiProbe(dupa).length === 0,
     JSON.stringify(propuneCorecturiProbe(dupa).map(x => x.box.num + ':' + x.flag)));
}

console.log('\n═══ Regula 1: starturile pe care roadbook-ul le numește ═══');
{
  ok('„Start Leg 2 Time Control - TC 3" NU e un start de probă',
     rezumatVerificare([RESITA_SCANAT[0]]).declarate === 0);
  // declarat în text, dar scanarea n-a pus niciun semn → se propune adăugarea
  const lipsa = sanitizeBoxes([
    { num: 10, sumKm: 1.0, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Time Control - TC 1' },
    { num: 20, sumKm: 5.0, dir: 'ÎNAINTE', flags: [], comment: 'Start RT 2, DJ 582E' },
    { num: 30, sumKm: 9.0, dir: 'ÎNAINTE', flags: ['RT_FINISH'], comment: '' }
  ]);
  const pl = propuneCorecturiProbe(lipsa);
  ok('start scris în text, fără semn pe box → se propune adăugarea',
     pl.length === 1 && pl[0].box.num === 20 && pl[0].actiune === 'adauga' &&
     pl[0].flag === 'RT_START_AUTO', JSON.stringify(pl.map(x => x.box.num + ':' + x.flag)));
  ok('iar finișul de după el nu mai e orfan, fiindcă startul propus îl acoperă',
     !pl.some(x => x.box.num === 30));
  // „standing" în text → startul propus e cel de pe loc
  const st = sanitizeBoxes([
    { num: 20, sumKm: 5.0, dir: 'ÎNAINTE', flags: [], comment: 'Start RT 4 standing, Brown Gate' }
  ]);
  ok('„standing" în comentariu → se propune START oprit, nu din mers',
     propuneCorecturiProbe(st)[0].flag === 'RT_START_STANDING',
     propuneCorecturiProbe(st)[0].flag);
  ok('și motivul spune de ce',
     /standing/.test(propuneCorecturiProbe(st)[0].motiv));
  // felul startului deja marcat NU se atinge: buletinul zice că TR2 e standing, dar
  // comentariul boxului 57 nu scrie asta nicăieri, deci aplicația nu are de unde ști
  const b57 = RESITA_SCANAT.find(b => b.num === 57);
  ok('un box care ARE deja un start nu primește propunere de schimbare a felului',
     !propuneCorecturiProbe(RESITA_SCANAT).some(x => x.box === b57));
  // toleranță la scriere
  const tol = sanitizeBoxes([
    { num: 5, sumKm: 1.0, flags: [], comment: 'START  rt.7 — Gărâna' },
    { num: 6, sumKm: 2.0, flags: [], comment: 'Start TR 8, Reșița' }
  ]);
  ok('tolerant la majuscule, punctuație, spații duble și diacritice',
     propuneCorecturiProbe(tol).length === 2,
     JSON.stringify(propuneCorecturiProbe(tol).map(x => x.box.num)));
  ok('„restart rt 9" nu e un start de probă',
     rezumatVerificare(sanitizeBoxes([{ num: 5, sumKm: 1, comment: 'restart rt 9' }])).declarate === 0);
  // leg fără nicio declarație → regula 1 tace complet
  const mut = sanitizeBoxes([
    { num: 1, sumKm: 0.0, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Time Control' },
    { num: 8, sumKm: 3.0, dir: 'ÎNAINTE', flags: ['RT_START_AUTO'], comment: 'DJ 582' },
    { num: 12, sumKm: 7.0, dir: 'ÎNAINTE', flags: ['RT_FINISH'], comment: 'Exit Văliug' },
    { num: 16, sumKm: 9.0, dir: 'ÎNAINTE', flags: ['RT_FINISH'], comment: 'Enter Gărâna' }
  ]);
  const pm = propuneCorecturiProbe(mut);
  ok('leg fără niciun „Start RT n": regula 1 tace — startul nedeclarat NU se scoate',
     !pm.some(x => x.flag.startsWith('RT_START')),
     JSON.stringify(pm.map(x => x.box.num + ':' + x.actiune + ':' + x.flag)));
  ok('dar regula 3 lucrează în continuare: finișul orfan de la boxul 16 se scoate',
     pm.length === 1 && pm[0].box.num === 16 && pm[0].actiune === 'scoate',
     JSON.stringify(pm.map(x => x.box.num)));
  ok('și rezumatul spune că textul nu declară nimic',
     rezumatVerificare(mut).declarate === 0 && rezumatVerificare(mut).marcate === 1);
}

console.log('\n═══ Regula 2: Time Control citit ca finiș de probă ═══');
{
  const tc = sanitizeBoxes([
    { num: 5, sumKm: 1.0, flags: ['RT_START_AUTO'], comment: 'Start RT 1' },
    { num: 9, sumKm: 4.0, flags: ['RT_FINISH', 'TC'], comment: 'Finish Leg 2 Time Control - TC 4' }
  ]);
  const p = propuneCorecturiProbe(tc);
  ok('„Time Control" în comentariu → FINISH-ul se scoate',
     p.length === 1 && p[0].flag === 'RT_FINISH' && p[0].actiune === 'scoate');
  ok('ștampila TC rămâne pe box, nu se atinge',
     normFlags(aplicaPropuneri(tc, p).find(b => b.num === 9)).join() === 'TC');
  const scurt = sanitizeBoxes([
    { num: 5, sumKm: 1.0, flags: ['RT_START_AUTO'], comment: 'Start RT 1' },
    { num: 9, sumKm: 4.0, flags: ['RT_FINISH'], comment: 'TC 4, Gărâna' }
  ]);
  ok('și „TC 4" singur, fără cuvintele „time control", e recunoscut la fel',
     propuneCorecturiProbe(scurt).length === 1);
  const bun = sanitizeBoxes([
    { num: 5, sumKm: 1.0, flags: ['RT_START_AUTO'], comment: 'Start RT 1' },
    { num: 9, sumKm: 4.0, flags: ['RT_FINISH'], comment: 'To Brebu Nou, DJ 582' }
  ]);
  ok('un finiș obișnuit, care se leagă de un start, nu se atinge',
     propuneCorecturiProbe(bun).length === 0,
     JSON.stringify(propuneCorecturiProbe(bun).map(x => x.box.num)));
}

console.log('\n═══ Roadbook-ul marcat CORECT: verificatorul tace ═══');
{
  // Probele din buletin, marcate așa cum le-ar pune omul cu documentul în față.
  // (Buletinul spune „finiș înainte de box 66" și „finiș după box 104" — liniile alea
  //  n-au box propriu, deci omul le pune pe boxul cel mai apropiat: 66 și 105.)
  const CORECT = sanitizeBoxes(RESITA_SCANAT.map(b => {
    const f = { 37: [], 39: [], 44: [], 45: [], 49: [], 51: [], 53: [], 55: [],
                64: ['RT_FINISH', 'RT_START_AUTO'], 66: ['RT_FINISH'], 68: [], 70: [],
                73: [], 75: [], 91: [], 105: ['RT_FINISH'], 108: [], 111: ['TC'] };
    return { ...b, flags: f[b.num] !== undefined ? f[b.num] : normFlags(b) };
  }));
  const rts = detectRts(CORECT);
  ok('ies exact cele trei probe din buletin', rts.length === 3, `${rts.length}`);
  ok('TR2 pornește la boxul 57 și se termină la 64 — 8,89 km',
     CORECT[rts[0].startIdx].num === 57 && CORECT[rts[0].finishIdx].num === 64 &&
     rts[0].distKm === 8.89, `${rts[0].distKm}`);
  ok('TR3 pornește de unde s-a terminat TR2 (boxul 64) — 6,26 km',
     CORECT[rts[1].startIdx].num === 64 && rts[1].distKm === 6.26, `${rts[1].distKm}`);
  ok('TR4 pornește de pe loc la boxul 79', rts[2].type === 'standing');
  ok('ZERO propuneri: pe un roadbook marcat corect, verificatorul nu se bagă',
     propuneCorecturiProbe(CORECT).length === 0,
     JSON.stringify(propuneCorecturiProbe(CORECT).map(x => x.box.num + ':' + x.actiune + ':' + x.flag)));
  ok('și niciun finiș orfan de raportat', numaraOrfane(CORECT) === 0);
  // boxul cu DOUĂ semne — cazul pentru care s-a construit v36
  const b64 = CORECT.find(b => b.num === 64);
  ok('boxul 64 poartă amândouă semnele și nu i se propune nimic',
     normFlags(b64).length === 2 && esteStart(b64) && esteFinish(b64) &&
     !propuneCorecturiProbe(CORECT).some(x => x.box === b64),
     JSON.stringify(normFlags(b64)));
  ok('rezumatul lui e curat: 3 declarate, 3 marcate, 0 orfani, 3 probe',
     JSON.stringify([rezumatVerificare(CORECT).declarate, rezumatVerificare(CORECT).marcate,
                     rezumatVerificare(CORECT).orfane, rezumatVerificare(CORECT).probeAcum])
       === '[3,3,0,3]',
     JSON.stringify(rezumatVerificare(CORECT)));
}

console.log('\n═══ Margini ═══');
{
  ok('listă goală → nicio propunere, fără să crape', propuneCorecturiProbe([]).length === 0);
  ok('date de aiurea → nicio propunere', propuneCorecturiProbe(null).length === 0 &&
     propuneCorecturiProbe(undefined).length === 0);
  ok('rezumatul pe listă goală întoarce zerouri',
     JSON.stringify(rezumatVerificare([]).propuneri) === '[]' &&
     rezumatVerificare([]).probeAcum === 0);
  // un leg fără niciun semn de probă nu e treaba acestui verificator (o spune
  // verifyRoadbook, care urlă „NICIO probă în N boxuri")
  const gol = sanitizeBoxes([
    { num: 1, sumKm: 0, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Time Control - TC 1' },
    { num: 2, sumKm: 3, dir: 'DREAPTA', flags: [], comment: 'DJ 582' }
  ]);
  ok('leg fără niciun semn de probă → nicio propunere', propuneCorecturiProbe(gol).length === 0);
  // boxurile nesortate intră oricum în ordinea kilometrajului
  const amestec = sanitizeBoxes([
    { num: 9, sumKm: 9.0, flags: ['RT_FINISH'], comment: 'Exit Gărâna' },
    { num: 3, sumKm: 3.0, flags: ['RT_FINISH'], comment: 'Enter Gărâna' },
    { num: 6, sumKm: 6.0, flags: ['RT_START_AUTO'], comment: 'Start RT 1' }
  ]);
  const pa = propuneCorecturiProbe(amestec);
  ok('finișul de dinaintea startului e orfan; cel de după nu',
     pa.length === 1 && pa[0].box.num === 3,
     JSON.stringify(pa.map(x => x.box.num)));
  ok('aplicaPropuneri întoarce o copie, nu strică originalul',
     esteFinish(amestec.find(b => b.num === 3)) &&
     !esteFinish(aplicaPropuneri(amestec, pa).find(b => b.num === 3)));
}

console.log('\n═══ Ecranul: ce vede și ce apasă omul în parcare ═══');
{
  const html = readFileSync(join(aici, '..', 'index.html'), 'utf8');
  const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
  ok('secțiunea de propuneri există, deasupra listei de boxuri',
     /id="probe-propuneri"/.test(html) &&
     html.indexOf('id="probe-propuneri"') < html.indexOf('id="prep-probe"'));
  ok('și se desenează la fiecare randare a probelor',
     /renderPropuneri\(\);/.test(main) && /function renderPropuneri\(\)/.test(main));
  ok('fiecare rând are numărul boxului, kilometrajul și semnul',
     /box \$\{p\.box\.num[\s\S]{0,120}sumKm\.toFixed\(2\)/.test(main));
  ok('motivul se pune cu textContent — citează comentariul scanat, adică text extern',
     /motiv\.textContent = p\.motiv/.test(main), 'motivul ar putea fi randat ca HTML');
  ok('butonul de pe rând trece prin comutaFlag, nu pe lângă el',
     /btn\.addEventListener\('click', \(\) => comutaFlag\(p\.box, p\.flag\)\)/.test(main));
  ok('„Aplică toate" cere confirmare și spune câte corecturi face',
     /Aplică toate \(\$\{rez\.propuneri\.length\}\)/.test(main) &&
     /confirm\(`Aplic toate cele \$\{n\} corecturi/.test(main));
  ok('și tot prin comutaFlag aplică, una câte una',
     /for \(const p of rez\.propuneri\) await comutaFlag\(p\.box, p\.flag\)/.test(main));
  // v39: regula nu mai e „nimic nu se aplică singur", ci una mai exactă — NIMIC DIN CE
  // CRONOMETREAZĂ nu se aplică singur. Când probele vin din buletin, semnele roadbook-ului
  // nu mai intră în niciun calcul, deci se curăță tăcut (vezi test-citire.mjs). Când NU
  // există buletin, ele chiar decid, și atunci nimic nu se mișcă fără o apăsare.
  ok('desenarea propunerilor nu aplică nimic — corecturile intră doar pe click',
     !/renderPropuneri[\s\S]{0,2000}?\n\}/.exec(main)[0]
        .split('addEventListener').shift().includes('comutaFlag'));
  ok('iar curățenia automată e închisă strict pe cazul „probele vin din buletin"',
     /if \(!plan \|\| plan\.sursaProbe !== 'buletin' \|\| !plan\.boxes\.length\) return false/.test(main));
  ok('textul de deasupra spune limpede că propunerile sunt DEDUSE, nu citite de pe hârtie',
     /DEDUSE din comentariile scanate/.test(main) && /buletinul de la organizator/.test(main));
  ok('și că finișurile nu se propun niciodată, fiindcă nu scriu în roadbook',
     /nu propune niciodată un finiș nou/.test(main));
  ok('stilul rămâne cel al cardului: aceleași clase de buton și aceleași culori',
     /className = 'btn sm ' \+ \(p\.actiune === 'adauga' \? 'ok' : 'sec'\)/.test(main) &&
     /var\(--ok\)/.test(main) && /var\(--warn\)/.test(main));
  ok('cifrele verificării ajung pe ecran, nu doar în cod',
     /rez\.declarate/.test(main) && /rez\.orfane/.test(main) &&
     /rez\.probeAcum/.test(main) && /rez\.probeDupa/.test(main));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
