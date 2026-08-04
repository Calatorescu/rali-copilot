// RALI 2 — ecranul de condus: ce se citește dintr-o privire de 0,3 s.
//
// Nu e un test de frumusețe. Andreas a condus tura Tresor (04.08.2026) și a spus că
// „textul e prea mic și semnul de direcție mult prea mic" — adică ecranul nu se putea
// folosi la volan. Verificările de aici pun cifrele alea în piatră, ca o reglare de CSS
// făcută în grabă să nu le poată strica înapoi. Plus capcana care nu se vede decât pe
// telefon: un id scris greșit face `render` să crape tăcut, în plină cursă.
import { readFileSync } from 'fs';
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

console.log('\n═══ Versiunea: BUILD și CACHE nu au voie să se despartă ═══');
{
  // un main.js nou lângă module vechi din cache oprește init() cu totul (audit 04.08)
  const build = (main.match(/const BUILD = '([^']+)'/) || [])[1];
  const cache = (sw.match(/const CACHE = 'rali2-([^']+)'/) || [])[1];
  ok('BUILD și CACHE sunt aceeași versiune', build && build === cache,
     JSON.stringify({ build, cache }));
  ok('toate modulele din js/ sunt în lista de cache a service worker-ului',
     ['machine', 'ui', 'voice', 'learn', 'route', 'main'].every(m => sw.includes(`./js/${m}.js`)),
     'lipsesc module din ASSETS');
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
