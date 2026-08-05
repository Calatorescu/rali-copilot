// RALI 2 — POZELE ROADBOOK-ULUI: nicio pagină nu are voie să dispară în tăcere.
//
// 05.08.2026. Andreas a fotografiat 14 pagini, a apăsat scanare, au intrat 12. A întrebat
// dacă există o limită. Era: `slice(0, 12)` în `pickImages`, pus (aproape sigur) fiindcă
// toate pozele se citeau în base64 DEODATĂ și 30 de poze de telefon omoară fila. Adică o
// limită de MEMORIE aplicată peste CONȚINUT, fără o vorbă.
//
// De ce contează atât: la Sibiu roadbook-ul oficial are zeci de pagini. Cu plafonul ăla,
// ar fi plecat cu jumătate de traseu în telefon, convins că le are pe toate — și ar fi
// aflat pe drum. E exact clasa de defect reparată pe 02.08 („o scanare parțială e un
// EȘEC, nu un succes mai mic"); rămăsese o a doua cale prin care conținutul se pierde.
//
// Aici se verifică partea pură: adunarea pozelor, contorul, plafoanele — și, prin
// citirea codului, că drumul de la selecție la scanare nu mai taie nimic.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { faColectorPoze, MAX_POZE } from '../js/scan.js';

const aici = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
const html = readFileSync(join(aici, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// o „poză" de test = ce întoarce un <input type=file>: un obiect cu nume, tip și mărime.
// Conținutul NU se citește la selecție — asta e chiar reparația.
const poza = i => ({ name: `pagina-${i}.jpg`, type: 'image/jpeg', size: 3.1e6 });
const poze = n => Array.from({ length: n }, (_, i) => poza(i + 1));

console.log('\n═══ Cazul lui Andreas: 14 pagini intră, 14 pagini ies ═══');
{
  const c = faColectorPoze();
  const r = c.adauga(poze(14));
  ok('toate cele 14 sunt acceptate', r.adaugate === 14 && c.total === 14, JSON.stringify(r));
  ok('niciuna respinsă', r.respinse === 0, JSON.stringify(r));
  ok('și lista scoasă la scanare are tot 14',
     c.poze.length === 14, `${c.poze.length}`);
  ok('sunt chiar pozele alese, în ordine',
     c.poze[0].name === 'pagina-1.jpg' && c.poze[13].name === 'pagina-14.jpg');
}

console.log('\n═══ Bucla de fotografiere: pagină cu pagină, cu numărul la vedere ═══');
{
  const c = faColectorPoze();
  const m = [];
  for (let i = 1; i <= 5; i++) m.push(c.adauga([poza(i)]).mesaj);
  ok('fiecare poză spune al câtelea e', m[0] === 'Pagina 1 adăugată.' && m[4] === 'Pagina 5 adăugată.',
     JSON.stringify(m));
  ok('contorul crește exact cu una', c.total === 5, `${c.total}`);
  const anulat = c.adauga([]);
  ok('dacă apeși „înapoi" la cameră, nu se pierde nimic din ce era',
     anulat.anulat === true && anulat.adaugate === 0 && c.total === 5, JSON.stringify(anulat));
  ok('și mesajul spune câte sunt adunate, nu că s-a întâmplat ceva rău',
     /5 pagini adunate/.test(anulat.mesaj), anulat.mesaj);
  c.goleste();
  ok('renunțarea golește lista', c.total === 0 && c.poze.length === 0);
}

console.log('\n═══ Amestecat: câteva din galerie, apoi încă una cu camera ═══');
{
  const c = faColectorPoze();
  c.adauga(poze(9));
  const r = c.adauga([poza(10)]);
  ok('a zecea se adaugă la cele nouă', c.total === 10 && r.adaugate === 1, JSON.stringify(r));
  ok('mesajul numără corect', r.mesaj === 'Pagina 10 adăugată.', r.mesaj);
}

console.log('\n═══ Plafonul care rămâne: există, dar SE VEDE ═══');
{
  // Plafonul colectorului nu e o limită de conținut, ci una de bun-simț pentru bucla de
  // fotografiere. Important e că ce nu intră se RAPORTEAZĂ, nu dispare.
  const c = faColectorPoze({ max: 3 });
  const r = c.adauga(poze(5));
  ok('intră cât încape', r.adaugate === 3 && c.total === 3, JSON.stringify(r));
  ok('dar ce nu intră e NUMĂRAT, nu aruncat în tăcere', r.respinse === 2, JSON.stringify(r));
  ok('și se știe că s-a umplut', r.plin === true);
  ok('plafonul implicit e generos pentru un roadbook oficial', MAX_POZE >= 40, `${MAX_POZE}`);
}

console.log('\n═══ Ce nu e poză nu intră, dar nici nu strică numărătoarea ═══');
{
  const c = faColectorPoze();
  const r = c.adauga([poza(1), null, undefined, poza(2)]);
  ok('intrările goale se ignoră', r.adaugate === 2 && c.total === 2, JSON.stringify(r));
  const r2 = faColectorPoze().adauga(null);
  ok('și o listă lipsă nu crapă', r2.adaugate === 0 && r2.anulat === true, JSON.stringify(r2));
}

console.log('\n═══ Drumul de la selecție la scanare nu mai taie nimic ═══');
{
  // căutarea e țintită pe LISTA DE FIȘIERE: alte `slice` din fișier sunt trunchieri de
  // afișare, fiecare cu „…și încă N" lângă ea — nu taie conținut în tăcere
  const liniiPick = main.split('\n').filter(l => /inp\.files|files\s*=/.test(l));
  ok('lista de fișiere nu mai e tăiată nicăieri',
     liniiPick.length > 0 && liniiPick.every(l => !/\.slice\(/.test(l)),
     JSON.stringify(liniiPick));
  ok('selectorul întoarce FIȘIERE, nu conținut citit',
     /cb\(\[\.\.\.\(inp\.files \|\| \[\]\)\]\);/.test(main), 'pickImages încă citește tot deodată');
  ok('nu se mai citesc toate pozele deodată (cauza plafonului)',
     !/Promise\.all\([\s\S]{0,200}readAsDataURL/.test(main), 'a rămas citirea în bloc');
  ok('poza se citește în bucla de scanare, când îi vine rândul',
     /await citestePoza\(imgs\[i\]\)/.test(main), 'citirea nu e leneșă');
  ok('și se eliberează după ce a fost trimisă',
     /poza = null;\s+\/\/ șirul base64/.test(main), 'poza nu se eliberează');
  ok('numărul selectat se arată ÎNAINTE de prima cerere',
     /pagini selectate'\}\. Încep scanarea…/.test(main), 'nu se anunță câte pagini s-au ales');
  ok('la peste 15 pagini se cere confirmare, cu cifra și cu timpul',
     /PRAG_CONFIRMARE_PAGINI/.test(main) && /pagini selectate\.\\n\\n/.test(main),
     'nu se confirmă selecțiile mari');
  ok('bilanțul final compară scanate cu selectate',
     /din \$\{imgs\.length\} pagini scanate/.test(main), 'bilanțul nu arată din cât');
  ok('și intră în jurnal, ca să se poată verifica după',
     /scan_bilant/.test(main));
}

console.log('\n═══ Cele două căi din interfață ═══');
{
  ok('butonul de cameră pentru roadbook', /id="btn-scan-foto"/.test(html));
  ok('butonul de galerie pentru roadbook', /id="btn-scan-rb"/.test(html));
  ok('bucla „încă una / gata"', /id="btn-foto-inca"/.test(html) && /id="btn-foto-gata"/.test(html));
  ok('și la time card, ambele căi', /id="btn-scan-tc-foto"/.test(html) && /id="btn-scan-tc"/.test(html));
  ok('camera cere `capture=environment`', /inp\.capture = 'environment'/.test(main));
  ok('`capture` NU se pune odată cu `multiple` — atributul l-ar ignora',
     /if \(capture\) inp\.capture = 'environment';\s*\n\s*else if \(multiple\) inp\.multiple = true;/.test(main),
     'capture și multiple se pun împreună');
  ok('butonul de cameră dispare unde nu există cameră (desktop)',
     /suportaCamera\(\)/.test(main) && /if \(b && !camOk\) b\.classList\.add\('hidden'\)/.test(main));
  ok('pozele din buclă intră prin ACELAȘI drum ca cele din galerie',
     /scaneazaPozele\(poze\);\s+\/\/ exact același drum/.test(main), 'logica de scanare e duplicată');
  ok('sfatul practic e scris sub butoane',
     /mai rapid să faci pozele cu[\s\S]{0,120}galerie/.test(html), 'lipsește sfatul');
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
