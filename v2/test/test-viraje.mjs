// RALI 2 — „VIRAJELE MELE": omul declară unde se virează, restul tace.
//
// Cererea lui Andreas, textual, de pe traseu (07.08.2026, între etape, la Sibiu):
// „aplicația să vadă roadbook-ul tot, să citească cum vrea, dar EU să-i precizez boxurile
// unde chiar se schimbă direcția: la boxul 6 faci dreapta, la boxul 18 ieși din sens a
// treia — de genul ăsta."
//
// E o RĂSTURNARE de contract, nu o unealtă în plus. Până acum scanarea propunea o direcție
// pentru FIECARE box, iar omul corecta ce apuca — deci fiecare tulipă necitită corect
// rămânea o capcană activă. De-acum omul declară cele câteva zeci de boxuri unde chiar se
// virează, iar tot restul devine ÎNAINTE, adică MUT.
//
// De ce e sigur: ÎNAINTE e tăcere (măsurat în test-tulipe.mjs — box fără semn și cu dir
// ÎNAINTE nu produce niciun cue, nicio alarmă de viraj ratat, nicio lipire pe viraj). Cea
// mai proastă consecință a unui box uitat din lista lui e că aplicația tace acolo unde el
// are oricum roadbook-ul de hârtie. Cea mai proastă consecință a variantei vechi era
// „dreapta acum" pe un drum drept, în probă cronometrată.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildPlan, sanitizeBoxes, normFlags, areFlag,
         normVirajeProprii, puneVirajPropriu, scoateVirajPropriu,
         aplicaVirajeProprii, instantaneuDirectii, restaureazaDirectii,
         declaraViraj, retrageViraj, stareViraje } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore, exportDay, importDay } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

const aici = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// Un leg mic, dar cu toate capcanele reale: două boxuri citite greșit ca viraj (3 și 5),
// un giratoriu care trebuie să rămână giratoriu dar cu ALTĂ ieșire (7), semne de probă
// care n-au voie să se clintească (1, 6), și un box mut la scanare (4).
const LEG = () => sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Start Leg 1 / TC 1' },
  { num: 2, sumKm: 0.40, dir: 'ÎNAINTE', flags: [], comment: '' },
  { num: 3, sumKm: 0.90, dir: 'DREAPTA', flags: [], comment: 'liniuțe laterale' },
  { num: 4, sumKm: 1.30, dir: null,      flags: [], comment: 'căsuță necitită' },
  { num: 5, sumKm: 1.80, dir: 'STÂNGA',  flags: [], comment: 'bifurcație în Y' },
  { num: 6, sumKm: 2.40, dir: 'ÎNAINTE', flags: ['RT_START_AUTO'], comment: 'Start RT 1' },
  { num: 7, sumKm: 3.10, dir: 'GIRATORIU-2', flags: [], comment: 'giratoriu Kaufland' },
  { num: 8, sumKm: 3.90, dir: 'ÎNAINTE', flags: ['RT_FINISH'], comment: 'Finish RT 1' }
]);

// Ce a scris omul pe hârtie, seara: DOUĂ viraje reale în tot leg-ul.
const DECLARAT = [{ num: 5, dir: 'DREAPTA' }, { num: 7, dir: 'GIRATORIU-3' }];

function lume(boxes) {
  let wall = 0, km = 0;
  const said = [];
  const store = makeMemStore();
  const m = makeMachine({ opts: { offRoute: false }, plan: buildPlan(boxes, {}, null),
    clock: makeClock({ now: () => wall, mono: () => wall }), store, driver: makeDriverModel(),
    voice: { say: (t, p, c, cl) => said.push({ t, cl }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start(); wall += 1000;
  m.onFix({ lat: 45, lng: 21, tMs: wall, speedMs: 0, headingDeg: 0, accM: 8 });
  return { m, store, said,
    condu(pana, kmh = 36) {
      while (km < pana - 1e-9) {
        const p = Math.min(kmh / 3600, pana - km); km += p; wall += 1000;
        m.onFix({ lat: 45 + km / 111.32, lng: 21, tMs: wall, speedMs: p * 1000,
                  headingDeg: 0, accM: 8 });
      }
    },
    manevre() { return said.filter(s => s.cl === 'manevra').map(s => s.t); } };
}

console.log('\n═══ Introducerea în lanț: numărul + direcția, fără nimic între ele ═══');
{
  // Fluxul de mâine dimineață: scrie „5", apasă „→ DREAPTA", scrie „7", apasă „③".
  let l = [];
  l = puneVirajPropriu(l, 5, 'DREAPTA');
  ok('prima intrare intră în listă', l.length === 1 && l[0].num === 5 && l[0].dir === 'DREAPTA',
     JSON.stringify(l));
  l = puneVirajPropriu(l, 7, 'GIRATORIU-3');
  ok('a doua intrare, consecutiv, fără să o strice pe prima',
     l.length === 2 && l[1].num === 7 && l[1].dir === 'GIRATORIU-3', JSON.stringify(l));
  // numărul tastat de pe telefon vine ca string din input.value
  ok('numărul tastat ca text e acceptat',
     puneVirajPropriu([], '18', 'STÂNGA-T')[0].num === 18);
  // se răzgândește: rescrie același box, nu trebuie să șteargă întâi
  const r = puneVirajPropriu(l, 5, 'STÂNGA');
  ok('rescrierea aceluiași box îl ÎNLOCUIEȘTE, nu îl dublează',
     r.length === 2 && r.find(v => v.num === 5).dir === 'STÂNGA', JSON.stringify(r));
  ok('lista rămâne sortată pe numărul boxului, ca hârtia',
     puneVirajPropriu(puneVirajPropriu([], 40, 'STÂNGA'), 6, 'DREAPTA')
       .map(v => v.num).join(',') === '6,40');
  ok('numărul lipsă sau aiurea e refuzat, nu ghicit',
     puneVirajPropriu([], NaN, 'STÂNGA') === null &&
     puneVirajPropriu([], 0, 'STÂNGA') === null &&
     puneVirajPropriu([], 'abc', 'STÂNGA') === null);
  ok('direcția necunoscută e refuzată — sita DIR_OK e tot poarta',
     puneVirajPropriu([], 5, 'DREAPTA-ISH') === null &&
     puneVirajPropriu([], 5, null) === null);
  ok('✕ scoate exact un box, restul rămân', scoateVirajPropriu(l, 5).length === 1 &&
     scoateVirajPropriu(l, 5)[0].num === 7);
}

console.log('\n═══ APLICĂ: virajele lui pe boxurile lui, ÎNAINTE pe tot restul ═══');
{
  const boxes = LEG();
  const r = aplicaVirajeProprii(boxes, DECLARAT);
  const dir = n => boxes.find(b => b.num === n).dir;
  ok('boxul 5 primește DREAPTA, deși scanarea citise STÂNGA', dir(5) === 'DREAPTA', dir(5));
  ok('boxul 7 primește ieșirea 3, deși scanarea citise 2', dir(7) === 'GIRATORIU-3', dir(7));
  ok('boxul 3, citit greșit ca viraj, devine ÎNAINTE — deci tace', dir(3) === 'ÎNAINTE', dir(3));
  ok('boxul 4, mut la scanare, devine ÎNAINTE — nu mai e „box fără direcție"',
     dir(4) === 'ÎNAINTE', String(dir(4)));
  ok('toate boxurile nedeclarate sunt ÎNAINTE',
     boxes.filter(b => ![5, 7].includes(b.num)).every(b => b.dir === 'ÎNAINTE'),
     JSON.stringify(boxes.map(b => [b.num, b.dir])));
  ok('cifrele raportate sunt cele reale: 2 declarate, 6 amuțite din 8',
     r.declarate === 2 && r.amutite === 6 && r.total === 8, JSON.stringify(r));
  ok('și lista boxurilor chiar schimbate e completă', r.schimbate.length === 4,
     JSON.stringify(r.schimbate.map(s => s.num)));
  ok('fiecare schimbare știe de unde vine și unde ajunge — jurnalul poate reconstitui',
     r.schimbate.every(s => 'inainte' in s && 'dupa' in s && s.num != null && s.km != null),
     JSON.stringify(r.schimbate[0]));

  // CE N-ARE VOIE SĂ SE MIȘTE: semnele de probă, TC-urile, kilometrajele, comentariile.
  const b = LEG();
  aplicaVirajeProprii(b, DECLARAT);
  ok('TC-ul de la boxul 1 e neatins', areFlag(b.find(x => x.num === 1), 'TC'));
  ok('startul de probă de la boxul 6 e neatins',
     areFlag(b.find(x => x.num === 6), 'RT_START_AUTO'));
  ok('finișul de la boxul 8 e neatins', areFlag(b.find(x => x.num === 8), 'RT_FINISH'));
  ok('niciun semn n-a apărut sau dispărut nicăieri',
     b.every((x, i) => normFlags(x).join() === normFlags(LEG()[i]).join()));
  ok('kilometrajele sunt neatinse', b.every((x, i) => x.sumKm === LEG()[i].sumKm));
  ok('comentariile sunt neatinse', b.every((x, i) => x.comment === LEG()[i].comment));
  // și probele ies la fel după aplicare — direcțiile nu cronometrează nimic
  ok('planul are aceleași probe, cu aceeași lungime',
     buildPlan(b, {}, null).rts.length === buildPlan(LEG(), {}, null).rts.length &&
     buildPlan(b, {}, null).rts[0].distKm === buildPlan(LEG(), {}, null).rts[0].distKm);
}

console.log('\n═══ Idempotență: a doua apăsare nu mai scrie nimic ═══');
{
  const boxes = LEG();
  const unu = aplicaVirajeProprii(boxes, DECLARAT);
  const doi = aplicaVirajeProprii(boxes, DECLARAT);
  ok('prima aplicare chiar schimbă ceva', unu.schimbate.length > 0);
  ok('a doua nu schimbă nimic — zero intrări noi în jurnal',
     doi.schimbate.length === 0, JSON.stringify(doi.schimbate));
  ok('dar cifrele rezumatului rămân aceleași, nu se golesc',
     doi.declarate === unu.declarate && doi.amutite === unu.amutite, JSON.stringify(doi));
  // a treia oară, după o „rescanare" care readuce direcții citite de model: lista LUI e
  // sursa, deci re-aplicarea repară tot, fără să fie nevoie de altceva
  boxes.find(b => b.num === 3).dir = 'DREAPTA';        // ce ar face o rescanare
  boxes.find(b => b.num === 5).dir = 'STÂNGA';
  const trei = aplicaVirajeProprii(boxes, DECLARAT);
  ok('după o rescanare care readuce direcțiile modelului, re-aplicarea le repară',
     trei.schimbate.length === 2 &&
     boxes.find(b => b.num === 3).dir === 'ÎNAINTE' &&
     boxes.find(b => b.num === 5).dir === 'DREAPTA', JSON.stringify(trei.schimbate));
}

console.log('\n═══ Boxul declarat care NU există: se spune, nu se înghite ═══');
{
  // Cifra tastată greșit — „118" în loc de „18" — ar rămâne altfel o intersecție despre
  // care pilotul crede că e acoperită, iar aplicația tace acolo.
  const boxes = LEG();
  const r = aplicaVirajeProprii(boxes, [...DECLARAT, { num: 118, dir: 'DREAPTA' }]);
  ok('boxul inexistent e raportat pe nume', r.lipsa.join() === '118', JSON.stringify(r.lipsa));
  ok('și nu strică restul aplicării', r.declarate === 2 && r.amutite === 6);
  ok('restul boxurilor sunt exact cele așteptate',
     boxes.find(b => b.num === 5).dir === 'DREAPTA' &&
     boxes.find(b => b.num === 3).dir === 'ÎNAINTE');
}

console.log('\n═══ Reversibilitate: înapoi la direcțiile scanate ═══');
{
  const boxes = LEG();
  const foto = instantaneuDirectii(boxes);       // se face ÎNAINTE de prima aplicare
  aplicaVirajeProprii(boxes, DECLARAT);
  ok('după aplicare, direcțiile sunt ale lui',
     boxes.find(b => b.num === 3).dir === 'ÎNAINTE' &&
     boxes.find(b => b.num === 5).dir === 'DREAPTA');
  const sch = restaureazaDirectii(boxes, foto);
  ok('restaurarea readuce fiecare direcție citită de scanare',
     boxes.every((b, i) => b.dir === LEG()[i].dir),
     JSON.stringify(boxes.map(b => [b.num, b.dir])));
  ok('inclusiv boxul care era MUT la scanare — nu i se inventează un ÎNAINTE',
     boxes.find(b => b.num === 4).dir === null, String(boxes.find(b => b.num === 4).dir));
  ok('și spune câte a mișcat', sch.length === 4, JSON.stringify(sch.map(s => s.num)));
  ok('a doua restaurare nu mai are ce muta',
     restaureazaDirectii(boxes, foto).length === 0);
  ok('un box apărut după fotografie (rescanare) nu e atins de restaurare',
     (() => { const b2 = LEG(); const f = instantaneuDirectii(b2.filter(x => x.num !== 7));
              aplicaVirajeProprii(b2, DECLARAT);
              restaureazaDirectii(b2, f);
              return b2.find(x => x.num === 7).dir === 'GIRATORIU-3'; })());
  ok('fără fotografie, restaurarea nu face nimic și nu crapă',
     restaureazaDirectii(LEG(), null).length === 0);
}

console.log('\n═══ Rezultatul în difuzor: vorbesc DOAR virajele lui ═══');
{
  const scanat = lume(LEG());
  scanat.condu(3.6);
  ok('MARTORUL: cu direcțiile scanate, vorbesc patru boxuri',
     scanat.manevre().some(t => /dreapta/i.test(t)) &&
     scanat.manevre().some(t => /stânga/i.test(t)) &&
     scanat.manevre().some(t => /ieșirea 2/.test(t)),
     JSON.stringify(scanat.manevre()));

  const alLui = LEG();
  aplicaVirajeProprii(alLui, DECLARAT);
  const w = lume(alLui);
  w.condu(3.6);
  const man = w.manevre();
  ok('boxul 3, citit greșit, nu mai spune nimic',
     w.store.journal.filter(e => e.type === 'cue' && e.boxNum === 3).length === 0);
  ok('boxul 5 spune DREAPTA, cum a declarat el',
     man.some(t => /dreapta/i.test(t)) && !man.some(t => /stânga/i.test(t)),
     JSON.stringify(man));
  ok('boxul 7 spune ieșirea 3, nu 2',
     man.some(t => /ieșirea 3/.test(t)) && !man.some(t => /ieșirea 2/.test(t)),
     JSON.stringify(man));
  ok('semnele de probă se aud mai departe — nu s-a amuțit cursa, doar virajele',
     man.some(t => /Start probă|START probă/i.test(t)) && man.some(t => /[Ff]inish/.test(t)),
     JSON.stringify(man));
  ok('nicio alarmă „ar fi trebuit să virezi" pe boxurile amuțite',
     !w.store.journal.filter(e => e.type === 'desync_warn').some(e => [3, 4].includes(e.boxNum)),
     JSON.stringify(w.store.journal.filter(e => e.type === 'desync_warn')));
}

console.log('\n═══ Sita listei: vine dintr-un fișier, deci e conținut extern ═══');
{
  const murdar = {
    '1|1': [{ num: 5, dir: 'DREAPTA' },
            { num: 7, dir: 'GIRATORIU-3' },
            { num: 9, dir: 'DREAPTA; DROP TABLE' },     // direcție inventată
            { num: -3, dir: 'STÂNGA' },                 // număr imposibil
            { num: 4.7, dir: 'STÂNGA' },                // nu e întreg
            { num: 'abc', dir: 'STÂNGA' },
            null, 'text', 42,
            { num: 5, dir: 'STÂNGA-T' }],               // rescriere: ultima câștigă
    '1|2': [{ num: 2, dir: 'ÎNAINTE' }],
    'cheie mult prea lungă ca să fie un leg real': [{ num: 1, dir: 'STÂNGA' }],
    rele: 'nu e listă'
  };
  const c = normVirajeProprii(murdar);
  ok('rămân doar intrările valide', c['1|1'].length === 2, JSON.stringify(c['1|1']));
  ok('ultima scriere pe același box câștigă',
     c['1|1'].find(v => v.num === 5).dir === 'STÂNGA-T');
  ok('al doilea leg trece separat, cu numerele lui', c['1|2'].length === 1);
  ok('cheia care nu poate fi un leg e aruncată',
     !('cheie mult prea lungă ca să fie un leg real' in c));
  ok('o valoare care nu e listă e aruncată', !('rele' in c));
  ok('intrări nule sau de alt tip nu crapă sita', Array.isArray(c['1|1']));
  ok('gunoiul complet dă obiect gol, nu excepție',
     Object.keys(normVirajeProprii(null)).length === 0 &&
     Object.keys(normVirajeProprii('text')).length === 0 &&
     Object.keys(normVirajeProprii([1, 2, 3])).length === 0);
  // și, cel mai important: nimic din ce a trecut sita nu poate scrie o direcție ilegală
  const boxes = LEG();
  aplicaVirajeProprii(boxes, c['1|1']);
  ok('nicio direcție ilegală nu ajunge pe vreun box',
     boxes.every(b => b.dir === null || ['ÎNAINTE', 'STÂNGA', 'DREAPTA', 'STÂNGA-T',
       'DREAPTA-T', 'STOP-CFR'].includes(b.dir) || /^GIRATORIU-[1-4]$/.test(b.dir)),
     JSON.stringify(boxes.map(b => b.dir)));
}

console.log('\n═══ Persistență: repornirea și trecerea pe alt telefon ═══');
{
  const s = makeMemStore();
  await s.put('viraje_proprii', { '1|1': DECLARAT });
  await s.put('dir_scanat', { '1|1': instantaneuDirectii(LEG()) });
  await s.put('plan_raw', LEG());
  await s.log('start', {}, 1);
  const dump = await exportDay(s);
  ok('lista pleacă în export', dump.viraje_proprii && dump.viraje_proprii['1|1'].length === 2,
     JSON.stringify(dump.viraje_proprii));
  ok('și fotografia direcțiilor scanate, ca revenirea să fie posibilă și pe alt telefon',
     dump.dir_scanat && dump.dir_scanat['1|1']['3'] === 'DREAPTA',
     JSON.stringify(dump.dir_scanat));

  const s2 = makeMemStore();
  await importDay(s2, dump);
  ok('importul le pune la loc',
     (await s2.get('viraje_proprii'))['1|1'].length === 2 &&
     !!(await s2.get('dir_scanat'))['1|1']);
  ok('iar sita se aplică la încărcare, ca la plan_raw',
     normVirajeProprii(await s2.get('viraje_proprii'))['1|1'].length === 2);
  // un export vechi, fără câmpurile astea, nu trebuie să crape importul
  const vechi = { ...dump };
  delete vechi.viraje_proprii; delete vechi.dir_scanat;
  const s3 = makeMemStore();
  await importDay(s3, vechi);
  ok('un export de dinainte de v45 se importă fără să crape',
     (await s3.get('viraje_proprii')) === undefined || (await s3.get('viraje_proprii')) === null);
}

console.log('\n═══ Ecranul: cardul și cablajul lui ═══');
{
  const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
  const html = readFileSync(join(aici, '..', 'index.html'), 'utf8');
  ok('cardul există în pregătire, deasupra PROBELOR',
     /VIRAJELE MELE — direcțiile pe care le declari tu/.test(html) &&
     html.indexOf('VIRAJELE MELE') < html.indexOf('PROBELE — VERIFICĂ'));
  ok('are câmp de număr și rândul de direcții',
     /id="vp-num"/.test(html) && /id="vp-butoane" class="dirrow"/.test(html));
  ok('butoanele sunt ACELEAȘI zece din editorul per-box, dintr-o singură sursă',
     /for \(const d of DIRECTII_EDITOR\)[\s\S]{0,300}adaugaViraj\(d\.v\)/.test(main));
  const add = /async function adaugaViraj[\s\S]*?\n}/.exec(main)[0];
  ok('apăsarea direcției adaugă direct — niciun confirm, niciun dialog',
     !/confirm\(|alert\(/.test(add));
  ok('câmpul se golește și își ia focusul, ca introducerea să curgă',
     /inp\.value = ''; inp\.focus\(\)/.test(add));
  ok('boxul inexistent NU golește câmpul — se corectează cifra, nu se retastează',
     /nu există în/.test(add) && /inp\.select\(\)/.test(add) &&
     add.indexOf('inp.select()') < add.indexOf("inp.value = ''"));
  ok('fiecare intrare lasă urmă în jurnal', /store\.log\('viraj_propriu'/.test(add));
  const apl = /async function aplicaVirajele[\s\S]*?\n}/.exec(main)[0];
  // v47: butonul nu mai APLICĂ direcțiile lui (alea intră la introducere) — amuțește
  // restul. Confirmarea spune tot cifrele, dar cifrele care descriu ce se schimbă ACUM.
  ok('amuțirea cere confirmare cu CIFRELE pe ecran',
     /confirm\(/.test(apl) && /AMUȚESC restul: \$\{total - exista\}/.test(apl) &&
     /devin ÎNAINTE/.test(apl));
  ok('și spune limpede că direcțiile lui sunt DEJA active, nu se ating',
     /Direcțiile tale \(\$\{exista\}\) sunt deja active/.test(apl));
  ok('trece prin aplicaVirajeProprii, deci prin aplicaDirectie și sita DIR_OK',
     /aplicaVirajeProprii\(plan\.boxes, lista\)/.test(apl));
  ok('scrie un flag_manual per box schimbat, cu sursa lui',
     /ce: 'dir'[\s\S]{0,200}sursa: 'viraje_proprii'/.test(apl));
  ok('și un eveniment-rezumat cu declarate/amuțite',
     /store\.log\('viraje_proprii', \{ leg: plan\.legKey, declarate: r\.declarate,\s*amutite: r\.amutite/.test(apl));
  ok('salvează planul și îl reconstruiește', /store\.put\('plan_raw', boxesRaw\)/.test(apl) &&
     /await rebuildPlan\(\)/.test(apl));
  ok('boxurile inexistente sunt spuse pe ecran, nu doar în jurnal',
     /IGNORATE, nu există/.test(apl));
  const rest = /async function restaureazaScanate[\s\S]*?\n}/.exec(main)[0];
  ok('restaurarea cere confirmare și spune că lista NU se pierde',
     /confirm\(/.test(rest) && /Lista ta de viraje NU se șterge/.test(rest));
  // v47: fotografia s-a mutat într-o funcție a ei și se face înaintea PRIMEI scrieri pe
  // leg — care de-acum poate fi o simplă declarație, nu apăsarea butonului mare.
  const foto = /function fotografiazaScanate\(\)[\s\S]*?\n}/.exec(main)[0];
  ok('fotografia direcțiilor scanate se face O SINGURĂ DATĂ pe leg',
     // conditia s-a largit la audit (07.08, seara): si o fotografie de forma gresita
     // (string dintr-un import corupt) lasa fotografierea sa se refaca, nu o blocheaza
     /typeof f === 'object' && !Array\.isArray\(f\)\) return false/.test(foto) &&
     /instantaneuDirectii\(boxeleLegului\(\)\)/.test(foto));
  ok('și se face ÎNAINTEA primei scrieri, adică la prima declarație',
     /fotografiazaScanate\(\);[\s\S]{0,400}declaraViraj\(/.test(add));
  ok('lista e ținută pe LEG — numerele de box repornesc la fiecare leg',
     /virajeProprii\[plan\.legKey\]/.test(main) &&
     /const virajeLeg = \(\) => \(plan && plan\.legKey && virajeProprii\[plan\.legKey\]\)/.test(main));
  ok('lista trece prin sită la pornire ȘI la import',
     (main.match(/normVirajeProprii\(await store\.get\('viraje_proprii'\)\)/g) || []).length === 2);
  ok('ștergerea roadbook-ului ia lista cu ea — e legată de boxurile lui',
     /await store\.del\('viraje_proprii'\); await store\.del\('dir_scanat'\)/.test(main) &&
     /viraje declarate de tine/.test(main));
  ok('BUILD-ul e v48 — versiunea care duce „virajele mele" mai departe',
     /const BUILD = 'v48'/.test(main));
}

// ═════════════════════════════════════════════════════════════════════════════
// v47 — DECLARAȚIA INTRĂ ÎN VIGOARE LA INTRODUCERE
//
// Cauza abandonului de la Sibiu, 08.08.2026, măsurată în jurnal:
//   11:09:31  viraj_propriu {boxNum: 4, dir: 'ÎNAINTE'}      ← el a declarat
//   …opt declarații între 11:09:31 și 11:10:11, niciun `flag_manual sursa:'viraje_proprii'`
//   11:10:28  day_start
//   11:12:21  lant {boxuri:[4,6,7], spanM:370, kmh:12}
//             „Trei la rând: dreapta, dreapta, apoi giratoriu, ieșirea 1."
//   11:12:38  cue {boxNum: 4} → „dreapta"                    ← direcția SCANATĂ a vorbit
// Lista lui exista, completă, și n-avea nicio putere: se activa doar la apăsarea butonului
// „APLICĂ", iar apăsarea nu s-a întâmplat niciodată. Doi pași pentru o decizie deja luată.
//
// Fixtura de mai jos e structura reală din jurnal: boxul 4 dreapta („Str. Ocnei"), boxul 6
// dreapta, boxul 7 giratoriu ieșirea 1, cu 370 m de la 4 la 7 — adică exact lanțul de trei.
const SIBIU = () => sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'TC 5' },
  { num: 2, sumKm: 0.40, dir: 'ÎNAINTE', flags: [], comment: '' },
  { num: 3, sumKm: 0.60, dir: 'ÎNAINTE', flags: [], comment: '' },
  { num: 4, sumKm: 0.90, dir: 'DREAPTA', flags: [], comment: 'Str. Ocnei' },
  { num: 6, sumKm: 1.10, dir: 'DREAPTA', flags: [], comment: '' },
  { num: 7, sumKm: 1.27, dir: 'GIRATORIU-1', flags: [], comment: '' },
  { num: 9, sumKm: 2.20, dir: 'ÎNAINTE', flags: [], comment: '' }
]);

console.log('\n═══ ACCEPTARE: declarația singură, fără nicio altă apăsare (08.08) ═══');
{
  // Exact ce a făcut el: A SCRIS „4", A APĂSAT „ÎNAINTE". Nimic altceva. Calea din
  // `adaugaViraj`, adică `declaraViraj` — nu `aplicaVirajeProprii`, care e butonul mare.
  const boxes = SIBIU();
  const r = declaraViraj(boxes, [], 4, 'ÎNAINTE');
  ok('declarația a intrat în listă', r.lista.length === 1 && r.lista[0].num === 4);
  ok('ȘI s-a scris PE BOX, în aceeași apăsare',
     boxes.find(b => b.num === 4).dir === 'ÎNAINTE',
     String(boxes.find(b => b.num === 4).dir));
  ok('schimbarea e raportată, ca ecranul s-o poată jurnaliza',
     r.schimbare && r.schimbare.inainte === 'DREAPTA' && r.schimbare.dupa === 'ÎNAINTE',
     JSON.stringify(r.schimbare));
  ok('boxurile nedeclarate NU s-au atins — asta rămâne treaba butonului de amuțire',
     boxes.find(b => b.num === 6).dir === 'DREAPTA' &&
     boxes.find(b => b.num === 7).dir === 'GIRATORIU-1');

  // …și acum mașina trece peste boxul 4, ca la 11:12
  const w = lume(boxes);
  w.condu(1.40);
  const man = w.manevre().join(' | ');
  const jur = w.store.journal;
  ok('ZERO anunț de viraj pe boxul 4', !jur.some(e => e.type === 'cue' && e.boxNum === 4),
     JSON.stringify(jur.filter(e => e.type === 'cue').map(e => e.boxNum)));
  ok('ZERO „manevra_neconfirmata" pe boxul 4',
     !jur.some(e => e.type === 'offroute_semn' && e.tip === 'manevra_neconfirmata' && e.boxNum === 4),
     JSON.stringify(jur.filter(e => e.type === 'offroute_semn')));
  ok('lanțul de TREI nu se mai formează — rămân două manevre, 6 și 7',
     !jur.some(e => e.type === 'lant'), JSON.stringify(jur.filter(e => e.type === 'lant')));
  ok('boxurile 6 și 7 sunt anunțate fiecare la rândul lui',
     jur.some(e => e.type === 'cue' && e.boxNum === 6) &&
     jur.some(e => e.type === 'cue' && e.boxNum === 7),
     JSON.stringify(jur.filter(e => e.type === 'cue').map(e => e.boxNum)));
  ok('și nicio frază rostită nu mai conține „Trei la rând"',
     !/Trei la rând/.test(man), man);
}

console.log('\n═══ Contra-proba: pe purtarea de până la v47, același drum PICĂ ═══');
{
  // Fără aplicare — adică exact ce s-a întâmplat pe 08.08: lista există, boxul e neatins.
  const boxes = SIBIU();
  const lista = puneVirajPropriu([], 4, 'ÎNAINTE');
  ok('lista lui e completă', lista.length === 1 && lista[0].dir === 'ÎNAINTE');
  ok('dar boxul 4 poartă tot direcția SCANATĂ',
     boxes.find(b => b.num === 4).dir === 'DREAPTA');
  const w = lume(boxes);
  w.condu(1.40);
  const jur = w.store.journal;
  ok('deci lanțul de trei se formează, ca în jurnalul real',
     jur.some(e => e.type === 'lant' && e.boxuri.join() === '4,6,7'),
     JSON.stringify(jur.filter(e => e.type === 'lant')));
  ok('și vocea strigă „Trei la rând", cu boxul 4 în el',
     /Trei la rând/.test(w.manevre().join(' | ')), w.manevre().join(' | '));
  ok('spanul măsurat e cel din jurnal: 370 m de la boxul 4 la boxul 7',
     jur.find(e => e.type === 'lant').spanM === 370,
     String(jur.find(e => e.type === 'lant').spanM));
}

console.log('\n═══ Starea vizibilă: cine vorbește ACUM pe fiecare box ═══');
{
  const boxes = SIBIU();
  let lista = [];
  let s = stareViraje(boxes, lista);
  ok('fără nicio declarație, cele trei viraje scanate sunt neacoperite',
     s.neacoperite.join() === '4,6,7' && s.amutit === false, JSON.stringify(s.neacoperite));
  const r1 = declaraViraj(boxes, lista, 4, 'ÎNAINTE'); lista = r1.lista;
  s = stareViraje(boxes, lista);
  ok('după declarația pe 4, ea e ACTIVĂ și rămân două neacoperite',
     s.active.join() === '4' && s.neacoperite.join() === '6,7', JSON.stringify(s));
  const r2 = declaraViraj(boxes, lista, 6, 'DREAPTA'); lista = r2.lista;
  ok('o declarație care coincide cu scanarea nu schimbă nimic pe box, dar intră în listă',
     r2.schimbare === null && lista.length === 2, JSON.stringify(r2));
  s = stareViraje(boxes, lista);
  ok('și e tot ACTIVĂ — starea se citește de pe box, nu din istoric',
     s.active.join() === '4,6' && s.neacoperite.join() === '7', JSON.stringify(s));
  const r3 = declaraViraj(boxes, lista, 7, 'GIRATORIU-3'); lista = r3.lista;
  s = stareViraje(boxes, lista);
  ok('cu toate virajele declarate, restul leg-ului e MUT',
     s.amutit === true && s.neacoperite.length === 0 && s.active.length === 3,
     JSON.stringify(s));
  ok('boxul declarat care nu există în leg e raportat separat, nu confundat cu unul activ',
     stareViraje(boxes, [...lista, { num: 118, dir: 'DREAPTA' }]).lipsa.join() === '118');
  // nepotrivirea: cineva a scris altceva pe box după declarație (rescanare)
  boxes.find(b => b.num === 4).dir = 'DREAPTA';
  s = stareViraje(boxes, lista);
  ok('dacă boxul poartă altceva decât ai declarat, se spune pe față',
     s.neconcordante.length === 1 && s.neconcordante[0].num === 4 &&
     s.neconcordante[0].cerut === 'ÎNAINTE' && s.neconcordante[0].are === 'DREAPTA',
     JSON.stringify(s.neconcordante));
  ok('și nu se mai numără ca activă', !s.active.includes(4), JSON.stringify(s.active));
}

console.log('\n═══ ✕ retrage declarația ȘI readuce direcția scanată ═══');
{
  const boxes = SIBIU();
  const foto = instantaneuDirectii(boxes);        // fotografia, ca în `fotografiazaScanate`
  let lista = declaraViraj(boxes, [], 4, 'ÎNAINTE').lista;
  ok('boxul 4 e pe ÎNAINTE, al lui', boxes.find(b => b.num === 4).dir === 'ÎNAINTE');
  const r = retrageViraj(boxes, lista, 4, foto);
  ok('✕ scoate intrarea din listă', r.lista.length === 0);
  ok('și readuce pe box direcția CITITĂ DE SCANARE, nu o lasă pe a lui',
     boxes.find(b => b.num === 4).dir === 'DREAPTA',
     String(boxes.find(b => b.num === 4).dir));
  ok('schimbarea e raportată, ca să intre în jurnal',
     r.schimbare.inainte === 'ÎNAINTE' && r.schimbare.dupa === 'DREAPTA' && r.spre === 'DREAPTA',
     JSON.stringify(r));

  // boxul care era MUT la scanare trebuie să redevină MUT, nu să primească un ÎNAINTE
  const b2 = sanitizeBoxes([{ num: 1, sumKm: 0, dir: null, flags: [], comment: '' },
                            { num: 2, sumKm: 0.5, dir: null, flags: [], comment: '' }]);
  const f2 = instantaneuDirectii(b2);
  const l2 = declaraViraj(b2, [], 2, 'DREAPTA').lista;
  ok('declarația pe un box mut îl scrie', b2.find(b => b.num === 2).dir === 'DREAPTA');
  const r2 = retrageViraj(b2, l2, 2, f2);
  ok('iar ✕ îl face MUT la loc — nu i se inventează un ÎNAINTE',
     b2.find(b => b.num === 2).dir === null, String(b2.find(b => b.num === 2).dir));
  ok('și se vede în raport unde s-a întors', r2.spre === null, JSON.stringify(r2));

  // fără fotografie (retragere înainte de orice fotografiere): box mut, nu direcția lui
  const b3 = SIBIU();
  const l3 = declaraViraj(b3, [], 4, 'ÎNAINTE').lista;
  retrageViraj(b3, l3, 4, null);
  ok('fără fotografie, boxul rămâne MUT — direcția lui nu are voie să supraviețuiască ștergerii',
     b3.find(b => b.num === 4).dir === null, String(b3.find(b => b.num === 4).dir));
  ok('un ✕ pe un box care nu există nu crapă',
     retrageViraj(SIBIU(), [{ num: 118, dir: 'DREAPTA' }], 118, null).lista.length === 0);
}

console.log('\n═══ Ne-regresie: amuțirea restului face tot ce făcea ═══');
{
  // Butonul mare și-a schimbat numele și textul, nu efectul: `aplicaVirajeProprii` e
  // aceeași funcție, cu aceleași cifre — testată sus. Aici se verifică doar că cele două
  // căi ajung la ACEEAȘI stare: declarații una câte una + amuțire = vechea aplicare.
  const prinDeclaratii = SIBIU();
  let lista = [];
  for (const [n, d] of [[5, 'DREAPTA'], [7, 'GIRATORIU-3']]) {
    const r = declaraViraj(prinDeclaratii, lista, n, d);
    lista = r.lista;
  }
  aplicaVirajeProprii(prinDeclaratii, lista);
  const prinAplicare = SIBIU();
  aplicaVirajeProprii(prinAplicare, [{ num: 5, dir: 'DREAPTA' }, { num: 7, dir: 'GIRATORIU-3' }]);
  ok('cele două căi dau exact aceleași direcții pe toate boxurile',
     prinDeclaratii.map(b => `${b.num}:${b.dir}`).join() ===
     prinAplicare.map(b => `${b.num}:${b.dir}`).join(),
     JSON.stringify(prinDeclaratii.map(b => [b.num, b.dir])));
  ok('amuțirea de după declarații încă schimbă ceva (boxurile 4 și 6, nedeclarate)',
     prinDeclaratii.find(b => b.num === 4).dir === 'ÎNAINTE' &&
     prinDeclaratii.find(b => b.num === 6).dir === 'ÎNAINTE');
  ok('și după amuțire restul e MUT, măsurat',
     stareViraje(prinDeclaratii, lista).amutit === true);
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
