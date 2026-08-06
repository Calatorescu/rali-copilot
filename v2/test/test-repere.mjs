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

// ── ROADBOOK-UL OFICIAL DE LA SIBIU, 06.08.2026 ─────────────────────────────
// Cele 36 de boxuri, copiate din `plan_raw` al jurnalului zilei (num, sumKm, comment,
// reper — atât). City Demo, 3,70 km, 4 pagini. Ziua în care 0 din 36 de repere au fost
// găsite pe hartă, fiindcă boxul 3 („Piața Mică, Zonă Pietonală") a fost citit ca adresă
// și „Zonă Pietonală" a devenit localitatea întregului roadbook.
const SIBIU = [
  { num: 1, sumKm: 0, comment: 'Ceremonial Start, Start City Demo, Piața Mică', reper: 'Piața Mică' },
  { num: 2, sumKm: 0.03, comment: 'Turnul Sfatului, To Podul Mincinilor', reper: 'Turnul Sfatului' },
  { num: 3, sumKm: 0.04, comment: 'Piața Mică, Zonă Pietonală', reper: 'Piața Mică' },
  { num: 4, sumKm: 0.14, comment: 'Podul Minciunilor', reper: 'Podul Minciunilor' },
  { num: 5, sumKm: 0.16, comment: 'The barrier opens automatically upon exiting the square.', reper: null },
  { num: 6, sumKm: 0.25, comment: 'Str. Ocnei', reper: 'Str. Ocnei' },
  { num: 7, sumKm: 0.5, comment: 'Str. Ocnei', reper: null },
  { num: 8, sumKm: 0.55, comment: 'Tribunalul și Judecătoria Sibiu', reper: 'Tribunalul și Judecătoria Sibiu' },
  { num: 9, sumKm: 0.62, comment: 'Str. Nicolae Teclu', reper: 'Str. Nicolae Teclu' },
  { num: 10, sumKm: 1.05, comment: 'Str. Constituției', reper: 'Str. Constituției' },
  { num: 11, sumKm: 1.22, comment: 'Str. Constituției', reper: null },
  { num: 12, sumKm: 1.33, comment: 'Str. Constituției', reper: null },
  { num: 13, sumKm: 1.65, comment: 'To Center, Bd. Corneliu Coposu', reper: 'Bd. Corneliu Coposu' },
  { num: 14, sumKm: 1.75, comment: 'Str. Pompeiu Onofreiu, Right after the Bus Stop', reper: 'Str. Pompeiu Onofreiu' },
  { num: 15, sumKm: 1.87, comment: 'Str. Pompeiu Onofreiu', reper: null },
  { num: 16, sumKm: 1.94, comment: 'Str. Filarmonicii', reper: 'Str. Filarmonicii' },
  { num: 17, sumKm: 2.07, comment: 'Str. Filarmonicii', reper: null },
  { num: 18, sumKm: 2.15, comment: 'Str. General Magheru', reper: 'Str. General Magheru' },
  { num: 19, sumKm: 2.22, comment: 'Str. Gheorghe Lazăr, Piața Mare', reper: 'Str. Gheorghe Lazăr' },
  { num: 20, sumKm: 2.34, comment: 'Str. Gheorghe Lazăr', reper: 'Str. Gheorghe Lazăr' },
  { num: 21, sumKm: 2.4, comment: 'Str. Gheorghe Lazăr', reper: 'Str. Gheorghe Lazăr' },
  { num: 22, sumKm: 2.43, comment: 'Str. Cetății', reper: 'Str. Cetății' },
  { num: 23, sumKm: 2.56, comment: 'Str. Cetății, Filarmonica de Stat Sibiu', reper: 'Filarmonica de Stat Sibiu' },
  { num: 24, sumKm: 2.6, comment: 'Str. Cetății, Turnul Dulgherilor', reper: 'Turnul Dulgherilor' },
  { num: 25, sumKm: 2.69, comment: 'Str. Cetății, Turnul Olarilor', reper: 'Turnul Olarilor' },
  { num: 26, sumKm: 2.71, comment: 'Str. Cetății', reper: 'Str. Cetății' },
  { num: 27, sumKm: 2.78, comment: 'Str. Cetății, Turnul Archebuzierilor', reper: 'Turnul Archebuzierilor' },
  { num: 28, sumKm: 2.93, comment: 'Str. Cetății', reper: 'Str. Cetății' },
  { num: 29, sumKm: 2.98, comment: 'Piața Unirii', reper: 'Piața Unirii' },
  { num: 30, sumKm: 3.01, comment: 'Str. Tribunei', reper: 'Str. Tribunei' },
  { num: 31, sumKm: 3.12, comment: 'Str. Tribunei', reper: null },
  { num: 32, sumKm: 3.21, comment: 'Str. Mitropoliei', reper: 'Str. Mitropoliei' },
  { num: 33, sumKm: 3.37, comment: 'Str. Mitropoliei, Oficiul Poștal Sibiu 1', reper: 'Oficiul Poștal Sibiu 1' },
  { num: 34, sumKm: 3.58, comment: 'Piața Huet', reper: 'Piața Huet' },
  { num: 35, sumKm: 3.63, comment: 'Piața Mică', reper: 'Piața Mică' },
  { num: 36, sumKm: 3.7, comment: 'Finish City Demo, Piața Mică', reper: 'Piața Mică' }
];

console.log('\n═══ Sibiu, roadbook OFICIAL: „Zonă Pietonală" nu e o localitate ═══');
{
  ok('din cele 36 de boxuri reale NU mai iese „Zonă Pietonală"',
     localitateBoxuri(SIBIU) !== 'Zonă Pietonală', String(localitateBoxuri(SIBIU)));
  // null e răspunsul corect: roadbook-ul ăsta nu spune nicăieri, negru pe alb, în ce
  // localitate ești — nici plăcuță de intrare, nici adresă cu număr. Deci se cere omului.
  ok('și nici altceva ghicit: răspunsul e „nu știu" (null)',
     localitateBoxuri(SIBIU) === null, String(localitateBoxuri(SIBIU)));

  const r = repereBoxuri(SIBIU, { localitate: 'Sibiu' });
  ok('localitatea folosită e cea scrisă de om', r.localitate === 'Sibiu', String(r.localitate));
  const dupaNum = n => (r.repere.find(x => x.num === n) || {}).reper;
  ok('boxul 1 pleacă „Piața Mică, Sibiu"', dupaNum(1) === 'Piața Mică, Sibiu', String(dupaNum(1)));
  ok('boxul 2 pleacă „Turnul Sfatului, Sibiu"', dupaNum(2) === 'Turnul Sfatului, Sibiu', String(dupaNum(2)));
  ok('boxul 3 pleacă „Piața Mică, Sibiu", nu „…, Zonă Pietonală, Sibiu"',
     dupaNum(3) === 'Piața Mică, Sibiu', String(dupaNum(3)));
  ok('boxul 6 pleacă „Str. Ocnei, Sibiu"', dupaNum(6) === 'Str. Ocnei, Sibiu', String(dupaNum(6)));
  const murdare = r.repere.filter(x => x.reper && /pietonal/i.test(x.reper));
  ok('NICIUN reper din cele 36 nu mai conține „Zonă Pietonală"',
     murdare.length === 0, JSON.stringify(murdare.map(x => x.reper)));
  ok('cele 35 de boxuri cu reper îl păstrează (nu s-a pierdut niciunul)',
     r.repere.filter(x => x.reper).length === 35,
     String(r.repere.filter(x => x.reper).length));
  // obiectivul care CHIAR se termină cu numele orașului nu-l primește de două ori
  ok('„Tribunalul și Judecătoria Sibiu" nu devine „…, Sibiu, Sibiu"',
     dupaNum(8) === 'Tribunalul și Judecătoria Sibiu', String(dupaNum(8)));
}

console.log('\n═══ De unde se citește localitatea: plăcuța, nu orice cuvânt ═══');
{
  // toate cele patru comentarii sunt reale — roadbook-ul de la Reșița, 05.08.2026
  ok('„Exit Văliug, DJ 582" → Văliug',
     localitateBoxuri([{ comment: 'Exit Văliug, DJ 582' }]) === 'Văliug');
  ok('„Enter Brebu Nou, DJ 582" → Brebu Nou (nume din două cuvinte)',
     localitateBoxuri([{ comment: 'Enter Brebu Nou, DJ 582' }]) === 'Brebu Nou');
  ok('„Welcome Gărâna / DJ 582" → Gărâna (se oprește la bara oblică)',
     localitateBoxuri([{ comment: 'Welcome Gărâna / DJ 582' }]) === 'Gărâna');
  ok('„Exit Municipiul Reșița, …" → Reșița (fără prefixul administrativ)',
     localitateBoxuri([{ comment: 'Exit Municipiul Reșița, To Brebu Nou, Semenic DJ 582' }]) === 'Reșița');
  ok('și forma românească: „la ieșirea din localitatea Văliug"',
     localitateBoxuri([{ comment: 'Reducere la 30 km/h la ieșirea din localitatea Văliug' }]) === 'Văliug');

  // „To X" e panou de DIRECȚIE, nu plăcuță de localitate — spune încotro, nu unde ești
  ok('„To Podul Mincinilor" NU e o localitate',
     localitateBoxuri([{ comment: 'Turnul Sfatului, To Podul Mincinilor' }]) === null,
     String(localitateBoxuri([{ comment: 'Turnul Sfatului, To Podul Mincinilor' }])));
  ok('„To Center, Bd. Corneliu Coposu" NU e o localitate',
     localitateBoxuri([{ comment: 'To Center, Bd. Corneliu Coposu' }]) === null,
     String(localitateBoxuri([{ comment: 'To Center, Bd. Corneliu Coposu' }])));
  ok('nici „exiting the square" din boxul 5 nu se citește ca „Exit"',
     localitateBoxuri([{ comment: 'The barrier opens automatically upon exiting the square.' }]) === null);

  // adresa: numărul de casă e ce o deosebește de o simplă înșiruire
  ok('adresa CU număr dă localitatea („Str. Marte 35, Dumbrăvița" — real, 04.08.2026)',
     localitateBoxuri([{ comment: 'START · TC 1. Str. Marte 35, Dumbrăvița — poziția pe stradă' }]) === 'Dumbrăvița');
  ok('înșiruirea FĂRĂ număr nu mai e citită ca adresă („Str. Cetății, Turnul Dulgherilor")',
     localitateBoxuri([{ comment: 'Str. Cetății, Turnul Dulgherilor' }]) === null);
  ok('nici „Str. Gheorghe Lazăr, Piața Mare"',
     localitateBoxuri([{ comment: 'Str. Gheorghe Lazăr, Piața Mare' }]) === null);

  // a doua apărare: chiar dacă o plăcuță ar spune-o, un descriptor nu e o localitate
  ok('a doua apărare: „Enter Zonă Pietonală" tot nu e o localitate',
     localitateBoxuri([{ comment: 'Enter Zonă Pietonală' }]) === null);
  ok('a doua apărare: „Exit Centru" tot nu e o localitate',
     localitateBoxuri([{ comment: 'Exit Centru' }]) === null);
  ok('a doua apărare: „Enter Turnul Olarilor" e obiectiv, nu localitate',
     localitateBoxuri([{ comment: 'Enter Turnul Olarilor' }]) === null);

  // un leg care traversează patru sate n-are UNA. Roadbook-ul de la Reșița, 05.08.2026:
  // Reșița → Văliug → Gărâna → Brebu Nou. A alege pe cea mai des pomenită înseamnă a lipi
  // satul greșit pe restul de o sută și ceva de boxuri.
  ok('plăcuțe care se contrazic → null, nu „cea mai des pomenită"',
     localitateBoxuri([{ comment: 'Exit Municipiul Reșița, To Brebu Nou' },
                       { comment: 'Exit Văliug, DJ 582' },
                       { comment: 'Welcome Gărâna / DJ 582' },
                       { comment: 'Enter Gărâna / DJ 582' },
                       { comment: 'Enter Brebu Nou, DJ 582' },
                       { comment: 'Exit Brebu Nou' }]) === null);
}

console.log('\n═══ Localitatea scrisă de om ÎNLOCUIEȘTE, nu se adaugă ═══');
{
  const boxes = [
    { num: 1, sumKm: 0, comment: 'START · TC 1 — Str. Marte 35, Dumbrăvița' },
    { num: 2, sumKm: 0.2, comment: 'Dreapta pe Str. Quasar' }
  ];
  ok('fără ce scrie omul, se folosește ce s-a dedus',
     repereBoxuri(boxes).repere[1].reper === 'Str. Quasar, Dumbrăvița',
     JSON.stringify(repereBoxuri(boxes).repere));

  const r = repereBoxuri(boxes, { localitate: 'Timișoara' });
  ok('ce scrie omul devine singura localitate', r.localitate === 'Timișoara', String(r.localitate));
  ok('coada dedusă se curăță, nu se pune una peste alta',
     r.repere[0].reper === 'Str. Marte 35, Timișoara', String(r.repere[0].reper));
  ok('nicio urmă din localitatea dedusă în reperele trimise',
     !r.repere.some(x => x.reper && /Dumbrăvița/.test(x.reper)),
     JSON.stringify(r.repere.map(x => x.reper)));

  // reperul venit de la scanare cu localitatea deja lipită pe pagină: la fel
  const r2 = repereBoxuri([{ num: 1, sumKm: 0, comment: 'ceva', reper: 'Piața Mică, Zonă Pietonală' }],
                          { localitate: 'Sibiu' });
  ok('reperul scanat cu descriptor lipit primește localitatea omului la coadă',
     r2.repere[0].reper === 'Piața Mică, Zonă Pietonală, Sibiu', String(r2.repere[0].reper));
  ok('…și are pregătită varianta curată pentru a doua încercare',
     r2.repere[0].reper2 === 'Piața Mică, Sibiu', String(r2.repere[0].reper2));

  // „Str. Sibiului" conține „Sibiu" fără să fie orașul: cu vechea verificare (`includes`)
  // rămânea pe veci fără localitate și se căuta în toată lumea
  const r3 = repereBoxuri([{ num: 1, sumKm: 0, comment: 'Dreapta pe Str. Sibiului' }],
                          { localitate: 'Sibiu' });
  ok('„Str. Sibiului" primește totuși „, Sibiu"',
     r3.repere[0].reper === 'Str. Sibiului, Sibiu', String(r3.repere[0].reper));
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

console.log('\n═══ A doua încercare: reperul curat + localitatea omului ═══');
{
  // Serviciul răspunde DOAR la varianta scurtă — exact ca Nominatim pe 06.08.2026:
  // „Piața Mică, Zonă Pietonală, Sibiu" nu există, „Piața Mică, Sibiu" există.
  const cerute = [];
  const geo = { async cauta(q) {
    cerute.push(q);
    return /^Piața Mică, Sibiu$/.test(q) ? { lat: 45.7983, lng: 24.1516, incM: 120 } : null;
  } };
  const rez = await geocodeazaRepere([
    { num: 1, sumKm: 0.0, reper: 'Piața Mică, Zonă Pietonală, Sibiu', reper2: 'Piața Mică, Sibiu' },
    { num: 2, sumKm: 0.2, reper: 'Str. Inexistentă, Sibiu', reper2: null },
    { num: 3, sumKm: 0.3, reper: 'Piața Mică, Sibiu', reper2: null }
  ], geo);
  ok('a doua încercare salvează boxul pe care prima l-a ratat',
     rez.ancore.some(a => a.num === 1), JSON.stringify(rez.ancore.map(a => a.num)));
  ok('ancora salvată poartă reperul care a funcționat',
     (rez.ancore.find(a => a.num === 1) || {}).reper === 'Piața Mică, Sibiu',
     JSON.stringify(rez.ancore.find(a => a.num === 1)));
  ok('și nu mai figurează la ratate', !rez.ratate.some(r => r.num === 1),
     JSON.stringify(rez.ratate));
  ok('boxul fără variantă rămâne ratat', rez.ratate.some(r => r.num === 2 && r.motiv === 'negăsit pe hartă'),
     JSON.stringify(rez.ratate));
  ok('boxul găsit din prima NU se mai caută a doua oară',
     cerute.filter(q => q === 'Piața Mică, Sibiu').length === 2, JSON.stringify(cerute));
  ok('ancorele rămân în ordinea kilometrajului',
     rez.ancore.map(a => a.num).join(',') === '1,3', JSON.stringify(rez.ancore.map(a => a.num)));

  // se reia DOAR ce a răspuns „negăsit", nu și ce a căzut din rețea
  const cerute2 = [];
  const geo2 = { async cauta(q) { cerute2.push(q); throw new Error('serverul a răspuns 429'); } };
  const rez2 = await geocodeazaRepere([
    { num: 1, sumKm: 0, reper: 'A, Sibiu', reper2: 'A2, Sibiu' }
  ], geo2);
  ok('eroarea de rețea nu declanșează a doua încercare',
     cerute2.length === 1 && rez2.ratate.length === 1, JSON.stringify(cerute2));

  // PLAFONUL: a doua încercare trece prin același geocoder, deci prin același plafon
  const geoPlaf = faGeocoder({ pauzaMs: 0, maxCereri: 3, fetchFn: async () => ({
    ok: true, json: async () => [] }) });      // nimic nu se găsește → toate se reiau
  const rez3 = await geocodeazaRepere([
    { num: 1, sumKm: 0.0, reper: 'unu, X', reper2: 'unu2, X' },
    { num: 2, sumKm: 0.1, reper: 'doi, X', reper2: 'doi2, X' },
    { num: 3, sumKm: 0.2, reper: 'trei, X', reper2: 'trei2, X' }
  ], geoPlaf);
  ok('a doua încercare nu depășește plafonul de cereri', geoPlaf.cereriFacute() === 3,
     `${geoPlaf.cereriFacute()} cereri`);
  ok('și când plafonul se atinge, motivul ajunge în raport',
     rez3.ratate.some(r => /plafon atins/.test(r.motiv)), JSON.stringify(rez3.ratate));
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
