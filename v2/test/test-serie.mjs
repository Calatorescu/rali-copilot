// RALI 2 — ROADBOOK GĂURIT: pagina care n-a intrat niciodată (v47).
//
// Sibiu, 08.08.2026, scanarea de la 13:08, măsurat în jurnal:
//   13:08:29 … 13:10:47  opt `scan_page`, toate `ok:true` (9+9+9+9+9+9+9+3 boxuri)
//   13:10:47  scan_bilant {selectate: 8, scanate: 8, reusite: 8, cazute: 0, boxuri: 66}
// Bilanț verde, opt din opt. Iar `plan_raw` din același jurnal are 66 de boxuri numerotate
// 1..75, cu o gaură 27 → 37, și paginile 81,82,83,85,86,87,88,89 — fără 84.
//
// Leg-ul avea NOUĂ pagini fizice. Andreas a selectat opt poze. Aplicația a raportat despre
// ce a PRIMIT („8 din 8 ✓") și n-a spus nimic despre ce lipsea; în cursă, cockpitul sărea
// de la boxul 27 la 37 fără explicație. Aceeași clasă cu plafonul tăcut de 12 pagini
// (05.08): unealta măsoară intrarea, nu întregul.
//
// Un roadbook e o SERIE. O serie cu o gaură se recunoaște fără nicio informație din afară,
// deterministic. Deci se recunoaște — și se spune până e reparată.
import { serieRoadbook, frazaSerie, sanitizeBoxes, groupByLeg } from '../js/route.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// Fixtura REALĂ: 66 de boxuri, 1..75 fără 28..36, nouă pe pagină, paginile 81..89 fără 84.
// Se construiește exact ca în teren — nouă boxuri per pagină tipărită.
function sibiu13({ faraPagina = 84, boxuriPePagina = 9 } = {}) {
  const out = [];
  let km = 0;
  for (let p = 81; p <= 89; p++) {
    for (let i = 0; i < boxuriPePagina; i++) {
      const num = (p - 81) * boxuriPePagina + i + 1;
      if (num > 75) break;
      km += 0.31;
      if (p === faraPagina) continue;              // poza care n-a fost făcută
      out.push({ day: 2, leg: 5, page: p, num, sumKm: +km.toFixed(2),
                 dir: 'ÎNAINTE', flags: [], comment: '' });
    }
  }
  return sanitizeBoxes(out);
}

console.log('\n═══ Cazul REAL din 08.08: pagina 84 n-a fost fotografiată ═══');
{
  const boxes = sibiu13();
  ok('fixtura reproduce cifrele din jurnal: 66 boxuri, 1..75',
     boxes.length === 66 && boxes[0].num === 1 && boxes[boxes.length - 1].num === 75,
     `${boxes.length} boxuri, ${boxes[0].num}..${boxes[boxes.length - 1].num}`);
  const s = serieRoadbook(boxes);
  ok('și paginile din jurnal: 81,82,83,85,86,87,88,89',
     s.pagini.join(',') === '81,82,83,85,86,87,88,89', s.pagini.join(','));
  ok('seria NU e completă — asta e tot ce bilanțul de azi nu spunea', s.complet === false);
  ok('lipsesc exact boxurile 28-36, nici unul mai mult',
     s.boxuriLipsa.join(',') === '28,29,30,31,32,33,34,35,36', s.boxuriLipsa.join(','));
  ok('gaura e una singură, între boxul 27 și boxul 37',
     s.gauri.length === 1 && s.gauri[0].deLaBox === 27 && s.gauri[0].panaLaBox === 37,
     JSON.stringify(s.gauri.map(g => [g.deLaBox, g.panaLaBox])));
  ok('și e coroborată cu pagina: 84',
     s.paginiLipsa.join(',') === '84' && s.gauri[0].paginiLipsa.join(',') === '84',
     JSON.stringify({ paginiLipsa: s.paginiLipsa, dinGaura: s.gauri[0].paginiLipsa }));
  const f = frazaSerie(s);
  ok('fraza e roșie', f.rau === true);
  ok('spune boxurile ca interval, nu ca nouă numere separate',
     /LIPSESC boxurile 28-36/.test(f.txt), f.txt);
  ok('spune care poză lipsește, la singular',
     /pagina 84 nu a fost fotografiată/.test(f.txt), f.txt);
  ok('și spune ce să facă, plus că restul nu se pierde',
     /Refotografiază/.test(f.txt) && /restul rămâne/.test(f.txt), f.txt);
}

console.log('\n═══ Roadbook întreg: rând VERDE, cu cifre, nu o liniștire ═══');
{
  const boxes = sibiu13({ faraPagina: null });
  const s = serieRoadbook(boxes);
  ok('toate cele 75 de boxuri sunt acolo', boxes.length === 75);
  ok('seria e completă', s.complet === true, JSON.stringify(s.boxuriLipsa));
  ok('zero boxuri și zero pagini lipsă',
     s.boxuriLipsa.length === 0 && s.paginiLipsa.length === 0);
  const f = frazaSerie(s);
  ok('fraza e verde', f.rau === false);
  ok('și spune intervalul măsurat, nu doar „complet"',
     /serie completă 1-75/.test(f.txt) && /75 boxuri/.test(f.txt), f.txt);
  ok('inclusiv paginile, tot cu cifre', /pagini 81-89, toate/.test(f.txt), f.txt);
}

console.log('\n═══ Gaură de numere FĂRĂ gaură de pagini (pagină citită pe jumătate) ═══');
{
  // Poza există, s-a scanat, dar modelul a ratat trei rânduri de la mijlocul paginii 83.
  // Paginile rămân vecine, deci nu e vina pozelor — dar boxurile lipsesc la fel de tare.
  const boxes = sibiu13({ faraPagina: null }).filter(b => ![21, 22, 23].includes(b.num));
  const s = serieRoadbook(boxes);
  ok('gaura de numere e prinsă', s.complet === false &&
     s.boxuriLipsa.join(',') === '21,22,23', s.boxuriLipsa.join(','));
  ok('dar NU se acuză nicio pagină — paginile sunt vecine',
     s.paginiLipsa.length === 0 && s.gauri[0].paginiLipsa.length === 0,
     JSON.stringify(s.paginiLipsa));
  const f = frazaSerie(s);
  ok('fraza e tot roșie', f.rau === true);
  ok('formulată pe BOXURI, cu motivul corect: citirea paginii, nu poza',
     /LIPSESC boxurile 21-23/.test(f.txt) &&
     /paginile sunt vecine/.test(f.txt), f.txt);
}

console.log('\n═══ Cazuri de margine, ca detectorul să nu latre degeaba ═══');
{
  // CÂT DE SIGUR e pragul k≥2 pe numere? Măsurat pe toate roadbook-urile stocate în
  // jurnalele din 02-08.08.2026 — zece leg-uri, cel mai mare de 120 de boxuri, altul de 66:
  // ZERO sărituri de numerotare. Singura găsită în toată seria e chiar gaura reală de pe
  // 08.08 (27 → 37), și ea coroborată de o ruptură de pagină. Deci roadbook-urile pe care
  // le scanează el sunt numerotate continuu, iar pragul nu produce alarme false.
  // (Dacă apare vreodată un roadbook cu numerotare sărită, ăsta e locul de reverificat.)
  const sarit = sanitizeBoxes([
    { day: 1, leg: 1, page: 1, num: 1, sumKm: 0.0, dir: 'ÎNAINTE', flags: [], comment: '' },
    { day: 1, leg: 1, page: 1, num: 2, sumKm: 0.4, dir: 'ÎNAINTE', flags: [], comment: '' },
    { day: 1, leg: 1, page: 1, num: 3, sumKm: 0.8, dir: 'ÎNAINTE', flags: [], comment: '' }
  ]);
  ok('serie 1,2,3 pe o pagină: complet', serieRoadbook(sarit).complet === true);

  ok('lista goală nu produce nici alarmă, nici frază',
     serieRoadbook([]).complet === true && frazaSerie(serieRoadbook([])).txt === '');
  ok('un singur box nu poate avea gaură', serieRoadbook(sarit.slice(0, 1)).complet === true);
  ok('boxuri fără pagină (import vechi) nu produc acuzații de pagină',
     (() => { const b = sibiu13().map(x => ({ ...x, page: null }));
              const s = serieRoadbook(b);
              return s.boxuriLipsa.length === 9 && s.paginiLipsa.length === 0; })());
  ok('argument aiurea nu crapă',
     serieRoadbook(null).complet === true && serieRoadbook('abc').complet === true);
  ok('fraza pe null nu crapă', frazaSerie(null).txt === '');
}

console.log('\n═══ Se verifică pe FIECARE leg, nu doar pe cel activ ═══');
{
  // Pagina lipsă poate fi în leg-ul de mâine. Se repară azi, în parcare, nu mâine în mers.
  const doua = sanitizeBoxes([
    ...sibiu13({ faraPagina: null }).slice(0, 9),
    ...sibiu13().map(b => ({ ...b, day: 3, leg: 1 }))
  ]);
  const grupuri = groupByLeg(doua);
  ok('două leg-uri distincte', grupuri.length === 2, JSON.stringify(grupuri.map(g => g.key)));
  const rele = grupuri.filter(g => !serieRoadbook(g.boxes).complet);
  ok('numai unul e găurit', rele.length === 1, JSON.stringify(rele.map(g => g.key)));
  ok('și e cel cu pagina 84 lipsă',
     serieRoadbook(rele[0].boxes).paginiLipsa.join() === '84',
     JSON.stringify(serieRoadbook(rele[0].boxes).paginiLipsa));
}

console.log('\n═══ Două găuri: se spun amândouă, nu doar prima ═══');
{
  const boxes = sibiu13().filter(b => ![50, 51].includes(b.num));
  const s = serieRoadbook(boxes);
  ok('ambele găuri sunt raportate', s.gauri.length === 2,
     JSON.stringify(s.gauri.map(g => [g.deLaBox, g.panaLaBox])));
  ok('cu toate boxurile lor',
     s.boxuriLipsa.join(',') === '28,29,30,31,32,33,34,35,36,50,51', s.boxuriLipsa.join(','));
  const f = frazaSerie(s);
  ok('fraza le conține pe amândouă',
     /28-36/.test(f.txt) && /50-51/.test(f.txt), f.txt);
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
