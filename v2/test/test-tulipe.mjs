// RALI 2 — direcția citită greșit din tulipă, și apărarea împotriva ei.
//
// 07.08.2026, raportat de pilot DE PE TRASEU, la Sibiu, între etape, după ce l-a scos de
// pe drum de mai multe ori într-o singură zi. Două tipare, amândouă de CITIRE A
// DESENULUI, nu de OCR:
//  1. BIFURCAȚIE V/Y: pe hârtie vârful de săgeată e pe ramura din STÂNGA, aplicația a
//     anunțat „dreapta";
//  2. SĂGEATĂ DREAPTĂ CU LINIUȚE LATERALE (drumuri care se văd din intersecție, dar pe
//     care nu se merge): citită ca viraj, când direcția reală e ÎNAINTE.
//
// COSTUL E ASIMETRIC, și ăsta e firul care ține tot fișierul: un ÎNAINTE greșit e MUT și
// aproape inofensiv — pilotul își urmează roadbook-ul de hârtie. Un viraj greșit STRIGĂ
// „dreapta acum" într-o intersecție unde trebuia mers drept, în probă cronometrată.
//
// Apărarea are două straturi, iar ordinea lor e importantă:
//  • DETERMINIST — editorul de direcție din pregătire (route.js → DIRECTII_EDITOR,
//    aplicaDirectie; main.js → puneDirectie). Se apasă în parcare, cu hârtia în mână, și
//    nu depinde de niciun model. Aici se testează tot.
//  • PROBABILIST — paragraful TULIP din ROADBOOK_PROMPT. Se poate verifica doar că SPUNE
//    ce trebuie; dacă modelul îl și ascultă se măsoară pe poze reale, nu aici.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildPlan, sanitizeBoxes, groupByLeg, verifyRoadbook,
         DIR_OK, TURN_DIRS, DIRECTII_EDITOR, aplicaDirectie } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';

const aici = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

// ── LUMEA DE TEST ───────────────────────────────────────────────────────────
// Drum drept, fără niciun viraj real: mașina merge pe o singură direcție. Așa se
// măsoară exact ce voiam — CE SPUNE aplicația despre boxuri —, fără ca detectorul de
// viraje să mai mute poziția pe sub picioare.
function lume(boxes) {
  let wall = 0, realKm = 0;
  const clock = makeClock({ now: () => wall, mono: () => wall });
  const store = makeMemStore();
  const said = [];
  const m = makeMachine({ opts: { offRoute: false }, plan: buildPlan(boxes, {}, null), clock, store,
    driver: makeDriverModel(),
    voice: { say: (t, p, cat, cls) => said.push({ t, p, cat, cls }), tone() {}, flush() {} },
    ui: { render() {} } });
  m.start();
  wall += 1000; m.onFix({ lat: 45, lng: 21, tMs: wall, speedMs: 0, headingDeg: 0, accM: 8 });
  return { m, store, said,
    condu(panaLa, kmh = 36) {
      while (realKm < panaLa - 1e-9) {
        const pas = Math.min(kmh / 3600, panaLa - realKm);
        realKm += pas; wall += 1000;
        m.onFix({ lat: 45 + realKm / 111.32, lng: 21, tMs: wall,
                  speedMs: pas * 1000, headingDeg: 0, accM: 8 });
      }
    },
    // ce s-a rostit despre MANEVRE: restul (ghidaj, ritm, corecții) e altă conversație
    manevre() { return said.filter(s => s.cls === 'manevra').map(s => s.t); } };
}

// Roadbook-ul-martor: boxul 3 e tocmai tiparul raportat de pilot — pe hârtie e o săgeată
// dreaptă cu o liniuță laterală (deci ÎNAINTE), dar scanarea l-a citit „DREAPTA".
const CITIT_GRESIT = [
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Start Leg 1 / TC 1' },
  { num: 2, sumKm: 0.60, dir: 'ÎNAINTE', comment: 'drum drept' },
  { num: 3, sumKm: 1.40, dir: 'DREAPTA', comment: 'bifurcatie' },
  { num: 4, sumKm: 2.20, dir: 'STÂNGA-T', comment: 'la T' },
  { num: 5, sumKm: 3.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Finish Leg 1 / TC 2' }
];

console.log('\n═══ Vocabularul: editorul acoperă TOT ce poate citi scanarea ═══');
{
  const dinEditor = DIRECTII_EDITOR.map(d => d.v);
  ok('fiecare buton pune o direcție pe care planul o acceptă',
     dinEditor.every(v => DIR_OK.has(v)), JSON.stringify(dinEditor.filter(v => !DIR_OK.has(v))));
  // Asta e proprietatea care contează cu adevărat: dacă scanarea poate produce o direcție
  // pe care editorul n-o poate pune la loc, atunci există o citire greșită pe care omul
  // NU o poate repara în parcare — adică exact gaura pe care o astupă tot fișierul ăsta.
  ok('și invers: nicio direcție din plan nu e imposibil de pus de mână',
     [...DIR_OK].every(v => dinEditor.includes(v)),
     JSON.stringify([...DIR_OK].filter(v => !dinEditor.includes(v))));
  ok('fără butoane duplicate', new Set(dinEditor).size === dinEditor.length);
  ok('ÎNAINTE e primul buton — răspunsul cel mai des și cel mai ieftin dacă greșești',
     dinEditor[0] === 'ÎNAINTE', dinEditor[0]);
  ok('giratoriul are toate cele patru ieșiri, ca butoane separate (o apăsare, nu două)',
     [1, 2, 3, 4].every(n => dinEditor.includes('GIRATORIU-' + n)));
  ok('fiecare buton are text de citit pe telefon',
     DIRECTII_EDITOR.every(d => typeof d.txt === 'string' && d.txt.length > 2));
}

console.log('\n═══ aplicaDirectie: scrie, refuză, și tace când n-are ce schimba ═══');
{
  const b = { num: 3, sumKm: 1.4, dir: 'DREAPTA' };
  const r = aplicaDirectie(b, 'ÎNAINTE');
  ok('schimbă direcția pe box', b.dir === 'ÎNAINTE', b.dir);
  ok('și întoarce starea de dinainte și de după, pentru jurnal',
     r && r.inainte === 'DREAPTA' && r.dupa === 'ÎNAINTE', JSON.stringify(r));
  ok('a doua apăsare pe același buton nu mai schimbă nimic (null = nimic de jurnalizat)',
     aplicaDirectie(b, 'ÎNAINTE') === null);
  // granița de încredere: în box nu intră niciodată un șir pe care planul nu-l înțelege
  const c = { num: 9, sumKm: 2, dir: 'STÂNGA' };
  ok('refuză o direcție inventată și lasă boxul neatins',
     aplicaDirectie(c, 'DREAPTA-STÂNGA') === null && c.dir === 'STÂNGA', c.dir);
  ok('refuză null și string gol', aplicaDirectie(c, null) === null && aplicaDirectie(c, '') === null);
  ok('refuză un box lipsă, fără să crape', aplicaDirectie(null, 'ÎNAINTE') === null);
  const gol = { num: 7, sumKm: 3, dir: null };
  ok('un box MUT (fără direcție citită) primește direcție, iar jurnalul spune că n-avea',
     aplicaDirectie(gol, 'GIRATORIU-2') !== null && gol.dir === 'GIRATORIU-2');
  ok('și „inainte" e null acolo, nu o invenție',
     aplicaDirectie({ dir: null }, 'STÂNGA').inainte === null);
}

console.log('\n═══ Corectura supraviețuiește depozitului și reconstruirii planului ═══');
{
  // Drumul real al unei corecturi, pas cu pas: se scrie în boxurile BRUTE → se salvează
  // în plan_raw → la următoarea pornire se citește înapoi prin sanitizeBoxes → se
  // regrupează pe leg → intră în buildPlan. Dacă vreunul din pași ar pierde-o, pilotul
  // ar pleca a doua zi cu direcția veche, fără ca ceva să i-o spună.
  const raw = sanitizeBoxes(CITIT_GRESIT);
  const b3 = raw.find(x => x.num === 3);
  aplicaDirectie(b3, 'ÎNAINTE');
  const dupaDepozit = sanitizeBoxes(JSON.parse(JSON.stringify(raw)));
  ok('sanitizeBoxes păstrează direcția pusă de mână',
     dupaDepozit.find(x => x.num === 3).dir === 'ÎNAINTE',
     dupaDepozit.find(x => x.num === 3).dir);
  const g = groupByLeg(dupaDepozit)[0];
  const plan = buildPlan(g.boxes, {}, null);
  ok('și planul reconstruit o duce mai departe',
     plan.boxes.find(x => x.num === 3).dir === 'ÎNAINTE');
  ok('boxurile planului sunt CHIAR obiectele brute — o corectură ulterioară ajunge în plan',
     plan.boxes.includes(g.boxes[0]) && g.boxes.every(x => dupaDepozit.includes(x)));
  // toate cele zece direcții, dus-întors prin depozit
  const toate = DIRECTII_EDITOR.map((d, i) => {
    const box = { num: i + 1, sumKm: (i + 1) * 0.5, dir: 'DREAPTA', comment: '', flags: [] };
    aplicaDirectie(box, d.v);
    return box;
  });
  const inapoi = sanitizeBoxes(JSON.parse(JSON.stringify(toate)));
  ok('toate cele zece direcții trec întregi prin depozit',
     inapoi.every((x, i) => x.dir === DIRECTII_EDITOR[i].v),
     JSON.stringify(inapoi.map(x => x.dir)));
}

console.log('\n═══ Boxul corectat din DREAPTA în ÎNAINTE nu mai strigă ═══');
{
  const raw = sanitizeBoxes(CITIT_GRESIT);
  const inainte = lume(raw);
  inainte.condu(1.8);
  const cueBox3 = w => w.store.journal.filter(e => e.type === 'cue' && e.boxNum === 3);
  ok('MARTORUL: citit greșit, aplicația chiar strigă „dreapta"',
     inainte.manevre().some(t => /dreapta/i.test(t)),
     JSON.stringify(inainte.manevre()));
  ok('și strigă și „acum", adică fix în intersecție',
     inainte.manevre().some(t => /dreapta acum/i.test(t)),
     JSON.stringify(inainte.manevre()));
  ok('cu urmă în jurnal pe boxul 3', cueBox3(inainte).length > 0);

  // corectura, exact ca la apăsarea butonului: scrie în boxul brut, apoi planul se reface
  aplicaDirectie(raw.find(x => x.num === 3), 'ÎNAINTE');
  const dupa = lume(sanitizeBoxes(JSON.parse(JSON.stringify(raw))));
  dupa.condu(1.8);
  ok('după corectură nu mai spune „dreapta" nicăieri',
     !dupa.manevre().some(t => /dreapta/i.test(t)), JSON.stringify(dupa.manevre()));
  // Boxul 3 devine MUT. Ce se aude pe aceeași porțiune e despre ALTE boxuri (TC-ul de la
  // start, apoi stânga de la boxul 4, care intră în fereastra de 500 m) — deci proba se
  // face pe boxul 3, nu pe tăcerea absolută a difuzorului.
  ok('și niciun cue pentru boxul 3 — un ÎNAINTE fără semn e mut',
     cueBox3(dupa).length === 0, JSON.stringify(cueBox3(dupa)));
  ok('nici vreo frază care să-l pomenească',
     !dupa.manevre().some(t => /boxul 3\b/.test(t)), JSON.stringify(dupa.manevre()));
  ok('corectura n-a atins celelalte boxuri: stânga la T de la boxul 4 se aude mai departe',
     (() => { const w = lume(sanitizeBoxes(JSON.parse(JSON.stringify(raw)))); w.condu(2.4);
              return w.manevre().some(t => /stânga/i.test(t)); })());
}

console.log('\n═══ Giratoriul corectat anunță IEȘIREA nouă, nu pe cea citită ═══');
{
  const raw = sanitizeBoxes(CITIT_GRESIT);
  aplicaDirectie(raw.find(x => x.num === 3), 'GIRATORIU-3');
  const w = lume(sanitizeBoxes(JSON.parse(JSON.stringify(raw))));
  w.condu(1.8);
  ok('spune „giratoriu, ieșirea 3"',
     w.manevre().some(t => /giratoriu, ieșirea 3/i.test(t)), JSON.stringify(w.manevre()));
  ok('și nicăieri altă ieșire',
     !w.manevre().some(t => /ieșirea [1245]/.test(t)), JSON.stringify(w.manevre()));
  // a doua corectură pe același box: ultima apăsare e cea care contează
  aplicaDirectie(raw.find(x => x.num === 3), 'GIRATORIU-1');
  const w2 = lume(sanitizeBoxes(JSON.parse(JSON.stringify(raw))));
  w2.condu(1.8);
  ok('recorectat, anunță ieșirea 1 și niciodată pe 3',
     w2.manevre().some(t => /ieșirea 1/.test(t)) && !w2.manevre().some(t => /ieșirea 3/.test(t)),
     JSON.stringify(w2.manevre()));
}

console.log('\n═══ Corectura DIN MERS: se aplică pe planul viu, fără repornire ═══');
{
  // Cazul de azi, cu Andreas în cursă la Sibiu: descoperă la un TC că boxul din față e
  // citit greșit. `rebuildPlan` REFUZĂ să reconstruiască planul cu cursa pornită (și bine
  // face — nu se schimbă traseul sub mașină), deci întrebarea e dacă corectura mai ajunge
  // la anunțuri. Ajunge, fiindcă `plan.boxes` sunt CHIAR obiectele din boxesRaw: buildPlan
  // nu le copiază. Proprietatea asta e ce face editorul folosibil ÎN cursă, nu doar în
  // parcarea de dimineață — deci se testează, nu se presupune.
  const raw = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: [], comment: '' },
    { num: 2, sumKm: 1.00, dir: 'DREAPTA', flags: [], comment: '' },
    { num: 3, sumKm: 3.00, dir: 'DREAPTA', flags: [], comment: 'bifurcație în Y' }
  ]);
  const w = lume(raw);
  ok('planul folosește CHIAR boxurile brute, nu copii ale lor',
     w.m.M && raw.every(b => buildPlan(raw, {}, null).boxes.includes(b)));
  w.condu(1.2);                        // boxul 2 e trecut, anunțat ca dreapta
  ok('martorul: boxul 2 s-a anunțat „dreapta"',
     w.manevre().some(t => /dreapta/i.test(t)), JSON.stringify(w.manevre()));
  const panaAcum = w.manevre().length;
  // corectura, cu mașina în mișcare, exact cum o face butonul: scrie în boxul brut
  aplicaDirectie(raw.find(x => x.num === 3), 'ÎNAINTE');
  w.condu(3.2);
  const dupa = w.manevre().slice(panaAcum);
  ok('boxul 3, corectat din mers, nu mai produce niciun anunț de manevră',
     !dupa.some(t => /dreapta/i.test(t)), JSON.stringify(dupa));
  ok('și niciun cue pe el în jurnal',
     w.store.journal.filter(e => e.type === 'cue' && e.boxNum === 3).length === 0);

  // și invers: un ÎNAINTE corectat din mers în viraj chiar începe să vorbească
  const raw2 = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: [], comment: '' },
    { num: 2, sumKm: 3.00, dir: 'ÎNAINTE', flags: [], comment: 'de fapt e stânga la T' }
  ]);
  const w2 = lume(raw2);
  w2.condu(1.0);
  aplicaDirectie(raw2.find(x => x.num === 2), 'STÂNGA-T');
  w2.condu(3.2);
  ok('un box devenit viraj din mers e anunțat de acolo încolo',
     w2.manevre().some(t => /stânga la T/i.test(t)), JSON.stringify(w2.manevre()));
}

console.log('\n═══ VERIFICAREA CERUTĂ: ÎNAINTE-urile sunt mute — dar semnele lor, nu ═══');
{
  // Cererea, în cuvintele ei: „confirmă că boxurile cu dir ÎNAINTE NU produc anunțuri
  // vocale de manevră". Se măsoară pe un roadbook care e NUMAI ÎNAINTE-uri, condus cap
  // la cap: dacă vreo cale ar scoate un cue de manevră dintr-un ÎNAINTE, aici ar apărea.
  const doarDrept = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: [], comment: '' },
    { num: 2, sumKm: 0.60, dir: 'ÎNAINTE', flags: [], comment: 'liniuțe laterale' },
    { num: 3, sumKm: 1.40, dir: 'ÎNAINTE', flags: [], comment: 'bifurcație, dar drept' },
    { num: 4, sumKm: 2.20, dir: 'ÎNAINTE', flags: [], comment: '' },
    { num: 5, sumKm: 3.00, dir: 'ÎNAINTE', flags: [], comment: '' }
  ]);
  const w = lume(doarDrept);
  w.condu(3.2);
  ok('niciun anunț de manevră pe tot traseul', w.manevre().length === 0,
     JSON.stringify(w.manevre()));
  ok('și niciun cue în jurnal', w.store.journal.filter(e => e.type === 'cue').length === 0,
     JSON.stringify(w.store.journal.filter(e => e.type === 'cue')));
  ok('nici alarmă de viraj ratat — ÎNAINTE nu e manevră, deci n-are cum fi „ratată"',
     w.store.journal.filter(e => e.type === 'desync_warn').length === 0);
  ok('ÎNAINTE nu e în lista de manevre a mașinii (TURN_DIRS)', !TURN_DIRS.has('ÎNAINTE'));

  // Cealaltă față a aceleiași reguli: un ÎNAINTE care POARTĂ un semn (TC, linie de probă,
  // parcare) trebuie să vorbească mai departe. Tăcerea e a virajului absent, nu a boxului.
  const cuSemn = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: [], comment: '' },
    { num: 2, sumKm: 1.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Time Control - TC 2' },
    { num: 3, sumKm: 2.00, dir: 'ÎNAINTE', flags: [], comment: '' }
  ]);
  const w2 = lume(cuSemn);
  w2.condu(1.4);
  ok('un ÎNAINTE cu semn de Time Control se aude',
     w2.manevre().some(t => /Time Control/i.test(t)), JSON.stringify(w2.manevre()));
}

console.log('\n═══ Alarma „ar fi trebuit să virezi" se stinge odată cu corectura ═══');
{
  // Al doilea fel în care un viraj citit greșit rătăcește pilotul: nu doar îl trimite în
  // dreapta, ci apoi îl ceartă că n-a virat. Măsurat aici pe drum perfect drept.
  const raw = sanitizeBoxes(CITIT_GRESIT);
  const w = lume(raw);
  w.condu(2.0);
  const alarme = () => w.store.journal.filter(e => e.type === 'desync_warn');
  ok('MARTORUL: citit greșit, aplicația acuză pilotul că a ratat virajul',
     alarme().length > 0 && alarme()[0].boxNum === 3,
     JSON.stringify(alarme()));
  ok('și o spune cu voce tare',
     w.said.some(s => /ar fi trebuit să virezi/i.test(s.t)),
     JSON.stringify(w.said.map(s => s.t)));

  aplicaDirectie(raw.find(x => x.num === 3), 'ÎNAINTE');
  const w2 = lume(sanitizeBoxes(JSON.parse(JSON.stringify(raw))));
  w2.condu(2.0);
  ok('după corectură, nicio alarmă pentru boxul 3',
     !w2.store.journal.filter(e => e.type === 'desync_warn').some(e => e.boxNum === 3),
     JSON.stringify(w2.store.journal.filter(e => e.type === 'desync_warn')));
  ok('și nicio vorbă despre viraje ratate',
     !w2.said.some(s => /trebuit să virezi|pare ratat/i.test(s.t)),
     JSON.stringify(w2.said.map(s => s.t)));
}

console.log('\n═══ Boxul mut capătă direcție, iar verificatorul tace ═══');
{
  // „boxul N n-are nici direcție, nici semn" e unul dintre avertismentele verificatorului.
  // Până acum se putea repara doar punându-i un SEMN de probă — adică mințind despre
  // cronometrare ca să scapi de un avertisment despre direcție.
  const raw = sanitizeBoxes([
    { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Start' },
    { num: 2, sumKm: 0.80, dir: null, flags: [], comment: 'căsuță necitită' },
    { num: 3, sumKm: 1.60, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Finish' }
  ]);
  const mut = p => p.some(x => /boxul 2 n-are nici direcție/.test(x));
  ok('MARTORUL: verificatorul semnalează boxul mut',
     mut(verifyRoadbook(raw).probleme), JSON.stringify(verifyRoadbook(raw).probleme));
  aplicaDirectie(raw.find(x => x.num === 2), 'STÂNGA-T');
  ok('după ce i se pune direcția, avertismentul dispare',
     !mut(verifyRoadbook(raw).probleme), JSON.stringify(verifyRoadbook(raw).probleme));
}

console.log('\n═══ Ecranul: rândul de butoane și cablajul lui ═══');
{
  const main = readFileSync(join(aici, '..', 'js', 'main.js'), 'utf8');
  ok('cardul boxului are un rând de butoane de direcție',
     /DIRECTII_EDITOR/.test(main) && /class = 'dirrow'|className = 'dirrow'/.test(main));
  ok('butonul activ e marcat ca la semnele de probă (bifă + verde)',
     /const activ = b\.dir === d\.v/.test(main) && /activ \? 'ok' : 'sec'/.test(main));
  ok('apăsarea trece prin puneDirectie', /puneDirectie\(b, d\.v\)/.test(main));
  const fn = /async function puneDirectie[\s\S]*?\n}/.exec(main)[0];
  ok('care scrie în boxurile BRUTE, nu într-o copie a planului',
     /boxesRaw\.find/.test(fn) && /aplicaDirectie\(b, dir\)/.test(fn));
  ok('salvează în plan_raw', /store\.put\('plan_raw', boxesRaw\)/.test(fn));
  ok('jurnalizează flag_manual cu ce:„dir", inainte și dupa',
     /store\.log\('flag_manual'/.test(fn) && /ce: 'dir'/.test(fn) &&
     /inainte: schimbare\.inainte/.test(fn) && /dupa: schimbare\.dupa/.test(fn));
  ok('și reconstruiește planul', /await rebuildPlan\(\);/.test(fn));
  ok('nu se scrie nimic când apăsarea n-a schimbat nimic',
     /if \(!schimbare\) return;/.test(fn) &&
     fn.indexOf('if (!schimbare) return;') < fn.indexOf("store.put('plan_raw'"));
  ok('rândul rămâne pe ecran după corectură, ca la semne',
     /_probeExtra\.add\(b\.num\)/.test(fn));
  // Cu cursa pornită, rebuildPlan se amână și nu mai ajunge la renderPrep → renderProbe.
  // Fără redesenarea de aici, bifa ar rămâne pe direcția veche și omul ar apăsa a doua
  // oară crezând că butonul n-a mers — deși direcția SE schimbase deja.
  ok('cardul se redesenează și când rebuildPlan se amână (cursă pornită)',
     /await rebuildPlan\(\);[\s\S]*renderProbe\(\);/.test(fn));
  ok('versiunea build-ului e v46', /const BUILD = 'v46'/.test(main));

  const html = readFileSync(join(aici, '..', 'index.html'), 'utf8');
  ok('ecranul spune ce ține corectura și ce o pierde',
     /DIRECȚIA fiecărui box se poate corecta/.test(html) &&
     /scanare nouă a aceleiași pagini NU o șterge/.test(html) &&
     /Se pierde doar dacă\s+ștergi roadbook-ul/.test(html));
  ok('și spune că se aplică imediat, inclusiv în cursă — afirmație măsurată mai sus',
     /Corectura se aplică IMEDIAT, inclusiv cu cursa pornită/.test(html));
  ok('și scrie regula prudenței și pentru om, nu doar pentru model',
     /Când eziți, pune ÎNAINTE/.test(html));
  const css = readFileSync(join(aici, '..', 'app.css'), 'utf8');
  ok('butoanele de direcție au rândul lor, care se rupe pe telefon',
     /\.dirrow \{[^}]*flex-wrap: wrap/.test(css));
  const sw = readFileSync(join(aici, '..', 'sw.js'), 'utf8');
  ok('cache-ul service worker-ului e bumpat la v46', /const CACHE = 'rali2-v46'/.test(sw));
}

console.log('\n═══ Promptul tulipelor: ce spune acum despre desen ═══');
{
  const scan = readFileSync(join(aici, '..', 'js', 'scan.js'), 'utf8');
  const prompt = /const ROADBOOK_PROMPT = `[\s\S]*?`;/.exec(scan)[0];
  // 1. gramatica desenului
  ok('spune că punctul plin e de unde VII',
     /PUNCTUL PLIN E DE UNDE VII/.test(prompt));
  ok('și că vârful de săgeată e cel care decide direcția',
     /VÂRFUL DE SĂGEATĂ DECIDE DIRECȚIA/.test(prompt));
  ok('ramurile fără vârf sunt declarate drumuri pe care NU se merge',
     /RAMURILE FĂRĂ VÂRF SUNT DRUMURI PE CARE NU SE MERGE/.test(prompt) &&
     /NU SCHIMBĂ DIRECȚIA/.test(prompt));
  // 2. tiparul „săgeată dreaptă cu liniuțe laterale"
  ok('săgeata dreaptă cu liniuțe laterale e ÎNAINTE, oricâte liniuțe ar avea',
     /SĂGEATĂ DREAPTĂ CU LINIUȚE SAU RAMURI LATERALE = "ÎNAINTE"/.test(prompt) &&
     /indiferent câte liniuțe sunt și în ce parte ies/.test(prompt));
  // 3. tiparul V/Y
  ok('la V/Y cere urmărirea liniei până la vârf și îndoirea de la CAPĂT',
     /BIFURCAȚIE ÎN V SAU Y/.test(prompt) &&
     /în ce parte se îndoaie linia lui LA CAPĂT/.test(prompt));
  ok('și interzice explicit inversarea care l-a rătăcit pe pilot',
     /VÂRFUL PE RAMURA DIN STÂNGA NU ÎNSEAMNĂ NICIODATĂ "DREAPTA"/.test(prompt));
  ok('ramura fără vârf se ignoră chiar dacă e mai lungă sau mai groasă',
     /Ramura fără vârf se ignoră complet/.test(prompt));
  // 4. regula prudenței, cu motivul ei
  ok('REGULA PRUDENȚEI: la neclaritate se scrie ÎNAINTE',
     /REGULA PRUDENȚEI, CARE BATE TOATE CELELALTE: dacă nu vezi CLAR încotro se îndoaie săgeata, scrie "ÎNAINTE"/.test(prompt));
  ok('și e motivată prin costul asimetric — un viraj inventat scoate de pe traseu',
     /un viraj inventat scoate pilotul de pe traseu/.test(prompt) &&
     /un "ÎNAINTE" pus greșit e mut/.test(prompt));
  ok('spune ce să facă la ezitare, nu doar ce să nu facă',
     /Când eziți între un viraj și "ÎNAINTE", alegi "ÎNAINTE"/.test(prompt));
  // 5. T-urile și giratoriile, ca să nu se lățească peste viraje simple
  ok('T-ul e definit prin drumul care se termină, nu prin desen',
     /DOAR la intersecție în T/.test(prompt) && /Dacă din desen se poate merge și drept, NU e T/.test(prompt));
  ok('giratoriul are o ieșire implicită, ca să nu rămână boxul mut',
     /Dacă nu se poate număra ieșirea, scrie "GIRATORIU-1"/.test(prompt));
  // 6. toate valorile pe care le știe planul apar și în prompt
  ok('promptul enumeră exact valorile pe care le acceptă sanitizarea',
     [...DIR_OK].every(v => prompt.includes('"' + v + '"') ||
       (/^GIRATORIU-/.test(v) && /"GIRATORIU-1"\.\."GIRATORIU-4"/.test(prompt))),
     JSON.stringify([...DIR_OK].filter(v => !prompt.includes('"' + v + '"'))));
  // 7. RESTUL PROMPTULUI E NEATINS. Paragrafele astea sunt calibrate pe pagini reale de
  //    la Reșița; o „îmbunătățire" colaterală aici s-ar plăti pe hârtia de mâine.
  ok('partea de icoane a rămas neatinsă (perechea de cercuri, fulgul, tabela culcată)',
     /DOUĂ CERCURI ALĂTURATE/.test(prompt) && /FULG DE NEA/.test(prompt) &&
     /TABELĂ CULCATĂ/.test(prompt) && /"TIMING_STANDING"/.test(prompt));
  ok('regula „flagul se citește din icoană, nu din cuvinte" e tot acolo',
     /FLAG-UL SE CITEȘTE DOAR DIN ICOANĂ/.test(prompt));
  ok('regulile de REPER sunt neatinse',
     /UN NUMĂR DE DRUM SINGUR NU E REPER/.test(prompt) &&
     /ACELAȘI REPER PE MULTE BOXURI NU AJUTĂ LA NIMIC/.test(prompt));
  ok('exemplul de JSON e neschimbat, cu flags ca listă',
     /"flags":\["TIMING"\]/.test(prompt) && /"flags":\["RT_FINISH","TIMING"\]/.test(prompt));
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
