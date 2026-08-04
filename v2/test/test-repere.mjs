// RALI 2 — de la comentariul din roadbook la un punct pe hartă, și de acolo la Maps.
//
// Comentariile de mai jos sunt REALE: copiate din `plan_raw` al jurnalelor din 02-04.08
// (bucla József / Dumbrăvița, roadbook-ul Tresor și traseul poligon). Diacriticele și
// numele maghiare — Petőfi Sándor, Franyó Zoltán, József Attila — sunt exact cum le-a
// scanat aplicația din roadbook.
import { extrageReper, localitateBoxuri, repereBoxuri, verificaAncore,
         geocodeazaRepere, faGeocoder } from '../js/repere.js';
import { linkuriTraseu, linkNavigare, alegeWaypoints, MAX_WAYPOINTS } from '../js/maps.js';
import { sanitizeBoxes } from '../js/route.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

console.log('\n═══ Reperul, scos din comentariile reale ═══');
{
  const cazuri = [
    ['Stânga pe Str. Constructorilor după 185 m pe Exemplu', 'Str. Constructorilor'],
    ['Dreapta pe Str. Avram Imbroane · panou limită 50 după viraj — respectă panoul', 'Str. Avram Imbroane'],
    ['Stânga pe Calea Ghirodei · același drum ca la venire, sens invers', 'Calea Ghirodei'],
    ['Stânga pe Calea Dorobanților (DN6) CEDEAZĂ trecerea la intrare — drum principal', 'Calea Dorobanților'],
    ['Dreapta pe Aleea Pădurea Verde; stradă îngustă — urmează înlănțuire', 'Aleea Pădurea Verde'],
    ['Înainte — devine Str. Orăștie; înlănțuit: la 52 m după dreapta', 'Str. Orăștie'],
    ['FINISH RT 1 · tabela roșie · devine Str. Măcin · dreapta în 140 m — nu opri', 'Str. Măcin'],
    ['Stânga la T — capătul drumului, pe Str. Fervența', 'Str. Fervența'],
    ['Sens giratoriu — ieșirea 1 pe Str. Aristide Demetriade', 'Str. Aristide Demetriade'],
    ['Înainte — devine Inelul IV. Boxuri înlănțuite: la 57 m după stânga', 'Inelul IV'],
    // diacritice maghiare, exact ca în roadbook
    ['Stânga pe Str. Petőfi Sándor / DJ691 - ultimii 115 m, biroul pe stânga', 'Str. Petőfi Sándor'],
    ['Stânga pe Str. Franyó Zoltán - înlănțuit cu finish-ul (50 m)', 'Str. Franyó Zoltán'],
    ['Dreapta spre Str. József Attila. Începe bucla de întoarcere.', 'Str. József Attila'],
    // numărul de la adresă rămâne: ajută geocodarea
    ['START · Time Control - TC 1 — Str. Exemplu 7, Dumbrăvița — oprit pe dreapta', 'Str. Exemplu 7'],
    // strada scrisă fără cuvântul „Str."
    ['START RT 1 — auto-start · viteză medie 30 km/h · pe Bălcescu · proba are 1 km EXACT', 'Bălcescu'],
    ['Înainte pe Principala · reper la jumătatea probei — drum drept', 'Principala'],
    // genitiv
    ['Stânga — la bifurcație ține stânga și virează imediat STÂNGA — capătul străzii Exemplu', 'Strada Exemplu']
  ];
  for (const [c, asteptat] of cazuri) {
    const r = extrageReper(c, {});
    ok(`„${asteptat}"`, r === asteptat, `am primit „${r}" din: ${c.slice(0, 60)}`);
  }
}

console.log('\n═══ Ce NU e reper — și nu se inventează ═══');
{
  const fara = [
    'FINISH RT 2 · tabela roșie · nu opri între tabele',
    'SIMULARE — trecere CFR cu STOP: oprire COMPLETĂ 2 secunde, DOAR dacă traficul permite',
    'Dreapta la capătul străzii · strada fără nume — 164 m',
    'CP 1 — Control de Trecere (SIMULARE) · oprește 5 secunde pe dreapta unde e SIGUR',
    'FINISH RT 1 · tabela roșie · 376 m până la giratoriu — nu opri',
    'Înainte pe Principala, reper — drum drept · viteză medie 28 km/h'.replace('Principala', 'DREAPTA')
  ];
  for (const c of fara) ok(`fără reper: „${c.slice(0, 45)}…"`, extrageReper(c, {}) === null,
                           JSON.stringify(extrageReper(c, {})));
}

console.log('\n═══ Localitatea: din adresă, nu din orice pomenire ═══');
{
  const boxes = [
    { comment: 'START · TC 1 — Str. Exemplu 7, Dumbrăvița — oprit pe dreapta' },
    { comment: 'Dreapta pe Str. Pluto, după 134 m pe Averescu' }
  ];
  ok('adresa dă localitatea', localitateBoxuri(boxes) === 'Dumbrăvița', localitateBoxuri(boxes));

  // Cazul REAL care a stricat prima versiune: roadbook-ul Tresor e din Timișoara, dar o
  // notă de regulament pomenește Sibiu — și toate cele 19 repere ar fi plecat spre
  // orașul greșit, unde „Str. Turda" există la fel de bine.
  const tresor = [
    { comment: 'Stânga pe Calea Ghirodei · același drum ca la venire, sens invers' },
    { comment: 'SIMULARE — trecere CFR cu STOP: oprire COMPLETĂ 2 secunde. La Sibiu: STOP obligatoriu la tabelă' },
    { comment: 'Dreapta pe Str. Turda · retur pe traseul de la venire' }
  ];
  ok('o notă de regulament NU devine localitate', localitateBoxuri(tresor) === null,
     String(localitateBoxuri(tresor)));

  const r = repereBoxuri(sanitizeBoxes([
    { num: 1, sumKm: 0, comment: 'START · TC 1 — Str. Exemplu 7, Dumbrăvița' },
    { num: 2, sumKm: 0.2, comment: 'Dreapta pe Str. Pluto, după 134 m pe Averescu' }
  ]));
  ok('reperele primesc localitatea o dată, pentru tot leg-ul',
     r.repere[1].reper === 'Str. Pluto, Dumbrăvița', JSON.stringify(r.repere));

  // reperul dat direct de scanare are prioritate față de ghicitul din comentariu
  const r2 = repereBoxuri(sanitizeBoxes([
    { num: 1, sumKm: 0, comment: 'ceva neclar', reper: 'Str. Turda' },
    { num: 2, sumKm: 0.3, comment: 'START · TC — Str. Exemplu 7, Dumbrăvița' }
  ]));
  ok('reperul din scanare bate deducția din comentariu',
     r2.repere[0].reper === 'Str. Turda, Dumbrăvița', JSON.stringify(r2.repere));
}

console.log('\n═══ Ancora din alt oraș se aruncă ═══');
{
  // Traseu real: boxurile 1-4 din poligon, la câteva sute de metri unul de altul.
  // Ancora boxului 3 „cade" la Cluj — cum ar face o geocodare pentru „Str. Turda".
  const ancore = [
    { num: 1, sumKm: 0.00, lat: 45.782532, lng: 11.246190 },
    { num: 2, sumKm: 0.22, lat: 45.780900, lng: 11.244700 },
    { num: 3, sumKm: 0.27, lat: 46.770000, lng: 23.590000 },   // Cluj-Napoca
    { num: 4, sumKm: 0.41, lat: 45.780200, lng: 11.242000 }
  ];
  const v = verificaAncore(ancore);
  ok('ancora din alt oraș e scoasă', !v.bune.some(a => a.num === 3) && v.aruncate.length === 1,
     JSON.stringify({ bune: v.bune.map(a => a.num), aruncate: v.aruncate.map(a => a.num) }));
  ok('restul rămân, în ordinea kilometrajului',
     v.bune.map(a => a.num).join(',') === '1,2,4', JSON.stringify(v.bune.map(a => a.num)));
  ok('și motivul e scris în cifre, nu „ancoră invalidă"',
     /roadbook-ul are \d+ m/.test(v.aruncate[0].motiv), v.aruncate[0].motiv);

  // dacă TOCMAI PRIMA ancoră e cea greșită, nu se aruncă tot restul
  const ancore2 = [
    { num: 1, sumKm: 0.00, lat: 46.770000, lng: 23.590000 },
    { num: 2, sumKm: 0.22, lat: 45.780900, lng: 11.244700 },
    { num: 3, sumKm: 0.27, lat: 45.780600, lng: 11.244300 },
    { num: 4, sumKm: 0.41, lat: 45.780200, lng: 11.242000 }
  ];
  const v2 = verificaAncore(ancore2);
  ok('prima ancoră greșită nu duce tot traseul cu ea',
     v2.bune.map(a => a.num).join(',') === '2,3,4', JSON.stringify(v2.bune.map(a => a.num)));
}

console.log('\n═══ Geocodarea: mock, niciun apel real ═══');
{
  const cerute = [];
  const geo = { async cauta(q) {
    cerute.push(q);
    if (/Turda/.test(q)) return { lat: 45.7810, lng: 11.2440 };
    if (/Pluto/.test(q)) return { lat: 45.7802, lng: 11.2420 };
    if (/Fervența/.test(q)) throw new Error('serverul a răspuns 429');
    return null;
  } };
  const rez = await geocodeazaRepere([
    { num: 1, sumKm: 0.0, reper: 'Str. Turda, Dumbrăvița' },
    { num: 2, sumKm: 0.2, reper: 'Str. Pluto, Dumbrăvița' },
    { num: 3, sumKm: 0.3, reper: 'Str. Fervența, Dumbrăvița' },
    { num: 4, sumKm: 0.4, reper: 'Str. Necunoscută, Dumbrăvița' },
    { num: 5, sumKm: 0.5, reper: null }
  ], geo);
  ok('ancorele găsite se întorc cu box și kilometraj',
     rez.ancore.length === 2 && rez.ancore[0].num === 1, JSON.stringify(rez.ancore));
  ok('eșecul de rețea nu oprește restul căutării',
     rez.ratate.some(r => r.num === 3 && /429/.test(r.motiv)), JSON.stringify(rez.ratate));
  ok('„negăsit pe hartă" se deosebește de „fără reper"',
     rez.ratate.find(r => r.num === 4).motiv === 'negăsit pe hartă' &&
     rez.ratate.find(r => r.num === 5).motiv === 'fără reper geocodabil',
     JSON.stringify(rez.ratate));
  ok('boxul fără reper nu produce nicio cerere', cerute.length === 4, JSON.stringify(cerute));

  // sita de pe răspuns: serviciul e extern, deci gunoiul nu intră în hartă
  const geoRau = faGeocoder({ pauzaMs: 0, fetchFn: async () => ({ ok: true,
    json: async () => [{ lat: 'nu-i număr', lon: 11.2 }] }) });
  ok('coordonate care nu sunt numere → null, nu NaN pe hartă',
     (await geoRau.cauta('ceva')) === null);
  const geoAbsurd = faGeocoder({ pauzaMs: 0, fetchFn: async () => ({ ok: true,
    json: async () => [{ lat: 145.7, lon: 11.2 }] }) });
  ok('latitudine imposibilă → null', (await geoAbsurd.cauta('ceva')) === null);
  const geoEsec = faGeocoder({ pauzaMs: 0, fetchFn: async () => ({ ok: false, status: 503 }) });
  let aAruncat = false;
  try { await geoEsec.cauta('ceva'); } catch (e) { aAruncat = /503/.test(e.message); }
  ok('serverul căzut se raportează cu codul lui', aAruncat);

  // politețea față de un serviciu public gratuit: același reper se întreabă o dată,
  // iar o rulare nu poate porni o rafală de sute de cereri
  let apeluri = 0;
  const geoCache = faGeocoder({ pauzaMs: 0, fetchFn: async () => {
    apeluri++; return { ok: true, json: async () => [{ lat: 45.78, lon: 11.24 }] }; } });
  await geoCache.cauta('Str. Turda, Timișoara');
  await geoCache.cauta('Str. Turda, Timișoara');
  await geoCache.cauta('Str. Turda, Timișoara');
  ok('reperul repetat se caută o singură dată', apeluri === 1, `${apeluri} apeluri`);
  ok('și cache-ul se vede în numărătoarea de cereri', geoCache.cereriFacute() === 1);

  const geoPlafon = faGeocoder({ pauzaMs: 0, maxCereri: 2, fetchFn: async () => ({
    ok: true, json: async () => [{ lat: 45.78, lon: 11.24 }] }) });
  await geoPlafon.cauta('unu'); await geoPlafon.cauta('doi');
  let plafonat = false;
  try { await geoPlafon.cauta('trei'); } catch (e) { plafonat = /plafon atins/.test(e.message); }
  ok('peste plafon, căutarea se oprește cu un motiv clar', plafonat);
}

console.log('\n═══ Linkurile Google Maps ═══');
{
  const anc = n => Array.from({ length: n }, (_, i) => ({
    num: i + 1, sumKm: i * 0.3, lat: 45.78 + i * 0.001, lng: 11.24 + i * 0.001 }));

  const unul = linkuriTraseu(anc(5));
  ok('un traseu scurt încape într-un singur link', unul.length === 1, JSON.stringify(unul.length));
  ok('destinația e ultimul box', /destination=45\.784000%2C11\.244000/.test(unul[0].url), unul[0].url);
  ok('punctele intermediare sunt separate cu %7C',
     (unul[0].url.match(/%7C/g) || []).length === 2, unul[0].url);
  ok('fără `origin`, ca Maps să plece de la locația curentă',
     !/[?&]origin=/.test(unul[0].url), unul[0].url);
  ok('și e traseu cu mașina', /travelmode=driving/.test(unul[0].url));

  const lung = linkuriTraseu(anc(30));
  ok('un traseu lung se taie în bucăți consecutive', lung.length === 3, JSON.stringify(lung.map(l => l.eticheta)));
  ok('nicio bucată nu depășește limita Google de 9 puncte intermediare',
     lung.every(l => (l.url.match(/%7C/g) || []).length <= MAX_WAYPOINTS - 1), JSON.stringify(lung.map(l => (l.url.match(/%7C/g) || []).length)));
  ok('bucățile se înlănțuie: fiecare începe de unde s-a terminat cea dinainte',
     lung[1].deLaBox === lung[0].panaLaBox && lung[2].deLaBox === lung[1].panaLaBox,
     JSON.stringify(lung.map(l => [l.deLaBox, l.panaLaBox])));
  ok('eticheta spune ce bucată e și ce boxuri acoperă',
     /Partea 1 din 3: boxurile 1–11/.test(lung[0].eticheta), lung[0].eticheta);

  // când sunt prea multe puncte, cele care contează rămân
  const cuFlag = anc(12).map(a => ({ ...a, flag: a.num === 4 ? 'TC' : a.num === 7 ? 'RT_START_AUTO' : null }));
  const alese = alegeWaypoints(cuFlag, MAX_WAYPOINTS).map(a => a.num);
  ok('TC-ul și startul de probă intră întotdeauna în link',
     alese.includes(4) && alese.includes(7), JSON.stringify(alese));
  ok('și nu se depășește numărul maxim de puncte', alese.length === MAX_WAYPOINTS, String(alese.length));

  ok('navigarea către un punct e un link simplu, fără waypoints',
     linkNavigare({ lat: 45.78, lng: 11.24 }) ===
     'https://www.google.com/maps/dir/?api=1&destination=45.780000%2C11.240000&travelmode=driving',
     linkNavigare({ lat: 45.78, lng: 11.24 }));
  ok('coordonate invalide nu produc link', linkNavigare({ lat: 'x', lng: 21 }) === null);
  ok('sub două ancore nu există traseu de trimis', linkuriTraseu([anc(1)[0]]).length === 0);
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
