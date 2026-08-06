// RALI 2 — ecranul de condus: ce se citește dintr-o privire de 0,3 s.
//
// Nu e un test de frumusețe. Andreas a condus tura Tresor (04.08.2026) și a spus că
// „textul e prea mic și semnul de direcție mult prea mic" — adică ecranul nu se putea
// folosi la volan. Verificările de aici pun cifrele alea în piatră, ca o reglare de CSS
// făcută în grabă să nu le poată strica înapoi. Plus capcana care nu se vede decât pe
// telefon: un id scris greșit face `render` să crape tăcut, în plină cursă.
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const aici = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(aici, '..', 'app.css'), 'utf8');
const html = readFileSync(join(aici, '..', 'index.html'), 'utf8');
const ui = readFileSync(join(aici, '..', 'js', 'ui.js'), 'utf8');
const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
const sw = readFileSync(join(aici, '..', 'sw.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// mărimea „de bază" a unei reguli: din clamp(min, ideal, max) luăm maximul, adică
// mărimea de pe un ecran de telefon normal
function px(selector, prop = 'font-size') {
  // ancorat la începutul regulii, altfel „.nx-dir" prinde și „#cp-nav.compact .nx-dir"
  const re = new RegExp('^\\s*' + selector.replace(/[.#]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  const m = css.match(re);
  if (!m) return null;
  const p = m[1].match(new RegExp(prop + '\\s*:\\s*([^;]+)'));
  if (!p) return null;
  const val = p[1].trim();
  const cl = val.match(/clamp\(([^,]+),([^,]+),([^)]+)\)/);
  return parseFloat(cl ? cl[3] : val);
}

console.log('\n═══ Ierarhia: săgeata domină, distanța o urmează, strada e secundară ═══');
{
  const dir = px('.nx-dir'), dist = px('.nx-dist'), com = px('.nx-com'), box = px('.nx-box');
  ok('săgeata de direcție e cel puțin dublă față de v31 (era 84 px)', dir >= 168, `${dir} px`);
  ok('și e cel mai mare element din card', dir > dist && dir > com, JSON.stringify({ dir, dist, com }));
  ok('distanța a crescut și ea (era 34 px)', dist >= 60, `${dist} px`);
  ok('numele străzii rămâne secundar, sub distanță', com < dist / 2, JSON.stringify({ com, dist }));
  ok('și e scris în gri, nu în alb — se citește dacă ai timp',
     /\.nx-com\s*\{[^}]*color:\s*var\(--dim\)/.test(css), 'nx-com nu e dim');
  ok('numărul boxului rămâne cea mai mică informație', box <= com, JSON.stringify({ box, com }));
}

console.log('\n═══ În probă ecranul e altul, dar tot lizibil ═══');
{
  const dirC = px('#cp-nav.compact .nx-dir'), distC = px('#cp-nav.compact .nx-dist');
  ok('săgeata compactă s-a dublat față de v31 (era 44 px)', dirC >= 88, `${dirC} px`);
  ok('distanța compactă a crescut (era 22 px)', distC >= 40, `${distC} px`);
  ok('dar rămâne mai mică decât în legătură — acolo cifra de deviere e cea urmărită',
     dirC < px('.nx-dir'), JSON.stringify({ dirC, dir: px('.nx-dir') }));
}

console.log('\n═══ Ecranul „întoarcere la traseu" există și e roșu ═══');
{
  ok('cardul de navigație are stare de ieșire de pe traseu',
     /#cp-nav\.offroute\s*\{/.test(css), 'lipsește #cp-nav.offroute');
  ok('și e marcat cu roșu, nu doar cu text',
     /#cp-nav\.offroute\s*\{[^}]*var\(--bad\)/.test(css), 'nu folosește --bad');
  ok('butonul de pe ecranul de cursă există', /id="btn-offroute"/.test(html));
  ok('setarea din panoul de pregătire există și e bifată implicit',
     /id="set-offroute"[^>]*checked/.test(html), 'lipsește sau nu e checked');
  ok('limita (linie dreaptă, nu străzi) e scrisă în interfață, nu doar în cod',
     /hart[ăa] rutier/i.test(html) && /LINIE DREAPT/i.test(html), 'limita nu e scrisă');
}

// ── ECRAN ÎMPĂRȚIT ────────────────────────────────────────────────────────
// Andreas conduce la Sibiu cu RALI sus și Google Maps jos, deci aplicația primește
// jumătate de ecran pe înălțime, cu lățimea neatinsă. Verificările de mai jos există
// fiindcă modul ăsta NU se vede la dezvoltare: pe desktop fereastra e mare, iar o
// mărime în `vw` arată perfect exact până în momentul în care ecranul se înjumătățește.
function bloc(conditie) {
  // conținutul unui @media, până la acolada lui de închidere (nivel 1 de imbricare)
  const i = css.indexOf(`@media (${conditie})`);
  if (i < 0) return null;
  let adanc = 0, start = -1;
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') { if (adanc === 0) start = j + 1; adanc++; }
    else if (css[j] === '}') { adanc--; if (adanc === 0) return css.slice(start, j); }
  }
  return null;
}
function pxIn(sursa, selector, prop = 'font-size') {
  if (!sursa) return null;
  const re = new RegExp('(?:^|\\})\\s*' + selector.replace(/[.#]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  const m = sursa.match(re);
  if (!m) return null;
  const p = m[1].match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)'));
  if (!p) return null;
  const val = p[1].trim();
  const cl = val.match(/clamp\(([^,]+),([^,]+),([^)]+)\)/);
  return { min: parseFloat(cl ? cl[1] : val), ideal: cl ? cl[2].trim() : val,
           max: parseFloat(cl ? cl[3] : val) };
}

console.log('\n═══ Ecran împărțit: aplicația încape în jumătate de telefon ═══');
{
  const jum = bloc('max-height: 620px'), stramt = bloc('max-height: 460px');
  ok('există o treaptă pentru jumătate de ecran', !!jum);
  ok('și una și mai strânsă, pentru o treime sau peisaj', !!stramt);

  const dir = pxIn(jum, '#cp-nav .nx-dir'), dist = pxIn(jum, '#cp-nav .nx-dist');
  ok('săgeata se măsoară în ÎNĂLȚIMEA ferestrei, nu în lățimea ecranului',
     !!dir && /vh$/.test(dir.ideal), dir && dir.ideal);
  ok('și distanța la fel — altfel rămân amândouă cât pe ecran întreg',
     !!dist && /vh$/.test(dist.ideal), dist && dist.ideal);
  ok('săgeata rămâne dominantă, dar proporțional (cel puțin 1,5× distanța)',
     dir && dist && parseFloat(dir.ideal) >= parseFloat(dist.ideal) * 1.5,
     JSON.stringify({ dir: dir && dir.ideal, dist: dist && dist.ideal }));
  ok('la 500 px de fereastră, săgeata și distanța încap împreună sub 220 px',
     dir && dist && (parseFloat(dir.ideal) + parseFloat(dist.ideal)) / 100 * 500 < 220,
     JSON.stringify({ suma: dir && dist ? ((parseFloat(dir.ideal) + parseFloat(dist.ideal)) / 100 * 500).toFixed(0) + ' px' : '?' }));
  ok('cardul de navigație devine bandă orizontală: cifra lângă săgeată',
     /#cp-nav\s*\{[^}]*display:\s*flex/.test(jum), 'nu e flex în jumătate de ecran');
  ok('ordinea e cea din frază — întâi distanța, apoi direcția („300 de metri — dreapta")',
     /#cp-nav \.nx-dist\s*\{[^}]*order:\s*1/.test(jum) &&
     /#cp-nav \.nx-dir\s*\{[^}]*order:\s*2/.test(jum), 'ordinea nu e cea din frază');

  const dev = pxIn(jum, '#cp-rt .cp-dev');
  ok('în probă, devierea rămâne cea mai mare cifră de pe ecran',
     dev && parseFloat(dev.ideal) >= parseFloat(dist.ideal),
     JSON.stringify({ dev: dev && dev.ideal, dist: dist && dist.ideal }));
  ok('și se măsoară tot în înălțime', dev && /vh$/.test(dev.ideal), dev && dev.ideal);
  ok('cardul de probă devine și el bandă orizontală',
     /#cp-rt\s*\{[^}]*display:\s*flex/.test(jum));

  ok('la o treime de ecran, numele străzii și manevra de după se ascund',
     /#cp-nav \.nx-com,\s*#cp-nav \.nx-after[^{]*\{[^}]*display:\s*none/.test(stramt),
     'secundarul nu se ascunde');
  ok('dar distanța și săgeata rămân — ele răspund la „cât mai am și încotro"',
     !!pxIn(stramt, '#cp-nav .nx-dist') && !!pxIn(stramt, '#cp-nav .nx-dir'));
  ok('harta se strânge și ea, ca să nu împingă butoanele afară',
     /#map-wrap\s*\{[^}]*height:/.test(jum) && /#map-wrap\s*\{[^}]*height:/.test(stramt));
}

console.log('\n═══ Ecran împărțit: difuzorul NU se poate împărți ═══');
{
  // Maps vorbește și el. Nu putem cere prioritate pe difuzor dintr-un browser — deci
  // singurul remediu real e o instrucțiune citită înainte de plecare, nu o linie de cod.
  ok('panoul de pregătire spune să se oprească vocea din Maps',
     /Oprește vocea din Google\s*\n?\s*Maps/.test(html) || /Oprește vocea din Google Maps/.test(html.replace(/\s+/g, ' ')),
     'lipsește avertismentul despre voce');
  ok('și spune de ce aplicația nu poate rezolva singură asta',
     /nu poate cere\s+prioritate|prioritate pe difuzor/.test(html.replace(/\s+/g, ' ')));
  ok('vocea se repornește singură dacă Android o pune pe pauză',
     /keepAlive\(\)\s*\{\s*if \(S && S\.paused\) S\.resume\(\)/.test(
       readFileSync(join(aici, '..', 'js', 'voice.js'), 'utf8')));
}

console.log('\n═══ Capcana care se vede doar pe telefon: id-uri care nu există ═══');
{
  const idsHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const cerute = [...ui.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map(m => m[1]);
  // cp-nextleg-btn are alternativă explicită în cod (`|| $('btn-nextleg')`)
  const lipsa = [...new Set(cerute)].filter(i => !idsHtml.has(i) && i !== 'cp-nextleg-btn');
  ok('toate elementele cerute de ui.js există în pagină', lipsa.length === 0, JSON.stringify(lipsa));
  const cerutMain = [...main.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map(m => m[1]);
  const lipsaMain = [...new Set(cerutMain)].filter(i => !idsHtml.has(i));
  ok('și cele cerute de main.js la fel', lipsaMain.length === 0, JSON.stringify(lipsaMain));
}

console.log('\n═══ Pe dinafară, ecranul spune CE E boxul de reintrare ═══');
{
  // Sibiu, 06.08.2026: ecranul arăta „box 10 · hartă" și o săgeată. Nimic despre
  // giratoriul de pe Str. Constituției, deși textul exista în roadbook. Descrierea stă
  // pe linia numărului de box fiindcă e SINGURA din cardul de navigație care nu dispare
  // pe ecran scund — .nx-com și .nx-after sunt ascunse la max-height 460px.
  ok('linia „box N" din ui.js include descrierea țintei',
     /cp-next-box'\)\.textContent = 'box ' \+ o\.boxNum \+\s*\n?\s*\(o\.descriere \?/.test(ui),
     'ui.js nu mai scrie o.descriere pe linia de box');
  ok('și linia aia chiar rămâne vizibilă pe ecranul cel mai scund',
     /max-height:\s*460px/.test(css) &&
     !/#cp-nav \.nx-com,[^}]*\.nx-box/.test(css.split('max-height: 460px')[1] || ''),
     'nx-box a ajuns printre elementele ascunse');
}

console.log('\n═══ Versiunea: BUILD și CACHE nu au voie să se despartă ═══');
{
  // un main.js nou lângă module vechi din cache oprește init() cu totul (audit 04.08)
  const build = (main.match(/const BUILD = '([^']+)'/) || [])[1];
  const cache = (sw.match(/const CACHE = 'rali2-([^']+)'/) || [])[1];
  ok('BUILD și CACHE sunt aceeași versiune', build && build === cache,
     JSON.stringify({ build, cache }));
  // lista se citește de pe disc, nu se scrie de mână: un modul nou uitat din ASSETS
  // înseamnă că telefonul îl cere de pe rețea în cursă — adică nu-l are deloc
  const module = readdirSync(join(aici, '..', 'js')).filter(f => f.endsWith('.js'));
  const lipsa = module.filter(m => !sw.includes(`./js/${m}`));
  ok(`toate cele ${module.length} module din js/ sunt în lista de cache a service worker-ului`,
     lipsa.length === 0, JSON.stringify(lipsa));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
