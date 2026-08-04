// RALI 2 — geometria de recunoaștere: înregistrare → păstrare → încărcare → export.
//
// De ce există suita asta (04.08.2026): în exporturile din AMBELE zile de test (03.08 și
// 04.08), câmpul `recon` e null. Aplicația are „traseul ca geometrie" ca idee centrală —
// paznicul de direcție și proiecția fără drift depind de ea — și a rulat două zile fără
// ea, fără ca nimic să spună asta. Testele de mai jos apără fiecare verigă a lanțului.
//
// Lanțul GPS folosit e REAL: Leg 1 al turei din 04.08.2026, ora 11:18-11:27 (97 de fixuri
// din jurnal, 5,43 km, bucla József + Kaufland).
import { buildPlan, sanitizeBoxes, groupByLeg,
         reconNormalize, reconPentruLeg, reconPune, reconStatus,
         reconRecupereaza } from '../js/route.js';
import { buildTrace } from '../js/geo.js';
import { makeMemStore, exportDay, importDay } from '../js/store.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// urma reală a Leg 1 (lat, lng, km/h), din jurnalul zilei
const LEG1 = [
  [45.802774,21.250661,19],[45.803296,21.25093,61],[45.803916,21.251671,64],
  [45.804487,21.252358,55],[45.804978,21.252986,33],[45.80485,21.253415,30],
  [45.804598,21.253813,24],[45.804567,21.253983,6],[45.804569,21.253977,3],
  [45.804541,21.253913,8],[45.804767,21.25358,30],[45.804955,21.253306,14],
  [45.804976,21.253292,0],[45.804975,21.253299,0],[45.804976,21.253299,0],
  [45.804976,21.253299,0],[45.804976,21.253299,0],[45.804976,21.253298,0],
  [45.804976,21.253299,0],[45.805106,21.253062,24],[45.804772,21.252543,48],
  [45.804249,21.251899,60],[45.803519,21.251021,66],[45.802756,21.250067,66],
  [45.802216,21.249327,56],[45.801571,21.248462,62],[45.801052,21.247781,52],
  [45.800445,21.247017,59],[45.799883,21.246268,64],[45.7992,21.24532,60],
  [45.798699,21.244627,48],[45.798327,21.244045,30],[45.797927,21.243538,53],
  [45.797247,21.242617,67],[45.79661,21.241785,71],[45.795938,21.241009,64],
  [45.795102,21.240395,64],[45.794166,21.239957,65],[45.793366,21.239595,69],
  [45.792526,21.239216,71],[45.791557,21.238797,62],[45.790849,21.23848,59],
  [45.790018,21.238135,58],[45.789335,21.237884,48],[45.788817,21.237704,31],
  [45.788272,21.237512,43],[45.787716,21.23733,48],[45.78706,21.237123,36],
  [45.786613,21.236982,30],[45.786073,21.236838,40],[45.785606,21.236722,20],
  [45.785393,21.236645,21],[45.785168,21.236652,18],[45.785331,21.236871,22],
  [45.785649,21.236813,30],[45.78619,21.236944,39],[45.786799,21.237118,43],
  [45.787407,21.237307,41],[45.787851,21.23748,17],[45.787932,21.23751,0],
  [45.78798,21.237528,13],[45.788187,21.237595,18],[45.788582,21.23771,35],
  [45.789176,21.237903,42],[45.789659,21.238069,37],[45.790205,21.23827,35],
  [45.790567,21.238425,26],[45.790831,21.238555,9],[45.79088,21.238583,0],
  [45.790883,21.238585,2],[45.790969,21.238632,17],[45.791231,21.238765,29],
  [45.791845,21.238973,53],[45.792651,21.239311,76],[45.793401,21.239681,53],
  [45.794244,21.24003,59],[45.795203,21.240529,75],[45.796157,21.241351,70],
  [45.796785,21.242145,64],[45.797429,21.243012,54],[45.797909,21.243701,34],
  [45.798176,21.244194,27],[45.798553,21.244594,49],[45.799169,21.245438,62],
  [45.79984,21.246363,60],[45.800328,21.247026,45],[45.800653,21.247476,14],
  [45.800747,21.247603,11],[45.800903,21.247807,17],[45.801262,21.248279,45],
  [45.801705,21.248864,32],[45.802014,21.249307,41],[45.802528,21.249951,41],
  [45.802723,21.250251,9],[45.802756,21.250351,6],[45.802738,21.250337,0],
  [45.802738,21.250337,0]
];
const brut = LEG1.map(([lat, lng, kmh], i) => ({ lat, lng, tMs: i * 6000, speedMs: kmh / 3.6, accM: 6 }));

// roadbook-ul REAL de test: două leg-uri identice de câte 12 boxuri, 5,43 km
const roadbook = (leg) => sanitizeBoxes([
  { day: 1, leg, num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: `START Leg ${leg}` },
  { day: 1, leg, num: 2, sumKm: 0.32, dir: 'DREAPTA', comment: 'spre József Attila' },
  { day: 1, leg, num: 3, sumKm: 0.41, dir: 'STÂNGA', comment: 'capătul buclei (91 m)' },
  { day: 1, leg, num: 4, sumKm: 0.48, dir: 'STÂNGA-T', comment: 'stânga la T (70 m)' },
  { day: 1, leg, num: 5, sumKm: 0.84, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'START RT 1 · 40 km/h' },
  { day: 1, leg, num: 7, sumKm: 2.74, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'FINISH RT 1' },
  { day: 1, leg, num: 8, sumKm: 3.12, dir: 'GIRATORIU-4', comment: 'giratoriu Kaufland' },
  { day: 1, leg, num: 12, sumKm: 5.43, dir: 'ÎNAINTE', flag: 'TC', comment: `FINISH Leg ${leg}` }
]);
const BOXES = [...roadbook(1), ...roadbook(2)];
const KEY1 = '1|1', KEY2 = '1|2';

function recDinUrma(anchors) {
  const trace = buildTrace(brut);
  return { trace, samples: [], anchors, at: Date.parse('2026-08-04T08:27:00Z') };
}
const ANCORE = [{ officialKm: 0, traceM: 0 }, { officialKm: 5.43, traceM: buildTrace(brut).totalM }];

console.log('\n═══ Urma reală se transformă în geometrie folosibilă ═══');
{
  const trace = buildTrace(brut);
  ok('97 de fixuri reale dau o urmă navigabilă', trace.pts.length > 50, `${trace.pts.length} puncte`);
  ok('lungimea urmei e ~5,4 km, cât leg-ul real',
     Math.abs(trace.totalM - 5430) < 400, `${Math.round(trace.totalM)} m`);
  const plan = buildPlan(roadbook(1), {}, recDinUrma(ANCORE));
  ok('planul primește urma și harta de ancore', !!plan.trace && !!plan.anchorMap);
  const laGiratoriu = plan.anchorMap.traceM(3.12);
  ok('kilometrul oficial se traduce în metri pe urmă',
     laGiratoriu > 3000 && laGiratoriu < 3300, Math.round(laGiratoriu) + ' m');
}

console.log('\n═══ Verdictul se citește ÎNAINTE de START, nu din comportament ═══');
{
  const fara = reconStatus(null);
  ok('fără nicio înregistrare: NU, cu motiv în cuvinte',
     fara.ok === false && /niciodată/.test(fara.motiv), JSON.stringify(fara));
  // cazul tăcut și periculos: urmă înregistrată, dar niciun box marcat din mers.
  // buildPlan nu poate face anchorMap, mașina ignoră complet urma — și până azi
  // nimic n-o spunea.
  const faraAncore = reconStatus(recDinUrma([]));
  ok('urmă fără ancore = NU, nu „DA"',
     faraAncore.ok === false && /ancore/.test(faraAncore.motiv), JSON.stringify(faraAncore));
  ok('și chiar așa e: planul rămâne fără hartă de ancore',
     buildPlan(roadbook(1), {}, recDinUrma([])).anchorMap === null);
  const bun = reconStatus(recDinUrma(ANCORE));
  ok('cu ancore: DA, cu cifrele pe care le vede pilotul',
     bun.ok === true && bun.ancore === 2 && bun.puncte > 50 && bun.km > 5,
     JSON.stringify({ ancore: bun.ancore, puncte: bun.puncte, km: bun.km.toFixed(2) }));
}

console.log('\n═══ Geometria e A LEG-ULUI (defectul cheii globale) ═══');
{
  let harta = reconPune(null, KEY1, recDinUrma(ANCORE));
  ok('leg-ul 1 are geometrie', reconStatus(reconPentruLeg(harta, KEY1)).ok === true);
  ok('leg-ul 2 NU capătă geometria leg-ului 1',
     reconPentruLeg(harta, KEY2) === null,
     'urma unui leg aplicată peste alt leg = proiecție pe un drum pe care nu mergi');
  const grupuri = groupByLeg(BOXES);
  ok('roadbook-ul de test chiar are două leg-uri', grupuri.length === 2,
     JSON.stringify(grupuri.map(g => g.key)));
  const planLeg2 = buildPlan(grupuri[1].boxes, {}, reconPentruLeg(harta, KEY2));
  ok('planul leg-ului 2 pleacă fără urmă, cinstit', planLeg2.trace === null);
  // și invers: înregistrarea leg-ului 2 nu mai șterge tăcut geometria leg-ului 1
  harta = reconPune(harta, KEY2, recDinUrma(ANCORE));
  ok('după înregistrarea leg-ului 2, leg-ul 1 e tot acolo',
     reconStatus(reconPentruLeg(harta, KEY1)).ok === true &&
     reconStatus(reconPentruLeg(harta, KEY2)).ok === true,
     JSON.stringify(Object.keys(harta.legs)));
}

console.log('\n═══ Forma veche de pe telefon se migrează, nu se pierde ═══');
{
  const vechi = recDinUrma(ANCORE);                     // exact ce scria versiunea v29
  const harta = reconNormalize(vechi, KEY1);
  ok('geometria veche ajunge pe leg-ul activ',
     reconStatus(reconPentruLeg(harta, KEY1)).ok === true);
  ok('migrarea se semnalează o singură dată', harta._migrat === true);
  const iar = reconNormalize(harta, KEY1);
  ok('a doua oară nu se mai migrează nimic', iar._migrat === undefined);
  ok('normalizarea unui gunoi nu crapă și nu inventează',
     reconNormalize(null, KEY1).legs && Object.keys(reconNormalize('x', KEY1).legs).length === 0);
}

console.log('\n═══ O înregistrare întreruptă nu se mai pierde ═══');
{
  // pe telefon pagina moare des în plin drum (ecran stins, cameră, memorie); până azi
  // nimic nu se scria până la „Oprește și salvează", deci 20 de minute de drum se
  // evaporau fără urmă în jurnal
  const ciorna = { legKey: KEY1, raw: brut.slice(0, 60), samples: [],
                   anchors: [{ officialKm: 0, traceM: 0 }, { officialKm: 3.12, traceM: 3100 }],
                   at: Date.now() };
  const r = reconRecupereaza(ciorna, null);
  ok('ciorna devine geometria leg-ului ei', r.stare === 'recuperat' && r.legKey === KEY1, JSON.stringify(r.stare));
  ok('și e marcată ca recuperată, ca s-o vadă pilotul',
     reconStatus(r.rec).ok === true && reconStatus(r.rec).recuperat === true);
  const harta = reconPune(null, KEY1, recDinUrma(ANCORE));
  ok('dar nu suprascrie o geometrie existentă',
     reconRecupereaza(ciorna, harta).stare === 'exista_deja');
  ok('o ciornă goală nu produce nimic',
     reconRecupereaza({ legKey: KEY1, raw: [] }, null).stare === 'gol' &&
     reconRecupereaza(null, null).stare === 'gol');
}

console.log('\n═══ Exportul chiar duce geometria mai departe ═══');
{
  const store = makeMemStore();
  await store.put('plan_raw', BOXES);
  await store.put('recon', reconPune(null, KEY1, recDinUrma(ANCORE)));
  await store.put('recon_draft', { legKey: KEY2, raw: brut.slice(0, 30), samples: [], anchors: [], at: 1 });
  await store.log('recon_salvat', { legKey: KEY1, ancore: 2 }, 1000);
  const dump = await exportDay(store);
  ok('exportul NU mai are recon null când există geometrie',
     dump.recon && dump.recon.legs && !!dump.recon.legs[KEY1], JSON.stringify(dump.recon && Object.keys(dump.recon)));
  ok('ciorna neterminată pleacă și ea în export (se vede de pe birou)',
     !!dump.recon_draft && dump.recon_draft.legKey === KEY2);
  ok('jurnalul spune negru pe alb că s-a înregistrat',
     dump.journal.some(e => e.type === 'recon_salvat'),
     JSON.stringify(dump.journal.map(e => e.type)));
  const alt = makeMemStore();
  await importDay(alt, dump);
  const dupa = reconPentruLeg(reconNormalize(await alt.get('recon'), KEY1), KEY1);
  ok('al doilea telefon preia geometria întreagă',
     reconStatus(dupa).ok === true && dupa.trace.pts.length > 50,
     JSON.stringify(reconStatus(dupa)));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
