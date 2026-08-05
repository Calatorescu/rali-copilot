// RALI 2 — NAVIGAREA: harta vie ca ecran, și ținta predată lui Google Maps.
//
// Două lucruri diferite, verificate în același loc fiindcă răspund aceleiași întrebări
// („unde sunt și încotro"):
//  • ecranul de hartă — aici se verifică doar CONTRACTUL lui (există, e în lista de
//    cache, dalele au voie prin CSP, cache-ul lor nu se șterge la actualizare).
//    Desenul propriu-zis nu se testează, se vede;
//  • ținta de Maps — funcție de stare, deci se verifică pe mașina de stări reală.
//
// Fixturi: latitudini reale ca ordin de mărime, longitudini DEPLASATE cu −10, zero adrese.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { traseuDinPlan, pozitiiBoxuri } from '../js/harta-vie.js';

const aici = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(aici, '..', 'index.html'), 'utf8');
const sw = readFileSync(join(aici, '..', 'sw.js'), 'utf8');
const css = readFileSync(join(aici, '..', 'app.css'), 'utf8');
const ecran = readFileSync(join(aici, '..', 'js', 'harta-ecran.js'), 'utf8');
const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

console.log('\n═══ Dalele au voie prin CSP — și NUMAI ele ═══');
{
  const m = html.match(/Content-Security-Policy" content="([^"]+)"/);
  const csp = m ? m[1] : '';
  const dir = Object.fromEntries(csp.split(';').map(s => s.trim()).filter(Boolean)
    .map(s => [s.split(/\s+/)[0], s.split(/\s+/).slice(1)]));
  ok('img-src permite dalele OpenStreetMap',
     (dir['img-src'] || []).includes('https://tile.openstreetmap.org'), JSON.stringify(dir['img-src']));
  ok('connect-src la fel (descărcarea offline le cere cu fetch, ca să vadă 429/403)',
     (dir['connect-src'] || []).includes('https://tile.openstreetmap.org'), JSON.stringify(dir['connect-src']));
  // Regula lui Andreas, din brief: nicio sursă de hartă care cere cheie sau cont.
  // Cheia ar trebui ținută undeva, iar „undeva" într-o aplicație de telefon înseamnă
  // în cod sau în localStorage — adică publicată.
  const gazde = [...new Set([...(dir['img-src'] || []), ...(dir['connect-src'] || [])])]
    .filter(x => /^https:/.test(x));
  ok('nicio gazdă de hărți în plus față de OSM/Nominatim',
     gazde.every(g => /openstreetmap\.org$/.test(g) || /api\.(anthropic|github)\.com$/.test(g)),
     JSON.stringify(gazde));
  ok('și niciun șablon de dale cu cheie/token în cod',
     !/tile[^\n]*(apikey|access_token|\?key=)/i.test(readFileSync(join(aici, '..', 'js', 'harta-vie.js'), 'utf8')));
  ok('pagina rămâne no-referrer', /name="referrer" content="no-referrer"/.test(html));
  ok('dar cererile de dale trimit doar originea, ca OSM să știe cine cere',
     /referrerPolicy = 'origin'/.test(ecran) && /referrerPolicy: 'origin'/.test(ecran),
     'lipsește referrerPolicy explicit pe dale');
}

console.log('\n═══ Cache-ul de dale nu se aruncă la actualizarea aplicației ═══');
{
  // Zeci de minute de descărcat pe un server public. Un bump de versiune care le
  // ștergea ar fi lăsat pilotul fără hartă exact la Bâlea, unde nu e semnal.
  ok('service worker-ul are cache separat pentru dale', /const DALE = 'rali2-dale'/.test(sw));
  const act = sw.match(/addEventListener\('activate'[\s\S]*?\}\);/);
  ok('iar curățenia de la activare îl EXCLUDE explicit',
     !!act && /k !== DALE/.test(act[0]), act ? act[0].slice(0, 200) : 'lipsește');
  ok('plafonul e de 2000 de dale (ambele etape încap: 610 + 934 măsurate)',
     /const DALE_MAX = 2000/.test(sw));
  ok('dalele se servesc din cache înainte de rețea',
     /caches\.open\(DALE\)[\s\S]{0,200}c\.match\(url\)/.test(sw));
  ok('și se cer întâi în CORS, ca să nu umple spațiul cu răspunsuri opace',
     /mode: 'cors'[\s\S]{0,80}referrerPolicy: 'origin'/.test(sw));
}

console.log('\n═══ Descărcarea în masă NU există nicăieri în aplicație ═══');
{
  // Politica OSM (operations.osmfoundation.org/policies/tiles/) interzice pe nume
  // „bulk downloading (scraping)" și folosirea offline, iar funcțiile de tip „download
  // area for offline use" sunt date direct ca exemplu de folosire interzisă. Sancțiunea
  // e blocare pe IP fără avertisment — adică exact să rămânem fără hartă ÎN cursă.
  // A existat un buton care aducea coridorul rutei; a fost SCOS, nu limitat. Verificarea
  // asta e aici ca să nu se întoarcă din reflex, la o „îmbunătățire" de peste trei luni.
  const surse = ['js/harta-vie.js', 'js/harta-ecran.js', 'js/main.js', 'js/machine.js', 'sw.js']
    .map(f => readFileSync(join(aici, '..', f), 'utf8')).join('\n');
  for (const urma of ['daleCoridor', 'descarcaDale', 'descarcaCoridorul', 'esantioneazaLinie'])
    ok(`nicio urmă de „${urma}" în cod`, !new RegExp('\\b' + urma + '\\s*\\(').test(surse));
  // pe pagina fără comentarii: comentariul care explică DE CE nu există butonul e
  // exact ce vrem să rămână, deci nu se caută în el
  const paginaVie = html.replace(/<!--[\s\S]*?-->/g, '');
  ok('nici buton de descărcare în pagină',
     !/btn-dale-desc|Descarcă harta/i.test(paginaVie), 'a rămas un buton de descărcare');
  ok('rămâne butonul de diagnostic, care cere O SINGURĂ dală',
     /id="btn-dale-test"/.test(html) && /export async function testeazaDale/.test(ecran));
  ok('iar interfața nu mai promite offline, ci explică varianta schematică',
     /varianta schematică/.test(html) && !/offline la munte/i.test(html),
     'textul din pregătire încă promite offline');
  ok('și codul spune de ce nu există, ca să nu pară o scăpare',
     /Bulk downloading/.test(readFileSync(join(aici, '..', 'js', 'harta-vie.js'), 'utf8')));
}

console.log('\n═══ Ce intră în cache-ul de dale: numai dale ═══');
{
  // Auditul, punctul 4a — singurul defect care putea strica harta PERMANENT: pe o rețea
  // cu portal captiv (hotel, benzinărie), cererea de dală e interceptată și primești
  // pagina de login. Ca răspuns opac arăta exact ca o dală bună, iar politica de aici e
  // cache-first: ar fi fost servită apoi la infinit, inclusiv pe munte, unde n-ai cum
  // s-o mai înlocuiești.
  ok('un răspuns cu status ne-ok se întoarce, dar NU se stochează',
     /if \(res && !res\.ok\) return res;/.test(sw),
     'un 429 sau 403 s-ar putea lipi de dală pentru totdeauna');
  ok('se scrie doar ce a venit prin CORS, cu status bun și tip de imagine',
     /res\.ok && res\.type === 'cors'/.test(sw) && /image\\\//.test(sw),
     'condiția de scriere e prea largă');
  ok('răspunsurile opace nu mai ajung în cache',
     !/res\.type === 'opaque'/.test(sw), 'încă se acceptă răspunsuri opace');
}

console.log('\n═══ Spațiul: jurnalul cursei nu se evacuează odată cu dalele ═══');
{
  // Chrome evacuează PE ORIGINE, nu selectiv: fără cererea asta, presiunea de spațiu ar
  // fi luat și IndexedDB, adică jurnalul zilei — nu doar niște dale care se pot recere.
  ok('se cere stocare persistentă la pornire',
     /navigator\.storage\.persist\(\)/.test(main), 'lipsește persist()');
  ok('și e înfășurată, ca un refuz să nu oprească pornirea',
     /try \{[^}]*persist\(\)[^}]*\}[\s\S]{0,40}catch/.test(main), 'persist() nu e în try/catch');
}

console.log('\n═══ Harta nu recalculează traseul la fiecare cadru ═══');
{
  // Auditul, punctul 6a: la 5 cadre pe secundă, O(boxuri × puncte de urmă) de fiecare
  // dată înseamnă presiune de colectare a gunoiului pe FIRUL PE CARE RULEAZĂ ȘI
  // CRONOMETRUL. Cheia e obiectul `plan`: rebuildPlan construiește unul nou ori de câte
  // ori se schimbă ceva, deci identitatea lui e exact semnalul de „recalculează".
  const hv = readFileSync(join(aici, '..', 'js', 'harta-vie.js'), 'utf8');
  ok('linia traseului și pozițiile boxurilor se memoizează pe identitatea planului',
     /memoTraseu = new WeakMap\(\), memoPozitii = new WeakMap\(\)/.test(hv));
  const p1 = { boxes: [], harta: null, trace: null };
  ok('al doilea apel întoarce ACELAȘI obiect, nu unul nou',
     traseuDinPlan(p1) === traseuDinPlan(p1) && pozitiiBoxuri(p1) === pozitiiBoxuri(p1));
  const p2 = { boxes: [], harta: null, trace: null };
  ok('dar un plan NOU se recalculează — altfel harta ar îngheța la o rescanare',
     traseuDinPlan(p2) !== traseuDinPlan(p1) && pozitiiBoxuri(p2) !== pozitiiBoxuri(p1));
}

console.log('\n═══ Ecranul de hartă există și e cablat ═══');
{
  ok('secțiunea ecranului', /id="scr-map"/.test(html));
  ok('canvas-ul', /id="map-canvas"/.test(html));
  for (const id of ['btn-harta-vie', 'btn-map-inapoi', 'btn-map-rot', 'btn-map-zin',
                    'btn-map-zout', 'btn-map-zauto', 'btn-dale-test'])
    ok(`butonul ${id}`, new RegExp(`id="${id}"`).test(html));
  ok('harta ocupă cel puțin jumătate din înălțimea disponibilă',
     /#map-wrap\s*\{[^}]*height:\s*min\(6\d?vh/.test(css), 'înălțimea hărții nu e definită în vh');
  ok('limita hărții aproximative e scrisă pe ecran, nu doar în cod',
     /traseu APROXIMATIV, din adrese/.test(main));
  ok('și nota de baterie la fel', /consumă baterie/i.test(html));
  ok('harta se închide singură în probă (revenire la cockpit)',
     /state === 'RT_RUN' && onProba/.test(ecran), 'lipsește întoarcerea automată');
  ok('și nu desenează nimic când ecranul nu se vede',
     /visibilityState === 'visible'/.test(ecran));
  ok('bucla de desen e a ei, nu în drumul fixului GPS',
     /requestAnimationFrame\(bucla\)/.test(ecran) &&
     !/onFix/.test(ecran), 'randarea atinge bucla GPS');
}

// ── ținta predată lui Maps ─────────────────────────────────────────────────
const BOXES = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flag: 'TC', comment: 'START' },
  { num: 2, sumKm: 0.30, dir: 'DREAPTA', comment: 'dreapta' },
  { num: 3, sumKm: 0.70, dir: 'ÎNAINTE', comment: 'reper fără adresă' },
  { num: 4, sumKm: 1.20, dir: 'STÂNGA', comment: 'stânga' },
  { num: 5, sumKm: 2.20, dir: 'ÎNAINTE', flag: 'RT_START_AUTO', comment: 'start probă · 40 km/h' },
  { num: 6, sumKm: 3.20, dir: 'ÎNAINTE', flag: 'RT_FINISH', comment: 'finish' }
]);
const LAT = 45.7823, LNG = 14.1461;
const m2g = (lat, lng, m, deg) => {
  const r = deg * Math.PI / 180;
  return { lat: lat + (m * Math.cos(r)) / 111320,
           lng: lng + (m * Math.sin(r)) / (111320 * Math.cos(lat * Math.PI / 180)) };
};
// harta are coordonate pentru 1, 2, 4 — boxul 3 lipsește dinadins
const HARTA = { 1: { lat: LAT, lng: LNG }, 2: m2g(LAT, LNG, 300, 90),
                4: m2g(LAT, LNG, 1200, 90) };

function lume(harta = HARTA) {
  let wall = 0, lat = LAT, lng = LNG;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ plan: buildPlan(BOXES, { '5_220': 40 }, null, harta), clock, store,
    driver: makeDriverModel(), opts: { offRoute: false },
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat, lng, tMs: wall, speedMs: 0, headingDeg: 90, accM: 6 });
  const pas = (metri, hdg = 90) => {
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(LAT * Math.PI / 180));
    wall += 1000;
    m.onFix({ lat, lng, tMs: wall, speedMs: metri, headingDeg: hdg, accM: 6 });
  };
  return { m, said, pas, store };
}

console.log('\n═══ Ținta de Maps: permanentă, nu doar la rătăcire ═══');
{
  const w = lume();
  const t = w.m.tintaMaps();
  ok('de la start, ținta e boxul următor cu coordonată (2)',
     !!t && t.boxNum === 2 && t.deCe === 'urmator', JSON.stringify(t && { b: t.boxNum, d: t.deCe }));
  ok('și e marcată aproximativă — coordonata vine dintr-o adresă, nu din drumul condus',
     t.aproximativa === true && t.sursa === 'harta', JSON.stringify({ s: t.sursa, a: t.aproximativa }));
  ok('ținta stă și pe stare, ca ecranul să rămână o funcție de stare',
     w.m.M.tintaMaps && w.m.M.tintaMaps.boxNum === 2, JSON.stringify(w.m.M.tintaMaps));
}

console.log('\n═══ Boxul următor fără coordonată: se sare la primul care are ═══');
{
  const w = lume();
  for (let i = 0; i < 12; i++) w.pas(40);        // ~480 m: boxurile 1-2 rămân în urmă
  const t = w.m.tintaMaps();
  ok('boxul 3 n-are ancoră, deci ținta devine boxul 4',
     !!t && t.boxNum === 4 && t.deCe === 'primul_cu_ancora',
     JSON.stringify({ nextBoxIdx: w.m.M.nextBoxIdx, t: t && t.boxNum, d: t && t.deCe }));
  ok('un link către „nimic" nu se produce niciodată',
     !!t.pct && isFinite(t.pct.lat) && isFinite(t.pct.lng), JSON.stringify(t.pct));
}

console.log('\n═══ Fără nicio coordonată nu se minte cu un buton ═══');
{
  const w = lume(null);
  const t = w.m.tintaMaps();
  ok('fără hartă și fără recunoaștere, nu există țintă (butonul rămâne ascuns)',
     t === null, JSON.stringify(t));
}

console.log('\n═══ În probă butonul dispare: o atingere acolo costă cronometrul ═══');
{
  const w = lume();
  for (let i = 0; i < 60; i++) w.pas(40);        // trece de startul probei (2,20 km)
  ok('proba chiar a pornit', w.m.M.state === 'RT_RUN', w.m.M.state);
  ok('și ținta de Maps e null cât ține proba', w.m.tintaMaps() === null);
}

console.log('\n═══ Pe dinafară, ținta devine punctul de reintrare ═══');
{
  const w = lume();
  for (let i = 0; i < 8; i++) w.pas(40);
  w.m.offRouteManual();
  const t = w.m.tintaMaps();
  ok('ținta e punctul de reintrare, marcat ca atare',
     !!t && t.deCe === 'offroute', JSON.stringify(t && t.deCe));
  ok('și are un punct pe hartă către care se poate naviga',
     !!t.pct && isFinite(t.pct.lat), JSON.stringify(t && t.pct));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
