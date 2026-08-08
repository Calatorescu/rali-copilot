// RALI 2 — IEȘIREA DE PE TRASEU, pe cazul-etalon din tura Tresor (04.08.2026).
//
// Ce s-a întâmplat în teren, din jurnal (16:34:28-16:39:14): virajul de la boxul 12
// (stânga, la 55 m după finish-ul probei 2) a fost ratat. Aplicația a continuat ca și
// cum nimic: a potrivit două viraje de pe drumul greșit cu boxurile 13 și 17 (−92 și
// −133 m), a dat cue-uri pentru boxurile 15, 16, 17 și 18, iar primele avertizări de
// desincronizare au venit la 259 și 261 m după boxuri. Pilotul a condus patru minute
// pe alte străzi, cu o aplicație care îi spunea unde să vireze.
//
// Roadbook-ul de mai jos e Leg 1 din tura aia, cu kilometrajul real. Lumea de test are
// busolă: fiecare pas mută mașina pe un cap compas, deci virajele sunt viraje adevărate,
// văzute de același detector ca în mașină.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

const aici = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const TRESOR = sanitizeBoxes([
  { num: 1,  sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START Leg 1 · TC 1' },
  { num: 2,  sumKm: 0.19, dir: 'STÂNGA', comment: 'Stânga pe Str. Constructorilor' },
  { num: 3,  sumKm: 0.24, dir: 'ÎNAINTE', comment: 'Înainte — devine Inelul IV' },
  { num: 7,  sumKm: 2.28, dir: 'DREAPTA', comment: 'Dreapta pe Str. Avram Imbroane' },
  { num: 9,  sumKm: 2.83, dir: 'STÂNGA', comment: 'Stânga pe Str. Gheorghe Adam' },
  { num: 12, sumKm: 3.55, dir: 'STÂNGA', comment: 'Stânga pe Str. Lorena' },
  { num: 13, sumKm: 3.75, dir: 'DREAPTA', comment: 'Dreapta pe Aleea Pădurea Verde' },
  { num: 15, sumKm: 4.14, dir: 'DREAPTA', comment: 'Dreapta pe Str. Turda' },
  { num: 16, sumKm: 4.43, dir: 'STÂNGA', comment: 'Stânga pe Calea Ghirodei' },
  { num: 17, sumKm: 4.73, dir: 'DREAPTA', comment: 'Dreapta pe strada fără nume' },
  { num: 18, sumKm: 4.90, dir: 'STÂNGA', comment: 'Stânga pe Str. Ionel Teodoreanu' }
]);

// probele scoase din fixtură (start/finish nu schimbă nimic în logica de traseu, dar ar
// umple difuzorul cu cifre de ritm); restul kilometrajului e cel din roadbook.

function lume(boxes = TRESOR, opts = {}, { faraFix = false } = {}) {
  // lng deplasat cu -10 fata de zona reala, ca in toate fixturile (vezi test-audit.mjs)
  let wall = 0, lat = 45.78, lng = 11.24;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(boxes, {}, null), clock, store,
    driver: makeDriverModel(),
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} }, opts });
  m.start();
  if (!faraFix) { wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 0, accM: 6 }); }
  // un pas = un fix. În teren fixurile au venit la ~6 s; aici la 1 s, ca virajele să
  // aibă destule mostre pentru detector (el cere 2,5 s de direcție stabilă).
  const pas = (metri, hdg) => {
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(45.78 * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: hdg, accM: 6 });
  };
  const drept = (metri, hdg, pasM = 12) => {
    for (let d = 0; d < metri; d += pasM) pas(Math.min(pasM, metri - d), hdg);
  };
  // viraj ca în teren: colț de ~50 m cu direcția în schimbare, apoi drum stabil
  const viraj = (dela, spre) => {
    const n = 7, d = ((spre - dela + 540) % 360 - 180) / n;
    for (let i = 1; i <= n; i++) pas(7, dela + d * i);
    drept(40, spre, 10);
  };
  const salt = ms => { wall += ms; };
  // condu spre un punct geografic (folosit ca să te întorci la punctul de reintrare)
  const spre = (pct, metri, pasM = 12) => {
    for (let d = 0; d < metri; d += pasM) {
      const y = Math.sin((pct.lng - lng) * Math.PI / 180) * Math.cos(pct.lat * Math.PI / 180);
      const x = Math.cos(lat * Math.PI / 180) * Math.sin(pct.lat * Math.PI / 180) -
                Math.sin(lat * Math.PI / 180) * Math.cos(pct.lat * Math.PI / 180) *
                Math.cos((pct.lng - lng) * Math.PI / 180);
      const brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      pas(Math.min(pasM, metri - d), brg);
    }
  };
  return { m, store, said, pas, drept, viraj, salt, spre,
           jurnal: t => store.journal.filter(e => e.type === t) };
}

// Drumul CORECT până imediat după boxul 12 (55 m după finish-ul probei 2), pe capetele
// compas care fac ca distanțele conduse să se potrivească cu kilometrajul roadbook-ului.
function panaLaBoxul12(w, { rateaza = true, dupaM = 180 } = {}) {
  w.drept(190, 0);                 // box 1 → 2
  w.viraj(0, 270);                 // boxul 2: STÂNGA
  w.drept(2000, 270);              // box 3 → 7 (Inelul IV, probă, drum lung)
  w.viraj(270, 0);                 // boxul 7: DREAPTA
  w.drept(500, 0);                 // box 7 → 9
  w.viraj(0, 270);                 // boxul 9: STÂNGA
  w.drept(650, 270);               // box 9 → 12 (prin proba 2)
  if (rateaza) w.drept(dupaM, 270);  // AICI se rata: drept înainte, în loc de stânga
  else { w.viraj(270, 180); w.drept(160, 180); }
}

console.log('\n═══ Cazul-etalon: virajul de la boxul 12, ratat ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  const semne = w.jurnal('offroute_semn');
  ok('semnul „am trecut drept peste un box de manevră" apare',
     semne.some(s => s.tip === 'manevra_neconfirmata'), JSON.stringify(semne));
  const boxRatat = semne.find(s => s.tip === 'manevra_neconfirmata');
  ok('și e chiar boxul 12', boxRatat && boxRatat.boxNum === 12, JSON.stringify(boxRatat));

  // în teren, aici a urmat un viraj rătăcit pe care aplicația l-a lipit de boxul 13
  w.viraj(270, 0);
  ok('virajul de pe drumul greșit NU se mai potrivește cu boxul 13',
     !w.jurnal('sync').some(e => e.boxNum === 13),
     JSON.stringify(w.jurnal('sync')));
  ok('refuzul e motivat în jurnal',
     w.jurnal('snap_refuzat').some(e => e.motiv === 'dupa_manevra_ratata'),
     JSON.stringify(w.jurnal('snap_refuzat')));
  ok('și declară ieșirea de pe traseu',
     !!w.m.M.offRoute, JSON.stringify(w.jurnal('offroute_semn')));
  ok('punctul de reintrare e boxul 12',
     w.m.M.offRoute && w.m.M.offRoute.boxNum === 12, JSON.stringify(w.m.M.offRoute));
  ok('pilotul e anunțat, o singură dată, ca manevră',
     w.said.filter(s => /Ai ieșit de pe traseu/.test(s.t)).length === 1 &&
     w.said.find(s => /Ai ieșit de pe traseu/.test(s.t)).cls === 'manevra',
     JSON.stringify(w.said.filter(s => /traseu/.test(s.t))));
}

console.log('\n═══ Pe dinafară, planul îngheață ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  w.viraj(270, 0);
  const idx = w.m.M.nextBoxIdx, cueInainte = w.jurnal('cue').length;
  w.drept(600, 0);                 // rătăcire mai departe, peste kilometrajul boxurilor 15-16
  w.viraj(0, 90); w.drept(400, 90);
  ok('indexul boxurilor nu mai avansează', w.m.M.nextBoxIdx === idx,
     `${idx} → ${w.m.M.nextBoxIdx}`);
  ok('nu se mai dau cue-uri de manevră (în teren: boxurile 15, 16, 17, 18)',
     w.jurnal('cue').length === cueInainte, JSON.stringify(w.jurnal('cue').map(c => c.boxNum)));
  ok('virajele rătăcite nu mai sincronizează nimic (în teren: boxul 17, −133 m)',
     w.jurnal('snap_ignorat_offroute').length >= 1 &&
     !w.jurnal('sync').some(e => e.boxNum === 17), JSON.stringify(w.jurnal('sync')));
  const tIntrare = w.jurnal('offroute_intrare')[0].t;
  ok('după declarare nu se mai plânge de desincronizare — se știe deja',
     !w.jurnal('desync_warn').some(e => e.t > tIntrare), JSON.stringify(w.jurnal('desync_warn')));
}

console.log('\n═══ Ghidajul înapoi: distanță + direcție față de botul mașinii ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  w.viraj(270, 0);
  const o = w.m.M.offRoute;
  ok('ecranul are distanța în linie dreaptă', o && o.distM > 100 && o.distM < 1200, JSON.stringify(o));
  ok('și unghiul față de direcția de mers', o && typeof o.relDeg === 'number', JSON.stringify(o));
  const ghid = w.said.filter(s => /^Boxul 12 la /.test(s.t));
  ok('vocea spune unde e punctul, în cuvinte de pilot',
     ghid.length >= 1 && /(în față|la dreapta|la stânga|în spate)/.test(ghid[0].t),
     JSON.stringify(ghid.map(s => s.t)));
  ok('și nu turuie: cel mult un anunț la 12 s',
     ghid.length <= 3, JSON.stringify(ghid.map(s => s.t)));
}

console.log('\n═══ Prinderea: te întorci la punct și cursa continuă ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  w.viraj(270, 0);
  ok('suntem pe dinafară', !!w.m.M.offRoute);
  const kmRatacit = w.m.M.routeKm;
  // întoarcere spre punctul de reintrare, ghidat de ce arată aplicația pe ecran
  w.spre(w.m.M.offRoute.pct, w.m.M.offRoute.distM - 25);   // până în raza de prindere
  ok('te-a prins la punctul de reintrare', !w.m.M.offRoute, JSON.stringify(w.m.M.offRoute));
  ok('și o spune cu boxul cu tot',
     w.said.some(s => /Te-am prins, continuăm de la boxul 12\./.test(s.t)),
     JSON.stringify(w.said.slice(-4).map(s => s.t)));
  ok('poziția revine la boxul 12, nu rămâne rătăcită',
     Math.abs(w.m.M.routeKm - 3.55) < 0.05, `${kmRatacit.toFixed(2)} → ${w.m.M.routeKm.toFixed(2)}`);
  ok('ieșirea din stare e în jurnal, cu cât s-a rătăcit',
     w.jurnal('offroute_iesire').length === 1 && w.jurnal('offroute_iesire')[0].ratacitM > 0,
     JSON.stringify(w.jurnal('offroute_iesire')));
}

console.log('\n═══ Alarme false: ce NU trebuie să declare ieșirea de pe traseu ═══');
{
  // 1. traseul condus CORECT — inclusiv un viraj pe care detectorul nu-l vede
  const w = lume();
  panaLaBoxul12(w, { rateaza: false });
  ok('drumul corect nu declară niciodată ieșire', !w.m.M.offRoute,
     JSON.stringify({ semne: w.jurnal('offroute_semn'), off: w.m.M.offRoute }));

  // 2. virajul făcut prea încet ca să fie detectat (măsurat 03.08: sub 8 km/h,
  //    detectorul nu se trezește) — mașina a virat, deci NU e semn
  const w2 = lume();
  w2.drept(190, 0);
  for (const h of [20, 45, 70, 90, 110, 140, 170, 200, 230, 260, 270]) w2.pas(2, h);
  w2.drept(300, 270);
  ok('un viraj real, dar nedetectat, nu produce semn de ratare',
     !w2.jurnal('offroute_semn').some(s => s.tip === 'manevra_neconfirmata'),
     JSON.stringify(w2.jurnal('offroute_semn')));

  // 3. GPS mort: în teren au fost două găuri de 16 s exact în secvența asta
  const w3 = lume();
  panaLaBoxul12(w3);
  w3.salt(16000);                  // fixurile se opresc 16 s
  w3.viraj(270, 0);                // primul fix de după gaură aduce și virajul
  ok('nu se declară pe primul fix după o gaură de GPS',
     !w3.m.M.offRoute, JSON.stringify(w3.jurnal('offroute_semn')));
  w3.drept(500, 0);                // …dar după ce semnalul se așază, da
  ok('…dar se declară după ce semnalul s-a așezat', !!w3.m.M.offRoute);

  // 4. setarea oprită din panoul de pregătire
  const w4 = lume(TRESOR, { offRoute: false });
  panaLaBoxul12(w4);
  w4.viraj(270, 0);
  w4.drept(600, 0);
  ok('cu detectarea oprită, nimic nu se schimbă', !w4.m.M.offRoute &&
     w4.jurnal('offroute_semn').length === 0, JSON.stringify(w4.jurnal('offroute_semn')));
}

console.log('\n═══ Butonul apăsat în primul minut (tura poligon, 18:01) ═══');
{
  // În teren: apăsat de trei ori în 32 de secunde, la 300-800 m de la plecare. De
  // fiecare dată „N-am de unde să te iau înapoi — n-am destul drum în memorie", iar
  // aplicația a continuat să dicteze viraje („stânga acum" la 18:01:27, „dreapta acum"
  // la 18:01:53) pentru un traseu pe care mașina nu se afla.
  const w = lume();
  w.drept(120, 0);                 // cât condusese când a apăsat prima dată
  ok('butonul reușește — înghețarea nu depinde de date',
     w.m.offRouteManual() === true && !!w.m.M.offRoute, JSON.stringify(w.m.M.offRoute));
  ok('și are ce arăta: punctul de plecare, la 120 m în spate',
     w.m.M.offRoute.orb === false && w.m.M.offRoute.boxNum === 1 &&
     Math.abs(w.m.M.offRoute.distM - 120) < 25, JSON.stringify(w.m.M.offRoute));
  ok('nicăieri mesajul vechi, „n-am destul drum în memorie"',
     !w.said.some(s => /destul drum în memorie/.test(s.t)),
     JSON.stringify(w.said.slice(-2).map(s => s.t)));
  const cueInainte = w.jurnal('cue').length;
  w.drept(400, 0); w.viraj(0, 90); w.drept(300, 90);
  ok('și, esențial, nu mai dictează niciun viraj după apăsare',
     w.jurnal('cue').length === cueInainte, JSON.stringify(w.jurnal('cue').map(c => c.boxNum)));

  // cazul chiar fără nimic în memorie: GPS-ul n-a prins încă niciun fix
  const w2 = lume(TRESOR, {}, { faraFix: true });
  ok('fără nicio poziție, butonul tot îngheață planul',
     w2.m.offRouteManual() === true && w2.m.M.offRoute.orb === true,
     JSON.stringify(w2.m.M.offRoute));
  ok('iar mesajul spune CE lipsește și ce să facă',
     w2.said.some(s => /Fără harta traseului nu știu unde e boxul/.test(s.t)) &&
     w2.said.some(s => /SUNT LA BOX/.test(s.t)),
     JSON.stringify(w2.said.map(s => s.t)));
}

console.log('\n═══ Butonul: pilotul știe primul ═══');
{
  const w = lume();
  w.drept(190, 0);
  w.viraj(0, 270);
  w.drept(400, 270);
  ok('„am greșit drumul" declară pe loc, fără să aștepte două semne',
     w.m.offRouteManual() === true && !!w.m.M.offRoute, JSON.stringify(w.m.M.offRoute));
  ok('intrarea e marcată ca manuală în jurnal',
     w.jurnal('offroute_intrare').some(e => e.cum === 'manual'),
     JSON.stringify(w.jurnal('offroute_intrare')));
  w.m.offRouteRevenit();
  ok('și „am revenit" repune cursa pe traseu', !w.m.M.offRoute &&
     w.said.some(s => /Te-am prins/.test(s.t)), JSON.stringify(w.said.slice(-2).map(s => s.t)));
}

// ══════════════════════════════════════════════════════════════════════════════
// CITY DEMO SIBIU, 06.08.2026 — ținta care sare între două boxuri opuse
// ══════════════════════════════════════════════════════════════════════════════
// Ce s-a întâmplat, din jurnalul real (jurnale/2026-08-06.json, după 19:13): 36 de
// boxuri, 3,7 km prin centrul vechi, harta COMPLET GOALĂ (0 ancore) — deci punctele de
// reintrare veneau numai din firimituri. Manevra de la boxul 10 a fost ratată, iar în
// trei minute ținta a sărit de trei ori între boxul 10 și boxul 9:
//   19:18:14  boxul 10 → boxul 9,  711 m, inFata true
//   19:18:29  boxul 9  → boxul 10, 373 m, inFata false
//   19:19:32  boxul 10 → boxul 9,  798 m, inFata true
//   19:21:03  ieșire manuală, la boxul 9, după 1094 m rătăciți
// Cele două boxuri sunt în direcții OPUSE pe traseu (0,62 km și 1,05 km), iar regula
// „în față bate aproape" își schimba răspunsul la fiecare cotitură prin oraș.
//
// Și ce a auzit Andreas, de opt ori la rând: „Boxul 10 la 240 de metri, în spate."
// Nicio vorbă despre CE e boxul 10 — deși roadbook-ul scria „GIRATORIU-2 ·
// Str. Constituției", iar aplicația avea textul de la scanare.
//
// Fixtura de mai jos are DOAR num, sumKm, dir și comment pentru boxurile 8-12, exact
// cum sunt în roadbook-ul de la Sibiu. Coordonatele reale nu intră în teste.
const SIBIU = sanitizeBoxes([
  { num: 8,  sumKm: 0.55, dir: 'DREAPTA',     comment: 'Tribunalul și Judecătoria Sibiu' },
  { num: 9,  sumKm: 0.62, dir: 'GIRATORIU-1', comment: 'Str. Nicolae Teclu' },
  { num: 10, sumKm: 1.05, dir: 'GIRATORIU-2', comment: 'Str. Constituției' },
  { num: 11, sumKm: 1.22, dir: 'ÎNAINTE',     comment: 'Str. Constituției' },
  { num: 12, sumKm: 1.33, dir: 'ÎNAINTE',     comment: 'Str. Constituției' }
]);

// Drumul CORECT până imediat înainte de boxul 10, apoi mașina merge drept peste el.
// Boxurile 8 și 9 sunt la 70 m unul de altul, deci în teren sunt un singur cot —
// aici la fel: un singur viraj de 77 m le acoperă pe amândouă, iar detectorul îl
// leagă de boxul 9 (sync, how: turn). Fără cotul ăsta, aplicația ar declara pe bună
// dreptate două manevre ratate și n-am mai ajunge la cazul care ne interesează.
function panaDupaBoxul10(w) {
  w.drept(540, 0);                 // start → boxul 8 (km 0,55), cap nord
  const d = ((90 - 0 + 540) % 360 - 180) / 7;
  for (let i = 1; i <= 7; i++) w.pas(11, 0 + d * i);   // cotul de la boxurile 8-9
  w.drept(480, 90);                // mai departe spre est, până la km ~1,10
}

console.log('\n═══ Sibiu: ținta nu se mai întoarce la boxul tocmai părăsit ═══');
{
  const w = lume(SIBIU);
  panaDupaBoxul10(w);
  ok('drumul până aici e curat: nicio manevră declarată ratată',
     w.jurnal('offroute_semn').length === 0 && !w.m.M.offRoute,
     JSON.stringify(w.jurnal('offroute_semn')));

  w.m.offRouteManual();            // ca în teren: pilotul își dă seama primul
  ok('ținta de plecare e boxul 10, în spate (în teren: boxul 10, 114 m, inFata false)',
     w.m.M.offRoute.boxNum === 10 && w.m.M.offRoute.inFata === false,
     JSON.stringify({ box: w.m.M.offRoute.boxNum, d: w.m.M.offRoute.distM,
                      inFata: w.m.M.offRoute.inFata }));

  // REJUCAREA celor trei reevaluări, pe capete compas: est = ambele boxuri în spate,
  // vest = ambele în față. Fiecare bucată de drum durează peste OFF_REEVAL_MS (15 s),
  // deci fiecare declanșează exact o reevaluare.
  w.drept(400, 90);                // 1) mai departe: ținta rămâne boxul 10
  ok('cât merge înainte, ținta nu se schimbă degeaba', w.m.M.offRoute.boxNum === 10,
     JSON.stringify(w.jurnal('offroute_tinta_noua')));
  w.drept(200, 270);               // 2) întoarce: ambele boxuri devin „în față"
  ok('prima comutare TRECE: boxul 10 → boxul 9 (în teren, 19:18:14)',
     w.m.M.offRoute.boxNum === 9, JSON.stringify(w.jurnal('offroute_tinta_noua')));
  w.drept(200, 90);                // 3) se învârte iar: boxul 10 redevine cel mai aproape
  ok('a doua comutare e BLOCATĂ: boxul 10 a fost părăsit acum câteva secunde',
     w.m.M.offRoute.boxNum === 9, JSON.stringify(w.jurnal('offroute_tinta_blocata')));
  w.drept(200, 270);               // 4) și încă o cotitură
  ok('a treia nu mai e o comutare: ținta e deja boxul 9',
     w.m.M.offRoute.boxNum === 9, JSON.stringify(w.jurnal('offroute_tinta_noua')));

  const noi = w.jurnal('offroute_tinta_noua'), blocate = w.jurnal('offroute_tinta_blocata');
  ok('bilanțul: O SINGURĂ comutare, în loc de trei', noi.length === 1,
     JSON.stringify(noi.map(e => `${e.deLaBox}→${e.laBox}`)));
  ok('și e chiar cea bună: 10 → 9, boxul la care Andreas a reintrat pe traseu',
     noi[0] && noi[0].deLaBox === 10 && noi[0].laBox === 9, JSON.stringify(noi));
  ok('refuzul e scris în jurnal, cu boxul respins și de câte secunde',
     blocate.length >= 1 && blocate[0].respins === 10 && blocate[0].tinta === 9 &&
     blocate[0].deS < 60, JSON.stringify(blocate));
  ok('nimic din regula de alegere n-a fost schimbat: comutarea permisă e tot spre „în față"',
     noi[0] && noi[0].inFata === true, JSON.stringify(noi));
}

console.log('\n═══ Sibiu: 60 de secunde e o AMÂNARE, nu o interdicție ═══');
{
  // Pragul apără de oscilația de busolă, nu de o schimbare reală de plan. După ce
  // fereastra trece, ținta are voie să se întoarcă unde arată regula.
  const w = lume(SIBIU);
  panaDupaBoxul10(w);
  w.m.offRouteManual();
  w.drept(400, 90);
  w.drept(200, 270);               // comutare 10 → 9
  ok('ținta e boxul 9', w.m.M.offRoute.boxNum === 9);
  w.salt(61000);                   // trece fereastra de 60 s
  w.drept(200, 90);                // și abia acum se cere înapoi boxul 10
  ok('după 60 de secunde, întoarcerea la boxul 10 e permisă',
     w.m.M.offRoute.boxNum === 10,
     JSON.stringify({ noi: w.jurnal('offroute_tinta_noua'),
                      blocate: w.jurnal('offroute_tinta_blocata') }));
}

console.log('\n═══ Sibiu: ghidajul spune CE E boxul, nu doar cât și încotro ═══');
{
  const w = lume(SIBIU);
  panaDupaBoxul10(w);
  w.m.offRouteManual();
  const intrare = w.said.filter(s => /Ai ieșit de pe traseu/.test(s.t));
  ok('anunțul de intrare are direcția boxului, în vorbă de om',
     intrare.length === 1 && /giratoriu, ieșirea 2/.test(intrare[0].t),
     JSON.stringify(intrare.map(s => s.t)));
  ok('și reperul din roadbook — singurul lucru pe care îl poate recunoaște pe stradă',
     intrare[0] && /Str\. Constituției/.test(intrare[0].t), intrare[0] && intrare[0].t);
  ok('descrierea e și pe ecran, nu doar în difuzor',
     w.m.M.offRoute.descriere === 'giratoriu, ieșirea 2, Str. Constituției',
     JSON.stringify(w.m.M.offRoute.descriere));

  w.drept(400, 90);
  const ghid = w.said.filter(s => /^Boxul 10 la /.test(s.t));
  ok('rostirile care urmează pe ACEEAȘI țintă nu mai repetă descrierea',
     ghid.length >= 1 && ghid.every(s => !/giratoriu/.test(s.t)),
     JSON.stringify(ghid.map(s => s.t)));
  ok('ele rămân forma scurtă: box, distanță, direcție',
     ghid.every(s => /^Boxul 10 la .+, (în|la|drept) .+\.$/.test(s.t)),
     JSON.stringify(ghid.map(s => s.t)));

  w.drept(200, 270);               // ținta devine boxul 9
  ok('ținta s-a schimbat pe boxul 9', w.m.M.offRoute.boxNum === 9,
     JSON.stringify(w.jurnal('offroute_tinta_noua')));
  w.drept(150, 300);               // încă puțin drum, cât să încapă o rostire (12 s)
  const ghid9 = w.said.filter(s => /^Boxul 9 la /.test(s.t));
  ok('la SCHIMBAREA țintei, descrierea se reia — e vorba despre alt loc',
     ghid9.length >= 1 && /giratoriu, ieșirea 1, Str\. Nicolae Teclu/.test(ghid9[0].t),
     JSON.stringify(ghid9.map(s => s.t)));
  ok('și doar la prima rostire pe ținta nouă',
     ghid9.filter(s => /giratoriu/.test(s.t)).length === 1,
     JSON.stringify(ghid9.map(s => s.t)));

  // fraza trebuie să încapă între două rostiri (OFF_VORBA_MS = 12 s), la 90 ms/caracter
  const lunga = ghid9.find(s => /giratoriu/.test(s.t));
  ok('fraza lungă tot încape în fereastra de 12 secunde a ghidajului',
     lunga && (350 + lunga.t.length * 90) < 12000,
     lunga && `${Math.round((350 + lunga.t.length * 90) / 100) / 10} s · ${lunga.t}`);
}

console.log('\n═══ Sibiu: butonul „unde sunt" răspunde cu locul, nu cu o cifră ═══');
{
  const w = lume(SIBIU);
  panaDupaBoxul10(w);
  w.m.offRouteManual();
  const r = w.m.undeSunt();
  ok('„Nu ești pe traseu" spune și ce e boxul de reintrare',
     /^Nu ești pe traseu\./.test(r.text) && /giratoriu, ieșirea 2, Str\. Constituției/.test(r.text),
     r.text);
}

console.log('\n═══ Un box fără direcție și fără comentariu: rămâne forma veche ═══');
{
  const GOL = sanitizeBoxes([
    { num: 8,  sumKm: 0.55, dir: 'DREAPTA', comment: 'Tribunalul și Judecătoria Sibiu' },
    { num: 9,  sumKm: 0.62, dir: 'GIRATORIU-1', comment: 'Str. Nicolae Teclu' },
    { num: 10, sumKm: 1.05, dir: 'ÎNAINTE', comment: '' },
    { num: 11, sumKm: 1.22, dir: 'ÎNAINTE', comment: '' }
  ]);
  const w = lume(GOL);
  panaDupaBoxul10(w);
  w.m.offRouteManual();
  ok('ținta e tot boxul 10', w.m.M.offRoute.boxNum === 10, JSON.stringify(w.m.M.offRoute));
  ok('n-are ce descrie, deci nu inventează nimic', w.m.M.offRoute.descriere == null,
     JSON.stringify(w.m.M.offRoute.descriere));
  ok('și fraza e exact cea de până acum',
     w.said.some(s => /^Ai ieșit de pe traseu\. Prinde traseul la boxul 10\.$/.test(s.t)),
     JSON.stringify(w.said.filter(s => /traseu/.test(s.t)).map(s => s.t)));
  w.drept(300, 90);
  const ghid = w.said.filter(s => /^Boxul 10 la /.test(s.t));
  ok('ghidajul rămâne „box, distanță, direcție"',
     ghid.length >= 1 && ghid.every(s => /^Boxul 10 la .+\.$/.test(s.t) && !/—/.test(s.t)),
     JSON.stringify(ghid.map(s => s.t)));
}

console.log('\n═══ Reperul lung se scurtează, nu se rostește întreg ═══');
{
  const LUNG = sanitizeBoxes([
    { num: 8,  sumKm: 0.55, dir: 'DREAPTA', comment: 'Tribunalul și Judecătoria Sibiu' },
    { num: 9,  sumKm: 0.62, dir: 'GIRATORIU-1', comment: 'Str. Nicolae Teclu' },
    { num: 10, sumKm: 1.05, dir: 'GIRATORIU-2',
      comment: 'Bulevardul General Ion Dragalina Prelungirea Sudului Est · nu opri · atenție la tramvai' },
    { num: 11, sumKm: 1.22, dir: 'ÎNAINTE', comment: '' }
  ]);
  const w = lume(LUNG);
  panaDupaBoxul10(w);
  w.m.offRouteManual();
  const d = w.m.M.offRoute.descriere || '';
  ok('descrierea începe tot cu direcția', /^giratoriu, ieșirea 2, /.test(d), d);
  ok('reperul e tăiat sub 40 de caractere', d.replace(/^giratoriu, ieșirea 2, /, '').length <= 40, d);
  ok('și tăietura cade între cuvinte, nu în mijlocul unuia',
     !/\s$/.test(d) && d.split(' ').every(x => x.length > 0), JSON.stringify(d));
  ok('nimic din coada comentariului nu ajunge în difuzor',
     !/nu opri|tramvai/.test(d), d);
}

// ═════════════════════════════════════════════════════════════════════════════
// v47 — „SUNT LA BOX N" ÎN OFF-ROUTE E REINTRARE, NU O CERERE DE CONFIRMARE
//
// Raportat de Andreas din mașină, 08.08.2026: a ales boxul de trei ori la rând, plus l-a
// scris de mână, și vocea a continuat „boxul 39 în spate la un kilometru". În jurnalul zilei
// se vede exact asta:
//   13:13:04  sync_refuzat {boxNum: 43, deltaM: -1192}
//   13:13:05  sync_refuzat {boxNum: 43, deltaM: -1200}
//   13:13:06  sync_refuzat {boxNum: 43, deltaM: -1207}
//   13:13:05  „Boxul 39 la un kilometru, drept în față."
// Trei apăsări în trei secunde, poziția nemișcată, ghidajul netulburat.
//
// Poarta care refuza era corectă în principiu — o apăsare accidentală mutase odată poziția
// cu 1330 m în plină probă — dar pusă în locul greșit: ÎN off-route un salt de un kilometru
// nu e un accident, e chiar informația. Pilotul s-a rătăcit un kilometru și îmi spune unde
// a ajuns. Cerându-i confirmarea, aplicația trata cel mai puternic semnal uman care există
// ca pe o greșeală de deget — și nu-i spunea nici de ce.
console.log('\n═══ ACCEPTARE: trei alegeri ale aceluiași box, în off-route (08.08) ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  w.m.offRouteManual();
  ok('mașina e în off-route', !!w.m.M.offRoute, JSON.stringify(w.m.M.offRoute && w.m.M.offRoute.boxNum));
  w.drept(900, 270);                     // se rătăcește mai departe, ca în teren
  const delta = w.m.previzualizeazaBox(9).deltaM;
  ok('saltul cerut e mare — exact felul de salt care era refuzat până acum',
     Math.abs(delta) > 400, `${delta} m`);

  // PRIMA alegere. Fără `confirmat`, ca la numărul tastat — calea care în jurnal a produs
  // trei `sync_refuzat` la rând.
  const r1 = w.m.atBox(9);
  ok('prima alegere e ACCEPTATĂ, nu întoarsă ca previzualizare', r1 === true, JSON.stringify(r1));
  ok('a ieșit din off-route din prima apăsare', !w.m.M.offRoute);
  ok('și poziția e CHIAR la boxul ales, nu la ținta calculată de aplicație',
     Math.abs(w.m.M.routeKm - 2.83) < 0.03, w.m.M.routeKm.toFixed(3));
  const ies = w.jurnal('offroute_iesire');
  ok('ieșirea e jurnalizată cu motivul nou', ies.length === 1 && ies[0].cum === 'sunt_la_box',
     JSON.stringify(ies));
  ok('și spune că boxul a fost ALES de om, nu dedus',
     ies[0].ales === true && ies[0].boxNum === 9, JSON.stringify(ies[0]));
  ok('vocea confirmă cu numărul boxului lui',
     w.said.some(s => /Te-am prins, continuăm de la boxul 9\./.test(s.t)),
     JSON.stringify(w.said.slice(-3).map(s => s.t)));
  ok('ZERO `sync_refuzat` — nicio apăsare aruncată',
     w.jurnal('sync_refuzat').length === 0, JSON.stringify(w.jurnal('sync_refuzat')));
  ok('ZERO `snap_ignorat_offroute`',
     w.jurnal('snap_ignorat_offroute').length === 0,
     JSON.stringify(w.jurnal('snap_ignorat_offroute')));

  // A DOUA și A TREIA apăsare: omul apasă din reflex, fiindcă în mașină nu te uiți la ecran.
  // Nu mai sunt în off-route, deci trec pe calea normală — și acolo poarta veche e la locul
  // ei: saltul e acum mic (ești deja la box), deci se aplică tăcut, fără dialog.
  const r2 = w.m.atBox(9);
  const r3 = w.m.atBox(9);
  ok('a doua și a treia apăsare nu strică nimic',
     r2 === true && r3 === true, JSON.stringify([r2, r3]));
  ok('poziția a rămas la boxul 9', Math.abs(w.m.M.routeKm - 2.83) < 0.03, w.m.M.routeKm.toFixed(3));
  ok('și tot nu s-a produs niciun refuz tăcut', w.jurnal('sync_refuzat').length === 0);
}

console.log('\n═══ Aceeași purtare și pentru boxul ALES DIN LISTĂ (confirmat) ═══');
{
  const w = lume();
  panaLaBoxul12(w);
  w.m.offRouteManual();
  w.drept(900, 270);
  ok('cu `confirmat=true` e tot reintrare, nu snap orb', w.m.atBox(9, true) === true);
  ok('a ieșit din off-route', !w.m.M.offRoute);
  ok('cu același motiv în jurnal',
     w.jurnal('offroute_iesire')[0].cum === 'sunt_la_box');
}

console.log('\n═══ Singurul refuz care rămâne se SPUNE, nu se tace ═══');
{
  // Un salt care ar închide o probă în curs nu se mai poate desface. Aici refuzul e
  // legitim — dar până la v47 era mut, iar omul apăsa la nesfârșit fără să afle de ce.
  const w = lume(TRESOR, {}, {});
  panaLaBoxul12(w, { rateaza: false });
  // intrăm forțat în probă, apoi declarăm off-route din buton (se poate: pilotul știe primul)
  w.m.offRouteManual();
  const inRt = !!w.m.M.rt;
  if (!inRt) {
    // fixtura n-are probe (sunt scoase din TRESOR), deci cazul se verifică pe poarta însăși:
    // fără probă în curs, nu există `rupeRt`, deci nu există refuz — și asta e de dovedit.
    ok('fără probă în curs nu există niciun motiv de refuz',
       w.m.previzualizeazaBox(9).rupeRt === null,
       JSON.stringify(w.m.previzualizeazaBox(9)));
    ok('deci alegerea trece', w.m.atBox(9) === true);
  }
  // Textul refuzului se verifică pe SURSĂ: cazul are nevoie de o probă în curs simultan cu
  // off-route, ceea ce fixtura asta (fără probe) nu poate produce. Ce se poate dovedi aici
  // e că refuzul nu e mut și că spune cele două lucruri care contează — ce strică și ce să
  // apese în loc. Fără asta ar fi doar o promisiune dintr-un comentariu.
  const src = readFileSync(join(aici, '..', 'js', 'machine.js'), 'utf8');
  const poarta = /if \(M\.offRoute\) \{[\s\S]*?iesiOffRoute\('sunt_la_box'/.exec(src)[0];
  ok('refuzul e legat DOAR de proba în curs, nu de mărimea saltului',
     /if \(p\.rupeRt && confirmat !== true\)/.test(poarta) && !/p\.mare/.test(poarta), poarta.slice(0, 200));
  ok('și e ROSTIT, nu doar jurnalizat', /say\(`Nu pot să te mut la boxul \$\{num\}/.test(poarta));
  ok('numește ce strică — chiar textul probei', /\$\{p\.rupeRt\}/.test(poarta));
  ok('și spune alternativa, pe nume',
     /AM REVENIT PE TRASEU/.test(poarta), poarta.slice(-260));
  ok('iar `sync_refuzat` din off-route e marcat ca atare în jurnal',
     /inOffRoute: true/.test(poarta));
}

console.log('\n═══ „AM REVENIT" în starea oarbă nu mai crapă ═══');
{
  // Starea „oarbă" (nici hartă, nici drum în memorie) n-avea țintă, deci n-avea nici index —
  // iar `snapToBox(null)` arunca pe `plan.boxes[null].sumKm`. Adică butonul se putea apăsa
  // exact atunci când aplicația nu știa unde e, și cădea.
  const w = lume(TRESOR, {}, { faraFix: true });
  w.m.offRouteManual();
  ok('off-route pornit orb', w.m.M.offRoute && w.m.M.offRoute.orb === true,
     JSON.stringify(w.m.M.offRoute));
  let crapat = null;
  try { w.m.offRouteRevenit(); } catch (e) { crapat = e.message; }
  ok('„AM REVENIT" nu mai arunca', crapat === null, String(crapat));
  ok('și tot iese din off-route', !w.m.M.offRoute);
  ok('spunând ce poate face omul mai departe',
     w.said.some(s => /apasă SUNT LA BOX/i.test(s.t)), JSON.stringify(w.said.map(s => s.t)));
  ok('iar jurnalul marchează ieșirea fără box',
     w.jurnal('offroute_iesire_fara_box').length === 1,
     JSON.stringify(w.jurnal('offroute_iesire_fara_box')));
}

console.log('\n═══ Detectorul de viraje NU mai tace, dar nici nu teleportează ═══');
{
  // 08.08, 13:12:52: `snap_ignorat_offroute {distM: 1079}`. Un snap acolo ar fi mutat mașina
  // un kilometru pe baza unui viraj — exact defectul din Dumbrăvița. Deci refuzul rămâne;
  // ce se schimbă e că pilotul aude o dată de ce nu se întâmplă nimic.
  const w = lume();
  panaLaBoxul12(w);
  w.m.offRouteManual();
  w.drept(1000, 270);
  w.viraj(270, 0);                       // viraj departe de ținta de reintrare
  const ign = w.jurnal('snap_ignorat_offroute');
  if (ign.length) {
    ok('refuzul e tot jurnalizat, cu distanța', ign[0].distM != null, JSON.stringify(ign[0]));
    ok('și acum se aude, o singură dată, oricâte viraje ar urma',
       w.said.filter(s => /nu te mut singur/.test(s.t)).length === 1,
       JSON.stringify(w.said.filter(s => /nu te mut singur/.test(s.t)).map(s => s.t)));
    ok('fraza îi spune ce POATE apăsa',
       w.said.some(s => /alege-l din SUNT LA BOX/.test(s.t)));
    ok('și e pe clasa „ritm" — nu taie o manevră',
       w.said.filter(s => /nu te mut singur/.test(s.t)).every(s => s.cls === 'ritm' || s.cl === 'ritm'),
       JSON.stringify(w.said.filter(s => /nu te mut singur/.test(s.t))));
    ok('poziția NU s-a mutat de la sine', !!w.m.M.offRoute);
  } else {
    ok('(detectorul n-a produs niciun viraj în fixtura asta — nimic de verificat)', true);
  }
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
