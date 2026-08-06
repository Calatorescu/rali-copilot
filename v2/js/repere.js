// RALI 2 · repere.js — de la comentariul din roadbook la un punct pe hartă.
//
// DE CE. Harta traseului (coordonatele boxurilor) rezolvă tot ce ține de „unde sunt față
// de traseu", dar la Sibiu roadbook-ul vine gata tipărit de la organizator: nimeni nu ne
// dă un fișier cu coordonate. Singurul lucru pe care îl avem acolo e ce scrie în coloana
// de comentarii — „Dreapta pe Str. Avram Imbroane", „Stânga pe Calea Ghirodei". Adică
// exact adrese, scrise de om pentru om.
//
// Modulul ăsta le scoate din text (fără rețea, pur, testabil pe roadbook-urile reale) și
// le pregătește pentru geocodare. Geocodarea propriu-zisă se face O SINGURĂ DATĂ, acasă
// sau la hotel, la apăsarea unui buton — niciodată în mers.

import { haversineM } from './geo.js';

// Tipurile de arteră care apar în roadbook-urile românești, cu abrevierile lor.
// Ordinea contează: „Calea" înaintea lui „Cal.", „Strada" înaintea lui „Str.".
const ARTERE = [
  'Strada', 'Str\\.', 'Bulevardul', 'Bd\\.', 'B-dul', 'Calea', 'Aleea', 'Splaiul',
  'Șoseaua', 'Soseaua', 'Sos\\.', 'Piața', 'Piata', 'Intrarea', 'Drumul'
];
// Drumurile numerotate: DJ691, DN6, DC145, A1, E70 — se geocodează prost singure, dar
// bine cu localitatea alături, și oricum sunt a doua alegere după numele de stradă.
const DRUMURI = /\b(D[JNC]\s?\d{1,3}[A-Z]?|A\d{1,2}|E\d{2,3})\b/;

// Litere din alfabetul românesc ȘI din cel maghiar — Petőfi Sándor, Franyó Zoltán și
// József Attila sunt nume de străzi reale din roadbook-urile conduse până acum.
const MAJ = 'A-ZĂÂÎȘȚĂÂÎŞŢÁÉÍÓÖŐÚÜŰ';
const MIC = 'a-zăâîșțăâîşţáéíóöőúüű';

// Cuvinte care încep cu majusculă dar NU sunt nume de stradă — apar des în roadbook,
// iar geocodate ar trimite mașina în altă parte a țării.
const NU_E_LOC = new Set(['ATENȚIE', 'ATENTIE', 'IMEDIAT', 'START', 'FINISH', 'STÂNGA',
  'DREAPTA', 'ÎNAINTE', 'INAINTE', 'STOP', 'CFR', 'SUD', 'NORD', 'EST', 'VEST', 'RT',
  'TC', 'CP', 'EXACT', 'DEJA', 'SIMULARE', 'CEDEAZĂ', 'CEDEAZA', 'ACELAȘI', 'ACELASI',
  'PE', 'ÎN', 'IN', 'DIN',
  // cuvinte de roadbook care arată ca nume proprii după „pe/spre/devine", dar nu sunt:
  // „pe proba", „spre tabela", „pe traseul de la venire"
  'PROBA', 'PROBĂ', 'TABELA', 'TABELĂ', 'TRASEUL', 'TRASEU', 'DRUMUL', 'LINIA', 'PARCARE',
  'PARCAREA', 'STRADA', 'STRĂZII', 'STRAZII', 'CAPĂTUL', 'CAPATUL', 'GIRATORIU', 'DREPTUL']);

// „Str. Avram Imbroane", „Calea Ghirodei", „Aleea Pădurea Verde", „Str. Exemplu 7"
const reArtera = new RegExp(
  `(?:${ARTERE.join('|')})\\s+[${MAJ}][${MIC}${MAJ}'’\\-]*(?:\\s+[${MAJ}][${MIC}${MAJ}'’\\-]*){0,3}(?:\\s+\\d{1,4})?`,
  'u');

// Ce urmează după „pe" / „spre" / „devine" e strada pe care INTRI — cea mai bună
// referință pentru box. „Dreapta pe Str. Turda · retur pe traseul de la venire" → Turda.
const reDupaPrepozitie = new RegExp(
  `(?:\\bpe\\b|\\bspre\\b|\\bdevine\\b)\\s+((?:${ARTERE.join('|')})\\s+[${MAJ}][${MIC}${MAJ}'’\\-]*(?:\\s+[${MAJ}][${MIC}${MAJ}'’\\-]*){0,3}(?:\\s+\\d{1,4})?)`,
  'u');

// Nume proprii fără cuvânt de arteră: „Inelul IV", „Kaufland", „Principala".
const rePOI = new RegExp(`\\b(?:giratoriu|sens giratoriu|parcarea|hotel|hotelul)\\s+([${MAJ}][${MIC}${MAJ}\\-]{2,})`, 'iu');
const reInel = /\bInelul\s+[IVX]+\b/u;
// genitivul: „capătul străzii Exemplu" → strada Exemplu
const reGenitiv = new RegExp(`\\bstr[ăa]zii\\s+([${MAJ}][${MIC}${MAJ}'’\\-]{3,})`, 'u');
// numele gol de după prepoziție: „pe Principala", „pe Bălcescu", „devine Averescu" —
// roadbook-ul scrie strada fără cuvântul „Str." de destule ori ca să conteze
const reNumeGol = new RegExp(`(?:\\bpe\\b|\\bspre\\b|\\bdevine\\b)\\s+([${MAJ}][${MIC}${MAJ}'’\\-]{3,}(?:\\s+[${MAJ}][${MIC}${MAJ}'’\\-]{2,}){0,2})`, 'u');

function curata(s) {
  return String(s || '')
    .replace(/[·•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // coada de propoziție lipită de nume: „Ghirodei," / „Imbroane." / „Turda;"
    .replace(/[,.;:!]+$/, '')
    .trim();
}

// ── LOCALITATEA LEG-ULUI ────────────────────────────────────────────────────
// Fără ea, „Str. Turda" există în zeci de orașe și geocodarea nimerește altundeva.
//
// ISTORIC, două greșeli plătite pe teren — a doua e cea care a născut regula de azi:
//  • 04.08.2026: prima versiune căuta orice nume de oraș oriunde în text și a pus „Sibiu"
//    pe tot roadbook-ul de Timișoara, dintr-o notă de regulament („La Sibiu: STOP
//    obligatoriu la tabelă"). S-a restrâns la forma de adresă.
//  • 06.08.2026, Sibiu, roadbook OFICIAL: boxul 3 scrie „Piața Mică, Zonă Pietonală".
//    Forma de adresă a citit „Zonă Pietonală" ca localitate și a lipit-o pe toate cele 35
//    de repere: „Piața Mică, Zonă Pietonală", „Turnul Sfatului, Zonă Pietonală". Zero
//    ancore din 36. „Piața Mică, Sibiu" s-ar fi găsit din prima.
//
// De unde se citește ACUM localitatea — și DOAR de acolo:
//  1. PLĂCUȚA de intrare/ieșire din localitate, așa cum o scrie roadbook-ul în text:
//     „Enter Brebu Nou", „Exit Văliug", „Welcome Gărâna", „Exit Municipiul Reșița"
//     (toate reale, roadbook-ul de la Reșița, 05.08.2026), plus formele românești
//     („intrare în ...", „la ieșirea din localitatea ..."). Asta e plăcuța albă de drum,
//     singurul loc din roadbook care spune negru pe alb într-ce localitate ești.
//  2. ADRESA POȘTALĂ COMPLETĂ, cu NUMĂR: „Str. Marte 35, Dumbrăvița" (real, 04.08.2026).
//     Numărul e ce deosebește o adresă de o simplă înșiruire: „Piața Mică, Zonă Pietonală"
//     și „Str. Cetății, Turnul Dulgherilor" n-au număr, deci nu sunt adrese.
//
// Orice altceva → `null`, iar `null` e un răspuns BUN: aplicația știe deja să ceară
// localitatea omului și refuză să caute fără ea.
//
// Și dacă evidențele se contrazic (roadbook-ul de la Reșița trece prin Reșița, Văliug,
// Gărâna și Brebu Nou), tot `null`: un leg care traversează patru localități n-are UNA,
// iar a alege pe cea mai des pomenită înseamnă a lipi orașul greșit pe restul boxurilor.

// Numele unei localități: „Dumbrăvița", „Brebu Nou", „Sânnicolau Mare", „Ocna Sibiului".
const NUME_LOC = `[${MAJ}][${MIC}]{2,}(?:[ \\-][${MAJ}][${MIC}]{2,}){0,2}`;
// Prefixele administrative de pe plăcuță se aruncă: „Exit Municipiul Reșița" → „Reșița".
const PREFIX_ADM = '(?:Municipiul|MUNICIPIUL|Ora[șs]ul|Comuna|Satul|Localitatea|localitatea)\\s+';

// Plăcuța de localitate. Cuvintele-cheie se scriu cu toate casetele posibile în loc de
// flagul `i`, fiindcă `i` ar strica și clasele de majuscule din NUME_LOC — iar acolo
// majuscula e chiar dovada că urmează un nume propriu.
// ATENȚIE la ce NU e aici: „To X". „To Brebu Nou", „To Center", „To Podul Mincinilor"
// sunt panouri de DIRECȚIE — spun încotro mergi, nu unde ești. Toate trei apar în
// roadbook-urile reale, iar „To Podul Mincinilor" ar fi dat „Podul Mincinilor" ca oraș.
const rePlacutaLocalitate = new RegExp(
  '(?:\\b[Ee][Nn][Tt][Ee][Rr]\\b|\\b[Ee][Xx][Ii][Tt]\\b|\\b[Ww][Ee][Ll][Cc][Oo][Mm][Ee]\\b(?:\\s+to\\b)?' +
  '|\\b[Ii]ntrare[a]?\\s+[îi]n\\b|\\b[Ii]e[șs]ire[a]?\\s+din\\b|\\b[Bb]un venit\\s+(?:[îi]n|la)\\b)' +
  `\\s+(?:${PREFIX_ADM})?(${NUME_LOC})`, 'u');

// Adresa poștală completă: arteră + nume + NUMĂR + virgulă + localitate.
const reAdresaLocalitate = new RegExp(
  `(?:${ARTERE.join('|')}|Inelul)\\s+[${MAJ}][^,;·|]{0,40}\\s\\d{1,4},\\s*(${NUME_LOC})`, 'u');

// ── A DOUA APĂRARE: ce nu poate fi niciodată o localitate ────────────────────
// Prima apărare e restrângerea sursei de mai sus; asta e plasa de sub ea. Se compară pe
// text fără diacritice și cu litere mici, ca „Zonă Pietonală" și „ZONA PIETONALA" să cadă
// amândouă. Toate intrările vin din roadbook-uri reale sau din vocabularul lor obișnuit.
const NU_E_LOCALITATE = new Set([
  'zona pietonala', 'zona rezidentiala', 'zona industriala', 'zona', 'pietonala',
  'centru', 'centrul', 'center', 'city center', 'city demo', 'centru vechi',
  'sens unic', 'sens giratoriu', 'giratoriu', 'giratoriul', 'rond', 'rondul',
  'parcare', 'parcarea', 'parking', 'start', 'finish', 'stop', 'service',
  'gara', 'garaj', 'benzinarie', 'benzinaria', 'spital', 'spitalul', 'primaria',
  'sat vacanta', 'zona pietonal', 'drum inchis', 'sens interzis', 'trecere cfr'
]);
// Cuvintele-articol care încep un OBIECTIV, nu o localitate: „Turnul Dulgherilor",
// „Piața Mare", „Podul Minciunilor", „Oficiul Poștal", „Tribunalul și Judecătoria Sibiu".
// Forma cu articol hotărât („Turnul", „Podul") nu apare în numele de localități românești
// — alea sunt „Turnu Măgurele", „Podu Iloaiei", fără -l. Deci lista e sigură.
const CAP_DE_OBIECTIV = new Set(['turnul', 'piata', 'podul', 'oficiul', 'tribunalul',
  'muzeul', 'biserica', 'catedrala', 'parcul', 'hotelul', 'spitalul', 'primaria',
  'filarmonica', 'judecatoria', 'strada', 'bulevardul', 'calea', 'aleea', 'soseaua',
  'splaiul', 'intrarea', 'drumul', 'inelul', 'hala', 'stadionul', 'scoala', 'liceul']);

// fără diacritice și cu litere mici — singura formă în care se compară numele de mai sus
function normNume(s) {
  return String(s || '').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/[îi]/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[áàä]/g, 'a').replace(/[éè]/g, 'e').replace(/[óöő]/g, 'o').replace(/[úüű]/g, 'u')
    .replace(/\s+/g, ' ').trim();
}

// E numele ăsta o localitate plauzibilă? (a doua apărare, nu prima)
export function poateFiLocalitate(nume) {
  const n = normNume(nume);
  if (n.length < 3) return false;
  if (NU_E_LOCALITATE.has(n)) return false;
  if (CAP_DE_OBIECTIV.has(n.split(' ')[0])) return false;
  return true;
}

export function localitateBoxuri(boxes = []) {
  const gasite = new Set();
  for (const b of boxes) {
    const c = curata(b && b.comment);
    if (!c) continue;
    for (const re of [rePlacutaLocalitate, reAdresaLocalitate]) {
      const m = re.exec(c);
      if (m && poateFiLocalitate(m[1])) gasite.add(curata(m[1]));
    }
  }
  // exact una, altfel nu știm — și „nu știu" se rezolvă întrebând omul
  return gasite.size === 1 ? [...gasite][0] : null;
}

// REPERUL unui box: șirul care se trimite la geocodare, sau null dacă boxul n-are nimic
// geocodabil („FINISH RT 2 · tabela roșie · nu opri între tabele" — nicio adresă acolo).
export function extrageReper(comment, { localitate = null } = {}) {
  const c = curata(comment);
  if (!c) return null;
  let nume = null;

  const dp = reDupaPrepozitie.exec(c);
  if (dp) nume = curata(dp[1]);
  if (!nume) { const a = reArtera.exec(c); if (a) nume = curata(a[0]); }
  if (!nume) { const i = reInel.exec(c); if (i) nume = curata(i[0]); }
  if (!nume) { const g = reGenitiv.exec(c); if (g) nume = 'Strada ' + curata(g[1]); }
  if (!nume) { const p = rePOI.exec(c); if (p) nume = curata(p[1]); }
  if (!nume) {
    const ng = reNumeGol.exec(c);
    // numele gol e ultima încercare, deci și cea mai expusă: se cere să nu fie niciunul
    // dintre cuvintele-capcană, nici primul, nici ultimul („pe DREAPTA", „spre SUD")
    if (ng) {
      const cuv = curata(ng[1]).split(' ');
      if (!cuv.some(x => NU_E_LOC.has(x.toUpperCase()))) nume = cuv.join(' ');
    }
  }
  if (!nume) { const d = DRUMURI.exec(c); if (d) nume = curata(d[1]).replace(/\s+/, ''); }

  if (!nume) return null;
  // ultimul cuvânt din nume nu are voie să fie unul din cuvintele-capcană
  const ultim = nume.split(' ').pop().toUpperCase();
  if (NU_E_LOC.has(ultim)) return null;
  if (nume.length < 4) return null;

  return localitate ? `${nume}, ${localitate}` : nume;
}

// ── LOCALITATEA SCRISĂ DE OM ÎNLOCUIEȘTE, NU SE ADAUGĂ ───────────────────────
// Regula, scrisă ca atare (06.08.2026): dacă omul a scris o localitate în panoul de
// pregătire, ea e SINGURA folosită. Localitatea dedusă din text se ignoră complet,
// inclusiv coada ei deja lipită de reper.
//
// De ce trebuie spus explicit: până azi, omul scria „Sibiu" și codul o ADĂUGA peste ce
// dedusese singur. Reperele plecau „Piața Mică, Zonă Pietonală, Sibiu" — adică o adresă
// care nu există nicăieri. Corectura omului nu corecta nimic; doar mai punea un cuvânt.

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Scoate de la coada reperului „, Localitate" — repetat, dacă s-a lipit de mai multe ori.
function faraCoada(reper, loc) {
  let s = curata(reper);
  if (!s || !loc) return s;
  const re = new RegExp(`[,;]\\s*${escapeRe(loc)}\\s*$`, 'iu');
  for (let prev = null; s && s !== prev;) { prev = s; s = curata(s.replace(re, '')); }
  return s;
}

// Reperul are deja localitatea la coadă? Se cere potrivire pe CUVÂNT ÎNTREG la final,
// nu „conține undeva": „Str. Sibiului" conține „Sibiu" fără să fie în Sibiu, iar cu
// verificarea veche (`includes`) rămânea pe veci fără oraș și se căuta în toată lumea.
// „Tribunalul și Judecătoria Sibiu" chiar se termină cu numele orașului — ăla rămâne cum e.
function areLocalitateaLaCoada(reper, loc) {
  if (!reper || !loc) return false;
  return new RegExp(`(?:^|[\\s,])${escapeRe(loc)}$`, 'iu').test(curata(reper));
}

// Reperul „curat": doar prima bucată, fără ce s-a mai înșirat după virgulă. Din
// „Piața Mică, Zonă Pietonală" rămâne „Piața Mică" — varianta cu care se face a doua
// încercare la geocodare, când prima n-a găsit nimic.
function primaBucata(s) { return curata(String(s || '').split(/\s*[,;]\s*/)[0]); }

// Reperele întregului leg. `localitate` e ce a scris OMUL; dacă n-a scris nimic, se
// folosește ce s-a putut deduce cinstit din roadbook (de multe ori: nimic).
export function repereBoxuri(boxes = [], { localitate: locOm = null } = {}) {
  const dedusa = localitateBoxuri(boxes);
  const scrisaDeOm = curata(locOm) || null;
  const localitate = scrisaDeOm || dedusa;
  // când omul a scris una, cea dedusă e coada de curățat; altfel n-avem ce curăța
  const deSters = scrisaDeOm && dedusa && normNume(scrisaDeOm) !== normNume(dedusa) ? dedusa : null;

  const construieste = (b) => {
    // Scanarea poate da reperul direct (vezi promptul din scan.js); dacă nu l-a dat,
    // se scoate din comentariu. Roadbook-urile deja scanate merg pe a doua cale.
    let baza = (typeof b.reper === 'string' && b.reper.trim())
      ? curata(b.reper) : extrageReper(b.comment, {});
    if (!baza) return { reper: null, reper2: null };
    baza = faraCoada(baza, deSters);            // afară cu localitatea dedusă greșit
    if (!baza) return { reper: null, reper2: null };
    if (!localitate) return { reper: baza, reper2: null };
    const cuLoc = t => areLocalitateaLaCoada(t, localitate) ? t : `${t}, ${localitate}`;
    const reper = cuLoc(baza);
    const scurt = cuLoc(primaBucata(baza));
    return { reper, reper2: scurt !== reper ? scurt : null };
  };

  return {
    localitate,
    repere: boxes.map(b => ({ num: b.num, sumKm: b.sumKm, ...construieste(b) }))
  };
}

// ── REPERE CARE NU POT FI UN PUNCT ──────────────────────────────────────────
// 06.08.2026, măsurat în jurnal: roadbook-ul de la Dumbrăvița avea reperul „DJ 691" pe
// 11 boxuri din 18. Un număr de drum nu e o adresă — e o LINIE de zeci de kilometri.
// Orice serviciu de geocodare întoarce pentru el UN punct, ales arbitrar undeva pe linia
// aia, iar acel punct ajunge apoi pe toate cele 11 boxuri deodată. În ziua aia punctul a
// căzut în Juneau, Wisconsin, la 7933 km, dar defectul ar fi rămas la fel de rău dacă ar
// fi căzut corect pe DJ 691: boxurile 5 și 16 sunt la 7,6 km unul de altul pe drum și
// n-au voie să primească aceeași coordonată.
//
// Deci nu se mai întreabă deloc. Regula: dacă reperul conține un număr de drum și NU
// conține și un cuvânt de arteră („Str. Petőfi Sándor / DJ691" — ăsta rămâne, strada e
// cea care identifică punctul), reperul nu pleacă la geocodare.
// Câștig secundar, măsurat pe roadbook-ul zilei: 13 cereri din 18 nu se mai fac deloc.
const reArteraCuvant = new RegExp(`(?:^|\\W)(?:${ARTERE.join('|')}|Inelul)(?:\\W|$)`, 'u');

export function reperEDoarDrum(reper, localitate = null) {
  let s = curata(reper);
  if (!s) return false;
  // localitatea lipită la coadă („DJ 691, Dumbrăvița") nu face reperul mai identificabil
  // escapeRe, ca la liniile 220 și 231 (audit, 06.08.2026, seara dinaintea Sibiului):
  // localitatea o scrie OMUL. Un „Sibiu (" tastat greșit arunca SyntaxError din constructorul
  // de RegExp, iar apelul e înaintea lui `btn.disabled` și în afara oricărui try — deci
  // butonul „Găsește traseul pe hartă" părea că nu face nimic, fără niciun mesaj pe ecran.
  if (localitate) s = curata(s.replace(new RegExp(`,\\s*${escapeRe(localitate)}\\s*$`, 'iu'), ''));
  if (!DRUMURI.test(s)) return false;        // niciun număr de drum → nu e cazul
  return !reArteraCuvant.test(s);            // are drum, dar n-are stradă → doar o linie
}

// ── COORDONATELE IDENTICE NU VOTEAZĂ ────────────────────────────────────────
// Când N boxuri primesc exact aceeași coordonată, ăla e UN singur răspuns repetat, nu N
// confirmări independente. Serviciul a fost întrebat de N ori (sau o dată, din cache) și
// a răspuns o dată. Orice judecată de majoritate care le numără pe toate N e coruptă din
// construcție — ăsta e defectul care a trimis mașina spre Wisconsin cu 11 „voturi" contra 5.
//
// PRAGUL: 50 m. Sub atât, două ancore geocodate sunt același răspuns — nicio geocodare de
// străzi diferite nu cade la 50 m una de alta întâmplător, iar cache-ul din `faGeocoder`
// întoarce oricum bit-identic același punct pentru același text.
export const GRUP_IDENTIC_M = 50;
// Când un grup de coordonate identice devine SUSPECT PRIN CONSTRUCȚIE: mai mult de 2
// boxuri, întinse pe mai mult de 3 km de roadbook. Motivul e fizic, nu statistic —
// boxurile 5 și 16 sunt la 7,6 km unul de altul pe drum, deci nu pot fi în același punct.
//  • până la 2 boxuri în același punct e NORMAL: giratoriul luat de două ori, strada
//    făcută dus-întors, intrarea și ieșirea de pe același reper. Nu se atinge.
//  • 3 sau mai multe, întinse pe peste 3 km, înseamnă un răspuns de geocodare împrăștiat
//    peste boxuri care n-au ce căuta împreună. Se aruncă TOT grupul, nu o parte: n-avem
//    cum ști care box e cel adevărat, iar a păstra unul la întâmplare e tot o minciună.
export const GRUP_MAX_BOXURI = 2, GRUP_SPAN_KM = 3;

// Grupează ancorele care stau practic în același punct. Întoarce liste de ancore.
export function grupeazaIdentice(ancore = [], pragM = GRUP_IDENTIC_M) {
  const grupuri = [];
  for (const a of ancore) {
    const g = grupuri.find(x => haversineM(x[0].lat, x[0].lng, a.lat, a.lng) <= pragM);
    if (g) g.push(a); else grupuri.push([a]);
  }
  return grupuri;
}

// Câte PUNCTE distincte sunt într-o listă — adică de câte voturi independente dispune.
export function nrPuncteDistincte(ancore = [], pragM = GRUP_IDENTIC_M) {
  return grupeazaIdentice(ancore, pragM).length;
}

// ── POARTA DE PLAUZIBILITATE ────────────────────────────────────────────────
// Rulează ÎNAINTE de orice discuție despre kilometraj. Întrebarea ei nu e „se potrivesc
// ancorele între ele?", ci „poate exista punctul ăsta pe traseul de mâine?". Un punct la
// 7933 km nu trebuie să ajungă niciodată în discuția despre kilometraj — acolo el câștigă,
// fiindcă e însoțit de alte zece copii ale lui.
//
// PRAGURILE, scrise dinainte, cu motivul lângă fiecare:
//  • 300 km față de poziția GPS — un raliu de o zi nu are boxuri la 300 km de mașină.
//    Cifra e generoasă intenționat (Timișoara–Sibiu sunt ~275 km în linie dreaptă, iar
//    geocodarea se face ACASĂ, cu o zi înainte).
//  • 300 km față de mediana celorlalte candidate — aceeași logică, dar fără GPS.
//  • lungimea legului + 5 km — ăsta e pragul care taie fin. Argumentul e geometric:
//    două puncte de pe același leg sunt legate de un drum de cel mult `legKm`, iar linia
//    dreaptă e întotdeauna mai scurtă decât drumul. Marja de 5 km acoperă trei lucruri
//    măsurabile: centrul de stradă întors de geocodare (până la 800 m, vezi INC_MAX_M),
//    un roadbook scanat doar parțial (legKm iese mai mic decât e), și mediana care nu
//    cade fix pe traseu. Plafonul de jos, 10 km, ține pragul rezonabil pe leg-urile
//    scurte. Pe ziua de 06.08 (leg de 10,06 km) pragul a ieșit 15,06 km, iar ancorele
//    greșite erau la 52 și 54 km — prinse cu marjă de 3×.
export const PLAUZ_GPS_KM = 300, PLAUZ_MEDIANA_KM = 300;
export const PLAUZ_MARJA_LEG_KM = 5, PLAUZ_MIN_LEG_KM = 10;

// mediana pe fiecare coordonată — rezistentă la un punct dus în altă emisferă, spre
// deosebire de medie, pe care un singur Wisconsin o trage cu sute de kilometri
function median(v) {
  const s = [...v].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function medianaPct(pts) {
  return { lat: median(pts.map(p => p.lat)), lng: median(pts.map(p => p.lng)) };
}

export function poartaPlauzibilitate(ancore = [], { fix = null, legKm = null } = {}) {
  const lista = [...ancore].filter(a => a && Number.isFinite(a.lat) && Number.isFinite(a.lng));
  const aruncate = [];
  const scoate = (a, motiv) => aruncate.push({ ...a, motiv });
  if (!lista.length) return { bune: [], aruncate };

  // 1. GRUPURILE IDENTICE SUSPECTE, primele — ele sunt cele care corup majoritatea,
  //    deci trebuie scoase înainte ca cineva să numere voturi.
  let raman = [];
  for (const g of grupeazaIdentice(lista)) {
    const kms = g.map(a => a.sumKm).filter(Number.isFinite);
    const span = kms.length ? Math.max(...kms) - Math.min(...kms) : 0;
    if (g.length > GRUP_MAX_BOXURI && span > GRUP_SPAN_KM) {
      const nums = g.map(a => a.num).join(', ');
      for (const a of g) scoate(a, `${g.length} boxuri (${nums}) au primit exact același punct, ` +
        `deși roadbook-ul are ${span.toFixed(1)} km între ele — un singur răspuns copiat, nu ${g.length} confirmări`);
    } else raman.push(...g);
  }

  // 2. FAȚĂ DE POZIȚIA GPS — dar numai dacă mașina e la raliul ăsta.
  //    Precizarea nu e o slăbire, e condiția ca regula să fie adevărată: geocodarea se
  //    face acasă, cu o zi înainte, iar pentru un raliu la 450 km de casă TOATE ancorele
  //    bune ar fi peste prag. Deci fixul contează ca reper doar dacă mediana ancorelor e
  //    ea însăși în zona lui; altfel mașina pur și simplu nu e pe traseu încă, iar
  //    poziția ei nu spune nimic despre ancore.
  if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng) && raman.length) {
    const repr = grupeazaIdentice(raman).map(g => g[0]);
    const med = medianaPct(repr);
    const fixEPeTraseu = haversineM(fix.lat, fix.lng, med.lat, med.lng) <= PLAUZ_GPS_KM * 1000;
    if (fixEPeTraseu) {
      const trec = [];
      for (const a of raman) {
        const d = haversineM(fix.lat, fix.lng, a.lat, a.lng);
        if (d > PLAUZ_GPS_KM * 1000)
          scoate(a, `la ${Math.round(d / 1000)} km de unde ești acum — traseul de azi nu ajunge acolo`);
        else trec.push(a);
      }
      raman = trec;
    }
  }

  // 3. DOUĂ ANCORE ALE ACELUIAȘI LEG NU POT FI MAI DEPĂRTATE DECÂT LEGUL. Criteriul e
  //    perechea cea mai depărtată, nu distanța până la mediană — pe un leg de 80 km,
  //    „toate la cel mult 85 km de mediană" încă permite două ancore la 170 km una de
  //    alta, ceea ce e imposibil pe un drum de 80 km. (Găsit reconstruind ziua de la
  //    Reșița: rămâneau patru grupuri întinse pe 91 km, fiecare la ~45 km de mediană.)
  //    Cine pleacă din pereche se decide după mediană — cea mai depărtată de centru —
  //    iar mediana se recalculează după fiecare scoatere, altfel un intrus o trage după
  //    el și duce cu el ancore bune. Fiecare grup identic contribuie cu UN reprezentant:
  //    ăsta e locul unde „coordonatele identice nu votează" chiar decide ceva.
  const limitaM = legKm != null && Number.isFinite(legKm)
    ? Math.min(PLAUZ_MEDIANA_KM * 1000, Math.max(PLAUZ_MIN_LEG_KM, legKm + PLAUZ_MARJA_LEG_KM) * 1000)
    : PLAUZ_MEDIANA_KM * 1000;
  for (;;) {
    if (raman.length < 2) break;
    const repr = grupeazaIdentice(raman).map(g => g[0]);
    if (repr.length < 2) break;              // un singur punct distinct: n-are cu ce se compara
    // cea mai depărtată pereche dintre punctele distincte
    let maxM = 0;
    for (let i = 0; i < repr.length; i++)
      for (let j = i + 1; j < repr.length; j++)
        maxM = Math.max(maxM, haversineM(repr[i].lat, repr[i].lng, repr[j].lat, repr[j].lng));
    if (maxM <= limitaM) break;
    const med = medianaPct(repr);
    let rau = null, dRau = -1;
    for (const a of raman) {
      const d = haversineM(med.lat, med.lng, a.lat, a.lng);
      if (d > dRau) { dRau = d; rau = a; }
    }
    if (!rau) break;
    raman = raman.filter(a => a !== rau);
    scoate(rau, `la ${Math.round(dRau / 1000)} km de restul traseului, dar tot legul are ` +
                `${legKm != null ? legKm.toFixed(1) + ' km' : 'mult mai puțin'}`);
  }

  return { bune: raman.sort((a, b) => a.sumKm - b.sumKm), aruncate };
}

// ── ANCORELE: reper geocodat + kilometrul lui de roadbook ───────────────────
// O geocodare greșită e mai periculoasă decât una lipsă: „Str. Turda" există și în
// Cluj, iar o ancoră căzută acolo strică toată harta. Verificarea e cea din roadbook:
// distanța în linie dreaptă dintre două ancore nu poate fi mult mai mare decât drumul
// dintre boxurile lor. Peste 2× drumul (+300 m pentru drumuri scurte și zgomot),
// ancora e de pe alt traseu și se aruncă.
//
// ATENȚIE (06.08.2026): verificarea asta NU e suficientă singură și n-a fost niciodată.
// Ea compară ancorele ÎNTRE ELE, deci confundă ACORDUL cu ADEVĂRUL: 11 ancore căzute în
// exact același punct greșit se potrivesc perfect una cu alta, formează lanțul cel mai
// lung și le aruncă pe cele 5 corecte. Exact asta s-a întâmplat. De-aia rulează întâi
// `poartaPlauzibilitate` (mai jos), care judecă fiecare ancoră față de LUME, nu față de
// celelalte; abia ce trece de ea ajunge aici.
export function verificaAncore(ancore = []) {
  const lista = [...ancore].filter(a => a && Number.isFinite(a.lat) && Number.isFinite(a.lng))
                           .sort((a, b) => a.sumKm - b.sumKm);
  if (lista.length < 2) return { bune: lista, aruncate: [] };

  // Se merge din ambele capete și se păstrează lanțul mai lung: dacă tocmai PRIMA
  // ancoră e cea greșită, un singur drum ar arunca tot restul.
  const lant = (dinDreapta) => {
    const ord = dinDreapta ? [...lista].reverse() : lista;
    const pastrate = [ord[0]], scoase = [];
    for (let i = 1; i < ord.length; i++) {
      const a = pastrate[pastrate.length - 1], b = ord[i];
      const drumM = Math.abs(b.sumKm - a.sumKm) * 1000;
      const dreaptaM = haversineM(a.lat, a.lng, b.lat, b.lng);
      if (dreaptaM > drumM * 2 + 300) scoase.push({ ...b, motiv: `la ${Math.round(dreaptaM)} m de boxul ${a.num}, dar roadbook-ul are ${Math.round(drumM)} m` });
      else pastrate.push(b);
    }
    return { pastrate, scoase };
  };
  const a = lant(false), b = lant(true);
  // Care lanț e „mai lung" se măsoară în PUNCTE DISTINCTE, nu în boxuri: un lanț de 11
  // boxuri căzute toate în același punct e o singură informație, iar unul de 5 boxuri în
  // 5 locuri diferite sunt cinci. Numărate pe boxuri, cele 11 copii ale aceleiași greșeli
  // băteau cele 5 ancore corecte — și exact așa s-a ales lanțul greșit pe 06.08.2026.
  const c = nrPuncteDistincte(a.pastrate) >= nrPuncteDistincte(b.pastrate) ? a : b;
  return { bune: [...c.pastrate].sort((x, y) => x.sumKm - y.sumKm), aruncate: c.scoase };
}

// ── GEOCODAREA (Nominatim / OpenStreetMap) ──────────────────────────────────
// FLUX DE DATE NOU, de citit la audit: la apăsarea butonului „Găsește traseul pe hartă"
// pleacă spre nominatim.openstreetmap.org DOAR șirurile de reper („Str. Turda,
// Timișoara"), unul câte unul. Nu pleacă poziția mașinii, nici jurnalul, nici
// kilometrajul. Se apasă acasă/la hotel, nu în cursă.
//
// POLITICA NOMINATIM: maximum o cerere pe secundă și un client identificabil. Ce putem
// și ce NU putem face, exact:
//  • pauza de o secundă o respectăm noi, serializând cererile — asta ține de noi;
//  • User-Agent nu se poate seta dintr-un browser (e antet interzis de fetch);
//  • Referer NU pleacă nici el: pagina are `<meta name="referrer" content="no-referrer">`,
//    pus dinadins ca aplicația să nu-și spună originea nimănui. Deci, cinstit: cererile
//    noastre ajung la ei ANONIME, iar politica lor cere un client identificabil.
//    Consecința e că ne pot limita oricând, fără preaviz, și trebuie s-o suportăm frumos
//    — de-aia există plafonul de mai jos și cache-ul, iar butonul se apasă o dată,
//    acasă. Dacă ajungem să depindem de geocodare, soluția corectă e o instanță proprie
//    (sau un serviciu cu cheie), nu abuzul de serviciul public al altcuiva.
export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Plafon per rulare a butonului: un roadbook mare n-are voie să se transforme într-o
// rafală de sute de cereri către un serviciu gratuit.
export const MAX_CERERI = 60;

// CÂT DE PRECISĂ E O ANCORĂ GEOCODATĂ. Serviciile de geocodare întorc, pentru o stradă,
// MIJLOCUL ei — nu colțul unde e boxul. Pe Str. Quasar, la 21:48 pe 04.08.2026, diferența
// a fost de ~245 m și a produs o alarmă falsă de ieșire de pe traseu în 27 de secunde de
// la start. Deci fiecare ancoră cară cu ea cât de mult poate greși.
//
// Nominatim întoarce `boundingbox` [sud, nord, vest, est] — pentru o stradă, cutia
// acoperă toată calea. Jumătate din diagonala ei e o măsură cinstită a incertitudinii:
// oriunde pe stradă ar fi boxul, nu e mai departe de-atât de centrul întors. Când
// cutia lipsește, se ia o valoare generoasă — mai bine o alarmă în minus.
export const INC_IMPLICIT_M = 300, INC_MIN_M = 40, INC_MAX_M = 800;

export function incertitudine(rez, lat) {
  const bb = rez && rez.boundingbox;
  if (!Array.isArray(bb) || bb.length < 4) return INC_IMPLICIT_M;
  const s = parseFloat(bb[0]), n = parseFloat(bb[1]), v = parseFloat(bb[2]), e = parseFloat(bb[3]);
  if (![s, n, v, e].every(Number.isFinite)) return INC_IMPLICIT_M;
  const dLat = Math.abs(n - s) * 111320;
  const dLng = Math.abs(e - v) * 111320 * Math.cos((lat || 45) * Math.PI / 180);
  const jumDiag = Math.sqrt(dLat * dLat + dLng * dLng) / 2;
  if (!Number.isFinite(jumDiag) || jumDiag <= 0) return INC_IMPLICIT_M;
  return Math.round(Math.min(INC_MAX_M, Math.max(INC_MIN_M, jumDiag)));
}

export function faGeocoder({ fetchFn, pauzaMs = 1100, timeoutMs = 8000, baza = NOMINATIM,
                             maxCereri = MAX_CERERI } = {}) {
  const f = fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  let ultimaCerere = 0, nCereri = 0;
  // Același reper apare des de două-trei ori într-un roadbook (dus-întors pe aceeași
  // stradă, giratoriul luat de două ori). Se întreabă o singură dată.
  const cache = new Map();
  const asteapta = ms => new Promise(r => setTimeout(r, ms));
  return {
    cereriFacute: () => nCereri,
    async cauta(text) {
      if (!f) throw new Error('fără rețea');
      const q = String(text || '').trim().slice(0, 120);
      if (!q) return null;
      if (cache.has(q)) return cache.get(q);
      if (nCereri >= maxCereri) throw new Error(`plafon atins (${maxCereri} căutări)`);
      const de = Date.now() - ultimaCerere;
      if (de < pauzaMs) await asteapta(pauzaMs - de);
      ultimaCerere = Date.now();
      nCereri++;
      const url = `${baza}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=0`;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      try {
        const r = await f(url, ctrl ? { signal: ctrl.signal } : undefined);
        if (!r || !r.ok) throw new Error(`serverul a răspuns ${r ? r.status : '—'}`);
        const j = await r.json();
        if (!Array.isArray(j) || !j.length) { cache.set(q, null); return null; }
        // Răspunsul e conținut extern: se ia doar ce e număr și în plaja Pământului.
        const lat = parseFloat(j[0] && j[0].lat), lng = parseFloat(j[0] && j[0].lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) { cache.set(q, null); return null; }
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { cache.set(q, null); return null; }
        const p = { lat, lng, incM: incertitudine(j[0], lat) };
        cache.set(q, p);
        return p;
      } finally { if (t) clearTimeout(t); }
    }
  };
}

// Geocodează reperele unui leg, în ordine, cu pauza cerută de serviciu. `onPas` e
// chemat după fiecare reper ca panoul să arate progresul — la 20 de boxuri durează
// ~20 de secunde și pilotul trebuie să vadă că se mișcă.
export async function geocodeazaRepere(repere, geocoder, { onPas = null, onReincercare = null } = {}) {
  const ancore = [], ratate = [];
  // ratatele care mai au o variantă de încercat: [{ r, fisa }], `fisa` fiind chiar
  // obiectul din `ratate`, ca să-l putem scoate de-acolo dacă a doua încercare reușește
  const deReluat = [];
  let i = 0;
  for (const r of repere) {
    i++;
    if (!r.reper) { ratate.push({ num: r.num, motiv: 'fără reper geocodabil' }); if (onPas) onPas(i, repere.length, r); continue; }
    try {
      const p = await geocoder.cauta(r.reper);
      if (p) ancore.push({ num: r.num, sumKm: r.sumKm, reper: r.reper,
                           lat: p.lat, lng: p.lng, incM: p.incM });
      else {
        const fisa = { num: r.num, motiv: 'negăsit pe hartă', reper: r.reper };
        ratate.push(fisa);
        if (r.reper2 && r.reper2 !== r.reper) deReluat.push({ r, fisa });
      }
    } catch (e) {
      ratate.push({ num: r.num, motiv: String(e && e.message || e).slice(0, 60), reper: r.reper });
    }
    if (onPas) onPas(i, repere.length, r);
  }

  // ── A DOUA ÎNCERCARE, cu reperul curat ────────────────────────────────────
  // 06.08.2026: „Piața Mică, Zonă Pietonală, Sibiu" nu există; „Piața Mică, Sibiu" există.
  // Când prima căutare n-a găsit nimic, se mai încearcă o dată cu numele scurt plus
  // localitatea scrisă de om — și atât, fără nimic dedus între ele.
  //
  // Trei limite, intenționate:
  //  • se reia DOAR ce a răspuns „negăsit pe hartă", nu tot roadbook-ul (reperele găsite
  //    n-au ce căuta aici, iar erorile de rețea/plafon se rezolvă altfel);
  //  • plafonul de cereri și pauza de 1100 ms sunt cele existente — vin din `geocoder`,
  //    nu se ocolesc;
  //  • la prima excepție (plafon atins sau rețea căzută) se oprește tot: a doua încercare
  //    e un bonus, nu se insistă pe un serviciu gratuit care deja ne-a spus stop.
  for (let k = 0; k < deReluat.length; k++) {
    const { r, fisa } = deReluat[k];
    if (onReincercare) onReincercare(k + 1, deReluat.length, r);
    let p = null;
    try { p = await geocoder.cauta(r.reper2); }
    catch (e) { fisa.motiv = String(e && e.message || e).slice(0, 60); break; }
    if (!p) { fisa.siFara = r.reper2; continue; }   // nici așa — atunci chiar e ratat
    ancore.push({ num: r.num, sumKm: r.sumKm, reper: r.reper2,
                  lat: p.lat, lng: p.lng, incM: p.incM });
    const poz = ratate.indexOf(fisa);
    if (poz >= 0) ratate.splice(poz, 1);
  }
  // ancorele din a doua trecere s-ar așeza la coadă; ordinea de kilometraj e cea firească
  ancore.sort((a, b) => (Number.isFinite(a.sumKm) ? a.sumKm : 0) - (Number.isFinite(b.sumKm) ? b.sumKm : 0));
  return { ancore, ratate };
}
