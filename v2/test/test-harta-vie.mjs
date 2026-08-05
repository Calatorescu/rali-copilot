// RALI 2 — HARTA VIE: geometria care se poate greși în tăcere.
//
// Ecranul de hartă e singurul loc din aplicație unde o eroare de câțiva pixeli arată
// exact ca o coordonată greșită — iar pe drum nu se poate distinge între ele. De-aia
// tot ce se poate calcula se calculează în funcții pure și se verifică aici: proiecția,
// alegerea dalelor, decizia de zoom, linia traseului, coridorul de descărcare.
// Randarea propriu-zisă (canvas, imagini, rețea) NU se testează — ea se vede.
//
// Fixturile: latitudini reale ca ordin de mărime (45-46°, cât România), longitudini
// DEPLASATE cu −10 ca peste tot în suită. Deplasarea constantă păstrează geometria
// (distanțele și azimuturile depind de diferențe și de cos(latitudine), neschimbate),
// dar niciun punct nu arată spre o adresă reală.
import { lumePx, lumeLatLng, metriPePixel, daleVizibile, parinteDala, zoomAuto,
         ecranDinLume, traseuDinPlan, pozitiiBoxuri, tipBox,
         deEvacuat, urlDala, DALA_PX, DALE_LIMITA,
         OSM_SABLON } from '../js/harta-vie.js';
import { buildTrace, haversineM } from '../js/geo.js';
import { makeAnchorMap, sanitizeBoxes, buildPlan } from '../js/route.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const LAT = 45.7823, LNG = 14.1461;          // longitudine deplasată cu −10
const m2g = (lat, lng, m, deg) => {
  const r = deg * Math.PI / 180;
  return { lat: lat + (m * Math.cos(r)) / 111320,
           lng: lng + (m * Math.sin(r)) / (111320 * Math.cos(lat * Math.PI / 180)) };
};

console.log('\n═══ Proiecția: dus-întors, fără pierdere ═══');
{
  ok('la zoom 0 lumea are exact o dală', DALA_PX * 2 ** 0 === 256);
  const c = lumePx(0, 0, 0);
  ok('punctul (0,0) cade în centrul dalei de la zoom 0',
     Math.abs(c.x - 128) < 1e-9 && Math.abs(c.y - 128) < 1e-9, JSON.stringify(c));
  for (const z of [12, 14, 15, 17]) {
    const p = lumePx(LAT, LNG, z);
    const back = lumeLatLng(p.x, p.y, z);
    ok(`z${z}: lat/lng → pixel → lat/lng revine sub 0,1 m`,
       haversineM(LAT, LNG, back.lat, back.lng) < 0.1,
       `${haversineM(LAT, LNG, back.lat, back.lng).toFixed(4)} m`);
  }
  ok('longitudinea crește spre est, latitudinea scade spre sud (y crește)',
     lumePx(LAT, LNG + 0.01, 15).x > lumePx(LAT, LNG, 15).x &&
     lumePx(LAT - 0.01, LNG, 15).y > lumePx(LAT, LNG, 15).y);
  // scara: la 45° și z15 un pixel are ~3,3 m, deci o dală de 256 px ~850 m
  const mpp = metriPePixel(LAT, 15);
  ok('la z15 un pixel are între 3 și 3,6 m', mpp > 3 && mpp < 3.6, `${mpp.toFixed(2)} m/px`);
  ok('fiecare zoom în minus dublează metrii pe pixel',
     Math.abs(metriPePixel(LAT, 14) / mpp - 2) < 1e-9);
  // verificare independentă a scării: 100 m măsurați cu haversine = 100 m în pixeli
  {
    const a = lumePx(LAT, LNG, 15), b0 = m2g(LAT, LNG, 100, 90), b = lumePx(b0.lat, b0.lng, 15);
    ok('100 m spre est înseamnă 100/mpp pixeli (±1%)',
       Math.abs((b.x - a.x) * mpp - 100) < 1, `${((b.x - a.x) * mpp).toFixed(2)} m`);
  }
}

console.log('\n═══ Dalele de pe ecran: acoperă tot, centrul primul ═══');
{
  const v = daleVizibile({ lat: LAT, lng: LNG, z: 15, latimePx: 400, inaltimePx: 700 });
  ok('un ecran de 400×700 la z15 cere între 4 și 12 dale',
     v.dale.length >= 4 && v.dale.length <= 12, `${v.dale.length} dale`);
  ok('prima dală cerută e cea de sub mașină',
     v.dale[0].x === Math.floor(v.centru.x / DALA_PX) &&
     v.dale[0].y === Math.floor(v.centru.y / DALA_PX), JSON.stringify(v.dale[0]));
  ok('toate dalele au zoom-ul cerut', v.dale.every(d => d.z === 15));
  ok('nu se cere aceeași dală de două ori',
     new Set(v.dale.map(d => `${d.x}/${d.y}`)).size === v.dale.length);
  const r = daleVizibile({ lat: LAT, lng: LNG, z: 15, latimePx: 400, inaltimePx: 700, rotit: true });
  ok('harta ROTITĂ cere mai multe dale (colțurile nu rămân goale)',
     r.dale.length > v.dale.length, `${r.dale.length} vs ${v.dale.length}`);
  ok('și le cuprinde pe toate cele de la harta nerotită',
     v.dale.every(d => r.dale.some(q => q.x === d.x && q.y === d.y)));
  // marginea lumii: la longitudine +180 dalele se închid, nu ies din interval
  const m = daleVizibile({ lat: 0, lng: 179.99, z: 3, latimePx: 800, inaltimePx: 800 });
  ok('la marginea lumii indexul de dală rămâne în interval',
     m.dale.every(d => d.x >= 0 && d.x < 8 && d.y >= 0 && d.y < 8),
     JSON.stringify(m.dale.filter(d => d.x < 0 || d.x >= 8)));
  ok('adresa dalei se construiește din șablon',
     urlDala(17600, 11900, 15) === 'https://tile.openstreetmap.org/15/17600/11900.png',
     urlDala(17600, 11900, 15));
  ok('șablonul e OpenStreetMap, fără cheie și fără cont',
     /^https:\/\/tile\.openstreetmap\.org\//.test(OSM_SABLON) && !/key|token|apikey/i.test(OSM_SABLON));
}

console.log('\n═══ Dala-părinte: harta nu rămâne neagră când lipsește o dală ═══');
{
  const p = parinteDala(17601, 11901, 16);
  ok('părintele lui (17601,11901)@16 e (8800,5950)@15',
     p.x === 8800 && p.y === 5950 && p.z === 15, JSON.stringify(p));
  ok('și se decupează sfertul potrivit (dreapta-jos)',
     p.sx === 128 && p.sy === 128 && p.marime === 128, JSON.stringify(p));
  const p2 = parinteDala(17600, 11900, 16);
  ok('dala pară decupează sfertul stânga-sus',
     p2.sx === 0 && p2.sy === 0, JSON.stringify(p2));
  const p3 = parinteDala(17601, 11901, 16, 2);
  ok('două niveluri în sus dau un sfert de sfert (64 px)',
     p3.z === 14 && p3.marime === 64, JSON.stringify(p3));
  ok('nu se urcă deasupra zoom-ului 0', parinteDala(0, 0, 0) === null);
}

console.log('\n═══ Zoom-ul automat: depărtat la viteză, apropiat la manevră ═══');
{
  ok('oprit în intersecție → cel mai apropiat', zoomAuto({ kmh: 0 }) === 17);
  ok('prin oraș, 25 km/h → z16', zoomAuto({ kmh: 25 }) === 16);
  ok('40 km/h → z15', zoomAuto({ kmh: 40 }) === 15);
  ok('70 km/h → z14', zoomAuto({ kmh: 70 }) === 14);
  ok('90 km/h → z13, cel mai depărtat', zoomAuto({ kmh: 90 }) === 13);
  ok('și nu coboară sub limita cerută', zoomAuto({ kmh: 200, min: 14 }) === 14);
  // histerezis: fără el, la 29-31 km/h harta ar sări între zoom-uri de câteva ori pe minut
  ok('la 32 km/h, venind de la z16, rămâne z16 (histerezis)',
     zoomAuto({ kmh: 32, zAnterior: 16 }) === 16);
  ok('dar la 38 km/h se predă și trece la z15',
     zoomAuto({ kmh: 38, zAnterior: 16 }) === 15);
  ok('și invers: la 27 km/h, venind de la z15, rămâne z15',
     zoomAuto({ kmh: 27, zAnterior: 15 }) === 15);
  ok('manevra la 120 m bate viteza: cel puțin z16',
     zoomAuto({ kmh: 70, distManevraM: 120 }) === 16);
  ok('dar o manevră la 800 m nu schimbă nimic',
     zoomAuto({ kmh: 70, distManevraM: 800 }) === 14);
  ok('manevra nu depărtează niciodată harta',
     zoomAuto({ kmh: 5, distManevraM: 50 }) === 17);
}

console.log('\n═══ Din lume pe ecran: mașina stă pe loc, lumea se învârte ═══');
{
  const V = { cx: 1000, cy: 2000, latimePx: 400, inaltimePx: 800, ancoraY: 496 };
  const eu = ecranDinLume(1000, 2000, V);
  ok('poziția mea cade exact în punctul de ancorare',
     eu.x === 200 && eu.y === 496, JSON.stringify(eu));
  const nord = ecranDinLume(1000, 1900, V);
  ok('nord-sus: un punct la 100 px nord apare cu 100 px mai sus',
     nord.x === 200 && nord.y === 396, JSON.stringify(nord));
  // mergând spre EST (heading 90°), rotația e −90°: ce e la est trebuie să apară ÎN FAȚĂ
  const rot = -Math.PI / 2;
  const est = ecranDinLume(1100, 2000, { ...V, rotRad: rot });
  ok('cu harta rotită după mașină, ce e la est apare drept în față',
     Math.abs(est.x - 200) < 1e-9 && Math.abs(est.y - 396) < 1e-9, JSON.stringify(est));
  const nord2 = ecranDinLume(1000, 1900, { ...V, rotRad: rot });
  ok('și ce e la nord apare la stânga',
     Math.abs(nord2.x - 100) < 1e-9 && Math.abs(nord2.y - 496) < 1e-9, JSON.stringify(nord2));
}

console.log('\n═══ Linia traseului: recunoașterea e linie plină, ancorele sunt punctate ═══');
{
  const BOXES = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START' },
    { num: 2, sumKm: 0.22, dir: 'STÂNGA', comment: 'stânga' },
    { num: 3, sumKm: 0.62, dir: 'DREAPTA', comment: 'dreapta' },
    { num: 4, sumKm: 1.02, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'start probă' },
    { num: 5, sumKm: 2.02, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'finish' }
  ]);
  const P2 = m2g(LAT, LNG, 220, 180), P3 = m2g(P2.lat, P2.lng, 400, 90);
  const P4 = m2g(P3.lat, P3.lng, 400, 90), P5 = m2g(P4.lat, P4.lng, 1000, 90);
  const HARTA = { 1: { lat: LAT, lng: LNG }, 2: P2, 3: P3, 4: P4, 5: P5 };

  const fara = traseuDinPlan(buildPlan(BOXES, {}, null, null));
  ok('fără nimic, nu se desenează nicio linie',
     fara.pts.length === 0 && fara.sursa === null, JSON.stringify(fara.sursa));

  const dinAncore = traseuDinPlan(buildPlan(BOXES, {}, null, HARTA));
  ok('din ancore ies 5 puncte, în ordinea kilometrajului',
     dinAncore.pts.length === 5, JSON.stringify(dinAncore.pts.length));
  ok('și e MARCATĂ ca aproximativă — se desenează punctat',
     dinAncore.sursa === 'ancore' && dinAncore.aproximativ === true, JSON.stringify(dinAncore.sursa));

  // urma de recunoaștere: puncte la 20 m, cu un cot, ca în teren
  const brut = [];
  let p = { lat: LAT, lng: LNG };
  for (let i = 0; i < 12; i++) { brut.push({ ...p }); p = m2g(p.lat, p.lng, 20, 180); }
  for (let i = 0; i < 100; i++) { brut.push({ ...p }); p = m2g(p.lat, p.lng, 20, 90); }
  const trace = buildTrace(brut);
  const recon = { trace, samples: [], anchors: [{ officialKm: 0, traceM: 0 },
                                                { officialKm: 2.02, traceM: trace.totalM }] };
  const plan = buildPlan(BOXES, {}, recon, HARTA);
  const dinRecon = traseuDinPlan(plan);
  ok('cu recunoaștere, linia e cea condusă, nu cea din ancore',
     dinRecon.sursa === 'recon' && dinRecon.pts.length === trace.pts.length,
     JSON.stringify({ sursa: dinRecon.sursa, n: dinRecon.pts.length }));
  ok('și NU e marcată aproximativă', dinRecon.aproximativ === false);

  const poz = pozitiiBoxuri(plan);
  ok('toate cele 5 boxuri primesc un punct pe hartă', poz.length === 5, JSON.stringify(poz.length));
  ok('și vin din recunoaștere, nu din ancore', poz.every(x => x.sursa === 'recon'));
  ok('boxul 1 e la începutul urmei',
     haversineM(poz[0].lat, poz[0].lng, LAT, LNG) < 15,
     `${haversineM(poz[0].lat, poz[0].lng, LAT, LNG).toFixed(1)} m`);
  // boxul 3 e la 620 m oficiali: pe urmă, la aceeași distanță (ancorele sunt 1:1 aici)
  ok('boxul 3 cade pe urmă la kilometrul lui, nu la capăt',
     Math.abs(haversineM(LAT, LNG, poz[2].lat, poz[2].lng) - 500) < 120,
     `${haversineM(LAT, LNG, poz[2].lat, poz[2].lng).toFixed(0)} m în linie dreaptă`);

  // fără recunoaștere, markerele cad pe ancorele geocodate
  const poz2 = pozitiiBoxuri(buildPlan(BOXES, {}, null, HARTA));
  ok('fără recunoaștere, markerele vin din hartă', poz2.length === 5 && poz2.every(x => x.sursa === 'harta'));
  const poz3 = pozitiiBoxuri(buildPlan(BOXES, {}, null, { 2: HARTA[2] }));
  ok('boxurile fără coordonată pur și simplu lipsesc de pe hartă (nu se inventează)',
     poz3.length === 1 && poz3[0].num === 2, JSON.stringify(poz3));

  // capcana: un box al cărui kilometru cade DINCOLO de capătul urmei nu are voie să fie
  // împins pe ultimul punct — ar arăta ca o coordonată reală, într-un loc greșit
  const BOX_LUNG = sanitizeBoxes([...BOXES.map(b => ({ ...b })),
    { num: 6, sumKm: 40.0, dir: 'DREAPTA', comment: 'mult după capătul urmei' }]);
  const pozLung = pozitiiBoxuri(buildPlan(BOX_LUNG, {}, recon, null));
  ok('boxul de dincolo de capătul urmei nu primește punct',
     !pozLung.some(x => x.num === 6), JSON.stringify(pozLung.map(x => x.num)));

  ok('simbolurile: TC, start, finish, viraj, reper',
     tipBox({ flag: 'TC' }) === 'tc' && tipBox({ flag: 'RT_START_STANDING' }) === 'start' &&
     tipBox({ flag: 'RT_FINISH' }) === 'finish' && tipBox({ dir: 'STÂNGA' }) === 'viraj' &&
     tipBox({ dir: 'ÎNAINTE' }) === 'reper' && tipBox({ dir: 'GIRATORIU-2' }) === 'viraj');
}

console.log('\n═══ Cache-ul de dale: cine iese când se umple ═══');
{
  ok('sub limită nu iese nimeni', deEvacuat(1500) === 0);
  ok('peste limită iese exact surplusul', deEvacuat(2010) === 10);
  ok('limita implicită e 2000 de dale', DALE_LIMITA === 2000);
  ok('o cifră absurdă nu produce un număr negativ', deEvacuat(-5) === 0);
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
